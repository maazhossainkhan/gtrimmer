# Google Trim by Shadow

A responsive Google Share URL-format converter using the Shadow Shortner-inspired navy/violet theme. The application is intended to be **invite-approved / admin-approved** and keeps the conversion endpoint behind server-side authorization.

## Included

- Responsive navy, violet and blue interface inspired by the Shadow Shortner visual theme
- Telegram OpenID Connect sign-in (verified server-side)
- Access requests tied to a verified Telegram account ID; the administrator approves/rejects requests by the displayed Telegram username
- Admin dashboard to view pending requests, approve/reject, revoke and restore user access
- Every conversion request is authenticated and re-authorized on the server
- Supabase tables protected by RLS with no direct browser-role grants
- Public-only browser config placeholder; secrets belong in Supabase function secrets
- Existing GitHub Pages custom domain is preserved in `CNAME` as `turlx.com`

## Important

**The code is committed, but authentication will not work until the external Supabase and Telegram settings below are completed.** Do not add the Telegram Client Secret or Supabase service-role/secret key to this public GitHub repository.

This implementation uses a Telegram username for human-readable display, but saves approval against Telegram's signed numeric account ID. A username typed into a form is not identity proof and can change.

## 1. Create/configure a Supabase project

1. Create a project at [Supabase](https://supabase.com/dashboard).
2. In **SQL Editor**, run the full contents of [`supabase/schema.sql`](supabase/schema.sql).
3. Copy the project URL and the public publishable key (or legacy anon key). Edit `js/supabase-config.js`:
   - `supabaseUrl`: `https://YOUR_PROJECT_REF.supabase.co`
   - `publishableKey`: your public publishable/anon key
   - `telegramClientId`: the Telegram Login Client ID
   - `telegramRedirectUri`: exactly `https://turlx.com/auth/callback.html`
4. Commit that config file. Only the Supabase public key belongs in it; this is not the place for any secret key.

The tables `gtrimmer_access_users` and `gtrimmer_access_requests` have RLS enabled and no policies for browser roles. Only the Edge Function's server-side service-role client reads or writes them.

## 2. Set up Telegram Login

1. Open Telegram and create/select the bot that will represent Google Trim by Shadow using [@BotFather](https://t.me/BotFather).
2. Open the bot's **Login Widget** settings in BotFather and register allowed origin(s):
   - `https://turlx.com`
   - `https://www.turlx.com`
3. Register the redirect URI exactly as `https://turlx.com/auth/callback.html`.
4. Copy the Telegram Login Client ID and Client Secret shown by BotFather. The Client ID is public and goes in `js/supabase-config.js`; the Client Secret stays in Supabase secrets.

Official docs: [Telegram Login / OpenID Connect](https://core.telegram.org/bots/telegram-login).

## 3. Set server-side secrets and deploy the Edge Function

Install the Supabase CLI, then from the repository root run:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set TELEGRAM_CLIENT_ID="YOUR_TELEGRAM_CLIENT_ID" TELEGRAM_CLIENT_SECRET="YOUR_TELEGRAM_CLIENT_SECRET" TELEGRAM_REDIRECT_URI="https://turlx.com/auth/callback.html" ADMIN_TELEGRAM_IDS="YOUR_NUMERIC_TELEGRAM_ID"
supabase functions deploy telegram-auth
```

Supabase normally provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions automatically. If your project/runtime does not provide them, set these server-side in Supabase Functions secrets; never commit them.

### Initial administrator

- Set `ADMIN_TELEGRAM_IDS` to the numeric Telegram account ID of the site owner/admin (comma-separated if there is more than one).
- Find your Telegram numeric ID using a trusted method. Do not use a username as a substitute for this bootstrap allowlist.
- The first time that account signs in, the function bootstraps it as an administrator. Keep this ID in the server secret to retain bootstrap-admin status. Do not set it to anyone you do not trust.

The Edge Function validates Telegram's signed ID token with Telegram's JWKS, checks issuer/audience/expiry/nonce, and only then trusts the identity. The function uses `verify_jwt = false` because Telegram ID tokens are not Supabase Auth JWTs; the function performs its own verification for every action.

## 4. Publish with GitHub Pages

GitHub Pages is configured to publish from `main` at `/(root)`. Keep the repository's `CNAME` file containing `turlx.com`.

The custom-domain certificate and DNS are configured separately. Open [GitHub Pages Settings](https://github.com/maazhossainkhan/gtrimmer/settings/pages), confirm DNS success and enable **Enforce HTTPS** after the certificate is issued. Telegram sign-in must use HTTPS.

## 5. How access works

1. A user clicks **Continue with Telegram** and completes Telegram's official sign-in.
2. The backend validates the ID token. If the account is not already approved, the user can submit an access request.
3. The admin signs in using the configured Telegram account. The dashboard lists pending requests with `@username` (if available) and the Telegram numeric ID.
4. The admin approves or rejects a request. Approval is tied to the verified Telegram numeric ID, not a username string typed by the user.
5. Every conversion call re-validates the Telegram token and checks the user's current `active` status in the database.
6. Admin can revoke or restore a non-admin user. Revocation takes effect on the next conversion request.

An ID token expires. If a session stops working, sign in with Telegram again.

## Local testing

A static local server can host the frontend, but Telegram BotFather must also allow the exact origin/redirect URL you use. The production values above are for `turlx.com`.

The existing converter's URL format is preserved: the first non-empty path segment of a `share.google` URL is converted to `https://www.google.com/share.google?q=TOKEN`. This reformatting does not resolve the original destination or prove that Google will accept the generated link.

## Files

- `index.html` — app, login gate, and admin dashboard UI
- `css/styles.css` — Shadow Shortner-inspired design
- `js/supabase-config.js` — public configuration placeholders
- `js/auth.js` — Telegram OIDC, access request, and admin UI
- `auth/callback.html`, `js/telegram-callback.js` — OAuth callback/PKCE handling
- `js/app.js` — conversion UI calling the protected server endpoint
- `supabase/schema.sql` — private access-control tables with RLS
- `supabase/functions/telegram-auth/index.ts` — Telegram token verification, access control, and conversion
- `supabase/config.toml` — Edge Function verification mode
