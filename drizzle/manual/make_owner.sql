-- ВЫПОЛНЯТЬ ВРУЧНУЮ в SQL-редакторе, ОДИН раз, после регистрации вашего аккаунта в приложении.
-- Через интерфейс роль Owner выдать нельзя (так задумано). Замените e-mail на свой.
insert into public.user_roles (user_id, role)
select id, 'owner' from auth.users where email = 'ВАШ_EMAIL@example.com'
on conflict (user_id, role) do nothing;

-- Проверка:
select u.email, r.role from public.user_roles r join auth.users u on u.id = r.user_id;
