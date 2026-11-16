-- Двофакторний вхід на рівні бази даних.
-- Якщо користувач увімкнув TOTP (Google Authenticator), його дані доступні лише з сесією aal2
-- (після введення коду). Для користувачів без 2FA нічого не змінюється.
--
-- Звичайна роль authenticated не має доступу до auth.mfa_factors, тому перевірка винесена
-- у функцію security definer у схемі private (вона не доступна через API PostgREST).
-- Застосовано вручну в SQL-редакторі Supabase 16.11.2026.

create schema if not exists private;

create or replace function private.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = (select auth.uid()) and f.status = 'verified')
$$;

revoke all on function private.mfa_ok() from public;
grant usage on schema private to authenticated;
grant execute on function private.mfa_ok() to authenticated;

do $$ declare t text; begin
  foreach t in array array['profiles','bots','backtests','favorite_presets','bot_deals','bot_events','orders','exchange_connections'] loop
    execute format('drop policy if exists "mfa required when enrolled" on public.%I', t);
    execute format('create policy "mfa required when enrolled" on public.%I as restrictive for all to authenticated using ((select private.mfa_ok())) with check ((select private.mfa_ok()))', t);
  end loop;
end $$;
