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

type BotLanguage = "en" | "bn";
const WORDS: Record<BotLanguage, Record<string, string>> = {
 en: {
  open:"🚀 Open Google Trim", convert:"🔗 Convert Link", access:"🔐 My Access", request:"📩 Request Access", help:"ℹ️ Help", contact:"💬 Contact Support", donate:"💛 Donate", start:"▶️ Start / Main Menu", language:"🌐 Language", placeholder:"Paste a share.google link to convert…",
  welcome:"Welcome to Google Trim by Shadow, {name}!\n\nUse the 🖥️ Mini App icon beside the message box to open Google Trim. Use the buttons below for Convert Link, Language, My Access, Help, Contact Support, and Donate. You can also paste a share.google URL here to convert it.",
  langPrompt:"🌐 Choose your preferred language:", langDone:"✅ Language set to English.",
  openPrompt:"Open the Mini App using the button below.",
  contactText:"💬 Need help with Google Trim?\n\nMessage @maazhossainkhan and include a short description of the problem.",
  contactButton:"✉️ Message Support",
  donateText:"💛 Support Google Trim by Shadow\n\n1) Binance Pay (USDT)\nUID: {uid}\n\n2) USDT (BEP20)\nAddress: {address}\n\n⚠️ For on-chain transfers, choose BNB Smart Chain (BEP20) exactly. Double-check the network before confirming.",
  copyUid:"📋 Copy Binance Pay UID", copyAddress:"📋 Copy USDT BEP20 address",
  helpText:"Google Trim by Shadow — Help\n\n• Open Google Trim: launch the Mini App.\n• Convert Link: send a share.google URL here.\n• My Access: check your permission.\n• Request Access: ask the administrator.\n• Contact Support: message support.\n• Language: switch between Bengali and English.\n\nOnly approved accounts can convert links. Requests stay pending until approved.\n\nCommands: /start, /app, /convert, /access, /request, /language, /contact, /donate, /help.",
  accessTitle:"🔐 Your access status", admin:"Administrator — full access enabled.", active:"Approved — converter access is enabled.", revoked:"Revoked — access is disabled. Contact the administrator.", pending:"Pending — waiting for administrator approval.", rejected:"Rejected — you may request access again.", needs:"Not approved yet — use Request Access.",
  reqActive:"✅ Your account is already approved.", reqPending:"⏳ Your request is already pending. Please wait.", reqRevoked:"⛔ Your access has been revoked. Contact the administrator.", reqSubmitted:"✅ Your access request was sent. You can convert after approval.",
  convPending:"⏳ Your request is pending approval.", convRevoked:"⛔ Your access was revoked. Contact the administrator.", convLocked:"🔒 Converter access is required. Tap Request Access and wait for approval.", convPrompt:"Send your share.google URL in the next message, or paste it here whenever you want to convert.",
  converted:"✅ Converted link:\n\n{url}\n\nUse the buttons below to copy or open the result.", copyConverted:"📋 Copy converted link", openConverted:"🔵 Open converted link",
  deniedPending:"Your request is pending approval.", deniedRevoked:"Your access was revoked. Contact the administrator.", denied:"You need administrator approval before conversion. Tap Request Access below.",
  unknown:"I didn't recognize that command or link.\n\nTap Convert Link and send a valid share.google URL, or tap Help.", error:"Sorry, I couldn't complete that request. Please try again, or tap Help."
 },
 bn: {
  open:"🚀 Google Trim খুলুন", convert:"🔗 লিংক রূপান্তর", access:"🔐 আমার অ্যাক্সেস", request:"📩 অ্যাক্সেসের অনুরোধ", help:"ℹ️ সাহায্য", contact:"💬 সাপোর্টে যোগাযোগ", donate:"💛 ডোনেট", start:"▶️ শুরু / মূল মেনু", language:"🌐 ভাষা", placeholder:"রূপান্তরের জন্য share.google লিংক পাঠান…",
  welcome:"Shadow-এর Google Trim-এ স্বাগতম, {name}!\n\nGoogle Trim খুলতে মেসেজ বক্সের পাশের 🖥️ Mini App icon চাপুন। নিচের বাটনগুলো দিয়ে লিংক রূপান্তর, ভাষা পরিবর্তন, অ্যাক্সেস, সাহায্য, সাপোর্ট ও ডোনেট ব্যবহার করুন। রূপান্তরের জন্য সরাসরি share.google URL-ও পাঠাতে পারবেন।",
  langPrompt:"🌐 আপনার পছন্দের ভাষা নির্বাচন করুন:", langDone:"✅ ভাষা বাংলা করা হয়েছে।",
  openPrompt:"নিচের বাটনে চাপ দিয়ে Mini App খুলুন।",
  contactText:"💬 Google Trim নিয়ে সাহায্য প্রয়োজন?\n\nসমস্যার সংক্ষিপ্ত বিবরণ দিয়ে @maazhossainkhan-কে মেসেজ দিন।",
  contactButton:"✉️ সাপোর্টে মেসেজ দিন",
  donateText:"💛 Shadow-এর Google Trim-কে সহায়তা করুন\n\n১) Binance Pay (USDT)\nUID: {uid}\n\n২) USDT (BEP20)\nAddress: {address}\n\n⚠️ অন-চেইন ট্রান্সফারে অবশ্যই BNB Smart Chain (BEP20) বেছে নিন। নিশ্চিত করার আগে নেটওয়ার্ক যাচাই করুন।",
  copyUid:"📋 Binance Pay UID কপি", copyAddress:"📋 USDT BEP20 address কপি",
  helpText:"Shadow-এর Google Trim — সাহায্য\n\n• Google Trim খুলুন: Mini App চালু করুন।\n• লিংক রূপান্তর: এখানে share.google URL পাঠান।\n• আমার অ্যাক্সেস: বর্তমান অনুমতি দেখুন।\n• অ্যাক্সেসের অনুরোধ: অ্যাডমিনের কাছে অনুমতি চান।\n• সাপোর্টে যোগাযোগ: সমস্যায় পড়লে মেসেজ দিন।\n• ভাষা: বাংলা ও English-এর মধ্যে পরিবর্তন করুন।\n\nশুধু অনুমোদিত অ্যাকাউন্ট লিংক রূপান্তর করতে পারবে। অ্যাডমিন অনুমোদন না দেওয়া পর্যন্ত অনুরোধ Pending থাকবে।\n\nকমান্ড: /start, /app, /convert, /access, /request, /language, /contact, /donate, /help।",
  accessTitle:"🔐 আপনার অ্যাক্সেসের অবস্থা", admin:"অ্যাডমিন — পূর্ণ অ্যাক্সেস চালু আছে।", active:"অনুমোদিত — কনভার্টার ব্যবহার করতে পারবেন।", revoked:"অ্যাক্সেস বাতিল — অ্যাডমিনের সঙ্গে যোগাযোগ করুন।", pending:"Pending — আপনার অনুরোধ অ্যাডমিনের অনুমোদনের অপেক্ষায় আছে।", rejected:"অনুরোধ বাতিল হয়েছে — চাইলে আবার আবেদন করতে পারেন।", needs:"এখনো অনুমোদন পাননি — অ্যাক্সেসের অনুরোধ বাটনে চাপ দিন।",
  reqActive:"✅ আপনার অ্যাকাউন্ট ইতোমধ্যে অনুমোদিত।", reqPending:"⏳ আপনার অনুরোধ Pending আছে। অ্যাডমিনের অনুমোদনের জন্য অপেক্ষা করুন।", reqRevoked:"⛔ আপনার অ্যাক্সেস বাতিল হয়েছে। অ্যাডমিনের সঙ্গে যোগাযোগ করুন।", reqSubmitted:"✅ অ্যাক্সেসের অনুরোধ অ্যাডমিনের কাছে পাঠানো হয়েছে। অনুমোদনের পর ব্যবহার করতে পারবেন।",
  convPending:"⏳ আপনার অনুরোধ অনুমোদনের অপেক্ষায় আছে।", convRevoked:"⛔ আপনার অ্যাক্সেস বাতিল হয়েছে। অ্যাডমিনের সঙ্গে যোগাযোগ করুন।", convLocked:"🔒 লিংক রূপান্তর করতে অ্যাক্সেস লাগবে। 📩 অ্যাক্সেসের অনুরোধ বাটনে চাপ দিন।", convPrompt:"পরের মেসেজে share.google URL পাঠান। চাইলে যেকোনো সময় সরাসরি এই চ্যাটেও লিংক পাঠাতে পারেন।",
  converted:"✅ রূপান্তরিত লিংক:\n\n{url}\n\nলিংক কপি বা খুলতে নিচের বাটন ব্যবহার করুন।", copyConverted:"📋 রূপান্তরিত লিংক কপি", openConverted:"🔵 রূপান্তরিত লিংক খুলুন",
  deniedPending:"আপনার অনুরোধ অ্যাডমিনের অনুমোদনের অপেক্ষায় আছে।", deniedRevoked:"আপনার অ্যাক্সেস বাতিল হয়েছে। অ্যাডমিনের সঙ্গে যোগাযোগ করুন।", denied:"লিংক রূপান্তরের আগে অ্যাডমিনের অনুমোদন লাগবে। নিচের 📩 অ্যাক্সেসের অনুরোধ বাটনে চাপ দিন।",
  unknown:"কমান্ড বা লিংকটি বুঝতে পারিনি।\n\n🔗 লিংক রূপান্তর বাটনে চাপ দিয়ে সঠিক share.google URL পাঠান, অথবা ℹ️ সাহায্য চাপুন।", error:"দুঃখিত, এই মুহূর্তে কাজটি সম্পন্ন করা যায়নি। একটু পরে আবার চেষ্টা করুন, অথবা ℹ️ সাহায্য চাপুন।"
 }
};
function tr(lang: BotLanguage, key: string): string { return WORDS[lang][key] ?? WORDS.en[key] ?? key; }
function isButton(text: string, key: string): boolean { return text === WORDS.en[key] || text === WORDS.bn[key]; }
function fillText(value: string, args: Record<string, string>): string { return value.replace(/\{(\w+)\}/g, (_m, key) => args[key] ?? ""); }
const LANGUAGE_CACHE_TTL_MS = 60_000;
const languageCache = new Map<string, { language: BotLanguage; expiresAt: number }>();
async function getLanguage(id: string): Promise<BotLanguage> {
  const cached = languageCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.language;
  try {
    if (!db) return "en";
    const { data, error } = await db.from("gtrimmer_bot_user_preferences")
      .select("language").eq("telegram_id", id).maybeSingle();
    if (error) return "en";
    const language: BotLanguage = data?.language === "bn" ? "bn" : "en";
    languageCache.set(id, { language, expiresAt: Date.now() + LANGUAGE_CACHE_TTL_MS });
    return language;
  } catch { return "en"; }
}
async function saveLanguage(id: string, language: BotLanguage): Promise<void> {
  if (!db) throw new Error("Database not configured");
  const { error } = await db.from("gtrimmer_bot_user_preferences").upsert({
    telegram_id: id, language, updated_at: new Date().toISOString()
  }, { onConflict: "telegram_id" });
  if (error) throw new Error("Could not save language preference");
  languageCache.set(id, { language, expiresAt: Date.now() + LANGUAGE_CACHE_TTL_MS });
}

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
  if (!response.ok || !body?.ok) throw new Error("Telegram API call failed for " + method + ": " + String(body?.description ?? response.status));
  return body.result;
}

function keyboard(lang: BotLanguage = "en") {
  return {
    keyboard: [
      // The left-side Telegram Menu button is the only Mini App launcher.
      // Keep the reply keyboard focused on the remaining chat actions.
      [{ text: tr(lang, "convert") }],
      [{ text: tr(lang, "access") }, { text: tr(lang, "request") }],
      [{ text: tr(lang, "language") }, { text: tr(lang, "help") }],
      [{ text: tr(lang, "contact") }, { text: tr(lang, "donate") }]
    ],
    resize_keyboard: true,
    is_persistent: true,
    one_time_keyboard: false,
    input_field_placeholder: tr(lang, "placeholder")
  };
}
async function sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  const lang = await getLanguage(String(chatId));
  // Restore the original reply keyboard. It is independent of Telegram's native
  // left-side Menu/Commands button; inline markup in extra is preserved for actions.
  return await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: keyboard(lang),
    disable_web_page_preview: true,
    ...extra
  });
}
function displayName(user: TelegramUser): string {
  const username = typeof user.username === "string" ? user.username.replace(/^@/, "").trim() : "";
  return username ? "@" + username : [user.first_name, user.last_name].filter(Boolean).join(" ") || "Telegram user";
}
function extractShareGoogleUrl(messageText: string): string | null {
  // Extract the URL even when the user sends explanatory text before or after it.
  const match = messageText.match(/(?:https?:\/\/)?(?:www\.)?share\.google\/[^\s<>"']+/i);
  if (!match) return null;
  const cleaned = match[0].replace(/[)\],.!?;:]+$/g, "");
  return /^https?:\/\//i.test(cleaned) ? cleaned : "https://" + cleaned;
}
function convertUrl(rawValue: string): { token: string; url: string } | null {
  const extracted = extractShareGoogleUrl(rawValue);
  if (!extracted) return null;
  let parsed: URL;
  try { parsed = new URL(extracted); } catch { return null; }
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
  if (ADMIN_TELEGRAM_IDS.has(telegramId)) return { state: "admin" };

  // Read legacy and Mini App access in parallel; preserve legacy-store precedence.
  const [
    { data: legacyUsers, error: legacyError },
    { data: miniUser, error: miniUserError }
  ] = await Promise.all([
    db.from("gtrimmer_access_users")
      .select("telegram_id, username, status, is_admin")
      .eq("telegram_id", telegramId).limit(1),
    db.from("gtrimmer_mini_access_users")
      .select("telegram_id, username, status, is_admin")
      .eq("telegram_id", telegramId).maybeSingle()
  ]);
  if (legacyError) throw new Error("Could not read existing access status.");
  if (miniUserError) throw new Error("Could not read Mini App access status.");

  const legacyUser = legacyUsers?.[0];
  if (legacyUser) {
    if (legacyUser.status !== "active") return { state: "revoked", username: legacyUser.username };
    return { state: legacyUser.is_admin ? "admin" : "active", username: legacyUser.username };
  }
  if (miniUser) {
    if (miniUser.status !== "active") return { state: "revoked", username: miniUser.username };
    return { state: miniUser.is_admin ? "admin" : "active", username: miniUser.username };
  }

  // For first-time users, check both request stores in parallel as well.
  const [
    { data: miniRequest, error: miniRequestError },
    { data: legacyRequests, error: legacyRequestError }
  ] = await Promise.all([
    db.from("gtrimmer_mini_access_requests")
      .select("status, username").eq("telegram_id", telegramId).maybeSingle(),
    db.from("gtrimmer_access_requests")
      .select("status, username").eq("telegram_id", telegramId).limit(1)
  ]);
  if (miniRequestError) throw new Error("Could not read Mini App request status.");
  if (legacyRequestError) throw new Error("Could not read existing request status.");
  const request = miniRequest ?? legacyRequests?.[0] ?? null;
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

const configuredMenuChats = new Set<number>();

async function configureTelegramMenu(chatId: number): Promise<boolean> {
  const commands = [
    { command: "start", description: "🎨 Show main menu" },
    { command: "app", description: "🖥️ Open Google Trim Mini App" },
    { command: "language", description: "🌐 Change language: বাংলা / English" },
    { command: "convert", description: "🔗 Convert a share.google link" },
    { command: "access", description: "🔐 Check access status" },
    { command: "request", description: "📩 Request converter access" },
    { command: "contact", description: "💬 Contact support" },
    { command: "donate", description: "💛 Donate to support Google Trim" },
    { command: "help", description: "ℹ️ How to use Google Trim" }
  ];
  const miniAppMenu = { type: "web_app", text: "🖥️", web_app: { url: MINI_APP_URL } };

  async function attempt(label: string, operation: () => Promise<unknown>): Promise<boolean> {
    try {
      await operation();
      return true;
    } catch (error) {
      console.warn("Could not configure Telegram " + label + ":", error instanceof Error ? error.message : "unknown error");
      return false;
    }
  }

  // Independent configuration calls run concurrently to reduce first-message latency.
  const results = await Promise.all([
    attempt("default commands", () => telegramApi("setMyCommands", { commands, scope: { type: "default" } })),
    attempt("private-chat commands", () => telegramApi("setMyCommands", { commands, scope: { type: "all_private_chats" } })),
    attempt("default Mini App menu", () => telegramApi("setChatMenuButton", { menu_button: miniAppMenu })),
    attempt("chat Mini App menu", () => telegramApi("setChatMenuButton", { chat_id: chatId, menu_button: miniAppMenu }))
  ]);
  const success = results.every(Boolean);
  if (success) console.log("G-Trimmer Telegram menu configured successfully for chat", chatId);
  return success;
}

async function sendLanguagePicker(chatId: number, lang: BotLanguage) {
  await sendMessage(chatId, tr(lang, "langPrompt"), {
    reply_markup: { inline_keyboard: [[
      { text: "🇧🇩 বাংলা", callback_data: "set_lang:bn" },
      { text: "🇬🇧 English", callback_data: "set_lang:en" }
    ]] }
  });
}
async function handleCallback(query: any) {
  const callbackId = typeof query?.id === "string" ? query.id : "";
  const user = query?.from as TelegramUser | undefined;
  const message = query?.message;
  const chat = message?.chat;
  if (!callbackId || !user || !Number.isSafeInteger(user.id) || chat?.type !== "private" || !Number.isSafeInteger(chat?.id)) return;
  if (!configuredMenuChats.has(chat.id)) {
    const configured = await configureTelegramMenu(chat.id);
    if (configured) configuredMenuChats.add(chat.id);
  }
  const data = typeof query?.data === "string" ? query.data : "";
  if (data !== "set_lang:bn" && data !== "set_lang:en") {
    await telegramApi("answerCallbackQuery", { callback_query_id: callbackId });
    return;
  }
  const lang: BotLanguage = data.endsWith(":bn") ? "bn" : "en";
  await saveLanguage(String(user.id), lang);
  await telegramApi("answerCallbackQuery", { callback_query_id: callbackId, text: lang === "bn" ? "ভাষা বাংলা করা হয়েছে" : "Language updated" });
  try { await telegramApi("editMessageReplyMarkup", { chat_id: chat.id, message_id: message.message_id, reply_markup: { inline_keyboard: [] } }); } catch { /* optional cleanup */ }
  await sendMessage(chat.id, tr(lang, "langDone"));
  await sendMessage(chat.id, fillText(tr(lang, "welcome"), { name: displayName(user) }));
}
async function handleText(chatId: number, user: TelegramUser, messageText: string) {
  const text = messageText.trim();
  const first = text.split(/\s+/)[0];
  let command = first.split("@")[0].toLowerCase();
  // Mini App Options buttons return to the bot using /start <action>.
  if (command === "/start") {
    const payload = (text.split(/\s+/)[1] ?? "").toLowerCase();
    const allowedPayloads = new Set(["start", "app", "language", "lang", "convert", "access", "request", "contact", "donate", "help"]);
    if (allowedPayloads.has(payload) && payload !== "start") command = "/" + payload;
  }
  const lang = await getLanguage(String(user.id));

  if (command === "/start" || isButton(text, "start")) {
    if (!configuredMenuChats.has(chatId)) {
      const configured = await configureTelegramMenu(chatId);
      if (configured) configuredMenuChats.add(chatId);
    }
    await sendMessage(chatId, fillText(tr(lang, "welcome"), { name: displayName(user) }));
    return;
  }
  if (command === "/language" || command === "/lang" || isButton(text, "language")) {
    await sendLanguagePicker(chatId, lang);
    return;
  }
  if (command === "/app" || isButton(text, "open")) {
    await sendMessage(chatId, tr(lang, "openPrompt"), { reply_markup: { inline_keyboard: [[{ text: tr(lang, "open"), web_app: { url: MINI_APP_URL } }]] } });
    return;
  }
  if (command === "/contact" || isButton(text, "contact")) {
    await sendMessage(chatId, tr(lang, "contactText"), { reply_markup: { inline_keyboard: [[{ text: tr(lang, "contactButton"), url: CONTACT_URL }]] } });
    return;
  }
  if (command === "/donate" || isButton(text, "donate")) {
    await sendMessage(chatId, fillText(tr(lang, "donateText"), { uid: BINANCE_PAY_UID, address: USDT_BEP20_ADDRESS }), {
      reply_markup: { inline_keyboard: [
        [{ text: tr(lang, "copyUid"), copy_text: { text: BINANCE_PAY_UID } }],
        [{ text: tr(lang, "copyAddress"), copy_text: { text: USDT_BEP20_ADDRESS } }]
      ] }
    });
    return;
  }
  if (command === "/help" || isButton(text, "help")) {
    await sendMessage(chatId, tr(lang, "helpText"));
    return;
  }
  if (command === "/access" || command === "/myaccess" || isButton(text, "access")) {
    const access = await getAccessState(String(user.id));
    const key: Record<AccessState["state"], string> = { admin:"admin", active:"active", revoked:"revoked", pending:"pending", rejected:"rejected", needs_request:"needs" };
    await sendMessage(chatId, tr(lang, "accessTitle") + "\n\nAccount: " + displayName(user) + "\nStatus: " + tr(lang, key[access.state]));
    return;
  }
  if (command === "/request" || command === "/requestaccess" || isButton(text, "request")) {
    const result = await requestAccess(user);
    const key: Record<"active" | "pending" | "revoked" | "submitted", string> = { active:"reqActive", pending:"reqPending", revoked:"reqRevoked", submitted:"reqSubmitted" };
    await sendMessage(chatId, tr(lang, key[result]));
    return;
  }
  if (command === "/convert" || isButton(text, "convert")) {
    const access = await getAccessState(String(user.id));
    if (access.state !== "active" && access.state !== "admin") {
      const key = access.state === "pending" ? "convPending" : access.state === "revoked" ? "convRevoked" : "convLocked";
      await sendMessage(chatId, tr(lang, key));
      return;
    }
    await sendMessage(chatId, tr(lang, "convPrompt"));
    return;
  }

  const conversionStartedAt = Date.now();
  const converted = convertUrl(text);
  if (converted) {
    const access = await getAccessState(String(user.id));
    if (access.state !== "active" && access.state !== "admin") {
      const reason = access.state === "pending" ? tr(lang, "deniedPending") : access.state === "revoked" ? tr(lang, "deniedRevoked") : tr(lang, "denied");
      await sendMessage(chatId, "🔒 " + reason);
      return;
    }
    const linkButtons: Record<string, unknown>[] = [];
    if (converted.url.length <= 256) linkButtons.push({ text: tr(lang, "copyConverted"), copy_text: { text: converted.url } });
    linkButtons.push({ text: tr(lang, "openConverted"), url: converted.url });
    await sendMessage(chatId, fillText(tr(lang, "converted"), { url: converted.url }), { reply_markup: { inline_keyboard: [linkButtons] } });
    console.info("Share link conversion response sent in", Date.now() - conversionStartedAt, "ms");
    return;
  }
  await sendMessage(chatId, tr(lang, "unknown"));
}



Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!BOT_TOKEN || !WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY || !db) return json({ ok: false, error: "Bot webhook or database is not configured" }, 503);
  const suppliedSecret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!equalSecret(suppliedSecret, WEBHOOK_SECRET)) return json({ ok: false, error: "Unauthorized webhook" }, 401);
  let update: any;
  try { update = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  try {
    if (update?.callback_query) {
      await handleCallback(update.callback_query);
      return json({ ok: true });
    }
    const message = update?.message;
    const messageText = typeof message?.text === "string" ? message.text.trim() : "";
    const chat = message?.chat;
    const user = message?.from as TelegramUser | undefined;
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || !Number.isSafeInteger(chat?.id) || chat?.type !== "private" || !messageText) return json({ ok: true });
    await handleText(chat.id, user, messageText);
    return json({ ok: true });
  } catch (error) {
    console.error("Telegram bot update failed:", error instanceof Error ? error.message : "unknown error");
    const message = update?.message;
    const chat = message?.chat;
    const user = message?.from as TelegramUser | undefined;
    if (user && Number.isSafeInteger(chat?.id) && chat?.type === "private") {
      try { await sendMessage(chat.id, tr(await getLanguage(String(user.id)), "error")); } catch { /* Telegram may be unavailable. */ }
    }
    return json({ ok: true });
  }
});
