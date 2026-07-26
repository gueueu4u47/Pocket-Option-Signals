const crypto = require("crypto");

/* Глобальное оформление хранится в Supabase (таблица pulse_design, ровно одна строка).
   Раньше использовался внешний Cloudflare Worker через WORKER_URL/WORKER_SECRET:
   переменные были пустыми, запись падала с "Failed to parse URL from",
   а секрет уходил в query-строку GET-запроса и попадал в логи. Теперь Worker не нужен. */

const THEMES = ["obsidian", "midnight", "carbon", "pureblack", "launch"];
const MODES = ["always", "now", "schedule", "launch", "vision", "quick"];
const DEFAULTS = { theme: "obsidian", mode: "always" };

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

function supaHeaders(key) {
  return {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function readDesign(url, key) {
  const r = await fetch(
    url + "/rest/v1/pulse_design?id=eq.1&select=theme,mode&limit=1",
    { headers: supaHeaders(key) }
  );
  if (!r.ok) throw new Error("supabase_read_" + r.status);
  const rows = await r.json();
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!row) return { ...DEFAULTS };
  return {
    theme: THEMES.includes(row.theme) ? row.theme : DEFAULTS.theme,
    mode: MODES.includes(row.mode) ? row.mode : DEFAULTS.mode,
  };
}

async function writeDesign(url, key, theme, mode) {
  const r = await fetch(url + "/rest/v1/pulse_design?on_conflict=id", {
    method: "POST",
    headers: { ...supaHeaders(key), Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ id: 1, theme, mode, updated_at: new Date().toISOString() }]),
  });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.text()).slice(0, 200); } catch (e) { detail = ""; }
    throw new Error("supabase_write_" + r.status + (detail ? ": " + detail : ""));
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  res.setHeader("Cache-Control", "no-store");

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || "";
  const action = body.action || "get";

  if (action === "get") {
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(200).json({ ...DEFAULTS });
    try {
      const d = await readDesign(SUPABASE_URL, SUPABASE_KEY);
      return res.status(200).json(d);
    } catch (e) {
      // чтение не должно ломать интерфейс — отдаём дефолтную тему
      return res.status(200).json({ ...DEFAULTS });
    }
  }

  if (action === "set") {
    const user = validateTelegramInitData(body.initData, process.env.TELEGRAM_BOT_TOKEN || "");
    const ownerId = String(process.env.OWNER_TELEGRAM_ID || "");
    if (!user || !ownerId || String(user.id) !== ownerId) {
      return res.status(403).json({ error: "forbidden" });
    }
    const theme = String(body.theme || "");
    const mode = String(body.mode || "always");
    if (!THEMES.includes(theme)) return res.status(400).json({ error: "bad theme" });
    if (!MODES.includes(mode)) return res.status(400).json({ error: "bad mode" });
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: "supabase env missing" });
    try {
      await writeDesign(SUPABASE_URL, SUPABASE_KEY, theme, mode);
      return res.status(200).json({ ok: true, theme, mode });
    } catch (e) {
      return res.status(502).json({ error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  return res.status(400).json({ error: "bad action" });
};