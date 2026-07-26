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
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);

    const url =
      "https://api.twelvedata.com/quote?symbol=" +
      encodeURIComponent(symbol) +
      "&apikey=" +
      encodeURIComponent(apiKey);

    let data = null;
    try {
      const response = await fetch(url, { signal: ctrl.signal });
      data = await response.json().catch(() => null);
    } finally {
      clearTimeout(to);
    }

    if (!data || data.status === "error") {
      return res.status(200).json({
        error: (data && data.message) || "Market data is unavailable.",
        symbol
      });
    }

    const payload = {
      symbol: data.symbol || symbol,
      close: data.close || data.price,
      price: data.close || data.price,
      open: data.open,
      high: data.high,
      low: data.low,
      previous_close: data.previous_close,
      change: data.change,
      percent_change: data.percent_change,
      datetime: data.datetime || null,
      is_market_open: data.is_market_open,
      updated_at: new Date().toISOString()
    };

    cacheSet(symbol, payload);

    /* Если просили OTC — говорим прямо, что отдали базовую пару */
    return res.status(200).json(
      Object.assign({}, payload, { otc_requested: wasOtc, display: rawSymbol })
    );
  } catch {
    return res.status(200).json({ error: "Unable to load market data.", symbol });
  }
};

module.exports.config = { maxDuration: 15 };