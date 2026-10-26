import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_TELEGRAM_IDS = new Set((Deno.env.get("ADMIN_TELEGRAM_IDS") ?? "").split(",").map(v => v.trim()).filter(v => /^\d+$/.test(v)));
const MINI_APP_URL = "https://turlx.com/";
const CONTACT_URL = "https://t.me/maazhossainkhan";
const BINANCE_PAY_UID = "731347605";
const USDT_BEP20_ADDRESS = "0xdf0587f04b6126ba1fd03b4391e17a99b717823b";
const API_BASE = "https://api.telegram.org";
const db = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

type TelegramUser = { id: number; username?: string; first_name?: string; last_name?: string };
type AccessState = { state: "admin" | "active" | "revoked" | "pending" | "rejected" | "needs_request"; username?: string | null };

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function equalSecret(a: string, b: string): boolean {
  if (a.length !== b.length || !a || !b) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
async function telegramApi(method: string, payload: Record<string, unknown>): Promise<any> {
  const response = await fetch(API_BASE + "/bot" + BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  let body: any;
  try { body = await response.json(); } catch { throw new Error("Telegram API returned invalid JSON."); }
  if (!response.ok || !body?.ok) throw new Error("Telegram API call failed for " + method + ".");
  return body.result;
}
function keyboard() {
  return {
    keyboard: [
      [{ text: "🚀 Open Google Trim", style: "primary", web_app: { url: MINI_APP_URL } }, { text: "🔗 Convert Link", style: "success" }],
      [{ text: "🔐 My Access", style: "primary" }, { text: "📩 Request Access", style: "success" }],
      [{ text: "ℹ️ Help", style: "primary" }, { text: "💬 Contact Support", style: "success" }],
      [{ text: "💛 Donate", style: "success" }]
    ],
    resize_keyboard: true,
    // Do not force the reply keyboard to stay open. Telegram's native keyboard
    // toggle lets each user hide/show all bot buttons whenever they want.
    is_persistent: false,
    one_time_keyboard: false,
    input_field_placeholder: "Paste a share.google link to convert…"
  };
}
async function sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: keyboard(),
    disable_web_page_preview: true,
    ...extra
  });
}
function displayName(user: TelegramUser): string {
  const username = typeof user.username === "string" ? user.username.replace(/^@/, "").trim() : "";
  return username ? "@" + username : [user.first_name, user.last_name].filter(Boolean).join(" ") || "Telegram user";
}
function convertUrl(rawValue: string): { token: string; url: string } | null {
  const trimmed = rawValue.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : "https://" + trimmed;
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { return null; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "share.google" && hostname !== "www.share.google") return null;
  const token = parsed.pathname.split("/").filter(Boolean)[0] || "";
  if (!token) return null;
  return { token, url: "https://www.google.com/share.google?q=" + encodeURIComponent(token) };
}
async function getAccessState(telegramId: string): Promise<AccessState> {
  if (!db) throw new Error("Bot database access is not configured.");

  if (ADMIN_TELEGRAM_IDS.has(telegramId)) {
    const { error } = await db.from("gtrimmer_mini_access_users").upsert({
      telegram_id: telegramId,
      username: null,
      display_name: "Telegram administrator",
      status: "active",
      is_admin: true,
      updated_at: new Date().toISOString()
    }, { onConflict: "telegram_id" });
    if (error) throw new Error("Could not initialize configured admin.");
    return { state: "admin" };
  }

  const { data: legacyUser, error: legacyError } = await db.from("gtrimmer_access_users")
    .select("telegram_id, username, status, is_admin")
    .eq("telegram_id", telegramId).limit(1);
  if (legacyError) throw new Error("Could not read existing access status.");
  if (legacyUser?.[0]) {
    const record = legacyUser[0];
    if (record.status !== "active") return { state: "revoked", username: record.username };
    return { state: record.is_admin ? "admin" : "active", username: record.username };
  }

  const { data: miniUser, error: miniUserError } = await db.from("gtrimmer_mini_access_users")
    .select("telegram_id, username, status, is_admin").eq("telegram_id", telegramId).maybeSingle();
  if (miniUserError) throw new Error("Could not read Mini App access status.");
  if (miniUser) {
    if (miniUser.status !== "active") return { state: "revoked", username: miniUser.username };
    return { state: miniUser.is_admin ? "admin" : "active", username: miniUser.username };
  }

  const { data: miniRequest, error: miniRequestError } = await db.from("gtrimmer_mini_access_requests")
    .select("status, username").eq("telegram_id", telegramId).maybeSingle();
  if (miniRequestError) throw new Error("Could not read Mini App request status.");
  const { data: legacyRequest, error: legacyRequestError } = await db.from("gtrimmer_access_requests")
    .select("status, username").eq("telegram_id", telegramId).limit(1);
  if (legacyRequestError) throw new Error("Could not read existing request status.");
  const request = miniRequest ?? legacyRequest?.[0] ?? null;
  if (request?.status === "pending") return { state: "pending", username: request.username };
  if (request?.status === "rejected") return { state: "rejected", username: request.username };
  return { state: "needs_request", username: request?.username ?? null };
}
async function notifyAdminsOfRequest(telegramUser: TelegramUser) {
  // Notify active Mini App admins; failures do not undo a valid access request.
  const { data, error } = await db!.from("gtrimmer_mini_access_users")
    .select("telegram_id").eq("status", "active").eq("is_admin", true).limit(50);
  if (error) {
    console.warn("Could not find active Mini App admins to notify.");
    return;
  }
  const requester = displayName(telegramUser);
  const telegramId = String(telegramUser.id);
  for (const admin of data ?? []) {
    const adminId = String(admin.telegram_id ?? "");
    if (!/^\\d{1,20}$/.test(adminId) || adminId === telegramId) continue;
    try {
      await telegramApi("sendMessage", {
        chat_id: Number(adminId),
        text: "🔔 New Google Trim access request\\n\\nFrom: " + requester + "\\nTelegram ID: " + telegramId +
          "\\n\\nOpen the Admin dashboard to approve or reject this request.",
        reply_markup: {
          inline_keyboard: [[{ text: "Review access request", web_app: { url: MINI_APP_URL } }]]
        },
        disable_web_page_preview: true
      });
    } catch (notifyError) {
      // User might not have started the bot yet; do not fail the request for this.
      console.warn("Could not notify one Mini App administrator:", notifyError instanceof Error ? notifyError.message : "unknown error");
    }
  }
}

async function requestAccess(telegramUser: TelegramUser): Promise<"active" | "pending" | "revoked" | "submitted"> {
  const telegramId = String(telegramUser.id);
  const state = await getAccessState(telegramId);
  if (state.state === "active" || state.state === "admin") return "active";
  if (state.state === "revoked") return "revoked";
  if (state.state === "pending") return "pending";
  const username = typeof telegramUser.username === "string" ? telegramUser.username.replace(/^@/, "").trim().slice(0, 64) || null : null;
  const name = [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(" ").trim() || displayName(telegramUser);
  const { error } = await db!.from("gtrimmer_mini_access_requests").upsert({
    telegram_id: telegramId,
    username,
    display_name: name.slice(0, 160),
    status: "pending",
    requested_at: new Date().toISOString(),
    reviewed_at: null,
    reviewed_by_telegram_id: null
  }, { onConflict: "telegram_id" });
  if (error) throw new Error("Could not submit access request.");
  await notifyAdminsOfRequest(telegramUser);
  return "submitted";
}
async function configureTelegramMenu(chatId: number) {
  // These convenience setup calls should not prevent /start from replying if Telegram rejects a menu setting.
  try {
    await telegramApi("setMyCommands", { commands: [
      { command: "start", description: "🎨 Show bot menu" },
      { command: "app", description: "🔵 Open Google Trim Mini App" },
      { command: "convert", description: "🟢 Convert a share.google link" },
      { command: "access", description: "🔐 Check your access status" },
      { command: "request", description: "📩 Request converter access" },
      { command: "contact", description: "💬 Contact support" },
      { command: "donate", description: "💛 Donate to support Google Trim" },
      { command: "help", description: "ℹ️ How to use Google Trim" }
    ] });
  } catch (error) { console.warn("Could not refresh bot commands:", error); }
  try {
    await telegramApi("setChatMenuButton", {
      chat_id: chatId,
      menu_button: { type: "web_app", text: "🚀 Open Google Trim", web_app: { url: MINI_APP_URL } }
    });
  } catch (error) { console.warn("Could not set per-chat Mini App menu button:", error); }
}
async function handleText(chatId: number, telegramUser: TelegramUser, messageText: string) {
  const text = messageText.trim();
  const first = text.split(/\s+/)[0];
  const command = first.split("@")[0].toLowerCase();
  if (command === "/start") {
    await configureTelegramMenu(chatId);
    await sendMessage(chatId,
      "Welcome to Google Trim by Shadow, " + displayName(telegramUser) + "!\n\n" +
      "Use the buttons below whenever you need them. Telegram's own keyboard toggle lets you hide or show the buttons. " +
      "You can also paste a share.google URL directly in this chat to convert it without opening the Mini App.");
    return;
  }
  if (command === "/app" || text === "🚀 Open Google Trim") {
    await sendMessage(chatId, "Open the Mini App using the button below.", {
      reply_markup: { inline_keyboard: [[{ text: "🚀 Open Google Trim", style: "primary", web_app: { url: MINI_APP_URL } }]] }
    });
    return;
  }
  if (command === "/contact" || text === "💬 Contact Support") {
    await sendMessage(
      chatId,
      "💬 Need help with Google Trim?\n\nFor any issue, send a message to @maazhossainkhan. Include a short description of the problem so support can help you.",
      { reply_markup: { inline_keyboard: [[{ text: "✉️ Message @maazhossainkhan", style: "primary", url: CONTACT_URL }]] } }
    );
    return;
  }
  if (command === "/donate" || text === "💛 Donate") {
    await sendMessage(
      chatId,
      "💛 Support Google Trim by Shadow\\n\\n" +
      "Choose either donation method:\\n\\n" +
      "1) Binance Pay (USDT)\\n" +
      "UID: " + BINANCE_PAY_UID + "\\n\\n" +
      "2) USDT (BEP20)\\n" +
      "Address: " + USDT_BEP20_ADDRESS + "\\n\\n" +
      "⚠️ For on-chain transfers, choose BNB Smart Chain (BEP20) exactly. Sending through another network may result in lost funds. Please double-check before confirming.",
      { reply_markup: { inline_keyboard: [
        [{ text: "📋 Copy Binance Pay UID", style: "success", copy_text: { text: BINANCE_PAY_UID } }],
        [{ text: "📋 Copy USDT BEP20 address", style: "success", copy_text: { text: USDT_BEP20_ADDRESS } }]
      ] } }
    );
    return;
  }
  if (command === "/help" || text === "ℹ️ Help") {
    await sendMessage(chatId,
      "Google Trim by Shadow — Help\n\n" +
      "• Open Google Trim: launch the Mini App.\n" +
      "• Convert Link: send a share.google URL here and the bot returns its converted URL.\n" +
      "• My Access: check your current permission.\n" +
      "• Request Access: ask the administrator for permission.\n" +
      "• Contact Support: message support if you run into an issue.\n\n" +
      "The bot only converts approved accounts. A request remains pending until an administrator approves it.\n\n" +
      "Commands: /start, /app, /convert, /access, /request, /contact, /donate, /help.", { reply_markup: keyboard() });
    return;
  }
  if (command === "/access" || command === "/myaccess" || text === "🔐 My Access") {
    const access = await getAccessState(String(telegramUser.id));
    const statusText: Record<AccessState["state"], string> = {
      admin: "Administrator — full access enabled.",
      active: "Approved — converter access is enabled.",
      revoked: "Revoked — your access is disabled. Contact the administrator.",
      pending: "Pending — your request is waiting for administrator approval.",
      rejected: "Rejected — your previous request was declined. You may request access again.",
      needs_request: "Not approved yet — use Request Access to send a request."
    };
    await sendMessage(chatId, "🔐 Your access status\n\nAccount: " + displayName(telegramUser) + "\nStatus: " + statusText[access.state], { reply_markup: keyboard() });
    return;
  }
  if (command === "/request" || command === "/requestaccess" || text === "📩 Request Access") {
    const result = await requestAccess(telegramUser);
    const messages = {
      active: "✅ Your account is already approved. You can use the converter.",
      pending: "⏳ Your access request is already pending. Please wait for the administrator.",
      revoked: "⛔ Your access has been revoked. Contact the administrator.",
      submitted: "✅ Your access request has been sent to the administrator. You will be able to convert after approval."
    };
    await sendMessage(chatId, messages[result], { reply_markup: keyboard() });
    return;
  }
  if (command === "/convert" || text === "🔗 Convert Link") {
    const access = await getAccessState(String(telegramUser.id));
    if (access.state !== "active" && access.state !== "admin") {
      await sendMessage(chatId,
        access.state === "pending" ? "⏳ Your request is pending approval." :
        access.state === "revoked" ? "⛔ Your access was revoked. Contact the administrator." :
        "🔒 Converter access is required. Tap 📩 Request Access and wait for approval.");
      return;
    }
    await sendMessage(chatId, "Send your share.google URL in your next message, or paste it directly in this chat whenever you want to convert.", { reply_markup: keyboard() });
    return;
  }

  const converted = convertUrl(text);
  if (converted) {
    const access = await getAccessState(String(telegramUser.id));
    if (access.state !== "active" && access.state !== "admin") {
      const reason = access.state === "pending" ? "Your request is pending approval." :
        access.state === "revoked" ? "Your access was revoked. Contact the administrator." :
        "You need administrator approval before conversion. Tap 📩 Request Access below.";
      await sendMessage(chatId, "🔒 " + reason);
      return;
    }
    const linkButtons: Record<string, unknown>[] = [];
    if (converted.url.length <= 256) {
      linkButtons.push({ text: "📋 Copy converted link", style: "success", copy_text: { text: converted.url } });
    }
    linkButtons.push({ text: "🔵 Open converted link", style: "primary", url: converted.url });
    await sendMessage(
      chatId,
      "✅ Converted link:\n\n" + converted.url + "\n\nUse the buttons below to copy or open the result.",
      { reply_markup: { inline_keyboard: [linkButtons] } }
    );
    return;
  }
  await sendMessage(chatId, "I didn't recognize that command or link.\n\nTap 🔗 Convert Link, then send a valid share.google URL, or type /help.");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!BOT_TOKEN || !WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY || !db) {
    return json({ ok: false, error: "Bot webhook or database is not configured" }, 503);
  }
  const suppliedSecret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!equalSecret(suppliedSecret, WEBHOOK_SECRET)) return json({ ok: false, error: "Unauthorized webhook" }, 401);
  let update: any;
  try { update = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const message = update?.message;
  const messageText = typeof message?.text === "string" ? message.text.trim() : "";
  const chat = message?.chat;
  const telegramUser = message?.from as TelegramUser | undefined;
  if (!telegramUser || !Number.isSafeInteger(telegramUser.id) || telegramUser.id <= 0 || !Number.isSafeInteger(chat?.id) || chat?.type !== "private" || !messageText) {
    return json({ ok: true });
  }
  try {
    await handleText(chat.id, telegramUser, messageText);
    return json({ ok: true });
  } catch (error) {
    console.error("Telegram bot update failed:", error instanceof Error ? error.message : "unknown error");
    try {
      await sendMessage(chat.id, "Sorry, I couldn't complete that request just now. Please try again in a moment, or type /help.");
    } catch { /* Telegram may be temporarily unavailable; webhook still returns a controlled response. */ }
    // Return 200 to prevent a persistent Telegram retry loop for a bad individual message.
    return json({ ok: true });
  }
});
