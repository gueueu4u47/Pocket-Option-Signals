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
  const a = Buffer.from(receivedHash, "hex");
  const b = Buffer.from(calculatedHash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > 86400) return null;
  try { return JSON.parse(params.get("user") || "{}"); } catch { return null; }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const WORKER_URL = (process.env.WORKER_URL || "").replace(/\/$/, "");
  const WORKER_SECRET = process.env.WORKER_SECRET || "";
  const action = body.action || "get";

  if (action === "get") {
    try {
      const r = await fetch(WORKER_URL + "/design");
      const d = await r.json();
      return res.status(200).json({ theme: d.theme || "obsidian", mode: d.mode || "always" });
    } catch (e) {
      return res.status(200).json({ theme: "obsidian", mode: "always" });
    }
  }

  if (action === "set") {
    const user = validateTelegramInitData(body.initData, process.env.TELEGRAM_BOT_TOKEN || "");
    const ownerId = String(process.env.OWNER_TELEGRAM_ID || "");
    if (!user || String(user.id) !== ownerId) return res.status(403).json({ error: "forbidden" });
    const theme = String(body.theme || "");
    const mode = String(body.mode || "always");
    if (!theme) return res.status(400).json({ error: "theme required" });
    try {
      const u = WORKER_URL + "/design?set=1&secret=" + encodeURIComponent(WORKER_SECRET) +
        "&theme=" + encodeURIComponent(theme) + "&mode=" + encodeURIComponent(mode);
      const r = await fetch(u);
      const d = await r.json();
      if (!d || !d.ok) return res.status(502).json({ error: "worker", detail: d });
      return res.status(200).json({ ok: true, theme, mode });
    } catch (e) {
      return res.status(502).json({ error: String((e && e.message) || e) });
    }
  }
  return res.status(400).json({ error: "bad action" });
};
