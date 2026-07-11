/*
 * Pyramid Solitaire — standalone game on the shared solitaire visuals.
 * Pair two open cards that add to 13 (K=13 goes alone, Q=12, J=11, A=1).
 * A pyramid card is open when nothing overlaps it; the waste top and the
 * stock top are open too. Clear all 28 pyramid cards to win. Two recycles.
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

  var els = {};
  var state = null; // { pyr: [{card, removed}×28], stock, waste, discard, recycles, mode, solved, moves, sel }
  var timerId = null, startTs = 0, started = false, lastElapsed = 0;
  var undoStack = [];

  function loadStats() {
    return { solved: LS.get("py_solved", 0), streak: LS.get("py_streak", 0), lastDaily: LS.get("py_lastDaily", null), best: LS.get("py_best", null) };
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

  // pyramid index helpers: rows 0..6, idx(r,i) with i in 0..r
  function idx(r, i) { return r * (r + 1) / 2 + i; }
  function isOpen(k) {
    var e = state.pyr[k];
    if (!e || e.removed) return false;
    var r = e.r, i = e.i;
    if (r === 6) return true;
    return state.pyr[idx(r + 1, i)].removed && state.pyr[idx(r + 1, i + 1)].removed;
  }

  function newGame(mode) {
    var deck = [];
    var id = 0;
    for (var s = 0; s < 4; s++) for (var r = 1; r <= 13; r++) deck.push({ suit: s, rank: r, id: "p" + (id++) });
    var rng = mode === "daily" ? mulberry32(dailySeed() + 7) : Math.random;
    shuffle(deck, rng);

    var pyr = [];
    var k = 0;
    for (var row = 0; row < 7; row++)
      for (var i = 0; i <= row; i++)
        pyr.push({ card: deck[k++], r: row, i: i, removed: false });

    state = {
      pyr: pyr,
      stock: deck.slice(28),
      waste: [],
      discard: [],
      recycles: 2,
      mode: mode, solved: false, moves: 0, sel: null
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

  // ---- undo ----
  function snapshot() {
    return {
      removed: state.pyr.map(function (e) { return e.removed; }),
      stock: state.stock.slice(), waste: state.waste.slice(), discard: state.discard.slice(),
      recycles: state.recycles, moves: state.moves
    };
  }
  function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); els.btnUndo.disabled = false; }
  function undo() {
    if (!undoStack.length || state.solved) return;
    var s = undoStack.pop();
    state.pyr.forEach(function (e, i) { e.removed = s.removed[i]; });
    state.stock = s.stock; state.waste = s.waste; state.discard = s.discard;
    state.recycles = s.recycles; state.moves = s.moves;
    state.sel = null;
    els.btnUndo.disabled = undoStack.length === 0;
    setMessage("", "");
    render();
  }

  // ---- rendering ----
  function render() {
    var field = els.board;
    field.innerHTML = "";
    var W = field.clientWidth - 24; // padding
    var cardW = Math.floor(W / 7.35);
    var cardH = Math.round(cardW * 7 / 5);
    var stepY = Math.round(cardH * 0.52);
    var pyrH = 6 * stepY + cardH;
    var cx = W / 2 + 12;

    function place(el, x, y, z) {
      el.style.left = Math.round(x) + "px";
      el.style.top = Math.round(y) + "px";
      el.style.width = cardW + "px";
      el.style.zIndex = z;
      field.appendChild(el);
    }

    // pyramid
    state.pyr.forEach(function (e, k2) {
      if (e.removed) return;
      var x = cx + (e.i - (e.r + 1) / 2) * (cardW * 1.02);
      var y = 12 + e.r * stepY;
      var el = document.createElement("div");
      el.className = "sol-card " + (isRed(e.card.suit) ? "is-red" : "is-black");
      el.innerHTML = cardHtml(e.card);
      el.dataset.kind = "pyr"; el.dataset.k = k2;
      var open = isOpen(k2);
      el.classList.toggle("pyr-locked", !open);
      if (state.sel && state.sel.kind === "pyr" && state.sel.k === k2) el.classList.add("pyr-sel");
      place(el, x, y, 10 + e.r);
    });

    var bottomY = pyrH + 26;
    // stock
    var stockX = 12 + cardW * 0.25;
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
      slot.dataset.kind = "stock";
      slot.textContent = state.recycles > 0 ? "↻" : "✕";
      slot.style.height = cardH + "px";
      place(slot, stockX, bottomY, 5);
      var badge2 = document.createElement("div");
      badge2.className = "pyr-count";
      badge2.textContent = state.recycles > 0 ? state.recycles + " redeal" + (state.recycles > 1 ? "s" : "") + " left" : "no redeals";
      badge2.style.left = Math.round(stockX + cardW / 2) + "px";
      badge2.style.top = Math.round(bottomY + cardH + 6) + "px";
      field.appendChild(badge2);
    }
    // waste
    var wasteX = stockX + cardW * 1.25;
    if (state.waste.length) {
      var wc = state.waste[state.waste.length - 1];
      var we = document.createElement("div");
      we.className = "sol-card " + (isRed(wc.suit) ? "is-red" : "is-black");
      we.innerHTML = cardHtml(wc);
      we.dataset.kind = "waste";
      if (state.sel && state.sel.kind === "waste") we.classList.add("pyr-sel");
      place(we, wasteX, bottomY, 6);
    } else {
      var ws = document.createElement("div");
      ws.className = "sol-slot pyr-slot";
      ws.style.height = cardH + "px";
      place(ws, wasteX, bottomY, 5);
    }
    // discard (cleared pairs)
    var discX = 12 + W - cardW * 1.25;
    if (state.discard.length) {
      var dc = state.discard[state.discard.length - 1];
      var de = document.createElement("div");
      de.className = "sol-card " + (isRed(dc.suit) ? "is-red" : "is-black") + " pyr-dim";
      de.innerHTML = cardHtml(dc);
      place(de, discX, bottomY, 5);
    } else {
      var ds = document.createElement("div");
      ds.className = "sol-slot pyr-slot";
      ds.textContent = "13";
      ds.style.height = cardH + "px";
      place(ds, discX, bottomY, 4);
    }

    field.style.height = (bottomY + cardH + 34) + "px";
    var left = 0;
    state.pyr.forEach(function (e) { if (!e.removed) left++; });
    els.found.textContent = (28 - left) + "/28";
  }

  // ---- game actions ----
  function cardOf(sel) {
    if (sel.kind === "pyr") return state.pyr[sel.k].card;
    return state.waste[state.waste.length - 1];
  }
  function removeSel(sel) {
    if (sel.kind === "pyr") { state.pyr[sel.k].removed = true; state.discard.push(state.pyr[sel.k].card); }
    else state.discard.push(state.waste.pop());
  }

  function tap(sel) {
    if (state.solved) return;
    ensureStarted();
    var card = cardOf(sel);
    if (!card) return;

    // King flies out alone
    if (card.rank === 13) {
      pushUndo();
      removeSel(sel);
      state.sel = null;
      state.moves++;
      finishMove();
      return;
    }
    if (!state.sel) { state.sel = sel; render(); return; }
    if (state.sel.kind === sel.kind && state.sel.k === sel.k) { state.sel = null; render(); return; }

    var other = cardOf(state.sel);
    if (other && other.rank + card.rank === 13) {
      pushUndo();
      // remove selection first (order matters when both are pyramid cards)
      var a = state.sel, b = sel;
      removeSel(a); removeSel(b);
      state.sel = null;
      state.moves++;
      finishMove();
    } else {
      state.sel = sel; // switch selection
      render();
    }
  }

  function finishMove() {
    render();
    var left = 0;
    state.pyr.forEach(function (e) { if (!e.removed) left++; });
    if (left === 0) win();
  }

  function onStock() {
    if (state.solved) return;
    ensureStarted();
    if (state.stock.length) {
      pushUndo();
      state.waste.push(state.stock.pop());
      state.sel = null; state.moves++;
      render();
    } else if (state.waste.length && state.recycles > 0) {
      pushUndo();
      state.recycles--;
      while (state.waste.length) state.stock.push(state.waste.pop());
      state.sel = null; state.moves++;
      render();
      setMessage(state.recycles > 0 ? "" : "Last pass through the deck!", state.recycles > 0 ? "" : "warn");
    }
  }

  function hint() {
    if (state.solved) return;
    // collect open cards
    var open = [];
    state.pyr.forEach(function (e, k2) { if (isOpen(k2)) open.push({ kind: "pyr", k: k2, card: e.card }); });
    if (state.waste.length) open.push({ kind: "waste", k: -1, card: state.waste[state.waste.length - 1] });
    for (var i = 0; i < open.length; i++) {
      if (open[i].card.rank === 13) { flashSel(open[i]); setMessage("A King clears on its own — tap it.", ""); return; }
      for (var j = i + 1; j < open.length; j++) {
        if (open[i].card.rank + open[j].card.rank === 13) {
          flashSel(open[i]); flashSel(open[j]);
          setMessage("These two make 13.", "");
          return;
        }
      }
    }
    if (state.stock.length || (state.waste.length && state.recycles > 0)) setMessage("No pairs showing — draw from the stock.", "");
    else setMessage("No moves left — try a new deal.", "warn");
  }
  function flashSel(sel) {
    var el = sel.kind === "waste" ? els.board.querySelector('[data-kind="waste"]') : els.board.querySelector('[data-kind="pyr"][data-k="' + sel.k + '"]');
    if (el) { el.classList.add("is-hint"); setTimeout(function () { el.classList.remove("is-hint"); }, 1200); }
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
    LS.set("py_solved", stats.solved); LS.set("py_streak", stats.streak); LS.set("py_lastDaily", stats.lastDaily); LS.set("py_best", stats.best);
    renderStats();
    setMessage("Pyramid cleared in " + formatTime(elapsed) + "!", "ok");
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
    var lines = ["🔺 Pyramid Solitaire"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Unlimited");
    if (state.solved) {
      lines.push("✅ Cleared in " + formatTime(lastElapsed) + " · " + state.moves + " moves");
      var s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
    } else lines.push("Pairs that make 13 — can you clear the pyramid? 🔺");
    lines.push(base);
    var text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "Pyramid Solitaire", text: text }).catch(function () {});
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
    var kind = el.dataset.kind;
    if (kind === "stock") { onStock(); return; }
    if (kind === "waste") { tap({ kind: "waste", k: -1 }); return; }
    if (kind === "pyr") {
      var k = +el.dataset.k;
      if (!isOpen(k)) { el.classList.add("is-hint"); setTimeout(function () { el.classList.remove("is-hint"); }, 800); return; }
      tap({ kind: "pyr", k: k });
    }
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
