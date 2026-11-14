-- ### Shard Heist online leaderboard: the tables, rules and views in the Supabase project "shard-heist".
-- ### Run it once in the Supabase SQL editor (it can be run again: it drops and rebuilds the views and policies).
-- ### Players sign up with Supabase Auth (email and password; Supabase keeps the passwords, we never see them).
-- ### Everyone may read the leaderboards; a signed-in player may only add their own driver name and their own runs.
-- ### No one can change or delete a run, and the database itself refuses impossible values, so a changed page can't
-- ### write nonsense. The page uses only the public (publishable) key; the secret key is never in the repository.

-- One driver name per account, unique without case ("Alex" and "alex" are the same name)
create table if not exists public.drivers (
  id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 16 and name = btrim(name) and name !~ '[[:cntrl:]<>"&/\\]'),
  created_at timestamptz not null default now()
);
create unique index if not exists drivers_name_lower on public.drivers (lower(name));

-- Every finished run; the time is in seconds, as on the end screen
create table if not exists public.runs (
  id bigint generated always as identity primary key,
  driver_id uuid not null default auth.uid() references public.drivers (id) on delete cascade,
  mode text not null check (mode in ('city', 'highway', 'country')),
  time numeric(6, 2) not null check (time between 10 and 900),
  veh text not null check (veh in ('car', 'bike', 'truck')),
  stars smallint not null check (stars between 1 and 3),
  created_at timestamptz not null default now()
);
create index if not exists runs_mode_time on public.runs (mode, time);
create index if not exists runs_driver on public.runs (driver_id, created_at desc);

alter table public.drivers enable row level security;
alter table public.runs enable row level security;

-- Only the columns a player may set: the id, the owner and the date always come from the database
revoke all on public.drivers, public.runs from anon, authenticated;
grant select on public.drivers, public.runs to anon, authenticated;
grant insert (name) on public.drivers to authenticated;
grant update (name) on public.drivers to authenticated;
grant insert (mode, time, veh, stars) on public.runs to authenticated;

drop policy if exists "drivers are public" on public.drivers;
drop policy if exists "add your own driver" on public.drivers;
drop policy if exists "rename your own driver" on public.drivers;
drop policy if exists "runs are public" on public.runs;
drop policy if exists "add your own run" on public.runs;
create policy "drivers are public" on public.drivers for select to anon, authenticated using (true);
create policy "add your own driver" on public.drivers for insert to authenticated with check (id = (select auth.uid()));
create policy "rename your own driver" on public.drivers for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- A run is added under your own account only, and at most one every 10 seconds (no run of the game is that short)
create policy "runs are public" on public.runs for select to anon, authenticated using (true);
create policy "add your own run" on public.runs for insert to authenticated with check (
  driver_id = (select auth.uid())
  and not exists (select 1 from public.runs r where r.driver_id = (select auth.uid()) and r.created_at > now() - interval '10 seconds')
);

-- ### The two boards: each driver's best run per map, all time and in the current calendar month (Lisbon time).
-- ### security_invoker makes the views obey the rules above.
drop view if exists public.board_all;
drop view if exists public.board_month;
create view public.board_all with (security_invoker = true) as
  select distinct on (r.driver_id, r.mode) r.mode, r.driver_id, d.name, r.time, r.veh, r.stars, r.created_at
  from public.runs r join public.drivers d on d.id = r.driver_id
  order by r.driver_id, r.mode, r.time, r.created_at;
create view public.board_month with (security_invoker = true) as
  select distinct on (r.driver_id, r.mode) r.mode, r.driver_id, d.name, r.time, r.veh, r.stars, r.created_at
  from public.runs r join public.drivers d on d.id = r.driver_id
  where r.created_at >= (date_trunc('month', now() at time zone 'Europe/Lisbon') at time zone 'Europe/Lisbon')
  order by r.driver_id, r.mode, r.time, r.created_at;
grant select on public.board_all, public.board_month to anon, authenticated;
