-- Turlx / Google Trim: Universal URL Shortener schema
-- This mirrors the already-created production objects. It is additive and isolated
-- from the Google Share converter tables.

create table if not exists public.gtrimmer_short_links (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null
    check (telegram_id ~ '^[0-9]{1,20}$'),
  short_code varchar(12) not null unique
    check (short_code ~ '^[A-Za-z0-9_-]{5,12}$'),
  destination_url text not null
    check (char_length(destination_url) >= 8 and char_length(destination_url) <= 2048),
  is_active boolean not null default true,
  click_count bigint not null default 0 check (click_count >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.gtrimmer_short_links is
  'Isolated Universal URL Shortener records for verified G-Trimmer Telegram users. Managed only by the universal-shortener Edge Function.';

create index if not exists gtrimmer_short_links_telegram_created_idx
  on public.gtrimmer_short_links (telegram_id, created_at desc);

alter table public.gtrimmer_short_links enable row level security;
revoke all on table public.gtrimmer_short_links from public, anon, authenticated;
grant all on table public.gtrimmer_short_links to service_role;

create or replace function public.gtrimmer_increment_short_link_click(p_short_code text)
returns void
language sql
security definer
set search_path to ''
as $function$
  update public.gtrimmer_short_links
     set click_count = click_count + 1,
         updated_at = now()
   where short_code = p_short_code
     and is_active = true;
$function$;

revoke all on function public.gtrimmer_increment_short_link_click(text) from public, anon, authenticated;
grant execute on function public.gtrimmer_increment_short_link_click(text) to service_role;
