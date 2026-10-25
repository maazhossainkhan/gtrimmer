# Google Trim by Shadow

A responsive Google Share URL-format converter using the Shadow Shortner-inspired navy/violet theme. The converter is gated behind Telegram sign-in through Supabase Auth and an administrator approval system.

## Included

- Responsive navy, violet and blue interface inspired by the Shadow Shortner visual theme
- Telegram OpenID Connect configured as Supabase Auth's custom provider `custom:telegram`
- Access requests tied to the Supabase Auth user created through verified Telegram sign-in, displaying the Telegram username when available
- Admin dashboard to approve/reject, revoke and restore access
- Every conversion request requires a valid Supabase Auth session and is re-authorized against the database on the server
- RLS-protected access-control tables with no direct browser-role grants
- No secrets committed to this repository
- GitHub Pages custom domain `turlx.com` remains in `CNAME`

## Important

**The source code is committed, but login will not work until you configure Supabase Auth and deploy the Edge Function.** No Telegram Client Secret or Supabase service-role key belongs in this GitHub repository.

The admin dashboard shows Telegram usernames for convenience, but permission is tied to the authenticated Supabase user ID linked to Telegram, not to a username typed into a form.

## 1. Configure Supabase Auth and Telegram

1. Create a project at [Supabase](https://supabase.com/dashboard).
2. Open **Authentication → Sign In / Providers** (sometimes labelled Auth Providers) and add a **Custom OAuth/OIDC** provider:
   - Identifier: `custom:telegram`
   - Name: `Telegram`
   - Provider type: OIDC / auto-discovery
   - Issuer URL: `https://oauth.telegram.org`
   - Scopes: `openid profile`
   - Email optional: enabled/true (Telegram does not provide an email by default)
3. Copy the callback URL shown by Supabase for this provider. It normally looks like:
   `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
4. In Supabase **Authentication → URL Configuration**, set Site URL to `https://turlx.com` and allow `https://turlx.com/**` as a redirect URL.
5. In `js/supabase-config.js`, fill in the Supabase project URL and public publishable (or legacy anon) key. These two values are meant for browser use; never put a secret key there.

Official guide: [Supabase Custom OAuth/OIDC providers](https://supabase.com/docs/guides/auth/custom-oauth-providers).

## 2. Configure the Telegram bot

1. Create/select a bot using [@BotFather](https://t.me/BotFather).
2. Open the bot's **Login Widget / OpenID Connect Login** settings.
3. Add the exact Supabase callback URL from step 1 as the provider's redirect URI, for example `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. If BotFather asks for website origins/allowed URLs, also register `https://turlx.com`.
4. Copy the Telegram Client ID and Client Secret into the Supabase Auth custom-provider settings. Do not commit the client secret to GitHub.

Official guide: [Telegram Login / OIDC](https://core.telegram.org/bots/telegram-login).

## 3. Create the access-control tables

In Supabase **SQL Editor**, run the complete contents of `supabase/schema.sql`. If you already ran an earlier prototype schema, this script will only drop the old tables if they are empty. If old rows exist, it stops rather than deleting data; migrate those rows manually first.

The `gtrimmer_access_users` and `gtrimmer_access_requests` tables have RLS enabled and no grants for browser roles. The Edge Function uses the server-side service-role key to read/write these records.

## 4. Deploy the protected Edge Function

Install the Supabase CLI, then run these commands from the repository root:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy telegram-auth
```

Supabase normally makes `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` available to Edge Functions automatically. If your runtime does not provide them, add them as server-side function secrets. Never commit either value to GitHub.

### Configure the first administrator

1. After the provider is set up, open `https://turlx.com` and click **Continue with Telegram**.
2. The first login creates a Supabase Auth user. Submit an access request.
3. In Supabase **Authentication → Users**, copy the UUID of your own Telegram-authenticated account.
4. Set `ADMIN_USER_IDS` to that UUID (comma-separated for multiple administrators), then redeploy `telegram-auth`:

   ```bash
   supabase secrets set ADMIN_USER_IDS="YOUR_SUPABASE_AUTH_USER_UUID"
   supabase functions deploy telegram-auth
   ```

5. Sign in again. That account will be promoted to administrator and can approve/reject requests.

Using the Supabase user UUID for initial administrator setup is safer than trusting a username, which can change.

## 5. GitHub Pages and HTTPS

GitHub Pages publishes from `main` at `/(root)`. Keep `CNAME` set to `turlx.com`.

Open [GitHub Pages Settings](https://github.com/maazhossainkhan/gtrimmer/settings/pages), confirm DNS success, and enable **Enforce HTTPS** after the certificate is issued. Telegram sign-in must use HTTPS.

## 6. Access behavior

1. A visitor signs in through the official Telegram OIDC flow handled by Supabase Auth.
2. If not approved, they submit an access request.
3. The admin sees a pending request with the verified Telegram username (if available) and approves or rejects it.
4. The access decision is saved against the Supabase Auth user ID linked to Telegram.
5. Each conversion requires a valid Supabase Auth JWT and a current active database row.
6. Admins can revoke/restore non-admin users. Revocation blocks the next conversion request.

## Files

- `index.html` — login gate, converter, and admin dashboard UI
- `css/styles.css` — Shadow Shortner-inspired design
- `js/supabase-config.js` — public Supabase configuration
- `js/auth.js` — Supabase Auth Telegram sign-in, access requests, and admin UI
- `js/app.js` — converter UI calling the protected server endpoint
- `supabase/schema.sql` — RLS-protected access-control schema
- `supabase/functions/telegram-auth/index.ts` — session validation, authorization, and URL conversion
- `supabase/config.toml` — Edge Function JWT verification setting

## Converter behavior

The converter preserves the original output format: it extracts the first non-empty path segment of a `share.google` URL and builds `https://www.google.com/share.google?q=TOKEN`. It does not resolve the original destination or prove that Google will accept the generated URL.
