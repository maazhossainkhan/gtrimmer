# Universal URL Shortener — cPanel deployment

This addon uses the already-active Supabase Edge Function `universal-shortener`
and table `public.gtrimmer_short_links`. It does not replace the Google Share
converter, Telegram authentication, bot, or existing database tables.

## Files

- `index.html` — only adds the isolated CSS and JS includes.
- `css/universal-shortener.css` — new, namespaced styles.
- `js/universal-shortener.js` — the new form and public short-link resolver.
- `cpanel/htaccess-universal-shortener-snippet.txt` — append-only route rule.
- `supabase/functions/universal-shortener/index.ts` — source snapshot of the active function.
- `supabase/universal-shortener-schema.sql` — schema record for the existing isolated table/RPC.

## cPanel

1. Upload the updated `index.html` to the existing document root.
2. Upload `css/universal-shortener.css` into the existing `css` folder.
3. Upload `js/universal-shortener.js` into the existing `js` folder.
4. Open the current `.htaccess` file. Do not replace it. Add the route rule from the snippet after `RewriteEngine On` and before any catch-all/SPA rule.
5. Test `https://turlx.com/` and then a generated `https://turlx.com/r/CODE` link.

## Important

- The site must be opened through the approved Telegram account to create links.
- Public redirects do not require a signed-in user.
- Only valid HTTP/HTTPS destination URLs are accepted.
- New links do not inherit the old paid-plan/24-hour expiry rules.
- The current production Edge Function and database objects are already present; do not redeploy or rerun SQL merely because these source snapshots are included.
