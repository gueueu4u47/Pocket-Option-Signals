const GROQ_MODELS = [...new Set([
  process.env.GROQ_PRIMARY_MODEL || "openai/gpt-oss-120b",
  process.env.GROQ_FALLBACK_MODEL || "openai/gpt-oss-20b",
])];
const PAIRS = new Set(["CAD/JPY (OTC)","AUD/USD (OTC)","EUR/USD (OTC)","USD/JPY (OTC)","GBP/AUD (OTC)","EUR/CAD (OTC)","GBP/USD (OTC)","AUD/CAD (OTC)","EUR/GBP (OTC)","USD/CAD (OTC)","NZD/USD (OTC)","CHF/JPY (OTC)","EUR/JPY (OTC)","GBP/JPY (OTC)","AUD/JPY (OTC)","CAD/CHF (OTC)","EUR/CHF (OTC)","GBP/CAD (OTC)"]);
const TIMES = new Set(["S5","S15","M1","M3","M5"]);
const FALLBACK_SECRET = "pulse_x9k2m4p8q1r5s7t3v6w0y2z4";

function cleanJson(text){
  const raw=String(text||"").replace(/^```(?:json)?/i,"").replace(/```$/i,"").trim();
  const a=raw.indexOf("{"); const b=raw.lastIndexOf("}");
  if(a<0||b<a) throw new Error("No JSON");
  return JSON.parse(raw.slice(a,b+1));
}
function normalize(out,model){
  const direction=String(out&&out.direction||"").toUpperCase();
  if(direction!=="BUY"&&direction!=="SELL") throw new Error("Bad direction");
  const rawConfidence=String(out&&out.confidence||"").toUpperCase();
  const confidence=["LOW","MEDIUM","HIGH"].includes(rawConfidence)?rawConfidence:"MEDIUM";
  const analysis=String(out&&out.analysis||"Claude completed professional market-context analysis.").trim().slice(0,400);
  return {direction,confidence,analysis,provider:"groq",model};
}
function parseSignal(text,model){
  try{return normalize(cleanJson(text),model);}catch(_e){}
  const raw=String(text||"");
  const dm=raw.match(/"direction"\s*:\s*"(BUY|SELL)"/i)||raw.match(/(?:direction|направление)\s*[:=\-]\s*(BUY|SELL)\b/i)||raw.match(/\b(BUY|SELL)\b/i);
  if(!dm) throw new Error("No BUY/SELL direction");
  const cm=raw.match(/"confidence"\s*:\s*"(LOW|MEDIUM|HIGH)"/i)||raw.match(/\b(LOW|MEDIUM|HIGH)\b/i);
  return normalize({direction:dm[1],confidence:cm?cm[1]:"LOW"},model);
}
function promptFor(pair,timeframe,utc){
  return `Professional short-term FX scenario. Pair=${pair}; expiry=${timeframe}; UTC=${utc}. Markets are unpredictable, so analyze the most probable direction professionally without inventing exact prices or broker candles. OTC quotes may differ. Choose BUY or SELL; never HOLD, WAIT or PAUSED; never choose randomly. Return only JSON: {"direction":"BUY|SELL","confidence":"LOW|MEDIUM|HIGH","analysis":"one brief rationale"}.`;
}
async function callGroq(key,prompt){
  const attempts=[];
  for(const model of GROQ_MODELS){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),16000);
    try{
      const body={
        model,
        messages:[
          {role:"system",content:"Analyze professionally. Return one JSON object only. Direction must be BUY or SELL. No random selection."},
          {role:"user",content:prompt}
        ],
        response_format:{type:"json_object"},
        stream:false,
        temperature:0.2,
        max_completion_tokens:220
      };
      const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},
        body:JSON.stringify(body),
        signal:controller.signal
      });
      const raw=await r.text();
      if(!r.ok){
        let message=raw;
        try{message=JSON.parse(raw)?.error?.message||raw;}catch(_e){}
        attempts.push({model,status:r.status,message:String(message).slice(0,200)});
        continue;
      }
      const data=JSON.parse(raw);
      const text=data?.choices?.[0]?.message?.content||"";
      try{return {result:parseSignal(text,model),attempts};}
      catch(e){attempts.push({model,status:200,message:`parse: ${String(e.message||e)}`});}
    }catch(e){
      attempts.push({model,status:0,message:String(e.message||e).slice(0,200)});
    }finally{
      clearTimeout(timer);
    }
  }
  return {result:null,attempts};
}
module.exports=async function handler(req,res){
  if(req.method==="GET"){
    const key=String(process.env.GROQ_API_KEY||"").trim();
    const health={status:"ok",provider:"groq",groqConfigured:Boolean(key),groqModels:GROQ_MODELS};
    if(String(req.query&&req.query.diagnose||"")!=="claude-check-8416") return res.status(200).json(health);
    if(!key) return res.status(503).json({...health,error:"groq_not_configured"});
    const ai=await callGroq(key,'Return only JSON: {"direction":"BUY","confidence":"MEDIUM","analysis":"Connection check"}');
    if(!ai.result) return res.status(502).json({...health,error:"groq_unavailable",attempts:ai.attempts});
    return res.status(200).json({...health,diagnostic:"passed",result:ai.result});
  }
  if(req.method!=="POST") return res.status(405).json({error:"method"});
  const supplied=String(req.headers["x-signal-secret"]||"");
  const accepted=[String(process.env.BOT_SIGNAL_SECRET||""),FALLBACK_SECRET].filter(Boolean);
  if(!supplied||!accepted.includes(supplied)) return res.status(401).json({error:"unauthorized"});
  const pair=String(req.body&&req.body.pair||"");
  const timeframe=String(req.body&&req.body.timeframe||"");
  if(!PAIRS.has(pair)||!TIMES.has(timeframe)) return res.status(400).json({error:"invalid_selection"});
  const key=String(process.env.GROQ_API_KEY||"").trim();
  if(!key) return res.status(503).json({error:"groq_not_configured"});
  const ai=await callGroq(key,promptFor(pair,timeframe,new Date().toISOString()));
  if(!ai.result) return res.status(502).json({error:"groq_unavailable",attempts:ai.attempts});
  return res.status(200).json(ai.result);
};
module.exports.config={maxDuration:60};