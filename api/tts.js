const crypto = require("crypto");

/* ============================================================
   Signal Pulse — /api/tts
   Озвучка по запросу ФИКСИРОВАННЫХ финальных реплик (зашёл/слился + вердикт).
   Синтезирует только те 2–3 реплики, что реально выбраны — не грузит /api/analyze и экономит квоту Fish.
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

function stripForTTS(s) {
  return String(s == null ? "" : s)
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, "")
    .replace(/[\u{2190}-\u{27BF}]/gu, "")
    .replace(/[\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/[\uFE00-\uFE0F\u200D]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fishTTS(text, refId, who, timeoutMs) {
  return new Promise(function (resolve) {
    var https = require("https");
    var key = process.env.FISH_API_KEY || "";
    if (!key) return resolve({ err: "no_fish_key" });
    refId = String(refId || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!refId) return resolve({ err: "no_fish_ref" });
    var model = (process.env.FISH_MODEL || "s2.1-pro-free").replace(/[^A-Za-z0-9._-]/g, "");
    var speed = (who === "opy") ? 0.9 : 1.14;
    var volume = (who === "opy") ? 0 : 0.15;
    var body = JSON.stringify({
      text: String(text || ""),
      reference_id: refId,
      format: "mp3",
      mp3_bitrate: 128,
      chunk_length: 300,
      normalize: true,
      latency: "balanced",
      prosody: { speed: speed, volume: volume }
    });
    var done = false, chunks = [], req = null;
    var to = setTimeout(function () { finish({ err: "fish_timeout" }); }, Math.max(3000, timeoutMs || 12000));
    function finish(r) { if (done) return; done = true; clearTimeout(to); try { if (req) req.destroy(); } catch (e) {} resolve(r); }
    try {
      req = https.request({
        method: "POST",
        hostname: "api.fish.audio",
        path: "/v1/tts",
        headers: {
          "Authorization": "Bearer " + key,
          "Content-Type": "application/json",
          "model": model,
          "Content-Length": Buffer.byteLength(body)
        }
      }, function (res) {
        var status = res.statusCode || 0;
        res.on("data", function (d) { chunks.push(d); });
        res.on("end", function () {
          var buf = Buffer.concat(chunks);
          if (status === 200 && buf.length) return finish({ uri: "data:audio/mpeg;base64," + buf.toString("base64") });
          var msg = ""; try { msg = buf.toString("utf8").slice(0, 160); } catch (e) {}
          finish({ err: "http " + status + (msg ? (":" + msg) : "") });
        });
      });
      req.on("error", function (e) { finish({ err: "fish_err:" + ((e && e.message) || "x") }); });
      req.write(body);
      req.end();
    } catch (e) { finish({ err: "fish_ctor:" + ((e && e.message) || "x") }); }
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(200).end();
  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const text = body.text || "";
    const who = String(body.who || "dop").toLowerCase() === "opy" ? "opy" : "dop";
    const initData = body.initData || "";
    const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
    const user = validateTelegramInitData(initData, botToken);
    if (!user) return res.status(401).json({ uri: "", err: "auth" });
    if (String(process.env.VOICE_TTS || "").toLowerCase() === "off") return res.status(200).json({ uri: "" });
    const clean = stripForTTS(text).slice(0, 200);
    if (!clean) return res.status(200).json({ uri: "" });
    const refId = who === "opy" ? (process.env.FISH_VOICE_OPY || "") : (process.env.FISH_VOICE_DOP || "");
    const r = await fishTTS(clean, refId, who, 12000);
    if (r && r.uri) return res.status(200).json({ uri: r.uri, who: who });
    return res.status(200).json({ uri: "", err: (r && r.err) || "tts_failed" });
  } catch (e) {
    return res.status(200).json({ uri: "", err: (e && e.message) || String(e) });
  }
};

module.exports.config = { maxDuration: 20 };
module.exports.maxDuration = 20;
