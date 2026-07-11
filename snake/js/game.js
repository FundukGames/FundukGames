/*
 * Snake — canvas arcade with a Funduk twist: you're a squirrel-snake eating
 * nuts. Classic mode is a clean field; the Daily seeds the same wall layout
 * and nut sequence for everyone. Arrow keys / WASD / swipes; speeds up as
 * you grow. Eat 15 nuts on the Daily to keep your streak.
 */
(function () {
  "use strict";

  var N = 19; // grid size
  var BASE_TPS = 7.5, TPS_PER_NUT = 0.16, MAX_TPS = 15;
  var DAILY_GOAL = 15;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dailySeed() { var d = new Date(); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); }
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function todayKey(date) { var d = date || new Date(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function yesterdayKey() { var d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return todayKey(d); }

  var els = {};
  var state = null; // { snake, dir, queue, walls:Set, nut, score, mode, rng, phase, tps, acc }
  var rafId = null, lastTs = 0;

  function loadStats() {
    return { best: LS.get("sn_best", 0), bestDaily: LS.get("sn_bestDaily", 0), streak: LS.get("sn_streak", 0), lastDaily: LS.get("sn_lastDaily", null) };
  }
  function renderStats() {
    var s = loadStats();
    els.statBest.textContent = s.best;
    els.statStreak.textContent = s.streak;
    els.statDaily.textContent = s.bestDaily || "—";
  }

  function key(x, y) { return x + "," + y; }

  function makeWalls(rng) {
    // symmetric wall seeds away from the center row where the snake spawns
    var walls = new Set();
    var tries = 0;
    while (walls.size < 20 && tries++ < 300) {
      var x = 2 + Math.floor(rng() * (N - 4));
      var y = 2 + Math.floor(rng() * (N - 4));
      if (Math.abs(y - Math.floor(N / 2)) < 2) continue; // spawn corridor stays clear
      walls.add(key(x, y));
      walls.add(key(N - 1 - x, N - 1 - y));
    }
    return walls;
  }

  function newGame(mode) {
    stopLoop();
    var rng = mode === "daily" ? mulberry32(dailySeed() + 23) : Math.random;
    var cy = Math.floor(N / 2);
    state = {
      snake: [{ x: 5, y: cy }, { x: 4, y: cy }, { x: 3, y: cy }],
      dir: { x: 1, y: 0 },
      queue: [],
      walls: mode === "daily" ? makeWalls(rng) : new Set(),
      nut: null,
      score: 0, mode: mode, rng: rng,
      phase: "ready", tps: BASE_TPS, acc: 0
    };
    spawnNut();
    els.modeLabel.textContent = mode === "daily" ? "Daily · " + todayKey() : "Classic";
    els.score.textContent = "🌰 0";
    hideModal();
    setMessage(mode === "daily" ? "Same maze and nuts for everyone today. " + DAILY_GOAL + " nuts keep the streak!" : "Press a key or swipe to start.", "");
    renderStats();
    draw();
  }

  function spawnNut() {
    var occupied = new Set(state.walls);
    state.snake.forEach(function (s) { occupied.add(key(s.x, s.y)); });
    var spots = [];
    for (var x = 0; x < N; x++)
      for (var y = 0; y < N; y++)
        if (!occupied.has(key(x, y))) spots.push({ x: x, y: y });
    if (!spots.length) { winField(); return; }
    state.nut = spots[Math.floor(state.rng() * spots.length)];
  }

  function setDir(dx, dy) {
    if (!state || state.phase === "over") return;
    if (state.phase === "ready") { state.phase = "run"; startLoop(); }
    if (state.phase === "paused") togglePause();
    var last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
    if (last.x === dx && last.y === dy) return;
    if (last.x === -dx && last.y === -dy) return; // no instant reversal
    if (state.queue.length < 2) state.queue.push({ x: dx, y: dy });
  }

  function step() {
    if (state.queue.length) state.dir = state.queue.shift();
    var head = state.snake[0];
    var nx = head.x + state.dir.x, ny = head.y + state.dir.y;
    if (nx < 0 || nx >= N || ny < 0 || ny >= N || state.walls.has(key(nx, ny))) { die(); return; }
    for (var i = 0; i < state.snake.length - 1; i++)
      if (state.snake[i].x === nx && state.snake[i].y === ny) { die(); return; }
    state.snake.unshift({ x: nx, y: ny });
    if (state.nut && nx === state.nut.x && ny === state.nut.y) {
      state.score++;
      state.tps = Math.min(MAX_TPS, state.tps + TPS_PER_NUT);
      els.score.textContent = "🌰 " + state.score;
      if (state.mode === "daily" && state.score === DAILY_GOAL) creditDaily();
      spawnNut();
    } else {
      state.snake.pop();
    }
  }

  function creditDaily() {
    var stats = loadStats();
    var tk = todayKey();
    if (stats.lastDaily !== tk) {
      stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1;
      stats.lastDaily = tk;
      LS.set("sn_streak", stats.streak); LS.set("sn_lastDaily", stats.lastDaily);
      renderStats();
      setMessage(DAILY_GOAL + " nuts — streak +1 🔥 Keep going!", "ok");
    }
  }

  function die() {
    state.phase = "over";
    stopLoop();
    saveScore();
    draw();
    var s = loadStats();
    showModal("Game over 🌰", "You ate " + state.score + " nuts" + (state.mode === "daily" ? " · daily best " + s.bestDaily : " · best " + s.best));
  }
  function winField() {
    state.phase = "over";
    stopLoop();
    saveScore();
    showModal("You filled the field! 🏆", "A perfect " + state.score + "-nut run.");
  }
  function saveScore() {
    var stats = loadStats();
    var dirty = false;
    if (state.mode === "daily") { if (state.score > stats.bestDaily) { stats.bestDaily = state.score; dirty = true; } }
    else if (state.score > stats.best) { stats.best = state.score; dirty = true; }
    if (dirty) { LS.set("sn_best", stats.best); LS.set("sn_bestDaily", stats.bestDaily); renderStats(); }
  }

  function togglePause() {
    if (!state || state.phase === "over" || state.phase === "ready") return;
    if (state.phase === "run") {
      state.phase = "paused";
      stopLoop();
      setMessage("Paused — press Space or tap Resume.", "");
      els.btnPause.textContent = "▶ Resume";
      draw();
    } else {
      state.phase = "run";
      els.btnPause.textContent = "⏸ Pause";
      setMessage("", "");
      startLoop();
    }
  }

  // ---- loop ----
  function startLoop() {
    stopLoop();
    lastTs = 0;
    state.acc = 0;
    rafId = requestAnimationFrame(tick);
  }
  function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
  function tick(ts) {
    if (!lastTs) lastTs = ts;
    var dt = Math.min(100, ts - lastTs);
    lastTs = ts;
    state.acc += dt;
    var interval = 1000 / state.tps;
    while (state.acc >= interval && state.phase === "run") {
      state.acc -= interval;
      step();
    }
    draw();
    if (state.phase === "run") rafId = requestAnimationFrame(tick);
  }

  // ---- drawing ----
  function draw() {
    var cv = els.canvas, ctx = cv.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    var cssW = cv.clientWidth;
    if (cv.width !== Math.round(cssW * dpr)) { cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssW * dpr); }
    var s = cv.width / N;

    ctx.fillStyle = "#fdfef9";
    ctx.fillRect(0, 0, cv.width, cv.height);
    // faint checker
    ctx.fillStyle = "rgba(34, 48, 31, .035)";
    for (var x = 0; x < N; x++)
      for (var y = 0; y < N; y++)
        if ((x + y) % 2 === 0) ctx.fillRect(x * s, y * s, s, s);

    // walls
    state.walls.forEach(function (k) {
      var p = k.split(",");
      roundRect(ctx, p[0] * s + s * 0.06, p[1] * s + s * 0.06, s * 0.88, s * 0.88, s * 0.2);
      ctx.fillStyle = "#3a4440";
      ctx.fill();
    });

    // nut
    if (state.nut) {
      var nx = (state.nut.x + 0.5) * s, ny = (state.nut.y + 0.5) * s;
      ctx.beginPath();
      ctx.arc(nx, ny + s * 0.06, s * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = "#a8751a";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(nx, ny - s * 0.14, s * 0.22, Math.PI, 0);
      ctx.fillStyle = "#6b4a12";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(nx - s * 0.09, ny - s * 0.02, s * 0.07, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.fill();
    }

    // snake
    for (var i = state.snake.length - 1; i >= 0; i--) {
      var seg = state.snake[i];
      var t = i / Math.max(1, state.snake.length - 1);
      var g = Math.round(106 - t * 30);
      ctx.fillStyle = i === 0 ? "#2f6a49" : "rgb(" + Math.round(63 + t * 25) + "," + g + "," + Math.round(73 + t * 12) + ")";
      var pad = i === 0 ? 0.04 : 0.09;
      roundRect(ctx, seg.x * s + s * pad, seg.y * s + s * pad, s * (1 - pad * 2), s * (1 - pad * 2), s * 0.3);
      ctx.fill();
    }
    // eyes on the head
    var head = state.snake[0];
    var ex = (head.x + 0.5) * s, ey = (head.y + 0.5) * s;
    var dx = state.dir.x, dy = state.dir.y;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex + dx * s * 0.18 - dy * s * 0.16, ey + dy * s * 0.18 - dx * s * 0.16, s * 0.1, 0, Math.PI * 2);
    ctx.arc(ex + dx * s * 0.18 + dy * s * 0.16, ey + dy * s * 0.18 + dx * s * 0.16, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#16181c";
    ctx.beginPath();
    ctx.arc(ex + dx * s * 0.23 - dy * s * 0.16, ey + dy * s * 0.23 - dx * s * 0.16, s * 0.05, 0, Math.PI * 2);
    ctx.arc(ex + dx * s * 0.23 + dy * s * 0.16, ey + dy * s * 0.23 + dx * s * 0.16, s * 0.05, 0, Math.PI * 2);
    ctx.fill();

    if (state.phase === "paused") {
      ctx.fillStyle = "rgba(16, 26, 21, .45)";
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function setMessage(text, kind) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); }
  function showModal(title, sub) {
    document.getElementById("win-title").textContent = title;
    document.getElementById("win-sub").textContent = sub;
    document.getElementById("win-modal").hidden = false;
  }
  function hideModal() { document.getElementById("win-modal").hidden = true; }

  function shareResult() {
    var base = location.origin + location.pathname.replace(/[^/]*$/, "");
    var lines = ["🐍 Snake"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Classic");
    lines.push("🌰 " + state.score + " nuts");
    var s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
    lines.push(base);
    var text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "Snake", text: text }).catch(function () {});
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { setMessage("Result copied!", "ok"); }, function () { fallbackCopy(text); });
    else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); setMessage("Result copied!", "ok"); } catch (e) { setMessage("Couldn't copy.", "warn"); }
    document.body.removeChild(ta);
  }

  // ---- input ----
  function onKey(e) {
    var d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }[e.key];
    if (d) { e.preventDefault(); setDir(d[0], d[1]); return; }
    if (e.key === " ") { e.preventDefault(); togglePause(); }
  }
  var swipe = null;
  function onPointerDown(e) { swipe = { x: e.clientX, y: e.clientY }; e.preventDefault(); }
  function onPointerUp(e) {
    if (!swipe) return;
    var dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) {
      if (state && state.phase === "ready") setDir(state.dir.x, state.dir.y); // tap to start
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
    else setDir(0, dy > 0 ? 1 : -1);
  }

  function boot() {
    els.canvas = document.getElementById("board");
    els.score = document.getElementById("score");
    els.message = document.getElementById("message");
    els.modeLabel = document.getElementById("mode-label");
    els.statBest = document.getElementById("stat-best");
    els.statStreak = document.getElementById("stat-streak");
    els.statDaily = document.getElementById("stat-daily");
    els.btnPause = document.getElementById("btn-pause");

    window.addEventListener("keydown", onKey);
    els.canvas.addEventListener("pointerdown", onPointerDown);
    els.canvas.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", function () { if (state) draw(); });
    window.addEventListener("blur", function () { if (state && state.phase === "run") togglePause(); });

    document.getElementById("btn-new").addEventListener("click", function () { newGame("classic"); });
    document.getElementById("btn-daily").addEventListener("click", function () { newGame("daily"); });
    els.btnPause.addEventListener("click", togglePause);
    document.getElementById("btn-share").addEventListener("click", shareResult);

    document.getElementById("win-new").addEventListener("click", function () { newGame(state ? state.mode : "classic"); });
    var winShare = document.getElementById("win-share");
    if (winShare) winShare.addEventListener("click", shareResult);
    var winClose = document.getElementById("win-close");
    if (winClose) winClose.addEventListener("click", hideModal);

    newGame("classic");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
