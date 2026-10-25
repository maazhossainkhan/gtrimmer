const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const MINI_APP_URL = "https://turlx.com/";
const API_BASE = "https://api.telegram.org";

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

async function sendStart(chatId: number, firstName?: string) {
  const greeting = firstName ? "Hi " + firstName + "!\n\n" : "";
  const response = await fetch(API_BASE + "/bot" + BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: greeting + "Welcome to Google Trim by Shadow. Open the converter below. Access is still controlled by the administrator; opening this Mini App does not automatically authorize your account.",
      reply_markup: { inline_keyboard: [[{ text: "Open Google Trim", web_app: { url: MINI_APP_URL } }]] },
      disable_web_page_preview: true
    })
  });
  if (!response.ok) throw new Error("Telegram sendMessage failed with HTTP " + response.status);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!BOT_TOKEN || !WEBHOOK_SECRET) return json({ ok: false, error: "Bot webhook is not configured" }, 503);
  const suppliedSecret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (suppliedSecret.length !== WEBHOOK_SECRET.length || suppliedSecret !== WEBHOOK_SECRET) return json({ ok: false, error: "Unauthorized webhook" }, 401);
  let update: any;
  try { update = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const message = update?.message;
  const messageText = typeof message?.text === "string" ? message.text.trim() : "";
  const chatId = message?.chat?.id;
  if (!Number.isSafeInteger(chatId) || message?.chat?.type !== "private" || !messageText.startsWith("/")) return json({ ok: true });
  const command = messageText.split(/\s+/)[0].split("@")[0].toLowerCase();
  if (command === "/start" || command === "/app" || command === "/help") {
    try { await sendStart(chatId, typeof message?.from?.first_name === "string" ? message.from.first_name : undefined); }
    catch (error) { console.error("Could not reply to Telegram update:", error); return json({ ok: false, error: "Could not send bot reply" }, 502); }
  }
  return json({ ok: true });
});
