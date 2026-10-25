-- Run this once in Supabase SQL Editor to add Telegram Mini App access records.
-- Existing OIDC approval tables and rows are left intact.

create table if not exists public.gtrimmer_mini_access_users (
  telegram_id text primary key check (telegram_id ~ '^[0-9]{1,20}$'),
  username text,
  display_name text not null default 'Telegram user',
  status text not null default 'active' check (status in ('active', 'revoked')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gtrimmer_mini_access_requests (
  telegram_id text primary key check (telegram_id ~ '^[0-9]{1,20}$'),
  username text,
  display_name text not null default 'Telegram user',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by_telegram_id text
);

create index if not exists gtrimmer_mini_access_users_status_idx
  on public.gtrimmer_mini_access_users (status, is_admin);
create index if not exists gtrimmer_mini_access_requests_status_idx
  on public.gtrimmer_mini_access_requests (status, requested_at);

alter table public.gtrimmer_mini_access_users enable row level security;
alter table public.gtrimmer_mini_access_requests enable row level security;
revoke all on table public.gtrimmer_mini_access_users from anon, authenticated;
revoke all on table public.gtrimmer_mini_access_requests from anon, authenticated;
grant all on table public.gtrimmer_mini_access_users to service_role;
grant all on table public.gtrimmer_mini_access_requests to service_role;

comment on table public.gtrimmer_mini_access_users is
  'Mini App allowlist keyed by Telegram user ID verified from signed Telegram WebApp initData.';
comment on table public.gtrimmer_mini_access_requests is
  'Mini App access requests keyed by verified Telegram user ID.';
