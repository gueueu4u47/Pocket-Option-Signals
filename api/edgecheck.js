// api/edgecheck.js - test Edge TTS (ws + new endpoint + clock-skew). Open /api/edgecheck.
const crypto = require("crypto");
let WS = null, wsErr = "";
try { WS = require("ws"); } catch (e) { wsErr = (e && e.message) || String(e); }

const EDGE_NEW = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_LEGACY = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_TRUSTED = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_GEC_VER = process.env.EDGE_GEC_VERSION || "1-140.0.3485.14";
const EDGE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.3485.14";
let SKEW = 0;

function secGec() {
  const WIN_EPOCH = 11644473600n;
  let ticks = BigInt(Math.floor(Date.now() / 1000) + SKEW) + WIN_EPOCH;
  ticks = ticks - (ticks % 300n);
  ticks = ticks * 10000000n;
  return crypto.createHash("sha256").update(ticks.toString() + EDGE_TRUSTED, "ascii").digest("hex").toUpperCase();
}
function uuid() { return crypto.randomUUID().replace(/-/g, ""); }

function tryOnce(endpoint) {
  return new Promise(function (resolve) {
    let done = false, bytes = 0, status = 0, serverDate = "", ws = null;
    const to = setTimeout(function () { fin({ result: "TIMEOUT" }); }, 15000);
    function fin(x) { if (done) return; done = true; clearTimeout(to); try { if (ws) ws.terminate(); } catch (e) {} resolve(x); }
    const url = endpoint + "&Sec-MS-GEC=" + secGec() + "&Sec-MS-GEC-Version=" + encodeURIComponent(EDGE_GEC_VER) + "&ConnectionId=" + uuid();
    try {
      ws = new WS(url, { headers: { "User-Agent": EDGE_UA, "Origin": "chrome-extension://jdiccldimpsojpoohpkozjmacepdlmdj", "Pragma": "no-cache", "Cache-Control": "no-cache" }, perMessageDeflate: false, handshakeTimeout: 12000 });
    } catch (e) { return fin({ result: "WS_CTOR_FAIL", error: (e && e.message) || String(e) }); }
    ws.on("unexpected-response", function (req, res) { status = res && res.statusCode; serverDate = (res && res.headers && res.headers.date) || ""; });
    ws.on("open", function () {
      const cfg = "X-Timestamp:" + new Date().toString() + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" + JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" }, outputFormat: "audio-24khz-48kbitrate-mono-mp3" } } } });
      const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ru-RU'><voice name='ru-RU-DmitryNeural'><prosody pitch='+0Hz' rate='+0%'>\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0441\u0432\u044f\u0437\u0438.</prosody></voice></speak>";
      const msg = "X-RequestId:" + uuid() + "\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:" + new Date().toString() + "Z\r\nPath:ssml\r\n\r\n" + ssml;
      try { ws.send(cfg); ws.send(msg); } catch (e) { fin({ result: "SEND_FAIL", error: (e && e.message) || String(e) }); }
    });
    ws.on("message", function (data, isBinary) {
      if (!isBinary) { const s = data.toString(); if (s.indexOf("Path:turn.end") !== -1) fin({ result: bytes > 0 ? "OK" : "EMPTY", bytes: bytes }); return; }
      try { const b = Buffer.isBuffer(data) ? data : Buffer.from(data); const hl = (b[0] << 8) | b[1]; bytes += Math.max(0, b.length - 2 - hl); } catch (e) {}
    });
    ws.on("error", function (err) { fin({ result: "WS_ERROR", status: status, serverDate: serverDate, error: (status ? ("HTTP " + status) : ((err && err.message) || "connection error")) }); });
    ws.on("close", function (code, reason) { if (!done) fin({ result: bytes > 0 ? "OK" : "CLOSED", bytes: bytes, code: code, status: status, serverDate: serverDate }); });
  });
}

async function run() {
  if (!WS) return { ok: false, result: "NO_WS_MODULE", error: wsErr };
  const attempts = [];
  const endpoints = [["new", EDGE_NEW], ["legacy", EDGE_LEGACY]];
  for (let i = 0; i < endpoints.length; i++) {
    const name = endpoints[i][0], ep = endpoints[i][1];
    let r = await tryOnce(ep);
    attempts.push(Object.assign({ endpoint: name, skew: SKEW }, r));
    if (r.result === "OK") return { ok: true, gecVer: EDGE_GEC_VER, via: name, bytes: r.bytes, skew: SKEW, attempts: attempts };
    if (r.status === 403 && r.serverDate) {
      const srv = Math.floor(new Date(r.serverDate).getTime() / 1000);
      if (srv) { SKEW = srv - Math.floor(Date.now() / 1000); r = await tryOnce(ep); attempts.push(Object.assign({ endpoint: name + "+skew", skew: SKEW }, r)); if (r.result === "OK") return { ok: true, gecVer: EDGE_GEC_VER, via: name + "+skew", bytes: r.bytes, skew: SKEW, attempts: attempts }; }
    }
  }
  return { ok: false, gecVer: EDGE_GEC_VER, skew: SKEW, attempts: attempts };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try { return res.status(200).json(await run()); }
  catch (e) { return res.status(200).json({ ok: false, result: "FATAL", error: (e && e.message) || String(e) }); }
};
module.exports.config = { maxDuration: 30 };
module.exports.maxDuration = 30;