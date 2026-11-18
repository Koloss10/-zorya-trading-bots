-- Бета-тест: ID акаунта й адмін-статистика.
--
-- 1. profiles.public_no — постійний порядковий ID акаунта (#1, #2, …): наявним — за датою реєстрації,
--    новим — наступний номер. Користувач не може його змінити (тригер повертає старе значення).
-- 2. private.admins — хто бачить статистику (схема private недоступна через API).
-- 3. public.is_admin() — чи поточний користувач адмін (для показу розділу «Адмін»).
-- 4. public.admin_stats() — зведена статистика без пошти, ключів, паролів і сум:
--    кількість користувачів, популярні налаштування ботів, результати у % (лише серверні боти зі станом),
--    список акаунтів за ID. Вимагає 2FA-сесію (aal2), якщо в адміна увімкнена 2FA.
-- Сервер runner/exchange ця міграція не зачіпає.

-- 1. ID акаунта
create sequence if not exists public.profiles_public_no_seq;
alter table public.profiles add column if not exists public_no integer;

with o as (
  select p.id, row_number() over (order by u.created_at, p.id) as n
  from public.profiles p join auth.users u on u.id = p.id
  where p.public_no is null
)
update public.profiles p set public_no = o.n from o where o.id = p.id;

select setval('public.profiles_public_no_seq', greatest(coalesce((select max(public_no) from public.profiles), 0), 1),
              (select max(public_no) from public.profiles) is not null);
alter table public.profiles alter column public_no set default nextval('public.profiles_public_no_seq');
alter sequence public.profiles_public_no_seq owned by public.profiles.public_no;
create unique index if not exists profiles_public_no_key on public.profiles (public_no);

create or replace function private.keep_public_no() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.public_no := old.public_no;
  return new;
end $$;
drop trigger if exists profiles_keep_public_no on public.profiles;
create trigger profiles_keep_public_no before update on public.profiles
  for each row execute function private.keep_public_no();

-- 2. Адміни
create table if not exists private.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on private.admins from public, anon, authenticated;
-- перший акаунт власника платформи (#1)
insert into private.admins (user_id)
  select id from auth.users where id = 'b6ab7298-0d71-48c7-ad35-ab54e2876cd5'
  on conflict do nothing;

-- 3. Чи поточний користувач адмін
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admins a where a.user_id = (select auth.uid()))
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- 4. Статистика
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb;
begin
  if not exists (select 1 from private.admins a where a.user_id = (select auth.uid())) then
    raise exception 'Лише для адміністратора' using errcode = '42501';
  end if;
  if not private.mfa_ok() then
    raise exception 'Потрібен вхід із кодом 2FA' using errcode = '42501';
  end if;

  with
  u as (
    select u.id, u.created_at, u.last_sign_in_at, p.public_no, p.display_name
    from auth.users u left join public.profiles p on p.id = u.id
  ),
  b as (
    select b.id, b.user_id, b.status, b.symbol, b.side, b.max_budget, b.config,
           coalesce((b.config->>'_srv')::boolean, false) as srv,
           coalesce((b.config->>'_tn')::boolean, false) as tn,
           coalesce(nullif(b.config->>'tf', '')::int, 1) as tf,
           coalesce(nullif(b.config->>'lev', '')::numeric, 1) as lev
    from public.bots b
  ),
  -- результати лише в серверних ботів зі станом; % від повної драбини бота, сум назовні немає
  res as (
    select b.user_id, b.symbol,
           case when b.max_budget > 0 then coalesce((s.state->'b'->>'cum')::numeric, 0) / b.max_budget * 100 end as roi,
           jsonb_array_length(coalesce(s.state->'b'->'tr', '[]'::jsonb)) as ntr,
           (select count(*) from jsonb_array_elements(coalesce(s.state->'b'->'tr', '[]'::jsonb)) t
             where (t->>'pnl')::numeric > 0) as wins
    from b join public.bot_state s on s.bot_id = b.id
  ),
  rt as (select * from res where ntr > 0)
  select jsonb_build_object(
    'at', now(),
    'users', jsonb_build_object(
      'total', (select count(*) from u),
      'new7', (select count(*) from u where created_at > now() - interval '7 days'),
      'new30', (select count(*) from u where created_at > now() - interval '30 days'),
      'active7', (select count(*) from u where last_sign_in_at > now() - interval '7 days'),
      'mfa', (select count(distinct f.user_id) from auth.mfa_factors f where f.status = 'verified'),
      'demo', (select count(distinct c.user_id) from public.exchange_connections c where c.status = 'active')
    ),
    'bots', jsonb_build_object(
      'total', (select count(*) from b),
      'running', (select count(*) from b where status = 'running'),
      'srv', (select count(*) from b where srv),
      'tn', (select count(*) from b where tn),
      'pairs', coalesce((select jsonb_agg(jsonb_build_object('k', symbol, 'n', n) order by n desc, symbol)
                         from (select symbol, count(*) n from b group by symbol order by n desc, symbol limit 10) x), '[]'::jsonb),
      'tf', coalesce((select jsonb_agg(jsonb_build_object('k', tf, 'n', n) order by tf)
                      from (select tf, count(*) n from b group by tf) x), '[]'::jsonb),
      'side', coalesce((select jsonb_agg(jsonb_build_object('k', side, 'n', n) order by n desc)
                        from (select side, count(*) n from b group by side) x), '[]'::jsonb),
      'sg', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc, k)
                      from (select s.k, count(*) n from b, jsonb_array_elements_text(coalesce(b.config->'sg', '[]'::jsonb)) s(k)
                            group by s.k) x), '[]'::jsonb),
      'lev', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n) order by o)
                       from (select case when lev <= 1 then '1×' when lev <= 3 then '2–3×' when lev <= 10 then '4–10×' else '>10×' end k,
                                    case when lev <= 1 then 1 when lev <= 3 then 2 when lev <= 10 then 3 else 4 end o, count(*) n
                             from b group by 1, 2) x), '[]'::jsonb)
    ),
    'results', jsonb_build_object(
      'bots', (select count(*) from res),
      'traded', (select count(*) from rt),
      'trades', (select coalesce(sum(ntr), 0) from rt),
      'avg_roi', (select round(avg(roi), 2) from rt),
      'med_roi', (select round((percentile_cont(0.5) within group (order by roi))::numeric, 2) from rt),
      'win_bots', (select case when count(*) > 0 then round(100.0 * count(*) filter (where roi > 0) / count(*), 1) end from rt),
      'win_trades', (select case when sum(ntr) > 0 then round(100.0 * sum(wins) / sum(ntr), 1) end from rt),
      'pairs', coalesce((select jsonb_agg(jsonb_build_object('k', symbol, 'n', n, 'roi', roi) order by roi desc)
                         from (select symbol, count(*) n, round(avg(roi), 2) roi from rt group by symbol having count(*) >= 1) x), '[]'::jsonb)
    ),
    'accounts', coalesce((select jsonb_agg(a order by (a->>'id')::int) from (
      select jsonb_build_object(
        'id', u.public_no,
        'nick', u.display_name,
        'since', to_char(u.created_at, 'YYYY-MM'),
        'seen', to_char(u.last_sign_in_at, 'YYYY-MM-DD'),
        'bots', (select count(*) from b where b.user_id = u.id),
        'run', (select count(*) from b where b.user_id = u.id and b.status = 'running'),
        'srv', (select count(*) from b where b.user_id = u.id and b.srv),
        'tn', (select count(*) from b where b.user_id = u.id and b.tn),
        'trades', (select coalesce(sum(ntr), 0) from rt where rt.user_id = u.id),
        'roi', (select round(avg(roi), 2) from rt where rt.user_id = u.id),
        'win', (select case when sum(ntr) > 0 then round(100.0 * sum(wins) / sum(ntr), 1) end from rt where rt.user_id = u.id)
      ) a from u
    ) z), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;
