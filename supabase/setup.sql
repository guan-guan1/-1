-- Run this once in Supabase Dashboard > SQL Editor.
-- The browser app stores one JSON snapshot per signed-in user.

create table if not exists public.user_checkin_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.user_checkin_data enable row level security;

revoke all on table public.user_checkin_data from anon, authenticated;
grant select, insert, update on table public.user_checkin_data to authenticated;

drop policy if exists "Users can read their own check-in data" on public.user_checkin_data;
create policy "Users can read their own check-in data"
  on public.user_checkin_data for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own check-in data" on public.user_checkin_data;
create policy "Users can insert their own check-in data"
  on public.user_checkin_data for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own check-in data" on public.user_checkin_data;
create policy "Users can update their own check-in data"
  on public.user_checkin_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.update_user_checkin_data_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.update_user_checkin_data_updated_at() from public;

drop trigger if exists update_user_checkin_data_updated_at on public.user_checkin_data;
create trigger update_user_checkin_data_updated_at
  before update on public.user_checkin_data
  for each row execute function public.update_user_checkin_data_updated_at();
