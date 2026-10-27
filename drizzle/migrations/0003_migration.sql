-- =====================================================================
-- VexChat · миграция 0003 — доработка backend (этапы 4–12)
--
-- Что делает:
--   1. Чинит дыры в старой схеме (права на profiles, закрепление/удаление
--      сообщений, звонки, закрытая регистрация, режим обслуживания).
--   2. Добавляет таблицы: права ролей, блокировки аккаунтов, инвайты, просмотры
--      каналов, история поиска, жалобы/апелляции, тикеты поддержки, объявления,
--      сигналы звонков, журнал спама и ошибок, записи о бэкапах.
--   3. Добавляет RPC-функции для чатов, групп, каналов, поиска, звонков,
--      модерации и админ-панели. Все права проверяются НА СЕРВЕРЕ (в БД).
--   4. Настраивает хранилище, Realtime-авторизацию и (если доступен) pg_cron.
--
-- Запускать один раз, после 0000–0002. Файл рассчитан на повторный запуск
-- везде, где это возможно, но проверяйте результат в SQL-редакторе.
-- =====================================================================

-- ---------- 0. Новые настройки платформы ----------
insert into public.platform_settings (key, value) values
  ('groups_per_day', '10'),
  ('invites_per_hour', '50'),
  ('reports_per_hour', '10'),
  ('max_message_length', '4000'),
  ('maintenance_message', '""'),
  ('group_creation_enabled', 'true'),
  ('public_channels_enabled', 'true'),
  ('logo_url', '""'),
  ('acceptable_use', '""')
on conflict (key) do nothing;

-- ---------- 1. Новые колонки в существующих таблицах ----------
alter table public.user_preferences
  add column if not exists who_can_message text not null default 'everyone' check (who_can_message in ('everyone','contacts')),
  add column if not exists read_receipts boolean not null default true,
  add column if not exists notify_invites boolean not null default true,
  add column if not exists notify_calls boolean not null default true,
  add column if not exists enter_sends boolean not null default true;

alter table public.messages
  add column if not exists mentions uuid[] not null default '{}',
  add column if not exists thread_root_id uuid references public.messages(id) on delete cascade,
  add column if not exists notified_at timestamptz;

alter table public.conversations
  add column if not exists ttl_seconds int check (ttl_seconds is null or ttl_seconds between 5 and 31536000);

alter table public.conversation_members
  add column if not exists invited_by uuid;

alter table public.support_tickets
  add column if not exists report_id uuid references public.reports(id) on delete set null;

do $$ begin
  alter table public.conversations add constraint public_only_group_channel check (not is_public or kind in ('group','channel'));
exception when duplicate_object then null; end $$;

-- ---------- 2. Индексы ----------
create index if not exists messages_sender_created on public.messages (sender_id, created_at desc);
create index if not exists messages_created_at on public.messages (created_at);
create index if not exists messages_thread on public.messages (thread_root_id) where thread_root_id is not null;
create index if not exists messages_pinned on public.messages (conversation_id) where is_pinned;
create index if not exists messages_due on public.messages (scheduled_for) where scheduled_for is not null and notified_at is null;
create index if not exists calls_started on public.calls (started_at desc);
create index if not exists calls_callee on public.calls (callee_id, started_at desc);
create index if not exists notifications_unread on public.notifications (user_id) where read_at is null;
create index if not exists reports_target_user on public.reports (target_user_id) where target_user_id is not null;
create index if not exists profiles_created on public.profiles (created_at);
create index if not exists attachments_message on public.attachments (message_id);
create index if not exists audit_actor on public.admin_audit_logs (actor_id, created_at desc);
create index if not exists moderation_target on public.moderation_actions (target_user_id, created_at desc);
create index if not exists conversations_public on public.conversations (kind) where is_public;
create index if not exists conv_members_invited on public.conversation_members (invited_by, joined_at) where invited_by is not null;

-- ---------- 3. Внешние ключи на profiles (каскадное удаление данных аккаунта) ----------
-- messages.sender_id и reports.reporter_id намеренно БЕЗ ключа: история переписки
-- и жалобы должны переживать удаление аккаунта.
do $$
declare x record;
begin
  for x in select * from (values
    ('user_preferences','user_id'), ('contacts','owner_id'), ('blocks','blocker_id'), ('blocks','blocked_id'),
    ('conversation_members','user_id'), ('notifications','user_id'), ('message_receipts','user_id'),
    ('message_reactions','user_id'), ('support_tickets','user_id'), ('calls','caller_id'), ('calls','callee_id')
  ) v(t, c) loop
    begin
      execute format('alter table public.%I add constraint %I foreign key (%I) references public.profiles(id) on delete cascade not valid',
                     x.t, x.t || '_' || x.c || '_fk', x.c);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- 4. Права профиля: пользователь меняет только свои публичные поля ----------
revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_url, bio, status_text) on public.profiles to authenticated;

-- ---------- 5. Матрица полномочий ролей ----------
create table if not exists public.role_permissions (
  role public.app_role not null,
  permission text not null,
  primary key (role, permission)
);
grant select on public.role_permissions to authenticated;
grant all on public.role_permissions to service_role;
alter table public.role_permissions enable row level security;
drop policy if exists "staff read permission matrix" on public.role_permissions;
drop policy if exists "staff read permission matrix" on public.role_permissions;
create policy "staff read permission matrix" on public.role_permissions for select to authenticated using (public.is_staff(auth.uid()));

insert into public.role_permissions (role, permission)
select r.role::public.app_role, p
from (values
  ('owner', array['users.view','users.suspend','users.ban','users.roles','users.delete','reports.view','reports.content','reports.resolve','appeals.decide','content.remove','groups.moderate','analytics.view','export.run','settings.view','settings.edit','settings.dangerous','audit.view','support.handle','announcements.manage','backups.view','backups.manage','health.view']),
  ('super_admin', array['users.view','users.suspend','users.ban','users.roles','users.delete','reports.view','reports.content','reports.resolve','appeals.decide','content.remove','groups.moderate','analytics.view','export.run','settings.view','settings.edit','settings.dangerous','audit.view','support.handle','announcements.manage','backups.view','backups.manage','health.view']),
  ('admin', array['users.view','users.suspend','users.ban','users.roles','reports.view','reports.content','reports.resolve','appeals.decide','content.remove','groups.moderate','analytics.view','export.run','settings.view','settings.edit','audit.view','support.handle','announcements.manage','backups.view','health.view']),
  ('moderator', array['users.view','users.suspend','reports.view','reports.content','reports.resolve','appeals.decide','content.remove','groups.moderate']),
  ('support', array['users.view','reports.view','support.handle']),
  ('analyst', array['analytics.view','export.run','health.view'])
) r(role, perms), unnest(r.perms) p
on conflict do nothing;

-- ---------- 6. Состояние аккаунта (блокировки) ----------
create table if not exists public.account_status (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  banned_at timestamptz,
  suspended_until timestamptz,
  reason text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
grant select on public.account_status to authenticated;
grant all on public.account_status to service_role;
alter table public.account_status enable row level security;

-- ---------- 7. Вспомогательные функции ----------
create or replace function public.setting_int(_key text, _default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.platform_settings where key = _key), _default)
$$;

create or replace function public.setting_bool(_key text, _default boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from public.platform_settings where key = _key), _default)
$$;

create or replace function public.like_escape(_s text) returns text
language sql immutable as $$
  select replace(replace(replace(coalesce(_s, ''), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_')
$$;

create or replace function public.has_permission(_uid uuid, _perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur join public.role_permissions rp on rp.role = ur.role
    where ur.user_id = _uid and rp.permission = _perm)
$$;

create or replace function public.role_rank(_role public.app_role) returns int
language sql immutable as $$
  select case _role when 'owner' then 6 when 'super_admin' then 5 when 'admin' then 4
                    when 'moderator' then 3 when 'support' then 2 when 'analyst' then 1 else 0 end
$$;

create or replace function public.max_rank(_uid uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(max(public.role_rank(role)), 0) from public.user_roles where user_id = _uid
$$;

create or replace function public.is_banned(_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.account_status where user_id = _uid and banned_at is not null)
$$;

-- «ограничен» = забанен ИЛИ временно заблокирован (писать/создавать/звонить нельзя)
create or replace function public.is_account_restricted(_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.account_status
                 where user_id = _uid and (banned_at is not null or suspended_until > now()))
$$;

create or replace function public.require_permission(_perm text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission(auth.uid(), _perm) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function public.write_audit(_action text, _target_type text, _target_id text, _reason text, _result text, _meta jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, reason, result, metadata)
  values (auth.uid(), _action, _target_type, _target_id, left(_reason, 1000), coalesce(_result, 'success'), coalesce(_meta, '{}'::jsonb));
end $$;

create or replace function public.push_notification(_uid uuid, _kind text, _title text, _body text, _link text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean := true;
begin
  if _kind = 'invite' then
    select coalesce(notify_invites, true) into v_ok from public.user_preferences where user_id = _uid;
  elsif _kind = 'call' then
    select coalesce(notify_calls, true) into v_ok from public.user_preferences where user_id = _uid;
  end if;
  if coalesce(v_ok, true) then
    insert into public.notifications (user_id, kind, title, body, link)
    values (_uid, _kind, left(_title, 120), left(_body, 500), _link);
  end if;
end $$;

-- ---------- 8. Политики, зависящие от новых функций ----------
drop policy if exists "own status or staff" on public.account_status;
drop policy if exists "own status or staff" on public.account_status;
create policy "own status or staff" on public.account_status for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(), 'users.view'));

-- журнал аудита: только append-only, читают роли с правом audit.view
drop policy if exists "admins read audit" on public.admin_audit_logs;
drop policy if exists "staff read audit" on public.admin_audit_logs;
create policy "staff read audit" on public.admin_audit_logs for select to authenticated
  using (public.has_permission(auth.uid(), 'audit.view'));
drop trigger if exists trg_audit_no_truncate on public.admin_audit_logs;
create trigger trg_audit_no_truncate before truncate on public.admin_audit_logs
  for each statement execute function public.audit_immutable();

drop policy if exists "reporter reads own" on public.reports;
drop policy if exists "reporter or staff reads reports" on public.reports;
create policy "reporter or staff reads reports" on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.has_permission(auth.uid(), 'reports.view'));

drop policy if exists "staff and subject read sanctions" on public.moderation_actions;
drop policy if exists "subject or staff read sanctions" on public.moderation_actions;
create policy "subject or staff read sanctions" on public.moderation_actions for select to authenticated
  using (target_user_id = auth.uid() or public.has_permission(auth.uid(), 'reports.view'));

drop policy if exists "owner or support read tickets" on public.support_tickets;
drop policy if exists "owner or support read tickets" on public.support_tickets;
create policy "owner or support read tickets" on public.support_tickets for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(), 'support.handle'));

-- ---------- 9. Новые таблицы ----------
-- Инвайт-ссылки (создание/отзыв/вход — только через RPC)
create table if not exists public.invite_links (
  token text primary key default replace(gen_random_uuid()::text, '-', ''),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses int check (max_uses is null or max_uses > 0),
  uses int not null default 0,
  revoked_at timestamptz
);
create index if not exists invite_links_conv on public.invite_links (conversation_id);
grant select on public.invite_links to authenticated;
grant all on public.invite_links to service_role;
alter table public.invite_links enable row level security;
drop policy if exists "conv admins read invites" on public.invite_links;
create policy "conv admins read invites" on public.invite_links for select to authenticated
  using (public.member_role_of(conversation_id, auth.uid()) in ('owner','admin'));

-- Просмотры публикаций канала
create table if not exists public.message_views (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
grant all on public.message_views to service_role;
alter table public.message_views enable row level security;
-- (клиентского доступа нет: пишет mark_conversation_read, читает channel_stats)

-- История поиска
create table if not exists public.search_history (
  user_id uuid not null references public.profiles(id) on delete cascade,
  query text not null check (char_length(query) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key (user_id, query)
);
grant select, insert, update, delete on public.search_history to authenticated;
grant all on public.search_history to service_role;
alter table public.search_history enable row level security;
drop policy if exists "own search history" on public.search_history;
create policy "own search history" on public.search_history for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.trim_search_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.search_history
  where user_id = new.user_id
    and query in (select query from public.search_history where user_id = new.user_id order by created_at desc offset 20);
  return new;
end $$;
drop trigger if exists trg_trim_search_history on public.search_history;
create trigger trg_trim_search_history after insert or update on public.search_history
  for each row execute function public.trim_search_history();

-- Журнал срабатываний антиспама
create table if not exists public.spam_events (
  id bigint generated always as identity primary key,
  user_id uuid,
  kind text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists spam_events_created on public.spam_events (created_at desc);
grant select on public.spam_events to authenticated;
grant all on public.spam_events to service_role;
alter table public.spam_events enable row level security;
drop policy if exists "staff read spam events" on public.spam_events;
create policy "staff read spam events" on public.spam_events for select to authenticated
  using (public.has_permission(auth.uid(), 'audit.view'));

-- Комментарии сотрудников к жалобам
create table if not exists public.report_comments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  author_id uuid not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists report_comments_report on public.report_comments (report_id, created_at);
grant select on public.report_comments to authenticated;
grant all on public.report_comments to service_role;
alter table public.report_comments enable row level security;
drop policy if exists "staff read report comments" on public.report_comments;
create policy "staff read report comments" on public.report_comments for select to authenticated
  using (public.has_permission(auth.uid(), 'reports.view'));

-- Апелляции на санкции
create table if not exists public.appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  action_id uuid not null references public.moderation_actions(id) on delete cascade,
  body text not null check (char_length(body) between 10 and 2000),
  status text not null default 'open' check (status in ('open','accepted','rejected')),
  decided_by uuid,
  decision text check (char_length(decision) <= 2000),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (action_id, user_id)
);
grant select on public.appeals to authenticated;
grant all on public.appeals to service_role;
alter table public.appeals enable row level security;
drop policy if exists "own appeals or staff" on public.appeals;
create policy "own appeals or staff" on public.appeals for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(), 'appeals.decide'));

-- Переписка в тикетах поддержки
create table if not exists public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null,
  body text not null check (char_length(body) between 1 and 4000),
  is_staff boolean not null default false,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ticket_messages_ticket on public.ticket_messages (ticket_id, created_at);
grant select on public.ticket_messages to authenticated;
grant all on public.ticket_messages to service_role;
alter table public.ticket_messages enable row level security;
drop policy if exists "ticket thread visible" on public.ticket_messages;
create policy "ticket thread visible" on public.ticket_messages for select to authenticated using (
  public.has_permission(auth.uid(), 'support.handle')
  or (not internal and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid())));

-- Системные объявления (публикация по расписанию работает «лениво»: видно, когда publish_at <= now())
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  audience text not null default 'all' check (audience in ('all','staff')),
  severity text not null default 'info' check (severity in ('info','warning','maintenance')),
  status text not null default 'draft' check (status in ('draft','published','revoked')),
  publish_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.announcements to authenticated;
grant all on public.announcements to service_role;
alter table public.announcements enable row level security;
drop policy if exists "announcements visible" on public.announcements;
create policy "announcements visible" on public.announcements for select to authenticated using (
  public.has_permission(auth.uid(), 'announcements.manage')
  or (status = 'published' and publish_at <= now() and (audience = 'all' or public.is_staff(auth.uid()))));

-- Ручные записи о проверках резервных копий (автоматически статус бэкапов из БД получить нельзя)
create table if not exists public.backup_records (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('backup_check','restore_test')),
  ok boolean not null,
  note text check (char_length(note) <= 1000),
  recorded_by uuid not null,
  recorded_at timestamptz not null default now()
);
grant select on public.backup_records to authenticated;
grant all on public.backup_records to service_role;
alter table public.backup_records enable row level security;
drop policy if exists "staff read backup records" on public.backup_records;
create policy "staff read backup records" on public.backup_records for select to authenticated
  using (public.has_permission(auth.uid(), 'backups.view'));

-- Ошибки серверных функций (пишет только сервер через service_role)
create table if not exists public.error_events (
  id bigint generated always as identity primary key,
  source text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists error_events_created on public.error_events (created_at desc);
grant select on public.error_events to authenticated;
grant all on public.error_events to service_role;
alter table public.error_events enable row level security;
drop policy if exists "staff read error events" on public.error_events;
create policy "staff read error events" on public.error_events for select to authenticated
  using (public.has_permission(auth.uid(), 'health.view'));

-- Запросы на удаление аккаунта
create table if not exists public.deletion_requests (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','processed','cancelled')),
  processed_by uuid,
  processed_at timestamptz,
  note text check (char_length(note) <= 500)
);
grant select on public.deletion_requests to authenticated;
grant all on public.deletion_requests to service_role;
alter table public.deletion_requests enable row level security;
drop policy if exists "own or staff deletion request" on public.deletion_requests;
create policy "own or staff deletion request" on public.deletion_requests for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(), 'users.view'));

-- Сигнализация WebRTC (offer/answer/ice/hangup). Доставляется через Realtime Postgres Changes.
create table if not exists public.call_signals (
  id bigint generated always as identity primary key,
  call_id uuid not null references public.calls(id) on delete cascade,
  from_user uuid not null,
  to_user uuid not null,
  kind text not null check (kind in ('offer','answer','ice','hangup')),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) < 16384),
  created_at timestamptz not null default now()
);
create index if not exists call_signals_call on public.call_signals (call_id, id);
create index if not exists call_signals_to on public.call_signals (to_user, id);
grant select, insert on public.call_signals to authenticated;
grant all on public.call_signals to service_role;
alter table public.call_signals enable row level security;
drop policy if exists "receiver reads signals" on public.call_signals;
create policy "receiver reads signals" on public.call_signals for select to authenticated
  using (to_user = auth.uid());
drop policy if exists "participant sends signals" on public.call_signals;
create policy "participant sends signals" on public.call_signals for insert to authenticated with check (
  from_user = auth.uid()
  and exists (select 1 from public.calls c
              where c.id = call_id and c.status in ('ringing','connected')
                and ((c.caller_id = from_user and c.callee_id = to_user) or (c.callee_id = from_user and c.caller_id = to_user))));

-- ---------- 10. Права на мета-таблицы групп и каналов ----------
grant update (members_can_invite, members_can_pin, max_members) on public.groups to authenticated;
grant update (comments_enabled, posting_restricted) on public.channels to authenticated;
drop policy if exists "admins update group meta" on public.groups;
drop policy if exists "admins update group meta" on public.groups;
create policy "admins update group meta" on public.groups for update to authenticated
  using (public.member_role_of(conversation_id, auth.uid()) in ('owner','admin'))
  with check (public.member_role_of(conversation_id, auth.uid()) in ('owner','admin'));
drop policy if exists "admins update channel meta" on public.channels;
drop policy if exists "admins update channel meta" on public.channels;
create policy "admins update channel meta" on public.channels for update to authenticated
  using (public.member_role_of(conversation_id, auth.uid()) in ('owner','admin'))
  with check (public.member_role_of(conversation_id, auth.uid()) in ('owner','admin'));

-- =====================================================================
-- ЧАСТЬ 2. Сообщения, чаты, группы, каналы, поиск, звонки
-- =====================================================================

-- ---------- 11. Кто может писать ----------
create or replace function public.can_post(_conv uuid, _uid uuid, _thread uuid default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_kind public.conversation_kind; v_restricted boolean; v_role public.member_role;
begin
  if _uid is null or public.is_account_restricted(_uid) then return false; end if;
  if public.setting_bool('maintenance_mode', false) and not public.is_staff(_uid) then return false; end if;
  select kind, is_restricted into v_kind, v_restricted from public.conversations where id = _conv;
  if not found or v_restricted then return false; end if;
  v_role := public.member_role_of(_conv, _uid);
  if v_role is null then return false; end if;
  if v_kind = 'channel' then
    if _thread is not null then
      return exists (select 1 from public.channels ch where ch.conversation_id = _conv and ch.comments_enabled);
    end if;
    if v_role not in ('owner','admin') then return false; end if;
  elsif v_kind = 'direct' then
    if exists (select 1 from public.conversation_members o
               where o.conversation_id = _conv and o.user_id <> _uid and public.is_blocked_between(_uid, o.user_id)) then
      return false;
    end if;
  end if;
  return true;
end $$;

drop policy if exists "members send messages" on public.messages;
drop policy if exists "members send messages" on public.messages;
create policy "members send messages" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_post(conversation_id, auth.uid(), thread_root_id));

drop policy if exists "members read messages" on public.messages;
drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages for select to authenticated using (
  public.is_member(conversation_id, auth.uid())
  and not (select public.is_banned(auth.uid()))
  and (scheduled_for is null or scheduled_for <= now() or sender_id = auth.uid())
  and (expires_at is null or expires_at > now()));

-- Закрепление теперь только через RPC pin_message (права зависят от типа чата)
revoke update (is_pinned) on public.messages from authenticated;

-- ---------- 12. Триггер ПЕРЕД вставкой сообщения ----------
-- Лимит частоты (из platform_settings), TTL «исчезающих», проверки ответов/пересылок/упоминаний.
-- ВАЖНО: при превышении лимита вставка тихо отменяется (return null) и пишется событие в spam_events.
-- Клиент увидит ответ без строки (PGRST116) и покажет «слишком часто / отклонено».
create or replace function public.messages_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lim int; v_ttl int; v_max int;
begin
  v_lim := public.setting_int('messages_per_minute', 30);
  if (select count(*) from public.messages where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= v_lim then
    insert into public.spam_events (user_id, kind, details)
    values (new.sender_id, 'message_flood', jsonb_build_object('limit', v_lim, 'conversation_id', new.conversation_id));
    return null;
  end if;

  v_max := public.setting_int('max_message_length', 4000);
  if new.body is not null and char_length(new.body) > v_max then
    raise exception 'message too long (max %)', v_max;
  end if;

  if new.reply_to_id is not null and not exists
     (select 1 from public.messages r where r.id = new.reply_to_id and r.conversation_id = new.conversation_id) then
    raise exception 'invalid reply target';
  end if;
  if new.forwarded_from_id is not null and not exists
     (select 1 from public.messages f where f.id = new.forwarded_from_id and public.is_member(f.conversation_id, new.sender_id)) then
    raise exception 'invalid forward source';
  end if;
  if new.thread_root_id is not null and not exists
     (select 1 from public.messages t where t.id = new.thread_root_id and t.conversation_id = new.conversation_id and t.thread_root_id is null) then
    raise exception 'invalid thread';
  end if;

  -- упоминания: оставляем только реальных участников чата
  new.mentions := coalesce((select array_agg(distinct m.user_id) from public.conversation_members m
                            where m.conversation_id = new.conversation_id and m.user_id = any(new.mentions)), '{}');

  select ttl_seconds into v_ttl from public.conversations where id = new.conversation_id;
  if v_ttl is not null and new.expires_at is null then
    new.expires_at := coalesce(new.scheduled_for, now()) + make_interval(secs => v_ttl);
  end if;

  -- запланированные не двигают чат вверх, пока не наступит время (см. deliver_scheduled_notifications)
  if new.scheduled_for is null and new.thread_root_id is null then
    update public.conversations set last_message_at = now() where id = new.conversation_id;
  end if;
  return new;
end $$;

-- ---------- 13. Защита от «самодельных» правок сообщений ----------
create or replace function public.messages_guard_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;  -- серверные функции не ограничиваем
  if old.deleted_at is not null then raise exception 'message deleted'; end if;
  if new.body is distinct from old.body and new.deleted_at is null then new.edited_at := now(); end if;
  if new.deleted_at is not null then new.body := null; end if;
  return new;
end $$;
drop trigger if exists trg_messages_guard_update on public.messages;
create trigger trg_messages_guard_update before update on public.messages
  for each row execute function public.messages_guard_update();

-- ---------- 14. Уведомления о сообщениях ----------
create or replace function public.notify_message(_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.messages; c public.conversations; v_sname text; r record; v_link text; v_body text; v_title text;
begin
  select * into m from public.messages where id = _id;
  if not found or m.notified_at is not null then return; end if;
  update public.messages set notified_at = now() where id = _id;
  select * into c from public.conversations where id = m.conversation_id;
  -- в каналах и «Избранном» уведомления на каждую публикацию не рассылаем
  if c.kind in ('channel', 'saved') or m.thread_root_id is not null then return; end if;
  select coalesce(nullif(display_name, ''), username) into v_sname from public.profiles where id = m.sender_id;
  v_link := '/chats/' || c.id::text;
  v_title := left(case when c.kind = 'group' then coalesce(c.title, 'Группа') || ': ' || coalesce(v_sname, '?') else coalesce(v_sname, 'Сообщение') end, 120);
  for r in
    select cm.user_id, coalesce(p.notify_messages, true) as nm, coalesce(p.notify_preview, true) as np
    from public.conversation_members cm
    left join public.user_preferences p on p.user_id = cm.user_id
    where cm.conversation_id = m.conversation_id and cm.user_id <> m.sender_id
      and (not cm.muted or cm.user_id = any(m.mentions))
      and not public.is_blocked_between(cm.user_id, m.sender_id)
    limit 500
  loop
    continue when not r.nm;
    v_body := case when r.np then left(coalesce(m.body, 'Вложение'), 140) else 'Новое сообщение' end;
    update public.notifications set title = v_title, body = v_body, created_at = now()
      where user_id = r.user_id and kind = 'message' and link = v_link and read_at is null;
    if not found then
      insert into public.notifications (user_id, kind, title, body, link) values (r.user_id, 'message', v_title, v_body, v_link);
    end if;
  end loop;
end $$;

create or replace function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.scheduled_for is not null and new.scheduled_for > now() then return new; end if;
  perform public.notify_message(new.id);
  return new;
end $$;
drop trigger if exists trg_messages_after_insert on public.messages;
create trigger trg_messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

-- Запланированные сообщения: вызывается по расписанию (pg_cron), см. конец файла
create or replace function public.deliver_scheduled_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id, conversation_id, scheduled_for from public.messages
           where scheduled_for is not null and scheduled_for <= now() and notified_at is null and deleted_at is null
           order by scheduled_for limit 500 loop
    update public.conversations set last_message_at = r.scheduled_for
      where id = r.conversation_id and (last_message_at is null or last_message_at < r.scheduled_for);
    perform public.notify_message(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.purge_expired_messages() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with d as (delete from public.messages where expires_at is not null and expires_at < now() - interval '1 hour' returning 1)
  select count(*) into n from d;
  return n;
end $$;

-- ---------- 15. Вложения: проверки ----------
create or replace function public.attachments_validate() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max bigint;
begin
  v_max := public.setting_int('max_upload_mb', 50)::bigint * 1048576;
  if new.size_bytes > v_max then raise exception 'file too large'; end if;
  if new.message_id is not null and not exists
     (select 1 from public.messages m where m.id = new.message_id and m.conversation_id = new.conversation_id and m.sender_id = new.uploader_id) then
    raise exception 'attachment does not match message';
  end if;
  if new.storage_path not like (new.conversation_id::text || '/' || new.uploader_id::text || '/%') then
    raise exception 'bad storage path';
  end if;
  if (new.kind = 'image' and new.mime_type not like 'image/%')
     or (new.kind = 'video' and new.mime_type not like 'video/%')
     or (new.kind = 'voice' and new.mime_type not like 'audio/%')
     or new.mime_type in ('application/x-msdownload','application/x-dosexec','application/x-sh','text/html','application/javascript') then
    raise exception 'file type not allowed';
  end if;
  return new;
end $$;
drop trigger if exists trg_attachments_validate on public.attachments;
create trigger trg_attachments_validate before insert on public.attachments
  for each row execute function public.attachments_validate();

grant delete on public.attachments to authenticated;
drop policy if exists "uploader deletes own attachment" on public.attachments;
drop policy if exists "uploader deletes own attachment" on public.attachments;
create policy "uploader deletes own attachment" on public.attachments for delete to authenticated
  using (uploader_id = auth.uid());

-- ---------- 16. Хранилище ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', false, 5242880) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 52428800) on conflict (id) do nothing;

drop policy if exists "attachments delete own" on storage.objects;
drop policy if exists "attachments delete own" on storage.objects;
create policy "attachments delete own" on storage.objects for delete to authenticated using (
  bucket_id = 'attachments' and (storage.foldername(name))[2] = auth.uid()::text);

-- ---------- 17. Реакции/просмотры/чтение ----------
create or replace function public.mark_conversation_read(_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_rr boolean; v_kind public.conversation_kind;
begin
  if v_me is null or not public.is_member(_conv, v_me) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.conversation_members set last_read_at = now() where conversation_id = _conv and user_id = v_me;
  select kind into v_kind from public.conversations where id = _conv;
  if v_kind = 'channel' then
    insert into public.message_views (message_id, user_id)
    select m.id, v_me from public.messages m
    where m.conversation_id = _conv and m.thread_root_id is null and m.deleted_at is null
      and (m.scheduled_for is null or m.scheduled_for <= now()) and m.created_at > now() - interval '30 days'
    on conflict do nothing;
  elsif v_kind in ('direct', 'group') then
    select coalesce(read_receipts, true) into v_rr from public.user_preferences where user_id = v_me;
    v_rr := coalesce(v_rr, true);
    insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
    select m.id, v_me, now(), case when v_rr then now() else null end
    from public.messages m
    where m.conversation_id = _conv and m.sender_id <> v_me and m.deleted_at is null
      and (m.scheduled_for is null or m.scheduled_for <= now()) and m.created_at > now() - interval '30 days'
    on conflict (message_id, user_id) do update
      set read_at = case when v_rr then coalesce(public.message_receipts.read_at, now()) else public.message_receipts.read_at end;
  end if;
end $$;

-- «Доставлено» ставится, когда КЛИЕНТ получателя реально получил сообщение
create or replace function public.mark_delivered(_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  insert into public.message_receipts (message_id, user_id)
  select m.id, v_me from public.messages m join public.conversations c on c.id = m.conversation_id
  where m.id = any(_ids[1:200]) and m.sender_id <> v_me and c.kind in ('direct', 'group')
    and public.is_member(m.conversation_id, v_me)
  on conflict do nothing;
end $$;

-- ---------- 18. Список чатов ----------
create or replace function public.my_conversations()
returns table (
  conversation_id uuid, kind public.conversation_kind, title text, avatar_url text, is_public boolean,
  other_user_id uuid, other_username text, other_display_name text, other_avatar_url text,
  last_body text, last_sender_id uuid, last_at timestamptz, last_deleted boolean, unread_count int,
  muted boolean, archived boolean, pinned boolean, draft text, my_role public.member_role,
  ttl_seconds int, is_restricted boolean
) language sql stable set search_path = public as $$
  select c.id, c.kind, c.title, c.avatar_url, c.is_public,
         o.user_id, op.username, op.display_name, op.avatar_url,
         lm.body, lm.sender_id, coalesce(lm.created_at, c.created_at), coalesce(lm.deleted_at is not null, false),
         coalesce(u.cnt, 0)::int,
         mem.muted, mem.archived, mem.pinned, mem.draft, mem.role, c.ttl_seconds, c.is_restricted
  from public.conversation_members mem
  join public.conversations c on c.id = mem.conversation_id
  left join lateral (select cm.user_id from public.conversation_members cm
                     where cm.conversation_id = c.id and cm.user_id <> mem.user_id limit 1) o on c.kind = 'direct'
  left join public.profiles op on op.id = o.user_id
  left join lateral (select m.body, m.sender_id, m.created_at, m.deleted_at from public.messages m
                     where m.conversation_id = c.id and m.thread_root_id is null
                     order by m.created_at desc limit 1) lm on true
  left join lateral (select count(*) as cnt from public.messages m
                     where m.conversation_id = c.id and m.sender_id <> mem.user_id and m.thread_root_id is null
                       and m.deleted_at is null and m.created_at > coalesce(mem.last_read_at, '-infinity'::timestamptz)) u on true
  where mem.user_id = auth.uid()
  order by mem.pinned desc, coalesce(lm.created_at, c.created_at) desc
$$;

create or replace function public.conversation_members_detail(_conv uuid)
returns table (user_id uuid, role public.member_role, joined_at timestamptz, username text, display_name text, avatar_url text)
language sql stable set search_path = public as $$
  select m.user_id, m.role, m.joined_at, p.username, p.display_name, p.avatar_url
  from public.conversation_members m left join public.profiles p on p.id = m.user_id
  where m.conversation_id = _conv
  order by (m.role = 'owner') desc, (m.role = 'admin') desc, p.username
  limit 500
$$;

-- ---------- 19. Личные чаты: правила приватности ----------
create or replace function public.get_or_create_direct(_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_conv uuid; v_pref text;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if _other = v_me then raise exception 'cannot chat with yourself'; end if;
  if public.is_account_restricted(v_me) then raise exception 'account_restricted'; end if;
  if not exists (select 1 from public.profiles where id = _other) then raise exception 'user not found'; end if;
  if public.is_blocked_between(v_me, _other) then raise exception 'blocked'; end if;
  select c.id into v_conv from public.conversations c
    join public.conversation_members a on a.conversation_id = c.id and a.user_id = v_me
    join public.conversation_members b on b.conversation_id = c.id and b.user_id = _other
    where c.kind = 'direct' limit 1;
  if v_conv is not null then return v_conv; end if;
  if public.is_account_restricted(_other) then raise exception 'user unavailable'; end if;
  select who_can_message into v_pref from public.user_preferences where user_id = _other;
  if coalesce(v_pref, 'everyone') = 'contacts'
     and not exists (select 1 from public.contacts where owner_id = _other and contact_id = v_me) then
    raise exception 'user accepts messages from contacts only';
  end if;
  insert into public.conversations (kind, created_by) values ('direct', v_me) returning id into v_conv;
  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_conv, v_me, 'member'), (v_conv, _other, 'member');
  return v_conv;
end $$;

create or replace function public.get_or_create_saved() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_conv uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select c.id into v_conv from public.conversations c
    join public.conversation_members m on m.conversation_id = c.id and m.user_id = v_me
    where c.kind = 'saved' limit 1;
  if v_conv is not null then return v_conv; end if;
  insert into public.conversations (kind, title, created_by) values ('saved', 'Избранное', v_me) returning id into v_conv;
  insert into public.conversation_members (conversation_id, user_id, role) values (v_conv, v_me, 'owner');
  return v_conv;
end $$;

-- ---------- 20. Группы и каналы ----------
create or replace function public.assert_can_create(_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if _uid is null then raise exception 'not authenticated'; end if;
  if public.is_account_restricted(_uid) then raise exception 'account_restricted'; end if;
  if public.setting_bool('maintenance_mode', false) and not public.is_staff(_uid) then raise exception 'maintenance'; end if;
  if not public.setting_bool('group_creation_enabled', true) and not public.is_staff(_uid) then raise exception 'group creation is disabled'; end if;
  select count(*) into n from public.conversations
    where created_by = _uid and kind in ('group', 'channel') and created_at > now() - interval '1 day';
  if n >= public.setting_int('groups_per_day', 10) then
    raise exception 'rate_limited: too many groups created today';
  end if;
end $$;

create or replace function public.create_group(_title text, _description text default null, _members uuid[] default '{}', _public_handle text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_conv uuid; v_u uuid; v_title text := trim(coalesce(_title, ''));
begin
  perform public.assert_can_create(v_me);
  if char_length(v_title) not between 1 and 100 then raise exception 'invalid title'; end if;
  if _public_handle is not null and not public.setting_bool('public_channels_enabled', true) then raise exception 'public groups are disabled'; end if;
  insert into public.conversations (kind, title, description, is_public, public_handle, created_by)
  values ('group', v_title, nullif(trim(coalesce(_description, '')), ''), _public_handle is not null, lower(_public_handle), v_me)
  returning id into v_conv;
  insert into public.groups (conversation_id) values (v_conv);
  insert into public.conversation_members (conversation_id, user_id, role) values (v_conv, v_me, 'owner');
  foreach v_u in array coalesce(_members[1:50], '{}') loop
    if v_u <> v_me and exists (select 1 from public.profiles where id = v_u)
       and not public.is_blocked_between(v_me, v_u) and not public.is_account_restricted(v_u) then
      insert into public.conversation_members (conversation_id, user_id, role, invited_by)
      values (v_conv, v_u, 'member', v_me) on conflict do nothing;
      perform public.push_notification(v_u, 'invite', 'Вас добавили в группу', v_title, '/chats/' || v_conv::text);
    end if;
  end loop;
  return v_conv;
end $$;

create or replace function public.create_channel(_title text, _description text default null, _public_handle text default null, _comments boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_conv uuid; v_title text := trim(coalesce(_title, ''));
begin
  perform public.assert_can_create(v_me);
  if char_length(v_title) not between 1 and 100 then raise exception 'invalid title'; end if;
  if _public_handle is not null and not public.setting_bool('public_channels_enabled', true) then raise exception 'public channels are disabled'; end if;
  insert into public.conversations (kind, title, description, is_public, public_handle, created_by)
  values ('channel', v_title, nullif(trim(coalesce(_description, '')), ''), _public_handle is not null, lower(_public_handle), v_me)
  returning id into v_conv;
  insert into public.channels (conversation_id, comments_enabled) values (v_conv, coalesce(_comments, false));
  insert into public.conversation_members (conversation_id, user_id, role) values (v_conv, v_me, 'owner');
  return v_conv;
end $$;

create or replace function public.conv_kind(_conv uuid) returns public.conversation_kind
language sql stable security definer set search_path = public as $$
  select kind from public.conversations where id = _conv
$$;

create or replace function public.join_conversation(_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); c public.conversations; v_cnt int; v_cap int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if public.is_account_restricted(v_me) then raise exception 'account_restricted'; end if;
  select * into c from public.conversations where id = _conv;
  if not found or not c.is_public or c.kind not in ('group', 'channel') or c.is_restricted then
    raise exception 'conversation not available';
  end if;
  if c.kind = 'group' then
    select count(*) into v_cnt from public.conversation_members where conversation_id = _conv;
    select max_members into v_cap from public.groups where conversation_id = _conv;
    if v_cnt >= coalesce(v_cap, 1000) then raise exception 'group is full'; end if;
  end if;
  insert into public.conversation_members (conversation_id, user_id, role) values (_conv, v_me, 'member') on conflict do nothing;
end $$;

create or replace function public.leave_conversation(_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_role public.member_role; v_kind public.conversation_kind; v_others int;
begin
  v_role := public.member_role_of(_conv, v_me);
  v_kind := public.conv_kind(_conv);
  if v_role is null then raise exception 'not a member'; end if;
  if v_kind not in ('group', 'channel') then raise exception 'cannot leave this chat (archive it instead)'; end if;
  select count(*) into v_others from public.conversation_members where conversation_id = _conv and user_id <> v_me;
  if v_others = 0 then
    delete from public.conversations where id = _conv;
  else
    if v_role = 'owner' then raise exception 'transfer ownership before leaving'; end if;
    delete from public.conversation_members where conversation_id = _conv and user_id = v_me;
  end if;
end $$;

create or replace function public.add_conversation_member(_conv uuid, _user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_role public.member_role; v_kind public.conversation_kind; v_can boolean; v_cnt int; v_cap int; v_title text;
begin
  v_role := public.member_role_of(_conv, v_me);
  v_kind := public.conv_kind(_conv);
  if v_role is null or v_kind not in ('group', 'channel') then raise exception 'forbidden' using errcode = '42501'; end if;
  if public.is_account_restricted(v_me) then raise exception 'account_restricted'; end if;
  v_can := v_role in ('owner', 'admin')
           or (v_kind = 'group' and coalesce((select members_can_invite from public.groups where conversation_id = _conv), false));
  if not v_can then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = _user) then raise exception 'user not found'; end if;
  if public.is_blocked_between(v_me, _user) or public.is_account_restricted(_user) then raise exception 'user unavailable'; end if;
  select count(*) into v_cnt from public.conversation_members where invited_by = v_me and joined_at > now() - interval '1 hour';
  if v_cnt >= public.setting_int('invites_per_hour', 50) then
    raise exception 'rate_limited: too many invitations';
  end if;
  if v_kind = 'group' then
    select count(*) into v_cnt from public.conversation_members where conversation_id = _conv;
    select max_members into v_cap from public.groups where conversation_id = _conv;
    if v_cnt >= coalesce(v_cap, 1000) then raise exception 'group is full'; end if;
  end if;
  insert into public.conversation_members (conversation_id, user_id, role, invited_by)
  values (_conv, _user, 'member', v_me) on conflict do nothing;
  select title into v_title from public.conversations where id = _conv;
  perform public.push_notification(_user, 'invite', 'Вас пригласили', coalesce(v_title, ''), '/chats/' || _conv::text);
end $$;

create or replace function public.remove_conversation_member(_conv uuid, _user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_role public.member_role; v_target public.member_role;
begin
  v_role := public.member_role_of(_conv, v_me);
  v_target := public.member_role_of(_conv, _user);
  if public.conv_kind(_conv) not in ('group', 'channel') or v_target is null then raise exception 'not found'; end if;
  if v_role not in ('owner', 'admin') or _user = v_me then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_target = 'owner' or (v_target = 'admin' and v_role <> 'owner') then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.conversation_members where conversation_id = _conv and user_id = _user;
end $$;

create or replace function public.set_member_role(_conv uuid, _user uuid, _role public.member_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.member_role_of(_conv, auth.uid()) is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  if _role = 'owner' or _user = auth.uid() or public.member_role_of(_conv, _user) is null
     or public.conv_kind(_conv) not in ('group', 'channel') then raise exception 'invalid request'; end if;
  update public.conversation_members set role = _role where conversation_id = _conv and user_id = _user;
end $$;

create or replace function public.transfer_ownership(_conv uuid, _user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.member_role_of(_conv, auth.uid()) is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  if _user = auth.uid() or public.member_role_of(_conv, _user) is null
     or public.conv_kind(_conv) not in ('group', 'channel') then raise exception 'invalid request'; end if;
  update public.conversation_members set role = 'owner' where conversation_id = _conv and user_id = _user;
  update public.conversation_members set role = 'admin' where conversation_id = _conv and user_id = auth.uid();
end $$;

-- Инвайт-ссылки
create or replace function public.create_invite_link(_conv uuid, _expires_hours int default null, _max_uses int default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_role public.member_role; v_kind public.conversation_kind; v_token text;
begin
  v_role := public.member_role_of(_conv, v_me);
  v_kind := public.conv_kind(_conv);
  if v_role is null or v_kind not in ('group', 'channel') then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_role not in ('owner', 'admin')
     and not (v_kind = 'group' and coalesce((select members_can_invite from public.groups where conversation_id = _conv), false)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if public.is_account_restricted(v_me) then raise exception 'account_restricted'; end if;
  insert into public.invite_links (conversation_id, created_by, expires_at, max_uses)
  values (_conv, v_me, case when _expires_hours is null then null else now() + make_interval(hours => _expires_hours) end, _max_uses)
  returning token into v_token;
  return v_token;
end $$;

create or replace function public.revoke_invite_link(_token text) returns void
language plpgsql security definer set search_path = public as $$
declare v_conv uuid;
begin
  select conversation_id into v_conv from public.invite_links where token = _token;
  if v_conv is null or public.member_role_of(v_conv, auth.uid()) not in ('owner', 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.invite_links set revoked_at = now() where token = _token and revoked_at is null;
end $$;

create or replace function public.invite_preview(_token text)
returns table (conversation_id uuid, kind public.conversation_kind, title text, description text, member_count bigint, valid boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return query
  select c.id, c.kind, c.title, c.description,
         (select count(*) from public.conversation_members m where m.conversation_id = c.id),
         (l.revoked_at is null and (l.expires_at is null or l.expires_at > now()) and (l.max_uses is null or l.uses < l.max_uses) and not c.is_restricted)
  from public.invite_links l join public.conversations c on c.id = l.conversation_id
  where l.token = _token;
end $$;

create or replace function public.join_by_invite(_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); l public.invite_links; c public.conversations; v_cnt int; v_cap int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if public.is_account_restricted(v_me) then raise exception 'account_restricted'; end if;
  select * into l from public.invite_links where token = _token for update;
  if not found or l.revoked_at is not null or (l.expires_at is not null and l.expires_at <= now())
     or (l.max_uses is not null and l.uses >= l.max_uses) then raise exception 'invite is not valid'; end if;
  select * into c from public.conversations where id = l.conversation_id;
  if c.is_restricted then raise exception 'conversation not available'; end if;
  if public.member_role_of(c.id, v_me) is not null then return c.id; end if;
  if c.kind = 'group' then
    select count(*) into v_cnt from public.conversation_members where conversation_id = c.id;
    select max_members into v_cap from public.groups where conversation_id = c.id;
    if v_cnt >= coalesce(v_cap, 1000) then raise exception 'group is full'; end if;
  end if;
  insert into public.conversation_members (conversation_id, user_id, role, invited_by)
  values (c.id, v_me, 'member', l.created_by) on conflict do nothing;
  update public.invite_links set uses = uses + 1 where token = _token;
  return c.id;
end $$;

-- Закрепить / удалить сообщение (права по типу чата)
create or replace function public.pin_message(_id uuid, _pin boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_conv uuid; v_kind public.conversation_kind; v_role public.member_role; v_ok boolean;
begin
  select conversation_id into v_conv from public.messages where id = _id and deleted_at is null;
  if v_conv is null then raise exception 'message not found'; end if;
  v_role := public.member_role_of(v_conv, auth.uid());
  v_kind := public.conv_kind(v_conv);
  if v_role is null then raise exception 'forbidden' using errcode = '42501'; end if;
  v_ok := case v_kind
    when 'group' then v_role in ('owner', 'admin') or coalesce((select members_can_pin from public.groups where conversation_id = v_conv), false)
    when 'channel' then v_role in ('owner', 'admin')
    else true end;
  if not v_ok then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.messages set is_pinned = _pin where id = _id;
end $$;

create or replace function public.delete_message(_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_conv uuid; v_sender uuid; v_kind public.conversation_kind; v_role public.member_role;
begin
  select conversation_id, sender_id into v_conv, v_sender from public.messages where id = _id and deleted_at is null;
  if v_conv is null then raise exception 'message not found'; end if;
  v_role := public.member_role_of(v_conv, auth.uid());
  v_kind := public.conv_kind(v_conv);
  if v_role is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_sender <> auth.uid() and not (v_kind in ('group', 'channel') and v_role in ('owner', 'admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.messages set deleted_at = now(), body = null, is_pinned = false where id = _id;
end $$;

create or replace function public.set_disappearing(_conv uuid, _seconds int) returns void
language plpgsql security definer set search_path = public as $$
declare v_role public.member_role; v_kind public.conversation_kind;
begin
  v_role := public.member_role_of(_conv, auth.uid());
  v_kind := public.conv_kind(_conv);
  if v_role is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_kind in ('group', 'channel') and v_role not in ('owner', 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if _seconds is not null and _seconds <> 0 and _seconds not between 5 and 31536000 then raise exception 'invalid ttl'; end if;
  update public.conversations set ttl_seconds = nullif(_seconds, 0) where id = _conv;
end $$;

create or replace function public.channel_stats(_conv uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if public.conv_kind(_conv) is distinct from 'channel' or public.member_role_of(_conv, auth.uid()) not in ('owner', 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'subscribers', (select count(*) from public.conversation_members where conversation_id = _conv),
    'new_subscribers_7d', (select count(*) from public.conversation_members where conversation_id = _conv and joined_at > now() - interval '7 days'),
    'posts', (select count(*) from public.messages where conversation_id = _conv and thread_root_id is null and deleted_at is null),
    'total_views', (select count(*) from public.message_views v2 join public.messages m on m.id = v2.message_id where m.conversation_id = _conv),
    'recent_posts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'created_at', x.created_at, 'preview', left(coalesce(x.body, ''), 60), 'views', x.views) order by x.created_at desc)
        from (select m.id, m.created_at, m.body, (select count(*) from public.message_views mv where mv.message_id = m.id) as views
              from public.messages m where m.conversation_id = _conv and m.thread_root_id is null and m.deleted_at is null
              order by m.created_at desc limit 10) x), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ---------- 21. Поиск ----------
create or replace function public.search_users(_q text, _limit int default 20)
returns table (id uuid, username text, display_name text, avatar_url text, bio text, is_contact boolean, is_blocked boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_q text := trim(coalesce(_q, ''));
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(v_q) < 2 then return; end if;
  v_q := ltrim(v_q, '@');
  return query
  select p.id, p.username, p.display_name, p.avatar_url, p.bio,
         exists (select 1 from public.contacts c where c.owner_id = auth.uid() and c.contact_id = p.id),
         exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = p.id)
  from public.profiles p
  where p.id <> auth.uid()
    and (p.username ilike '%' || public.like_escape(v_q) || '%' or p.display_name ilike '%' || public.like_escape(v_q) || '%')
    and not exists (select 1 from public.blocks b2 where b2.blocker_id = p.id and b2.blocked_id = auth.uid())
    and not public.is_banned(p.id)
  order by (lower(p.username) = lower(v_q)) desc, (p.username ilike public.like_escape(v_q) || '%') desc, p.username
  limit least(coalesce(_limit, 20), 50);
end $$;

create or replace function public.search_public_conversations(_q text, _kind public.conversation_kind default null)
returns table (id uuid, kind public.conversation_kind, title text, description text, avatar_url text, public_handle text, member_count bigint, is_member boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_q text := trim(coalesce(_q, ''));
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return query
  select c.id, c.kind, c.title, c.description, c.avatar_url, c.public_handle,
         (select count(*) from public.conversation_members m where m.conversation_id = c.id),
         public.is_member(c.id, auth.uid())
  from public.conversations c
  where c.is_public and c.kind in ('group', 'channel') and not c.is_restricted
    and (_kind is null or c.kind = _kind)
    and (v_q = '' or c.title ilike '%' || public.like_escape(ltrim(v_q, '@')) || '%' or c.public_handle ilike '%' || public.like_escape(ltrim(v_q, '@')) || '%')
  order by 7 desc, c.created_at desc
  limit 30;
end $$;

create or replace function public.search_messages(_q text, _conv uuid default null, _limit int default 30)
returns table (id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz, conversation_title text, kind public.conversation_kind)
language sql stable set search_path = public as $$
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at, c.title, c.kind
  from public.messages m join public.conversations c on c.id = m.conversation_id
  where char_length(trim(coalesce(_q, ''))) >= 2 and m.deleted_at is null
    and m.body ilike '%' || public.like_escape(trim(_q)) || '%'
    and (_conv is null or m.conversation_id = _conv)
    and public.is_member(m.conversation_id, auth.uid())
  order by m.created_at desc
  limit least(coalesce(_limit, 30), 100)
$$;

-- ---------- 22. Звонки ----------
revoke insert on public.calls from authenticated;
revoke update on public.calls from authenticated;
grant update (status, connected_at, ended_at) on public.calls to authenticated;
drop policy if exists "caller creates call" on public.calls;

create or replace function public.calls_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.status = old.status then
    new.connected_at := old.connected_at; new.ended_at := old.ended_at;
    return new;
  end if;
  if old.status in ('ended', 'missed', 'declined', 'failed') then raise exception 'call already finished'; end if;
  if old.status = 'ringing' and new.status = 'connected' then
    new.connected_at := now(); new.ended_at := null;
  elsif old.status = 'ringing' and new.status = 'declined' then
    if v_me <> old.callee_id then raise exception 'forbidden' using errcode = '42501'; end if;
    new.ended_at := now();
  elsif old.status = 'ringing' and new.status in ('missed', 'ended') then
    if v_me <> old.caller_id then raise exception 'forbidden' using errcode = '42501'; end if;
    new.ended_at := now();
  elsif new.status = 'failed' then
    new.ended_at := now();
  elsif old.status = 'connected' and new.status = 'ended' then
    new.ended_at := now();
  else
    raise exception 'invalid call transition';
  end if;
  return new;
end $$;
drop trigger if exists trg_calls_guard on public.calls;
create trigger trg_calls_guard before update on public.calls for each row execute function public.calls_guard();

create or replace function public.expire_stale_calls() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.calls set status = 'missed', ended_at = now() where status = 'ringing' and started_at < now() - interval '60 seconds';
  update public.calls set status = 'ended', ended_at = now() where status = 'connected' and connected_at < now() - interval '6 hours';
  delete from public.call_signals where created_at < now() - interval '1 day';
end $$;

create or replace function public.start_call(_conv uuid, _media text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_callee uuid; v_id uuid; v_name text;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if _media not in ('audio', 'video') then raise exception 'invalid media'; end if;
  if public.is_account_restricted(v_me) then raise exception 'account_restricted'; end if;
  if public.conv_kind(_conv) is distinct from 'direct' or not public.is_member(_conv, v_me) then
    raise exception 'calls are available in direct chats only';
  end if;
  select user_id into v_callee from public.conversation_members where conversation_id = _conv and user_id <> v_me limit 1;
  if v_callee is null then raise exception 'no callee'; end if;
  if public.is_blocked_between(v_me, v_callee) then raise exception 'blocked'; end if;
  if public.is_account_restricted(v_callee) then raise exception 'user unavailable'; end if;
  perform public.expire_stale_calls();
  if exists (select 1 from public.calls where status in ('ringing', 'connected')
             and (caller_id in (v_me, v_callee) or callee_id in (v_me, v_callee))) then
    raise exception 'busy';
  end if;
  insert into public.calls (conversation_id, caller_id, callee_id, media) values (_conv, v_me, v_callee, _media) returning id into v_id;
  select coalesce(nullif(display_name, ''), username) into v_name from public.profiles where id = v_me;
  perform public.push_notification(v_callee, 'call', coalesce(v_name, 'Звонок'), case when _media = 'video' then 'Видеозвонок' else 'Аудиозвонок' end, '/calls');
  return v_id;
end $$;

-- =====================================================================
-- ЧАСТЬ 3. Модерация, админ-панель, поддержка, настройки, данные пользователя
-- Каждая админская функция: (1) проверяет право через has_permission,
-- (2) требует причину для опасных действий, (3) пишет запись в admin_audit_logs.
-- =====================================================================

-- ---------- 23. Жалобы: защита от спама и дублей ----------
create or replace function public.reports_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.target_user_id = new.reporter_id then raise exception 'cannot report yourself'; end if;
  select count(*) into n from public.reports where reporter_id = new.reporter_id and created_at > now() - interval '1 hour';
  if n >= public.setting_int('reports_per_hour', 10) then raise exception 'rate_limited: too many reports'; end if;
  if exists (select 1 from public.reports r
             where r.reporter_id = new.reporter_id and r.status in ('open', 'in_review')
               and r.target_user_id is not distinct from new.target_user_id
               and r.target_conversation_id is not distinct from new.target_conversation_id
               and r.target_message_id is not distinct from new.target_message_id) then
    raise exception 'duplicate report';
  end if;
  return new;
end $$;
drop trigger if exists trg_reports_before_insert on public.reports;
create trigger trg_reports_before_insert before insert on public.reports
  for each row execute function public.reports_before_insert();

create or replace function public.tickets_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.support_tickets where user_id = new.user_id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate_limited: too many tickets';
  end if;
  return new;
end $$;
drop trigger if exists trg_tickets_before_insert on public.support_tickets;
create trigger trg_tickets_before_insert before insert on public.support_tickets
  for each row execute function public.tickets_before_insert();

-- ---------- 24. Админ: роли ----------
create or replace function public.admin_set_role(_user uuid, _role public.app_role, _grant boolean, _reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  perform public.require_permission('users.roles');
  if _user = v_me then raise exception 'cannot change own roles'; end if;
  if _role = 'owner' then raise exception 'owner role cannot be granted through the app'; end if;
  if public.role_rank(_role) >= public.max_rank(v_me) then raise exception 'insufficient rank for this role'; end if;
  if public.max_rank(_user) >= public.max_rank(v_me) then raise exception 'cannot modify a user of equal or higher rank'; end if;
  if _reason is null or char_length(trim(_reason)) < 3 then raise exception 'reason required'; end if;
  if not exists (select 1 from public.profiles where id = _user) then raise exception 'user not found'; end if;
  if _grant then
    insert into public.user_roles (user_id, role, granted_by) values (_user, _role, v_me) on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles where user_id = _user and role = _role;
  end if;
  perform public.write_audit(case when _grant then 'role.grant' else 'role.revoke' end, 'user', _user::text, _reason, 'success',
                             jsonb_build_object('role', _role));
end $$;

create or replace function public.admin_list_staff()
returns table (user_id uuid, username text, display_name text, role public.app_role, granted_by_username text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_permission('users.view');
  return query
  select ur.user_id, p.username, p.display_name, ur.role, gp.username, ur.created_at
  from public.user_roles ur
  left join public.profiles p on p.id = ur.user_id
  left join public.profiles gp on gp.id = ur.granted_by
  order by public.role_rank(ur.role) desc, p.username;
end $$;

-- Вызывается при входе в /admin: фиксирует вход сотрудника (не чаще раза в час)
create or replace function public.log_staff_login() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_staff(auth.uid()) then return; end if;
  if exists (select 1 from public.admin_audit_logs where actor_id = auth.uid() and action = 'admin.login' and created_at > now() - interval '1 hour') then return; end if;
  perform public.write_audit('admin.login', 'user', auth.uid()::text, null, 'success', '{}'::jsonb);
end $$;

-- ---------- 25. Админ: пользователи ----------
create or replace function public.admin_list_users(_q text default null, _status text default null, _from timestamptz default null, _to timestamptz default null, _limit int default 50, _offset int default 0)
returns table (id uuid, username text, display_name text, avatar_url text, created_at timestamptz, email_confirmed boolean,
               banned_at timestamptz, suspended_until timestamptz, roles text[], open_reports int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_permission('users.view');
  return query
  select p.id, p.username, p.display_name, p.avatar_url, p.created_at, (au.email_confirmed_at is not null),
         s.banned_at, s.suspended_until,
         coalesce((select array_agg(ur.role::text order by ur.role) from public.user_roles ur where ur.user_id = p.id), '{}'::text[]),
         (select count(*)::int from public.reports r where r.target_user_id = p.id and r.status in ('open', 'in_review'))
  from public.profiles p
  left join auth.users au on au.id = p.id
  left join public.account_status s on s.user_id = p.id
  where (coalesce(_q, '') = '' or p.username ilike '%' || public.like_escape(_q) || '%' or p.id::text = trim(_q))
    and (_from is null or p.created_at >= _from) and (_to is null or p.created_at < _to)
    and (_status is null or _status = 'all'
         or (_status = 'banned' and s.banned_at is not null)
         or (_status = 'suspended' and s.suspended_until > now())
         or (_status = 'staff' and exists (select 1 from public.user_roles ur2 where ur2.user_id = p.id))
         or (_status = 'unconfirmed' and au.email_confirmed_at is null))
  order by p.created_at desc
  limit least(coalesce(_limit, 50), 100) offset greatest(coalesce(_offset, 0), 0);
end $$;

create or replace function public.admin_user_detail(_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.require_permission('users.view');
  select jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'bio', p.bio, 'created_at', p.created_at) from public.profiles p where p.id = _id),
    'email_confirmed', (select au.email_confirmed_at is not null from auth.users au where au.id = _id),
    'status', (select to_jsonb(s) - 'updated_by' from public.account_status s where s.user_id = _id),
    'roles', coalesce((select jsonb_agg(ur.role) from public.user_roles ur where ur.user_id = _id), '[]'::jsonb),
    'sanctions', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'reason', a.reason, 'expires_at', a.expires_at, 'revoked_at', a.revoked_at, 'created_at', a.created_at) order by a.created_at desc)
                           from public.moderation_actions a where a.target_user_id = _id), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'category', r.category, 'status', r.status, 'created_at', r.created_at) order by r.created_at desc)
                         from (select * from public.reports where target_user_id = _id order by created_at desc limit 20) r), '[]'::jsonb),
    'deletion_request', (select to_jsonb(d) from public.deletion_requests d where d.user_id = _id)
  ) into v;
  return v;
end $$;

-- Санкции: warn/suspend (users.suspend), ban/unban (users.ban)
create or replace function public.admin_apply_sanction(_user uuid, _action text, _reason text, _until timestamptz default null, _report uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_msg text;
begin
  if _action not in ('warn', 'suspend', 'ban', 'unban') then raise exception 'invalid action'; end if;
  perform public.require_permission(case when _action in ('ban', 'unban') then 'users.ban' else 'users.suspend' end);
  if _reason is null or char_length(trim(_reason)) < 3 then raise exception 'reason required'; end if;
  if _user = v_me then raise exception 'cannot sanction yourself'; end if;
  if not exists (select 1 from public.profiles where id = _user) then raise exception 'user not found'; end if;
  if public.max_rank(_user) >= public.max_rank(v_me) then raise exception 'cannot sanction a user of equal or higher rank'; end if;
  if _action = 'suspend' and (_until is null or _until <= now() or _until > now() + interval '365 days') then
    raise exception 'suspension needs an end date within 365 days';
  end if;

  insert into public.moderation_actions (actor_id, target_user_id, report_id, action, reason, expires_at)
  values (v_me, _user, _report, _action, trim(_reason), case when _action = 'suspend' then _until else null end)
  returning id into v_id;

  if _action = 'ban' then
    insert into public.account_status (user_id, banned_at, reason, updated_by) values (_user, now(), left(trim(_reason), 500), v_me)
    on conflict (user_id) do update set banned_at = now(), reason = excluded.reason, updated_by = v_me, updated_at = now();
  elsif _action = 'suspend' then
    insert into public.account_status (user_id, suspended_until, reason, updated_by) values (_user, _until, left(trim(_reason), 500), v_me)
    on conflict (user_id) do update set suspended_until = excluded.suspended_until, reason = excluded.reason, updated_by = v_me, updated_at = now();
  elsif _action = 'unban' then
    update public.account_status set banned_at = null, suspended_until = null, reason = null, updated_by = v_me, updated_at = now() where user_id = _user;
    update public.moderation_actions set revoked_at = now() where target_user_id = _user and action in ('ban', 'suspend') and revoked_at is null and id <> v_id;
  end if;

  v_msg := case _action when 'warn' then 'Вам вынесено предупреждение' when 'suspend' then 'Ваш аккаунт временно ограничен'
                        when 'ban' then 'Ваш аккаунт заблокирован' else 'Ограничения с вашего аккаунта сняты' end;
  perform public.push_notification(_user, 'moderation', v_msg, left(trim(_reason), 300), '/profile');
  perform public.write_audit('sanction.' || _action, 'user', _user::text, _reason, 'success',
                             jsonb_build_object('action_id', v_id, 'report_id', _report, 'until', _until));
  return v_id;
end $$;

-- Пользователь подаёт апелляцию на свою санкцию
create or replace function public.file_appeal(_action uuid, _body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.moderation_actions a
                 where a.id = _action and a.target_user_id = auth.uid() and a.action in ('warn', 'suspend', 'ban') and a.revoked_at is null) then
    raise exception 'sanction not found';
  end if;
  insert into public.appeals (user_id, action_id, body) values (auth.uid(), _action, trim(_body));
exception when unique_violation then
  raise exception 'appeal already filed';
end $$;

create or replace function public.admin_list_appeals(_status text default 'open')
returns table (id uuid, created_at timestamptz, status text, body text, user_id uuid, username text, action_id uuid, action text, action_reason text, decision text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_permission('appeals.decide');
  return query
  select ap.id, ap.created_at, ap.status, ap.body, ap.user_id, p.username, ap.action_id, a.action, a.reason, ap.decision
  from public.appeals ap join public.moderation_actions a on a.id = ap.action_id left join public.profiles p on p.id = ap.user_id
  where _status is null or ap.status = _status
  order by ap.created_at desc limit 100;
end $$;

create or replace function public.admin_decide_appeal(_id uuid, _accept boolean, _decision text) returns void
language plpgsql security definer set search_path = public as $$
declare ap public.appeals; a public.moderation_actions;
begin
  perform public.require_permission('appeals.decide');
  if _decision is null or char_length(trim(_decision)) < 3 then raise exception 'decision text required'; end if;
  select * into ap from public.appeals where id = _id and status = 'open' for update;
  if not found then raise exception 'appeal not found or already decided'; end if;
  select * into a from public.moderation_actions where id = ap.action_id;
  if _accept and a.action in ('ban', 'suspend') and not public.has_permission(auth.uid(), 'users.ban') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.appeals set status = case when _accept then 'accepted' else 'rejected' end, decided_by = auth.uid(), decision = trim(_decision), decided_at = now() where id = _id;
  if _accept then
    update public.moderation_actions set revoked_at = now() where id = a.id;
    if a.action in ('ban', 'suspend') then
      update public.account_status set banned_at = null, suspended_until = null, reason = null, updated_by = auth.uid(), updated_at = now() where user_id = ap.user_id;
    end if;
  end if;
  perform public.push_notification(ap.user_id, 'moderation', case when _accept then 'Апелляция принята' else 'Апелляция отклонена' end, left(trim(_decision), 300), '/profile');
  perform public.write_audit('appeal.decide', 'appeal', _id::text, _decision, 'success', jsonb_build_object('accepted', _accept, 'action_id', a.id));
end $$;

-- ---------- 26. Админ: жалобы ----------
create or replace function public.admin_list_reports(_status text default null, _limit int default 50)
returns table (id uuid, created_at timestamptz, status public.report_status, priority smallint, category text, details text,
               assigned_to uuid, assigned_username text, reporter_username text, target_user_id uuid, target_username text,
               target_conversation_id uuid, target_message_id uuid, resolution text, related_open int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_permission('reports.view');
  return query
  select r.id, r.created_at, r.status, r.priority, r.category, r.details, r.assigned_to, ap.username, rp.username,
         r.target_user_id, tp.username, r.target_conversation_id, r.target_message_id, r.resolution,
         (select count(*)::int from public.reports r2
          where r2.id <> r.id and r2.status in ('open', 'in_review')
            and ((r.target_user_id is not null and r2.target_user_id = r.target_user_id)
              or (r.target_message_id is not null and r2.target_message_id = r.target_message_id)
              or (r.target_conversation_id is not null and r2.target_conversation_id = r.target_conversation_id)))
  from public.reports r
  left join public.profiles ap on ap.id = r.assigned_to
  left join public.profiles rp on rp.id = r.reporter_id
  left join public.profiles tp on tp.id = r.target_user_id
  where _status is null or _status = 'all' or r.status::text = _status
  order by (r.status in ('open', 'in_review')) desc, r.priority desc, r.created_at asc
  limit least(coalesce(_limit, 50), 200);
end $$;

-- priority: 1 низкий … 4 срочный
create or replace function public.admin_update_report(_id uuid, _status public.report_status, _priority smallint default null, _assign_to_me boolean default false, _resolution text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('reports.resolve');
  if _status in ('resolved', 'rejected') and (_resolution is null or char_length(trim(_resolution)) < 3) then
    raise exception 'resolution required to close a report';
  end if;
  update public.reports set status = _status,
         priority = coalesce(_priority, priority),
         assigned_to = case when _assign_to_me then auth.uid() else assigned_to end,
         resolution = case when _status in ('resolved', 'rejected') then trim(_resolution) else resolution end,
         resolved_at = case when _status in ('resolved', 'rejected') then now() else null end
  where id = _id;
  if not found then raise exception 'report not found'; end if;
  perform public.write_audit('report.update', 'report', _id::text, _resolution, 'success', jsonb_build_object('status', _status, 'priority', _priority));
end $$;

create or replace function public.admin_add_report_comment(_id uuid, _body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('reports.resolve');
  insert into public.report_comments (report_id, author_id, body) values (_id, auth.uid(), trim(_body));
end $$;

-- Содержимое переписки доступно ТОЛЬКО в рамках конкретной жалобы на сообщение: сама жалоба + 5 сообщений до/после.
create or replace function public.admin_report_context(_report uuid)
returns table (id uuid, sender_id uuid, sender_username text, body text, created_at timestamptz, is_target boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r public.reports; v_at timestamptz;
begin
  perform public.require_permission('reports.content');
  select * into r from public.reports where id = _report;
  if not found or r.target_message_id is null then raise exception 'report has no message'; end if;
  select m.created_at into v_at from public.messages m where m.id = r.target_message_id;
  if v_at is null then raise exception 'message not found'; end if;
  perform public.write_audit('report.view_content', 'report', _report::text, null, 'success', jsonb_build_object('message_id', r.target_message_id));
  return query
  select x.id, x.sender_id, p.username, x.body, x.created_at, (x.id = r.target_message_id)
  from (
    (select m.id, m.sender_id, m.body, m.created_at from public.messages m
      where m.conversation_id = (select conversation_id from public.messages where id = r.target_message_id)
        and m.created_at <= v_at and m.thread_root_id is null order by m.created_at desc limit 6)
    union
    (select m.id, m.sender_id, m.body, m.created_at from public.messages m
      where m.conversation_id = (select conversation_id from public.messages where id = r.target_message_id)
        and m.created_at > v_at and m.thread_root_id is null order by m.created_at asc limit 5)
  ) x left join public.profiles p on p.id = x.sender_id
  order by x.created_at;
end $$;

create or replace function public.admin_remove_message(_msg uuid, _reason text, _report uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sender uuid; v_conv uuid;
begin
  perform public.require_permission('content.remove');
  if _reason is null or char_length(trim(_reason)) < 3 then raise exception 'reason required'; end if;
  if not exists (select 1 from public.reports where target_message_id = _msg) then
    raise exception 'only reported messages can be removed by staff';
  end if;
  select sender_id, conversation_id into v_sender, v_conv from public.messages where id = _msg and deleted_at is null;
  if v_conv is null then raise exception 'message not found'; end if;
  update public.messages set deleted_at = now(), body = null, is_pinned = false where id = _msg;
  insert into public.moderation_actions (actor_id, target_user_id, target_conversation_id, report_id, action, reason)
  values (auth.uid(), v_sender, v_conv, _report, 'remove_message', trim(_reason));
  perform public.write_audit('message.remove', 'message', _msg::text, _reason, 'success', jsonb_build_object('report_id', _report));
end $$;

-- ---------- 27. Админ: группы и каналы ----------
-- В списке только публичные и те, на которые есть жалобы: закрытые группы без повода не показываются.
create or replace function public.admin_list_conversations(_q text default null, _kind text default null, _limit int default 50, _offset int default 0)
returns table (id uuid, kind public.conversation_kind, title text, public_handle text, is_public boolean, is_restricted boolean,
               member_count bigint, owner_username text, created_at timestamptz, last_message_at timestamptz, open_reports int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_permission('groups.moderate');
  return query
  select c.id, c.kind, c.title, c.public_handle, c.is_public, c.is_restricted,
         (select count(*) from public.conversation_members m where m.conversation_id = c.id),
         (select p.username from public.conversation_members o join public.profiles p on p.id = o.user_id where o.conversation_id = c.id and o.role = 'owner' limit 1),
         c.created_at, c.last_message_at,
         (select count(*)::int from public.reports r where r.target_conversation_id = c.id and r.status in ('open', 'in_review'))
  from public.conversations c
  where c.kind in ('group', 'channel')
    and (c.is_public or exists (select 1 from public.reports r2 where r2.target_conversation_id = c.id))
    and (_kind is null or _kind = 'all' or c.kind::text = _kind)
    and (coalesce(_q, '') = '' or c.title ilike '%' || public.like_escape(_q) || '%' or c.public_handle ilike '%' || public.like_escape(_q) || '%' or c.id::text = trim(_q))
  order by c.created_at desc
  limit least(coalesce(_limit, 50), 100) offset greatest(coalesce(_offset, 0), 0);
end $$;

create or replace function public.admin_restrict_conversation(_conv uuid, _restrict boolean, _reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('groups.moderate');
  if _reason is null or char_length(trim(_reason)) < 3 then raise exception 'reason required'; end if;
  update public.conversations set is_restricted = _restrict where id = _conv and kind in ('group', 'channel');
  if not found then raise exception 'conversation not found'; end if;
  insert into public.moderation_actions (actor_id, target_conversation_id, action, reason)
  values (auth.uid(), _conv, case when _restrict then 'restrict_conversation' else 'unrestrict_conversation' end, trim(_reason));
  perform public.write_audit(case when _restrict then 'conversation.restrict' else 'conversation.unrestrict' end, 'conversation', _conv::text, _reason, 'success', '{}'::jsonb);
end $$;

-- ---------- 28. Админ: аналитика ----------
create or replace function public.admin_dashboard_stats(_from timestamptz, _to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.require_permission('analytics.view');
  if _from is null or _to is null or _to <= _from or _to - _from > interval '400 days' then raise exception 'invalid period'; end if;
  select jsonb_build_object(
    'total_users', (select count(*) from public.profiles),
    'new_users', (select count(*) from public.profiles where created_at >= _from and created_at < _to),
    -- «активные» = отправили хотя бы одно сообщение (других достоверных данных об активности мы не собираем)
    'active_day', (select count(distinct sender_id) from public.messages where created_at > now() - interval '1 day'),
    'active_week', (select count(distinct sender_id) from public.messages where created_at > now() - interval '7 days'),
    'active_month', (select count(distinct sender_id) from public.messages where created_at > now() - interval '30 days'),
    'messages', (select count(*) from public.messages where created_at >= _from and created_at < _to),
    'groups', (select count(*) from public.conversations where kind = 'group'),
    'channels', (select count(*) from public.conversations where kind = 'channel'),
    'calls_by_status', coalesce((select jsonb_object_agg(s.status, s.n) from (select status, count(*) as n from public.calls where started_at >= _from and started_at < _to group by status) s), '{}'::jsonb),
    'open_reports', (select count(*) from public.reports where status in ('open', 'in_review')),
    'banned', (select count(*) from public.account_status where banned_at is not null),
    'suspended', (select count(*) from public.account_status where suspended_until > now()),
    'open_tickets', (select count(*) from public.support_tickets where status in ('open', 'pending')),
    'storage_bytes', (select coalesce(sum(size_bytes), 0) from public.attachments),
    'attachments', (select count(*) from public.attachments),
    'errors', (select count(*) from public.error_events where created_at >= _from and created_at < _to),
    'spam_events', (select count(*) from public.spam_events where created_at >= _from and created_at < _to),
    'registrations_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) order by d.day) from (select date_trunc('day', created_at)::date as day, count(*) as n from public.profiles where created_at >= _from and created_at < _to group by 1) d), '[]'::jsonb),
    'messages_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) order by d.day) from (select date_trunc('day', created_at)::date as day, count(*) as n from public.messages where created_at >= _from and created_at < _to group by 1) d), '[]'::jsonb),
    'reports_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) order by d.day) from (select date_trunc('day', created_at)::date as day, count(*) as n from public.reports where created_at >= _from and created_at < _to group by 1) d), '[]'::jsonb)
  ) into v;
  return v;
end $$;

create or replace function public.log_export(_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('export.run');
  perform public.write_audit('export.run', 'report', left(coalesce(_kind, 'unknown'), 80), null, 'success', '{}'::jsonb);
end $$;

-- ---------- 29. Админ: настройки платформы ----------
create or replace function public.validate_platform_setting(_key text, _value jsonb) returns void
language plpgsql immutable as $$
declare n numeric;
begin
  if _key in ('registration_open', 'maintenance_mode', 'group_creation_enabled', 'public_channels_enabled') then
    if jsonb_typeof(_value) <> 'boolean' then raise exception 'setting % must be true/false', _key; end if;
  elsif _key in ('max_upload_mb', 'messages_per_minute', 'groups_per_day', 'invites_per_hour', 'reports_per_hour', 'max_message_length') then
    if jsonb_typeof(_value) <> 'number' then raise exception 'setting % must be a number', _key; end if;
    n := (_value #>> '{}')::numeric;
    if n <> trunc(n) then raise exception 'setting % must be an integer', _key; end if;
    if (_key = 'max_upload_mb' and n not between 1 and 50)
       or (_key = 'messages_per_minute' and n not between 5 and 120)
       or (_key = 'groups_per_day' and n not between 1 and 50)
       or (_key = 'invites_per_hour' and n not between 5 and 200)
       or (_key = 'reports_per_hour' and n not between 3 and 50)
       or (_key = 'max_message_length' and n not between 100 and 4000) then
      raise exception 'setting % is out of allowed range', _key;
    end if;
  elsif _key = 'platform_name' then
    if jsonb_typeof(_value) <> 'string' or char_length(_value #>> '{}') not between 1 and 40 then raise exception 'platform_name must be 1-40 characters'; end if;
  elsif _key = 'maintenance_message' then
    if jsonb_typeof(_value) <> 'string' or char_length(_value #>> '{}') > 300 then raise exception 'maintenance_message must be up to 300 characters'; end if;
  elsif _key = 'acceptable_use' then
    if jsonb_typeof(_value) <> 'string' or char_length(_value #>> '{}') > 5000 then raise exception 'acceptable_use must be up to 5000 characters'; end if;
  elsif _key = 'logo_url' then
    if jsonb_typeof(_value) <> 'string' or char_length(_value #>> '{}') > 500 or ((_value #>> '{}') <> '' and (_value #>> '{}') !~ '^https://') then
      raise exception 'logo_url must be empty or an https link';
    end if;
  else
    raise exception 'unknown setting %', _key;
  end if;
end $$;

-- Опасные настройки: нужны право settings.dangerous (super_admin/owner) И явное подтверждение _confirm = true
create or replace function public.admin_update_setting(_key text, _value jsonb, _reason text, _confirm boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_danger boolean;
begin
  perform public.require_permission('settings.edit');
  if _reason is null or char_length(trim(_reason)) < 3 then raise exception 'reason required'; end if;
  perform public.validate_platform_setting(_key, _value);
  v_danger := _key in ('maintenance_mode', 'registration_open')
              or (_key = 'messages_per_minute' and (_value #>> '{}')::int < 10);
  if v_danger then
    if not public.has_permission(auth.uid(), 'settings.dangerous') then raise exception 'forbidden: dangerous setting' using errcode = '42501'; end if;
    if not coalesce(_confirm, false) then raise exception 'confirmation required for this setting'; end if;
  end if;
  select value into v_old from public.platform_settings where key = _key;
  insert into public.platform_settings (key, value, updated_by, updated_at) values (_key, _value, auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = auth.uid(), updated_at = now();
  perform public.write_audit('setting.update', 'setting', _key, _reason, 'success', jsonb_build_object('old', v_old, 'new', _value, 'dangerous', v_danger));
end $$;

-- ---------- 30. Админ: объявления ----------
create or replace function public.admin_save_announcement(_id uuid, _title text, _body text, _audience text, _severity text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_permission('announcements.manage');
  if _id is null then
    insert into public.announcements (title, body, audience, severity, created_by)
    values (trim(_title), trim(_body), coalesce(_audience, 'all'), coalesce(_severity, 'info'), auth.uid()) returning id into v_id;
  else
    update public.announcements set title = trim(_title), body = trim(_body), audience = coalesce(_audience, audience),
           severity = coalesce(_severity, severity), updated_at = now()
    where id = _id and status = 'draft' returning id into v_id;
    if v_id is null then raise exception 'only drafts can be edited'; end if;
  end if;
  perform public.write_audit('announcement.save', 'announcement', v_id::text, null, 'success', '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.admin_publish_announcement(_id uuid, _publish_at timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('announcements.manage');
  update public.announcements set status = 'published', publish_at = coalesce(_publish_at, now()), updated_at = now()
  where id = _id and status = 'draft';
  if not found then raise exception 'announcement not found or not a draft'; end if;
  perform public.write_audit('announcement.publish', 'announcement', _id::text, null, 'success', jsonb_build_object('publish_at', coalesce(_publish_at, now())));
end $$;

create or replace function public.admin_revoke_announcement(_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('announcements.manage');
  update public.announcements set status = 'revoked', revoked_at = now(), updated_at = now() where id = _id and status = 'published';
  if not found then raise exception 'announcement not found or not published'; end if;
  perform public.write_audit('announcement.revoke', 'announcement', _id::text, null, 'success', '{}'::jsonb);
end $$;

-- ---------- 31. Поддержка ----------
create or replace function public.support_post_message(_ticket uuid, _body text, _internal boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare t public.support_tickets; v_staff boolean := public.has_permission(auth.uid(), 'support.handle');
begin
  select * into t from public.support_tickets where id = _ticket;
  if not found then raise exception 'ticket not found'; end if;
  if not v_staff and t.user_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not v_staff and t.status = 'closed' then raise exception 'ticket is closed'; end if;
  insert into public.ticket_messages (ticket_id, author_id, body, is_staff, internal)
  values (_ticket, auth.uid(), trim(_body), v_staff, v_staff and coalesce(_internal, false));
  if v_staff and not coalesce(_internal, false) then
    update public.support_tickets set status = 'pending', updated_at = now() where id = _ticket and status = 'open';
    perform public.push_notification(t.user_id, 'support', 'Ответ поддержки', left(trim(_body), 200), '/settings/support');
  elsif not v_staff then
    update public.support_tickets set status = 'open', updated_at = now() where id = _ticket and status in ('pending', 'resolved');
  end if;
end $$;

create or replace function public.support_update_ticket(_id uuid, _status public.ticket_status default null, _priority smallint default null, _assign_to_me boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('support.handle');
  update public.support_tickets set status = coalesce(_status, status), priority = coalesce(_priority, priority),
         assigned_to = case when _assign_to_me then auth.uid() else assigned_to end, updated_at = now()
  where id = _id;
  if not found then raise exception 'ticket not found'; end if;
  perform public.write_audit('ticket.update', 'ticket', _id::text, null, 'success', jsonb_build_object('status', _status, 'priority', _priority));
end $$;

create or replace function public.support_reopen(_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.support_tickets set status = 'open', updated_at = now()
  where id = _id and user_id = auth.uid() and status in ('resolved', 'closed');
  if not found then raise exception 'ticket cannot be reopened'; end if;
end $$;

create or replace function public.admin_list_tickets(_status text default null)
returns table (id uuid, created_at timestamptz, updated_at timestamptz, status public.ticket_status, priority smallint, category text,
               subject text, user_id uuid, username text, assigned_to uuid, report_id uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_permission('support.handle');
  return query
  select t.id, t.created_at, t.updated_at, t.status, t.priority, t.category, t.subject, t.user_id, p.username, t.assigned_to, t.report_id
  from public.support_tickets t left join public.profiles p on p.id = t.user_id
  where _status is null or _status = 'all' or t.status::text = _status
  order by (t.status in ('open', 'pending')) desc, t.priority desc, t.updated_at desc
  limit 100;
end $$;

-- ---------- 32. Данные пользователя ----------
create or replace function public.request_account_deletion() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.deletion_requests (user_id) values (auth.uid())
  on conflict (user_id) do update set status = 'pending', requested_at = now(), processed_by = null, processed_at = null;
end $$;

-- Вызывается серверной функцией перед удалением аккаунта сотрудником. Сам auth-пользователь удаляется админ-API на сервере.
create or replace function public.admin_prepare_account_deletion(_user uuid, _reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('users.delete');
  if _reason is null or char_length(trim(_reason)) < 3 then raise exception 'reason required'; end if;
  if _user = auth.uid() or public.max_rank(_user) >= public.max_rank(auth.uid()) then raise exception 'cannot delete this account'; end if;
  update public.deletion_requests set status = 'processed', processed_by = auth.uid(), processed_at = now() where user_id = _user;
  perform public.write_audit('user.delete', 'user', _user::text, _reason, 'success', '{}'::jsonb);
end $$;

create or replace function public.admin_list_deletion_requests()
returns table (user_id uuid, username text, requested_at timestamptz, status text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_permission('users.view');
  return query select d.user_id, p.username, d.requested_at, d.status
  from public.deletion_requests d left join public.profiles p on p.id = d.user_id
  order by (d.status = 'pending') desc, d.requested_at desc limit 100;
end $$;

create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v jsonb;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_me),
    'preferences', (select to_jsonb(u) from public.user_preferences u where u.user_id = v_me),
    'contacts', coalesce((select jsonb_agg(to_jsonb(c)) from public.contacts c where c.owner_id = v_me), '[]'::jsonb),
    'blocks', coalesce((select jsonb_agg(to_jsonb(b)) from public.blocks b where b.blocker_id = v_me), '[]'::jsonb),
    'my_messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'conversation_id', m.conversation_id, 'body', m.body, 'created_at', m.created_at) order by m.created_at)
                             from (select * from public.messages where sender_id = v_me and deleted_at is null order by created_at desc limit 5000) m), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- Активные сессии (без IP-адресов — минимизация данных)
create or replace function public.my_sessions()
returns table (id uuid, created_at timestamptz, refreshed_at timestamptz, user_agent text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return query execute
    'select id, created_at, refreshed_at::timestamptz, user_agent from auth.sessions where user_id = $1 order by coalesce(refreshed_at, created_at) desc limit 20'
    using auth.uid();
end $$;

-- ---------- 33. Здоровье системы ----------
create or replace function public.health_ping() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cron jsonb := '[]'::jsonb;
begin
  perform public.require_permission('health.view');
  if to_regclass('cron.job') is not null then
    begin
      execute 'select coalesce(jsonb_agg(jsonb_build_object(''name'', jobname, ''schedule'', schedule, ''active'', active)), ''[]''::jsonb) from cron.job where jobname like ''vexchat-%'''
        into v_cron;
    exception when others then v_cron := '[]'::jsonb;
    end;
  end if;
  return jsonb_build_object('ok', true, 'db_time', now(), 'cron_available', to_regclass('cron.job') is not null, 'cron_jobs', v_cron);
end $$;

create or replace function public.admin_record_backup(_kind text, _ok boolean, _note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('backups.manage');
  insert into public.backup_records (kind, ok, note, recorded_by) values (_kind, _ok, left(_note, 1000), auth.uid());
  perform public.write_audit('backup.record', 'backup', _kind, _note, case when _ok then 'success' else 'failed' end, '{}'::jsonb);
end $$;

-- ---------- 34. Закрытая регистрация ----------
create or replace function public.enforce_registration_open() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.setting_bool('registration_open', true) then raise exception 'registration_closed'; end if;
  return new;
end $$;
drop trigger if exists trg_registration_open on auth.users;
create trigger trg_registration_open before insert on auth.users for each row execute function public.enforce_registration_open();

-- ---------- 35. Безопасное удаление аккаунта ----------
-- Группы/каналы владельца передаются старшему участнику (или удаляются, если он был один).
-- Личные сообщения остаются у собеседника (автор отображается как «Удалённый аккаунт»).
create or replace function public.handle_user_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_next uuid;
begin
  begin
    for r in select c.id from public.conversations c
             join public.conversation_members m on m.conversation_id = c.id and m.user_id = old.id and m.role = 'owner'
             where c.kind in ('group', 'channel') loop
      select user_id into v_next from public.conversation_members
        where conversation_id = r.id and user_id <> old.id order by (role = 'admin') desc, joined_at asc limit 1;
      if v_next is null then
        delete from public.conversations where id = r.id;
      else
        update public.conversation_members set role = 'owner' where conversation_id = r.id and user_id = v_next;
      end if;
    end loop;
    delete from public.conversations where kind = 'saved' and created_by = old.id;
  exception when others then
    raise warning 'handle_user_deleted: %', sqlerrm;
  end;
  return old;
end $$;
drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted before delete on auth.users for each row execute function public.handle_user_deleted();

-- ---------- 36. Права на выполнение функций ----------
do $$
declare v_name text;
  v_client text[] := array[
    'get_or_create_direct','get_or_create_saved','my_conversations','conversation_members_detail','mark_conversation_read','mark_delivered',
    'search_users','search_public_conversations','search_messages','create_group','create_channel','join_conversation','leave_conversation',
    'add_conversation_member','remove_conversation_member','set_member_role','transfer_ownership','create_invite_link','revoke_invite_link',
    'invite_preview','join_by_invite','pin_message','delete_message','set_disappearing','channel_stats','start_call','expire_stale_calls',
    'file_appeal','support_post_message','support_reopen','request_account_deletion','export_my_data','my_sessions','log_staff_login',
    'admin_set_role','admin_list_staff','admin_list_users','admin_user_detail','admin_apply_sanction','admin_list_appeals','admin_decide_appeal',
    'admin_list_reports','admin_update_report','admin_add_report_comment','admin_report_context','admin_remove_message',
    'admin_list_conversations','admin_restrict_conversation','admin_dashboard_stats','log_export','admin_update_setting',
    'admin_save_announcement','admin_publish_announcement','admin_revoke_announcement','support_update_ticket','admin_list_tickets',
    'admin_prepare_account_deletion','admin_list_deletion_requests','health_ping','admin_record_backup'];
  v_internal text[] := array[
    'write_audit','require_permission','push_notification','notify_message','deliver_scheduled_notifications','purge_expired_messages',
    'assert_can_create','validate_platform_setting'];
begin
  foreach v_name in array v_client loop
    execute format('revoke all on function public.%I from public, anon', v_name);   -- все перегрузки
    execute format('grant execute on function public.%I to authenticated, service_role', v_name);
  end loop;
  foreach v_name in array v_internal loop
    execute format('revoke all on function public.%I from public, anon, authenticated', v_name);
    execute format('grant execute on function public.%I to service_role', v_name);
  end loop;
exception when undefined_function then
  raise exception 'permission setup failed (function missing): %', sqlerrm;
end $$;


-- =====================================================================
-- ЧАСТЬ 4. Realtime, фоновые задачи
-- =====================================================================

-- ---------- 37. Realtime: какие таблицы публикуются ----------
do $$
declare t text;
begin
  foreach t in array array['calls', 'call_signals', 'announcements', 'message_reactions', 'conversation_members'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
             when undefined_object then null;
    end;
  end loop;
end $$;

-- ---------- 38. Realtime: защита приватных каналов (индикатор набора текста) ----------
-- Клиент подключается к приватному каналу "conv:<uuid>"; доступ — только участникам чата.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "vexchat conv broadcast read" on realtime.messages';
    execute 'drop policy if exists "vexchat conv broadcast write" on realtime.messages';
    execute $p$
      drop policy if exists "vexchat conv broadcast read" on realtime.messages;
create policy "vexchat conv broadcast read" on realtime.messages for select to authenticated
      using (extension = 'broadcast' and case when realtime.topic() ~ '^conv:[0-9a-f-]{36}$'
             then public.is_member(substr(realtime.topic(), 6)::uuid, auth.uid()) else false end)
    $p$;
    execute $p$
      drop policy if exists "vexchat conv broadcast write" on realtime.messages;
create policy "vexchat conv broadcast write" on realtime.messages for insert to authenticated
      with check (extension = 'broadcast' and case when realtime.topic() ~ '^conv:[0-9a-f-]{36}$'
             then public.is_member(substr(realtime.topic(), 6)::uuid, auth.uid()) else false end)
    $p$;
  end if;
exception when others then
  raise notice 'Realtime authorization not configured: %', sqlerrm;
end $$;

-- ---------- 39. Фоновые задачи (pg_cron, если доступен) ----------
-- Без pg_cron: исчезающие сообщения всё равно скрываются политикой RLS (expires_at),
-- но физически не удаляются; запланированные сообщения становятся видимыми по времени,
-- но уведомление о них не отправляется; зависшие звонки закрываются при следующем start_call.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('vexchat-purge-expired', '*/10 * * * *', 'select public.purge_expired_messages()');
    perform cron.schedule('vexchat-scheduled', '* * * * *', 'select public.deliver_scheduled_notifications()');
    perform cron.schedule('vexchat-stale-calls', '* * * * *', 'select public.expire_stale_calls()');
  else
    raise notice 'pg_cron is not available: background jobs are NOT scheduled';
  end if;
exception when others then
  raise notice 'pg_cron setup skipped: %', sqlerrm;
end $$;
