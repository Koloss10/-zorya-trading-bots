-- Бета-тест: відгуки учасників прямо з Orbix (Меню → «Відгук»).
-- Учасник додає й бачить лише свої відгуки; адмін бачить усі з ID автора (profiles.public_no) і ніком, без пошти.
-- Антиспам: не більше 20 відгуків на користувача за добу. Сервер runner/exchange не зачіпається.

create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('bug', 'idea', 'other')),
  body text not null check (char_length(body) between 3 and 2000),
  page text check (char_length(page) <= 40),
  status text not null default 'new' check (status in ('new', 'done')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_user_id_idx on public.feedback (user_id);
create index if not exists feedback_created_at_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;
revoke all on public.feedback from anon;
revoke update, delete, truncate on public.feedback from authenticated;
grant select, insert on public.feedback to authenticated;

drop policy if exists "own feedback select" on public.feedback;
create policy "own feedback select" on public.feedback for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "own feedback insert" on public.feedback;
create policy "own feedback insert" on public.feedback for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "mfa required when enrolled" on public.feedback;
create policy "mfa required when enrolled" on public.feedback as restrictive for all to authenticated
  using ((select private.mfa_ok())) with check ((select private.mfa_ok()));

-- автор і статус — завжди свої; ліміт 20 на добу
create or replace function private.feedback_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.user_id := auth.uid();
  new.status := 'new';
  new.created_at := now();
  if new.user_id is null then
    raise exception 'Увійдіть в акаунт, щоб надіслати відгук' using errcode = '42501';
  end if;
  if (select count(*) from public.feedback f
      where f.user_id = new.user_id and f.created_at > now() - interval '1 day') >= 20 then
    raise exception 'Забагато відгуків за добу — спробуйте завтра' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists feedback_guard on public.feedback;
create trigger feedback_guard before insert on public.feedback
  for each row execute function private.feedback_guard();

-- адмін: список відгуків (без пошти)
create or replace function public.admin_feedback(p_status text default null, p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.admins a where a.user_id = (select auth.uid())) then
    raise exception 'Лише для адміністратора' using errcode = '42501';
  end if;
  if not private.mfa_ok() then
    raise exception 'Потрібен вхід із кодом 2FA' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'new', (select count(*) from public.feedback where status = 'new'),
    'total', (select count(*) from public.feedback),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'no', x.public_no, 'nick', x.display_name, 'kind', x.kind,
                                          'body', x.body, 'page', x.page, 'status', x.status, 'at', x.created_at)
                       order by x.created_at desc)
      from (select f.*, p.public_no, p.display_name
            from public.feedback f left join public.profiles p on p.id = f.user_id
            where p_status is null or f.status = p_status
            order by f.created_at desc
            limit greatest(1, least(coalesce(p_limit, 100), 500))) x), '[]'::jsonb));
end $$;
revoke all on function public.admin_feedback(text, int) from public, anon;
grant execute on function public.admin_feedback(text, int) to authenticated;

-- адмін: позначити відгук розглянутим або повернути в нові
create or replace function public.admin_feedback_set(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.admins a where a.user_id = (select auth.uid())) then
    raise exception 'Лише для адміністратора' using errcode = '42501';
  end if;
  if not private.mfa_ok() then
    raise exception 'Потрібен вхід із кодом 2FA' using errcode = '42501';
  end if;
  if p_status not in ('new', 'done') then
    raise exception 'Невідомий статус' using errcode = '22023';
  end if;
  update public.feedback set status = p_status where id = p_id;
end $$;
revoke all on function public.admin_feedback_set(bigint, text) from public, anon;
grant execute on function public.admin_feedback_set(bigint, text) to authenticated;
