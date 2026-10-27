
-- ============ ENUMS ============
create type public.app_role as enum ('owner','super_admin','admin','moderator','support','analyst');
create type public.conversation_kind as enum ('direct','group','channel','saved');
create type public.member_role as enum ('owner','admin','member');
create type public.report_status as enum ('open','in_review','resolved','rejected');
create type public.ticket_status as enum ('open','pending','resolved','closed');

-- ============ PROFILES (public data) ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null default '',
  avatar_url text,
  bio text not null default '' check (char_length(bio) <= 300),
  status_text text not null default '' check (char_length(status_text) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{5,32}$'),
  constraint display_name_len check (char_length(display_name) <= 64)
);
create unique index profiles_username_unique on public.profiles (lower(username));
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles readable by signed-in users" on public.profiles for select to authenticated using (true);
create policy "users update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- ============ ROLES ============
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id)
$$;
create or replace function public.is_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role in ('owner','super_admin','admin'))
$$;
create policy "users see own roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin(auth.uid()));
-- No insert/update/delete policies: roles change only through audited server-side functions.

-- ============ PREFERENCES (private) ============
create table public.user_preferences (
  user_id uuid primary key,
  nav_tabs jsonb not null default '["chats","contacts","calls","settings","profile"]'::jsonb,
  theme text not null default 'dark' check (theme in ('dark','light','system')),
  accent text not null default 'cyan' check (char_length(accent) <= 20),
  text_scale numeric not null default 1 check (text_scale between 0.85 and 1.3),
  reduce_motion boolean not null default false,
  sounds_enabled boolean not null default true,
  language text not null default 'ru' check (language in ('ru','en','uz')),
  show_online_status text not null default 'contacts' check (show_online_status in ('everyone','contacts','nobody')),
  notify_messages boolean not null default true,
  notify_preview boolean not null default true,
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;
alter table public.user_preferences enable row level security;
create policy "own prefs select" on public.user_preferences for select to authenticated using (user_id = auth.uid());
create policy "own prefs insert" on public.user_preferences for insert to authenticated with check (user_id = auth.uid());
create policy "own prefs update" on public.user_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Server-side validation of the bottom navigation (mirrors src/lib/navigation.ts)
create or replace function public.validate_nav_tabs()
returns trigger language plpgsql set search_path = public as $$
declare n int; bad int;
begin
  if jsonb_typeof(new.nav_tabs) <> 'array' then raise exception 'nav_tabs must be an array'; end if;
  n := jsonb_array_length(new.nav_tabs);
  if n < 1 or n > 5 then raise exception 'nav_tabs must contain 1-5 items'; end if;
  if not new.nav_tabs ? 'settings' then raise exception 'nav_tabs must contain settings'; end if;
  select count(*) into bad from jsonb_array_elements_text(new.nav_tabs) v
    where v not in ('chats','contacts','calls','channels','groups','settings','profile');
  if bad > 0 then raise exception 'nav_tabs contains unknown section'; end if;
  if (select count(distinct v) from jsonb_array_elements_text(new.nav_tabs) v) <> n then raise exception 'nav_tabs has duplicates'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_validate_nav before insert or update on public.user_preferences for each row execute function public.validate_nav_tabs();

-- ============ SIGNUP TRIGGER ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare wanted text; final text;
begin
  wanted := lower(coalesce(new.raw_user_meta_data->>'username', ''));
  if wanted ~ '^[a-z0-9_]{5,32}$' and not exists (select 1 from public.profiles where lower(username) = wanted) then
    final := wanted;
  else
    final := 'user_' || substr(replace(new.id::text,'-',''), 1, 10);
  end if;
  insert into public.profiles (id, username, display_name)
  values (new.id, final, left(coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', ''), 64));
  insert into public.user_preferences (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$ begin new.updated_at := now(); return new; end $$;
create trigger trg_profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- ============ BLOCKS & CONTACTS ============
create table public.blocks (
  blocker_id uuid not null,
  blocked_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
grant select, insert, delete on public.blocks to authenticated;
grant all on public.blocks to service_role;
alter table public.blocks enable row level security;
create policy "own blocks select" on public.blocks for select to authenticated using (blocker_id = auth.uid());
create policy "own blocks insert" on public.blocks for insert to authenticated with check (blocker_id = auth.uid());
create policy "own blocks delete" on public.blocks for delete to authenticated using (blocker_id = auth.uid());

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

create table public.contacts (
  owner_id uuid not null,
  contact_id uuid not null references public.profiles(id) on delete cascade,
  nickname text check (char_length(nickname) <= 64),
  created_at timestamptz not null default now(),
  primary key (owner_id, contact_id),
  check (owner_id <> contact_id)
);
grant select, insert, update, delete on public.contacts to authenticated;
grant all on public.contacts to service_role;
alter table public.contacts enable row level security;
create policy "own contacts" on public.contacts for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ============ CONVERSATIONS ============
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.conversation_kind not null,
  title text check (char_length(title) <= 100),
  description text check (char_length(description) <= 500),
  avatar_url text,
  is_public boolean not null default false,
  public_handle text,
  created_by uuid not null,
  is_restricted boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  check (public_handle is null or public_handle ~ '^[a-z0-9_]{5,32}$')
);
create unique index conversations_handle_unique on public.conversations (lower(public_handle)) where public_handle is not null;
create index conversations_last_msg on public.conversations (last_message_at desc);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null,
  role public.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  muted boolean not null default false,
  archived boolean not null default false,
  pinned boolean not null default false,
  draft text check (char_length(draft) <= 4000),
  primary key (conversation_id, user_id)
);
create index conv_members_user on public.conversation_members (user_id);

create or replace function public.is_member(_conv uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members where conversation_id = _conv and user_id = _user)
$$;
create or replace function public.member_role_of(_conv uuid, _user uuid)
returns public.member_role language sql stable security definer set search_path = public as $$
  select role from public.conversation_members where conversation_id = _conv and user_id = _user
$$;

grant select on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;
create policy "members or public can read conversation" on public.conversations for select to authenticated
  using (public.is_member(id, auth.uid()) or (is_public and kind in ('group','channel')));
create policy "conv admins update" on public.conversations for update to authenticated
  using (public.member_role_of(id, auth.uid()) in ('owner','admin'))
  with check (public.member_role_of(id, auth.uid()) in ('owner','admin'));
grant update (title, description, avatar_url, is_public, public_handle) on public.conversations to authenticated;

grant select, update on public.conversation_members to authenticated;
grant all on public.conversation_members to service_role;
alter table public.conversation_members enable row level security;
create policy "members see co-members" on public.conversation_members for select to authenticated
  using (public.is_member(conversation_id, auth.uid()));
create policy "member updates own row" on public.conversation_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Members may change only their personal flags, never their role:
revoke update on public.conversation_members from authenticated;
grant update (last_read_at, muted, archived, pinned, draft) on public.conversation_members to authenticated;

-- Group / channel metadata (membership lives in conversation_members for all kinds)
create table public.groups (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  members_can_invite boolean not null default true,
  members_can_pin boolean not null default false,
  max_members int not null default 1000 check (max_members between 2 and 200000)
);
create table public.channels (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  comments_enabled boolean not null default false,
  posting_restricted boolean not null default false
);
grant select on public.groups, public.channels to authenticated;
grant all on public.groups, public.channels to service_role;
alter table public.groups enable row level security;
alter table public.channels enable row level security;
create policy "read group meta" on public.groups for select to authenticated using (
  exists (select 1 from public.conversations c where c.id = conversation_id and (c.is_public or public.is_member(c.id, auth.uid()))));
create policy "read channel meta" on public.channels for select to authenticated using (
  exists (select 1 from public.conversations c where c.id = conversation_id and (c.is_public or public.is_member(c.id, auth.uid()))));

-- Compatibility views named as in the spec
create view public.group_members with (security_invoker = true) as
  select m.* from public.conversation_members m join public.conversations c on c.id = m.conversation_id where c.kind = 'group';
create view public.channel_members with (security_invoker = true) as
  select m.* from public.conversation_members m join public.conversations c on c.id = m.conversation_id where c.kind = 'channel';
grant select on public.group_members, public.channel_members to authenticated;

-- ============ MESSAGES ============
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null,
  client_id text not null,
  body text check (char_length(body) <= 4000),
  reply_to_id uuid references public.messages(id) on delete set null,
  forwarded_from_id uuid references public.messages(id) on delete set null,
  is_pinned boolean not null default false,
  edited_at timestamptz,
  deleted_at timestamptz,
  expires_at timestamptz,
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  unique (sender_id, client_id)
);
create index messages_conv_created on public.messages (conversation_id, created_at desc);
grant select, insert on public.messages to authenticated;
grant update (body, edited_at, deleted_at, is_pinned) on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create policy "members read messages" on public.messages for select to authenticated using (
  public.is_member(conversation_id, auth.uid())
  and (scheduled_for is null or scheduled_for <= now() or sender_id = auth.uid())
  and (expires_at is null or expires_at > now()));
create policy "members send messages" on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and public.is_member(conversation_id, auth.uid())
  and not exists (select 1 from public.conversations c where c.id = conversation_id and c.is_restricted)
  and (
    (select kind from public.conversations where id = conversation_id) <> 'channel'
    or public.member_role_of(conversation_id, auth.uid()) in ('owner','admin')
  )
  and not exists (
    select 1 from public.conversation_members o, public.conversations c
    where c.id = conversation_id and c.kind = 'direct' and o.conversation_id = c.id and o.user_id <> auth.uid()
      and public.is_blocked_between(auth.uid(), o.user_id)));
create policy "sender edits own" on public.messages for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- Rate limit: max 30 messages per minute per user (server-side)
create or replace function public.messages_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.messages where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'rate_limited: too many messages, try again shortly';
  end if;
  update public.conversations set last_message_at = coalesce(new.scheduled_for, new.created_at) where id = new.conversation_id;
  return new;
end $$;
create trigger trg_messages_rate before insert on public.messages for each row execute function public.messages_rate_limit();

create table public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (message_id, user_id)
);
grant select, insert, update on public.message_receipts to authenticated;
grant all on public.message_receipts to service_role;
alter table public.message_receipts enable row level security;
create policy "receipt visible to recipient and sender" on public.message_receipts for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.messages m where m.id = message_id and m.sender_id = auth.uid()));
create policy "recipient writes own receipt" on public.message_receipts for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id, auth.uid()) and m.sender_id <> auth.uid()));
create policy "recipient updates own receipt" on public.message_receipts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null,
  emoji text not null check (char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
grant select, insert, delete on public.message_reactions to authenticated;
grant all on public.message_reactions to service_role;
alter table public.message_reactions enable row level security;
create policy "members read reactions" on public.message_reactions for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id, auth.uid())));
create policy "members react" on public.message_reactions for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id, auth.uid())));
create policy "remove own reaction" on public.message_reactions for delete to authenticated using (user_id = auth.uid());

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  uploader_id uuid not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  kind text not null check (kind in ('image','video','document','voice')),
  duration_ms int,
  created_at timestamptz not null default now()
);
grant select, insert on public.attachments to authenticated;
grant all on public.attachments to service_role;
alter table public.attachments enable row level security;
create policy "members read attachments" on public.attachments for select to authenticated using (public.is_member(conversation_id, auth.uid()));
create policy "members upload attachments" on public.attachments for insert to authenticated with check (uploader_id = auth.uid() and public.is_member(conversation_id, auth.uid()));

-- ============ CALLS ============
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null,
  callee_id uuid not null,
  media text not null check (media in ('audio','video')),
  status text not null default 'ringing' check (status in ('ringing','connected','ended','missed','declined','failed')),
  started_at timestamptz not null default now(),
  connected_at timestamptz,
  ended_at timestamptz
);
create index calls_participants on public.calls (caller_id, callee_id, started_at desc);
grant select, insert, update on public.calls to authenticated;
grant all on public.calls to service_role;
alter table public.calls enable row level security;
create policy "participants read calls" on public.calls for select to authenticated using (auth.uid() in (caller_id, callee_id));
create policy "caller creates call" on public.calls for insert to authenticated with check (caller_id = auth.uid() and public.is_member(conversation_id, auth.uid()) and public.is_member(conversation_id, callee_id) and not public.is_blocked_between(caller_id, callee_id));
create policy "participants update call" on public.calls for update to authenticated using (auth.uid() in (caller_id, callee_id)) with check (auth.uid() in (caller_id, callee_id));

-- ============ NOTIFICATIONS ============
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('message','invite','call','system','moderation','support')),
  title text not null check (char_length(title) <= 120),
  body text check (char_length(body) <= 500),
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on public.notifications (user_id, created_at desc);
grant select, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;
alter table public.notifications enable row level security;
create policy "own notifications read" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "own notifications mark read" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notifications delete" on public.notifications for delete to authenticated using (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ============ REPORTS / MODERATION ============
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null,
  target_user_id uuid,
  target_conversation_id uuid references public.conversations(id) on delete set null,
  target_message_id uuid references public.messages(id) on delete set null,
  category text not null check (category in ('spam','abuse','harassment','illegal','impersonation','other')),
  details text check (char_length(details) <= 2000),
  status public.report_status not null default 'open',
  priority smallint not null default 2 check (priority between 1 and 4),
  assigned_to uuid,
  resolution text check (char_length(resolution) <= 2000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (target_user_id is not null or target_conversation_id is not null or target_message_id is not null)
);
create index reports_status on public.reports (status, priority, created_at);
grant select, insert on public.reports to authenticated;
grant all on public.reports to service_role;
alter table public.reports enable row level security;
create policy "reporter reads own" on public.reports for select to authenticated using (
  reporter_id = auth.uid() or public.has_role(auth.uid(),'moderator') or public.is_admin(auth.uid()));
create policy "users file reports" on public.reports for insert to authenticated with check (reporter_id = auth.uid() and status = 'open' and assigned_to is null);

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  target_user_id uuid,
  target_conversation_id uuid references public.conversations(id) on delete set null,
  report_id uuid references public.reports(id) on delete set null,
  action text not null check (action in ('warn','suspend','ban','unban','restrict_conversation','unrestrict_conversation','remove_message')),
  reason text not null check (char_length(reason) between 3 and 1000),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.moderation_actions to authenticated;
grant all on public.moderation_actions to service_role;
alter table public.moderation_actions enable row level security;
create policy "staff and subject read sanctions" on public.moderation_actions for select to authenticated using (
  target_user_id = auth.uid() or public.has_role(auth.uid(),'moderator') or public.is_admin(auth.uid()));

-- ============ SUPPORT ============
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category text not null check (category in ('account','bug','abuse','billing','other')),
  subject text not null check (char_length(subject) between 3 and 150),
  body text not null check (char_length(body) between 1 and 4000),
  status public.ticket_status not null default 'open',
  priority smallint not null default 2 check (priority between 1 and 4),
  assigned_to uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert on public.support_tickets to authenticated;
grant all on public.support_tickets to service_role;
alter table public.support_tickets enable row level security;
create policy "owner or support read tickets" on public.support_tickets for select to authenticated using (
  user_id = auth.uid() or public.has_role(auth.uid(),'support') or public.is_admin(auth.uid()));
create policy "users open tickets" on public.support_tickets for insert to authenticated with check (user_id = auth.uid() and status = 'open' and assigned_to is null);

-- ============ AUDIT (append-only) ============
create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  reason text,
  result text not null default 'success',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_created on public.admin_audit_logs (created_at desc);
grant select on public.admin_audit_logs to authenticated;
grant select, insert on public.admin_audit_logs to service_role;
alter table public.admin_audit_logs enable row level security;
create policy "admins read audit" on public.admin_audit_logs for select to authenticated using (
  public.has_role(auth.uid(),'owner') or public.has_role(auth.uid(),'super_admin') or public.has_role(auth.uid(),'admin'));
create or replace function public.audit_immutable()
returns trigger language plpgsql as $$ begin raise exception 'audit log is append-only'; end $$;
create trigger trg_audit_immutable before update or delete on public.admin_audit_logs for each row execute function public.audit_immutable();

-- ============ PLATFORM SETTINGS ============
create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
grant select on public.platform_settings to authenticated, anon;
grant all on public.platform_settings to service_role;
alter table public.platform_settings enable row level security;
create policy "settings readable" on public.platform_settings for select to anon, authenticated using (true);
insert into public.platform_settings (key, value) values
  ('platform_name', '"VexChat"'),
  ('registration_open', 'true'),
  ('maintenance_mode', 'false'),
  ('max_upload_mb', '50'),
  ('messages_per_minute', '30');

-- ============ RPC: start or reuse a direct chat ============
create or replace function public.get_or_create_direct(_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if _other = me then raise exception 'cannot chat with yourself'; end if;
  if not exists (select 1 from public.profiles where id = _other) then raise exception 'user not found'; end if;
  if public.is_blocked_between(me, _other) then raise exception 'blocked'; end if;
  select c.id into conv from public.conversations c
    join public.conversation_members a on a.conversation_id = c.id and a.user_id = me
    join public.conversation_members b on b.conversation_id = c.id and b.user_id = _other
    where c.kind = 'direct' limit 1;
  if conv is not null then return conv; end if;
  insert into public.conversations (kind, created_by) values ('direct', me) returning id into conv;
  insert into public.conversation_members (conversation_id, user_id, role) values (conv, me, 'member'), (conv, _other, 'member');
  return conv;
end $$;
revoke execute on function public.get_or_create_direct(uuid) from public, anon;
grant execute on function public.get_or_create_direct(uuid) to authenticated;

-- ============ REALTIME ============
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_receipts;
alter publication supabase_realtime add table public.conversation_members;
alter publication supabase_realtime add table public.notifications;
