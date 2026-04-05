alter table public.repositories
  add column if not exists provider_updated_at timestamptz,
  add column if not exists provider_pushed_at timestamptz;

create index if not exists repositories_user_provider_pushed_at_idx
  on public.repositories(user_id, provider_pushed_at desc nulls last, provider_updated_at desc nulls last);
