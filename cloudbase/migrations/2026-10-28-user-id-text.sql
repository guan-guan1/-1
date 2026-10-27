-- =============================================================
-- 迁移 2026-10-28：user_id 由 uuid 改为 text
-- 背景：CloudBase PG 模式的登录用户 ID 是 19 位数字字符串（如 "2115136407327477760"），
--       不是 UUID。原表把 user_id 建成 uuid，导致首次同步报
--       invalid input syntax for type uuid: "2115136407327477760"
-- 顺序要求（否则 Postgres 报错）：
--   1. 先 drop 掉引用该列的策略，否则报
--      cannot alter type of a column used in a policy definition (SQLSTATE 0A000)
--   2. 先 drop 掉带 ::uuid 的默认值，否则改类型时报默认值无法自动转换
--   3. 再改类型 → 重设默认值 → 重建策略
-- 可重复执行：策略先 drop 再 create，默认值先 drop 再 set。
-- =============================================================

-- 1) 先移除引用 user_id 的三条策略
drop policy if exists "user_checkin_data_select_own" on public.user_checkin_data;
drop policy if exists "user_checkin_data_insert_own" on public.user_checkin_data;
drop policy if exists "user_checkin_data_update_own" on public.user_checkin_data;

-- 2) 移除旧的 uuid 默认值
alter table public.user_checkin_data alter column user_id drop default;

-- 3) 类型改成 text（已有的 uuid 值用 ::text 显式转换）
alter table public.user_checkin_data
  alter column user_id type text using user_id::text;

-- 4) 默认值改为直接取 JWT 的 sub（不再 cast uuid）
alter table public.user_checkin_data
  alter column user_id set default (current_setting('request.jwt.claims', true)::json ->> 'sub');

-- 5) 重建三条 RLS 策略：比较时不再 cast uuid，直接和 sub 的字符串比
create policy "user_checkin_data_select_own" on public.user_checkin_data
  for select to authenticated
  using (user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

create policy "user_checkin_data_insert_own" on public.user_checkin_data
  for insert to authenticated
  with check (user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

create policy "user_checkin_data_update_own" on public.user_checkin_data
  for update to authenticated
  using (user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'))
  with check (user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

-- 6) 自检（可选，单独执行）：
-- select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'user_checkin_data' order by ordinal_position;
-- select policyname, cmd, roles from pg_policies where tablename = 'user_checkin_data';
