create table if not exists public.dashboard_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_state enable row level security;

create policy "Users can read their dashboard state"
  on public.dashboard_state for select
  using (auth.uid() = user_id);

create policy "Users can insert their dashboard state"
  on public.dashboard_state for insert
  with check (auth.uid() = user_id);

create policy "Users can update their dashboard state"
  on public.dashboard_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);