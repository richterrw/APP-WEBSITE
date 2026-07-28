-- Flourish cloud setup
-- Paste this whole file into: Supabase Dashboard → SQL Editor → New query → Run.
-- It creates one table that holds each user's app data, locked down so
-- every user can only read and write their own row.

create table if not exists public.flourish_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.flourish_data enable row level security;

drop policy if exists "Users manage own data" on public.flourish_data;
create policy "Users manage own data"
  on public.flourish_data
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
