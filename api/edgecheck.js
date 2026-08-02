// api/edgecheck.js — тест Microsoft Edge TTS через ws. Открой /api/edgecheck.
const crypto = require("crypto");
let WS = null, wsErr = "";
try { WS = require("ws"); } catch (e) { wsErr = (e && e.message) || String(e); }

const EDGE_WSS = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_TRUSTED = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_GEC_VER = process.env.EDGE_GEC_VERSION || "1-131.0.2903.99";
const EDGE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.99";

function edgeSecGec() {
  const WIN_EPOCH = 11644473600n;
  let ticks = BigInt(Math.floor(Date.now() / 1000)) + WIN_EPOCH;
  ticks = ticks - (ticks % 300n);
  ticks = ticks * 10000000n;
  return crypto.createHash("sha256").update(ticks.toString() + EDGE_TRUSTED, "ascii").digest("hex").toUpperCase();
}
function edgeUuid() { return crypto.randomUUID().replace(/-/g, ""); }

function edgeTest() {
  return new Promise(function (resolve) {
    const info = { wsModule: !!WS, gecVer: EDGE_GEC_VER };
    if (!WS) { info.result = "NO_WS_MODULE"; info.error = wsErr; return resolve(info); }
    const url = EDGE_WSS + "&Sec-MS-GEC=" + edgeSecGec() + "&Sec-MS-GEC-Version=" + encodeURIComponent(EDGE_GEC_VER) + "&ConnectionId=" + edgeUuid();
    let done = false, bytes = 0, status = 0, ws = null;
    const to = setTimeout(function () { fin({ result: "TIMEOUT" }); }, 15000);
    function fin(extra) {
      if (done) return; done = true; clearTimeout(to);
      try { if (ws) ws.terminate(); } catch (e) {}
      resolve(Object.assign(info, extra));
    }
    try {
      ws = new WS(url, { headers: { "User-Agent": EDGE_UA, "Origin": "chrome-extension://jdiccldimpsojpoohpkozjmacepdlmdj", "Pragma": "no-cache", "Cache-Control": "no-cache" }, perMessageDeflate: false, handshakeTimeout: 12000 });
    } catch (e) { return fin({ result: "WS_CTOR_FAIL", error: (e && e.message) || String(e) }); }
    ws.on("unexpected-response", function (req, res) { status = res && res.statusCode; });
    ws.on("open", function () {
      info.connected = true;
      const cfg = "X-Timestamp:" + new Date().toString() + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" + JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" }, outputFormat: "audio-24khz-48kbitrate-mono-mp3" } } } });
      const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ru-RU'><voice name='ru-RU-DmitryNeural'><prosody pitch='+0Hz' rate='+0%'>Проверка связи.</prosody></voice></speak>";
      const msg = "X-RequestId:" + edgeUuid() + "\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:" + new Date().toString() + "Z\r\nPath:ssml\r\n\r\n" + ssml;
      try { ws.send(cfg); ws.send(msg); } catch (e) { fin({ result: "SEND_FAIL", error: (e && e.message) || String(e) }); }
    });
    ws.on("message", function (data, isBinary) {
      if (!isBinary) { const s = data.toString(); if (s.indexOf("Path:turn.end") !== -1) fin({ result: bytes > 0 ? "OK" : "EMPTY", bytes: bytes }); return; }
      try { const b = Buffer.isBuffer(data) ? data : Buffer.from(data); const hl = (b[0] << 8) | b[1]; bytes += Math.max(0, b.length - 2 - hl); } catch (e) {}
    });
    ws.on("error", function (err) { fin({ result: "WS_ERROR", status: status, error: (status ? ("HTTP " + status) : ((err && err.message) || "connection error")) }); });
    ws.on("close", function (code, reason) { if (!done) fin({ result: bytes > 0 ? "OK" : "CLOSED", bytes: bytes, code: code, status: status, reason: reason ? reason.toString().slice(0, 200) : "" }); });
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try { return res.status(200).json(await edgeTest()); }
  catch (e) { return res.status(200).json({ result: "FATAL", error: (e && e.message) || String(e) }); }
};
module.exports.config = { maxDuration: 30 };
module.exports.maxDuration = 30;