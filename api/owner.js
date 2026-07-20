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

  const body =
    typeof req.body === "string"
      ? JSON.parse(req.body || "{}")
      : req.body || {};

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
