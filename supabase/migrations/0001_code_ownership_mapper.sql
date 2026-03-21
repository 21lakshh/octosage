create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'github'),
  provider_user_id text not null,
  login text not null,
  access_token_encrypted text not null,
  token_expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, provider)
);

create table if not exists public.repositories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'github'),
  provider_repo_id bigint not null,
  owner_login text not null,
  name text not null,
  full_name text not null,
  default_branch text not null,
  is_private boolean not null default true,
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, provider, provider_repo_id)
);

create table if not exists public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  repository_id uuid not null references public.repositories(id) on delete cascade,
  status text not null check (status in ('queued', 'processing', 'completed', 'failed')) default 'queued',
  requested_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  finished_at timestamptz,
  progress_phase text not null default 'queued',
  progress_pct integer not null default 0,
  error_message text,
  commit_window_start timestamptz not null,
  commit_window_end timestamptz not null,
  commit_limit integer not null default 500,
  snapshot_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.analysis_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  repository_id uuid not null references public.repositories(id) on delete cascade,
  analysis_run_id uuid not null references public.analysis_runs(id) on delete cascade,
  generated_at timestamptz not null default timezone('utc', now()),
  high_risk_modules integer not null default 0,
  healthy_modules integer not null default 0,
  leading_owner_coverage numeric(8,6) not null default 0,
  node_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.analysis_runs
  add constraint analysis_runs_snapshot_id_fkey
  foreign key (snapshot_id) references public.analysis_snapshots(id) on delete set null;

create table if not exists public.analysis_nodes (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  path text not null,
  label text not null,
  node_type text not null check (node_type in ('file', 'folder')),
  depth integer not null,
  parent_path text,
  leading_owner_id text,
  leading_owner_share numeric(8,6) not null default 0,
  bus_factor integer not null default 1,
  risk_level text not null check (risk_level in ('critical', 'warning', 'healthy')),
  raw_score_total numeric(12,4) not null default 0,
  file_count integer not null default 0,
  owner_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  unique (snapshot_id, path)
);

create table if not exists public.analysis_node_owners (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  node_path text not null,
  owner_key text not null,
  owner_login text,
  display_name text not null,
  normalized_score numeric(8,6) not null default 0,
  raw_score numeric(12,4) not null default 0,
  rank integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (snapshot_id, node_path, owner_key)
);

create table if not exists public.analysis_graph_edges (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  source_path text not null,
  target_path text not null,
  edge_type text not null check (edge_type = 'parent') default 'parent',
  label text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (snapshot_id, source_path, target_path)
);

create index if not exists repositories_user_id_idx on public.repositories(user_id);
create index if not exists analysis_runs_repository_id_idx on public.analysis_runs(repository_id, requested_at desc);
create index if not exists analysis_snapshots_repository_id_idx on public.analysis_snapshots(repository_id, generated_at desc);
create index if not exists analysis_nodes_snapshot_id_idx on public.analysis_nodes(snapshot_id);
create index if not exists analysis_node_owners_snapshot_id_idx on public.analysis_node_owners(snapshot_id);
create index if not exists analysis_graph_edges_snapshot_id_idx on public.analysis_graph_edges(snapshot_id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists connected_accounts_set_updated_at on public.connected_accounts;
create trigger connected_accounts_set_updated_at
before update on public.connected_accounts
for each row
execute function public.set_updated_at();

drop trigger if exists repositories_set_updated_at on public.repositories;
create trigger repositories_set_updated_at
before update on public.repositories
for each row
execute function public.set_updated_at();

drop trigger if exists analysis_runs_set_updated_at on public.analysis_runs;
create trigger analysis_runs_set_updated_at
before update on public.analysis_runs
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.repositories enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.analysis_snapshots enable row level security;
alter table public.analysis_nodes enable row level security;
alter table public.analysis_node_owners enable row level security;
alter table public.analysis_graph_edges enable row level security;

grant usage on schema public to authenticated, service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;

create policy "profiles are visible to owner" on public.profiles
for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "connected accounts are visible to owner" on public.connected_accounts
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "repositories are visible to owner" on public.repositories
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "analysis runs are visible to owner" on public.analysis_runs
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "analysis snapshots are visible to owner" on public.analysis_snapshots
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "analysis nodes are visible through snapshot ownership" on public.analysis_nodes
for select using (
  exists (
    select 1
    from public.analysis_snapshots snapshots
    where snapshots.id = analysis_nodes.snapshot_id
      and snapshots.user_id = auth.uid()
  )
);

create policy "analysis node owners are visible through snapshot ownership" on public.analysis_node_owners
for select using (
  exists (
    select 1
    from public.analysis_snapshots snapshots
    where snapshots.id = analysis_node_owners.snapshot_id
      and snapshots.user_id = auth.uid()
  )
);

create policy "analysis graph edges are visible through snapshot ownership" on public.analysis_graph_edges
for select using (
  exists (
    select 1
    from public.analysis_snapshots snapshots
    where snapshots.id = analysis_graph_edges.snapshot_id
      and snapshots.user_id = auth.uid()
  )
);
