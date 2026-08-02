const { AsyncLocalStorage } = require("async_hooks");

const SUPPORTED = {
  ru: "Russian",
  en: "English",
  uz: "Uzbek",
  hi: "Hindi",
  pt: "Brazilian Portuguese",
  ar: "Arabic",
  kk: "Kazakh"
};

const store = global.__pulseLanguageStore || (global.__pulseLanguageStore = new AsyncLocalStorage());

if (!global.__pulseNativeFetch) {
  global.__pulseNativeFetch = global.fetch;
  global.fetch = async function localizedFetch(input, init) {
    const ctx = store.getStore();
    const url = String(input && input.url ? input.url : input || "");
    if (ctx && init && typeof init.body === "string" &&
        (/\/chat\/completions(?:\?|$)/.test(url) || /generativelanguage\.googleapis\.com/.test(url))) {
      try {
        const body = JSON.parse(init.body);
        const instruction =
          "CRITICAL OUTPUT LANGUAGE: Write EVERY human-readable JSON string value in " + ctx.name +
          ". This includes reasons, confidence, summary, strategy, tips, entryWindow, expiry, state and every dialogue text. " +
          "Keep JSON keys, direction values BUY/SELL/NO_SIGNAL, and who values dop/opy unchanged. Never use Russian or English unless " +
          ctx.name + " is that language.";
        let inserted = false;
        const content = body && body.messages && body.messages[0] && body.messages[0].content;
        if (Array.isArray(content)) {
          for (const part of content) {
            if (part && part.type === "text") {
              part.text = instruction + "\n\n" + String(part.text || "");
              inserted = true;
              break;
            }
          }
        }
        const parts = body && body.contents && body.contents[0] && body.contents[0].parts;
        if (!inserted && Array.isArray(parts)) {
          for (const part of parts) {
            if (part && typeof part.text === "string") {
              part.text = instruction + "\n\n" + part.text;
              inserted = true;
              break;
            }
          }
        }
        if (inserted) init = Object.assign({}, init, { body: JSON.stringify(body) });
      } catch (_) {}
    }
    return global.__pulseNativeFetch(input, init);
  };
}

const WORDS = {
  uz: { low:"past", medium:"o‘rta", high:"yuqori", unknown:"Aniqlanmadi" },
  hi: { low:"कम", medium:"मध्यम", high:"उच्च", unknown:"पहचाना नहीं गया" },
  pt: { low:"baixa", medium:"média", high:"alta", unknown:"Não reconhecido" },
  ar: { low:"منخفضة", medium:"متوسطة", high:"عالية", unknown:"غير معروف" },
  kk: { low:"төмен", medium:"орташа", high:"жоғары", unknown:"Танылмады" }
};

const NO_DATA = {
  uz: ["Yuklangan rasmda grafik tuzilishini aniqlab bo‘lmadi.","Tasdiqlangan yo‘nalish yo‘q — bu skrinshot bo‘yicha kirish oqlanmaydi.","Kattaroq skrinshot oling: shamlar, vaqt shkalasi va narx darajalari to‘liq ko‘rinsin."],
  hi: ["अपलोड की गई छवि में चार्ट की संरचना पढ़ी नहीं जा सकी।","दिशा की पुष्टि नहीं हुई — इस स्क्रीनशॉट पर एंट्री उचित नहीं है।","बड़ा स्क्रीनशॉट लें: कैंडल, समय अक्ष और कीमत के स्तर पूरे दिखें।"],
  pt: ["Não foi possível identificar a estrutura do gráfico na imagem enviada.","Não há direção confirmada — entrar com base nesta captura não é justificável.","Envie uma captura maior, mostrando velas, eixo do tempo e níveis de preço por completo."],
  ar: ["تعذر قراءة بنية الرسم البياني في الصورة المرفوعة.","لا يوجد اتجاه مؤكد — لا يُنصح بالدخول اعتمادًا على هذه اللقطة.","التقط صورة أكبر تُظهر الشموع ومحور الوقت ومستويات السعر بالكامل."],
  kk: ["Жүктелген суреттен график құрылымын оқу мүмкін болмады.","Бағыт расталмады — бұл скриншот бойынша кіру негізсіз.","Үлкенірек скриншот жасаңыз: шамдар, уақыт шкаласы және баға деңгейлері толық көрінсін."]
};

const FALLBACK = {
  uz: {
    BUY:["Yuqoriga ketyapti! Hozir kiramiz! 🚀","Shoshma. Avval tasdiq, keyin tugma.","Kutguncha ketib qoladi-ku! 😤","Bitta imkon ketadi, boshqasi keladi. Reja bo‘yicha."],
    SELL:["Pastga qulayapti! Sotamiz! 🔥","Shoshma. Har pasayish signal emas.","Ko‘rib turibsan-ku, ketdi! 😤","Tasdiq bo‘lmasa, bu tuzoq bo‘lishi mumkin."],
    NONE:["Hech bo‘lmasa biror narsa bosamizmi? 😎","Signal yo‘q bo‘lsa, bitim ham yo‘q.","Qo‘llarim qichishyapti! 😤","Zerikish yo‘qotishdan arzonroq."]
  },
  hi: {
    BUY:["ऊपर भाग रहा है! अभी एंट्री! 🚀","शांत। पहले पुष्टि, फिर बटन।","इंतज़ार में निकल जाएगा! 😤","एक मौका गया तो दूसरा आएगा। योजना से चलो।"],
    SELL:["नीचे गिर रहा है! बेचो! 🔥","जल्दी मत करो। हर गिरावट संकेत नहीं होती।","साफ़ दिख रहा है, जा रहा है! 😤","पुष्टि के बिना यह जाल हो सकता है।"],
    NONE:["कुछ तो दबाएँ? बहुत बोरिंग है! 😎","संकेत नहीं तो ट्रेड नहीं।","हाथ खुजला रहे हैं! 😤","बोरियत, नुकसान से सस्ती है।"]
  },
  pt: {
    BUY:["Tá voando pra cima! Entra agora! 🚀","Calma. Confirma primeiro, botão depois.","Vai embora sem a gente! 😤","Uma oportunidade passa, outra aparece. Segue o plano."],
    SELL:["Tá despencando! Vende logo! 🔥","Sem pressa. Nem toda queda é sinal.","Olha isso, já confirmou! 😤","Sem confirmação, pode ser armadilha."],
    NONE:["Vamos apertar alguma coisa? Que tédio! 😎","Sem sinal, sem operação.","Minha mão tá coçando! 😤","Tédio custa menos que prejuízo." ]
  },
  ar: {
    BUY:["يصعد بسرعة! ندخل الآن! 🚀","اهدأ. التأكيد أولًا، ثم الزر.","سيهرب من دوننا! 😤","تذهب فرصة وتأتي أخرى. التزم بالخطة."],
    SELL:["ينهار للأسفل! بِع الآن! 🔥","لا تتعجل. ليس كل هبوط إشارة.","واضح أنه هابط! 😤","من دون تأكيد قد يكون فخًا."],
    NONE:["ألا نضغط أي شيء؟ ممل! 😎","لا إشارة، لا صفقة.","يدي تريد الضغط! 😤","الملل أرخص من الخسارة."]
  },
  kk: {
    BUY:["Жоғары ұшып барады! Қазір кіреміз! 🚀","Асықпа. Алдымен растау, содан кейін батырма.","Бізсіз кетіп қалады! 😤","Бір мүмкіндік кетсе, екіншісі келеді. Жоспармен."],
    SELL:["Төмен құлап барады! Сатамыз! 🔥","Асықпа. Әр құлдырау сигнал емес.","Көрініп тұр ғой, кетіп барады! 😤","Растаусыз бұл тұзақ болуы мүмкін."],
    NONE:["Бірдеңе басайықшы? Іш пысты! 😎","Сигнал жоқ болса, мәміле де жоқ.","Қолым қышып тұр! 😤","Іш пысу шығыннан арзан."]
  }
};

const GENERIC_ERROR = {
  uz:"So‘rovni bajarib bo‘lmadi. Biroz kutib, qayta urinib ko‘ring.",
  hi:"अनुरोध पूरा नहीं हो सका। थोड़ी देर बाद फिर कोशिश करें।",
  pt:"Não foi possível concluir a solicitação. Aguarde um pouco e tente novamente.",
  ar:"تعذر إكمال الطلب. انتظر قليلًا ثم حاول مرة أخرى.",
  kk:"Сұрауды орындау мүмкін болмады. Біраз күтіп, қайталап көріңіз."
};

function cleanBrokenText(value) {
  if (typeof value === "string") return value
    .replace(new RegExp("А\\uFFFDализ", "g"),"Анализ")
    .replace(new RegExp("загрузилс\\uFFFD", "g"),"загрузился")
    .replace(new RegExp("Н\\uFFFD сегодня", "g"),"На сегодня")
    .replace(new RegExp("тру\\uFFFDишь", "g"),"трусишь")
    .replace(new RegExp("\\uFFFDоть", "g"),"хоть");
  if (Array.isArray(value)) return value.map(cleanBrokenText);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = cleanBrokenText(value[key]);
  }
  return value;
}

function localizePayload(payload, lang) {
  payload = cleanBrokenText(payload);
  if (!WORDS[lang] || !payload || typeof payload !== "object") return payload;
  const w = WORDS[lang];
  const c = String(payload.confidence || "").toLowerCase();
  if (c === "low" || c === "низкая") payload.confidence = w.low;
  else if (c === "medium" || c === "средняя") payload.confidence = w.medium;
  else if (c === "high" || c === "высокая") payload.confidence = w.high;
  if (!payload.asset || /^(Not recognized|Не распознан)$/i.test(payload.asset)) payload.asset = w.unknown;
  if (!payload.timeframe || /^(Not recognized|Не распознан)$/i.test(payload.timeframe)) payload.timeframe = w.unknown;
  if (payload.degraded) {
    payload.reasons = NO_DATA[lang];
    if (!payload.summary || /temporarily unavailable|did not respond|временно недоступен|не ответил/i.test(payload.summary)) {
      payload.summary = GENERIC_ERROR[lang];
    }
  }
  if (payload.notice) {
    payload.summary = GENERIC_ERROR[lang];
    payload.reasons = NO_DATA[lang].slice(1);
  }
  if (!payload.degraded && (payload.dlgSource === "fallback" || !Array.isArray(payload.dialogue) || !payload.dialogue.length)) {
    const dir = payload.direction === "BUY" || payload.direction === "SELL" ? payload.direction : "NONE";
    const lines = FALLBACK[lang][dir];
    payload.dialogue = lines.map((text, i) => ({ who: i % 2 ? "opy" : "dop", text }));
    payload.dlgSource = "localized-fallback";
  }
  return payload;
}

module.exports = async function localizedAnalyze(req, res) {
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const lang = SUPPORTED[body.language] ? body.language : "en";
  const innerBody = Object.assign({}, body, { language: lang === "ru" ? "ru" : "en" });
  const innerReq = Object.assign({}, req, { body: innerBody });
  const innerRes = Object.create(res);
  innerRes.status = function status(code) { res.status(code); return innerRes; };
  innerRes.setHeader = function setHeader(k, v) { res.setHeader(k, v); };
  innerRes.end = function end() { return res.end(); };
  innerRes.json = function json(payload) { return res.json(localizePayload(payload, lang)); };

  // Fresh module instance prevents the original RU/EN cache from mixing different languages.
  const path = require.resolve("./analyze");
  delete require.cache[path];
  const analyze = require("./analyze");
  return store.run({ code: lang, name: SUPPORTED[lang] }, () => analyze(innerReq, innerRes));
};

module.exports.config = { maxDuration: 60 };
module.exports.maxDuration = 60;