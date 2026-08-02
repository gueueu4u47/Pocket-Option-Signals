// api/fishcheck.js - test Fish Audio TTS. Just open /api/fishcheck in browser.
const https = require("https");

function synth(text, refId, key, model, who) {
  return new Promise(function (resolve) {
    refId = String(refId || "").replace(/[^A-Za-z0-9_-]/g, "");
    model = String(model || "").replace(/[^A-Za-z0-9._-]/g, "");
    if (!refId) return resolve({ result: "NO_REF_AFTER_CLEAN" });
    const speed = who === "opy" ? 0.94 : 1.08;
    const body = JSON.stringify({ text: text, reference_id: refId, format: "mp3", mp3_bitrate: 128, chunk_length: 300, normalize: true, latency: "balanced", prosody: { speed: speed, volume: 0 } });
    let done = false, chunks = [], req = null;
    const to = setTimeout(function () { fin({ result: "TIMEOUT" }); }, 20000);
    function fin(x) { if (done) return; done = true; clearTimeout(to); try { if (req) req.destroy(); } catch (e) {} resolve(x); }
    try {
      req = https.request({ method: "POST", hostname: "api.fish.audio", path: "/v1/tts", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json", "model": model, "Content-Length": Buffer.byteLength(body) } }, function (res) {
        const status = res.statusCode || 0;
        res.on("data", function (d) { chunks.push(d); });
        res.on("end", function () {
          const buf = Buffer.concat(chunks);
          if (status === 200 && buf.length) return fin({ result: "OK", status: status, bytes: buf.length });
          let msg = ""; try { msg = buf.toString("utf8").slice(0, 220); } catch (e) {}
          fin({ result: status === 200 ? "EMPTY" : ("HTTP_" + status), status: status, bytes: buf.length, error: msg });
        });
      });
      req.on("error", function (e) { fin({ result: "REQ_ERROR", error: (e && e.message) || String(e) }); });
      req.write(body); req.end();
    } catch (e) { fin({ result: "CTOR_FAIL", error: (e && e.message) || String(e) }); }
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const key = process.env.FISH_API_KEY || "";
  const model = process.env.FISH_MODEL || "s2.1-pro-free";
  const vDop = process.env.FISH_VOICE_DOP || "";
  const vOpy = process.env.FISH_VOICE_OPY || "";
  const out = { keyPresent: !!key, keyLen: key.length, model: model, dopSet: !!vDop, opySet: !!vOpy };
  if (!key) { out.result = "NO_KEY"; return res.status(200).json(out); }
  try {
    out.dop = vDop ? await synth("\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0433\u043e\u043b\u043e\u0441\u0430 \u041c\u0430\u0431\u043e\u0439.", vDop, key, model, "dop") : { result: "NO_DOP_ID" };
    out.opy = vOpy ? await synth("\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0433\u043e\u043b\u043e\u0441\u0430 \u0420\u0438\u043a.", vOpy, key, model, "opy") : { result: "NO_OPY_ID" };
  } catch (e) { out.fatal = (e && e.message) || String(e); }
  return res.status(200).json(out);
};
module.exports.config = { maxDuration: 30 };
module.exports.maxDuration = 30;