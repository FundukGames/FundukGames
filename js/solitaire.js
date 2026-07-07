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
    var corner = r + '<span class="s">' + s + "</span>";
    el.innerHTML =
      '<div class="sol-card__corner sol-card__corner--tl">' + corner + "</div>" +
      '<div class="sol-card__pip">' + s + "</div>" +
      '<div class="sol-card__corner sol-card__corner--br">' + corner + "</div>";
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
      // 10-column Spider must fit a 390px phone: allow narrower tracks there
      tab.style.gridTemplateColumns = "repeat(" + lay.tableau.length + ", minmax(" + (lay.tableau.length >= 10 ? 26 : 34) + "px, 1fr))";
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

    // ---- render piles → cards (with smooth FLIP / deal / flip animations) ----
    var prevFace = {}; // id -> faceUp, from the previous render, to detect cards turning over

    function captureRects() {
      var m = {};
      board.querySelectorAll(".sol-card").forEach(function (el) { m[el.dataset.id] = el.getBoundingClientRect(); });
      return m;
    }
    function flippedIds() {
      var ids = {};
      piles.forEach(function (p) { p.cards.forEach(function (c) { if (c.faceUp && prevFace[c.id] === false) ids[c.id] = true; }); });
      return ids;
    }
    function rememberFaces() {
      prevFace = {};
      piles.forEach(function (p) { p.cards.forEach(function (c) { prevFace[c.id] = c.faceUp; }); });
    }

    function render(opts) {
      opts = opts || {};
      var oldRects = opts.flip ? captureRects() : null;
      var flips = opts.flip ? flippedIds() : {};

      piles.forEach(function (p) {
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
        var frag = document.createDocumentFragment();
        p.cards.forEach(function (card) { frag.appendChild(makeCardEl(card)); });
        p.el.querySelectorAll(":scope > .sol-card").forEach(function (n) { n.remove(); });
        p.el.appendChild(frag);
      });

      layout();

      if (opts.deal) animateDeal();
      else if (oldRects) playFlip(oldRects, flips);

      rememberFaces();
      updateBar();
    }

    function animateDeal() {
      var i = 0;
      board.querySelectorAll(".sol-card").forEach(function (el) {
        el.classList.add("sol-deal");
        el.style.animationDelay = Math.min(i * 11, 520) + "ms";
        i++;
        el.addEventListener("animationend", function ae() { el.classList.remove("sol-deal"); el.style.animationDelay = ""; el.removeEventListener("animationend", ae); });
      });
    }

    function playFlip(oldRects, flips) {
      board.querySelectorAll(".sol-card").forEach(function (el) {
        var id = el.dataset.id;
        if (flips[id]) { el.classList.add("sol-flip"); el.addEventListener("animationend", function fe() { el.classList.remove("sol-flip"); el.removeEventListener("animationend", fe); }); return; }
        var old = oldRects[id];
        if (!old) return;
        var nw = el.getBoundingClientRect();
        var dx = old.left - nw.left, dy = old.top - nw.top;
        if (!dx && !dy) return;
        el.style.transition = "none";
        el.style.transform = "translate(" + dx + "px," + dy + "px)";
        el.classList.add("sol-moving");
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          el.style.transition = "transform .24s ease";
          el.style.transform = "";
        }); });
        el.addEventListener("transitionend", function te() { el.style.transition = ""; el.classList.remove("sol-moving"); el.removeEventListener("transitionend", te); });
      });
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
      render({ flip: true });
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
      render({ flip: true });
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
        // commit first so the FLIP slide starts from where the cards were dropped
        commit(function () { moveStack(d.src, dest, d.group.length); });
        cleanupDrag(d); // the dragged nodes are now detached; this just tidies their styles
      } else {
        snapBack(d); // smooth return to the source pile
      }
    }
    function cleanupDrag(d) {
      d.cardEls.forEach(function (el) { el.classList.remove("is-dragging"); el.style.pointerEvents = ""; el.style.zIndex = ""; el.style.transition = ""; el.style.transform = ""; });
    }
    function snapBack(d) {
      d.cardEls.forEach(function (el) {
        el.style.transition = "transform .2s ease";
        el.style.transform = "";
        el.style.pointerEvents = "";
        el.classList.remove("is-dragging");
        el.addEventListener("transitionend", function te() { el.style.transition = ""; el.style.zIndex = ""; el.removeEventListener("transitionend", te); });
      });
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
      render({ flip: true });
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
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) showWinModal(elapsed);
      else winCascade(function () { showWinModal(elapsed); });
    }
    var lastElapsed = 0;

    // The classic Solitaire "bouncing cards" celebration — foundation cards fall,
    // bounce off the bottom and leave a trail across the screen.
    function winCascade(done) {
      var tops = [];
      api.pilesByZone("foundations").forEach(function (p) {
        var cels = p.el.querySelectorAll(":scope > .sol-card");
        if (cels.length) tops.push(cels[cels.length - 1]);
      });
      if (!tops.length) { done(); return; }
      var layer = document.createElement("div");
      layer.style.cssText = "position:fixed;inset:0;z-index:1500;pointer-events:none;overflow:hidden;";
      document.body.appendChild(layer);
      var W = window.innerWidth, H = window.innerHeight;
      var balls = tops.map(function (el, i) {
        var r = el.getBoundingClientRect();
        return { html: el.outerHTML, w: r.width, h: r.height, x: r.left, y: r.top,
          vx: (i % 2 ? 1 : -1) * (2.2 + Math.random() * 3.2), vy: -(2 + Math.random() * 4) };
      });
      var GRAV = 0.5, BOUNCE = 0.8, frames = 0, MAX = 200, finished = false;
      function finish() { if (finished) return; finished = true; layer.remove(); done(); }
      function step() {
        frames++;
        var anyVisible = false;
        for (var i = 0; i < balls.length; i++) {
          var b = balls[i];
          b.vy += GRAV; b.x += b.vx; b.y += b.vy;
          if (b.y + b.h > H) { b.y = H - b.h; b.vy = -Math.abs(b.vy) * BOUNCE; }
          if (b.x > -b.w && b.x < W) anyVisible = true;
          var holder = document.createElement("div");
          holder.innerHTML = b.html;
          var card = holder.firstChild;
          card.style.position = "absolute"; card.style.margin = "0";
          card.style.left = b.x + "px"; card.style.top = b.y + "px";
          card.style.width = b.w + "px"; card.style.height = b.h + "px";
          layer.appendChild(card);
        }
        if (frames < MAX && anyVisible) requestAnimationFrame(step);
        else finish();
      }
      requestAnimationFrame(step);
    }
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
      prevFace = {};
      render({ deal: true });
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
