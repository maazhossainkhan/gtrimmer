# Google Trim by Shadow

An original graphite-and-jade interface for transforming supported Google Share URL formats. Converter access is tied to verified Telegram identity and server-enforced administrator approval.

## Included

- Responsive Emberglass visual identity: graphite surfaces, jade accents, warm-copper details, and original product copy
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
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy telegram-auth
```

Supabase normally makes `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` available to Edge Functions automatically. If your runtime does not provide them, add them as server-side function secrets. Never commit either value to GitHub.

### Configure the first administrator

1. After the provider is set up, open `https://turlx.com` and click **Continue with Telegram**.
2. The first login creates a Supabase Auth user. Submit an access request.
3. In Supabase **Authentication → Users**, copy the UUID of your own Telegram-authenticated account.
4. Set `ADMIN_USER_IDS` to that UUID (comma-separated for multiple administrators):

   ```bash
   npx supabase secrets set ADMIN_USER_IDS="YOUR_SUPABASE_AUTH_USER_UUID"
   ```

   Supabase function secrets become available without redeploying the function. Reload the website and sign in again.

5. That account will be promoted to administrator and can approve/reject requests.

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

## 9. Mini App requests in the existing admin dashboard

The OIDC Edge Function `telegram-auth` also serves the original browser-based admin dashboard. After the latest source is deployed to Supabase, its admin list merges legacy OIDC and Telegram Mini App requests. It can approve/reject Mini App request IDs with the `tg:<telegram_id>` action ID, and revoke/restore Mini App allowlist entries.

If a user was made administrator only through `ADMIN_USER_IDS` (a Supabase UUID), that does not automatically identify the same Telegram account in the Mini App. To grant Mini App administrator status, set `ADMIN_TELEGRAM_IDS` to the verified numeric Telegram user ID. It is shown beside the pending request after the updated `telegram-auth` function is deployed, or can be read from `gtrimmer_mini_access_requests.telegram_id` in SQL Editor. Never use the username for this mapping.

## 8. Telegram Mini App authentication and access approvals

When opened inside Telegram, the frontend now uses `Telegram.WebApp.initData` instead of launching the OIDC page inside Telegram's webview. The new `telegram-mini-auth` Edge Function verifies Telegram's HMAC signature and `auth_date` on the server before processing any action. `initDataUnsafe` is not used for authorization.

### Required one-time setup

1. In Supabase **SQL Editor**, run the complete file `supabase/telegram-mini-app-schema.sql`. This adds two Mini App tables and does not drop or overwrite the existing OIDC approval records.
2. In Supabase **Edge Functions → Secrets**, ensure `TELEGRAM_BOT_TOKEN` contains the current, valid BotFather token. Never place it in GitHub or the browser. If the token was rotated, update this secret to the new token.
3. Deploy `supabase/functions/telegram-mini-auth/index.ts` as an Edge Function named `telegram-mini-auth`. The function's `verify_jwt` setting is `false` because Telegram does not issue Supabase JWTs for Mini Apps; the code itself validates signed Telegram `initData` and all database authorization. Keep the secret bot token configured.
4. If your current OIDC administrator record already contains your numeric Telegram ID, the Mini App can reuse that admin role. Otherwise set the server-side secret `ADMIN_TELEGRAM_IDS` to your own numeric Telegram ID (digits only; comma-separated for multiple admins). Do not use your username, and do not share the ID with the bot token.
5. Reload `https://turlx.com` inside Telegram and test `/start` → **Open Google Trim**. A new user should see **Request converter access**; after approval the converter should work. Check that a revoked user is denied on the next conversion.

The Mini App uses the same legacy access records whenever a matching verified Telegram ID already exists, so existing OIDC approvals, admin roles, and revocations are retained. New Mini App-only requests are stored in the new tables and can be approved/rejected/revoked/restored from the admin screen. Every conversion is rechecked by the server.

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

## 10. Telegram bot buttons and direct conversion

The `telegram-bot` Edge Function now provides a persistent private-chat keyboard through `@gtrimmerbot`:

- **Open Google Trim** — opens `https://turlx.com/` as a Telegram Mini App.
- **Convert Link** — asks the user for a share.google URL; the user can also paste a share.google URL at any time.
- **My Access** — reports Admin, approved, pending, rejected, revoked, or not-yet-requested status.
- **Request Access** — creates a Mini App access request for an unapproved Telegram ID.
- **Help** — explains the commands and workflow.

Commands are registered when a user sends `/start`: `/start`, `/app`, `/convert`, `/access`, `/request`, and `/help`. The menu button is set to **Open Google Trim**. New Mini App access requests also send a Telegram notification to active Mini App admins, with a button to open the dashboard. Direct message conversion is restricted to private chats and checks current approval in the legacy or Mini App access tables before returning the same converted URL as the Mini App. The Telegram webhook continues using the existing `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_BOT_TOKEN` secrets; never publish either value.

## 11. Revoked accounts cleanup

The admin dashboard separates active accounts from revoked accounts. Revoke moves an account to **Revoked accounts**, where it can be restored. **Clear list** is a destructive, admin-only action that removes non-admin revoked allowlist rows from both the legacy OIDC table and Mini App table. Pending requests and active rows are not deleted. If the same Telegram ID has an active record in either access table, its revoked row is skipped to avoid unintentionally restoring access by removing the blocking record. Cleared users may need to submit an access request again.

