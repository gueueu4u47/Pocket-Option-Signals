const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

const WELCOME_PHOTO =
  "https://cdn.phototourl.com/free/2026-08-07-786b1da9-dcd5-4f79-a545-291912ffe192.png";
const WELCOME_TEXT = "⬇️ MAIN CLAUDE AI BOT ⬇️";
const BUTTON_TEXT = "🎓 Claude Signal 🎓";
const BUTTON_URL = "https://t.me/Pulsesignaloptionbot";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(200).json({ ok: true });
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return res.status(503).json({ error: "Bot token is not configured" });
  }

  let update;
  try {
    update =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const text = message?.text || "";

  if (chatId && text.startsWith("/start")) {
    await fetch(`${TELEGRAM_API}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: WELCOME_PHOTO,
        caption: WELCOME_TEXT,
        reply_markup: {
          inline_keyboard: [[{ text: BUTTON_TEXT, url: BUTTON_URL }]],
        },
      }),
    });
  }

  return res.status(200).json({ ok: true });
}