-- Кілька бірж для ключів на сервері: binance (тестнет Binance Futures) і bybit (Bybit Demo Trading).
-- Замінює функції з міграції 20261116130000_exchange_testnet_keys.sql (додано параметр p_exchange).
-- Обидва варіанти — без реальних коштів; адреси бірж зашиті в Edge Function `exchange`.

drop function if exists public.ex_save(text, text);
drop function if exists public.ex_delete();
drop function if exists public.ex_secret_for(uuid);

create or replace function public.ex_save(p_key text, p_secret text, p_exchange text default 'binance')
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); sid uuid; cid uuid; payload text; lbl text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not private.mfa_ok() then raise exception 'mfa required'; end if;
  if p_exchange not in ('binance', 'bybit') then raise exception 'unsupported exchange'; end if;
  p_key := btrim(coalesce(p_key, '')); p_secret := btrim(coalesce(p_secret, ''));
  if p_key !~ '^[A-Za-z0-9]{10,128}$' or p_secret !~ '^[A-Za-z0-9]{10,128}$' then raise exception 'invalid key format'; end if;
  lbl := case p_exchange when 'bybit' then 'Bybit Demo Trading' else 'Binance Futures Testnet' end;
  payload := json_build_object('key', p_key, 'secret', p_secret)::text;
  select id, vault_secret_id into cid, sid from public.exchange_connections
   where user_id = uid and exchange = p_exchange and is_testnet;
  if sid is null then
    sid := vault.create_secret(payload, 'ex_' || uid::text || '_' || p_exchange || '_testnet', 'Orbix ' || lbl || ' API key');
  else
    perform vault.update_secret(sid, payload);
  end if;
  if cid is null then
    insert into public.exchange_connections (user_id, exchange, label, is_testnet, vault_secret_id, key_hint, can_trade, can_withdraw, status)
    values (uid, p_exchange, lbl, true, sid, right(p_key, 4), false, false, 'pending')
    returning id into cid;
  else
    update public.exchange_connections set vault_secret_id = sid, key_hint = right(p_key, 4), status = 'pending',
      can_trade = false, last_checked_at = null, updated_at = now() where id = cid;
  end if;
  return cid;
end $$;

create or replace function public.ex_delete(p_exchange text default 'binance')
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); sid uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not private.mfa_ok() then raise exception 'mfa required'; end if;
  delete from public.exchange_connections where user_id = uid and exchange = p_exchange and is_testnet
  returning vault_secret_id into sid;
  if sid is not null then delete from vault.secrets where id = sid; end if;
end $$;

create or replace function public.ex_secret_for(p_uid uuid, p_exchange text default 'binance')
returns table (conn_id uuid, api_key text, api_secret text) language sql stable security definer set search_path = '' as $$
  select c.id, (d.decrypted_secret::json)->>'key', (d.decrypted_secret::json)->>'secret'
  from public.exchange_connections c join vault.decrypted_secrets d on d.id = c.vault_secret_id
  where c.user_id = p_uid and c.exchange = p_exchange and c.is_testnet
$$;

revoke all on function public.ex_save(text, text, text), public.ex_delete(text), public.ex_secret_for(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ex_save(text, text, text), public.ex_delete(text) to authenticated;
grant execute on function public.ex_secret_for(uuid, text) to service_role;
