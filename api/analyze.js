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
const MODELS = String(process.env.AI_MODELS || "gemini-3-flash-preview")
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

/* Технический мусор никогда не должен попасть на экран пользователю */
function looksTechnical(s) {
  const t = String(s || "");
  if (/^[\s{\[]/.test(t)) return true;
  if (/"\s*:\s*"/.test(t)) return true;
  if (/\b(direction|confidence|entryWindow|expiry|timeframe|summary|strategy|reasons|tips|asset)\b\s*"?\s*:/i.test(t)) return true;
  if (/(BUY|SELL|NO_SIGNAL)\s*"/.test(t)) return true;
  return false;
}

function cleanList(v, max) {
  const arr = Array.isArray(v) ? v : (v ? [v] : []);
  const out = [];
  arr.forEach((x) => {
    const s = String(x == null ? "" : x).replace(/^[\s\-*•\d.)]+/, "").replace(/["\\]+$/, "").trim();
    if (s && s.length > 3 && !looksTechnical(s) && out.indexOf(s) === -1) out.push(s);
  });
  return out.slice(0, max || 4);
}

/* Ответ модели оборвался на середине? */
function looksTruncated(rawText) {
  const t = String(rawText || "").replace(/```[a-z]*/gi, "").trim();
  if (!t) return true;
  return !/}\s*$/.test(t);
}

/* Недописанный последний пункт не показываем пользователю */
function dropPartialTail(reasons, rawText) {
  const arr = Array.isArray(reasons) ? reasons.slice() : [];
  if (!arr.length || !looksTruncated(rawText)) return arr;
  const last = String(arr[arr.length - 1] || "").trim();
  if (/[.!?\u2026\u00bb)]$/.test(last)) return arr;

  // Обрезаем оборванную фразу до последнего целого слова
  const words = last.split(/\s+/);
  if (words.length > 2) words.pop();
  const fixed = words.join(" ").replace(/[\s,;:\-\u2014]+$/, "");

  if (fixed.length >= 20 && fixed.split(/\s+/).length >= 3) {
    arr[arr.length - 1] = fixed + "\u2026";
  } else if (arr.length > 1) {
    arr.pop();
  }
  return arr;
}

/* Собираем поля даже из оборванного JSON, который не разобрался целиком */
function extractFields(rawText) {
  const raw = String(rawText || "").replace(/```[a-z]*/gi, "");
  const out = {};

  const str = (key) => {
    const m = raw.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]*)"', "i"));
    return m && m[1] ? m[1].trim() : "";
  };
  const list = (key) => {
    const m = raw.match(new RegExp('"' + key + '"\\s*:\\s*\\[([\\s\\S]*?)(\\]|$)', "i"));
    if (!m || !m[1]) return [];
    return m[1]
      .split(/"\s*,\s*"/)
      .map((s) => s.replace(/^[\s"]+|[\s",]+$/g, "").trim())
      .filter(Boolean);
  };

  ["direction", "confidence", "entryWindow", "expiry", "asset", "timeframe", "summary", "strategy"].forEach((k) => {
    const v = str(k);
    if (v) out[k] = v;
  });

  const reasons = list("reasons");
  if (reasons.length) out.reasons = reasons;
  const tips = list("tips");
  if (tips.length) out.tips = tips;

  return out;
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

  // 2. из сырого ответа модели (включая недописанный или битый JSON)
  let raw = String(rawText || "").replace(/```[a-z]*/gi, "");

  // вытаскиваем содержимое массива reasons даже из невалидного JSON
  const rm = raw.match(/"reasons"\s*:\s*\[([\s\S]*?)(\]|$)/i);
  if (rm && rm[1]) {
    const items = rm[1].split(/"\s*,\s*"/).map((s) => s.replace(/^[\s"]+|[\s",]+$/g, ""));
    reasons = cleanList(items, 3);
    if (reasons.length) return reasons;
  }

  // снимаем JSON-обвязку и берём осмысленные фразы
  const lines = raw
    .split(/\n|(?<=[.!?])\s+/)
    .map((l) =>
      l
        .replace(/^[\s\-*•\d.)"]+/, "")
        .replace(/^"?[a-z_A-Z]+"?\s*:\s*"?/, "")
        .replace(/["{}\[\],]+$/, "")
        .trim()
    )
    .filter((l) => l.length > 14 && /[а-яёa-z]{4}/i.test(l));
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

/* Направление из сырого текста, если JSON не собрался */
function directionFromText(rawText) {
  const s = String(rawText || "");
  const m = s.match(/"direction"\s*:\s*"?(BUY|SELL|NO_SIGNAL|UP|DOWN|CALL|PUT)"?/i);
  if (m) return m[1].toUpperCase();
  if (/\b(BUY|CALL|LONG|ВВЕРХ|вверх|рост|быч)/.test(s) && !/\b(SELL|PUT|SHORT|ВНИЗ|вниз)/.test(s)) return "BUY";
  if (/\b(SELL|PUT|SHORT|ВНИЗ|вниз|падени|медвеж)/.test(s) && !/\b(BUY|CALL|LONG|ВВЕРХ|вверх)/.test(s)) return "SELL";
  return "";
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
  if (!out.trim() && Array.isArray(msg.parts)) {
    out = msg.parts.map((p) => (p && p.text) || "").join("\n");
  }
  if (!out.trim() && typeof msg.reasoning_content === "string") out = msg.reasoning_content;
  if (!out.trim() && typeof msg.reasoning === "string") out = msg.reasoning;
  if (!out.trim() && typeof ch.text === "string") out = ch.text;
  if (!out.trim() && typeof data.output_text === "string") out = data.output_text;

  // Родной формат Gemini, если прокси отдал его без преобразования
  if (!out.trim() && data && Array.isArray(data.candidates)) {
    out = data.candidates
      .map((c) => (c && c.content && Array.isArray(c.content.parts) ? c.content.parts.map((p) => (p && p.text) || "").join("\n") : ""))
      .join("\n");
  }
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

/* ---------- Прямой Google Gemini, без посредника ---------- */
const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";

/* Ключи Google: старый формат AIza... и новый AQ.... */
function isGoogleKey(key) {
  if (process.env.AI_BASE_URL) return false;
  const k = String(key || "").trim();
  return /^AIza[0-9A-Za-z_\-]{20,}$/.test(k) || /^AQ\.[0-9A-Za-z._\-]{20,}$/.test(k);
}

/* У шлюза и у Google разные имена моделей */
function googleModel(model) {
  const m = String(model || "").trim();
  if (!m || /^gemini-3/.test(m)) return "gemini-2.5-flash";
  return m;
}

function googleText(data) {
  const cand = (data && Array.isArray(data.candidates) && data.candidates[0]) || null;
  if (!cand || !cand.content || !Array.isArray(cand.content.parts)) return "";
  return cand.content.parts.map((p) => (p && p.text) || "").join("").trim();
}

async function callGoogle(apiKey, model, parts, temperature, timeoutMs, forceJson) {
  const mdl = googleModel(model);
  const cap = Number(process.env.AI_MAX_TOKENS || 6000);

  const gParts = parts.map((p) => {
    if (p && p.inline_data) {
      return { inline_data: { mime_type: p.inline_data.mime_type, data: p.inline_data.data } };
    }
    return { text: (p && p.text) || "" };
  });

  const cfg = { temperature: temperature, maxOutputTokens: cap };
  if (forceJson) cfg.responseMimeType = "application/json";

  // Сначала без внутренних рассуждений — это быстрее и дешевле
  const bodies = [
    { contents: [{ role: "user", parts: gParts }], generationConfig: Object.assign({ thinkingConfig: { thinkingBudget: 0 } }, cfg) },
    { contents: [{ role: "user", parts: gParts }], generationConfig: cfg }
  ];

  const deadline = Date.now() + (timeoutMs || 24000);
  let lastErr = "no answer";

  for (let i = 0; i < bodies.length; i++) {
    const remaining = deadline - Date.now();
    if (remaining < 5000) { lastErr = lastErr + " / time budget"; break; }

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), remaining);
    try {
      const url = GOOGLE_BASE + "/models/" + encodeURIComponent(mdl) + ":generateContent";
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": String(apiKey).trim() },
        body: JSON.stringify(bodies[i]),
        signal: ctrl.signal
      });
      const data = await resp.json().catch(() => null);

      if (!resp.ok) {
        const msg = String((data && data.error && (data.error.message || data.error)) || ("HTTP " + resp.status));
        lastErr = msg;
        // Некоторые модели не знают этих полей — пробуем вариант попроще
        if (/thinking|responseMimeType|unknown|invalid argument|not supported/i.test(msg)) continue;
        return { ok: false, error: msg };
      }

      const text = googleText(data);
      const cand = (data && Array.isArray(data.candidates) && data.candidates[0]) || {};
      const fin = String(cand.finishReason || "");

      if (text) {
        return {
          ok: true,
          text,
          parsed: parseJsonLoose(text),
          finish: fin.toLowerCase(),
          truncated: fin === "MAX_TOKENS" || looksTruncated(text)
        };
      }
      lastErr = "empty response" + (fin ? " (" + fin + ")" : "");
    } catch (e) {
      lastErr = (e && e.name === "AbortError") ? "This operation was aborted" : String((e && e.message) || e);
    } finally {
      clearTimeout(to);
    }
  }
  return { ok: false, error: lastErr };
}

async function callModel(apiKey, model, parts, temperature, timeoutMs, forceJson) {
  // Ключ Google — идём напрямую; иначе работаем через шлюз, как раньше
  if (isGoogleKey(apiKey)) return callGoogle(apiKey, model, parts, temperature, timeoutMs, forceJson);

  const content = parts.map((p) => {
    if (p && p.text) return { type: "text", text: p.text };
    if (p && p.inline_data) {
      return { type: "image_url", image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` } };
    }
    return { type: "text", text: "" };
  });

  // Потолок токенов — это лимит, а не расход. Платим только за фактический ответ.
  const cap = Number(process.env.AI_MAX_TOKENS || 6000);

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
    thinking: { type: "disabled" },
    extra_body: { google: { thinking_config: { thinking_budget: 0 } } }
  }, forceJson ? { response_format: { type: "json_object" } } : {}));
  attempts.push(Object.assign({}, base, {
    reasoning_effort: "none",
    extra_body: { google: { thinking_config: { thinking_budget: 0 } } }
  }, forceJson ? { response_format: { type: "json_object" } } : {}));
  attempts.push(Object.assign({}, base));

  // Общий бюджет времени на все попытки этой модели
  const deadline = Date.now() + (timeoutMs || 24000);

  let lastErr = "no answer";
  for (let i = 0; i < attempts.length; i++) {
    const remaining = deadline - Date.now();
    if (remaining < 5000) { lastErr = lastErr + " / time budget"; break; }

    // Первой попытке даём ограниченное окно, чтобы простой запрос без JSON-режима успел выполниться
    const attemptMs = i === 0 ? Math.min(remaining, 18000) : remaining;
    const r = await postAI(apiKey, attempts[i], attemptMs);
    if (r.netError) { lastErr = r.netError; continue; }

    if (!r.httpOk) {
      const msg = String((r.data && r.data.error && (r.data.error.message || r.data.error)) || ("HTTP " + r.status));
      lastErr = msg;
      // Неизвестный параметр или нет поддержки JSON-режима — пробуем следующий вариант
      if (/unknown|unsupported|invalid|not support|response_format|reasoning|thinking|extra_body/i.test(msg)) continue;
      return { ok: false, error: msg };
    }

    const finish = String((r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].finish_reason) || "");
    const text = extractText(r.data);
    if (text) {
      return {
        ok: true,
        text,
        parsed: parseJsonLoose(text),
        finish,
        truncated: finish === "length" || looksTruncated(text)
      };
    }

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
{"direction":"BUY|SELL|NO_SIGNAL","reasons":["причина","причина"],"confidence":"низкая|средняя|высокая","summary":"1-2 живых предложения","strategy":"2-3 предложения: вход, подтверждение, отмена идеи","entryWindow":"условие или время входа","expiry":"интервал удержания","asset":"актив или Не распознан","timeframe":"таймфрейм или Не распознан","tips":["совет","совет"]}
Важно: соблюдай именно этот порядок ключей и пиши коротко.`;

const PROMPT_EN = `You are an experienced trading analyst. You are given ONLY the uploaded chart screenshot. Analyze strictly what is visible: trend, candles and price action, key levels.
Rules:
- Never guarantee a result or promise profit.
- Do not invent price, indicators, asset or timeframe if not visible.
- If data is insufficient, direction "NO_SIGNAL", and in reasons explain exactly what is missing.
- reasons MUST be non-empty: 2-3 short concrete facts about this chart, plain language, no numbering. reasons is what answers "why up, down or skip".
- tips — max 2.
Return JSON only, no markdown:
{"direction":"BUY|SELL|NO_SIGNAL","reasons":["reason","reason"],"confidence":"low|medium|high","summary":"1-2 lively sentences","strategy":"2-3 sentences: entry, confirmation, invalidation","entryWindow":"entry condition or timing","expiry":"holding interval","asset":"asset or Not recognized","timeframe":"timeframe or Not recognized","tips":["tip","tip"]}
Important: keep exactly this key order and be concise.`;

const RETRY_RU = `Посмотри на скриншот графика и ответь ОДНИМ JSON-объектом без markdown и без пояснений вокруг:
{"direction":"BUY|SELL|NO_SIGNAL","confidence":"низкая|средняя|высокая","reasons":["короткая причина по графику","короткая причина по графику"],"summary":"одно предложение"}
reasons обязателен и не может быть пустым.`;

const RETRY_EN = `Look at the chart screenshot and reply with ONE JSON object, no markdown, no text around it:
{"direction":"BUY|SELL|NO_SIGNAL","confidence":"low|medium|high","reasons":["short chart-based reason","short chart-based reason"],"summary":"one sentence"}
reasons is required and cannot be empty.`;

/* ---------- Мягкий ответ: пользователь никогда не видит кодов ошибок ---------- */
const FAST_RU = `Ты опытный трейдер-аналитик. По скриншоту графика бинарных опционов дай короткий разбор.
Отвечай ТОЛЬКО одним JSON-объектом, без markdown и без пояснений вокруг.
Пиши предельно коротко: каждая причина - законченная фраза не длиннее 70 символов.
Порядок ключей соблюдай строго, direction ставь первым.
{"direction":"BUY|SELL|NO_SIGNAL","confidence":"низкая|средняя|высокая","reasons":["коротко по графику","коротко по графику"],"asset":"актив или Не распознан","timeframe":"таймфрейм или Не распознан","summary":"одно короткое предложение","entryWindow":"когда входить","expiry":"сколько держать"}
Если график нечитаемый или картина смешанная - direction "NO_SIGNAL", и в reasons объясни, чего не хватает.
reasons обязателен, ровно 2 пункта.`;

const FAST_EN = `You are an experienced trading analyst. Give a short read of this binary options chart screenshot.
Answer with ONE JSON object only, no markdown, no text around it.
Be extremely brief: each reason is a complete phrase under 70 characters.
Keep the key order exactly, direction first.
{"direction":"BUY|SELL|NO_SIGNAL","confidence":"low|medium|high","reasons":["short chart fact","short chart fact"],"asset":"asset or Not recognized","timeframe":"timeframe or Not recognized","summary":"one short sentence","entryWindow":"when to enter","expiry":"how long to hold"}
If the chart is unreadable or mixed - direction "NO_SIGNAL", and in reasons explain what is missing.
reasons is required, exactly 2 items.`;

const MICRO_RU = `Скриншот графика бинарных опционов. Ответь ОДНИМ JSON и ничего больше:
{"direction":"BUY|SELL|NO_SIGNAL","reasons":["до 50 символов","до 50 символов"],"confidence":"низкая|средняя|высокая"}
Причины - очень короткие законченные фразы по графику. Никакого текста вне JSON.`;

const MICRO_EN = `Binary options chart screenshot. Answer with ONE JSON and nothing else:
{"direction":"BUY|SELL|NO_SIGNAL","reasons":["under 50 chars","under 50 chars"],"confidence":"low|medium|high"}
Reasons are very short complete phrases about the chart. No text outside JSON.`;

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
    const mainPrompt = lang === "ru" ? FAST_RU : FAST_EN;
    const richPrompt = lang === "ru" ? PROMPT_RU : PROMPT_EN;
    const retryPrompt = lang === "ru" ? MICRO_RU : MICRO_EN;
    const legacyRetry = lang === "ru" ? RETRY_RU : RETRY_EN;

    let best = null;
    let bestReasons = [];
    let bestCut = false;
    let rawSeen = "";
    const diag = [];

    // Общий бюджет времени на весь анализ — фронт ждёт не дольше 50 секунд
    const overallDeadline = Date.now() + 44000;
    const budget = (want) => Math.max(0, Math.min(want, overallDeadline - Date.now()));

    // Проход 1: основной промпт по всем моделям
    for (const model of MODELS) {
      const ms = budget(32000);
      if (ms < 7000) { diag.push(model + ": skipped (time)"); break; }

      const r = await callModel(apiKey, model, [{ text: mainPrompt }, imagePart], 0.45, ms, true);
      if (!r.ok) { diag.push(model + ": " + r.error); continue; }

      rawSeen = r.text;
      // Сначала честный JSON, сверху — всё, что удалось вытащить из оборванного ответа
      const parsed = Object.assign(extractFields(r.text), r.parsed || {});
      const reasons = dropPartialTail(salvageReasons(parsed, r.text, lang), r.text);
      const dir = parsed.direction || directionFromText(r.text);

      const cut = !!r.truncated;

      // Готовым считаем только дописанный ответ с направлением и причинами
      if (dir && reasons.length && !cut) {
        best = Object.assign({}, parsed, { direction: dir });
        bestReasons = reasons;
        bestCut = false;
        break;
      }

      // Обрывок держим как запасной вариант и пробуем получить цельный
      if ((dir || reasons.length) && (!best || bestCut)) {
        best = Object.assign({}, parsed, dir ? { direction: dir } : {});
        bestReasons = reasons;
        bestCut = cut;
      }
      diag.push(model + (cut ? ": truncated (" + (r.finish || "cut") + ")" : ": weak answer"));
    }

    // Проход 2: ОДИН короткий повтор без JSON-режима
    if (!best || !bestReasons.length || !best.direction || bestCut) {
      for (const model of MODELS) {
        const ms = budget(15000);
        if (ms < 7000) { diag.push("retry skipped (time)"); break; }

        const r = await callModel(apiKey, model, [{ text: retryPrompt }, imagePart], 0.2, ms, false);
        if (!r.ok) { diag.push("retry " + model + ": " + r.error); continue; }

        rawSeen = rawSeen || r.text;
        const parsed = Object.assign(extractFields(r.text), r.parsed || {});
        const reasons = dropPartialTail(salvageReasons(parsed, r.text, lang), r.text);
        const dir = parsed.direction || directionFromText(r.text);

        if (reasons.length || dir) {
          const keep = bestReasons.slice();
          const keepDir = (best && best.direction) || "";
          best = Object.assign({}, best || {}, parsed, dir ? { direction: dir } : (keepDir ? { direction: keepDir } : {}));
          bestReasons = reasons.length >= keep.length ? reasons : keep;
          bestCut = reasons.length ? !!r.truncated : bestCut;
          if (bestReasons.length) break;
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
      summary: (best && best.summary) || "",
      reasons: reasonsOut,
      strategy: (best && best.strategy) || "",
      tips: cleanList(best && best.tips, 2),
      agents: [],
      degraded: degraded
    };

    if (degraded) {
      console.error("ANALYZE_DEGRADED " + diag.join(" | ") + " raw=" + String(rawSeen).slice(0, 1200));
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