-- Індекс для зовнішнього ключа bot_state.user_id (порадник продуктивності Supabase: unindexed_foreign_keys).
-- Пришвидшує видалення користувача й вибірки стану ботів за користувачем (політики RLS).
create index if not exists bot_state_user_id_idx on public.bot_state (user_id);
