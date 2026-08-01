/*
 * Signal Pulse — «Внутренний конфликт»
 * НЕ чат двух персонажей. Это две системы внутри AI, читающие голову трейдера:
 *   Дофамин = импульс, эмоция, желание действовать;
 *   Опыт    = память, прошлые решения, дисциплина.
 * Экран во время анализа графика собирает ощущение:
 *   «AI понимает, что сейчас происходит в моей голове».
 * Структура читается сверху вниз (не пинг-понг реплик):
 *   СИТУАЦИЯ -> ДОФАМИН·ИМПУЛЬС -> ОПЫТ·ПАМЯТЬ -> РЕШЕНИЕ.
 * Всё обращено к «тебе». Визуальный язык Pocket Option (переменные --accent/--up/
 * --down/--line/--card), но это НЕ копия PO.
 *
 * Самодостаточно: сам подключается к Vision-флоу через наблюдение за DOM.
 * Подключение: <script src="scene.js"></script>
 */
(function () {
  "use strict";

  var DOP = "dop"; // импульс
  var OPY = "opy"; // память
  var FACE = { dop: "data:image/webp;base64,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", opy: "data:image/webp;base64,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" };

  var ARROW = {
    ru: { up: "↑ ВВЕРХ", down: "↓ ВНИЗ", none: "• ПАУЗА" },
    en: { up: "↑ UP", down: "↓ DOWN", none: "• WAIT" }
  };

  /* ---------- Библиотека (не случайные реплики, а роли систем) ---------- */
  var LIB = {
    ru: {
      head: "ЧТО СЕЙЧАС В ТВОЕЙ ГОЛОВЕ",
      tag: { sit: "СИТУАЦИЯ", dop: "ДОФАМИН · ИМПУЛЬС", opy: "ОПЫТ · ПАМЯТЬ", dec: "РЕШЕНИЕ" },
      situation: [
        "Резкий импульс вверх.\nВерхняя зона рядом.\nОбъём пока молчит.",
        "Цена ускорилась.\nДвижение сильное.\nПодтверждения ещё нет.",
        "Красивая свеча.\nРовно такая, на которую тянет реагировать.",
        "Рынок дёрнулся резко.\nТы это уже почувствовал."
      ],
      impulse: [
        "Тебя тянет войти.\nПрямо сейчас.\nПока не ушло.",
        "Рука уже над кнопкой.\nВнутри — «это оно».",
        "Ты хочешь действовать.\nЭмоция громче расчёта.",
        "«Только бы успеть» —\nвот что ты сейчас чувствуешь."
      ],
      check: [
        "Ты уже входил на таком.\nВспомни, чем закончилось.",
        "Это желание тебе знакомо.\nОно редко про план.",
        "Не рынок торопит.\nТоропит импульс внутри тебя.",
        "Твой прошлый «верняк»\nвыглядел точно так же."
      ],
      tension: [
        { imp: "Ещё секунда — и уйдёт.", exp: "Или ещё секунда — и станет ясно." },
        { imp: "А вдруг это твой шанс?", exp: "А вдруг это твой прошлый урок?" },
        { imp: "Внутри всё кричит «да».", exp: "Громче — не значит вернее." }
      ],
      decision: {
        up: [
          "Импульс и опыт сошлись.\nВверх — по плану, а не на эмоции.",
          "Здесь тебе можно.\nНо потому что расчёт, а не желание."
        ],
        down: [
          "Тянуло вверх.\nПравда — внизу.\nСторона: вниз.",
          "Не туда, куда толкает импульс.\nВниз — но честно."
        ],
        none: [
          "Сегодня твой вход — не вход.\nЛучшее решение: подождать.",
          "Импульс есть, подтверждения нет.\nСегодня ты сильнее, если пропустишь."
        ]
      }
    },
    en: {
      head: "WHAT'S IN YOUR HEAD NOW",
      tag: { sit: "SITUATION", dop: "DOPAMINE · IMPULSE", opy: "EXPERIENCE · MEMORY", dec: "DECISION" },
      situation: [
        "Sharp push up.\nThe top zone is close.\nVolume is still silent.",
        "Price accelerated.\nStrong move.\nNo confirmation yet.",
        "A pretty candle.\nExactly the kind you want to react to.",
        "The market jerked fast.\nYou already felt it."
      ],
      impulse: [
        "You want in.\nRight now.\nBefore it's gone.",
        "Your hand's over the button.\nInside — 'this is it'.",
        "You want to act.\nEmotion louder than the math.",
        "'Just don't miss it' —\nthat's what you feel now."
      ],
      check: [
        "You've entered on this before.\nRemember how it ended.",
        "You know this urge.\nIt's rarely about the plan.",
        "It's not the market rushing you.\nIt's the impulse inside.",
        "Your last 'sure thing'\nlooked exactly like this."
      ],
      tension: [
        { imp: "One more second and it's gone.", exp: "Or one more second and it's clear." },
        { imp: "What if this is your shot?", exp: "What if this is your old lesson?" },
        { imp: "Everything inside screams 'yes'.", exp: "Louder isn't truer." }
      ],
      decision: {
        up: [
          "Impulse and experience agree.\nUp — by the plan, not the feeling.",
          "You're clear here.\nBut because of the math, not the want."
        ],
        down: [
          "It pulled up.\nThe truth is down.\nSide: down.",
          "Not where the impulse pushes.\nDown — but honest."
        ],
        none: [
          "Today your entry isn't one.\nBest move: wait.",
          "Impulse yes, confirmation no.\nToday you're stronger if you skip."
        ]
      }
    }
  };

  /* ---------- Утилиты ---------- */
  function lang() {
    var l = (document.documentElement.getAttribute("lang") || "ru").slice(0, 2);
    return LIB[l] ? l : "en";
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function Picker(getSet) {
    var used = [];
    return function () {
      var set = getSet();
      if (!set || !set.length) return null;
      if (used.length >= set.length) used = [];
      var pool = [];
      for (var i = 0; i < set.length; i++) if (used.indexOf(i) === -1) pool.push(i);
      var idx = pool[Math.floor(Math.random() * pool.length)];
      used.push(idx);
      return set[idx];
    };
  }

  var S = { gen: 0, running: false, resolving: false, inResolve: false, dir: "none" };
  var pickSituation = Picker(function () { return LIB[lang()].situation; });
  var pickImpulse = Picker(function () { return LIB[lang()].impulse; });
  var pickCheck = Picker(function () { return LIB[lang()].check; });
  var pickTension = Picker(function () { return LIB[lang()].tension; });
  var pickUp = Picker(function () { return LIB[lang()].decision.up; });
  var pickDown = Picker(function () { return LIB[lang()].decision.down; });
  var pickNone = Picker(function () { return LIB[lang()].decision.none; });

  var box, thread, headLabel;

  /* ---------- Стили (визуальный язык PO, но не копия) ---------- */
  function injectStyle() {
    if (document.getElementById("pulseSceneCss")) return;
    var css = document.createElement("style");
    css.id = "pulseSceneCss";
    css.textContent = [
      "body.pulse-scene-on #processing{display:none !important;}",
      "body.pulse-scene-on #visionResult{display:none !important;}",
      "#pulseScene{display:none;margin-top:16px;padding:18px 16px 16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card2);}",
      "#pulseScene.show{display:block;animation:viewIn .3s ease;}",
      ".ps-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:15px;}",
      ".ps-analyzing{display:inline-flex;align-items:center;gap:8px;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.14em;}",
      ".ps-adot{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:dotBlink 1.3s ease-in-out infinite;}",
      ".ps-bar{position:relative;height:3px;width:78px;border-radius:99px;background:var(--line);overflow:hidden;}",
      ".ps-bar span{position:absolute;top:0;left:-40%;width:40%;height:100%;border-radius:99px;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:scanMove 1.25s cubic-bezier(.45,0,.55,1) infinite;}",
      ".ps-thread{display:flex;flex-direction:column;gap:10px;}",
      ".ps-sys{position:relative;border:1px solid var(--line);border-radius:14px;padding:12px 14px 13px;background:var(--card);animation:psIn .34s cubic-bezier(.22,.9,.32,1) both;}",
      ".ps-sys-head{display:flex;align-items:center;gap:9px;margin-bottom:9px;}",
      ".ps-ic{flex:0 0 auto;width:30px;height:30px;border-radius:9px;overflow:hidden;border:1px solid var(--line);background:var(--card2);}",
      ".ps-ic img{width:100%;height:100%;object-fit:cover;display:block;}",
      ".ps-ic.dot{width:14px;height:14px;border-radius:50%;border:none;background:transparent;position:relative;}",
      ".ps-ic.dot::after{content:'';position:absolute;left:3px;top:3px;width:8px;height:8px;border-radius:50%;background:var(--muted);animation:dotBlink 1.4s ease-in-out infinite;}",
      ".ps-tag{font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--muted);}",
      ".ps-dir{margin-left:auto;font-size:12px;font-weight:800;letter-spacing:.06em;}",
      ".ps-body{font-size:15px;line-height:1.5;color:var(--text);}",
      ".ps-body.typing{display:inline-flex;gap:5px;padding:2px 0 4px;}",
      ".ps-body.typing i{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:dotBlink 1.1s ease-in-out infinite;}",
      ".ps-body.typing i:nth-child(2){animation-delay:.16s;}",
      ".ps-body.typing i:nth-child(3){animation-delay:.32s;}",
      ".ps-sys.sit{background:transparent;border-style:dashed;}",
      ".ps-sys.sit .ps-body{color:var(--muted);}",
      ".ps-sys.imp{border-left:3px solid var(--down);background:color-mix(in srgb,var(--down) 8%,var(--card));}",
      ".ps-sys.imp .ps-tag{color:var(--down);}",
      ".ps-sys.exp{border-left:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 8%,var(--card));}",
      ".ps-sys.exp .ps-tag{color:var(--accent);}",
      ".ps-sys.dec{padding:14px 15px 15px;margin-top:3px;}",
      ".ps-sys.dec .ps-body{font-size:16px;font-weight:600;}",
      ".ps-sys.dec.up{border-color:color-mix(in srgb,var(--up) 45%,var(--line));background:color-mix(in srgb,var(--up) 12%,var(--card));border-left:3px solid var(--up);}",
      ".ps-sys.dec.up .ps-tag,.ps-sys.dec.up .ps-dir{color:var(--up);}",
      ".ps-sys.dec.down{border-color:color-mix(in srgb,var(--down) 45%,var(--line));background:color-mix(in srgb,var(--down) 12%,var(--card));border-left:3px solid var(--down);}",
      ".ps-sys.dec.down .ps-tag,.ps-sys.dec.down .ps-dir{color:var(--down);}",
      ".ps-sys.dec.none{border-color:color-mix(in srgb,var(--muted) 30%,var(--line));background:color-mix(in srgb,var(--muted) 8%,var(--card));border-left:3px solid var(--muted);}",
      ".ps-sys.dec.none .ps-tag,.ps-sys.dec.none .ps-dir{color:var(--muted);}",
      ".ps-pause{align-self:center;color:var(--muted);font-size:20px;letter-spacing:4px;padding:2px 0;animation:psIn .3s ease both;}",
      "@keyframes psIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}"
    ].join("");
    document.head.appendChild(css);
  }

  function build() {
    if (box) return true;
    var proc = document.getElementById("processing");
    if (!proc || !proc.parentNode) return false;
    box = document.createElement("div");
    box.id = "pulseScene";
    box.innerHTML =
      '<div class="ps-head">' +
        '<span class="ps-analyzing"><span class="ps-adot"></span><span id="psHead"></span></span>' +
        '<span class="ps-bar"><span></span></span>' +
      '</div>' +
      '<div class="ps-thread" id="psThread"></div>';
    proc.parentNode.insertBefore(box, proc);
    thread = box.querySelector("#psThread");
    headLabel = box.querySelector("#psHead");
    return true;
  }

  function autoscroll() { if (box) box.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  function typingMs(t) { return Math.min(850, 240 + String(t).length * 15); }
  function readMs(t) { return Math.min(1700, 520 + String(t).length * 18); }

  /* ---------- Отрисовка одного системного блока ---------- */
  function showBlock(block, myGen) {
    return new Promise(function (resolve) {
      if (myGen !== S.gen) return resolve();
      if (block.pause) {
        var p = document.createElement("div");
        p.className = "ps-pause";
        p.textContent = "•  •  •";
        thread.appendChild(p);
        autoscroll();
        return wait(1000).then(resolve);
      }
      var L = LIB[lang()];
      var kind = block.kind;
      var tagKey = kind === "imp" ? "dop" : (kind === "exp" ? "opy" : kind);
      var tagText = L.tag[tagKey] || "";
      var iconHtml = block.who
        ? '<span class="ps-ic"><img src="' + FACE[block.who] + '" alt="" draggable="false"></span>'
        : '<span class="ps-ic dot"></span>';
      var dirHtml = "";
      var cls = "ps-sys " + kind;
      if (kind === "dec") {
        var dir = block.dir || "none";
        cls += " " + dir;
        var am = ARROW[lang()] || ARROW.en;
        dirHtml = '<span class="ps-dir">' + esc(am[dir] || "") + '</span>';
      }
      var el = document.createElement("div");
      el.className = cls;
      el.innerHTML =
        '<div class="ps-sys-head">' + iconHtml + '<span class="ps-tag">' + esc(tagText) + '</span>' + dirHtml + '</div>' +
        '<div class="ps-body typing"><i></i><i></i><i></i></div>';
      thread.appendChild(el);
      autoscroll();
      var body = el.querySelector(".ps-body");
      wait(typingMs(block.text)).then(function () {
        if (myGen !== S.gen) return resolve();
        body.classList.remove("typing");
        body.innerHTML = esc(block.text).replace(/\n/g, "<br>");
        autoscroll();
        return wait(readMs(block.text)).then(resolve);
      });
    });
  }

  /* ---------- Драйвер: ситуация -> импульс -> проверка -> (напряжение) -> решение ---------- */
  function driver(myGen) {
    showBlock({ kind: "sit", text: pickSituation() || "" }, myGen)
      .then(function () {
        if (myGen !== S.gen) return;
        return showBlock({ kind: "imp", who: DOP, text: pickImpulse() || "" }, myGen);
      })
      .then(function () {
        if (myGen !== S.gen) return;
        return showBlock({ kind: "exp", who: OPY, text: pickCheck() || "" }, myGen);
      })
      .then(function loop() {
        if (myGen !== S.gen) return;
        if (S.resolving) return finale(myGen);
        return wait(400).then(function () {
          if (myGen !== S.gen) return;
          if (S.resolving) return finale(myGen);
          var t = pickTension() || { imp: "", exp: "" };
          return showBlock({ kind: "imp", who: DOP, text: t.imp }, myGen).then(function () {
            if (myGen !== S.gen || S.resolving) return;
            return showBlock({ kind: "exp", who: OPY, text: t.exp }, myGen);
          }).then(loop);
        });
      });
  }

  function finale(myGen) {
    if (myGen !== S.gen || S.inResolve) return;
    S.inResolve = true;
    var dec = S.dir === "up" ? pickUp() : (S.dir === "down" ? pickDown() : pickNone());
    showBlock({ kind: "dec", dir: S.dir, text: dec || "" }, myGen)
      .then(function () { return wait(800); })
      .then(function () { if (myGen !== S.gen) return; reveal(); });
  }

  /* ---------- Публичное управление ---------- */
  function start() {
    if (S.running) return;
    injectStyle();
    if (!build()) return;
    S.gen++;
    S.running = true; S.resolving = false; S.inResolve = false; S.dir = "none";
    thread.innerHTML = "";
    headLabel.textContent = LIB[lang()].head;
    document.body.classList.add("pulse-scene-on");
    box.classList.add("show");
    autoscroll();
    driver(S.gen);
  }

  function resolveWith(dir) {
    if (!S.running || S.resolving) return;
    S.dir = (dir === "up" || dir === "down") ? dir : "none";
    S.resolving = true;
  }

  function reveal() {
    S.running = false; S.resolving = false; S.inResolve = false;
    document.body.classList.remove("pulse-scene-on");
    if (box) box.classList.remove("show");
    var vr = document.getElementById("visionResult");
    if (vr) vr.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ---------- Само-подключение через наблюдение за DOM ---------- */
  function dirFromResult() {
    var d = document.getElementById("visionDir");
    if (!d) return "none";
    if (d.classList.contains("up")) return "up";
    if (d.classList.contains("down")) return "down";
    return "none";
  }

  function wire() {
    var proc = document.getElementById("processing");
    var res = document.getElementById("visionResult");
    if (!proc || !res) { return setTimeout(wire, 400); }

    new MutationObserver(function () {
      if (proc.classList.contains("show") && !S.running) start();
    }).observe(proc, { attributes: true, attributeFilter: ["class"] });

    new MutationObserver(function () {
      if (res.classList.contains("show") && S.running) resolveWith(dirFromResult());
    }).observe(res, { attributes: true, attributeFilter: ["class"] });

    if (proc.classList.contains("show") && !S.running) start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }

  window.PulseScene = { start: start, resolve: resolveWith };
})();