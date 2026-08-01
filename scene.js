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
  var FACE = { dop: "\uD83D\uDC12", opy: "\uD83E\uDDE0" };
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
      ".ps-face{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-size:21px;border:1px solid var(--line);background:var(--card);}",
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
      '<div class="ps-av"><div class="ps-face">' + FACE[who] + '</div>' +
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
