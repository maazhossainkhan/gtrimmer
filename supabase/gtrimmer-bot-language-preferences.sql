create table if not exists public.gtrimmer_bot_user_preferences (
  telegram_id text primary key check (telegram_id ~ '^[0-9]{1,20}$'),
  language text not null default 'en' check (language in ('en','bn')),
  updated_at timestamptz not null default now()
);
alter table public.gtrimmer_bot_user_preferences enable row level security;
revoke all on table public.gtrimmer_bot_user_preferences from anon, authenticated;
grant all on table public.gtrimmer_bot_user_preferences to service_role;
comment on table public.gtrimmer_bot_user_preferences is 'Per-Telegram-user language preferences for the G-Trimmer bot.';