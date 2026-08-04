const { AsyncLocalStorage } = require("async_hooks");

const LANGUAGES = {
  ru: "Russian",
  en: "English",
  uz: "Uzbek",
  hi: "Hindi",
  pt: "Brazilian Portuguese",
  ar: "Arabic",
  kk: "Kazakh"
};

const storage = global.__pulseLanguageStorage ||
  (global.__pulseLanguageStorage = new AsyncLocalStorage());

// Add the selected output language to every AI request made by analyze-core.js.
if (!global.__pulseOriginalFetch) {
  global.__pulseOriginalFetch = global.fetch;
  global.fetch = async function localizedFetch(input, init) {
    const context = storage.getStore();
    const url = String(input && input.url ? input.url : input || "");

    if (
      context && init && typeof init.body === "string" &&
      (/\/chat\/completions(?:\?|$)/.test(url) ||
       /generativelanguage\.googleapis\.com/.test(url))
    ) {
      try {
        const body = JSON.parse(init.body);
        const instruction =
          "CRITICAL OUTPUT LANGUAGE: Write EVERY human-readable JSON string value in " +
          context.name +
          ". This includes reasons, confidence, summary, strategy, tips, " +
          "entryWindow, expiry, state and every dialogue text. Keep JSON keys, " +
          "direction values BUY/SELL/NO_SIGNAL and who values dop/opy unchanged. " +
          "Never use Russian or English unless the selected language is Russian or English. " +
          "When dialogue is requested, return exactly 6 alternating lines, starting with dop. " +
          "A clear photograph of another phone screen is a valid chart image. Ignore the phone frame, hands, glare and surrounding app UI; focus on the largest visible chart area. " +
          "Do not call a camera photo unreadable when candles and price structure are visibly distinguishable. Still return NO_SIGNAL when the chart is readable but no trading direction is actually confirmed.";

        let inserted = false;
        const content = body?.messages?.[0]?.content;
        const googleParts = body?.contents?.[0]?.parts;
        const hasImage =
          (Array.isArray(content) && content.some((part) => part && part.type === "image_url")) ||
          (Array.isArray(googleParts) && googleParts.some((part) => part && part.inline_data));
        // Vision answers include reasons and six dialogue lines. A 1500-token cap
        // caused valid chart reads to be truncated and returned as NO_SIGNAL.
        if (hasImage) {
          if (typeof body.max_tokens === "number" && body.max_tokens < 2600) body.max_tokens = 2600;
          if (body.generationConfig && typeof body.generationConfig.maxOutputTokens === "number" && body.generationConfig.maxOutputTokens < 2600) {
            body.generationConfig.maxOutputTokens = 2600;
          }
        }
        if (Array.isArray(content)) {
          const textPart = content.find((part) => part && part.type === "text");
          if (textPart) {
            textPart.text = instruction + "\n\n" + String(textPart.text || "");
            inserted = true;
          }
        }

        const parts = googleParts;
        if (!inserted && Array.isArray(parts)) {
          const textPart = parts.find((part) => part && typeof part.text === "string");
          if (textPart) {
            textPart.text = instruction + "\n\n" + textPart.text;
            inserted = true;
          }
        }

        if (inserted) init = { ...init, body: JSON.stringify(body) };
      } catch (_) {}
    }

    return global.__pulseOriginalFetch(input, init);
  };
}

const WORDS = {
  uz: { low: "past", medium: "o‘rta", high: "yuqori", unknown: "Aniqlanmadi" },
  hi: { low: "कम", medium: "मध्यम", high: "उच्च", unknown: "पहचाना नहीं गया" },
  pt: { low: "baixa", medium: "média", high: "alta", unknown: "Não reconhecido" },
  ar: { low: "منخفضة", medium: "متوسطة", high: "عالية", unknown: "غير معروف" },
  kk: { low: "төмен", medium: "орташа", high: "жоғары", unknown: "Танылмады" }
};

const NO_DATA = {
  uz: [
    "Yuklangan rasmda grafik tuzilishini aniqlab bo‘lmadi.",
    "Tasdiqlangan yo‘nalish yo‘q — bu skrinshot bo‘yicha kirish oqlanmaydi.",
    "Kattaroq skrinshot oling: shamlar, vaqt shkalasi va narx darajalari to‘liq ko‘rinsin."
  ],
  hi: [
    "अपलोड की गई छवि में चार्ट की संरचना पढ़ी नहीं जा सकी।",
    "दिशा की पुष्टि नहीं हुई — इस स्क्रीनशॉट पर एंट्री उचित नहीं है।",
    "बड़ा स्क्रीनशॉट लें: कैंडल, समय अक्ष और कीमत के स्तर पूरे दिखें।"
  ],
  pt: [
    "Não foi possível identificar a estrutura do gráfico na imagem enviada.",
    "Não há direção confirmada — entrar com base nesta captura não é justificável.",
    "Envie uma captura maior, mostrando velas, eixo do tempo e níveis de preço por completo."
  ],
  ar: [
    "تعذر قراءة بنية الرسم البياني في الصورة المرفوعة.",
    "لا يوجد اتجاه مؤكد — لا يُنصح بالدخول اعتمادًا على هذه اللقطة.",
    "التقط صورة أكبر تُظهر الشموع ومحور الوقت ومستويات السعر بالكامل."
  ],
  kk: [
    "Жүктелген суреттен график құрылымын оқу мүмкін болмады.",
    "Бағыт расталмады — бұл скриншот бойынша кіру негізсіз.",
    "Үлкенірек скриншот жасаңыз: шамдар, уақыт шкаласы және баға деңгейлері толық көрінсін."
  ]
};

const ERRORS = {
  uz: "So‘rovni bajarib bo‘lmadi. Biroz kutib, qayta urinib ko‘ring.",
  hi: "अनुरोध पूरा नहीं हो सका। थोड़ी देर बाद फिर कोशिश करें।",
  pt: "Não foi possível concluir a solicitação. Aguarde um pouco e tente novamente.",
  ar: "تعذر إكمال الطلب. انتظر قليلًا ثم حاول مرة أخرى.",
  kk: "Сұрауды орындау мүмкін болмады. Біраз күтіп, қайталап көріңіз."
};

const FALLBACK = {
  uz: {
    BUY: ["Yuqoriga ketyapti! Hozir kiramiz! 🚀", "Shoshma. Avval tasdiq, keyin tugma.", "Kutguncha ketib qoladi-ku! 😤", "Bitta imkon ketadi, boshqasi keladi. Reja bo‘yicha."],
    SELL: ["Pastga qulayapti! Sotamiz! 🔥", "Shoshma. Har pasayish signal emas.", "Ko‘rib turibsan-ku, ketdi! 😤", "Tasdiq bo‘lmasa, bu tuzoq bo‘lishi mumkin."],
    NONE: ["Hech bo‘lmasa biror narsa bosamizmi? 😎", "Signal yo‘q bo‘lsa, bitim ham yo‘q.", "Qo‘llarim qichishyapti! 😤", "Zerikish yo‘qotishdan arzonroq."]
  },
  hi: {
    BUY: ["ऊपर भाग रहा है! अभी एंट्री! 🚀", "शांत। पहले पुष्टि, फिर बटन।", "इंतज़ार में निकल जाएगा! 😤", "एक मौका गया तो दूसरा आएगा। योजना से चलो।"],
    SELL: ["नीचे गिर रहा है! बेचो! 🔥", "जल्दी मत करो। हर गिरावट संकेत नहीं होती।", "साफ़ दिख रहा है, जा रहा है! 😤", "पुष्टि के बिना यह जाल हो सकता है।"],
    NONE: ["कुछ तो दबाएँ? बहुत बोरिंग है! 😎", "संकेत नहीं तो ट्रेड नहीं।", "हाथ खुजला रहे हैं! 😤", "बोरियत, नुकसान से सस्ती है।"]
  },
  pt: {
    BUY: ["Tá voando pra cima! Entra agora! 🚀", "Calma. Confirma primeiro, botão depois.", "Vai embora sem a gente! 😤", "Uma oportunidade passa, outra aparece. Segue o plano."],
    SELL: ["Tá despencando! Vende logo! 🔥", "Sem pressa. Nem toda queda é sinal.", "Olha isso, já confirmou! 😤", "Sem confirmação, pode ser armadilha."],
    NONE: ["Vamos apertar alguma coisa? Que tédio! 😎", "Sem sinal, sem operação.", "Minha mão tá coçando! 😤", "Tédio custa menos que prejuízo."]
  },
  ar: {
    BUY: ["يصعد بسرعة! ندخل الآن! 🚀", "اهدأ. التأكيد أولًا، ثم الزر.", "سي��رب من دوننا! 😤", "ت��هب فرصة وتأتي أخرى. التزم بالخطة."],
    SELL: ["ينهار للأسفل! بِع الآن! 🔥", "لا تتعجل. ليس كل هبوط إشارة.", "واضح أنه هابط! 😤", "من دون تأكيد قد يكون فخًا."],
    NONE: ["ألا نضغط أي شيء؟ ممل! 😎", "لا إشارة، لا صفقة.", "يدي تريد الضغط! 😤", "الملل أرخص من الخسارة."]
  },
  kk: {
    BUY: ["Жоғары ұшып барады! Қазір кіреміз! 🚀", "Асықпа. Алдымен растау, содан кейін батырма.", "Бізсіз кетіп қалады! 😤", "Бір мүмкіндік кетсе, екіншісі келеді. Жоспармен."],
    SELL: ["Төмен құлап барады! Сатамыз! 🔥", "Асықпа. Әр құлдырау сигнал емес.", "Көрініп тұр ғой, кетіп барады! 😤", "Растаусыз бұл тұзақ болуы мүмкін."],
    NONE: ["Бірдеңе басайықшы? Іш пысты! 😎", "Сигнал жоқ болса, мәміле де жоқ.", "Қолым қышып тұр! 😤", "Іш пысу шығыннан арзан."]
  }
};

// Preserve the AI scene and complete short 2–5 line answers to exactly six.
const DIALOGUE_TAILS = {
  ru:{dop:"ЛАДНО, ЕЩЁ СЕКУНДУ СМОТРИМ... но палец уже готов. 👀",opy:"Палец пусть готовится. Решение всё равно принимает голова."},
  en:{dop:"FINE, ONE MORE LOOK... but my finger is ready. 👀",opy:"Let the finger wait. The head still makes the decision."},
  uz:{dop:"XO‘P, YANA BIR QARAYMIZ... barmog‘im tayyor. 👀",opy:"Barmoq kutsin. Qarorni baribir bosh qabul qiladi."},
  hi:{dop:"ठीक है, एक नज़र और... उंगली तैयार है। 👀",opy:"उंगली रुके। फैसला फिर भी दिमाग करेगा।"},
  pt:{dop:"TÁ, MAIS UMA OLHADA... meu dedo já está pronto. 👀",opy:"O dedo espera. A cabeça ainda decide."},
  ar:{dop:"حسنًا، نظرة أخيرة... إصبعي جاهز. 👀",opy:"دع الإصبع ينتظر. العقل هو من يقرر."},
  kk:{dop:"ЖАРАЙДЫ, ТАҒЫ БІР ҚАРАЙЫҚ... саусағым дайын. 👀",opy:"Саусақ күтсін. Шешімді бәрібір бас қабылдайды."}
};

function completeDialogue(payload, language) {
  if (!payload || payload.degraded || !Array.isArray(payload.dialogue)) return payload;
  if (!payload.dialogue.length || payload.dialogue.length >= 6) return payload;
  const tail = DIALOGUE_TAILS[language] || DIALOGUE_TAILS.en;
  while (payload.dialogue.length < 6) {
    const who = payload.dialogue.length % 2 ? "opy" : "dop";
    payload.dialogue.push({ who, text: tail[who] });
  }
  payload.dlgSource = String(payload.dlgSource || "ai") + "+completed";
  return payload;
}

function cleanBrokenText(value) {
  if (typeof value === "string") {
    return value
      .replace(/А�ализ/g, "Анализ")
      .replace(/загрузилс�/g, "загрузился")
      .replace(/Н� сегодня/g, "На сегодня")
      .replace(/тру�ишь/g, "трусишь")
      .replace(/�оть/g, "хоть");
  }
  if (Array.isArray(value)) return value.map(cleanBrokenText);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = cleanBrokenText(value[key]);
  }
  return value;
}

function localizePayload(payload, language) {
  payload = cleanBrokenText(payload);
  if (!payload || typeof payload !== "object" || !WORDS[language]) return payload;

  const words = WORDS[language];
  const confidence = String(payload.confidence || "").toLowerCase();
  if (confidence === "low" || confidence === "низкая") payload.confidence = words.low;
  if (confidence === "medium" || confidence === "средняя") payload.confidence = words.medium;
  if (confidence === "high" || confidence === "высокая") payload.confidence = words.high;

  if (!payload.asset || /^(Not recognized|Не распознан)$/i.test(payload.asset)) payload.asset = words.unknown;
  if (!payload.timeframe || /^(Not recognized|Не распознан)$/i.test(payload.timeframe)) payload.timeframe = words.unknown;

  if (payload.degraded) {
    payload.reasons = NO_DATA[language];
    if (!payload.summary || /temporarily unavailable|did not respond|временно недоступен|не ответил/i.test(payload.summary)) {
      payload.summary = ERRORS[language];
    }
  }

  if (payload.notice) {
    payload.summary = ERRORS[language];
    payload.reasons = NO_DATA[language].slice(1);
  }

  if (
    !payload.degraded &&
    (payload.dlgSource === "fallback" || !Array.isArray(payload.dialogue) || !payload.dialogue.length)
  ) {
    const direction = payload.direction === "BUY" || payload.direction === "SELL"
      ? payload.direction
      : "NONE";
    payload.dialogue = FALLBACK[language][direction].map((text, index) => ({
      who: index % 2 ? "opy" : "dop",
      text
    }));
    payload.dlgSource = "localized-fallback";
  }

  return payload;
}

function sanitizePublicPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  ["diag", "dlgDiag", "ttsDiag", "debug", "stack", "raw", "error", "netError", "internal", "provider", "model"].forEach(function (key) {
    try { delete payload[key]; } catch (_) {}
  });
  return payload;
}

module.exports = async function localizedAnalyze(req, res) {
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch (_) {
    body = {};
  }

  const language = LANGUAGES[body.language] ? body.language : "en";

  // analyze-core.js understands RU/EN internally. AI output gets the real language
  // through the fetch interceptor above.
  const innerBody = { ...body, language: language === "ru" ? "ru" : "en" };
  const innerReq = Object.create(req);
  innerReq.body = innerBody;

  const innerRes = Object.create(res);
  innerRes.status = function status(code) {
    res.status(code);
    return innerRes;
  };
  innerRes.setHeader = function setHeader(key, value) {
    return res.setHeader(key, value);
  };
  innerRes.end = function end(...args) {
    return res.end(...args);
  };
  innerRes.json = function json(payload) {
    return res.json(sanitizePublicPayload(completeDialogue(localizePayload(payload, language), language)));
  };

  // This endpoint has its own Gemini key. Do not alter the existing
  // GEMINI_API_KEY used by the Telegram assistant in Vercel.
  const pulseKey = String(process.env.PULSE_APP_GEMINI || "").trim();
  const previousEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_MODELS: process.env.AI_MODELS
  };

  function restoreEnv(name, value) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  if (pulseKey) {
    process.env.GEMINI_API_KEY = pulseKey;
    // Leave AI_BASE_URL unset so analyze-core uses its native Google Gemini
    // request path for Google-issued keys instead of the Unity/OpenAI path.
    delete process.env.AI_BASE_URL;
    process.env.AI_MODELS = "gemini-3.6-flash";
  }

  try {
    const corePath = require.resolve("./analyze-core");
    delete require.cache[corePath];

    // Patch the legacy model mapper in memory. The stored core forced every
    // Gemini 3.x request back to retired gemini-2.5-flash.
    const fs = require("fs");
    const path = require("path");
    const Module = require("module");
    const oldModelMap = 'if (!m || /^gemini-3/.test(m)) return "gemini-2.5-flash";';
    const newModelMap = 'if (!m) return "gemini-3.6-flash";';
    const originalCoreSource = fs.readFileSync(corePath, "utf8");
    const patchedCoreSource = originalCoreSource.replace(oldModelMap, newModelMap);
    if (patchedCoreSource === originalCoreSource) {
      throw new Error("Gemini model mapper patch target was not found");
    }
    const coreModule = new Module(corePath, module);
    coreModule.filename = corePath;
    coreModule.paths = Module._nodeModulePaths(path.dirname(corePath));
    require.cache[corePath] = coreModule;
    coreModule._compile(patchedCoreSource, corePath);
    const analyzeCore = coreModule.exports;

    return await storage.run(
      { code: language, name: LANGUAGES[language] },
      () => analyzeCore(innerReq, innerRes)
    );
  } finally {
    restoreEnv("GEMINI_API_KEY", previousEnv.GEMINI_API_KEY);
    restoreEnv("AI_BASE_URL", previousEnv.AI_BASE_URL);
    restoreEnv("AI_MODELS", previousEnv.AI_MODELS);
  }
};

module.exports.config = { maxDuration: 60 };
module.exports.maxDuration = 60;