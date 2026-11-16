-- Ключі API біржі на сервері: зберігаються в Supabase Vault (JSON {key, secret}), браузер їх не бачить.
-- Цей етап — лише тестнет Binance Futures (is_testnet = true). Edge Function `exchange` сама обмежена тестнетом.
-- Залежить від private.mfa_ok() (міграція require_aal2_when_mfa_enrolled).

-- Зберегти або замінити ключі тестнету
create or replace function public.ex_save(p_key text, p_secret text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); sid uuid; cid uuid; payload text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not private.mfa_ok() then raise exception 'mfa required'; end if;
  p_key := btrim(coalesce(p_key, '')); p_secret := btrim(coalesce(p_secret, ''));
  if p_key !~ '^[A-Za-z0-9]{20,128}$' or p_secret !~ '^[A-Za-z0-9]{20,128}$' then raise exception 'invalid key format'; end if;
  payload := json_build_object('key', p_key, 'secret', p_secret)::text;
  select id, vault_secret_id into cid, sid from public.exchange_connections
   where user_id = uid and exchange = 'binance' and is_testnet;
  if sid is null then
    sid := vault.create_secret(payload, 'ex_' || uid::text || '_binance_testnet', 'Orbix Binance Futures testnet API key');
  else
    perform vault.update_secret(sid, payload);
  end if;
  if cid is null then
    insert into public.exchange_connections (user_id, exchange, label, is_testnet, vault_secret_id, key_hint, can_trade, can_withdraw, status)
    values (uid, 'binance', 'Binance Futures Testnet', true, sid, right(p_key, 4), false, false, 'pending')
    returning id into cid;
  else
    update public.exchange_connections set vault_secret_id = sid, key_hint = right(p_key, 4), status = 'pending',
      can_trade = false, last_checked_at = null, updated_at = now() where id = cid;
  end if;
  return cid;
end $$;

-- Видалити ключі тестнету разом із секретом у Vault
create or replace function public.ex_delete()
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); sid uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not private.mfa_ok() then raise exception 'mfa required'; end if;
  delete from public.exchange_connections where user_id = uid and exchange = 'binance' and is_testnet
  returning vault_secret_id into sid;
  if sid is not null then delete from vault.secrets where id = sid; end if;
end $$;

-- Чи пройшов поточний користувач 2FA (для Edge Function, викликається з JWT користувача)
create or replace function public.mfa_ok_now()
returns boolean language sql stable security definer set search_path = '' as $$ select private.mfa_ok() $$;

-- Розшифровані ключі — лише для сервера (service_role)
create or replace function public.ex_secret_for(p_uid uuid)
returns table (conn_id uuid, api_key text, api_secret text) language sql stable security definer set search_path = '' as $$
  select c.id, (d.decrypted_secret::json)->>'key', (d.decrypted_secret::json)->>'secret'
  from public.exchange_connections c join vault.decrypted_secrets d on d.id = c.vault_secret_id
  where c.user_id = p_uid and c.exchange = 'binance' and c.is_testnet
$$;

revoke all on function public.ex_save(text, text), public.ex_delete(), public.mfa_ok_now(), public.ex_secret_for(uuid)
  from public, anon, authenticated;
grant execute on function public.ex_save(text, text), public.ex_delete(), public.mfa_ok_now() to authenticated;
grant execute on function public.ex_secret_for(uuid) to service_role;
