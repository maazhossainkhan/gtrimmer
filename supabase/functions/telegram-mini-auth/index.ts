import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const ADMIN_TELEGRAM_IDS = new Set((Deno.env.get("ADMIN_TELEGRAM_IDS") ?? "").split(",").map(v => v.trim()).filter(v => /^\d+$/.test(v)));
const ALLOWED_ORIGINS = new Set(["https://turlx.com", "https://www.turlx.com", "http://localhost:8000", "http://127.0.0.1:8000"]);
const db = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const encoder = new TextEncoder();

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function headers(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://turlx.com",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-telegram-init-data",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}
function respond(req: Request, payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: headers(req) });
}
function requireConfig() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !db) throw new HttpError("Server database configuration is incomplete.", 503);
  if (!BOT_TOKEN) throw new HttpError("Telegram Mini App authentication is not configured. Add TELEGRAM_BOT_TOKEN to Edge Function secrets.", 503);
}
function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(keyBytes: Uint8Array, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", key, encoder.encode(message));
}
function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
type Identity = { telegram_id: string; username: string | null; display_name: string };
async function verifyInitData(raw: string): Promise<Identity> {
  requireConfig();
  if (!raw || raw.length > 16384) throw new HttpError("Open this page from the @gtrimmerbot Mini App button.", 401);
  const params = new URLSearchParams(raw);
  const suppliedHash = params.get("hash") ?? "";
  const authDateValue = params.get("auth_date") ?? "";
  const userValue = params.get("user") ?? "";
  if (!suppliedHash || !authDateValue || !userValue) throw new HttpError("Telegram did not provide complete Mini App login data. Close and reopen the app.", 401);

  const authDate = Number(authDateValue);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate > now + 60 || now - authDate > 86400) {
    throw new HttpError("Telegram Mini App login data has expired. Close and reopen the app.", 401);
  }

  params.delete("hash");
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a < b ? -1 : (a > b ? 1 : 0))
    .map(([key, value]) => key + "=" + value)
    .join("\n");
  // Telegram's Mini App algorithm: HMAC key "WebAppData", message = bot token.
  const secretKey = await hmac(encoder.encode("WebAppData"), BOT_TOKEN);
  const calculatedHash = bytesToHex(await hmac(new Uint8Array(secretKey), dataCheckString));
  if (!safeEqualHex(calculatedHash, suppliedHash)) throw new HttpError("Telegram identity verification failed. Reopen the Mini App from @gtrimmerbot.", 401);

  let user: any;
  try { user = JSON.parse(userValue); } catch { throw new HttpError("Telegram user data could not be parsed.", 401); }
  if (!user || (!Number.isSafeInteger(user.id) && !(typeof user.id === "string" && /^\d+$/.test(user.id)))) {
    throw new HttpError("Telegram user ID is missing or invalid.", 401);
  }
  const telegramId = String(user.id);
  if (!/^\d{1,20}$/.test(telegramId)) throw new HttpError("Telegram user ID is invalid.", 401);
  const username = typeof user.username === "string" ? user.username.replace(/^@/, "").trim().slice(0, 64) || null : null;
  const displayName = [user.first_name, user.last_name].filter(v => typeof v === "string" && v.trim()).join(" ").trim()
    || (username ? "@" + username : "Telegram user");
  return { telegram_id: telegramId, username, display_name: displayName.slice(0, 160) };
}
function publicIdentity(identity: Identity) {
  return { user_id: "tg:" + identity.telegram_id, telegram_id: identity.telegram_id, username: identity.username, display_name: identity.display_name };
}
async function getLegacyUser(telegramId: string) {
  const { data, error } = await db!.from("gtrimmer_access_users")
    .select("user_id, telegram_id, username, display_name, status, is_admin, created_at, updated_at")
    .eq("telegram_id", telegramId).limit(1);
  if (error) throw new HttpError("Could not read existing access for this Telegram account. Check the database schema.", 500);
  return data?.[0] ?? null;
}
async function getMiniUser(telegramId: string) {
  const { data, error } = await db!.from("gtrimmer_mini_access_users")
    .select("telegram_id, username, display_name, status, is_admin, created_at, updated_at")
    .eq("telegram_id", telegramId).maybeSingle();
  if (error) throw new HttpError("Mini App access tables are missing. Run supabase/telegram-mini-app-schema.sql in Supabase SQL Editor.", 503);
  return data;
}
async function ensureConfiguredAdmin(identity: Identity) {
  if (!ADMIN_TELEGRAM_IDS.has(identity.telegram_id)) return;
  const { error } = await db!.from("gtrimmer_mini_access_users").upsert({
    telegram_id: identity.telegram_id, username: identity.username, display_name: identity.display_name,
    status: "active", is_admin: true, updated_at: new Date().toISOString()
  }, { onConflict: "telegram_id" });
  if (error) throw new HttpError("Could not initialize the configured Telegram administrator.", 500);
  const { error: requestError } = await db!.from("gtrimmer_mini_access_requests").update({
    status: "approved", reviewed_at: new Date().toISOString(), reviewed_by_telegram_id: identity.telegram_id
  }).eq("telegram_id", identity.telegram_id).eq("status", "pending");
  if (requestError) throw new HttpError("Could not finalize Telegram administrator setup.", 500);
}
async function getAccessState(identity: Identity) {
  await ensureConfiguredAdmin(identity);
  const configuredAdmin = ADMIN_TELEGRAM_IDS.has(identity.telegram_id);
  const legacyUser = await getLegacyUser(identity.telegram_id);
  if (configuredAdmin) {
    const user = await getMiniUser(identity.telegram_id);
    return { state: "admin", user: { ...publicIdentity(identity), is_admin: true, status: "active" } };
  }
  // Legacy approvals/revocations remain authoritative for accounts previously managed by the OIDC flow.
  if (legacyUser) {
    const isAdmin = legacyUser.status === "active" && !!legacyUser.is_admin;
    return {
      state: legacyUser.status === "active" ? (isAdmin ? "admin" : "active") : "revoked",
      user: { ...publicIdentity(identity), is_admin: isAdmin, status: legacyUser.status }
    };
  }
  const miniUser = await getMiniUser(identity.telegram_id);
  if (miniUser) {
    return {
      state: miniUser.status === "active" ? (miniUser.is_admin ? "admin" : "active") : "revoked",
      user: { ...publicIdentity(identity), is_admin: !!miniUser.is_admin, status: miniUser.status }
    };
  }
  const { data: miniRequest, error: miniReqError } = await db!.from("gtrimmer_mini_access_requests")
    .select("status, requested_at").eq("telegram_id", identity.telegram_id).maybeSingle();
  if (miniReqError) throw new HttpError("Could not read Mini App request status.", 500);
  const { data: legacyRequest, error: legacyReqError } = await db!.from("gtrimmer_access_requests")
    .select("status, requested_at").eq("telegram_id", identity.telegram_id).limit(1);
  if (legacyReqError) throw new HttpError("Could not read existing access requests.", 500);
  const request = miniRequest ?? legacyRequest?.[0] ?? null;
  return {
    state: request?.status === "pending" ? "pending" : (request?.status === "rejected" ? "rejected" : "needs_request"),
    user: { ...publicIdentity(identity), is_admin: false, status: request?.status ?? "not_requested" },
    requested_at: request?.requested_at ?? null
  };
}
async function requireAdmin(identity: Identity) {
  await ensureConfiguredAdmin(identity);
  if (ADMIN_TELEGRAM_IDS.has(identity.telegram_id)) return;
  const legacyUser = await getLegacyUser(identity.telegram_id);
  if (legacyUser?.status === "active" && legacyUser.is_admin) return;
  const miniUser = await getMiniUser(identity.telegram_id);
  if (miniUser?.status === "active" && miniUser.is_admin) return;
  throw new HttpError("Administrator access is required for this action.", 403);
}
async function listAdminData() {
  const [{ data: legacyRequests, error: legacyReqError }, { data: miniRequests, error: miniReqError },
         { data: legacyUsers, error: legacyUsersError }, { data: miniUsers, error: miniUsersError }] = await Promise.all([
    db!.from("gtrimmer_access_requests").select("user_id, telegram_id, username, display_name, status, requested_at")
      .eq("status", "pending").order("requested_at", { ascending: true }).limit(200),
    db!.from("gtrimmer_mini_access_requests").select("telegram_id, username, display_name, status, requested_at")
      .eq("status", "pending").order("requested_at", { ascending: true }).limit(200),
    db!.from("gtrimmer_access_users").select("user_id, telegram_id, username, display_name, status, is_admin, created_at, updated_at")
      .order("updated_at", { ascending: false }).limit(200),
    db!.from("gtrimmer_mini_access_users").select("telegram_id, username, display_name, status, is_admin, created_at, updated_at")
      .order("updated_at", { ascending: false }).limit(200)
  ]);
  if (legacyReqError || miniReqError || legacyUsersError || miniUsersError) throw new HttpError("Could not load the access management list.", 500);
  const requests: any[] = (legacyRequests ?? []).map((r: any) => ({ ...r, source: "legacy" }));
  const pendingIds = new Set(requests.map((r: any) => String(r.telegram_id ?? "")));
  for (const r of miniRequests ?? []) {
    if (!pendingIds.has(String(r.telegram_id))) requests.push({ ...r, user_id: "tg:" + r.telegram_id, source: "mini" });
  }
  const users: any[] = (legacyUsers ?? []).map((u: any) => ({ ...u, source: "legacy" }));
  const knownTgIds = new Set(users.map((u: any) => String(u.telegram_id ?? "")));
  for (const u of miniUsers ?? []) {
    if (!knownTgIds.has(String(u.telegram_id))) {
      users.push({ ...u, user_id: "tg:" + u.telegram_id, source: "mini" });
      knownTgIds.add(String(u.telegram_id));
    }
  }
  return { success: true, requests, users };
}
function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function notifyAccessApproved(telegramId: unknown, username: unknown, displayName: unknown): Promise<void> {
  const chatId = String(telegramId ?? "").trim();
  if (!BOT_TOKEN || !/^\d{1,20}$/.test(chatId)) {
    console.warn("Skipping approval notification: Telegram bot token or valid chat ID is unavailable.");
    return;
  }
  const handle = typeof username === "string" ? username.replace(/^@/, "").trim() : "";
  const display = typeof displayName === "string" ? displayName.trim() : "";
  const recipient = handle ? "@" + handle : (display || "there");
  try {
    const response = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: Number(chatId),
        text: "🎉 Congratulations, " + recipient + "!\\n\\n" +
          "Your access to Google Trim by Shadow has been approved. You can now use the converter.\\n\\n" +
          "Tap the button below to get started.",
        reply_markup: {
          inline_keyboard: [[{
            text: "🚀 Open Google Trim",
            style: "primary",
            web_app: { url: "https://turlx.com/" }
          }]]
        },
        disable_web_page_preview: true
      })
    });
    const result: any = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      console.warn("Could not send Telegram approval notification:", result?.description ?? "Telegram API request failed.");
    }
  } catch (error) {
    console.warn("Could not send Telegram approval notification:", error instanceof Error ? error.message : "unknown error");
  }
}

async function adminAction(identity: Identity, body: Record<string, unknown>) {
  await requireAdmin(identity);
  const action = String(body.admin_action ?? "");
  if (action === "list") return await listAdminData();
  if (action === "clear-revoked") {
    const [
      { data: legacyRevoked, error: legacyRevokedError },
      { data: miniRevoked, error: miniRevokedError },
      { data: legacyActive, error: legacyActiveError },
      { data: miniActive, error: miniActiveError }
    ] = await Promise.all([
      db!.from("gtrimmer_access_users").select("user_id, telegram_id").eq("status", "revoked").eq("is_admin", false),
      db!.from("gtrimmer_mini_access_users").select("telegram_id").eq("status", "revoked").eq("is_admin", false),
      db!.from("gtrimmer_access_users").select("telegram_id").eq("status", "active"),
      db!.from("gtrimmer_mini_access_users").select("telegram_id").eq("status", "active")
    ]);
    if (legacyRevokedError || miniRevokedError || legacyActiveError || miniActiveError) {
      throw new HttpError("Could not prepare the revoked-account cleanup. No entries were deleted.", 500);
    }
    const activeIds = new Set<string>([
      ...(legacyActive ?? []).map((row: any) => String(row.telegram_id ?? "")),
      ...(miniActive ?? []).map((row: any) => String(row.telegram_id ?? ""))
    ].filter(Boolean));
    const skippedIds = new Set<string>();
    const legacyDeleteIds: string[] = [];
    const miniDeleteIds: string[] = [];
    for (const row of legacyRevoked ?? []) {
      const telegramId = String(row.telegram_id ?? "");
      if (telegramId && activeIds.has(telegramId)) {
        skippedIds.add(telegramId);
      } else {
        legacyDeleteIds.push(String(row.user_id));
      }
    }
    for (const row of miniRevoked ?? []) {
      const telegramId = String(row.telegram_id ?? "");
      if (activeIds.has(telegramId)) {
        skippedIds.add(telegramId);
      } else {
        miniDeleteIds.push(telegramId);
      }
    }
    const removedKeys = new Set<string>();
    if (legacyDeleteIds.length) {
      const { data, error } = await db!.from("gtrimmer_access_users").delete()
        .in("user_id", legacyDeleteIds).eq("status", "revoked").eq("is_admin", false)
        .select("user_id, telegram_id");
      if (error) throw new HttpError("Could not clear revoked OIDC accounts.", 500);
      for (const row of data ?? []) removedKeys.add(String(row.telegram_id || ("legacy:" + row.user_id)));
    }
    if (miniDeleteIds.length) {
      const { data, error } = await db!.from("gtrimmer_mini_access_users").delete()
        .in("telegram_id", miniDeleteIds).eq("status", "revoked").eq("is_admin", false)
        .select("telegram_id");
      if (error) throw new HttpError("Could not clear revoked Mini App accounts.", 500);
      for (const row of data ?? []) removedKeys.add(String(row.telegram_id));
    }
    return {
      success: true,
      cleared_count: removedKeys.size,
      skipped_count: skippedIds.size,
      message: "Cleared " + removedKeys.size + " revoked account entr" + (removedKeys.size === 1 ? "y" : "ies") + "."
    };
  }
  const targetId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (targetId.startsWith("tg:")) {
    const targetTelegramId = targetId.slice(3);
    if (!/^\d{1,20}$/.test(targetTelegramId)) throw new HttpError("A valid Telegram user ID is required.");
    if (targetTelegramId === identity.telegram_id && (action === "revoke" || action === "restore")) {
      throw new HttpError("You cannot change your own access from this screen.", 403);
    }
    if (action === "approve" || action === "reject") {
      const { data: request, error } = await db!.from("gtrimmer_mini_access_requests")
        .select("telegram_id, username, display_name, status").eq("telegram_id", targetTelegramId).maybeSingle();
      if (error) throw new HttpError("Could not read the Mini App access request.", 500);
      if (!request || request.status !== "pending") throw new HttpError("This request is no longer pending. Refresh the list.");
      if (action === "approve") {
        const { error: upsertError } = await db!.from("gtrimmer_mini_access_users").upsert({
          telegram_id: targetTelegramId, username: request.username, display_name: request.display_name,
          status: "active", is_admin: false, updated_at: new Date().toISOString()
        }, { onConflict: "telegram_id" });
        if (upsertError) throw new HttpError("Could not approve this Mini App account.", 500);
      }
      const { error: updateError } = await db!.from("gtrimmer_mini_access_requests").update({
        status: action === "approve" ? "approved" : "rejected",
        reviewed_at: new Date().toISOString(), reviewed_by_telegram_id: identity.telegram_id
      }).eq("telegram_id", targetTelegramId);
      if (updateError) throw new HttpError("Could not update the Mini App request.", 500);
      if (action === "approve") await notifyAccessApproved(targetTelegramId, request.username, request.display_name);
      return { success: true, message: action === "approve" ? "Telegram account approved." : "Telegram request rejected." };
    }
    if (action === "revoke" || action === "restore") {
      if (ADMIN_TELEGRAM_IDS.has(targetTelegramId)) throw new HttpError("A configured Telegram administrator cannot be revoked here.", 403);
      const { data: target, error: findError } = await db!.from("gtrimmer_mini_access_users")
        .select("telegram_id, is_admin").eq("telegram_id", targetTelegramId).maybeSingle();
      if (findError) throw new HttpError("Could not read this Mini App account.", 500);
      if (!target) throw new HttpError("Mini App account not found.");
      if (target.is_admin) throw new HttpError("Administrator accounts cannot be changed here.", 403);
      const { error: updateError } = await db!.from("gtrimmer_mini_access_users").update({
        status: action === "revoke" ? "revoked" : "active", updated_at: new Date().toISOString()
      }).eq("telegram_id", targetTelegramId);
      if (updateError) throw new HttpError("Could not update Mini App access.", 500);
      return { success: true, message: action === "revoke" ? "Access revoked." : "Access restored." };
    }
    throw new HttpError("Unknown administrator action.");
  }

  if (!validUuid(targetId)) throw new HttpError("A valid account ID is required.");
  if (action === "approve" || action === "reject") {
    const { data: request, error: fetchError } = await db!.from("gtrimmer_access_requests")
      .select("user_id, telegram_id, username, display_name, status").eq("user_id", targetId).maybeSingle();
    if (fetchError) throw new HttpError("Could not read the access request.", 500);
    if (!request || request.status !== "pending") throw new HttpError("This request is no longer pending. Refresh the list.");
    if (action === "approve") {
      const { error } = await db!.from("gtrimmer_access_users").upsert({
        user_id: request.user_id, telegram_id: request.telegram_id, username: request.username,
        display_name: request.display_name, status: "active", is_admin: false, updated_at: new Date().toISOString()
      }, { onConflict: "user_id" });
      if (error) throw new HttpError("Could not approve this account.", 500);
    }
    const { error } = await db!.from("gtrimmer_access_requests").update({
      status: action === "approve" ? "approved" : "rejected",
      reviewed_at: new Date().toISOString(), reviewed_by: null
    }).eq("user_id", targetId);
    if (error) throw new HttpError("Could not update the request status.", 500);
    if (request.telegram_id) {
      const { error: miniRequestError } = await db!.from("gtrimmer_mini_access_requests").update({
        status: action === "approve" ? "approved" : "rejected",
        reviewed_at: new Date().toISOString(), reviewed_by_telegram_id: identity.telegram_id
      }).eq("telegram_id", String(request.telegram_id)).eq("status", "pending");
      if (miniRequestError) throw new HttpError("The legacy request was updated, but its matching Mini App request could not be synchronized.", 500);
    }
    if (action === "approve") await notifyAccessApproved(request.telegram_id, request.username, request.display_name);
    return { success: true, message: action === "approve" ? "Account approved." : "Request rejected." };
  }
  if (action === "revoke" || action === "restore") {
    const { data: target, error: findError } = await db!.from("gtrimmer_access_users").select("user_id, telegram_id, is_admin").eq("user_id", targetId).maybeSingle();
    if (findError) throw new HttpError("Could not read the selected account.", 500);
    if (!target) throw new HttpError("Account not found. Refresh the list.");
    if (target.is_admin) throw new HttpError("Administrator accounts cannot be changed here.", 403);
    if (String(target.telegram_id ?? "") === identity.telegram_id) throw new HttpError("You cannot change your own access from this screen.", 403);
    const { error } = await db!.from("gtrimmer_access_users").update({
      status: action === "revoke" ? "revoked" : "active", updated_at: new Date().toISOString()
    }).eq("user_id", targetId);
    if (error) throw new HttpError("Could not update this account.", 500);
    return { success: true, message: action === "revoke" ? "Access revoked." : "Access restored." };
  }
  throw new HttpError("Unknown administrator action.");
}
function convertUrl(rawValue: unknown) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") throw new HttpError("Please paste a share.google URL.");
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
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: headers(req) });
  if (req.method !== "POST") return respond(req, { success: false, message: "Method not allowed." }, 405);
  try {
    requireConfig();
    const identity = await verifyInitData(req.headers.get("x-telegram-init-data") ?? "");
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { throw new HttpError("Request body must be valid JSON."); }
    const action = String(body.action ?? "");
    if (action === "access-state") return respond(req, { success: true, ...(await getAccessState(identity)) });
    if (action === "request-access") {
      const state = await getAccessState(identity);
      if (state.state === "active" || state.state === "admin") return respond(req, { success: true, state: state.state });
      if (state.state === "revoked") throw new HttpError("This account's access was revoked. Contact the administrator.", 403);
      const { error } = await db!.from("gtrimmer_mini_access_requests").upsert({
        telegram_id: identity.telegram_id, username: identity.username, display_name: identity.display_name,
        status: "pending", requested_at: new Date().toISOString(), reviewed_at: null, reviewed_by_telegram_id: null
      }, { onConflict: "telegram_id" });
      if (error) throw new HttpError("Could not submit the access request.", 500);
      return respond(req, { success: true, state: "pending", message: "Access request submitted." });
    }
    if (action === "admin-manage-access") return respond(req, await adminAction(identity, body));
    if (action === "convert-share-url") {
      const access = await getAccessState(identity);
      if (access.state !== "active" && access.state !== "admin") throw new HttpError("Your Telegram account is not authorized to convert links.", 403);
      return respond(req, { success: true, ...convertUrl(body.raw_url) });
    }
    throw new HttpError("Unknown action.", 400);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    if (status >= 500) console.error("telegram-mini-auth handler error:", message);
    return respond(req, { success: false, message: status >= 500 && !(error instanceof HttpError) ? "The secure service encountered an unexpected error." : message }, status);
  }
});
