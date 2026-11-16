-- Telegram-сповіщення через сервер: токен бота зберігається в зашифрованому сховищі Supabase Vault,
-- браузер його не бачить. Надсилає Edge Function tg-notify від імені користувача.
-- Залежить від private.mfa_ok() (міграція require_aal2_when_mfa_enrolled).

create schema if not exists private;

create table if not exists private.tg_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  secret_id  uuid not null,          -- id секрету у vault.secrets (сам токен там, зашифрований)
  chat_id    text not null,
  hint       text,                   -- останні 4 символи токена, щоб користувач упізнав його
  updated_at timestamptz not null default now()
);
alter table private.tg_settings enable row level security;
revoke all on private.tg_settings from public, anon, authenticated;

-- Зберегти або замінити токен і chat id (лише сам користувач, з 2FA — після коду)
create or replace function public.tg_save(p_token text, p_chat text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); sid uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not private.mfa_ok() then raise exception 'mfa required'; end if;
  p_token := btrim(coalesce(p_token, '')); p_chat := btrim(coalesce(p_chat, ''));
  if p_token !~ '^[0-9]{5,15}:[A-Za-z0-9_-]{30,60}$' then raise exception 'invalid token format'; end if;
  if p_chat !~ '^-?[0-9]{3,20}$' and p_chat !~ '^@[A-Za-z0-9_]{5,32}$' then raise exception 'invalid chat id'; end if;
  select secret_id into sid from private.tg_settings where user_id = uid;
  if sid is null then
    sid := vault.create_secret(p_token, 'tg_' || uid::text, 'Orbix Telegram bot token');
  else
    perform vault.update_secret(sid, p_token);
  end if;
  insert into private.tg_settings (user_id, secret_id, chat_id, hint, updated_at)
  values (uid, sid, p_chat, right(p_token, 4), now())
  on conflict (user_id) do update set secret_id = excluded.secret_id, chat_id = excluded.chat_id,
    hint = excluded.hint, updated_at = now();
end $$;

-- Стан без самого токена: чи підключено, останні 4 символи, chat id
create or replace function public.tg_status()
returns json language sql stable security definer set search_path = '' as $$
  select case when private.mfa_ok() then (
    select json_build_object('configured', true, 'hint', s.hint, 'chat_id', s.chat_id, 'updated_at', s.updated_at)
    from private.tg_settings s where s.user_id = auth.uid()) end
$$;

-- Видалити токен із сервера
create or replace function public.tg_clear()
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); sid uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not private.mfa_ok() then raise exception 'mfa required'; end if;
  delete from private.tg_settings where user_id = uid returning secret_id into sid;
  if sid is not null then delete from vault.secrets where id = sid; end if;
end $$;

-- Чи може поточний користувач надсилати (викликає Edge Function з JWT користувача)
create or replace function public.tg_can_send()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.mfa_ok() and exists (select 1 from private.tg_settings where user_id = auth.uid())
$$;

-- Розшифрований токен — лише для сервера (service_role), не для браузера
create or replace function public.tg_secret_for(p_uid uuid)
returns table (token text, chat_id text) language sql stable security definer set search_path = '' as $$
  select d.decrypted_secret, s.chat_id
  from private.tg_settings s join vault.decrypted_secrets d on d.id = s.secret_id
  where s.user_id = p_uid
$$;

revoke all on function public.tg_save(text, text), public.tg_status(), public.tg_clear(), public.tg_can_send(),
  public.tg_secret_for(uuid) from public, anon, authenticated;
grant execute on function public.tg_save(text, text), public.tg_status(), public.tg_clear(), public.tg_can_send()
  to authenticated;
grant execute on function public.tg_secret_for(uuid) to service_role;
