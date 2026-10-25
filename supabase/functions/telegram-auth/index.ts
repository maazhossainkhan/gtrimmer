import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_USER_IDS = new Set((Deno.env.get("ADMIN_USER_IDS") ?? "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean));
const ALLOWED_ORIGINS = new Set(["https://turlx.com", "https://www.turlx.com", "http://localhost:8000", "http://127.0.0.1:8000"]);
const db = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://turlx.com",
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
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function requireDatabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !db) {
    throw new HttpError("Server configuration is incomplete. Check Supabase Edge Function secrets.", 503);
  }
}
function isTelegramIdentity(user: any): boolean {
  if (String(user?.app_metadata?.provider ?? "").toLowerCase().includes("telegram")) return true;
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return identities.some((identity: any) => String(identity?.provider ?? "").toLowerCase().includes("telegram"));
}
function identityFromUser(user: any) {
  const meta = user?.user_metadata ?? {};
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  const telegramIdentity = identities.find((item: any) => String(item?.provider ?? "").toLowerCase().includes("telegram"));
  const identityData = telegramIdentity?.identity_data ?? {};
  const idValue = identityData.id ?? meta.id ?? identityData.sub ?? meta.sub ?? null;
  const telegram_id = idValue === null || idValue === undefined ? null : String(idValue);
  const usernameValue = identityData.preferred_username ?? meta.preferred_username ?? identityData.username ?? meta.username ?? "";
  const username = String(usernameValue).replace(/^@/, "").trim().slice(0, 64) || null;
  const display_name = [
    identityData.given_name ?? meta.given_name ?? "",
    identityData.family_name ?? meta.family_name ?? ""
  ].filter(Boolean).join(" ").trim()
    || String(identityData.name ?? meta.name ?? meta.full_name ?? "").trim()
    || (username ? "@" + username : "Telegram user");
  return { user_id: String(user.id), telegram_id, username, display_name: display_name.slice(0, 160) };
}
async function identityFromRequest(req: Request) {
  requireDatabase();
  const match = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError("Please sign in with Telegram first.", 401);
  const { data, error } = await db!.auth.getUser(match[1]);
  if (error || !data.user) throw new HttpError("Your Supabase session is invalid or expired. Sign in again.", 401);
  if (!isTelegramIdentity(data.user)) throw new HttpError("Only a verified Telegram sign-in is allowed for this application.", 403);
  return identityFromUser(data.user);
}
async function bootstrapAdmin(identity: ReturnType<typeof identityFromUser>) {
  requireDatabase();
  if (!ADMIN_USER_IDS.has(identity.user_id.toLowerCase())) return;
  const { error } = await db!.from("gtrimmer_access_users").upsert({
    user_id: identity.user_id, telegram_id: identity.telegram_id, username: identity.username,
    display_name: identity.display_name, status: "active", is_admin: true, updated_at: new Date().toISOString()
  }, { onConflict: "user_id" });
  if (error) throw new HttpError("Could not initialize the configured administrator: " + error.message, 500);
}
async function getAccessState(identity: ReturnType<typeof identityFromUser>) {
  requireDatabase();
  await bootstrapAdmin(identity);
  const { data: account, error: accountError } = await db!.from("gtrimmer_access_users")
    .select("user_id, telegram_id, username, display_name, status, is_admin, created_at, updated_at")
    .eq("user_id", identity.user_id).maybeSingle();
  if (accountError) throw new HttpError("Could not read access status: " + accountError.message, 500);
  if (account) {
    const { error } = await db!.from("gtrimmer_access_users").update({
      telegram_id: identity.telegram_id, username: identity.username, display_name: identity.display_name,
      updated_at: new Date().toISOString()
    }).eq("user_id", identity.user_id);
    if (error) throw new HttpError("Could not refresh the Telegram profile.", 500);
    return {
      state: account.status === "active" ? (account.is_admin ? "admin" : "active") : "revoked",
      user: {
        user_id: account.user_id, telegram_id: identity.telegram_id, username: identity.username,
        display_name: identity.display_name, is_admin: !!account.is_admin, status: account.status
      }
    };
  }
  const { data: request, error: requestError } = await db!.from("gtrimmer_access_requests")
    .select("status, requested_at").eq("user_id", identity.user_id).maybeSingle();
  if (requestError) throw new HttpError("Could not read request status: " + requestError.message, 500);
  return {
    state: request?.status === "pending" ? "pending" : (request?.status === "rejected" ? "rejected" : "needs_request"),
    user: { user_id: identity.user_id, telegram_id: identity.telegram_id, username: identity.username,
      display_name: identity.display_name, is_admin: false, status: request?.status ?? "not_requested" },
    requested_at: request?.requested_at ?? null
  };
}
async function requireAdmin(identity: ReturnType<typeof identityFromUser>) {
  await bootstrapAdmin(identity);
  const { data, error } = await db!.from("gtrimmer_access_users")
    .select("user_id, is_admin, status").eq("user_id", identity.user_id).maybeSingle();
  if (error) throw new HttpError("Could not verify administrator access.", 500);
  if (!data || data.status !== "active" || !data.is_admin) throw new HttpError("Administrator access is required for this action.", 403);
}
async function handleAdmin(identity: ReturnType<typeof identityFromUser>, body: Record<string, unknown>) {
  requireDatabase();
  await requireAdmin(identity);
  const action = String(body.action ?? "");
  if (action === "list") {
    const [{ data: requests, error: requestError }, { data: users, error: usersError }] = await Promise.all([
      db!.from("gtrimmer_access_requests").select("user_id, telegram_id, username, display_name, status, requested_at")
        .eq("status", "pending").order("requested_at", { ascending: true }).limit(200),
      db!.from("gtrimmer_access_users").select("user_id, telegram_id, username, display_name, status, is_admin, created_at, updated_at")
        .order("updated_at", { ascending: false }).limit(200)
    ]);
    if (requestError || usersError) throw new HttpError("Could not load the access management list.", 500);
    return { success: true, requests: requests ?? [], users: users ?? [] };
  }
  const targetId = typeof body.user_id === "string" ? body.user_id.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)) {
    throw new HttpError("A valid user ID is required.");
  }
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
      if (error) throw new HttpError("Could not approve this account: " + error.message, 500);
    }
    const { error } = await db!.from("gtrimmer_access_requests").update({
      status: action === "approve" ? "approved" : "rejected",
      reviewed_at: new Date().toISOString(), reviewed_by: identity.user_id
    }).eq("user_id", targetId);
    if (error) throw new HttpError("Could not update the request status.", 500);
    return { success: true, message: action === "approve" ? "Account approved." : "Request rejected." };
  }
  if (action === "revoke" || action === "restore") {
    if (ADMIN_USER_IDS.has(targetId)) throw new HttpError("A configured bootstrap administrator cannot be revoked from this screen.", 403);
    const { data: target, error: targetError } = await db!.from("gtrimmer_access_users")
      .select("user_id, is_admin").eq("user_id", targetId).maybeSingle();
    if (targetError) throw new HttpError("Could not read the selected account.", 500);
    if (!target) throw new HttpError("Account not found. Refresh the list.");
    if (target.is_admin) throw new HttpError("Administrator accounts cannot be changed here.", 403);
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
  if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return respond(req, { success: false, message: "Method not allowed." }, 405);
  try {
    requireDatabase();
    const identity = await identityFromRequest(req);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { throw new HttpError("Request body must be valid JSON."); }
    const action = String(body.action ?? "");
    if (action === "access-state") return respond(req, { success: true, ...(await getAccessState(identity)) });
    if (action === "request-access") {
      const { data: account, error: accountError } = await db!.from("gtrimmer_access_users")
        .select("status, is_admin").eq("user_id", identity.user_id).maybeSingle();
      if (accountError) throw new HttpError("Could not verify account status.", 500);
      if (account?.status === "active") return respond(req, { success: true, state: account.is_admin ? "admin" : "active" });
      if (account?.status === "revoked") throw new HttpError("This account's access was revoked. Contact the administrator.", 403);
      const { error } = await db!.from("gtrimmer_access_requests").upsert({
        user_id: identity.user_id, telegram_id: identity.telegram_id, username: identity.username,
        display_name: identity.display_name, status: "pending", requested_at: new Date().toISOString(),
        reviewed_at: null, reviewed_by: null
      }, { onConflict: "user_id" });
      if (error) throw new HttpError("Could not submit the access request: " + error.message, 500);
      return respond(req, { success: true, state: "pending", message: "Access request submitted." });
    }
    if (action === "admin-manage-access") return respond(req, await handleAdmin(identity, body));
    if (action === "convert-share-url") {
      const access = await getAccessState(identity);
      if (access.state !== "active" && access.state !== "admin") throw new HttpError("Your Telegram account is not authorized to convert links.", 403);
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
