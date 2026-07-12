/*
 * Hashi — game UI & interaction layer. Depends on generator.js (window.Hashi).
 * The board is SVG: tap the space between two aligned islands to cycle the
 * bridge count 0 → 1 → 2 → 0. Islands fill amber when their number is exact.
 */
(function () {
  "use strict";

  const CELL = 40, R = 13;

  const els = {};
  let state = null; // { size, islands, solution, counts:{}, pairs, mode, solved, startTs, elapsedMs }
  let timerId = null;
  let coach = null; // explanatory-hint controller (window.HintCoach)

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function todayKey(date) { const d = date || new Date(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function yesterdayKey() { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return todayKey(d); }
  function loadStats() {
    return { solved: LS.get("hs_solved", 0), streak: LS.get("hs_streak", 0), lastDaily: LS.get("hs_lastDaily", null), best: LS.get("hs_best_" + (state ? state.size : 11), null) };
  }
  function renderStats() {
    const s = loadStats();
    els.statSolved.textContent = s.solved;
    els.statStreak.textContent = s.streak;
    els.statBest.textContent = s.best ? formatTime(s.best) : "—";
  }

  function formatTime(ms) { const t = Math.floor(ms / 1000); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }
  function startTimer() { stopTimer(); state.startTs = Date.now(); timerId = setInterval(() => { els.timer.textContent = formatTime(Date.now() - state.startTs); }, 500); }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function pairKey(a, b) { return a < b ? a + "-" + b : b + "-" + a; }

  function newGame(mode) {
    const size = mode === "daily" ? 11 : +els.size.value;
    const opts = { size: size };
    if (mode === "daily") opts.seed = window.Hashi.dailySeed();
    const p = window.Hashi.generate(opts);
    // aligned island pairs with no island strictly between (static geometry)
    const pairs = [];
    const cell = {};
    p.islands.forEach((isl, i) => { cell[isl.r + "," + isl.c] = i; });
    for (let i = 0; i < p.islands.length; i++) {
      const A = p.islands[i];
      // walk east and south only (each pair found once)
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        let r = A.r + dr, c = A.c + dc;
        while (r < p.size && c < p.size) {
          const j = cell[r + "," + c];
          if (j !== undefined) {
            if (Math.abs(r - A.r) + Math.abs(c - A.c) >= 2) pairs.push({ a: i, b: j });
            break;
          }
          r += dr; c += dc;
        }
      }
    }
    const solCounts = {};
    p.solution.forEach((e) => { solCounts[pairKey(e.a, e.b)] = e.count; });
    state = {
      size: p.size, islands: p.islands, pairs: pairs, solCounts: solCounts,
      counts: {}, mode: mode, solved: false, elapsedMs: 0
    };
    els.modeLabel.textContent = mode === "daily" ? "Daily Challenge · " + todayKey() : "Unlimited · " + p.islands.length + " islands";
    if (mode === "daily") els.size.value = String(p.size);
    hideWinModal();
    if (coach) coach.reset();
    cancelConflictTimer();
    buildBoard();
    render();
    setMessage("", "");
    els.timer.textContent = "0:00";
    startTimer();
    renderStats();
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function ix(i) { return state.islands[i].c * CELL + CELL / 2; }
  function iy(i) { return state.islands[i].r * CELL + CELL / 2; }

  function buildBoard() {
    const n = state.size;
    els.board.innerHTML = "";
    els.board.setAttribute("viewBox", "0 0 " + n * CELL + " " + n * CELL);
    els.board.classList.remove("is-won");

    state.bridgeLayer = svgEl("g", {});
    els.board.appendChild(state.bridgeLayer);

    // hit zones between island rims
    for (let pi = 0; pi < state.pairs.length; pi++) {
      const { a, b } = state.pairs[pi];
      const horiz = state.islands[a].r === state.islands[b].r;
      const pad = R + 4;
      const x1 = ix(a) + (horiz ? (ix(b) > ix(a) ? pad : -pad) : 0);
      const y1 = iy(a) + (horiz ? 0 : (iy(b) > iy(a) ? pad : -pad));
      const x2 = ix(b) + (horiz ? (ix(b) > ix(a) ? -pad : pad) : 0);
      const y2 = iy(b) + (horiz ? 0 : (iy(b) > iy(a) ? -pad : pad));
      const hit = svgEl("line", { x1: x1, y1: y1, x2: x2, y2: y2, "class": "hs-hit" });
      hit.dataset.pair = pairKey(a, b);
      els.board.appendChild(hit);
    }

    state.islandEls = [];
    state.islands.forEach((isl, i) => {
      const g = svgEl("g", { "class": "hs-island" });
      g.appendChild(svgEl("circle", { cx: ix(i), cy: iy(i), r: R }));
      const t = svgEl("text", { x: ix(i), y: iy(i), "text-anchor": "middle", "dominant-baseline": "central" });
      t.textContent = isl.num;
      g.appendChild(t);
      els.board.appendChild(g);
      state.islandEls.push(g);
    });
  }

  function bodyMap(exceptKey) {
    // cells occupied by bridge bodies, keyed "r,c" -> "h"/"v"
    const map = {};
    for (const k in state.counts) {
      if (!state.counts[k] || k === exceptKey) continue;
      const [a, b] = k.split("-").map(Number);
      const A = state.islands[a], B = state.islands[b];
      if (A.r === B.r) for (let c = Math.min(A.c, B.c) + 1; c < Math.max(A.c, B.c); c++) map[A.r + "," + c] = "h";
      else for (let r = Math.min(A.r, B.r) + 1; r < Math.max(A.r, B.r); r++) map[r + "," + A.c] = "v";
    }
    return map;
  }
  function pathCells(a, b) {
    const A = state.islands[a], B = state.islands[b], out = [];
    if (A.r === B.r) for (let c = Math.min(A.c, B.c) + 1; c < Math.max(A.c, B.c); c++) out.push(A.r + "," + c);
    else for (let r = Math.min(A.r, B.r) + 1; r < Math.max(A.r, B.r); r++) out.push(r + "," + A.c);
    return out;
  }

  function degree(i) {
    let sum = 0;
    for (const k in state.counts) {
      if (!state.counts[k]) continue;
      const [a, b] = k.split("-").map(Number);
      if (a === i || b === i) sum += state.counts[k];
    }
    return sum;
  }

  function render() {
    state.bridgeLayer.innerHTML = "";
    for (const k in state.counts) {
      const cnt = state.counts[k];
      if (!cnt) continue;
      const [a, b] = k.split("-").map(Number);
      const horiz = state.islands[a].r === state.islands[b].r;
      const offs = cnt === 1 ? [0] : [-3.4, 3.4];
      for (const o of offs) {
        state.bridgeLayer.appendChild(svgEl("line", {
          x1: ix(a) + (horiz ? 0 : o), y1: iy(a) + (horiz ? o : 0),
          x2: ix(b) + (horiz ? 0 : o), y2: iy(b) + (horiz ? o : 0),
          "class": "hs-bridge"
        }));
      }
    }
    state.islands.forEach((isl, i) => {
      const d = degree(i);
      state.islandEls[i].classList.toggle("is-done", d === isl.num);
    });
  }

  function cycle(k) {
    if (state.solved) return;
    coach.reset();
    const cur = state.counts[k] || 0;
    if (cur === 0) {
      // adding the first bridge must not cross an existing one
      const [a, b] = k.split("-").map(Number);
      const bodies = bodyMap(k);
      if (pathCells(a, b).some((cc) => bodies[cc])) {
        setMessage("Bridges can't cross each other.", "warn");
        return;
      }
      state.counts[k] = 1;
    } else if (cur === 1) state.counts[k] = 2;
    else state.counts[k] = 0;
    render();
    scheduleConflicts();
    checkWin();
  }

  // ---- validation --------------------------------------------------------
  function findOverfull() {
    const bad = [];
    state.islands.forEach((isl, i) => { if (degree(i) > isl.num) bad.push(i); });
    return bad;
  }
  let conflictTimer = null;
  function clearConflictMarks() { state.islandEls.forEach((g) => g.classList.remove("is-bad")); }
  function applyConflicts() {
    clearConflictMarks();
    findOverfull().forEach((i) => state.islandEls[i].classList.add("is-bad"));
  }
  function cancelConflictTimer() { if (conflictTimer) { clearTimeout(conflictTimer); conflictTimer = null; } }
  function scheduleConflicts() {
    clearConflictMarks();
    cancelConflictTimer();
    conflictTimer = setTimeout(applyConflicts, 1000);
  }

  function checkWin() {
    for (let i = 0; i < state.islands.length; i++)
      if (degree(i) !== state.islands[i].num) return false;
    // connectivity
    const k = state.islands.length;
    const adj = Array.from({ length: k }, () => []);
    for (const kk in state.counts) {
      if (!state.counts[kk]) continue;
      const [a, b] = kk.split("-").map(Number);
      adj[a].push(b); adj[b].push(a);
    }
    const seen = new Array(k).fill(false); seen[0] = true; let cnt = 1; const st = [0];
    while (st.length) { const cur = st.pop(); for (const j of adj[cur]) if (!seen[j]) { seen[j] = true; cnt++; st.push(j); } }
    if (cnt !== k) { setMessage("All numbers match — but the network must be one connected whole.", "warn"); return false; }
    win(); return true;
  }
  function win() {
    state.solved = true; stopTimer();
    cancelConflictTimer(); clearConflictMarks();
    els.board.classList.add("is-won");
    const elapsed = Date.now() - state.startTs; state.elapsedMs = elapsed;
    const stats = loadStats(); stats.solved += 1;
    if (state.mode === "daily") {
      const tk = todayKey();
      if (stats.lastDaily !== tk) { stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1; stats.lastDaily = tk; }
    }
    if (!stats.best || elapsed < stats.best) stats.best = elapsed;
    LS.set("hs_solved", stats.solved); LS.set("hs_streak", stats.streak); LS.set("hs_lastDaily", stats.lastDaily); LS.set("hs_best_" + state.size, stats.best);
    renderStats();
    setMessage("All islands connected in " + formatTime(elapsed) + "!", "ok");
    showWinModal(elapsed);
  }

  function showWinModal(elapsed) {
    const modal = document.getElementById("win-modal");
    if (!modal) return;
    const sub = document.getElementById("win-sub");
    const s = loadStats();
    let txt = "Connected in " + formatTime(elapsed);
    if (state.mode === "daily" && s.streak > 0) txt += " · " + s.streak + " day streak";
    if (sub) sub.textContent = txt;
    modal.hidden = false;
  }
  function hideWinModal() { const m = document.getElementById("win-modal"); if (m) m.hidden = true; }

  function hint() {
    if (state.solved) return;
    // an extra bridge poisons the counting — point at it first
    for (const k in state.counts) {
      if ((state.counts[k] || 0) > (state.solCounts[k] || 0)) {
        coach.reset();
        const [a, b] = k.split("-").map(Number);
        flashIsland(a); flashIsland(b);
        setMessage("There's an extra bridge between the flashing islands.", "warn");
        return;
      }
    }
    coach.press();
  }

  // ---- explanatory hints: capacity counting, spelled out -------------------
  function explainHint() {
    const k = state.islands.length;
    const rem = (i) => state.islands[i].num - degree(i);

    for (let i = 0; i < k; i++) {
      const ri = rem(i);
      if (ri <= 0) continue;
      // neighbors that can still accept bridges from i
      const nbs = [];
      for (const pr of state.pairs) {
        if (pr.a !== i && pr.b !== i) continue;
        const j = pr.a === i ? pr.b : pr.a;
        const kk = pairKey(i, j);
        const placed = state.counts[kk] || 0;
        const cap = Math.min(2 - placed, rem(j), ri);
        if (cap <= 0) continue;
        if (placed === 0) {
          const bodies = bodyMap(kk);
          if (pathCells(i, j).some((cc) => bodies[cc])) continue; // crossed off
        }
        nbs.push({ j: j, key: kk, cap: cap });
      }
      const total = nbs.reduce((s, x) => s + x.cap, 0);
      if (total < ri) continue; // inconsistent corner — let the player untangle first
      for (const nb of nbs) {
        const need = ri - (total - nb.cap);
        if (need > 0)
          return {
            premise: [state.islandEls[i]].concat(nbs.filter((x) => x.j !== nb.j).map((x) => state.islandEls[x.j])),
            target: [state.islandEls[nb.j]],
            text: "Count the capacity: the dashed island still needs " + ri + " bridge" + (ri > 1 ? "s" : "") + ", but its other neighbors can take only " + (total - nb.cap) + " in total — so at least " + need + " must go to the green island",
            apply: () => {
              setMessage("", "");
              state.counts[nb.key] = (state.counts[nb.key] || 0) + need;
              render();
              scheduleConflicts();
              checkWin();
            }
          };
      }
    }
    // fallback: connectivity-flavored link from the solution
    const missing = [];
    for (const kk in state.solCounts)
      if ((state.counts[kk] || 0) < state.solCounts[kk]) missing.push(kk);
    if (!missing.length) return null;
    const kk = missing[Math.floor(Math.random() * missing.length)];
    const [a, b] = kk.split("-").map(Number);
    return {
      premise: [],
      target: [state.islandEls[a], state.islandEls[b]],
      text: "No pure counting move fires here — this link comes from keeping the network in one piece. Add a bridge between the highlighted islands",
      apply: () => {
        setMessage("", "");
        state.counts[kk] = (state.counts[kk] || 0) + 1;
        render();
        scheduleConflicts();
        checkWin();
      }
    };
  }
  function flashIsland(i) {
    const g = state.islandEls[i];
    g.classList.add("flash");
    setTimeout(() => g.classList.remove("flash"), 900);
  }

  function clearBoard() {
    if (!state) return;
    state.counts = {};
    state.solved = false;
    els.board.classList.remove("is-won");
    coach.reset();
    render();
    cancelConflictTimer(); clearConflictMarks(); setMessage("", ""); startTimer();
  }
  function setMessage(text, kind) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); }

  function shareResult() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const lines = ["🌉 Hashi"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Unlimited · " + state.islands.length + " islands");
    if (state.solved) {
      lines.push("✅ Connected in " + formatTime(state.elapsedMs) + " ⏱️");
      const s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
    } else lines.push("Can you connect all the islands? 🌉");
    lines.push(base);
    const text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "Hashi", text: text }).catch(function () {});
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { setMessage("Result copied — paste it anywhere!", "ok"); }, function () { fallbackCopy(text); });
    else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); setMessage("Result copied!", "ok"); } catch (e) { setMessage("Couldn't copy — long-press to copy.", "warn"); }
    document.body.removeChild(ta);
  }

  function onBoardClick(e) {
    const hit = e.target.closest && e.target.closest(".hs-hit");
    if (!hit || state.solved) return;
    cycle(hit.dataset.pair);
  }

  function boot() {
    els.board = document.getElementById("board");
    els.timer = document.getElementById("timer");
    els.message = document.getElementById("message");
    els.modeLabel = document.getElementById("mode-label");
    els.statSolved = document.getElementById("stat-solved");
    els.statStreak = document.getElementById("stat-streak");
    els.statBest = document.getElementById("stat-best");
    els.size = document.getElementById("size");

    coach = window.HintCoach.create({ explain: explainHint, message: (t) => setMessage(t, "") });

    els.board.addEventListener("click", onBoardClick);
    document.getElementById("btn-new").addEventListener("click", () => newGame("unlimited"));
    document.getElementById("btn-daily").addEventListener("click", () => newGame("daily"));
    document.getElementById("btn-hint").addEventListener("click", hint);
    document.getElementById("btn-clear").addEventListener("click", clearBoard);
    document.getElementById("btn-share").addEventListener("click", shareResult);
    els.size.addEventListener("change", () => newGame("unlimited"));

    const winNew = document.getElementById("win-new");
    if (winNew) winNew.addEventListener("click", () => newGame("unlimited"));
    const winShare = document.getElementById("win-share");
    if (winShare) winShare.addEventListener("click", shareResult);
    const winClose = document.getElementById("win-close");
    if (winClose) winClose.addEventListener("click", hideWinModal);

    newGame("unlimited");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
