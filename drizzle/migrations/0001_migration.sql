
create policy "avatars readable by signed-in" on storage.objects for select to authenticated using (bucket_id = 'avatars');
create policy "avatars upload own folder" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars update own folder" on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars delete own folder" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "attachments read by members" on storage.objects for select to authenticated using (
  bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid, auth.uid()));
create policy "attachments upload by members" on storage.objects for insert to authenticated with check (
  bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid, auth.uid())
  and (storage.foldername(name))[2] = auth.uid()::text);
