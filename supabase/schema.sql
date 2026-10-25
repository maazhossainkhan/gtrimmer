-- If an earlier prototype schema exists, drop it only when empty.
-- Never delete existing access records silently; a populated old schema requires a manual migration.
do $$
declare
  has_user_rows boolean := false;
  has_request_rows boolean := false;
begin
  if to_regclass('public.gtrimmer_access_users') is not null
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'gtrimmer_access_users' and column_name = 'user_id'
     ) then
    execute 'select exists(select 1 from public.gtrimmer_access_users limit 1)' into has_user_rows;
    if to_regclass('public.gtrimmer_access_requests') is not null then
      execute 'select exists(select 1 from public.gtrimmer_access_requests limit 1)' into has_request_rows;
    end if;
    if has_user_rows or has_request_rows then
      raise exception 'An older access-control schema contains rows. Back up and migrate those records manually before running this current schema.';
    end if;
    drop table if exists public.gtrimmer_access_requests;
    drop table if exists public.gtrimmer_access_users;
  end if;
end $$;

-- Google Trim by Shadow: admin-approved Telegram access control.
-- Run this in Supabase SQL Editor for a fresh project before deploying the function.
-- Browser roles have no access; access checks go through the validated Edge Function.

create table if not exists public.gtrimmer_access_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  telegram_id text,
  username text,
  display_name text not null default 'Telegram user',
  status text not null default 'active' check (status in ('active', 'revoked')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gtrimmer_access_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  telegram_id text,
  username text,
  display_name text not null default 'Telegram user',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

create index if not exists gtrimmer_access_users_status_idx on public.gtrimmer_access_users (status, is_admin);
create index if not exists gtrimmer_access_requests_status_idx on public.gtrimmer_access_requests (status, requested_at);

alter table public.gtrimmer_access_users enable row level security;
alter table public.gtrimmer_access_requests enable row level security;
revoke all on table public.gtrimmer_access_users from anon, authenticated;
revoke all on table public.gtrimmer_access_requests from anon, authenticated;
grant all on table public.gtrimmer_access_users to service_role;
grant all on table public.gtrimmer_access_requests to service_role;

comment on table public.gtrimmer_access_users is
  'Private allowlist for Google Trim by Shadow. Approval is keyed by immutable Supabase Auth user ID.';
comment on table public.gtrimmer_access_requests is
  'Private access requests created after a verified Telegram custom OIDC sign-in through Supabase Auth.';
