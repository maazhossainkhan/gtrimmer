/*
 * Browser-safe, public settings only.
 * Supabase publishable/anon key and Telegram Client ID are public identifiers.
 * NEVER put TELEGRAM_CLIENT_SECRET or SUPABASE_SERVICE_ROLE_KEY here.
 */
window.GTRIMMER_SUPABASE_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  publishableKey: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY",
  telegramClientId: "YOUR_TELEGRAM_CLIENT_ID",
  telegramRedirectUri: "https://turlx.com/auth/callback.html"
};
