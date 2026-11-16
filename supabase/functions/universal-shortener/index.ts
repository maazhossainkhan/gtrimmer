import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const db = URL && SERVICE ? createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const DOMAIN = "https://turlx.com";
const ORIGINS = new Set([DOMAIN, "https://www.turlx.com", "http://localhost:8000", "http://127.0.0.1:8000"]);
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

class ApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function headers(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : DOMAIN,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-telegram-init-data",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}
function json(req: Request, value: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: headers(req) });
}
function failConfig() {
  if (!db) throw new ApiError("Shortener service is not configured.", 503);
}
function hex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(keyBytes: Uint8Array, message: string) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
}
async function telegramId(raw: string): Promise<string> {
  if (!BOT || !raw || raw.length > 16384) throw new ApiError("Open Turlx from its Telegram Mini App.", 401);
  const p = new URLSearchParams(raw);
  const supplied = p.get("hash") ?? "";
  const authDate = Number(p.get("auth_date"));
  const userText = p.get("user") ?? "";
  const now = Math.floor(Date.now() / 1000);
  if (!supplied || !userText || !Number.isSafeInteger(authDate) || authDate > now + 60 || now - authDate > 86400)
    throw new ApiError("Telegram login data is missing or expired. Reopen the Mini App.", 401);
  p.delete("hash");
  const check = Array.from(p.entries()).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => k + "=" + v).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), BOT);
  const actual = hex(await hmac(new Uint8Array(secret), check));
  if (!/^[0-9a-f]{64}$/i.test(supplied) || actual !== supplied.toLowerCase())
    throw new ApiError("Telegram identity verification failed. Reopen the Mini App.", 401);
  let user: {id?: string | number};
  try { user = JSON.parse(userText); } catch { throw new ApiError("Telegram user data is invalid.", 401); }
  const id = String(user?.id ?? "");
  if (!/^\d{1,20}$/.test(id)) throw new ApiError("Telegram user ID is invalid.", 401);
  return id;
}
async function ownerId(req: Request): Promise<string> {
  failConfig();
  const init = req.headers.get("x-telegram-init-data") ?? "";
  if (init) {
    const id = await telegramId(init);
    const [mini, legacy] = await Promise.all([
      db!.from("gtrimmer_mini_access_users").select("status").eq("telegram_id", id).maybeSingle(),
      db!.from("gtrimmer_access_users").select("status").eq("telegram_id", id).limit(1)
    ]);
    if (mini.error || legacy.error) throw new ApiError("Could not verify your Turlx access.", 503);
    if (mini.data?.status !== "active" && !(legacy.data ?? []).some((r: {status:string}) => r.status === "active"))
      throw new ApiError("Your Telegram account does not have active Turlx access.", 403);
    return id;
  }
  const bearer = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!bearer) throw new ApiError("Sign in with your approved Telegram account first.", 401);
  const auth = await db!.auth.getUser(bearer);
  if (auth.error || !auth.data.user) throw new ApiError("Your sign-in session is invalid or expired.", 401);
  const legacy = await db!.from("gtrimmer_access_users").select("telegram_id,status").eq("user_id", auth.data.user.id).maybeSingle();
  if (legacy.error) throw new ApiError("Could not verify your Turlx access.", 503);
  const id = String(legacy.data?.telegram_id ?? "");
  if (legacy.data?.status !== "active" || !/^\d{1,20}$/.test(id))
    throw new ApiError("Your Telegram account does not have active Turlx access.", 403);
  return id;
}
function normalize(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new ApiError("Paste a destination URL first.");
  const value = raw.trim();
  if (value.length > 2048) throw new ApiError("URL must be 2048 characters or less.");
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value); }
  catch { throw new ApiError("Please enter a valid URL."); }
  if (!["http:", "https:"].includes(u.protocol) || !u.hostname || u.username || u.password)
    throw new ApiError("Only valid HTTP or HTTPS links can be shortened.");
  return u.toString();
}
function newCode(): string {
  let out = "";
  while (out.length < 7) {
    for (const b of crypto.getRandomValues(new Uint8Array(24))) {
      if (b < 248) out += ALPHABET[b % 62];
      if (out.length === 7) break;
    }
  }
  return out;
}
async function create(req: Request, body: Record<string, unknown>) {
  const owner = await ownerId(req);
  const destination = normalize(body.destinationUrl ?? body.destination_url);
  for (let i = 0; i < 6; i++) {
    const short_code = newCode();
    const result = await db!.from("gtrimmer_short_links")
      .insert({ telegram_id: owner, short_code, destination_url: destination })
      .select("id,short_code,destination_url,click_count,expires_at,created_at").single();
    if (!result.error && result.data) return { success: true, link: result.data, shortUrl: DOMAIN + "/r/" + short_code };
    if (result.error?.code !== "23505") {
      console.error("shortener create:", result.error?.message);
      throw new ApiError("Could not save this link. Try again.", 500);
    }
  }
  throw new ApiError("Could not generate a unique short code. Try again.", 503);
}
async function list(req: Request) {
  const owner = await ownerId(req);
  const result = await db!.from("gtrimmer_short_links")
    .select("id,short_code,destination_url,click_count,expires_at,created_at")
    .eq("telegram_id", owner).eq("is_active", true).order("created_at", { ascending: false }).limit(100);
  if (result.error) throw new ApiError("Could not load your short links.", 500);
  return { success: true, links: result.data ?? [] };
}
async function remove(req: Request, body: Record<string, unknown>) {
  const owner = await ownerId(req);
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError("A valid link ID is required.");
  const result = await db!.from("gtrimmer_short_links")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id).eq("telegram_id", owner).eq("is_active", true).select("id").maybeSingle();
  if (result.error) throw new ApiError("Could not remove this link.", 500);
  if (!result.data) throw new ApiError("Link not found or not owned by your account.", 404);
  return { success: true };
}
async function resolve(req: Request) {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!/^[A-Za-z0-9_-]{5,12}$/.test(code)) throw new ApiError("Short link not found.", 404);
  const result = await db!.from("gtrimmer_short_links").select("destination_url,expires_at")
    .eq("short_code", code).eq("is_active", true).maybeSingle();
  if (result.error) throw new ApiError("Redirect service is unavailable.", 503);
  if (!result.data) throw new ApiError("Short link not found.", 404);
  if (result.data.expires_at && new Date(result.data.expires_at).getTime() <= Date.now())
    throw new ApiError("This short link has expired.", 410);
  const count = await db!.rpc("gtrimmer_increment_short_link_click", { p_short_code: code });
  if (count.error) console.warn("Click count update failed:", count.error.message);
  return { success: true, destinationUrl: result.data.destination_url };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(req) });
  try {
    failConfig();
    if (req.method === "GET") return json(req, await resolve(req));
    if (req.method !== "POST") return json(req, { success: false, message: "Method not allowed." }, 405);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { throw new ApiError("Request body must be JSON."); }
    const action = String(body.action ?? "");
    if (action === "create") return json(req, await create(req, body), 201);
    if (action === "list") return json(req, await list(req));
    if (action === "delete") return json(req, await remove(req, body));
    throw new ApiError("Unknown shortener action.");
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (status >= 500 && !(error instanceof ApiError)) console.error("universal-shortener:", error);
    return json(req, { success: false, message: error instanceof ApiError ? error.message : "Shortener service error." }, status);
  }
});