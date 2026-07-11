/*
 * Mahjong Solitaire — classic turtle layout, guaranteed-solvable deals.
 * Tiles are assigned by simulating a legal disassembly of the full layout
 * backwards: pairs are drawn onto positions that are free at that moment, so
 * following the same pairs in reverse always clears the board. Match two free
 * identical tiles (flowers match flowers, seasons match seasons) to remove
 * them; a tile is free with nothing on top and an open left or right side.
 */
(function () {
  "use strict";

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dailySeed() { var d = new Date(); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); }
  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function todayKey(date) { var d = date || new Date(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function yesterdayKey() { var d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return todayKey(d); }
  function formatTime(ms) { var t = Math.floor(ms / 1000); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }

  // ── Turtle layout: positions in half-tile units (X spans [X,X+2)) ──
  function turtleLayout() {
    var P = [];
    function row(z, y, xFrom, xTo) { for (var x = xFrom; x <= xTo; x++) P.push({ X: x * 2, Y: y * 2, z: z }); }
    // layer 0 (84 + 3 wings = 87)
    row(0, 0, 1, 12);
    row(0, 1, 3, 10);
    row(0, 2, 2, 11);
    row(0, 3, 1, 12);
    row(0, 4, 1, 12);
    row(0, 5, 2, 11);
    row(0, 6, 3, 10);
    row(0, 7, 1, 12);
    P.push({ X: 0, Y: 7, z: 0 });   // left wing (y 3.5)
    P.push({ X: 26, Y: 7, z: 0 });  // right wing
    P.push({ X: 28, Y: 7, z: 0 });  // far right wing
    // layer 1: 6×6
    for (var y1 = 1; y1 <= 6; y1++) row(1, y1, 4, 9);
    // layer 2: 4×4
    for (var y2 = 2; y2 <= 5; y2++) row(2, y2, 5, 8);
    // layer 3: 2×2
    for (var y3 = 3; y3 <= 4; y3++) row(3, y3, 6, 7);
    // cap
    P.push({ X: 13, Y: 7, z: 4 });
    return P; // 144 positions
  }
  var POSITIONS = turtleLayout();

  // ── Tile kinds: 0-8 dots, 9-17 bamboo, 18-26 characters, 27-30 winds,
  //    31-33 dragons, 34 flowers (any-match), 35 seasons (any-match) ──
  function pairKinds() {
    var pairs = [];
    for (var k = 0; k < 34; k++) { pairs.push(k, k); } // two pairs each
    pairs.push(34, 34, 35, 35);
    return pairs; // 72 pair entries
  }
  var WINDS = ["N", "E", "S", "W"];
  function faceHtml(kind) {
    if (kind < 9) return '<b>' + (kind + 1) + '</b><span class="mj-suit mj-dot">●</span>';
    if (kind < 18) return '<b>' + (kind - 8) + '</b><span class="mj-suit mj-bam">▮</span>';
    if (kind < 27) return '<b>' + (kind - 17) + '</b><span class="mj-suit mj-chr">万</span>';
    if (kind < 31) return '<span class="mj-big mj-wind">' + WINDS[kind - 27] + '</span>';
    if (kind === 31) return '<span class="mj-big mj-chr">中</span>';
    if (kind === 32) return '<span class="mj-big mj-bam">發</span>';
    if (kind === 33) return '<span class="mj-big mj-blank">▢</span>';
    if (kind === 34) return '<span class="mj-big">🌸</span>';
    return '<span class="mj-big">🍂</span>';
  }

  var els = {};
  var state = null; // { tiles: [{X,Y,z,kind,removed}], mode, solved, moves, sel }
  var timerId = null, startTs = 0, started = false, lastElapsed = 0;
  var undoStack = [];

  function loadStats() {
    return { solved: LS.get("mj_solved", 0), streak: LS.get("mj_streak", 0), lastDaily: LS.get("mj_lastDaily", null), best: LS.get("mj_best", null) };
  }
  function renderStats() {
    var s = loadStats();
    els.statSolved.textContent = s.solved;
    els.statStreak.textContent = s.streak;
    els.statBest.textContent = s.best ? formatTime(s.best) : "—";
  }
  function startTimer() { stopTimer(); startTs = Date.now(); timerId = setInterval(function () { els.timer.textContent = formatTime(Date.now() - startTs); }, 500); }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function ensureStarted() { if (!started) { started = true; startTimer(); } }

  // free check against an aliveness predicate
  function isFreeIn(alive, i, tiles) {
    var t = tiles[i];
    for (var j = 0; j < tiles.length; j++) {
      if (j === i || !alive(j)) continue;
      var o = tiles[j];
      if (o.z === t.z + 1 && Math.abs(o.X - t.X) < 2 && Math.abs(o.Y - t.Y) < 2) return false; // covered
    }
    var left = false, right = false;
    for (var m = 0; m < tiles.length; m++) {
      if (m === i || !alive(m)) continue;
      var s = tiles[m];
      if (s.z !== t.z || Math.abs(s.Y - t.Y) >= 2) continue;
      if (s.X === t.X - 2) left = true;
      if (s.X === t.X + 2) right = true;
    }
    return !(left && right);
  }
  function isFree(i) { return !state.tiles[i].removed && isFreeIn(function (j) { return !state.tiles[j].removed; }, i, state.tiles); }

  // winnable assignment: disassemble the full layout, dealing pairs onto free spots
  function assignFaces(rng) {
    var tiles = POSITIONS.map(function (p) { return { X: p.X, Y: p.Y, z: p.z }; });
    for (var attempt = 0; attempt < 80; attempt++) {
      var present = new Array(tiles.length).fill(true);
      var alive = function (j) { return present[j]; };
      var order = shuffle(pairKinds().slice(), rng);
      var faces = new Array(tiles.length).fill(-1);
      var ok = true;
      for (var p = 0; p < order.length; p++) {
        var free = [];
        for (var i = 0; i < tiles.length; i++) if (present[i] && isFreeIn(alive, i, tiles)) free.push(i);
        if (free.length < 2) { ok = false; break; }
        var a = free.splice(Math.floor(rng() * free.length), 1)[0];
        var b = free[Math.floor(rng() * free.length)];
        faces[a] = order[p]; faces[b] = order[p];
        present[a] = false; present[b] = false;
      }
      if (ok) return faces;
    }
    return null; // practically unreachable
  }

  function newGame(mode) {
    var rng = mode === "daily" ? mulberry32(dailySeed() + 13) : Math.random;
    var faces = assignFaces(rng);
    state = {
      tiles: POSITIONS.map(function (p, i) { return { X: p.X, Y: p.Y, z: p.z, kind: faces[i], removed: false }; }),
      mode: mode, solved: false, moves: 0, sel: -1
    };
    undoStack = [];
    started = false; stopTimer();
    els.timer.textContent = "0:00";
    els.modeLabel.textContent = mode === "daily" ? "Daily · " + todayKey() : "Unlimited";
    els.btnUndo.disabled = true;
    hideWinModal();
    setMessage("", "");
    render();
    renderStats();
  }

  function snapshot() {
    return { removed: state.tiles.map(function (t) { return t.removed; }), kinds: state.tiles.map(function (t) { return t.kind; }), moves: state.moves };
  }
  function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); els.btnUndo.disabled = false; }
  function undo() {
    if (!undoStack.length || state.solved) return;
    var s = undoStack.pop();
    state.tiles.forEach(function (t, i) { t.removed = s.removed[i]; t.kind = s.kinds[i]; });
    state.moves = s.moves; state.sel = -1;
    els.btnUndo.disabled = undoStack.length === 0;
    setMessage("", "");
    render();
  }

  function pairsAvailable() {
    var free = [];
    for (var i = 0; i < state.tiles.length; i++) if (isFree(i)) free.push(i);
    var count = 0;
    for (var a = 0; a < free.length; a++)
      for (var b = a + 1; b < free.length; b++)
        if (state.tiles[free[a]].kind === state.tiles[free[b]].kind) count++;
    return { count: count, free: free };
  }

  function render() {
    var field = els.board;
    field.innerHTML = "";
    var W = field.clientWidth - 24;
    var tileW = Math.floor(W / 15.6);
    var tileH = Math.round(tileW * 1.32);
    var liftX = Math.max(2, Math.round(tileW * 0.09));
    var liftY = Math.max(2, Math.round(tileW * 0.11));

    var remaining = 0;
    state.tiles.forEach(function (t, i) {
      if (t.removed) return;
      remaining++;
      var el = document.createElement("button");
      el.type = "button";
      var free = isFree(i);
      el.className = "mj-tile" + (free ? "" : " mj-locked") + (state.sel === i ? " mj-sel" : "");
      el.innerHTML = faceHtml(t.kind);
      el.dataset.i = i;
      el.style.left = Math.round(12 + (t.X / 2) * tileW - t.z * liftX) + "px";
      el.style.top = Math.round(12 + (t.Y / 2) * tileH - t.z * liftY) + "px";
      el.style.width = tileW + "px";
      el.style.height = tileH + "px";
      el.style.zIndex = t.z * 200 + t.Y + Math.round(t.X / 30);
      el.style.fontSize = Math.max(9, Math.round(tileW * 0.34)) + "px";
      field.appendChild(el);
    });
    field.style.height = Math.round(12 + 8 * tileH + 40) + "px";

    var pa = pairsAvailable();
    els.found.textContent = remaining + " tiles · " + pa.count + " pairs";
    return { remaining: remaining, pairs: pa.count };
  }

  function tapTile(i) {
    if (state.solved || state.tiles[i].removed) return;
    if (!isFree(i)) {
      var el = els.board.querySelector('.mj-tile[data-i="' + i + '"]');
      if (el) { el.classList.add("mj-shake"); setTimeout(function () { el.classList.remove("mj-shake"); }, 500); }
      return;
    }
    ensureStarted();
    if (state.sel === i) { state.sel = -1; render(); return; }
    if (state.sel >= 0 && state.tiles[state.sel].kind === state.tiles[i].kind) {
      pushUndo();
      state.tiles[state.sel].removed = true;
      state.tiles[i].removed = true;
      state.sel = -1;
      state.moves++;
      var res = render();
      if (res.remaining === 0) { win(); return; }
      if (res.pairs === 0) setMessage("No pairs available — undo a few moves or shuffle.", "warn");
      else setMessage("", "");
    } else {
      state.sel = i;
      render();
    }
  }

  function hint() {
    if (state.solved) return;
    var pa = pairsAvailable();
    var free = pa.free;
    for (var a = 0; a < free.length; a++)
      for (var b = a + 1; b < free.length; b++)
        if (state.tiles[free[a]].kind === state.tiles[free[b]].kind) {
          [free[a], free[b]].forEach(function (i) {
            var el = els.board.querySelector('.mj-tile[data-i="' + i + '"]');
            if (el) { el.classList.add("mj-hint"); setTimeout(function () { el.classList.remove("mj-hint"); }, 1200); }
          });
          setMessage("These two match.", "");
          return;
        }
    setMessage("No pairs available — undo a few moves or shuffle.", "warn");
  }

  function shuffleRemaining() {
    if (state.solved) return;
    ensureStarted();
    pushUndo();
    var idxs = [], kinds = [];
    state.tiles.forEach(function (t, i) { if (!t.removed) { idxs.push(i); kinds.push(t.kind); } });
    shuffle(kinds, Math.random);
    idxs.forEach(function (i, k) { state.tiles[i].kind = kinds[k]; });
    state.sel = -1; state.moves++;
    var res = render();
    setMessage(res.pairs === 0 ? "Still no pairs — shuffle again or undo." : "Tiles shuffled.", res.pairs === 0 ? "warn" : "");
  }

  function win() {
    state.solved = true; stopTimer();
    var elapsed = Date.now() - startTs; lastElapsed = elapsed;
    var stats = loadStats(); stats.solved += 1;
    if (state.mode === "daily") {
      var tk = todayKey();
      if (stats.lastDaily !== tk) { stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1; stats.lastDaily = tk; }
    }
    if (!stats.best || elapsed < stats.best) stats.best = elapsed;
    LS.set("mj_solved", stats.solved); LS.set("mj_streak", stats.streak); LS.set("mj_lastDaily", stats.lastDaily); LS.set("mj_best", stats.best);
    renderStats();
    setMessage("Board cleared in " + formatTime(elapsed) + "!", "ok");
    var modal = document.getElementById("win-modal");
    var sub = document.getElementById("win-sub");
    var s = loadStats();
    var txt = "Cleared in " + formatTime(elapsed) + " · " + state.moves + " moves";
    if (state.mode === "daily" && s.streak > 0) txt += " · " + s.streak + " day streak";
    if (sub) sub.textContent = txt;
    if (modal) modal.hidden = false;
  }
  function hideWinModal() { var m = document.getElementById("win-modal"); if (m) m.hidden = true; }
  function setMessage(text, kind) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); }

  function shareResult() {
    var base = location.origin + location.pathname.replace(/[^/]*$/, "");
    var lines = ["🀄 Mahjong Solitaire"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Unlimited");
    if (state.solved) {
      lines.push("✅ Cleared in " + formatTime(lastElapsed) + " · " + state.moves + " moves");
      var s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
    } else lines.push("144 tiles, one turtle — can you clear it? 🀄");
    lines.push(base);
    var text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "Mahjong Solitaire", text: text }).catch(function () {});
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { setMessage("Result copied!", "ok"); }, function () { fallbackCopy(text); });
    else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); setMessage("Result copied!", "ok"); } catch (e) { setMessage("Couldn't copy.", "warn"); }
    document.body.removeChild(ta);
  }

  function onClick(e) {
    var el = e.target.closest(".mj-tile");
    if (el) tapTile(+el.dataset.i);
  }

  function boot() {
    els.board = document.getElementById("board");
    els.timer = document.getElementById("timer");
    els.message = document.getElementById("message");
    els.modeLabel = document.getElementById("mode-label");
    els.statSolved = document.getElementById("stat-solved");
    els.statStreak = document.getElementById("stat-streak");
    els.statBest = document.getElementById("stat-best");
    els.found = document.getElementById("found-count");
    els.btnUndo = document.getElementById("btn-undo");

    els.board.addEventListener("click", onClick);
    window.addEventListener("resize", function () { if (state) render(); });
    document.getElementById("btn-new").addEventListener("click", function () { newGame("unlimited"); });
    document.getElementById("btn-daily").addEventListener("click", function () { newGame("daily"); });
    document.getElementById("btn-hint").addEventListener("click", hint);
    document.getElementById("btn-shuffle").addEventListener("click", shuffleRemaining);
    els.btnUndo.addEventListener("click", undo);
    document.getElementById("btn-share").addEventListener("click", shareResult);

    var winNew = document.getElementById("win-new");
    if (winNew) winNew.addEventListener("click", function () { newGame("unlimited"); });
    var winShare = document.getElementById("win-share");
    if (winShare) winShare.addEventListener("click", shareResult);
    var winClose = document.getElementById("win-close");
    if (winClose) winClose.addEventListener("click", hideWinModal);

    newGame("unlimited");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
