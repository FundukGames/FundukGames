/*
 * Solitaire core — shared engine for Klondike, Spider and FreeCell.
 * Handles the card model, rendering, drag-and-drop + tap-to-auto-move,
 * undo, timer, stats, the win modal and sharing. Each game supplies a
 * config object with the rules (see klondike/spider/freecell game.js).
 *
 * Interaction model:
 *   • Drag a card (or a legal run) to place it manually.
 *   • Tap a card to auto-move it to the best legal destination (foundation first).
 *   • Tap the stock to draw / deal.
 * Works with mouse and touch via Pointer Events. No build step, no deps.
 */
window.Solitaire = (function () {
  "use strict";

  var SUITS = ["♠", "♥", "♦", "♣"]; // spade, heart, diamond, club
  var RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

  function isRed(suit) { return suit === 1 || suit === 2; }

  // ── Seeded RNG (mulberry32) for the Daily deal; Math.random otherwise ──
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dailySeed() {
    var d = new Date();
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }
  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ── localStorage helper ──
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function todayKey(date) { var d = date || new Date(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function yesterdayKey() { var d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return todayKey(d); }
  function formatTime(ms) { var t = Math.floor(ms / 1000); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }

  // ── Card DOM ──
  function makeCardEl(card) {
    var el = document.createElement("div");
    el.className = "sol-card";
    el.dataset.id = card.id;
    paintCardEl(el, card);
    return el;
  }
  function paintCardEl(el, card) {
    if (!card.faceUp) {
      el.className = "sol-card sol-card--down";
      el.innerHTML = "";
      return;
    }
    el.className = "sol-card " + (isRed(card.suit) ? "is-red" : "is-black");
    var s = SUITS[card.suit], r = RANKS[card.rank];
    el.innerHTML =
      '<div class="sol-card__corner">' + r + '<span class="s">' + s + "</span></div>" +
      '<div class="sol-card__pip">' + s + "</div>";
  }

  // ── Engine ──
  function create(cfg) {
    var root, board, els = {};
    var piles = [];           // { id, type, zone, cards: [], el }
    var byId = {};
    var undoStack = [];
    var mode = "unlimited";   // or "daily"
    var diff = cfg.defaultDiff || null;
    var startTs = 0, timerId = null, solved = false, started = false, moves = 0;

    function pile(id) { return byId[id]; }

    // ---- build DOM from the layout descriptor ----
    function buildLayout() {
      var lay = cfg.layout(diff);
      board.innerHTML = "";
      piles = []; byId = {};

      var top = document.createElement("div");
      top.className = "sol-toprow";
      lay.top.forEach(function (item) {
        if (item.spacer) { var sp = document.createElement("div"); sp.className = "sol-spacer"; top.appendChild(sp); return; }
        top.appendChild(makePileEl(item));
      });
      board.appendChild(top);

      var tab = document.createElement("div");
      tab.className = "sol-tableau";
      tab.style.gridTemplateColumns = "repeat(" + lay.tableau.length + ", minmax(34px, 1fr))";
      lay.tableau.forEach(function (item) { tab.appendChild(makePileEl(item, true)); });
      board.appendChild(tab);

      board.classList.toggle("sol-board--scroll", lay.tableau.length >= 10);
    }
    function makePileEl(item, isTableau) {
      var el = document.createElement("div");
      el.className = "sol-pile" + (isTableau ? " sol-pile--tableau" : "");
      el.dataset.id = item.id; el.dataset.type = item.type;
      var p = { id: item.id, type: item.type, zone: item.zone, hint: item.hint || "", cards: [], el: el };
      piles.push(p); byId[item.id] = p;
      return el;
    }

    // ---- render piles → cards ----
    function render() {
      piles.forEach(function (p) {
        // slot placeholder when empty
        var hasCards = p.cards.length > 0;
        var existingSlot = p.el.querySelector(":scope > .sol-slot");
        if (!hasCards) {
          if (!existingSlot) {
            var slot = document.createElement("div");
            slot.className = "sol-slot";
            slot.textContent = p.type === "stock" ? "↻" : (p.hint || "");
            p.el.innerHTML = ""; p.el.appendChild(slot);
          }
        } else if (existingSlot) {
          existingSlot.remove();
        }
        // reconcile cards: simplest correct approach — rebuild card nodes
        var frag = document.createDocumentFragment();
        p.cards.forEach(function (card) { frag.appendChild(makeCardEl(card)); });
        // remove old card nodes
        p.el.querySelectorAll(":scope > .sol-card").forEach(function (n) { n.remove(); });
        p.el.appendChild(frag);
      });
      layout();
      updateBar();
    }

    // ---- compute card positions (fan offsets) ----
    function layout() {
      var sample = piles.find(function (p) { return p.zone === "tableau"; });
      if (!sample) return;
      var w = sample.el.clientWidth;
      if (!w) return;
      root.style.setProperty("--sol-card-w", w + "px");
      var h = Math.round(w * 7 / 5);
      var fanUp = Math.round(h * 0.26), fanDown = Math.round(h * 0.13);

      piles.forEach(function (p) {
        var cardEls = p.el.querySelectorAll(":scope > .sol-card");
        var i;
        if (p.zone !== "tableau") {
          // foundations / free cells / stock / waste: stack at the top, only the top card shows
          for (i = 0; i < cardEls.length; i++) cardEls[i].style.top = "0px";
          p.el.style.minHeight = h + "px";
          return;
        }
        var y = 0, lastY = 0;
        for (i = 0; i < cardEls.length; i++) {
          cardEls[i].style.top = y + "px";
          lastY = y;
          y += p.cards[i].faceUp ? fanUp : fanDown;
        }
        p.el.style.minHeight = (lastY + h) + "px";
      });
    }

    // ---- bar / stats ----
    function loadStats() {
      return {
        solved: LS.get(cfg.key + "_solved", 0),
        streak: LS.get(cfg.key + "_streak", 0),
        lastDaily: LS.get(cfg.key + "_lastDaily", null),
        best: LS.get(cfg.key + "_best", {})
      };
    }
    function renderStats() {
      var s = loadStats();
      if (els.statSolved) els.statSolved.textContent = s.solved;
      if (els.statStreak) els.statStreak.textContent = s.streak;
      if (els.statBest) { var b = s.best[diff || "x"]; els.statBest.textContent = b ? formatTime(b) : "—"; }
    }
    function updateBar() {
      if (els.modeLabel) {
        els.modeLabel.textContent = (mode === "daily" ? "Daily · " + todayKey() : "Unlimited") +
          (diff ? " · " + diff : "");
      }
      if (els.found && cfg.progress) els.found.textContent = cfg.progress(api);
    }

    // ---- timer ----
    function startTimer() { stopTimer(); startTs = Date.now(); timerId = setInterval(function () { if (els.timer) els.timer.textContent = formatTime(Date.now() - startTs); }, 500); }
    function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
    function ensureStarted() { if (!started) { started = true; startTimer(); } }

    // ---- undo ----
    function snapshot() {
      return {
        piles: piles.map(function (p) { return p.cards.map(function (c) { return { suit: c.suit, rank: c.rank, faceUp: c.faceUp, id: c.id }; }); }),
        moves: moves,
        extra: cfg.snapshot ? cfg.snapshot(api) : null
      };
    }
    function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); if (els.btnUndo) els.btnUndo.disabled = false; }
    function undo() {
      if (!undoStack.length || solved) return;
      var snap = undoStack.pop();
      piles.forEach(function (p, i) { p.cards = snap.piles[i].slice(); });
      moves = snap.moves;
      if (cfg.restore) cfg.restore(api, snap.extra);
      render();
      setMessage("", "");
      if (els.btnUndo) els.btnUndo.disabled = undoStack.length === 0;
    }

    // ---- move helpers used by games ----
    // Move the last `n` cards from src pile to dest pile (no validation).
    function moveStack(src, dest, n) {
      var moving = src.cards.splice(src.cards.length - n, n);
      dest.cards = dest.cards.concat(moving);
    }

    // commit a validated move; records undo, runs afterMove hook, re-renders, checks win
    function commit(fn) {
      pushUndo();
      ensureStarted();
      fn();
      moves++;
      if (cfg.afterMove) cfg.afterMove(api);
      render();
      if (els.btnUndo) els.btnUndo.disabled = false;
      if (cfg.isWon(api)) win();
    }

    // ---- input: pointer drag + tap ----
    var drag = null; // { group, src, cardEls, startX, startY, moved }

    function locate(cardEl) {
      var pileEl = cardEl.closest(".sol-pile");
      if (!pileEl) return null;
      var p = byId[pileEl.dataset.id];
      var idx = p.cards.findIndex(function (c) { return c.id === cardEl.dataset.id; });
      return { pile: p, index: idx };
    }

    function onDown(e) {
      if (solved) return;
      var cardEl = e.target.closest(".sol-card");
      var pileEl = e.target.closest(".sol-pile");
      if (!pileEl) return;
      var p = byId[pileEl.dataset.id];

      // Stock: tap to draw/deal
      if (p.type === "stock") { e.preventDefault(); if (cfg.onStock) commitMaybe(function () { return cfg.onStock(api); }); return; }
      if (!cardEl) {
        // tapping an empty pile slot while we have nothing to do — ignore
        return;
      }
      var loc = locate(cardEl);
      if (!loc || loc.index < 0) return;
      var group = p.cards.slice(loc.index);
      if (!cfg.canPickup(group, p, api)) return; // not a draggable card/run

      e.preventDefault();
      var cardEls = [];
      var all = p.el.querySelectorAll(":scope > .sol-card");
      for (var i = loc.index; i < all.length; i++) cardEls.push(all[i]);
      drag = { group: group, src: p, cardEls: cardEls, startX: e.clientX, startY: e.clientY, moved: false, pointerId: e.pointerId };
      try { board.setPointerCapture(e.pointerId); } catch (_) {}
    }

    function onMove(e) {
      if (!drag) return;
      var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 7) return;
      if (!drag.moved) {
        drag.moved = true;
        drag.cardEls.forEach(function (el) { el.classList.add("is-dragging"); el.style.pointerEvents = "none"; el.style.zIndex = 1000; });
      }
      drag.cardEls.forEach(function (el) { el.style.transform = "translate(" + dx + "px," + dy + "px)"; });
      // highlight a legal drop target
      var dest = pileUnder(e.clientX, e.clientY);
      board.querySelectorAll(".sol-pile.is-drop").forEach(function (n) { n.classList.remove("is-drop"); });
      if (dest && dest !== drag.src && cfg.canDrop(drag.group, dest, api)) dest.el.classList.add("is-drop");
    }

    function onUp(e) {
      if (!drag) return;
      var d = drag; drag = null;
      try { board.releasePointerCapture(e.pointerId); } catch (_) {}
      board.querySelectorAll(".sol-pile.is-drop").forEach(function (n) { n.classList.remove("is-drop"); });

      if (!d.moved) { tapMove(d.src, d.group); cleanupDrag(d); return; }

      var dest = pileUnder(e.clientX, e.clientY);
      if (dest && dest !== d.src && cfg.canDrop(d.group, dest, api)) {
        cleanupDrag(d);
        commit(function () { moveStack(d.src, dest, d.group.length); });
      } else {
        cleanupDrag(d); // snap back via re-layout
        layout();
      }
    }
    function cleanupDrag(d) {
      d.cardEls.forEach(function (el) { el.classList.remove("is-dragging"); el.style.pointerEvents = ""; el.style.zIndex = ""; el.style.transform = ""; });
    }

    function pileUnder(x, y) {
      var elm = document.elementFromPoint(x, y);
      if (!elm) return null;
      var pe = elm.closest(".sol-pile");
      return pe ? byId[pe.dataset.id] : null;
    }

    // tap = auto-move the group to the best legal destination
    function tapMove(src, group) {
      var dest = cfg.autoMove(group, src, api);
      if (dest) commit(function () { moveStack(src, dest, group.length); });
      else flashCards(group);
    }
    function flashCards(group) {
      group.forEach(function (c) {
        var el = board.querySelector('.sol-card[data-id="' + c.id + '"]');
        if (el) { el.classList.add("is-hint"); setTimeout(function () { el.classList.remove("is-hint"); }, 1200); }
      });
    }
    // like commit, but only records the move if fn() reports a change (used by stock taps)
    function commitMaybe(fn) {
      pushUndo();
      var changed = fn();
      if (!changed) { undoStack.pop(); if (els.btnUndo) els.btnUndo.disabled = undoStack.length === 0; return false; }
      ensureStarted();
      moves++;
      if (cfg.afterMove) cfg.afterMove(api);
      render();
      if (els.btnUndo) els.btnUndo.disabled = false;
      if (cfg.isWon(api)) win();
      return true;
    }

    // ---- win / message / share ----
    function setMessage(text, kind) { if (els.message) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); } }

    function win() {
      solved = true; stopTimer();
      var elapsed = Date.now() - startTs;
      var stats = loadStats(); stats.solved += 1;
      if (mode === "daily") {
        var tk = todayKey();
        if (stats.lastDaily !== tk) { stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1; stats.lastDaily = tk; }
      }
      var dk = diff || "x";
      if (!stats.best[dk] || elapsed < stats.best[dk]) stats.best[dk] = elapsed;
      LS.set(cfg.key + "_solved", stats.solved); LS.set(cfg.key + "_streak", stats.streak);
      LS.set(cfg.key + "_lastDaily", stats.lastDaily); LS.set(cfg.key + "_best", stats.best);
      renderStats();
      setMessage("🎉 Solved in " + formatTime(elapsed) + "!", "ok");
      lastElapsed = elapsed;
      showWinModal(elapsed);
    }
    var lastElapsed = 0;
    function showWinModal(elapsed) {
      var modal = document.getElementById("win-modal"); if (!modal) return;
      var sub = document.getElementById("win-sub");
      var s = loadStats();
      var txt = "Solved in " + formatTime(elapsed) + " · " + moves + " moves";
      if (mode === "daily" && s.streak > 0) txt += " · 🔥 " + s.streak + " day streak";
      if (sub) sub.textContent = txt;
      modal.hidden = false;
    }
    function hideWinModal() { var m = document.getElementById("win-modal"); if (m) m.hidden = true; }

    function shareResult() {
      var base = location.origin + location.pathname.replace(/[^/]*$/, "");
      var lines = [cfg.emoji + " " + cfg.name];
      lines.push((mode === "daily" ? "Daily · " + todayKey() : "Unlimited") + (diff ? " · " + diff : ""));
      if (solved) {
        lines.push("✅ Solved in " + formatTime(lastElapsed) + " · " + moves + " moves");
        var s = loadStats(); if (mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
      } else lines.push("Can you clear the table? " + cfg.emoji);
      lines.push(base);
      var text = lines.join("\n");
      if (navigator.share) navigator.share({ title: cfg.name, text: text }).catch(function () {});
      else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { setMessage("📋 Result copied!", "ok"); }, function () { fallbackCopy(text); });
      else fallbackCopy(text);
    }
    function fallbackCopy(text) {
      var ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); setMessage("📋 Result copied!", "ok"); } catch (e) { setMessage("Couldn't copy.", "warn"); }
      document.body.removeChild(ta);
    }

    // ---- new game ----
    function newGame(m, d) {
      mode = m || "unlimited";
      if (d) diff = d;
      solved = false; started = false; moves = 0; undoStack = []; stopTimer();
      if (els.btnUndo) els.btnUndo.disabled = true;
      buildLayout();
      var rng = mode === "daily" ? mulberry32(dailySeed() + (cfg.seedSalt || 0)) : Math.random;
      var deck = shuffle(cfg.makeDeck(diff), rng);
      cfg.deal(api, deck);
      if (cfg.afterMove) cfg.afterMove(api, true);
      render();
      setMessage("", "");
      if (els.timer) els.timer.textContent = "0:00";
      renderStats();
      hideWinModal();
    }

    // ---- public API handed to the game config ----
    var api = {
      SUITS: SUITS, RANKS: RANKS, isRed: isRed,
      pile: pile, piles: function () { return piles; },
      pilesByZone: function (z) { return piles.filter(function (p) { return p.zone === z; }); },
      moveStack: moveStack,
      diff: function () { return diff; },
      mode: function () { return mode; },
      newCard: function (suit, rank, faceUp) { return { suit: suit, rank: rank, faceUp: !!faceUp, id: suit + "_" + rank + "_" + (idCounter++) }; },
      setMessage: setMessage,
      render: render
    };
    var idCounter = 0;

    // ---- boot ----
    function boot() {
      root = document.getElementById("sol");
      board = document.getElementById("board");
      els.modeLabel = document.getElementById("mode-label");
      els.timer = document.getElementById("timer");
      els.message = document.getElementById("message");
      els.statSolved = document.getElementById("stat-solved");
      els.statStreak = document.getElementById("stat-streak");
      els.statBest = document.getElementById("stat-best");
      els.found = document.getElementById("found-count");
      els.btnUndo = document.getElementById("btn-undo");

      board.addEventListener("pointerdown", onDown);
      board.addEventListener("pointermove", onMove);
      board.addEventListener("pointerup", onUp);
      board.addEventListener("pointercancel", function () { if (drag) { cleanupDrag(drag); drag = null; layout(); } });
      window.addEventListener("resize", layout);

      var diffSel = document.getElementById("diff-select");
      var btnNew = document.getElementById("btn-new");
      if (btnNew) btnNew.addEventListener("click", function () { newGame("unlimited", diffSel ? diffSel.value : undefined); });
      if (diffSel) diffSel.addEventListener("change", function () { newGame("unlimited", diffSel.value); });
      var btnDaily = document.getElementById("btn-daily");
      if (btnDaily) btnDaily.addEventListener("click", function () { newGame("daily", diffSel ? diffSel.value : undefined); });
      if (els.btnUndo) els.btnUndo.addEventListener("click", undo);
      var btnShare = document.getElementById("btn-share");
      if (btnShare) btnShare.addEventListener("click", shareResult);

      var winNew = document.getElementById("win-new"); if (winNew) winNew.addEventListener("click", function () { newGame("unlimited", diffSel ? diffSel.value : undefined); });
      var winShare = document.getElementById("win-share"); if (winShare) winShare.addEventListener("click", shareResult);
      var winClose = document.getElementById("win-close"); if (winClose) winClose.addEventListener("click", hideWinModal);

      newGame("unlimited", diff || (diffSel ? diffSel.value : undefined));
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();

    return api;
  }

  return { create: create, isRed: isRed, dailySeed: dailySeed };
})();
