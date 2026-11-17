-- Ключ із правом виведення коштів відхиляється: функція exchange (дія check) ставить статус 'revoked',
-- і сервер ботів (runner) такого ключа більше не отримує.
create or replace function public.ex_secret_for(p_uid uuid, p_exchange text default 'binance')
returns table (conn_id uuid, api_key text, api_secret text) language sql stable security definer set search_path = '' as $$
  select c.id, (d.decrypted_secret::json)->>'key', (d.decrypted_secret::json)->>'secret'
  from public.exchange_connections c join vault.decrypted_secrets d on d.id = c.vault_secret_id
  where c.user_id = p_uid and c.exchange = p_exchange and c.is_testnet and c.status <> 'revoked'
$$;

revoke all on function public.ex_secret_for(uuid, text) from public, anon, authenticated;
grant execute on function public.ex_secret_for(uuid, text) to service_role;
