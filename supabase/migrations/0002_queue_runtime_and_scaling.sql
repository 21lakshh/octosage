create extension if not exists pgmq;

do $$
begin
  if not exists (
    select 1
    from pg_tables
    where schemaname = 'pgmq'
      and tablename = 'q_ownership_analysis'
  ) then
    perform pgmq.create('ownership_analysis');
  end if;
end
$$;

alter table public.analysis_runs
  drop constraint if exists analysis_runs_status_check;

alter table public.analysis_runs
  add constraint analysis_runs_status_check
  check (status in ('queued', 'leased', 'processing', 'completed', 'failed', 'dead_letter'));

alter table public.analysis_runs
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists leased_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists worker_id text,
  add column if not exists last_error_code text,
  add column if not exists last_error_message text,
  add column if not exists processed_commit_count integer not null default 0,
  add column if not exists selected_commit_count integer not null default 0;

alter table public.analysis_snapshots
  add column if not exists analysis_mode text not null default 'full',
  add column if not exists commit_count_processed integer not null default 0,
  add column if not exists tree_file_count integer not null default 0,
  add column if not exists degraded_reason text;

create table if not exists public.repository_processing_locks (
  repository_id uuid primary key references public.repositories(id) on delete cascade,
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  worker_id text not null,
  leased_at timestamptz not null default timezone('utc', now()),
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists analysis_runs_status_requested_idx
  on public.analysis_runs(status, requested_at desc);

create index if not exists analysis_runs_lease_expires_idx
  on public.analysis_runs(lease_expires_at);

create index if not exists repository_processing_locks_lease_idx
  on public.repository_processing_locks(lease_expires_at);

drop trigger if exists repository_processing_locks_set_updated_at on public.repository_processing_locks;
create trigger repository_processing_locks_set_updated_at
before update on public.repository_processing_locks
for each row
execute function public.set_updated_at();

alter table public.repository_processing_locks enable row level security;

grant all privileges on public.repository_processing_locks to service_role;

create or replace function public.enqueue_ownership_analysis_job(
  payload jsonb,
  delay_seconds integer default 0
)
returns bigint
language sql
security definer
set search_path = public, pgmq
as $$
  select * from pgmq.send('ownership_analysis', payload, delay_seconds) limit 1;
$$;

create or replace function public.read_ownership_analysis_jobs(
  vt_seconds integer default 900,
  qty integer default 1,
  max_poll_seconds integer default 5
)
returns table (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
language sql
security definer
set search_path = public, pgmq
as $$
  select msg_id, read_ct, enqueued_at, vt, message
  from pgmq.read_with_poll('ownership_analysis', vt_seconds, qty, max_poll_seconds);
$$;

create or replace function public.delete_ownership_analysis_job(target_msg_id bigint)
returns boolean
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.delete('ownership_analysis', target_msg_id);
$$;

create or replace function public.archive_ownership_analysis_job(target_msg_id bigint)
returns boolean
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.archive('ownership_analysis', target_msg_id);
$$;

create or replace function public.extend_ownership_analysis_job_visibility(
  target_msg_id bigint,
  vt_seconds integer
)
returns table (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
language sql
security definer
set search_path = public, pgmq
as $$
  select msg_id, read_ct, enqueued_at, vt, message
  from pgmq.set_vt('ownership_analysis', target_msg_id, vt_seconds);
$$;

create or replace function public.acquire_repository_processing_lock(
  target_repository_id uuid,
  target_run_id uuid,
  target_worker_id text,
  lease_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_lease_time timestamptz := now();
  target_expiry timestamptz := current_lease_time + make_interval(secs => lease_seconds);
begin
  insert into public.repository_processing_locks (
    repository_id,
    run_id,
    worker_id,
    leased_at,
    lease_expires_at,
    updated_at
  )
  values (
    target_repository_id,
    target_run_id,
    target_worker_id,
    current_lease_time,
    target_expiry,
    current_lease_time
  )
  on conflict (repository_id) do update
  set
    run_id = excluded.run_id,
    worker_id = excluded.worker_id,
    leased_at = excluded.leased_at,
    lease_expires_at = excluded.lease_expires_at,
    updated_at = current_lease_time
  where public.repository_processing_locks.lease_expires_at <= current_lease_time
     or (
       public.repository_processing_locks.run_id = target_run_id
       and public.repository_processing_locks.worker_id = target_worker_id
     );

  return exists (
    select 1
    from public.repository_processing_locks
    where repository_id = target_repository_id
      and run_id = target_run_id
      and worker_id = target_worker_id
      and lease_expires_at > current_lease_time
  );
end;
$$;

create or replace function public.renew_repository_processing_lock(
  target_repository_id uuid,
  target_run_id uuid,
  target_worker_id text,
  lease_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_lease_time timestamptz := now();
begin
  update public.repository_processing_locks
  set
    leased_at = current_lease_time,
    lease_expires_at = current_lease_time + make_interval(secs => lease_seconds),
    updated_at = current_lease_time
  where repository_id = target_repository_id
    and run_id = target_run_id
    and worker_id = target_worker_id;

  return found;
end;
$$;

create or replace function public.release_repository_processing_lock(
  target_repository_id uuid,
  target_run_id uuid,
  target_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.repository_processing_locks
  where repository_id = target_repository_id
    and run_id = target_run_id
    and worker_id = target_worker_id;

  return found;
end;
$$;

grant execute on function public.enqueue_ownership_analysis_job(jsonb, integer) to service_role;
grant execute on function public.read_ownership_analysis_jobs(integer, integer, integer) to service_role;
grant execute on function public.delete_ownership_analysis_job(bigint) to service_role;
grant execute on function public.archive_ownership_analysis_job(bigint) to service_role;
grant execute on function public.extend_ownership_analysis_job_visibility(bigint, integer) to service_role;
grant execute on function public.acquire_repository_processing_lock(uuid, uuid, text, integer) to service_role;
grant execute on function public.renew_repository_processing_lock(uuid, uuid, text, integer) to service_role;
grant execute on function public.release_repository_processing_lock(uuid, uuid, text) to service_role;
