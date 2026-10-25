import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TELEGRAM_CLIENT_ID = Deno.env.get("TELEGRAM_CLIENT_ID") ?? "";
const TELEGRAM_CLIENT_SECRET = Deno.env.get("TELEGRAM_CLIENT_SECRET") ?? "";
const TELEGRAM_REDIRECT_URI = Deno.env.get("TELEGRAM_REDIRECT_URI") ?? "https://turlx.com/auth/callback.html";
const ADMIN_TELEGRAM_IDS = new Set(
  (Deno.env.get("ADMIN_TELEGRAM_IDS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const TELEGRAM_ISSUER = "https://oauth.telegram.org";
const TELEGRAM_JWKS = createRemoteJWKSet(new URL("https://oauth.telegram.org/.well-known/jwks.json"));
const ALLOWED_ORIGINS = new Set([
  "https://turlx.com",
  "https://www.turlx.com",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

const db = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://turlx.com";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}

function respond(req: Request, payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders(req) });
}

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function requireConfiguration() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError("Server configuration is incomplete. Ask the administrator to configure Supabase secrets.", 503);
  }
}

function requireTelegramConfiguration() {
  if (!TELEGRAM_CLIENT_ID || !TELEGRAM_CLIENT_SECRET || !TELEGRAM_REDIRECT_URI) {
    throw new HttpError("Telegram Login is not configured on the server yet.", 503);
  }
}

async function verifyTelegramIdToken(token: string, nonce?: string) {
  requireTelegramConfiguration();
  if (!token || token.length > 16000) throw new HttpError("A valid Telegram login token is required.", 401);
  let payload;
  try {
    const result = await jwtVerify(token, TELEGRAM_JWKS, {
      issuer: TELEGRAM_ISSUER,
      audience: TELEGRAM_CLIENT_ID,
      clockTolerance: 5
    });
    payload = result.payload;
  } catch (_error) {
    throw new HttpError("Telegram identity verification failed or the login token has expired. Sign in again.", 401);
  }

  if (nonce !== undefined && payload.nonce !== nonce) {
    throw new HttpError("Telegram sign-in nonce did not match. Please sign in again.", 401);
  }

  const subject = typeof payload.sub === "string" ? payload.sub : "";
  const idClaim = payload.id === undefined || payload.id === null ? "" : String(payload.id);
  const telegramId = idClaim || subject;
  if (!subject || !telegramId || !/^\d+$/.test(telegramId)) {
    throw new HttpError("Telegram did not return a usable verified account identifier.", 401);
  }

  const usernameRaw = typeof payload.preferred_username === "string"
    ? payload.preferred_username
    : (typeof payload.username === "string" ? payload.username : "");
  const username = usernameRaw.replace(/^@/, "").trim().slice(0, 64) || null;
  const displayName = [
    typeof payload.given_name === "string" ? payload.given_name : "",
    typeof payload.family_name === "string" ? payload.family_name : ""
  ].filter(Boolean).join(" ").trim()
    || (typeof payload.name === "string" ? payload.name.trim() : "")
    || (username ? "@" + username : "Telegram user");

  return {
    telegram_id: telegramId,
    oidc_sub: subject,
    username,
    display_name: displayName.slice(0, 160)
  };
}

async function identityFromRequest(body: Record<string, unknown>) {
  const token = typeof body.id_token === "string" ? body.id_token : "";
  return await verifyTelegramIdToken(token);
}

async function bootstrapAdmin(identity: Awaited<ReturnType<typeof verifyTelegramIdToken>>) {
  if (!db) throw new HttpError("Database service is unavailable.", 503);
  if (!ADMIN_TELEGRAM_IDS.has(identity.telegram_id)) return false;

  const { error } = await db.from("gtrimmer_access_users").upsert({
    telegram_id: identity.telegram_id,
    oidc_sub: identity.oidc_sub,
    username: identity.username,
    display_name: identity.display_name,
    status: "active",
    is_admin: true,
    updated_at: new Date().toISOString()
  }, { onConflict: "telegram_id" });
  if (error) throw new HttpError("Could not initialize the configured administrator: " + error.message, 500);
  return true;
}

async function getAccessState(identity: Awaited<ReturnType<typeof verifyTelegramIdToken>>) {
  if (!db) throw new HttpError("Database service is unavailable.", 503);
  await bootstrapAdmin(identity);

  const { data: account, error: accountError } = await db
    .from("gtrimmer_access_users")
    .select("telegram_id, oidc_sub, username, display_name, status, is_admin, created_at, updated_at")
    .eq("telegram_id", identity.telegram_id)
    .maybeSingle();
  if (accountError) throw new HttpError("Could not read access status: " + accountError.message, 500);

  if (account) {
    return {
      state: account.status === "active" ? (account.is_admin ? "admin" : "active") : "revoked",
      user: {
        telegram_id: account.telegram_id,
        username: account.username ?? identity.username,
        display_name: account.display_name ?? identity.display_name,
        is_admin: !!account.is_admin,
        status: account.status
      }
    };
  }

  const { data: request, error: requestError } = await db
    .from("gtrimmer_access_requests")
    .select("status, requested_at")
    .eq("telegram_id", identity.telegram_id)
    .maybeSingle();
  if (requestError) throw new HttpError("Could not read request status: " + requestError.message, 500);

  return {
    state: request?.status === "pending" ? "pending" : (request?.status === "rejected" ? "rejected" : "needs_request"),
    user: {
      telegram_id: identity.telegram_id,
      username: identity.username,
      display_name: identity.display_name,
      is_admin: false,
      status: "pending"
    },
    requested_at: request?.requested_at ?? null
  };
}

async function requireAdmin(identity: Awaited<ReturnType<typeof verifyTelegramIdToken>>) {
  await bootstrapAdmin(identity);
  if (!db) throw new HttpError("Database service is unavailable.", 503);
  const { data, error } = await db
    .from("gtrimmer_access_users")
    .select("telegram_id, is_admin, status")
    .eq("telegram_id", identity.telegram_id)
    .maybeSingle();
  if (error) throw new HttpError("Could not verify administrator access.", 500);
  if (!data || data.status !== "active" || !data.is_admin) {
    throw new HttpError("Administrator access is required for this action.", 403);
  }
}

async function handleAdmin(identity: Awaited<ReturnType<typeof verifyTelegramIdToken>>, body: Record<string, unknown>) {
  if (!db) throw new HttpError("Database service is unavailable.", 503);
  await requireAdmin(identity);
  const action = String(body.action ?? "");

  if (action === "list") {
    const [{ data: requests, error: requestError }, { data: users, error: usersError }] = await Promise.all([
      db.from("gtrimmer_access_requests")
        .select("telegram_id, oidc_sub, username, display_name, status, requested_at")
        .eq("status", "pending")
        .order("requested_at", { ascending: true })
        .limit(200),
      db.from("gtrimmer_access_users")
        .select("telegram_id, username, display_name, status, is_admin, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(200)
    ]);
    if (requestError || usersError) throw new HttpError("Could not load the access management list.", 500);
    return { success: true, requests: requests ?? [], users: users ?? [] };
  }

  const targetId = typeof body.telegram_id === "string" ? body.telegram_id.trim() : "";
  if (!/^\d+$/.test(targetId)) throw new HttpError("A valid Telegram account ID is required.");

  if (action === "approve" || action === "reject") {
    const { data: accessRequest, error: fetchError } = await db
      .from("gtrimmer_access_requests")
      .select("telegram_id, oidc_sub, username, display_name, status")
      .eq("telegram_id", targetId)
      .maybeSingle();
    if (fetchError) throw new HttpError("Could not read the access request.", 500);
    if (!accessRequest || accessRequest.status !== "pending") {
      throw new HttpError("This request is no longer pending. Refresh the list.");
    }

    if (action === "approve") {
      const { error: upsertError } = await db.from("gtrimmer_access_users").upsert({
        telegram_id: accessRequest.telegram_id,
        oidc_sub: accessRequest.oidc_sub,
        username: accessRequest.username,
        display_name: accessRequest.display_name,
        status: "active",
        is_admin: false,
        updated_at: new Date().toISOString()
      }, { onConflict: "telegram_id" });
      if (upsertError) throw new HttpError("Could not approve this account: " + upsertError.message, 500);
    }

    const { error: updateError } = await db.from("gtrimmer_access_requests").update({
      status: action === "approve" ? "approved" : "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: identity.telegram_id
    }).eq("telegram_id", targetId);
    if (updateError) throw new HttpError("Could not update the request status.", 500);
    return { success: true, message: action === "approve" ? "Account approved." : "Request rejected." };
  }

  if (action === "revoke" || action === "restore") {
    if (ADMIN_TELEGRAM_IDS.has(targetId)) throw new HttpError("A configured bootstrap administrator cannot be revoked from this screen.", 403);
    const { data: target, error: targetError } = await db
      .from("gtrimmer_access_users")
      .select("telegram_id, is_admin")
      .eq("telegram_id", targetId)
      .maybeSingle();
    if (targetError) throw new HttpError("Could not read the selected account.", 500);
    if (!target) throw new HttpError("Account not found. Refresh the list.");
    if (target.is_admin) throw new HttpError("Administrator accounts cannot be changed here.", 403);

    const { error: updateError } = await db.from("gtrimmer_access_users").update({
      status: action === "revoke" ? "revoked" : "active",
      updated_at: new Date().toISOString()
    }).eq("telegram_id", targetId);
    if (updateError) throw new HttpError("Could not update this account.", 500);
    return { success: true, message: action === "revoke" ? "Access revoked." : "Access restored." };
  }

  throw new HttpError("Unknown administrator action.");
}

function convertUrl(rawValue: unknown) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    throw new HttpError("Please paste a share.google URL.");
  }
  const trimmed = rawValue.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : "https://" + trimmed;
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { throw new HttpError("The URL you entered is invalid."); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new HttpError("Please enter an HTTP or HTTPS share.google URL.");
  if (parsed.username || parsed.password) throw new HttpError("Please enter a URL without a username or password.");
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "share.google" && hostname !== "www.share.google") throw new HttpError("Please enter a valid share.google URL.");
  const token = parsed.pathname.split("/").filter(Boolean)[0] || "";
  if (!token) throw new HttpError("Google share token was not found.");
  return { token, url: "https://www.google.com/share.google?q=" + encodeURIComponent(token) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return respond(req, { success: false, message: "Method not allowed." }, 405);

  try {
    requireConfiguration();
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { throw new HttpError("Request body must be valid JSON."); }
    const action = String(body.endpoint_action ?? body.action ?? "");

    if (action === "exchange-code") {
      requireTelegramConfiguration();
      const code = typeof body.code === "string" ? body.code : "";
      const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : "";
      const verifier = typeof body.code_verifier === "string" ? body.code_verifier : "";
      const nonce = typeof body.nonce === "string" ? body.nonce : "";
      if (!code || !verifier || !nonce) throw new HttpError("The Telegram callback is missing required verification details.", 400);
      if (redirectUri !== TELEGRAM_REDIRECT_URI) throw new HttpError("The sign-in redirect URL does not match the server configuration.", 400);

      const credentials = btoa(TELEGRAM_CLIENT_ID + ":" + TELEGRAM_CLIENT_SECRET);
      const tokenResponse = await fetch("https://oauth.telegram.org/token", {
        method: "POST",
        headers: {
          "Authorization": "Basic " + credentials,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: TELEGRAM_REDIRECT_URI,
          client_id: TELEGRAM_CLIENT_ID,
          code_verifier: verifier
        })
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || typeof tokenData.id_token !== "string") {
        throw new HttpError("Telegram could not exchange this sign-in code. Start the login again.", 401);
      }
      await verifyTelegramIdToken(tokenData.id_token, nonce);
      const verifiedToken = await jwtVerify(tokenData.id_token, TELEGRAM_JWKS, {
        issuer: TELEGRAM_ISSUER,
        audience: TELEGRAM_CLIENT_ID,
        clockTolerance: 5
      });
      return respond(req, {
        success: true,
        id_token: tokenData.id_token,
        expires_at: verifiedToken.payload.exp ?? null,
        telegram_id: verified.telegram_id
      });
    }

    const identity = await identityFromRequest(body);

    if (action === "access-state") {
      return respond(req, { success: true, ...(await getAccessState(identity)) });
    }

    if (action === "request-access") {
      if (!db) throw new HttpError("Database service is unavailable.", 503);
      await bootstrapAdmin(identity);
      const { data: current, error: currentError } = await db.from("gtrimmer_access_users")
        .select("status, is_admin")
        .eq("telegram_id", identity.telegram_id)
        .maybeSingle();
      if (currentError) throw new HttpError("Could not verify the account status.", 500);
      if (current?.status === "active") return respond(req, { success: true, state: current.is_admin ? "admin" : "active" });
      if (current?.status === "revoked") throw new HttpError("This account's access was revoked. Contact the administrator.", 403);

      const { error } = await db.from("gtrimmer_access_requests").upsert({
        telegram_id: identity.telegram_id,
        oidc_sub: identity.oidc_sub,
        username: identity.username,
        display_name: identity.display_name,
        status: "pending",
        requested_at: new Date().toISOString(),
        reviewed_at: null,
        reviewed_by: null
      }, { onConflict: "telegram_id" });
      if (error) throw new HttpError("Could not submit the access request: " + error.message, 500);
      return respond(req, { success: true, state: "pending", message: "Access request submitted." });
    }

    if (action === "admin-manage-access") {
      return respond(req, await handleAdmin(identity, body));
    }

    if (action === "convert-share-url") {
      const access = await getAccessState(identity);
      if (access.state !== "active" && access.state !== "admin") {
        throw new HttpError("Your Telegram account is not authorized to convert links.", 403);
      }
      return respond(req, { success: true, ...convertUrl(body.raw_url) });
    }

    throw new HttpError("Unknown action.", 400);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    if (status >= 500) console.error("telegram-auth handler error:", message);
    return respond(req, { success: false, message: status >= 500 && !(error instanceof HttpError) ? "The secure service encountered an unexpected error." : message }, status);
  }
});
