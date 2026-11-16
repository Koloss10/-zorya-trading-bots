-- Боти на сервері 24/7: стан ботів, перевірка секрету розкладу, список ботів для runner, розклад pg_cron.
-- Залежить від private.mfa_ok(), ex_secret_for(uuid, text), tg_secret_for(uuid).

create table if not exists public.bot_state (
  bot_id     uuid primary key references public.bots(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.bot_state enable row level security;
drop policy if exists "own bot state read" on public.bot_state;
create policy "own bot state read" on public.bot_state for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "mfa required when enrolled" on public.bot_state;
create policy "mfa required when enrolled" on public.bot_state as restrictive for all to authenticated
  using ((select private.mfa_ok())) with check ((select private.mfa_ok()));

-- секрет, яким розклад підписує виклик функції runner (зберігається у Vault)
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'orbix_runner_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'orbix_runner_secret', 'Orbix bot runner (pg_cron → Edge Function)');
  end if;
end $$;

create or replace function public.runner_check(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select length(coalesce(p_token, '')) >= 32
     and exists (select 1 from vault.decrypted_secrets where name = 'orbix_runner_secret' and decrypted_secret = p_token)
$$;

-- активні серверні боти разом зі збереженим станом
create or replace function public.runner_bots()
returns table (id uuid, user_id uuid, config jsonb, state jsonb) language sql stable security definer set search_path = '' as $$
  select b.id, b.user_id, b.config, s.state
  from public.bots b left join public.bot_state s on s.bot_id = b.id
  where b.status = 'running' and coalesce((b.config ->> '_srv')::boolean, false)
$$;

revoke all on function public.runner_check(text), public.runner_bots() from public, anon, authenticated;
grant execute on function public.runner_check(text), public.runner_bots() to service_role;

-- розклад: кожні 5 хвилин викликати runner
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.schedule('orbix-runner', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://krmnaypaitruhqgaxkfw.supabase.co/functions/v1/runner',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-runner-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'orbix_runner_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
$cron$);
