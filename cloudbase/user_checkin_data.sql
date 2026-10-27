-- =============================================================
-- 云开发 PostgreSQL（PG 模式）建表脚本：打卡数据 + 行级权限（RLS）
-- 用法：控制台 → 数据库 → SQL 编辑器，整段粘贴执行（或按分号拆成多条逐条执行）。
-- 可重复执行：表用 if not exists，策略先 drop 再 create。
-- 说明：客户端 SDK（app.rdb()）以 JWT 身份访问，PostgREST 会把 JWT 的 sub 放进
--       current_setting('request.jwt.claims')::json->>'sub'，因此 RLS 用它判断“这一行是谁的”。
-- =============================================================

-- 1) 业务表：一个用户一行（user_id = JWT 的 sub，CloudBase 用户 ID 是数字字符串，用 text 存）
-- 注意：不要用 uuid！CloudBase PG 模式的用户 ID 形如 "2115136407327477760"，
--       建成 uuid 会在首次同步时报 invalid input syntax for type uuid。
create table if not exists public.user_checkin_data (
  user_id    text        primary key
               default (current_setting('request.jwt.claims', true)::json ->> 'sub'),
  state      jsonb       not null,
  updated_at timestamptz not null default now()
);

-- 2) 开启行级安全
alter table public.user_checkin_data enable row level security;

-- 3) 表级授权：只给已登录用户 select/insert/update（不需要 delete）
grant select, insert, update on public.user_checkin_data to authenticated;

-- 4) 行级策略：只能读写 user_id = 自己 sub 的行
drop policy if exists "user_checkin_data_select_own" on public.user_checkin_data;
create policy "user_checkin_data_select_own" on public.user_checkin_data
  for select to authenticated
  using (user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

drop policy if exists "user_checkin_data_insert_own" on public.user_checkin_data;
create policy "user_checkin_data_insert_own" on public.user_checkin_data
  for insert to authenticated
  with check (user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

drop policy if exists "user_checkin_data_update_own" on public.user_checkin_data;
create policy "user_checkin_data_update_own" on public.user_checkin_data
  for update to authenticated
  using (user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'))
  with check (user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

-- 5) 自检（可选）：确认表、RLS、策略都存在
-- select relname, relrowsecurity from pg_class where relname = 'user_checkin_data';
-- select policyname, cmd, roles from pg_policies where tablename = 'user_checkin_data';
