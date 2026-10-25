-- Google Trim by Shadow: invite/request-based Telegram access control
-- Run this script in Supabase SQL Editor before deploying the Edge Function.
-- Tables are protected by RLS and have no policies for browser roles.
-- Only the Edge Function service-role client can read/write access records.

create table if not exists public.gtrimmer_access_users (
  telegram_id text primary key,
  oidc_sub text not null unique,
  username text,
  display_name text not null default 'Telegram user',
  status text not null default 'active' check (status in ('active', 'revoked')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gtrimmer_access_requests (
  telegram_id text primary key,
  oidc_sub text not null,
  username text,
  display_name text not null default 'Telegram user',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

create index if not exists gtrimmer_access_users_status_idx
  on public.gtrimmer_access_users (status, is_admin);

create index if not exists gtrimmer_access_requests_status_idx
  on public.gtrimmer_access_requests (status, requested_at);

alter table public.gtrimmer_access_users enable row level security;
alter table public.gtrimmer_access_requests enable row level security;

-- Remove browser-role grants; all operations go through the validated Edge Function.
revoke all on table public.gtrimmer_access_users from anon, authenticated;
revoke all on table public.gtrimmer_access_requests from anon, authenticated;

comment on table public.gtrimmer_access_users is
  'Private allowlist for Google Trim by Shadow. Access is keyed by verified Telegram numeric account ID.';
comment on table public.gtrimmer_access_requests is
  'Pending access requests created only after a Telegram OIDC ID token is verified server-side.';
