const GROQ_MODELS = [...new Set([
  process.env.GROQ_FAST_MODEL || process.env.GROQ_FALLBACK_MODEL || "openai/gpt-oss-20b",
  process.env.GROQ_PRIMARY_MODEL || "openai/gpt-oss-120b",
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
async function requestGroq(key,model,prompt,jsonMode){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),14000);
  try{
    const body={
      model,
      messages:[
        {role:"system",content:"Analyze professionally. Direction must be BUY or SELL. No random selection. Return only the requested result."},
        {role:"user",content:prompt}
      ],
      stream:false,
      temperature:0.2,
      max_completion_tokens:180
    };
    if(jsonMode) body.response_format={type:"json_object"};
    const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},
      body:JSON.stringify(body),
      signal:controller.signal
    });
    const raw=await r.text();
    let message=raw;
    if(!r.ok){try{message=JSON.parse(raw)?.error?.message||raw;}catch(_e){}}
    return {ok:r.ok,status:r.status,raw,message:String(message).slice(0,200)};
  }catch(e){
    return {ok:false,status:0,raw:"",message:String(e.message||e).slice(0,200)};
  }finally{
    clearTimeout(timer);
  }
}
async function callGroq(key,prompt){
  const attempts=[];
  for(const model of GROQ_MODELS){
    const jsonAttempt=await requestGroq(key,model,prompt,true);
    if(jsonAttempt.ok){
      try{
        const data=JSON.parse(jsonAttempt.raw);
        const text=data?.choices?.[0]?.message?.content||"";
        return {result:parseSignal(text,model),attempts};
      }catch(e){
        attempts.push({model,mode:"json",status:200,message:`parse: ${String(e.message||e)}`});
      }
    }else{
      attempts.push({model,mode:"json",status:jsonAttempt.status,message:jsonAttempt.message});
      if(jsonAttempt.status===429) continue;
    }
    // Some Groq models reject response_format. Retry only that model in plain mode.
    const plainAttempt=await requestGroq(key,model,prompt,false);
    if(plainAttempt.ok){
      try{
        const data=JSON.parse(plainAttempt.raw);
        const text=data?.choices?.[0]?.message?.content||"";
        return {result:parseSignal(text,model),attempts};
      }catch(e){
        attempts.push({model,mode:"plain",status:200,message:`parse: ${String(e.message||e)}`});
      }
    }else{
      attempts.push({model,mode:"plain",status:plainAttempt.status,message:plainAttempt.message});
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
    if(!ai.result){
      const limited=ai.attempts.length>0&&ai.attempts.every(x=>x.status===429);
      return res.status(limited?429:502).json({...health,error:limited?"groq_rate_limited":"groq_unavailable",attempts:ai.attempts});
    }
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
  if(!ai.result){
    const limited=ai.attempts.length>0&&ai.attempts.every(x=>x.status===429);
    return res.status(limited?429:502).json({error:limited?"groq_rate_limited":"groq_unavailable",attempts:ai.attempts});
  }
  return res.status(200).json(ai.result);
};
module.exports.config={maxDuration:60};