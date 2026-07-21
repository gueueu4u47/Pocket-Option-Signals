const crypto = require("crypto");

function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const receivedBuffer = Buffer.from(receivedHash, "hex");
  const calculatedBuffer = Buffer.from(calculatedHash, "hex");
  if (
    receivedBuffer.length !== calculatedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, calculatedBuffer)
  ) {
    return null;
  }
  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > 86400) return null;
  try {
    return JSON.parse(params.get("user") || "{}");
  } catch {
    return null;
  }
}

const RATE = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const hits = (RATE.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    RATE.set(key, hits);
    return false;
  }
  hits.push(now);
  RATE.set(key, hits);
  if (RATE.size > 5000) {
    for (const [k, v] of RATE) {
      if (!v.length || now - v[v.length - 1] > windowMs) RATE.delete(k);
    }
  }
  return true;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST request" });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is not configured"
    });
  }

  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { image, mimeType = "image/jpeg", language = "ru", initData } = body;

    const user = validateTelegramInitData(initData, botToken);
    if (!user || !user.id) {
      return res.status(401).json({ error: "Telegram verification failed" });
    }

    if (!rateLimit("analyze:" + user.id, 8, 60000)) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }

    if (!["image/png", "image/jpeg", "image/webp"].includes(String(mimeType))) {
      return res.status(400).json({ error: "Unsupported image type" });
    }

    if (!image || typeof image !== "string") {
      return res.status(400).json({
        error: "Image is required"
      });
    }

    if (image.length > 12000000) {
      return res.status(413).json({ error: "Image is too large" });
    }

    const base64Image = image.includes(",")
      ? image.split(",").pop()
      : image;

    const prompt = language === "ru"
      ? `Ты — опытный трейдер-аналитик. Тебе дан ТОЛЬКО загруженный пользователем скриншот торгового графика. Разбирай именно то, что реально видно на этом изображении.

Правила:
- Не гарантируй результат и не обещай прибыль.
- Не выдумывай цену, индикаторы, актив или таймфрейм, если их не видно на скрине.
- Если данных недостаточно для сигнала — верни "NO_SIGNAL".
- Пиши живым, естественным языком. Никаких шаблонных, повторяющихся фраз — каждый разбор уникален и конкретен.
- Опирайся на то, что видно: свечи, их тела и тени, локальные уровни поддержки и сопротивления, тренд, структуру, импульсы и откаты, объём (если он виден).
- reasons — конкретные наблюдения по ЭТОМУ графику, а не общие слова.
- strategy — понятная логика сделки: где вход, что подтверждает идею, где она отменяется (инвалидируется), как вести позицию.
- tips — практичные советы именно под эту ситуацию.

Верни только JSON без Markdown:
{
  "direction": "BUY | SELL | NO_SIGNAL",
  "confidence": "низкая | средняя | высокая",
  "entryWindow": "краткое условие или время входа",
  "expiry": "предполагаемый интервал удержания",
  "asset": "распознанный актив или Не распознан",
  "timeframe": "распознанный таймфрейм или Не распознан",
  "summary": "1–2 живых предложения по сути графика",
  "reasons": ["конкретное наблюдение 1", "конкретное наблюдение 2", "конкретное наблюдение 3"],
  "strategy": "2–4 предложения: логика входа, подтверждение и точка отмены идеи",
  "tips": ["практичный совет 1", "практичный совет 2"]
}`
      : `You are an experienced trading analyst. You are given ONLY the chart screenshot uploaded by the user. Analyze exactly what is actually visible in this image.

Rules:
- Never guarantee a result or promise profit.
- Do not invent a price, indicators, asset, or timeframe if they are not visible.
- If there is not enough information for a signal, return "NO_SIGNAL".
- Write in a natural, human voice. No boilerplate or repeated phrasing — every breakdown is unique and specific.
- Base it on what is visible: candles, their bodies and wicks, local support/resistance levels, trend, structure, impulses and pullbacks, volume (if visible).
- reasons must be concrete observations about THIS chart, not generic statements.
- strategy must clearly explain the trade logic: where to enter, what confirms the idea, where it is invalidated, how to manage the position.
- tips must be practical and specific to this exact setup.

Return JSON only, without Markdown:
{
  "direction": "BUY | SELL | NO_SIGNAL",
  "confidence": "low | medium | high",
  "entryWindow": "short entry condition or timing",
  "expiry": "suggested holding interval",
  "asset": "recognized asset or Not recognized",
  "timeframe": "recognized timeframe or Not recognized",
  "summary": "1–2 lively sentences on the essence of the chart",
  "reasons": ["concrete observation 1", "concrete observation 2", "concrete observation 3"],
  "strategy": "2–4 sentences: entry logic, confirmation and the invalidation point",
  "tips": ["practical tip 1", "practical tip 2"]
}`;

    const geminiBody = JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64Image } }
          ]
        }
      ],
      generationConfig: { temperature: 0.6, responseMimeType: "application/json" }
    });
    let response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: geminiBody
      }
    );

    let data = await response.json();

    if (response.status === 404) {
      const fbUrl = response.url.replace("gemini-3-flash-preview", "gemini-2.5-flash");
      response = await fetch(fbUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: geminiBody
      });
      data = await response.json();
    }

    if (!response.ok) {
      console.error("Gemini error:", data);
      return res.status(response.status).json({
        error: data?.error?.message || "Gemini request failed"
      });
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!text) {
      return res.status(502).json({
        error: "AI returned no analysis"
      });
    }

    const cleanJson = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "");

    return res.status(200).json(JSON.parse(cleanJson));
  } catch (error) {
    console.error("Analyze error:", error);

    return res.status(500).json({
      error: "Unable to analyze the image"
    });
  }
};
