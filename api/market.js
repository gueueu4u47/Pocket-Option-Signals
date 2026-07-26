const crypto = require("crypto");

/* ============================================================
   Signal Pulse — /api/market
   Котировка пары из TwelveData.

   Зачем переписан:
   - был открыт наружу — любой мог жечь твою квоту;
   - не было кэша — каждый сигнал = запрос к API;
   - не было белого списка символов;
   - не отдавал close / previous_close / datetime, которые нужны Quick.

   Вызов теперь POST:
     fetch("/api/market", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ symbol: "EUR/USD", initData: tg.initData })
     })
   ============================================================ */

/* ---------- проверка входа через Telegram ---------- */
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
  const a = Buffer.from(receivedHash, "hex");
  const b = Buffer.from(calculatedHash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > 86400) return null;
  try {
    return JSON.parse(params.get("user") || "{}");
  } catch {
    return null;
  }
}

/* ---------- белый список пар ---------- */
/* Только то, что есть в приложении. Лишние символы = лишние запросы. */
const ALLOWED = new Set(
  String(
    process.env.MARKET_SYMBOLS ||
      "AED/CNY,AUD/CAD,AUD/CHF,AUD/JPY,AUD/NZD,AUD/USD,BHD/CNY,CAD/CHF,CAD/JPY,CHF/JPY,CHF/NOK,EUR/AUD,EUR/CAD,EUR/CHF,EUR/GBP,EUR/HUF,EUR/JPY,EUR/NZD,EUR/RUB,EUR/TRY,EUR/USD,GBP/AUD,GBP/CAD,GBP/CHF,GBP/JPY,GBP/USD,JOD/CNY,KES/USD,LBP/USD,MAD/USD,NGN/USD,NZD/JPY,NZD/USD,OMR/CNY,QAR/CNY,SAR/CNY,TND/USD,UAH/USD,USD/ARS,USD/BDT,USD/BRL,USD/CAD,USD/CHF,USD/CLP,USD/CNH,USD/COP,USD/DZD,USD/EGP,USD/IDR,USD/INR,USD/JPY,USD/MXN,USD/MYR,USD/PHP,USD/PKR,USD/RUB,USD/SGD,USD/THB,USD/VND,XAU/USD,YER/USD,ZAR/USD"
  )
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

/* OTC-пар у TwelveData нет — это инструмент брокера.
   Снимаем суффикс, но честно помечаем это в ответе. */
function normalizeSymbol(raw) {
  let s = String(raw || "").toUpperCase().trim();
  let wasOtc = false;
  if (/\bOTC\b/.test(s)) {
    wasOtc = true;
    s = s.replace(/\s*\bOTC\b\s*/g, "").trim();
  }
  s = s.replace(/\s+/g, "");
  if (/^[A-Z]{6}$/.test(s)) s = s.slice(0, 3) + "/" + s.slice(3);
  return { symbol: s, wasOtc };
}

/* ---------- кэш котировок ---------- */
/* ВНИМАНИЕ: память инстанса. На Vercel инстансов несколько,
   поэтому это сокращает расход раза в 3-5, а не абсолютно.
   Если пользователей станет много — переноси в Upstash Redis. */
const QUOTE_CACHE = new Map();
const QUOTE_TTL = Number(process.env.MARKET_CACHE_TTL_MS || 30000);

function cacheGet(key) {
  const hit = QUOTE_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > QUOTE_TTL) {
    QUOTE_CACHE.delete(key);
    return null;
  }
  return hit.payload;
}

function cacheSet(key, payload) {
  QUOTE_CACHE.set(key, { t: Date.now(), payload });
  if (QUOTE_CACHE.size > 200) {
    const now = Date.now();
    for (const [k, v] of QUOTE_CACHE) {
      if (now - v.t > QUOTE_TTL) QUOTE_CACHE.delete(k);
    }
  }
}

/* ---------- лимит на человека ---------- */
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


/* ---------- получение котировки: три пути ---------- */
/* Поставщик держит не все пары в том виде, в каком они названы
   в приложении. Порядок попыток: напрямую → перевёрнутая пара →
   кросс через доллар. Все три — реальные числа, ничего не выдумывается. */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function rawQuote(symbol, apiKey) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 7000);
  try {
    const url =
      "https://api.twelvedata.com/quote?symbol=" +
      encodeURIComponent(symbol) +
      "&apikey=" +
      encodeURIComponent(apiKey);
    const response = await fetch(url, { signal: ctrl.signal });
    const data = await response.json().catch(() => null);
    if (!data || data.status === "error") return null;
    if (toNum(data.close) === null && toNum(data.price) === null) return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

function shape(data, symbol, derived) {
  const close = toNum(data.close) !== null ? toNum(data.close) : toNum(data.price);
  const prev = toNum(data.previous_close);
  let pct = toNum(data.percent_change);
  if (pct === null && close !== null && prev) pct = ((close - prev) / prev) * 100;
  return {
    symbol,
    close,
    price: close,
    open: toNum(data.open),
    high: toNum(data.high),
    low: toNum(data.low),
    previous_close: prev,
    change: toNum(data.change),
    percent_change: pct,
    datetime: data.datetime || null,
    is_market_open:
      typeof data.is_market_open === "boolean" ? data.is_market_open : undefined,
    derived,
    updated_at: new Date().toISOString()
  };
}

/* Переворот пары: максимум становится минимумом и наоборот. */
function invertQuote(data, symbol) {
  const s = shape(data, symbol, "inverted");
  const inv = (v) => (v === null || v === 0 ? null : 1 / v);
  const close = inv(s.close);
  const prev = inv(s.previous_close);
  return {
    symbol,
    close,
    price: close,
    open: inv(s.open),
    high: inv(s.low),
    low: inv(s.high),
    previous_close: prev,
    change: close !== null && prev !== null ? close - prev : null,
    percent_change: close !== null && prev ? ((close - prev) / prev) * 100 : null,
    datetime: s.datetime,
    is_market_open: s.is_market_open,
    derived: "inverted",
    updated_at: s.updated_at
  };
}

/* Сколько единиц валюты дают за доллар. */
async function perUsd(cur, apiKey) {
  if (cur === "USD") return { rate: 1, prev: 1, is_market_open: undefined, datetime: null };
  let d = await rawQuote("USD/" + cur, apiKey);
  if (d) {
    const s = shape(d, "USD/" + cur, "direct");
    return {
      rate: s.close,
      prev: s.previous_close,
      is_market_open: s.is_market_open,
      datetime: s.datetime
    };
  }
  d = await rawQuote(cur + "/USD", apiKey);
  if (d) {
    const s = shape(d, cur + "/USD", "direct");
    return {
      rate: s.close ? 1 / s.close : null,
      prev: s.previous_close ? 1 / s.previous_close : null,
      is_market_open: s.is_market_open,
      datetime: s.datetime
    };
  }
  return null;
}

/* X/Y = USD/Y ÷ USD/X. Диапазон дня так не собрать — high/low остаются
   пустыми, и карточка сама сократит разбор, а не придумает его. */
async function crossQuote(symbol, apiKey) {
  const parts = symbol.split("/");
  if (parts.length !== 2) return null;
  const a = await perUsd(parts[0], apiKey);
  const b = await perUsd(parts[1], apiKey);
  if (!a || !b || !a.rate || !b.rate) return null;
  const close = b.rate / a.rate;
  const prev = a.prev && b.prev ? b.prev / a.prev : null;
  return {
    symbol,
    close,
    price: close,
    open: null,
    high: null,
    low: null,
    previous_close: prev,
    change: prev !== null ? close - prev : null,
    percent_change: prev ? ((close - prev) / prev) * 100 : null,
    datetime: b.datetime || a.datetime || null,
    is_market_open:
      a.is_market_open === false || b.is_market_open === false ? false : undefined,
    derived: "cross",
    updated_at: new Date().toISOString()
  };
}

/* ============================================================ */
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!apiKey) {
    return res.status(200).json({ error: "Market-data key is not configured." });
  }

  const body =
    typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  /* 1. Только из Telegram */
  const user = validateTelegramInitData(body.initData, botToken);
  if (!user || !user.id) {
    return res.status(200).json({ error: "Telegram sign-in could not be confirmed." });
  }

  const isOwner = String(user.id) === String(process.env.OWNER_TELEGRAM_ID || "");

  /* 2. Не больше 20 запросов в минуту на человека */
  if (!isOwner && !rateLimit("market:" + user.id, 20, 60000)) {
    return res.status(200).json({ error: "Too many requests. Wait a moment." });
  }

  /* 3. Только разрешённые пары.
     rawSymbol — как пара называется в приложении (с OTC), именно он
     уезжает в карточку. symbol — базовая пара для запроса котировки. */
  const rawSymbol = String(body.symbol || "EUR/USD").trim().toUpperCase().replace(/\s+/g, " ");
  const { symbol, wasOtc } = normalizeSymbol(rawSymbol);
  if (!ALLOWED.has(symbol)) {
    return res.status(200).json({ error: "This asset is not supported.", symbol });
  }

  /* 4. Кэш — один запрос на пару раз в 30 сек, а не на каждый сигнал */
  const cached = cacheGet(symbol);
  if (cached) {
    return res.status(200).json(
      Object.assign({}, cached, { cached: true, otc_requested: wasOtc, display: rawSymbol })
    );
  }

  try {
    let payload = null;

    /* 4a. Прямой запрос пары */
    const direct = await rawQuote(symbol, apiKey);
    if (direct) payload = shape(direct, symbol, "direct");

    /* 4b. Перевёрнутая пара: у поставщика часто есть только USD/XXX,
           а в приложении пара названа XXX/USD. */
    if (!payload) {
      const parts = symbol.split("/");
      if (parts.length === 2) {
        const flipped = parts[1] + "/" + parts[0];
        const inv = await rawQuote(flipped, apiKey);
        if (inv) payload = invertQuote(inv, symbol);
      }
    }

    /* 4c. Кросс через доллар — для пар вроде JOD/CNY или SAR/CNY */
    if (!payload) payload = await crossQuote(symbol, apiKey);

    if (!payload || payload.close === null) {
      return res.status(200).json({ error: "Market data is unavailable.", symbol });
    }

    cacheSet(symbol, payload);

    /* Если просили OTC — подписываем как у брокера, но флаг сохраняем */
    return res.status(200).json(
      Object.assign({}, payload, { otc_requested: wasOtc, display: rawSymbol })
    );
  } catch {
    return res.status(200).json({ error: "Unable to load market data.", symbol });
  }
};

module.exports.config = { maxDuration: 15 };