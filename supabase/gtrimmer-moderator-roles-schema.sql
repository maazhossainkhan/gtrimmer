-- Store limited moderator grants separately from full administrator access.
create table if not exists public.gtrimmer_moderator_roles (
  telegram_id text primary key check (telegram_id ~ '^[0-9]{1,20}$'),
  username text,
  display_name text not null default 'Telegram user',
  is_active boolean not null default true,
  granted_by_telegram_id text,
  granted_by_user_id text,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists gtrimmer_moderator_roles_active_idx
  on public.gtrimmer_moderator_roles (is_active, granted_at desc);

alter table public.gtrimmer_moderator_roles enable row level security;
revoke all on table public.gtrimmer_moderator_roles from anon, authenticated;
grant all on table public.gtrimmer_moderator_roles to service_role;

comment on table public.gtrimmer_moderator_roles is
  'Limited Google Trim moderators; they may only review and approve/reject pending access requests.';
