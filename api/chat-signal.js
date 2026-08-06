const GROQ_MODELS = [process.env.GROQ_PRIMARY_MODEL || "openai/gpt-oss-120b", process.env.GROQ_FALLBACK_MODEL || "openai/gpt-oss-20b"];
const PAIRS = new Set(["CAD/JPY (OTC)","AUD/USD (OTC)","EUR/USD (OTC)","USD/JPY (OTC)","GBP/AUD (OTC)","EUR/CAD (OTC)","GBP/USD (OTC)","AUD/CAD (OTC)","EUR/GBP (OTC)","USD/CAD (OTC)","NZD/USD (OTC)","CHF/JPY (OTC)","EUR/JPY (OTC)","GBP/JPY (OTC)","AUD/JPY (OTC)","CAD/CHF (OTC)","EUR/CHF (OTC)","GBP/CAD (OTC)"]);
const TIMES = new Set(["S5","S15","M1","M3","M5"]);
const FALLBACK_SECRET = "pulse_x9k2m4p8q1r5s7t3v6w0y2z4";

function cleanJson(text){
  const raw=String(text||"").replace(/^```(?:json)?/i,"").replace(/```$/i,"").trim();
  const a=raw.indexOf("{"); const b=raw.lastIndexOf("}");
  if(a<0||b<a) throw new Error("No JSON");
  return JSON.parse(raw.slice(a,b+1));
}
function normalize(out,provider,model){
  const direction=String(out&&out.direction||"").toUpperCase();
  if(direction!=="BUY"&&direction!=="SELL") throw new Error("Bad direction");
  const rawConfidence=String(out.confidence||"").toUpperCase();
  const confidence=["LOW","MEDIUM","HIGH"].includes(rawConfidence)?rawConfidence:"MEDIUM";
  const analysis=String(out.analysis||"").trim().slice(0,700);
  if(!analysis) throw new Error("No analysis");
  return {direction,confidence,analysis,provider,model};
}
function promptFor(pair,timeframe,utc){
  return `Ты — ИИ-модуль краткосрочного валютного сценария. Пара: ${pair}. Экспирация: ${timeframe}. UTC: ${utc}. Не используй случайный выбор. Сопоставь общее поведение валют, краткосрочную структуру и риск очень короткой экспирации. Котировка OTC у брокера может отличаться, поэтому не выдумывай точную цену или свечи. Выбери наиболее обоснованный сценарий BUY либо SELL. Верни только JSON: {"direction":"BUY|SELL","confidence":"LOW|MEDIUM|HIGH","analysis":"2 коротких предложения на русском: причина и риск"}.`;
}
async function callGroq(key,prompt){
  if(!key) return null;
  for(const model of [...new Set(GROQ_MODELS)]){
    try{
      const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},
        body:JSON.stringify({model,messages:[{role:"system",content:"Return strict JSON only. Never choose randomly."},{role:"user",content:prompt}],temperature:0.15,max_tokens:350,include_reasoning:false,response_format:{type:"json_object"}})
      });
      if(r.status===429||r.status===503||r.status===404) continue;
      if(!r.ok) break;
      const j=await r.json();
      const text=j?.choices?.[0]?.message?.content||"";
      return normalize(cleanJson(text),"groq",model);
    }catch(_e){}
  }
  return null;
}
module.exports=async function handler(req,res){
  if(req.method==="GET") return res.status(200).json({status:"ok",provider:"groq",groqConfigured:Boolean(String(process.env.GROQ_API_KEY||"").trim()),groqModels:GROQ_MODELS});
  if(req.method!=="POST") return res.status(405).json({error:"method"});
  const supplied=String(req.headers["x-signal-secret"]||"");
  const accepted=[String(process.env.BOT_SIGNAL_SECRET||""),String(FALLBACK_SECRET||"")].filter(Boolean);
  if(!supplied||!accepted.includes(supplied)) return res.status(401).json({error:"unauthorized"});
  const pair=String(req.body&&req.body.pair||"");
  const timeframe=String(req.body&&req.body.timeframe||"");
  if(!PAIRS.has(pair)||!TIMES.has(timeframe)) return res.status(400).json({error:"invalid_selection"});
  const prompt=promptFor(pair,timeframe,new Date().toISOString());
  const groqKey=String(process.env.GROQ_API_KEY||"").trim();
  if(!groqKey) return res.status(503).json({error:"groq_not_configured"});
  const result=await callGroq(groqKey,prompt);
  if(!result) return res.status(502).json({error:"groq_unavailable"});
  return res.status(200).json(result);
};
module.exports.config={maxDuration:45};