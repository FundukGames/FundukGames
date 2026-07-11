/*
 * 2048 — slide the tiles, merge equal pairs, chase the golden tile.
 * Arrow keys / WASD on desktop, swipes on touch. The Daily run seeds the
 * spawn sequence so everyone plays the same luck; streak counts a 1024+ tile.
 */
(function () {
  "use strict";

  var SIZE = 4;

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
  var state = null; // { tiles: [{id,value,r,c}], score, mode, rng, over, won, keptGoing, moves }
  var tileId = 0;
  var undoSnap = null;

  function loadStats() {
    return {
      best: LS.get("g2_best", 0),
      bestTile: LS.get("g2_bestTile", 0),
      streak: LS.get("g2_streak", 0),
      lastDaily: LS.get("g2_lastDaily", null)
    };
  }
  function renderStats() {
    var s = loadStats();
    els.statBest.textContent = s.best;
    els.statStreak.textContent = s.streak;
    els.statTile.textContent = s.bestTile || "—";
  }

  function cellsEmpty() {
    var occ = {};
    state.tiles.forEach(function (t) { occ[t.r + "," + t.c] = true; });
    var out = [];
    for (var r = 0; r < SIZE; r++)
      for (var c = 0; c < SIZE; c++)
        if (!occ[r + "," + c]) out.push([r, c]);
    return out;
  }
  function spawn() {
    var empty = cellsEmpty();
    if (!empty.length) return;
    var rng = state.rng || Math.random;
    var spot = empty[Math.floor(rng() * empty.length)];
    var val = rng() < 0.9 ? 2 : 4;
    state.tiles.push({ id: "t" + (tileId++), value: val, r: spot[0], c: spot[1], isNew: true });
  }

  function newGame(mode) {
    state = { tiles: [], score: 0, mode: mode, rng: mode === "daily" ? mulberry32(dailySeed() + 17) : Math.random, over: false, won: false, keptGoing: false, moves: 0 };
    undoSnap = null;
    els.btnUndo.disabled = true;
    els.modeLabel.textContent = mode === "daily" ? "Daily · " + todayKey() : "Unlimited";
    spawn(); spawn();
    hideModal();
    setMessage("", "");
    render(true);
    renderScore();
    renderStats();
  }

  function grid() {
    var g = Array.from({ length: SIZE }, function () { return new Array(SIZE).fill(null); });
    state.tiles.forEach(function (t) { g[t.r][t.c] = t; });
    return g;
  }

  function move(dir) { // 0 up, 1 right, 2 down, 3 left
    if (!state || state.over) return;
    var g = grid();
    var moved = false;
    var gained = 0;
    var merged = {};

    function lineOf(i) {
      var line = [];
      for (var j = 0; j < SIZE; j++) {
        var r = dir === 0 ? j : dir === 2 ? SIZE - 1 - j : i;
        var c = dir === 3 ? j : dir === 1 ? SIZE - 1 - j : i;
        line.push([r, c]);
      }
      return line;
    }

    for (var i = 0; i < SIZE; i++) {
      var cells = lineOf(i);
      var stack = [];
      cells.forEach(function (rc) {
        var t = g[rc[0]][rc[1]];
        if (t) stack.push(t);
      });
      var outIdx = 0;
      for (var k = 0; k < stack.length; k++) {
        var t = stack[k];
        if (k + 1 < stack.length && stack[k + 1].value === t.value) {
          // merge t and next into position outIdx
          var partner = stack[k + 1];
          var target = cells[outIdx];
          t.value *= 2; gained += t.value;
          if (t.r !== target[0] || t.c !== target[1]) moved = true;
          t.r = target[0]; t.c = target[1];
          partner.r = target[0]; partner.c = target[1];
          partner.dying = true;
          merged[t.id] = true;
          k++;
          outIdx++;
          moved = true;
        } else {
          var tgt = cells[outIdx];
          if (t.r !== tgt[0] || t.c !== tgt[1]) moved = true;
          t.r = tgt[0]; t.c = tgt[1];
          outIdx++;
        }
      }
    }

    if (!moved) return;

    // save one-step undo (positions before this move already mutated — snapshot before was needed).
    state.moves++;
    state.score += gained;

    render(); // animate slides (dying tiles ride along)

    setTimeout(function () {
      state.tiles = state.tiles.filter(function (t) { return !t.dying; });
      state.tiles.forEach(function (t) { t.popped = merged[t.id]; });
      spawn();
      render();
      renderScore();
      checkEnd();
    }, 110);
  }

  // snapshot for undo taken right before applying a move
  function withUndo(dir) {
    if (!state || state.over) return;
    var snap = {
      tiles: state.tiles.map(function (t) { return { id: t.id, value: t.value, r: t.r, c: t.c }; }),
      score: state.score, moves: state.moves, won: state.won, keptGoing: state.keptGoing
    };
    var before = JSON.stringify(snap.tiles);
    move(dir);
    // if the move did anything, current tiles differ (positions/values or count)
    setTimeout(function () {
      var now = JSON.stringify(state.tiles.map(function (t) { return { id: t.id, value: t.value, r: t.r, c: t.c }; }));
      if (now !== before) { undoSnap = snap; els.btnUndo.disabled = false; }
    }, 140);
  }
  function undo() {
    if (!undoSnap || !state) return;
    state.tiles = undoSnap.tiles.map(function (t) { return { id: t.id, value: t.value, r: t.r, c: t.c }; });
    state.score = undoSnap.score; state.moves = undoSnap.moves;
    state.won = undoSnap.won; state.keptGoing = undoSnap.keptGoing;
    state.over = false;
    undoSnap = null;
    els.btnUndo.disabled = true;
    hideModal();
    setMessage("", "");
    render(true);
    renderScore();
  }

  function canMove() {
    if (cellsEmpty().length) return true;
    var g = grid();
    for (var r = 0; r < SIZE; r++)
      for (var c = 0; c < SIZE; c++) {
        var v = g[r][c].value;
        if (r + 1 < SIZE && g[r + 1][c].value === v) return true;
        if (c + 1 < SIZE && g[r][c + 1].value === v) return true;
      }
    return false;
  }

  function maxTile() {
    var m = 0;
    state.tiles.forEach(function (t) { if (t.value > m) m = t.value; });
    return m;
  }

  function checkEnd() {
    var m = maxTile();
    var stats = loadStats();
    var dirty = false;
    if (state.score > stats.best) { stats.best = state.score; dirty = true; }
    if (m > stats.bestTile) { stats.bestTile = m; dirty = true; }
    if (state.mode === "daily" && m >= 1024) {
      var tk = todayKey();
      if (stats.lastDaily !== tk) {
        stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1;
        stats.lastDaily = tk; dirty = true;
        setMessage("Daily goal reached — 1024! Streak +1 🔥", "ok");
      }
    }
    if (dirty) {
      LS.set("g2_best", stats.best); LS.set("g2_bestTile", stats.bestTile);
      LS.set("g2_streak", stats.streak); LS.set("g2_lastDaily", stats.lastDaily);
      renderStats();
    }

    if (m >= 2048 && !state.won) {
      state.won = true;
      showModal("2048! 🏆", "You built the golden tile in " + state.moves + " moves · score " + state.score, true);
      return;
    }
    if (!canMove()) {
      state.over = true;
      showModal("Game over", "Score " + state.score + " · best tile " + m, false);
    }
  }

  // ---- rendering ----
  function render(instant) {
    var board = els.board;
    var w = board.clientWidth;
    var gap = Math.round(w * 0.03);
    var cell = (w - gap * 5) / 4;

    if (!board.querySelector(".g2-bg")) {
      var bg = document.createElement("div");
      bg.className = "g2-bg";
      for (var i = 0; i < 16; i++) {
        var b = document.createElement("div");
        b.className = "g2-bgcell";
        bg.appendChild(b);
      }
      board.appendChild(bg);
    }

    var seen = {};
    state.tiles.forEach(function (t) {
      seen[t.id] = true;
      var el = board.querySelector('.g2-tile[data-id="' + t.id + '"]');
      var x = gap + t.c * (cell + gap);
      var y = gap + t.r * (cell + gap);
      if (!el) {
        el = document.createElement("div");
        el.dataset.id = t.id;
        board.appendChild(el);
        el.style.width = cell + "px";
        el.style.height = cell + "px";
        el.style.transform = "translate(" + x + "px," + y + "px)";
      }
      el.className = "g2-tile g2-v" + Math.min(t.value, 4096) + (t.isNew ? " g2-new" : "") + (t.popped ? " g2-pop" : "");
      el.textContent = t.value;
      el.style.width = cell + "px";
      el.style.height = cell + "px";
      el.style.fontSize = (t.value >= 1024 ? cell * 0.3 : t.value >= 128 ? cell * 0.36 : cell * 0.42) + "px";
      if (instant) el.style.transition = "none";
      el.style.transform = "translate(" + x + "px," + y + "px)";
      if (instant) requestAnimationFrame(function () { el.style.transition = ""; });
      t.isNew = false; t.popped = false;
    });
    board.querySelectorAll(".g2-tile").forEach(function (el) {
      if (!seen[el.dataset.id]) el.remove();
    });
    board.style.height = w + "px";
  }
  function renderScore() { els.score.textContent = state.score; }

  function setMessage(text, kind) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); }
  function showModal(title, sub, keepGoing) {
    document.getElementById("win-title").textContent = title;
    document.getElementById("win-sub").textContent = sub;
    document.getElementById("win-continue").hidden = !keepGoing;
    document.getElementById("win-modal").hidden = false;
  }
  function hideModal() { document.getElementById("win-modal").hidden = true; }

  function shareResult() {
    var base = location.origin + location.pathname.replace(/[^/]*$/, "");
    var lines = ["🔢 2048"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Unlimited");
    lines.push((state.over ? "🏁" : "▶️") + " Score " + state.score + " · best tile " + maxTile());
    var s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
    lines.push(base);
    var text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "2048", text: text }).catch(function () {});
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
    var dir = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3 }[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    withUndo(dir);
  }
  var swipe = null;
  function onPointerDown(e) { swipe = { x: e.clientX, y: e.clientY }; }
  function onPointerUp(e) {
    if (!swipe) return;
    var dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    var dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    withUndo(dir);
  }

  function boot() {
    els.board = document.getElementById("board");
    els.score = document.getElementById("score");
    els.message = document.getElementById("message");
    els.modeLabel = document.getElementById("mode-label");
    els.statBest = document.getElementById("stat-best");
    els.statStreak = document.getElementById("stat-streak");
    els.statTile = document.getElementById("stat-tile");
    els.btnUndo = document.getElementById("btn-undo");

    window.addEventListener("keydown", onKey);
    els.board.addEventListener("pointerdown", onPointerDown);
    els.board.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", function () { if (state) render(true); });

    document.getElementById("btn-new").addEventListener("click", function () { newGame("unlimited"); });
    document.getElementById("btn-daily").addEventListener("click", function () { newGame("daily"); });
    els.btnUndo.addEventListener("click", undo);
    document.getElementById("btn-share").addEventListener("click", shareResult);

    document.getElementById("win-new").addEventListener("click", function () { newGame("unlimited"); });
    document.getElementById("win-continue").addEventListener("click", function () { state.keptGoing = true; hideModal(); });
    var winShare = document.getElementById("win-share");
    if (winShare) winShare.addEventListener("click", shareResult);
    var winClose = document.getElementById("win-close");
    if (winClose) winClose.addEventListener("click", hideModal);

    newGame("unlimited");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
