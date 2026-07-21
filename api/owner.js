import crypto from "crypto";

function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) {
    return null;
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) {
    return null;
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

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

  if (!authDate || now - authDate > 86400) {
    return null;
  }

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

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST request" });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const ownerId = String(process.env.OWNER_TELEGRAM_ID || "");

  if (!botToken || !ownerId) {
    return res.status(503).json({ error: "Access check is not configured" });
  }

  const ip =
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";

  if (!rateLimit("owner:" + ip, 30, 60000)) {
    return res.status(429).json({ error: "Too many requests. Please slow down." });
  }

  let body;
  try {
    body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const user = validateTelegramInitData(body.initData, botToken);

  if (!user || !user.id) {
    return res.status(401).json({ error: "Telegram verification failed" });
  }

  const isOwner = String(user.id) === ownerId;

  return res.status(200).json({
    verified: true,
    isOwner,
    user: isOwner
      ? {
          id: user.id,
          firstName: user.first_name || "",
          username: user.username || ""
        }
      : null
  });
}
