const crypto = require("crypto");

/* ============================================================
   Signal Pulse — /api/analyze
   Анализ ОДНОГО загруженного скриншота графика.

   Главное отличие от прежней версии:
   - Никогда не отдаёт 502 во фронт.
   - reasons (почему ВВЕРХ / ВНИЗ / НЕТ СИГНАЛА) не может прийти пустым:
     сначала берём из JSON модели, затем спасаем из summary/strategy,
     затем из сырого текста, и только потом честный NO_SIGNAL с объяснением.
   - Повтор запроса с упрощённым промптом, если модель вернула мусор.
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

/* ---------- Экономия: кэш одинаковых скриншотов ---------- */
const CACHE = new Map();
const CACHE_TTL = Number(process.env.ANALYZE_CACHE_TTL_MS || 900000); // 15 мин
function imageKey(base64, lang) {
  return crypto.createHash("sha1").update(String(lang) + "|" + String(base64)).digest("hex");
}
function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > CACHE_TTL) { CACHE.delete(key); return null; }
  return hit.payload;
}
function cacheSet(key, payload) {
  CACHE.set(key, { t: Date.now(), payload });
  if (CACHE.size > 400) {
    const now = Date.now();
    for (const [k, v] of CACHE) { if (now - v.t > CACHE_TTL) CACHE.delete(k); }
    while (CACHE.size > 400) CACHE.delete(CACHE.keys().next().value);
  }
}

/* ---------- AI helpers ---------- */
const AI_BASE = process.env.AI_BASE_URL || "https://api.unity2.ai/v1";
// Рабочая модель первой, вторая — только резерв при сбое
const MODELS = String(process.env.AI_MODELS || "gemini-2.5-flash,gemini-3-flash-preview")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function repairJson(s) {
  let str = String(s);
  let inStr = false, esc = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === "\"") inStr = !inStr;
  }
  if (inStr) str += "\"";
  str = str.replace(/:\s*([}\],])/g, ":null$1");
  str = str.replace(/,\s*([}\]])/g, "$1");
  str = str.replace(/,\s*$/, "");
  const oc = (str.match(/{/g) || []).length, cc = (str.match(/}/g) || []).length;
  const os = (str.match(/\[/g) || []).length, cs = (str.match(/]/g) || []).length;
  for (let i = 0; i < os - cs; i++) str += "]";
  for (let i = 0; i < oc - cc; i++) str += "}";
  return str;
}

function parseJsonLoose(text) {
  let clean = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first > -1 && last > -1 && last > first) clean = clean.slice(first, last + 1);
  else if (first > -1) clean = clean.slice(first);
  try { return JSON.parse(clean); }
  catch (e) { try { return JSON.parse(repairJson(clean)); } catch (e2) { return null; } }
}

function cleanList(v, max) {
  const arr = Array.isArray(v) ? v : (v ? [v] : []);
  const out = [];
  arr.forEach((x) => {
    const s = String(x == null ? "" : x).replace(/^[\s\-*•\d.)]+/, "").trim();
    if (s && s.length > 3 && out.indexOf(s) === -1) out.push(s);
  });
  return out.slice(0, max || 4);
}

/* Спасаем причины из чего угодно, что вернула модель */
function salvageReasons(parsed, rawText, lang) {
  let reasons = cleanList(parsed && parsed.reasons, 4);
  if (reasons.length) return reasons;

  // 1. из summary / strategy / note
  const textBlocks = [parsed && parsed.summary, parsed && parsed.strategy, parsed && parsed.note]
    .filter(Boolean)
    .join(" ");
  if (textBlocks) {
    reasons = cleanList(String(textBlocks).split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 12), 3);
    if (reasons.length) return reasons;
  }

  // 2. из сырого ответа модели
  const lines = String(rawText || "")
    .replace(/```[a-z]*/gi, "")
    .split(/\n|(?<=[.!?])\s+/)
    .map((l) => l.replace(/^[\s\-*•\d.)"]+/, "").replace(/["{},]+$/, "").trim())
    .filter((l) => l.length > 14 && l.indexOf(":") === -1);
  reasons = cleanList(lines, 3);
  if (reasons.length) return reasons;

  return [];
}

function noDataReasons(lang) {
  return lang === "ru"
    ? [
        "На загруженном изображении не удалось разобрать структуру графика.",
        "Нет подтверждённого направления — вход по этому скриншоту не оправдан.",
        "Сделай скриншот крупнее: свечи, шкала времени и уровни цены целиком."
      ]
    : [
        "The chart structure could not be read from the uploaded image.",
        "No confirmed direction — entering on this screenshot is not justified.",
        "Take a larger screenshot: candles, time axis and price levels in full."
      ];
}

function normDirection(d) {
  const s = String(d || "").toUpperCase().trim();
  if (["BUY", "UP", "CALL", "ВВЕРХ", "LONG"].indexOf(s) > -1) return "BUY";
  if (["SELL", "DOWN", "PUT", "ВНИЗ", "SHORT"].indexOf(s) > -1) return "SELL";
  return "NO_SIGNAL";
}

/* Извлекаем текст из любой формы ответа (строка, массив частей, reasoning_content) */
function extractText(data) {
  const ch = data && data.choices && data.choices[0];
  if (!ch) return "";
  const msg = ch.message || {};
  let out = "";

  if (typeof msg.content === "string") out = msg.content;
  else if (Array.isArray(msg.content)) {
    out = msg.content
      .map((p) => (typeof p === "string" ? p : (p && (p.text || (p.parts && p.parts.text))) || ""))
      .join("\n");
  }
  if (!out.trim() && typeof msg.reasoning_content === "string") out = msg.reasoning_content;
  if (!out.trim() && typeof msg.reasoning === "string") out = msg.reasoning;
  if (!out.trim() && typeof ch.text === "string") out = ch.text;
  return String(out || "").trim();
}

async function postAI(apiKey, payload, timeoutMs) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
  try {
    const resp = await fetch(AI_BASE + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const data = await resp.json().catch(() => null);
    return { httpOk: resp.ok, status: resp.status, data };
  } catch (e) {
    return { httpOk: false, status: 0, data: null, netError: (e && e.message) || String(e) };
  } finally {
    clearTimeout(to);
  }
}

async function callModel(apiKey, model, parts, temperature, timeoutMs, forceJson) {
  const content = parts.map((p) => {
    if (p && p.text) return { type: "text", text: p.text };
    if (p && p.inline_data) {
      return { type: "image_url", image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` } };
    }
    return { type: "text", text: "" };
  });

  // Потолок токенов — это лимит, а не расход. Платим только за фактический ответ.
  const cap = Number(process.env.AI_MAX_TOKENS || 1600);

  const base = {
    model,
    messages: [{ role: "user", content }],
    temperature,
    max_tokens: cap
  };

  // Глушим внутренние рассуждения: именно они съедали весь лимит и давали пустой ответ
  const attempts = [];
  attempts.push(Object.assign({}, base, {
    reasoning_effort: "none",
    extra_body: { google: { thinking_config: { thinking_budget: 0 } } }
  }, forceJson ? { response_format: { type: "json_object" } } : {}));
  attempts.push(Object.assign({}, base, forceJson ? { response_format: { type: "json_object" } } : {}));
  attempts.push(Object.assign({}, base, { max_tokens: Math.max(cap, 2400) }));

  // Общий бюджет времени на все попытки этой модели
  const deadline = Date.now() + (timeoutMs || 24000);

  let lastErr = "no answer";
  for (let i = 0; i < attempts.length; i++) {
    const remaining = deadline - Date.now();
    if (remaining < 5000) { lastErr = lastErr + " / time budget"; break; }

    const r = await postAI(apiKey, attempts[i], remaining);
    if (r.netError) { lastErr = r.netError; continue; }

    if (!r.httpOk) {
      const msg = String((r.data && r.data.error && (r.data.error.message || r.data.error)) || ("HTTP " + r.status));
      lastErr = msg;
      // Неизвестный параметр или нет поддержки JSON-режима — пробуем следующий вариант
      if (/unknown|unsupported|invalid|not support|response_format|reasoning|thinking|extra_body/i.test(msg)) continue;
      return { ok: false, error: msg };
    }

    const text = extractText(r.data);
    if (text) return { ok: true, text, parsed: parseJsonLoose(text) };

    const fin = (r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].finish_reason) || "";
    lastErr = "empty response" + (fin ? " (" + fin + ")" : "");
  }
  return { ok: false, error: lastErr };
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
async function globalAnalyzeCount() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows = await supaGet(
    `/pulse_events?select=id&event_type=eq.vision_analyze&created_at=gte.${start.toISOString()}`
  );
  return Array.isArray(rows) ? rows.length : 0;
}
async function dailyAnalyzeCount(userId) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows = await supaGet(
    `/pulse_events?select=id&telegram_id=eq.${encodeURIComponent(userId)}&event_type=eq.vision_analyze&created_at=gte.${start.toISOString()}`
  );
  return Array.isArray(rows) ? rows.length : 0;
}

/* ---------- Промпты ---------- */
const PROMPT_RU = `Ты — опытный трейдер-аналитик. Тебе дан ТОЛЬКО загруженный скриншот графика. Анализируй строго то, что реально видно: тренд, свечи и прайс-экшн, ключевые уровни.
Правила:
- Не гарантируй результат и не обещай прибыль.
- Не выдумывай цену, индикаторы, актив или таймфрейм, если их не видно.
- Если данных мало — direction "NO_SIGNAL", и в reasons объясни, чего именно не хватает.
- reasons ОБЯЗАТЕЛЬНО непустой: 2-3 коротких конкретных факта по этому графику, простым языком, без нумерации и без слова "голосование". Именно reasons отвечает на вопрос "почему вверх, вниз или пропустить".
- tips — максимум 2.
Верни ТОЛЬКО JSON без markdown:
{"direction":"BUY|SELL|NO_SIGNAL","confidence":"низкая|средняя|высокая","entryWindow":"условие или время входа","expiry":"интервал удержания","asset":"актив или Не распознан","timeframe":"таймфрейм или Не распознан","summary":"1-2 живых предложения","reasons":["причина","причина"],"strategy":"2-3 предложения: вход, подтверждение, отмена идеи","tips":["совет","совет"]}`;

const PROMPT_EN = `You are an experienced trading analyst. You are given ONLY the uploaded chart screenshot. Analyze strictly what is visible: trend, candles and price action, key levels.
Rules:
- Never guarantee a result or promise profit.
- Do not invent price, indicators, asset or timeframe if not visible.
- If data is insufficient, direction "NO_SIGNAL", and in reasons explain exactly what is missing.
- reasons MUST be non-empty: 2-3 short concrete facts about this chart, plain language, no numbering. reasons is what answers "why up, down or skip".
- tips — max 2.
Return JSON only, no markdown:
{"direction":"BUY|SELL|NO_SIGNAL","confidence":"low|medium|high","entryWindow":"entry condition or timing","expiry":"holding interval","asset":"asset or Not recognized","timeframe":"timeframe or Not recognized","summary":"1-2 lively sentences","reasons":["reason","reason"],"strategy":"2-3 sentences: entry, confirmation, invalidation","tips":["tip","tip"]}`;

const RETRY_RU = `Посмотри на скриншот графика и ответь ОДНИМ JSON-объектом без markdown и без пояснений вокруг:
{"direction":"BUY|SELL|NO_SIGNAL","confidence":"низкая|средняя|высокая","reasons":["короткая причина по графику","короткая причина по графику"],"summary":"одно предложение"}
reasons ��бязателен и не может быть пустым.`;

const RETRY_EN = `Look at the chart screenshot and reply with ONE JSON object, no markdown, no text around it:
{"direction":"BUY|SELL|NO_SIGNAL","confidence":"low|medium|high","reasons":["short chart-based reason","short chart-based reason"],"summary":"one sentence"}
reasons is required and cannot be empty.`;

/* ---------- Мягкий ответ: пользователь никогда не видит кодов ошибок ---------- */
function softCard(res, lang, summary, reasons) {
  const ru = lang !== "en";
  return res.status(200).json({
    direction: "NO_SIGNAL",
    confidence: ru ? "низкая" : "low",
    asset: ru ? "Не распознан" : "Not recognized",
    timeframe: "",
    entryWindow: "",
    expiry: "",
    summary: summary,
    reasons: (reasons && reasons.length) ? reasons : noDataReasons(ru ? "ru" : "en"),
    strategy: "",
    tips: [],
    degraded: false,
    notice: true
  });
}

/* ============================================================ */
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(200).end();

  const apiKey = process.env.GEMINI_API_KEY;
  const body0 = typeof req.body === "string" ? (JSON.parse(req.body || "{}") || {}) : (req.body || {});
  const lang0 = body0.language === "en" ? "en" : "ru";

  // Даже без ключа не роняем фронт 500-кой — отдаём честный NO_SIGNAL
  if (!apiKey) {
    return res.status(200).json({
      direction: "NO_SIGNAL",
      confidence: lang0 === "ru" ? "низкая" : "low",
      asset: lang0 === "ru" ? "Не распознан" : "Not recognized",
      timeframe: lang0 === "ru" ? "Не распознан" : "Not recognized",
      summary: lang0 === "ru" ? "Анализ временно недоступен." : "Analysis is temporarily unavailable.",
      reasons: noDataReasons(lang0),
      strategy: "",
      tips: [],
      degraded: true,
      diag: "missing api key"
    });
  }

  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const { image, mimeType = "image/jpeg", language = "ru", initData } = body0;
    const lang = language === "en" ? "en" : "ru";

    const user = validateTelegramInitData(initData, botToken);
    if (!user || !user.id) {
      return softCard(res, lang,
        lang === "ru" ? "Не удалось подтвердить вход через Telegram." : "Telegram sign-in could not be confirmed.",
        lang === "ru"
          ? ["Открой приложение заново из бота в Telegram.", "Анализ работает только внутри Telegram."]
          : ["Reopen the app from the bot inside Telegram.", "Analysis works only inside Telegram."]);
    }
    const isOwner = String(user.id) === String(process.env.OWNER_TELEGRAM_ID || "");

    if (!isOwner && !rateLimit("analyze:" + user.id, 5, 60000)) {
      return softCard(res, lang,
        lang === "ru" ? "Слишком много анализов подряд." : "Too many analyses in a row.",
        lang === "ru"
          ? ["Подожди минуту и попробуй снова.", "Пауза помогает не торопиться со входами."]
          : ["Wait a minute and try again.", "A pause helps you avoid rushed entries."]);
    }

    if (["image/png", "image/jpeg", "image/webp"].indexOf(String(mimeType)) === -1) {
      return softCard(res, lang,
        lang === "ru" ? "Этот формат изображения не поддерживается." : "This image format is not supported.",
        lang === "ru"
          ? ["Подходят скриншоты PNG, JPG и WEBP.", "Сделай обычный скриншот экрана и загрузи его."]
          : ["PNG, JPG and WEBP screenshots work.", "Take a regular screen capture and upload it."]);
    }
    if (!image || typeof image !== "string") {
      return softCard(res, lang,
        lang === "ru" ? "Скриншот не загрузился." : "The screenshot was not uploaded.",
        lang === "ru"
          ? ["Выбери изображение графика и повтори анализ.", "Без графика разбор сделать невозможно."]
          : ["Pick a chart image and run the analysis again.", "Without a chart there is nothing to read."]);
    }
    if (image.length > 12000000) {
      return softCard(res, lang,
        lang === "ru" ? "Изображение слишком большое." : "The image is too large.",
        lang === "ru"
          ? ["Загрузи файл поменьше, до 8 МБ.", "Обычного скриншота с телефона достаточно."]
          : ["Upload a smaller file, up to 8 MB.", "A normal phone screenshot is enough."]);
    }

    const DAILY_LIMIT = Number(process.env.DAILY_ANALYZE_LIMIT || 5);
    try {
      const used = await dailyAnalyzeCount(user.id);
      if (!isOwner && DAILY_LIMIT > 0 && used >= DAILY_LIMIT) {
        return softCard(res, lang,
          lang === "ru"
            ? `На сегодня анализы закончились (${DAILY_LIMIT} в день).`
            : `Today's analyses are used up (${DAILY_LIMIT} per day).`,
          lang === "ru"
            ? ["Лимит обновится завтра утром.", "Пока можно разобрать свои прошлые сигналы в истории."]
            : ["The limit resets tomorrow morning.", "Meanwhile you can review your past signals in history."]);
      }
    } catch (e) { /* fail-open */ }

    const base64Image = image.indexOf(",") > -1 ? image.split(",").pop() : image;

    // Экономия 1: пауза между анализами одного человека
    const COOLDOWN_SEC = Number(process.env.ANALYZE_COOLDOWN_SEC || 25);
    if (!isOwner && COOLDOWN_SEC > 0 && !rateLimit("cooldown:" + user.id, 1, COOLDOWN_SEC * 1000)) {
      return softCard(res, lang,
        lang === "ru"
          ? `Нужна небольшая пауза — около ${COOLDOWN_SEC} секунд.`
          : `A short pause is needed — about ${COOLDOWN_SEC} seconds.`,
        lang === "ru"
          ? ["Анализы идут слишком часто.", "Подожди немного и загрузи скриншот заново."]
          : ["Analyses are coming in too fast.", "Wait a moment and upload the screenshot again."]);
    }

    // Экономия 2: тот же скриншот — ответ из кэша, без затрат на ИИ
    const cacheKey = imageKey(base64Image, lang);
    const cached = cacheGet(cacheKey);
    if (cached) {
      supaLogAnalyze(user.id);
      return res.status(200).json(Object.assign({}, cached, { cached: true }));
    }

    // Экономия 3: общий дневной потолок по всем пользователям
    const GLOBAL_LIMIT = Number(process.env.DAILY_GLOBAL_ANALYZE_LIMIT || 0);
    if (!isOwner && GLOBAL_LIMIT > 0) {
      try {
        const usedAll = await globalAnalyzeCount();
        if (usedAll >= GLOBAL_LIMIT) {
          return res.status(200).json({
            direction: "NO_SIGNAL",
            confidence: lang === "ru" ? "низкая" : "low",
            asset: lang === "ru" ? "Не распознан" : "Not recognized",
            timeframe: "",
            summary: lang === "ru"
              ? "На сегодня достигнут общий лимит анализов."
              : "The overall daily analysis limit has been reached.",
            reasons: lang === "ru"
              ? ["Сегодняшний объём анализов исчерпан.", "Возвращайся завтра — лимит обновится."]
              : ["Today's analysis volume is used up.", "Come back tomorrow when the limit resets."],
            strategy: "", tips: [], degraded: false, notice: true, limited: true
          });
        }
      } catch (e) { /* fail-open */ }
    }

    const imagePart = { inline_data: { mime_type: mimeType, data: base64Image } };
    const mainPrompt = lang === "ru" ? PROMPT_RU : PROMPT_EN;
    const retryPrompt = lang === "ru" ? RETRY_RU : RETRY_EN;

    let best = null;
    let bestReasons = [];
    let rawSeen = "";
    const diag = [];

    // Проход 1: основной промпт по всем моделям
    for (const model of MODELS) {
      const r = await callModel(apiKey, model, [{ text: mainPrompt }, imagePart], 0.45, 26000, true);
      if (!r.ok) { diag.push(model + ": " + r.error); continue; }
      rawSeen = r.text;
      const parsed = r.parsed || {};
      const reasons = salvageReasons(parsed, r.text, lang);
      if (parsed.direction && reasons.length) { best = parsed; bestReasons = reasons; break; }
      if (parsed.direction && !best) { best = parsed; bestReasons = reasons; }
      diag.push(model + ": weak answer");
    }

    // Проход 2: ОДИН короткий повтор на самой дешёвой модели
    if (!best || !bestReasons.length) {
      for (const model of MODELS.slice(0, 1)) {
        const r = await callModel(apiKey, model, [{ text: retryPrompt }, imagePart], 0.2, 16000, false);
        if (!r.ok) { diag.push("retry " + model + ": " + r.error); continue; }
        rawSeen = rawSeen || r.text;
        const parsed = r.parsed || {};
        const reasons = salvageReasons(parsed, r.text, lang);
        if (reasons.length) {
          best = Object.assign({}, best || {}, parsed);
          bestReasons = reasons;
          break;
        }
        diag.push("retry " + model + ": no reasons");
      }
    }

    const degraded = !best || !bestReasons.length;
    const direction = normDirection(best && best.direction);
    const finalDirection = degraded ? "NO_SIGNAL" : direction;
    const reasonsOut = bestReasons.length ? bestReasons : noDataReasons(lang);

    const payload = {
      direction: finalDirection,
      confidence: (best && best.confidence) || (finalDirection === "NO_SIGNAL" ? (lang === "ru" ? "низкая" : "low") : (lang === "ru" ? "средняя" : "medium")),
      entryWindow: (best && best.entryWindow) || "",
      expiry: (best && best.expiry) || "",
      asset: (best && best.asset) || (lang === "ru" ? "Не распознан" : "Not recognized"),
      timeframe: (best && best.timeframe) || (lang === "ru" ? "Не распознан" : "Not recognized"),
      summary: (best && best.summary) || (lang === "ru"
        ? "Разбор построен только по видимой части графика."
        : "The breakdown is based only on the visible part of the chart."),
      reasons: reasonsOut,
      strategy: (best && best.strategy) || "",
      tips: cleanList(best && best.tips, 2),
      agents: [],
      degraded: degraded
    };

    if (degraded) {
      console.error("ANALYZE_DEGRADED " + diag.join(" | ") + " raw=" + String(rawSeen).slice(0, 200));
      if (isOwner) payload.diag = diag.join(" | ").slice(0, 300);
    }

    if (!degraded) cacheSet(cacheKey, payload);
    supaLogAnalyze(user.id);
    return res.status(200).json(payload);
  } catch (error) {
    console.error("Analyze error:", error);
    // Фронт всегда получает готовую карточку с объяснением, а не пустой экран
    return res.status(200).json({
      direction: "NO_SIGNAL",
      confidence: lang0 === "ru" ? "низкая" : "low",
      asset: lang0 === "ru" ? "Не распознан" : "Not recognized",
      timeframe: lang0 === "ru" ? "Не распознан" : "Not recognized",
      summary: lang0 === "ru" ? "Сервис анализа не ответил." : "The analysis service did not respond.",
      reasons: noDataReasons(lang0),
      strategy: "",
      tips: [],
      degraded: true
    });
  }
};

module.exports.config = { maxDuration: 60 };
module.exports.maxDuration = 60;
