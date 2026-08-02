// api/edgecheck.js — тест Microsoft Edge TTS на Vercel. Открой /api/edgecheck в браузере.
const crypto = require("crypto");
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
    const WS = globalThis.WebSocket;
    const info = { wsAvailable: typeof WS === "function", gecVer: EDGE_GEC_VER };
    if (typeof WS !== "function") { info.result = "NO_WEBSOCKET"; return resolve(info); }
    const url = EDGE_WSS + "&Sec-MS-GEC=" + edgeSecGec() + "&Sec-MS-GEC-Version=" + encodeURIComponent(EDGE_GEC_VER) + "&ConnectionId=" + edgeUuid();
    let done = false, bytes = 0, ws = null;
    const to = setTimeout(function () { fin({ result: "TIMEOUT" }); }, 15000);
    function fin(extra) {
      if (done) return; done = true; clearTimeout(to);
      try { if (ws && ws.readyState <= 1) ws.close(); } catch (e) {}
      resolve(Object.assign(info, extra));
    }
    try {
      ws = new WS(url, { headers: { "User-Agent": EDGE_UA, "Origin": "chrome-extension://jdiccldimpsojpoohpkozjmacepdlmdj", "Pragma": "no-cache", "Cache-Control": "no-cache" } });
    } catch (e) {
      try { ws = new WS(url); info.headersMode = "none"; } catch (e2) { return fin({ result: "WS_CTOR_FAIL", error: (e2 && e2.message) || String(e2) }); }
    }
    try { ws.binaryType = "arraybuffer"; } catch (e) {}
    ws.onopen = function () {
      info.connected = true;
      const cfg = "X-Timestamp:" + new Date().toString() + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" + JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" }, outputFormat: "audio-24khz-48kbitrate-mono-mp3" } } } });
      const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ru-RU'><voice name='ru-RU-DmitryNeural'><prosody pitch='+0Hz' rate='+0%'>Проверка связи.</prosody></voice></speak>";
      const msg = "X-RequestId:" + edgeUuid() + "\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:" + new Date().toString() + "Z\r\nPath:ssml\r\n\r\n" + ssml;
      try { ws.send(cfg); ws.send(msg); } catch (e) { fin({ result: "SEND_FAIL", error: (e && e.message) || String(e) }); }
    };
    ws.onmessage = function (ev) {
      const d = ev.data;
      if (typeof d === "string") { if (d.indexOf("Path:turn.end") !== -1) fin({ result: bytes > 0 ? "OK" : "EMPTY", bytes: bytes }); return; }
      try { const b = Buffer.from(d); const hl = (b[0] << 8) | b[1]; bytes += Math.max(0, b.length - 2 - hl); } catch (e) {}
    };
    ws.onerror = function (ev) { fin({ result: "WS_ERROR", error: (ev && (ev.message || ev.error && ev.error.message)) || "connection error" }); };
    ws.onclose = function (ev) { if (!done) fin({ result: bytes > 0 ? "OK" : "CLOSED", bytes: bytes, code: ev && ev.code, reason: ev && ev.reason }); };
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const out = await edgeTest();
    return res.status(200).json(out);
  } catch (e) {
    return res.status(200).json({ result: "FATAL", error: (e && e.message) || String(e) });
  }
};
module.exports.config = { maxDuration: 30 };
module.exports.maxDuration = 30;