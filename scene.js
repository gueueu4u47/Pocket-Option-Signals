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
  "ru": {
    "intro": [
      [
        {
          "who": "dop",
          "text": "Осо, смотри какой импульс!\nЩас как заскочим 🚀\nСвеча просто конфетка!"
        },
        {
          "who": "opy",
          "text": "Не спеши, обезьяна.\nВерхняя зона сильная.\nСначала подтверждение."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Ну красота же!\nТело свечи — как ракета 🚀"
        },
        {
          "who": "opy",
          "text": "Красиво.\nВот это меня и напрягает."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Так, я всё.\nЯ в деле, погнали!"
        },
        {
          "who": "opy",
          "text": "Ты «в деле» ещё до того,\nкак открыл график."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Чувствуешь, как разгоняется? 🔥"
        },
        {
          "who": "opy",
          "text": "Чувствую.\nПоэтому и смотрю на объём."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Не тормози, дед!\nУпустим же!"
        },
        {
          "who": "opy",
          "text": "Что должно уйти —\nто без нас не наше."
        }
      ]
    ],
    "middle": [
      [
        {
          "who": "dop",
          "text": "Ну сколько можно пялиться?"
        },
        {
          "who": "opy",
          "text": "Ровно до того,\nкак станет ясно."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Импульс!\nОбъём!\nВсё сходится!"
        },
        {
          "who": "opy",
          "text": "Импульс вижу.\nОбъём — так себе.\nДыши."
        }
      ],
      [
        {
          "who": "opy",
          "text": "Тут есть деталь."
        },
        {
          "who": "dop",
          "text": "Ты всегда находишь деталь 🙄"
        },
        {
          "who": "opy",
          "text": "Поэтому ты ещё цел."
        }
      ],
      [
        {
          "who": "dop",
          "text": "А если рванёт без нас?!"
        },
        {
          "who": "opy",
          "text": "Значит это был\nне наш поезд."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Ладно, смотрю.\nНо сердце уже там 😎"
        },
        {
          "who": "opy",
          "text": "Сердце оставь.\nБери голову."
        }
      ],
      [
        {
          "who": "opy",
          "text": "Верхняя зона держит."
        },
        {
          "who": "dop",
          "text": "Пока держит.\nА вдруг проколет? 👀"
        },
        {
          "who": "opy",
          "text": "Вот и ждём прокол."
        }
      ]
    ],
    "up": [
      [
        {
          "who": "dop",
          "text": "Ну?!\nЯ ГОВОРИЛ! 🚀"
        },
        {
          "who": "opy",
          "text": "Говорил.\nВходим — но по плану."
        },
        {
          "who": "dop",
          "text": "По плану, по плану 😎"
        }
      ],
      [
        {
          "who": "opy",
          "text": "Ладно.\nЗдесь я с тобой."
        },
        {
          "who": "dop",
          "text": "Запиши дату!"
        },
        {
          "who": "opy",
          "text": "Не начинай."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Вверх, вверх, вверх! 🔥"
        },
        {
          "who": "opy",
          "text": "Вверх.\nТолько без геройства, обезьяна."
        }
      ],
      [
        {
          "who": "opy",
          "text": "Если пойдёт —\nя первый зайду.\nНо по плану. Всегда."
        },
        {
          "who": "dop",
          "text": "Вот теперь ты мне нравишься 😎"
        }
      ]
    ],
    "down": [
      [
        {
          "who": "opy",
          "text": "Вот сюда бы я и смотрел.\nВниз."
        },
        {
          "who": "dop",
          "text": "Вниз так вниз."
        },
        {
          "who": "opy",
          "text": "Зато честно."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Не туда, куда я хотел, да?"
        },
        {
          "who": "opy",
          "text": "Не туда.\nЗато туда, где правда."
        },
        {
          "who": "dop",
          "text": "Ух... принято."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Я бы рискнул наоборот!"
        },
        {
          "who": "opy",
          "text": "Знаю.\nСегодня — за мной, обезьяна."
        },
        {
          "who": "dop",
          "text": "Ладно, дед."
        }
      ],
      [
        {
          "who": "opy",
          "text": "Сторона понятна.\nЭто низ."
        },
        {
          "who": "dop",
          "text": "Обидно.\nНо вижу 👀"
        }
      ]
    ],
    "none": [
      [
        {
          "pause": true
        },
        {
          "who": "dop",
          "text": "...чё, вообще ничего? 😐"
        },
        {
          "who": "opy",
          "text": "Сегодня можно\nи не решать."
        }
      ],
      [
        {
          "who": "dop",
          "text": "А выглядело как конфетка..."
        },
        {
          "who": "opy",
          "text": "Выглядело.\nЗначит сегодня просто смотрим."
        }
      ],
      [
        {
          "pause": true
        },
        {
          "who": "dop",
          "text": "Оба молчим?"
        },
        {
          "who": "opy",
          "text": "Оба."
        },
        {
          "pause": true
        }
      ],
      [
        {
          "who": "opy",
          "text": "Рынок сегодня\nсильнее нашей задумки."
        },
        {
          "who": "dop",
          "text": "Тогда переждём.\nНо я слежу 👀"
        }
      ]
    ]
  },
  "en": {
    "intro": [
      [
        {
          "who": "dop",
          "text": "Yo, look at that push!\nWe're jumping in 🚀\nThat candle's candy!"
        },
        {
          "who": "opy",
          "text": "Slow down, monkey.\nThe top zone is strong.\nConfirmation first."
        }
      ],
      [
        {
          "who": "dop",
          "text": "It's beautiful!\nBody's like a rocket 🚀"
        },
        {
          "who": "opy",
          "text": "Beautiful.\nThat's exactly what worries me."
        }
      ],
      [
        {
          "who": "dop",
          "text": "That's it, I'm in.\nLet's gooo!"
        },
        {
          "who": "opy",
          "text": "You were 'in' before\nyou even opened the chart."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Feel it speeding up? 🔥"
        },
        {
          "who": "opy",
          "text": "I feel it.\nThat's why I watch the volume."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Don't stall, old man!\nWe'll miss it!"
        },
        {
          "who": "opy",
          "text": "What's meant to leave\nwasn't ours anyway."
        }
      ]
    ],
    "middle": [
      [
        {
          "who": "dop",
          "text": "How long do we stare?"
        },
        {
          "who": "opy",
          "text": "Right up until\nit gets clear."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Impulse!\nVolume!\nIt all lines up!"
        },
        {
          "who": "opy",
          "text": "Impulse, yes.\nVolume, meh.\nBreathe."
        }
      ],
      [
        {
          "who": "opy",
          "text": "There's a detail here."
        },
        {
          "who": "dop",
          "text": "You always find a detail 🙄"
        },
        {
          "who": "opy",
          "text": "That's why you're still alive."
        }
      ],
      [
        {
          "who": "dop",
          "text": "What if it flies without us?!"
        },
        {
          "who": "opy",
          "text": "Then it wasn't\nour train."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Fine, I'm watching.\nBut my heart's already there 😎"
        },
        {
          "who": "opy",
          "text": "Leave the heart.\nBring the head."
        }
      ]
    ],
    "up": [
      [
        {
          "who": "dop",
          "text": "Well?!\nI TOLD you! 🚀"
        },
        {
          "who": "opy",
          "text": "You did.\nWe go — by the plan."
        },
        {
          "who": "dop",
          "text": "By the plan, by the plan 😎"
        }
      ],
      [
        {
          "who": "opy",
          "text": "Alright.\nI'm with you here."
        },
        {
          "who": "dop",
          "text": "Mark the date!"
        },
        {
          "who": "opy",
          "text": "Don't."
        }
      ],
      [
        {
          "who": "opy",
          "text": "If it goes —\nI'm first in.\nBut by the plan. Always."
        },
        {
          "who": "dop",
          "text": "Now I like you 😎"
        }
      ]
    ],
    "down": [
      [
        {
          "who": "opy",
          "text": "This is where I'd look.\nDown."
        },
        {
          "who": "dop",
          "text": "Down it is."
        },
        {
          "who": "opy",
          "text": "But honest."
        }
      ],
      [
        {
          "who": "dop",
          "text": "Not where I wanted, huh?"
        },
        {
          "who": "opy",
          "text": "Nope.\nBut where the truth is."
        },
        {
          "who": "dop",
          "text": "...noted."
        }
      ],
      [
        {
          "who": "dop",
          "text": "I'd risk the opposite!"
        },
        {
          "who": "opy",
          "text": "I know.\nToday you follow me, monkey."
        },
        {
          "who": "dop",
          "text": "Fine, old man."
        }
      ]
    ],
    "none": [
      [
        {
          "pause": true
        },
        {
          "who": "dop",
          "text": "...wait, nothing? 😐"
        },
        {
          "who": "opy",
          "text": "Today you can\nnot decide."
        }
      ],
      [
        {
          "who": "dop",
          "text": "But it looked like candy..."
        },
        {
          "who": "opy",
          "text": "It did.\nSo today we just watch."
        }
      ],
      [
        {
          "pause": true
        },
        {
          "who": "dop",
          "text": "Both quiet?"
        },
        {
          "who": "opy",
          "text": "Both."
        },
        {
          "pause": true
        }
      ]
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
      ".ps-row{display:flex;align-items:flex-start;gap:10px;animation:psIn .34s cubic-bezier(.22,.9,.32,1) both;}",
      ".ps-row.dop{flex-direction:row;}",
      ".ps-row.opy{flex-direction:row-reverse;}",
      ".ps-av{flex:0 0 auto;width:56px;display:flex;flex-direction:column;align-items:center;}",
      ".ps-face{width:56px;height:56px;border-radius:16px;overflow:hidden;border:1px solid var(--line);background:var(--card);}",
      ".ps-face img{width:100%;height:100%;object-fit:cover;display:block;}",
      ".ps-name{margin-top:5px;font-size:9px;font-weight:800;letter-spacing:.05em;}",
      ".ps-row.dop .ps-name{color:var(--down);}",
      ".ps-row.opy .ps-name{color:var(--accent);}",
      ".ps-bubble{max-width:78%;padding:12px 15px;border-radius:18px;font-size:15px;line-height:1.5;color:var(--text);}",
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

  function typingMs(text) { return Math.min(1300, 360 + text.length * 22); }
  function readMs(text) { return Math.min(2300, 700 + text.length * 30); }

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