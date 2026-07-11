/*
 * TriPeaks Solitaire — standalone game on the shared solitaire visuals.
 * Play any open tableau card one rank above or below the waste top (Ace and
 * King wrap around). Covered cards lie face down and flip open as their
 * cover is cleared. Clear all three peaks to win. No redeals — plan the runs.
 */
(function () {
  "use strict";

  var SUITS = ["♠", "♥", "♦", "♣"];
  var RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  function isRed(suit) { return suit === 1 || suit === 2; }

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

  function cardHtml(card) {
    var s = SUITS[card.suit], r = RANKS[card.rank];
    var corner = r + '<span class="s">' + s + "</span>";
    return '<div class="sol-card__corner sol-card__corner--tl">' + corner + "</div>" +
      '<div class="sol-card__pip">' + s + "</div>" +
      '<div class="sol-card__corner sol-card__corner--br">' + corner + "</div>";
  }

  // tableau slots: { r, x } — bottom row r=3 x 0..9; cover = r+1 at x±0.5
  var SLOTS = [];
  [1.5, 4.5, 7.5].forEach(function (x) { SLOTS.push({ r: 0, x: x }); });
  [1, 2, 4, 5, 7, 8].forEach(function (x) { SLOTS.push({ r: 1, x: x }); });
  for (var i9 = 0; i9 < 9; i9++) SLOTS.push({ r: 2, x: 0.5 + i9 });
  for (var i10 = 0; i10 < 10; i10++) SLOTS.push({ r: 3, x: i10 });

  var els = {};
  var state = null; // { tab: [{card, removed}×28], stock, waste, combo, bestCombo, mode, solved, moves }
  var timerId = null, startTs = 0, started = false, lastElapsed = 0;
  var undoStack = [];

  function loadStats() {
    return { solved: LS.get("tp_solved", 0), streak: LS.get("tp_streak", 0), lastDaily: LS.get("tp_lastDaily", null), best: LS.get("tp_best", null) };
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

  function isOpen(k) {
    var e = state.tab[k];
    if (e.removed) return false;
    if (e.r === 3) return true;
    for (var j = 0; j < SLOTS.length; j++) {
      var s = SLOTS[j];
      if (s.r === e.r + 1 && Math.abs(s.x - e.x) === 0.5 && !state.tab[j].removed) return false;
    }
    return true;
  }
  function playable(k) {
    if (!isOpen(k)) return false;
    var w = state.waste[state.waste.length - 1];
    var d = Math.abs(state.tab[k].card.rank - w.rank);
    return d === 1 || d === 12; // wrap A↔K
  }

  function newGame(mode) {
    var deck = [];
    var id = 0;
    for (var s = 0; s < 4; s++) for (var r = 1; r <= 13; r++) deck.push({ suit: s, rank: r, id: "t" + (id++) });
    var rng = mode === "daily" ? mulberry32(dailySeed() + 11) : Math.random;
    shuffle(deck, rng);

    state = {
      tab: SLOTS.map(function (slot, i) { return { card: deck[i], r: slot.r, x: slot.x, removed: false }; }),
      stock: deck.slice(29),
      waste: [deck[28]],
      combo: 0, bestCombo: 0,
      mode: mode, solved: false, moves: 0
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
    return {
      removed: state.tab.map(function (e) { return e.removed; }),
      stock: state.stock.slice(), waste: state.waste.slice(),
      combo: state.combo, bestCombo: state.bestCombo, moves: state.moves
    };
  }
  function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); els.btnUndo.disabled = false; }
  function undo() {
    if (!undoStack.length || state.solved) return;
    var s = undoStack.pop();
    state.tab.forEach(function (e, i) { e.removed = s.removed[i]; });
    state.stock = s.stock; state.waste = s.waste;
    state.combo = s.combo; state.bestCombo = s.bestCombo; state.moves = s.moves;
    els.btnUndo.disabled = undoStack.length === 0;
    setMessage("", "");
    render();
  }

  function render() {
    var field = els.board;
    field.innerHTML = "";
    var W = field.clientWidth - 24;
    var cardW = Math.floor(W / 10.35);
    var cardH = Math.round(cardW * 7 / 5);
    var stepY = Math.round(cardH * 0.52);
    var peaksH = 3 * stepY + cardH;

    function place(el, x, y, z) {
      el.style.left = Math.round(x) + "px";
      el.style.top = Math.round(y) + "px";
      el.style.width = cardW + "px";
      el.style.zIndex = z;
      field.appendChild(el);
    }

    state.tab.forEach(function (e, k) {
      if (e.removed) return;
      var x = 12 + e.x * (cardW * 1.03);
      var y = 12 + e.r * stepY;
      var el = document.createElement("div");
      var open = isOpen(k);
      if (open) {
        el.className = "sol-card " + (isRed(e.card.suit) ? "is-red" : "is-black");
        el.innerHTML = cardHtml(e.card);
      } else {
        el.className = "sol-card sol-card--down";
      }
      el.dataset.kind = "tab"; el.dataset.k = k;
      place(el, x, y, 10 + e.r);
    });

    var bottomY = peaksH + 26;
    var cx = 12 + W / 2;
    // stock (left of center)
    var stockX = cx - cardW * 1.4;
    if (state.stock.length) {
      var st = document.createElement("div");
      st.className = "sol-card sol-card--down pyr-stock";
      st.dataset.kind = "stock";
      place(st, stockX, bottomY, 5);
      var badge = document.createElement("div");
      badge.className = "pyr-count";
      badge.textContent = state.stock.length;
      badge.style.left = Math.round(stockX + cardW / 2) + "px";
      badge.style.top = Math.round(bottomY + cardH + 6) + "px";
      field.appendChild(badge);
    } else {
      var slot = document.createElement("div");
      slot.className = "sol-slot pyr-slot";
      slot.textContent = "✕";
      slot.style.height = cardH + "px";
      place(slot, stockX, bottomY, 5);
    }
    // waste (right of center)
    var wasteX = cx + cardW * 0.4;
    var wc = state.waste[state.waste.length - 1];
    var we = document.createElement("div");
    we.className = "sol-card " + (isRed(wc.suit) ? "is-red" : "is-black");
    we.innerHTML = cardHtml(wc);
    place(we, wasteX, bottomY, 6);

    field.style.height = (bottomY + cardH + 34) + "px";
    var left = 0;
    state.tab.forEach(function (e) { if (!e.removed) left++; });
    els.found.textContent = (28 - left) + "/28";
  }

  function checkStuck() {
    if (state.stock.length) return;
    for (var k = 0; k < 28; k++) if (playable(k)) return;
    var left = 0;
    state.tab.forEach(function (e) { if (!e.removed) left++; });
    if (left > 0) setMessage("No moves left — try a new deal.", "warn");
  }

  function tapTab(k) {
    if (state.solved) return;
    if (!playable(k)) {
      var el = els.board.querySelector('[data-kind="tab"][data-k="' + k + '"]');
      if (el) { el.classList.add("is-hint"); setTimeout(function () { el.classList.remove("is-hint"); }, 800); }
      return;
    }
    ensureStarted();
    pushUndo();
    var e = state.tab[k];
    e.removed = true;
    state.waste.push(e.card);
    state.combo++;
    if (state.combo > state.bestCombo) state.bestCombo = state.combo;
    state.moves++;
    render();
    if (state.combo >= 3) setMessage("Combo ×" + state.combo + "!", "ok");
    else setMessage("", "");
    var left = 0;
    state.tab.forEach(function (t2) { if (!t2.removed) left++; });
    if (left === 0) { win(); return; }
    checkStuck();
  }

  function onStock() {
    if (state.solved || !state.stock.length) return;
    ensureStarted();
    pushUndo();
    state.waste.push(state.stock.pop());
    state.combo = 0;
    state.moves++;
    setMessage("", "");
    render();
    checkStuck();
  }

  function hint() {
    if (state.solved) return;
    for (var k = 0; k < 28; k++) {
      if (playable(k)) {
        var el = els.board.querySelector('[data-kind="tab"][data-k="' + k + '"]');
        if (el) { el.classList.add("is-hint"); setTimeout(function () { el.classList.remove("is-hint"); }, 1200); }
        setMessage("That card plays on the waste.", "");
        return;
      }
    }
    if (state.stock.length) setMessage("Nothing plays — draw from the stock.", "");
    else setMessage("No moves left — try a new deal.", "warn");
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
    LS.set("tp_solved", stats.solved); LS.set("tp_streak", stats.streak); LS.set("tp_lastDaily", stats.lastDaily); LS.set("tp_best", stats.best);
    renderStats();
    setMessage("All peaks cleared in " + formatTime(elapsed) + "!", "ok");
    var modal = document.getElementById("win-modal");
    var sub = document.getElementById("win-sub");
    var s = loadStats();
    var txt = "Cleared in " + formatTime(elapsed) + " · best combo ×" + state.bestCombo;
    if (state.mode === "daily" && s.streak > 0) txt += " · " + s.streak + " day streak";
    if (sub) sub.textContent = txt;
    if (modal) modal.hidden = false;
  }
  function hideWinModal() { var m = document.getElementById("win-modal"); if (m) m.hidden = true; }
  function setMessage(text, kind) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); }

  function shareResult() {
    var base = location.origin + location.pathname.replace(/[^/]*$/, "");
    var lines = ["⛰️ TriPeaks Solitaire"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Unlimited");
    if (state.solved) {
      lines.push("✅ Cleared in " + formatTime(lastElapsed) + " · best combo ×" + state.bestCombo);
      var s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
    } else lines.push("Up or down by one — can you clear all three peaks? ⛰️");
    lines.push(base);
    var text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "TriPeaks Solitaire", text: text }).catch(function () {});
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
    var el = e.target.closest("[data-kind]");
    if (!el) return;
    if (el.dataset.kind === "stock") { onStock(); return; }
    if (el.dataset.kind === "tab") tapTab(+el.dataset.k);
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
    window.addEventListener("resize", render);
    document.getElementById("btn-new").addEventListener("click", function () { newGame("unlimited"); });
    document.getElementById("btn-daily").addEventListener("click", function () { newGame("daily"); });
    document.getElementById("btn-hint").addEventListener("click", hint);
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
