const crypto = require("crypto");

/* ============================================================
   Signal Pulse — /api/analyze  (МУЛЬТИ-АГЕНТНЫЙ АНАЛИЗ)
   Несколько специализированных ИИ-агентов анализируют ОДИН
   загруженный скриншот графика с разных сторон, затем
   агент-агрегатор сводит их вердикты в 1 финальный сигнал.
   Выходной JSON идентичен прежнему — фронтенд менять НЕ нужно.
   ============================================================ */

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
  if (receivedBuffer.length !== calculatedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, calculatedBuffer)) {
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

/* ---------- Gemini helpers ---------- */
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];

function parseJsonLoose(text) {
  let clean = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  // Вырезаем на всякий случай всё до первой { и после последней }
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first > -1 && last > -1 && last > first) clean = clean.slice(first, last + 1);
  return JSON.parse(clean);
}

async function callGemini(apiKey, parts, temperature, timeoutMs) {
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { temperature, responseMimeType: "application/json" }
  });
  let lastErr = "unknown";
  for (const model of GEMINI_MODELS) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs || 22000);
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: ctrl.signal }
      );
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        lastErr = (data && data.error && data.error.message) || ("HTTP " + resp.status);
        if ([404, 429, 500, 503].includes(resp.status)) continue; // пробуем запасную модель
        throw new Error(lastErr);
      }
      const text = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || [])
        .map((p) => p.text || "").join("").trim();
      if (!text) { lastErr = "empty response"; continue; }
      return parseJsonLoose(text);
    } catch (e) {
      lastErr = (e && e.message) || String(e);
      if (e && e.name === "AbortError") break;
      continue;
    } finally {
      clearTimeout(to);
    }
  }
  throw new Error(lastErr);
}

/* ---------- Определения агентов ---------- */
const AGENTS = [
  {
    key: "trend",
    ru: { role: "Тренд и структура рынка", focus: "общий тренд, фаза рынка, структура (последовательность максимумов и минимумов), направление доминирующей силы" },
    en: { role: "Trend & market structure", focus: "overall trend, market phase, structure (sequence of highs and lows), direction of the dominant force" }
  },
  {
    key: "price",
    ru: { role: "Прайс-экшн и свечи", focus: "свечи (тела и тени), свечные паттерны, импульсы и откаты, краткосрочный моментум и тайминг входа" },
    en: { role: "Price action & candles", focus: "candles (bodies and wicks), candlestick patterns, impulses and pullbacks, short-term momentum and entry timing" }
  },
  {
    key: "levels",
    ru: { role: "Уровни, риск и тайминг", focus: "ключевые уровни поддержки и сопротивления, близость цены к ним, зоны реакции, волатильность и точка отмены идеи (инвалидация)" },
    en: { role: "Levels, risk & timing", focus: "key support/resistance levels, price proximity to them, reaction zones, volatility and the invalidation point" }
  }
];

function agentPrompt(agent, language) {
  const a = language === "ru" ? agent.ru : agent.en;
  if (language === "ru") {
    return `Ты — узкоспециализированный трейдер-аналитик. Твоя специализация: ${a.role}.
Тебе дан ТОЛЬКО загруженный пользователем скриншот торгового графика. Анализируй строго то, что реально видно на изображении.
Твоя зона ответственности: ${a.focus}.

Правила:
- Не гарантируй результат и не обещай прибыль.
- Не выдумывай цену, индикаторы, актив или таймфрейм, если их не видно.
- Если по твоей части данных недостаточно — vote = "NO_SIGNAL".
- observations — конкретные наблюдения именно по ЭТОМУ графику в рамках твоей специализации.

Верни ТОЛЬКО JSON без markdown:
{"vote":"BUY | SELL | NO_SIGNAL","confidence":"низкая | средняя | высокая","asset":"распознанный актив или Не распознан","timeframe":"распознанный таймфрейм или Не распознан","observations":["наблюдение 1","наблюдение 2"],"note":"1-2 предложения вывода по твоей части"}`;
  }
  return `You are a narrowly specialized trading analyst. Your specialization: ${a.role}.
You are given ONLY the chart screenshot uploaded by the user. Analyze strictly what is actually visible in the image.
Your area of responsibility: ${a.focus}.

Rules:
- Never guarantee a result or promise profit.
- Do not invent price, indicators, asset, or timeframe if not visible.
- If your part lacks enough data, vote = "NO_SIGNAL".
- observations must be concrete points about THIS chart within your specialization.

Return JSON only, no markdown:
{"vote":"BUY | SELL | NO_SIGNAL","confidence":"low | medium | high","asset":"recognized asset or Not recognized","timeframe":"recognized timeframe or Not recognized","observations":["observation 1","observation 2"],"note":"1-2 sentence conclusion for your part"}`;
}

function aggregatorPrompt(verdicts, language) {
  const json = JSON.stringify(verdicts, null, 2);
  if (language === "ru") {
    return `Ты — старший трейдер, который сводит мнения команды аналитиков в ОДИН итоговый сигнал.
Ниже — вердикты нескольких агентов (каждый анализировал один и тот же график со своей специализации).
Взвесь их: учитывай согласие и противоречия. Чем сильнее согласие агентов — тем выше уверенность. При явном конфликте будь осторожен (возможен NO_SIGNAL).
Не выдумывай данные сверх того, что дали агенты и что видно на графике. Пиши живым, естественным языком, без шаблонных фраз.

Верни ТОЛЬКО JSON без markdown:
{
  "direction": "BUY | SELL | NO_SIGNAL",
  "confidence": "низкая | средняя | высокая",
  "entryWindow": "краткое условие или время входа",
  "expiry": "предполагаемый интервал удержания",
  "asset": "актив или Не распознан",
  "timeframe": "таймфрейм или Не распознан",
  "summary": "1-2 живых предложения: итог по графику и почему такой сигнал",
  "reasons": ["конкретная причина 1", "причина 2", "причина 3"],
  "strategy": "2-4 предложения: логика входа, подтверждение и точка отмены идеи",
  "tips": ["практичный совет 1", "совет 2"]
}

Вердикты агентов:
${json}`;
  }
  return `You are a senior trader consolidating your analyst team's opinions into ONE final signal.
Below are verdicts from several agents (each analyzed the same chart from its specialization).
Weigh them: account for agreement and conflicts. The stronger the agreement, the higher the confidence. On clear conflict be cautious (NO_SIGNAL is possible).
Do not invent data beyond what the agents provided and what is visible. Write in a natural, human voice, no boilerplate.

Return JSON only, no markdown:
{
  "direction": "BUY | SELL | NO_SIGNAL",
  "confidence": "low | medium | high",
  "entryWindow": "short entry condition or timing",
  "expiry": "suggested holding interval",
  "asset": "asset or Not recognized",
  "timeframe": "timeframe or Not recognized",
  "summary": "1-2 lively sentences: chart takeaway and why this signal",
  "reasons": ["concrete reason 1", "reason 2", "reason 3"],
  "strategy": "2-4 sentences: entry logic, confirmation and invalidation point",
  "tips": ["practical tip 1", "tip 2"]
}

Agent verdicts:
${json}`;
}

/* ---------- Детерминированный агрегатор (fallback, без ИИ) ---------- */
function normVote(v) {
  const s = String(v || "").toUpperCase();
  if (s === "BUY" || s === "UP") return "BUY";
  if (s === "SELL" || s === "DOWN") return "SELL";
  return "NO_SIGNAL";
}
function mostCommon(arr) {
  const m = {};
  let best = null, bestN = 0;
  arr.filter(Boolean).forEach((x) => { m[x] = (m[x] || 0) + 1; if (m[x] > bestN) { bestN = m[x]; best = x; } });
  return best;
}
function fallbackAggregate(verdicts, language) {
  const ru = language === "ru";
  const votes = verdicts.map((v) => normVote(v.vote));
  const buy = votes.filter((v) => v === "BUY").length;
  const sell = votes.filter((v) => v === "SELL").length;
  const total = verdicts.length || 1;
  let direction = "NO_SIGNAL";
  if (buy > sell) direction = "BUY";
  else if (sell > buy) direction = "SELL";
  const agree = Math.max(buy, sell);
  const ratio = agree / total;
  let confidence = ru ? "низкая" : "low";
  if (direction !== "NO_SIGNAL" && ratio >= 0.99) confidence = ru ? "высокая" : "high";
  else if (direction !== "NO_SIGNAL" && ratio >= 0.6) confidence = ru ? "средняя" : "medium";
  const reasons = verdicts.map((v) => v.note).filter(Boolean).slice(0, 4);
  const consensus = ru
    ? `Консенсус агентов: ${buy} за рост, ${sell} за снижение из ${total}.`
    : `Agent consensus: ${buy} up, ${sell} down of ${total}.`;
  reasons.unshift(consensus);
  return {
    direction,
    confidence,
    entryWindow: ru ? "по подтверждению на графике" : "on chart confirmation",
    expiry: "",
    asset: mostCommon(verdicts.map((v) => v.asset).filter((a) => a && String(a).toLowerCase().indexOf("не распознан") === -1 && String(a).toLowerCase().indexOf("not recognized") === -1)) || (ru ? "Не распознан" : "Not recognized"),
    timeframe: mostCommon(verdicts.map((v) => v.timeframe).filter((a) => a && String(a).toLowerCase().indexOf("не распознан") === -1 && String(a).toLowerCase().indexOf("not recognized") === -1)) || (ru ? "Не распознан" : "Not recognized"),
    summary: ru
      ? "Итог собран из мнений нескольких агентов по видимой части графика."
      : "Result assembled from several agents' views of the visible chart.",
    reasons: reasons.slice(0, 5),
    strategy: ru
      ? "Входи только при совпадении с направлением большинства агентов и подтверждении ценой; отменяй идею при пробое ближайшего значимого уровня против сигнала."
      : "Enter only when price confirms the majority direction; invalidate the idea if the nearest key level breaks against the signal.",
    tips: ru
      ? ["Не входи против сильного противоречия между агентами.", "Фиксируй риск на сделку заранее."]
      : ["Avoid entering against strong disagreement between agents.", "Set your per-trade risk in advance."]
  };
}

/* ---------- Supabase (дневной лимит, best-effort / fail-open) ---------- */
async function supaGet(path) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) return null;
  const r = await fetch(`${base}/rest/v1${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!r.ok) throw new Error("supabase " + r.status);
  return r.json();
}
async function supaLogAnalyze(userId) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) return;
  await fetch(`${base}/rest/v1/pulse_events`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ telegram_id: userId, event_type: "vision_analyze", details: {} })
  }).catch(() => {});
}
async function dailyAnalyzeCount(userId) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows = await supaGet(
    `/pulse_events?select=id&telegram_id=eq.${encodeURIComponent(userId)}&event_type=eq.vision_analyze&created_at=gte.${start.toISOString()}`
  );
  return Array.isArray(rows) ? rows.length : 0;
}

/* ============================================================ */
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST request" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { image, mimeType = "image/jpeg", language = "ru", initData } = body;
    const lang = language === "en" ? "en" : "ru";

    const user = validateTelegramInitData(initData, botToken);
    if (!user || !user.id) return res.status(401).json({ error: "Telegram verification failed" });

    // Лимит в минуту (каждый анализ = несколько запросов к ИИ)
    if (!rateLimit("analyze:" + user.id, 5, 60000)) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }

    if (!["image/png", "image/jpeg", "image/webp"].includes(String(mimeType))) {
      return res.status(400).json({ error: "Unsupported image type" });
    }
    if (!image || typeof image !== "string") return res.status(400).json({ error: "Image is required" });
    if (image.length > 12000000) return res.status(413).json({ error: "Image is too large" });

    // Дневной лимит (fail-open: при ошибке Supabase анализ не блокируется)
    const DAILY_LIMIT = Number(process.env.DAILY_ANALYZE_LIMIT || 30);
    try {
      const used = await dailyAnalyzeCount(user.id);
      if (DAILY_LIMIT > 0 && used >= DAILY_LIMIT) {
        return res.status(429).json({
          error: lang === "ru"
            ? `Дневной лимит анализов исчерпан (${DAILY_LIMIT}). Возвращайтесь завтра.`
            : `Daily analysis limit reached (${DAILY_LIMIT}). Come back tomorrow.`
        });
      }
    } catch (e) {
      // fail-open
    }

    const base64Image = image.includes(",") ? image.split(",").pop() : image;
    const imagePart = { inline_data: { mime_type: mimeType, data: base64Image } };

    // 1) Параллельно запускаем всех агентов по одному и тому же графику
    const settled = await Promise.allSettled(
      AGENTS.map((agent) =>
        callGemini(apiKey, [{ text: agentPrompt(agent, lang) }, imagePart], 0.5, 24000)
      )
    );

    const verdicts = [];
    settled.forEach((s, i) => {
      if (s.status === "fulfilled" && s.value) {
        const v = s.value;
        verdicts.push({
          agent: (lang === "ru" ? AGENTS[i].ru.role : AGENTS[i].en.role),
          vote: v.vote,
          confidence: v.confidence,
          asset: v.asset,
          timeframe: v.timeframe,
          observations: Array.isArray(v.observations) ? v.observations : [],
          note: v.note || ""
        });
      }
    });

    // Если ни один агент не ответил — один запасной прямой анализ
    if (verdicts.length === 0) {
      const fbPrompt = lang === "ru"
        ? "Ты — трейдер-аналитик. Проанализируй ТОЛЬКО загруженный скриншот графика (то, что реально видно). Не гарантируй результат, не выдумывай данные. Если данных мало — direction NO_SIGNAL. Верни JSON: {\"direction\":\"BUY|SELL|NO_SIGNAL\",\"confidence\":\"низкая|средняя|высокая\",\"entryWindow\":\"\",\"expiry\":\"\",\"asset\":\"\",\"timeframe\":\"\",\"summary\":\"\",\"reasons\":[],\"strategy\":\"\",\"tips\":[]}"
        : "You are a trading analyst. Analyze ONLY the uploaded chart screenshot (what is actually visible). Do not guarantee results or invent data. If insufficient, direction NO_SIGNAL. Return JSON: {\"direction\":\"BUY|SELL|NO_SIGNAL\",\"confidence\":\"low|medium|high\",\"entryWindow\":\"\",\"expiry\":\"\",\"asset\":\"\",\"timeframe\":\"\",\"summary\":\"\",\"reasons\":[],\"strategy\":\"\",\"tips\":[]}";
      try {
        const single = await callGemini(apiKey, [{ text: fbPrompt }, imagePart], 0.6, 24000);
        if (single && single.direction) {
          supaLogAnalyze(user.id);
          single.agents = [];
          return res.status(200).json(single);
        }
      } catch (e) {}
      return res.status(502).json({ error: "AI returned no analysis" });
    }

    // 2) Агрегатор сводит вердикты в 1 сигнал
    let final = null;
    try {
      final = await callGemini(apiKey, [{ text: aggregatorPrompt(verdicts, lang) }], 0.5, 18000);
    } catch (e) {
      final = null;
    }
    if (!final || !final.direction) {
      final = fallbackAggregate(verdicts, lang); // детерминированный агрегатор по голосам
    }

    // Прикладываем разбор агентов (фронтенд может не использовать — не мешает)
    final.agents = verdicts.map((v) => ({
      agent: v.agent, vote: normVote(v.vote), confidence: v.confidence, note: v.note
    }));

    supaLogAnalyze(user.id); // счётчик дневного лимита (best-effort)
    return res.status(200).json(final);
  } catch (error) {
    console.error("Analyze error:", error);
    return res.status(500).json({ error: "Unable to analyze the image" });
  }
};

// Vercel: даём функции время на несколько параллельных ИИ-запросов
module.exports.config = { maxDuration: 60 };
module.exports.maxDuration = 60;
