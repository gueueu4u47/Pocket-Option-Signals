const BOT_TOKEN = process.env.TELEGRAM_PEREHODNIK_BOT_TOKEN;
const TELEGRAM_API = BOT_TOKEN
  ? `https://api.telegram.org/bot${BOT_TOKEN}`
  : "";

const WELCOME_PHOTO =
  "https://cdn.phototourl.com/free/2026-08-07-786b1da9-dcd5-4f79-a545-291912ffe192.png";
const WELCOME_TEXT = "猬囷笍 MAIN CLAUDE AI BOT 猬囷笍";
const BUTTON_TEXT = "馃帗 Claude Signal 馃帗";
const BUTTON_URL = "https://t.me/Pulsesignaloptionbot";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, service: "perehodnik-bot" });
  }

  if (!BOT_TOKEN) {
    return res.status(503).json({
      ok: false,
      error: "TELEGRAM_PEREHODNIK_BOT_TOKEN is not configured",
    });
  }

  let update;
  try {
    update =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid request body" });
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const text = message?.text || "";

  if (chatId && text.startsWith("/start")) {
    const telegramResponse = await fetch(`${TELEGRAM_API}/sendPhoto`, {
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

    const telegramResult = await telegramResponse.json().catch(() => ({}));

    if (!telegramResponse.ok || !telegramResult.ok) {
      console.error("Perehodnik Telegram sendPhoto failed", telegramResult);
      return res.status(502).json({
        ok: false,
        error: "Telegram sendPhoto failed",
      });
    }
  }

  return res.status(200).json({ ok: true });
}