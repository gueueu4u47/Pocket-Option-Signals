/*
 * Signal Pulse — «Сцена»
 * Дофамин и Опыт во время анализа графика.
 * Реализовано строго по Библии проекта:
 *  - ожидание = не прогресс-бар, а мини-спектакль (Гл. 9, 24, 25);
 *  - диалог подстраивается под анализ, анализ не ждёт диалог (Гл. 18);
 *  - сцена собирается из вариантов, повторов почти нет (Гл. 19, 37);
 *  - оба могут вести, они любят друг друга, никакого жаргона (Гл. 2, 6, 7, 12);
 *  - тишина — тоже реплика (Гл. 15, 28);
 *  - никогда не унижаем пользователя (Гл. 33).
 *
 * Файл самодостаточен и сам подключается к существующему Vision-флоу через
 * наблюдение за DOM. Ничего в основном коде вызывать не нужно — только
 * подключить этот файл: <script src="scene.js"></script>
 */
(function () {
  "use strict";

  /* ---------- Персонажи ---------- */
  var DOP = "dop"; // Дофамин  🐒
  var OPY = "opy"; // Опыт     🧠
  var FACE = { dop: "data:image/webp;base64,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", opy: "data:image/webp;base64,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" };
  var NAME = {
    ru: { dop: "ДОФАМИН", opy: "ОПЫТ" },
    en: { dop: "DOPAMINE", opy: "EXPERIENCE" }
  };
  var HEAD = { ru: "АНАЛИЗ ГРАФИКА", en: "ANALYZING CHART" };

  /* ---------- Библиотека реплик ----------
     Реплика: { who, text } | { pause:true }
     Бит (сцена-кусок): массив реплик. */
  var LIB = {
    ru: {
      intro: [
        [{ who: DOP, text: "Так. Стоп. Ты это видел?" }, { who: OPY, text: "Видел. Поэтому и не дёргаюсь." }],
        [{ who: DOP, text: "О-о... вот это уже интересно." }, { who: OPY, text: "Интересно — ещё не значит пора." }],
        [{ who: DOP, text: "Смотри, смотри. Оно же само просится." }, { who: OPY, text: "Само просится обычно то, о чём потом жалеешь." }],
        [{ who: DOP, text: "У меня аж зачесалось." }, { who: OPY, text: "У тебя всегда чешется. Дыши." }],
        [{ who: DOP, text: "Красиво, а?" }, { who: OPY, text: "Красиво. Вот этого я и опасаюсь." }],
        [{ who: DOP, text: "Ну что, залетаем?" }, { who: OPY, text: "Мы даже толком не посмотрели. Секунду." }],
        [{ who: DOP, text: "Я уже почти решил." }, { who: OPY, text: "Ты решил ещё до того, как открыл. Давай всё-таки глянем." }],
        [{ who: DOP, text: "Слушай... а ты сегодня тихий." }, { who: OPY, text: "Просто смотрю. Иногда это важнее слов." }]
      ],
      middle: [
        [{ who: DOP, text: "Ну сколько можно ждать." }, { who: OPY, text: "Ровно столько, сколько нужно." }],
        [{ who: DOP, text: "А вдруг уйдёт без нас?" }, { who: OPY, text: "Значит это был не наш поезд." }],
        [{ who: OPY, text: "Ты заметил, как быстро ты загорелся?" }, { who: DOP, text: "А ты как всегда — сначала сомнение." }],
        [{ who: DOP, text: "Мне уже нравится." }, { who: OPY, text: "Тебе всё нравится, пока не проверено." }],
        [{ who: OPY, text: "Помолчим секунду. Просто посмотрим." }, { who: DOP, text: "Ты знаешь, что мне это тяжело." }],
        [{ who: DOP, text: "Оно живое, чувствуешь?" }, { who: OPY, text: "Чувствую. Поэтому и осторожно." }],
        [{ who: DOP, text: "Один раз живём." }, { who: OPY, text: "И желательно подольше." }],
        [{ who: OPY, text: "Я не против тебя. Я за то, чтобы ты дошёл." }, { who: DOP, text: "Знаю. Поэтому и слушаю." }],
        [{ who: DOP, text: "Хоть намекни, что думаешь." }, { who: OPY, text: "Думаю, ты уже придумал за нас двоих." }],
        [{ who: OPY, text: "Тут есть одна деталь..." }, { who: DOP, text: "Ты всегда находишь одну деталь." }],
        [{ who: DOP, text: "Давай по-быстрому." }, { who: OPY, text: "По-быстрому мы потом дольше всего разгребаем." }],
        [{ who: DOP, text: "Я не тороплю." }, { who: OPY, text: "Ты только это и делаешь." }]
      ],
      up: [
        [{ who: DOP, text: "Вот! Я же чувствовал." }, { who: OPY, text: "Ладно. Идём — но по плану." }, { who: DOP, text: "По плану так по плану." }],
        [{ who: OPY, text: "Хорошо. Здесь я с тобой." }, { who: DOP, text: "Запиши дату." }, { who: OPY, text: "Не начинай." }],
        [{ who: DOP, text: "Ну что, погнали?" }, { who: OPY, text: "Погнали. Только без геройства." }],
        [{ who: OPY, text: "Сторона выбрана. Не спорю." }, { who: DOP, text: "Иногда и я бываю прав." }, { who: OPY, text: "Иногда." }]
      ],
      down: [
        [{ who: OPY, text: "Вот сюда я бы и смотрел." }, { who: DOP, text: "Ммм... ладно, вижу." }],
        [{ who: DOP, text: "Не туда, куда я хотел, да?" }, { who: OPY, text: "Не туда. Но честно." }, { who: DOP, text: "Честно — уже неплохо." }],
        [{ who: OPY, text: "Сторона понятна." }, { who: DOP, text: "Обидно, но принято." }],
        [{ who: DOP, text: "Я бы рискнул наоборот." }, { who: OPY, text: "Знаю. Поэтому сегодня — за мной." }, { who: DOP, text: "Ладно, старик." }]
      ],
      none: [
        [{ pause: true }, { who: DOP, text: "...ничего?" }, { who: OPY, text: "Ничего. И это тоже ответ." }],
        [{ who: OPY, text: "Сегодня — мимо." }, { who: DOP, text: "Молчу." }],
        [{ who: DOP, text: "Оба молчим?" }, { who: OPY, text: "Оба." }, { pause: true }],
        [{ pause: true }, { who: DOP, text: "Тут не наше." }, { who: OPY, text: "Согласен." }]
      ]
    },
    en: {
      intro: [
        [{ who: DOP, text: "Wait. You seeing this?" }, { who: OPY, text: "I see it. That's why I'm not moving yet." }],
        [{ who: DOP, text: "Oh, now that's interesting." }, { who: OPY, text: "Interesting isn't the same as ready." }],
        [{ who: DOP, text: "Come on, it's basically asking us." }, { who: OPY, text: "What asks loudest we regret most." }],
        [{ who: DOP, text: "Let's just go." }, { who: OPY, text: "We haven't even looked. One second." }],
        [{ who: DOP, text: "Pretty, huh?" }, { who: OPY, text: "Pretty is exactly what worries me." }],
        [{ who: DOP, text: "I've almost decided." }, { who: OPY, text: "You decided before you opened it. Let's look anyway." }]
      ],
      middle: [
        [{ who: DOP, text: "How long do we wait?" }, { who: OPY, text: "Exactly as long as it takes." }],
        [{ who: DOP, text: "What if it leaves without us?" }, { who: OPY, text: "Then it wasn't our train." }],
        [{ who: OPY, text: "Notice how fast you lit up?" }, { who: DOP, text: "And you — doubt first, as always." }],
        [{ who: DOP, text: "I like it already." }, { who: OPY, text: "You like everything until it's checked." }],
        [{ who: DOP, text: "We only live once." }, { who: OPY, text: "Preferably for a while." }],
        [{ who: OPY, text: "There's one detail here..." }, { who: DOP, text: "You always find one detail." }],
        [{ who: OPY, text: "I'm not against you. I want you to make it." }, { who: DOP, text: "I know. That's why I listen." }],
        [{ who: DOP, text: "Just a hint of what you think?" }, { who: OPY, text: "I think you already decided for both of us." }]
      ],
      up: [
        [{ who: DOP, text: "There! I felt it." }, { who: OPY, text: "Fine. We go — but by the plan." }, { who: DOP, text: "By the plan it is." }],
        [{ who: OPY, text: "Alright. I'm with you here." }, { who: DOP, text: "Mark the date." }, { who: OPY, text: "Don't." }],
        [{ who: DOP, text: "So, we go?" }, { who: OPY, text: "We go. No heroics." }]
      ],
      down: [
        [{ who: OPY, text: "This is where I'd look." }, { who: DOP, text: "Mmm... okay, I see it." }],
        [{ who: DOP, text: "Not where I wanted, huh?" }, { who: OPY, text: "No. But honest." }, { who: DOP, text: "Honest works." }],
        [{ who: OPY, text: "The side is clear." }, { who: DOP, text: "Stings, but noted." }]
      ],
      none: [
        [{ pause: true }, { who: DOP, text: "...nothing?" }, { who: OPY, text: "Nothing. That's an answer too." }],
        [{ who: OPY, text: "Not today." }, { who: DOP, text: "Quiet." }],
        [{ who: DOP, text: "Both silent?" }, { who: OPY, text: "Both." }, { pause: true }]
      ]
    }
  };

  /* ---------- Утилиты ---------- */
  function lang() {
    var l = (document.documentElement.getAttribute("lang") || "ru").slice(0, 2);
    return LIB[l] ? l : "en";
  }
  function names() { return NAME[lang()] || NAME.en; }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* Случайный неповторяющийся выбор из набора (Гл. 37: без повторов). */
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

  /* ---------- Состояние сцены ---------- */
  var S = {
    gen: 0, running: false, resolving: false, inResolve: false,
    dir: "none", cb: null
  };
  var pickIntro = Picker(function () { return LIB[lang()].intro; });
  var pickMiddle = Picker(function () { return LIB[lang()].middle; });
  var pickUp = Picker(function () { return LIB[lang()].up; });
  var pickDown = Picker(function () { return LIB[lang()].down; });
  var pickNone = Picker(function () { return LIB[lang()].none; });

  var box, thread, headLabel;

  /* ---------- Разметка + стили ---------- */
  function injectStyle() {
    if (document.getElementById("pulseSceneCss")) return;
    var css = document.createElement("style");
    css.id = "pulseSceneCss";
    css.textContent = [
      "body.pulse-scene-on #processing{display:none !important;}",
      "body.pulse-scene-on #visionResult{display:none !important;}",
      "#pulseScene{display:none;margin-top:16px;padding:16px 14px 14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card2);}",
      "#pulseScene.show{display:block;animation:viewIn .3s ease;}",
      ".ps-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}",
      ".ps-analyzing{display:inline-flex;align-items:center;gap:7px;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.12em;}",
      ".ps-adot{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:dotBlink 1.3s ease-in-out infinite;}",
      ".ps-bar{position:relative;height:3px;width:88px;border-radius:99px;background:var(--line);overflow:hidden;}",
      ".ps-bar span{position:absolute;top:0;left:-40%;width:40%;height:100%;border-radius:99px;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:scanMove 1.25s cubic-bezier(.45,0,.55,1) infinite;}",
      ".ps-thread{display:flex;flex-direction:column;gap:12px;}",
      ".ps-row{display:flex;align-items:flex-end;gap:10px;animation:psIn .34s cubic-bezier(.22,.9,.32,1) both;}",
      ".ps-row.dop{flex-direction:row;}",
      ".ps-row.opy{flex-direction:row-reverse;}",
      ".ps-av{flex:0 0 auto;width:40px;display:flex;flex-direction:column;align-items:center;}",
      ".ps-face{width:40px;height:40px;border-radius:50%;overflow:hidden;border:1px solid var(--line);background:var(--card);}",
      ".ps-face img{width:100%;height:100%;object-fit:cover;display:block;}",
      ".ps-name{margin-top:3px;font-size:8px;font-weight:800;letter-spacing:.05em;}",
      ".ps-row.dop .ps-name{color:var(--down);}",
      ".ps-row.opy .ps-name{color:var(--accent);}",
      ".ps-bubble{max-width:74%;padding:10px 13px;border-radius:16px;font-size:14px;line-height:1.42;color:var(--text);}",
      ".ps-row.dop .ps-bubble{border:1px solid color-mix(in srgb,var(--down) 42%,var(--line));background:color-mix(in srgb,var(--down) 13%,var(--card));border-bottom-left-radius:5px;}",
      ".ps-row.opy .ps-bubble{border:1px solid var(--line);background:var(--card);border-bottom-right-radius:5px;}",
      ".ps-bubble.typing{display:inline-flex;gap:5px;padding:14px 15px;}",
      ".ps-bubble.typing i{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:dotBlink 1.1s ease-in-out infinite;}",
      ".ps-bubble.typing i:nth-child(2){animation-delay:.16s;}",
      ".ps-bubble.typing i:nth-child(3){animation-delay:.32s;}",
      ".ps-pause{align-self:center;color:var(--muted);font-size:22px;letter-spacing:4px;padding:2px 0;animation:psIn .3s ease both;}",
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

  /* ---------- Отрисовка одной реплики ---------- */
  function rowEl(who) {
    var nm = names();
    var row = document.createElement("div");
    row.className = "ps-row " + who;
    row.innerHTML =
      '<div class="ps-av"><div class="ps-face"><img src="' + FACE[who] + '" alt="" draggable="false"></div>' +
      '<div class="ps-name">' + esc(nm[who]) + '</div></div>' +
      '<div class="ps-bubble typing"><i></i><i></i><i></i></div>';
    return row;
  }
  function autoscroll() {
    if (box) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function typingMs(text) { return Math.min(1100, 340 + text.length * 20); }
  function readMs(text) { return Math.min(1700, 640 + text.length * 34); }

  function showLine(line, myGen) {
    return new Promise(function (resolve) {
      if (myGen !== S.gen) return resolve();
      if (line.pause) {
        var p = document.createElement("div");
        p.className = "ps-pause";
        p.textContent = "•  •  •";
        thread.appendChild(p);
        autoscroll();
        return wait(1150).then(resolve);
      }
      var row = rowEl(line.who);
      thread.appendChild(row);
      autoscroll();
      var bubble = row.querySelector(".ps-bubble");
      wait(typingMs(line.text)).then(function () {
        if (myGen !== S.gen) return resolve();
        bubble.classList.remove("typing");
        bubble.innerHTML = esc(line.text).replace(/\n/g, "<br>");
        autoscroll();
        return wait(readMs(line.text)).then(resolve);
      });
    });
  }

  function playBeat(beat, myGen, bailOnResolve) {
    var i = 0;
    function step() {
      if (myGen !== S.gen) return Promise.resolve();
      if (bailOnResolve && S.resolving) return Promise.resolve();
      if (i >= beat.length) return Promise.resolve();
      var line = beat[i++];
      return showLine(line, myGen).then(step);
    }
    return step();
  }

  function pickResolve() {
    if (S.dir === "up") return pickUp();
    if (S.dir === "down") return pickDown();
    return pickNone();
  }

  /* ---------- Драйвер сцены (Гл. 18: диалог подстраивается под анализ) ---------- */
  function driver(myGen) {
    var intro = pickIntro() || [];
    playBeat(intro, myGen, false).then(function loop() {
      if (myGen !== S.gen) return;
      if (S.resolving) return finale(myGen);
      return wait(480).then(function () {
        if (myGen !== S.gen) return;
        if (S.resolving) return finale(myGen);
        var mid = pickMiddle() || [];
        return playBeat(mid, myGen, true).then(loop);
      });
    });
  }

  function finale(myGen) {
    if (myGen !== S.gen || S.inResolve) return;
    S.inResolve = true;
    var beat = pickResolve() || [];
    playBeat(beat, myGen, false).then(function () {
      return wait(700);
    }).then(function () {
      if (myGen !== S.gen) return;
      reveal();
    });
  }

  /* ---------- Публичное управление (используется наблюдателем) ---------- */
  function start() {
    if (S.running) return;
    injectStyle();
    if (!build()) return;
    S.gen++;
    S.running = true; S.resolving = false; S.inResolve = false; S.dir = "none"; S.cb = null;
    thread.innerHTML = "";
    headLabel.textContent = HEAD[lang()] || HEAD.en;
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

  /* ---------- Само-подключение через наблюдение за DOM ----------
     Никаких правок в основном коде: следим за появлением процессинга
     и готового результата Vision. Направление читаем из класса #visionDir
     (r-dir up|down|none) — это не зависит от языка интерфейса. */
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

    // На случай, если процессинг уже активен к моменту подключения.
    if (proc.classList.contains("show") && !S.running) start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }

  /* Небольшой мостик наружу — на случай, если позже захочется явных вызовов. */
  window.PulseScene = { start: start, resolve: resolveWith };
})();