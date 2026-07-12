/*
 * SunMoon — game UI & interaction layer. Depends on generator.js (window.SunMoon).
 * Tap a non-given cell to cycle: empty → ☀ → 🌙 → empty.
 */
(function () {
  "use strict";

  const EMPTY = -1, SUN = 0, MOON = 1;
  const GLYPH = { 0: "☀️", 1: "🌙" };

  const els = {};
  let state = null; // { size, solution, givens, h, v, marks, mode, solved, elapsedMs, startTs }
  let timerId = null;
  let coach = null; // explanatory-hint controller (window.HintCoach)

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function todayKey(date) { const d = date || new Date(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function yesterdayKey() { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return todayKey(d); }
  function loadStats() {
    return { solved: LS.get("sm_solved", 0), streak: LS.get("sm_streak", 0), lastDaily: LS.get("sm_lastDaily", null), best: LS.get("sm_best", null) };
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

  function newGame(mode) {
    const opts = { size: 6 };
    if (mode === "daily") opts.seed = window.SunMoon.dailySeed();
    const p = window.SunMoon.generate(opts);
    const marks = p.givens.map((row) => row.slice()); // givens locked in
    state = { size: p.size, solution: p.solution, givens: p.givens, h: p.h, v: p.v, marks: marks, mode: mode, solved: false, elapsedMs: 0 };
    els.modeLabel.textContent = mode === "daily" ? "Daily Challenge · " + todayKey() : "Unlimited · " + p.size + "×" + p.size;
    hideWinModal();
    if (coach) coach.reset();
    cancelConflictTimer();
    buildBoard();
    setMessage("", "");
    els.timer.textContent = "0:00";
    startTimer();
    renderStats();
  }

  function buildBoard() {
    const n = state.size, board = els.board;
    board.innerHTML = "";
    board.style.setProperty("--n", n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "sm-cell" + (state.givens[r][c] !== -1 ? " is-given" : "");
        cell.dataset.r = r; cell.dataset.c = c;
        cell.setAttribute("aria-label", "row " + (r + 1) + " column " + (c + 1));
        board.appendChild(cell);
        paintCell(r, c);
      }
    }
    // Edge clues (= / ✕) positioned over the borders between cells.
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (c < n - 1 && state.h[r][c]) addEdge(state.h[r][c], (c + 1) / n * 100, (r + 0.5) / n * 100);
        if (r < n - 1 && state.v[r][c]) addEdge(state.v[r][c], (c + 0.5) / n * 100, (r + 1) / n * 100);
      }
    }
  }
  function addEdge(kind, leftPct, topPct) {
    const e = document.createElement("div");
    e.className = "sm-edge" + (kind === 2 ? " sm-edge--ne" : "");
    e.textContent = kind === 1 ? "=" : "✕";
    e.style.left = leftPct + "%";
    e.style.top = topPct + "%";
    els.board.appendChild(e);
  }

  function cellAt(r, c) { return els.board.querySelector('.sm-cell[data-r="' + r + '"][data-c="' + c + '"]'); }
  function paintCell(r, c) {
    const cell = cellAt(r, c); if (!cell) return;
    const v = state.marks[r][c];
    cell.classList.toggle("is-sun", v === SUN);
    cell.classList.toggle("is-moon", v === MOON);
    cell.textContent = "";
  }

  function onBoardClick(e) {
    const cell = e.target.closest && e.target.closest(".sm-cell");
    if (!cell || state.solved) return;
    coach.reset();
    const r = +cell.dataset.r, c = +cell.dataset.c;
    if (state.givens[r][c] !== EMPTY) { flash(cell); return; } // locked
    state.marks[r][c] = state.marks[r][c] === EMPTY ? SUN : state.marks[r][c] === SUN ? MOON : EMPTY;
    paintCell(r, c);
    scheduleConflicts();
    checkWin();
  }

  // ---- validation --------------------------------------------------------
  function findConflicts() {
    const n = state.size, half = n / 2, m = state.marks, bad = new Set();
    const add = (r, c) => bad.add(r + "," + c);
    // 3-in-a-row + row balance
    for (let r = 0; r < n; r++) {
      const cnt = [0, 0];
      for (let c = 0; c < n; c++) {
        const v = m[r][c]; if (v !== EMPTY) cnt[v]++;
        if (c >= 2 && v !== EMPTY && m[r][c - 1] === v && m[r][c - 2] === v) { add(r, c); add(r, c - 1); add(r, c - 2); }
      }
      [SUN, MOON].forEach((v) => { if (cnt[v] > half) for (let c = 0; c < n; c++) if (m[r][c] === v) add(r, c); });
    }
    // 3-in-a-col + col balance
    for (let c = 0; c < n; c++) {
      const cnt = [0, 0];
      for (let r = 0; r < n; r++) {
        const v = m[r][c]; if (v !== EMPTY) cnt[v]++;
        if (r >= 2 && v !== EMPTY && m[r - 1][c] === v && m[r - 2][c] === v) { add(r, c); add(r - 1, c); add(r - 2, c); }
      }
      [SUN, MOON].forEach((v) => { if (cnt[v] > half) for (let r = 0; r < n; r++) if (m[r][c] === v) add(r, c); });
    }
    // edge clues
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        if (c < n - 1 && state.h[r][c] && m[r][c] !== EMPTY && m[r][c + 1] !== EMPTY) {
          const same = m[r][c] === m[r][c + 1];
          if ((state.h[r][c] === 1) !== same) { add(r, c); add(r, c + 1); }
        }
        if (r < n - 1 && state.v[r][c] && m[r][c] !== EMPTY && m[r + 1][c] !== EMPTY) {
          const same = m[r][c] === m[r + 1][c];
          if ((state.v[r][c] === 1) !== same) { add(r, c); add(r + 1, c); }
        }
      }
    return bad;
  }
  // Conflict highlighting is debounced ~1s: old red marks clear instantly when
  // you act, and "incorrect" cells only light up if you pause — so you're not
  // told you're wrong on every single tap mid-solve.
  let conflictTimer = null;
  function clearConflictMarks() {
    els.board.querySelectorAll(".sm-cell.is-bad").forEach((c) => c.classList.remove("is-bad"));
  }
  function applyConflicts() {
    clearConflictMarks();
    findConflicts().forEach((key) => { const [r, c] = key.split(","); const cell = cellAt(r, c); if (cell) cell.classList.add("is-bad"); });
  }
  function cancelConflictTimer() { if (conflictTimer) { clearTimeout(conflictTimer); conflictTimer = null; } }
  function scheduleConflicts() {
    clearConflictMarks();
    cancelConflictTimer();
    conflictTimer = setTimeout(applyConflicts, 1000);
  }
  function isFull() {
    for (let r = 0; r < state.size; r++) for (let c = 0; c < state.size; c++) if (state.marks[r][c] === EMPTY) return false;
    return true;
  }
  function checkWin() {
    if (!isFull()) return false;
    if (findConflicts().size > 0) return false;
    win(); return true;
  }
  function win() {
    state.solved = true; stopTimer();
    cancelConflictTimer(); clearConflictMarks();
    const elapsed = Date.now() - state.startTs; state.elapsedMs = elapsed;
    const stats = loadStats(); stats.solved += 1;
    if (state.mode === "daily") {
      const tk = todayKey();
      if (stats.lastDaily !== tk) { stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1; stats.lastDaily = tk; }
    }
    if (!stats.best || elapsed < stats.best) stats.best = elapsed;
    LS.set("sm_solved", stats.solved); LS.set("sm_streak", stats.streak); LS.set("sm_lastDaily", stats.lastDaily); LS.set("sm_best", stats.best);
    renderStats();
    setMessage("Solved in " + formatTime(elapsed) + "!", "ok");
    showWinModal(elapsed);
  }

  function showWinModal(elapsed) {
    const modal = document.getElementById("win-modal");
    if (!modal) return;
    const sub = document.getElementById("win-sub");
    const s = loadStats();
    let txt = "Solved in " + formatTime(elapsed);
    if (state.mode === "daily" && s.streak > 0) txt += " · " + s.streak + " day streak";
    if (sub) sub.textContent = txt;
    modal.hidden = false;
  }
  function hideWinModal() { const m = document.getElementById("win-modal"); if (m) m.hidden = true; }

  function hint() {
    if (state.solved) return;
    // a wrong filled cell trumps any teaching — point at it first
    for (let r = 0; r < state.size; r++)
      for (let c = 0; c < state.size; c++)
        if (state.givens[r][c] === EMPTY && state.marks[r][c] !== EMPTY && state.marks[r][c] !== state.solution[r][c]) {
          coach.reset();
          flash(cellAt(r, c)); setMessage("That one's wrong — try clearing it.", "warn"); return;
        }
    coach.press();
  }

  // ---- explanatory hints: find the next FORCED move and say why -----------
  const GLYPH2 = { 0: "☀️", 1: "🌙" };

  // rule-based propagation on a marks copy; returns true on contradiction
  function propagateBad(g) {
    const n = state.size, half = n / 2;
    let changed = true, bad = false;
    function set(r, c, v) {
      if (g[r][c] === v) return;
      if (g[r][c] !== EMPTY) { bad = true; return; }
      g[r][c] = v; changed = true;
    }
    while (changed && !bad) {
      changed = false;
      for (let r = 0; r < n && !bad; r++) {
        let z = 0, o = 0;
        for (let c = 0; c < n; c++) { if (g[r][c] === 0) z++; else if (g[r][c] === 1) o++; }
        if (z > half || o > half) bad = true;
        else if (z === half) for (let c = 0; c < n; c++) { if (g[r][c] === EMPTY) set(r, c, 1); }
        else if (o === half) for (let c = 0; c < n; c++) { if (g[r][c] === EMPTY) set(r, c, 0); }
      }
      for (let c = 0; c < n && !bad; c++) {
        let z = 0, o = 0;
        for (let r = 0; r < n; r++) { if (g[r][c] === 0) z++; else if (g[r][c] === 1) o++; }
        if (z > half || o > half) bad = true;
        else if (z === half) for (let r = 0; r < n; r++) { if (g[r][c] === EMPTY) set(r, c, 1); }
        else if (o === half) for (let r = 0; r < n; r++) { if (g[r][c] === EMPTY) set(r, c, 0); }
      }
      const tri = (a, b, cc) => {
        const va = g[a[0]][a[1]], vb = g[b[0]][b[1]], vc = g[cc[0]][cc[1]];
        if (va !== EMPTY && va === vb && vb === vc) { bad = true; return; }
        if (va !== EMPTY && va === vb && vc === EMPTY) set(cc[0], cc[1], 1 - va);
        else if (vb !== EMPTY && vb === vc && va === EMPTY) set(a[0], a[1], 1 - vb);
        else if (va !== EMPTY && va === vc && vb === EMPTY) set(b[0], b[1], 1 - va);
      };
      for (let r = 0; r < n && !bad; r++) for (let c = 0; c + 2 < n && !bad; c++) tri([r, c], [r, c + 1], [r, c + 2]);
      for (let c = 0; c < n && !bad; c++) for (let r = 0; r + 2 < n && !bad; r++) tri([r, c], [r + 1, c], [r + 2, c]);
      for (let r = 0; r < n && !bad; r++) {
        for (let c = 0; c < n && !bad; c++) {
          if (c < n - 1 && state.h[r][c]) {
            const a = g[r][c], b = g[r][c + 1], same = state.h[r][c] === 1;
            if (a !== EMPTY && b !== EMPTY && (a === b) !== same) bad = true;
            else if (a !== EMPTY && b === EMPTY) set(r, c + 1, same ? a : 1 - a);
            else if (b !== EMPTY && a === EMPTY) set(r, c, same ? b : 1 - b);
          }
          if (r < n - 1 && state.v[r][c]) {
            const a = g[r][c], b = g[r + 1][c], same = state.v[r][c] === 1;
            if (a !== EMPTY && b !== EMPTY && (a === b) !== same) bad = true;
            else if (a !== EMPTY && b === EMPTY) set(r + 1, c, same ? a : 1 - a);
            else if (b !== EMPTY && a === EMPTY) set(r, c, same ? b : 1 - b);
          }
        }
      }
    }
    return bad;
  }

  function explainHint() {
    const n = state.size, m = state.marks, half = n / 2;
    const val = (rc) => m[rc[0]][rc[1]];
    const mk = (premise, target, text, moves) => ({
      premise: premise.map((rc) => cellAt(rc[0], rc[1])),
      target: target.map((rc) => cellAt(rc[0], rc[1])),
      text: text,
      apply: () => {
        moves.forEach((mv) => { state.marks[mv[0]][mv[1]] = mv[2]; paintCell(mv[0], mv[1]); });
        setMessage("", "");
        scheduleConflicts(); checkWin();
      }
    });

    // 1) no-three: a pair forces its ends; a gap between twins is forced
    const trips = [];
    for (let r = 0; r < n; r++) for (let c = 0; c + 2 < n; c++) trips.push([[r, c], [r, c + 1], [r, c + 2]]);
    for (let c = 0; c < n; c++) for (let r = 0; r + 2 < n; r++) trips.push([[r, c], [r + 1, c], [r + 2, c]]);
    for (const [A, B, C] of trips) {
      const va = val(A), vb = val(B), vc = val(C);
      if (va !== EMPTY && va === vb && vc === EMPTY)
        return mk([A, B], [C], "Two " + GLYPH2[va] + " in a row — a third would break the no-three rule, so this cell must be " + GLYPH2[1 - va], [[C[0], C[1], 1 - va]]);
      if (vb !== EMPTY && vb === vc && va === EMPTY)
        return mk([B, C], [A], "Two " + GLYPH2[vb] + " in a row — a third would break the no-three rule, so this cell must be " + GLYPH2[1 - vb], [[A[0], A[1], 1 - vb]]);
      if (va !== EMPTY && va === vc && vb === EMPTY)
        return mk([A, C], [B], GLYPH2[va] + " on both sides — the cell between them must be " + GLYPH2[1 - va] + ", or you'd get three in a row", [[B[0], B[1], 1 - va]]);
    }
    // 2) balance: a line that already has all of one symbol
    for (let r = 0; r < n; r++) {
      const cnt = [0, 0], empt = [];
      for (let c = 0; c < n; c++) { if (m[r][c] === EMPTY) empt.push([r, c]); else cnt[m[r][c]]++; }
      for (const v of [0, 1])
        if (cnt[v] === half && empt.length)
          return mk(
            Array.from({ length: n }, (_, c) => [r, c]).filter((rc) => val(rc) === v), empt,
            "This row already has all " + half + " " + GLYPH2[v] + " — every remaining cell in it must be " + GLYPH2[1 - v],
            empt.map((rc) => [rc[0], rc[1], 1 - v]));
    }
    for (let c = 0; c < n; c++) {
      const cnt = [0, 0], empt = [];
      for (let r = 0; r < n; r++) { if (m[r][c] === EMPTY) empt.push([r, c]); else cnt[m[r][c]]++; }
      for (const v of [0, 1])
        if (cnt[v] === half && empt.length)
          return mk(
            Array.from({ length: n }, (_, r) => [r, c]).filter((rc) => val(rc) === v), empt,
            "This column already has all " + half + " " + GLYPH2[v] + " — every remaining cell in it must be " + GLYPH2[1 - v],
            empt.map((rc) => [rc[0], rc[1], 1 - v]));
    }
    // 3) edge clues with one side known
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (c < n - 1 && state.h[r][c]) {
          const a = m[r][c], b = m[r][c + 1], same = state.h[r][c] === 1;
          if (a !== EMPTY && b === EMPTY) { const v = same ? a : 1 - a; return mk([[r, c]], [[r, c + 1]], "The " + (same ? "“=” means these two cells match" : "“✕” means these two cells differ") + " — so this one is " + GLYPH2[v], [[r, c + 1, v]]); }
          if (b !== EMPTY && a === EMPTY) { const v = same ? b : 1 - b; return mk([[r, c + 1]], [[r, c]], "The " + (same ? "“=” means these two cells match" : "“✕” means these two cells differ") + " — so this one is " + GLYPH2[v], [[r, c, v]]); }
        }
        if (r < n - 1 && state.v[r][c]) {
          const a = m[r][c], b = m[r + 1][c], same = state.v[r][c] === 1;
          if (a !== EMPTY && b === EMPTY) { const v = same ? a : 1 - a; return mk([[r, c]], [[r + 1, c]], "The " + (same ? "“=” means these two cells match" : "“✕” means these two cells differ") + " — so this one is " + GLYPH2[v], [[r + 1, c, v]]); }
          if (b !== EMPTY && a === EMPTY) { const v = same ? b : 1 - b; return mk([[r + 1, c]], [[r, c]], "The " + (same ? "“=” means these two cells match" : "“✕” means these two cells differ") + " — so this one is " + GLYPH2[v], [[r, c, v]]); }
        }
      }
    }
    // 4) one-step contradiction: test a value mentally, watch a line break
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        if (m[r][c] !== EMPTY) continue;
        for (const v of [0, 1]) {
          const t = m.map((row) => row.slice());
          t[r][c] = v;
          if (propagateBad(t))
            return mk([[r, c]], [[r, c]],
              "No single rule fires here, but test " + GLYPH2[v] + " in your head: following the basic rules from it breaks a line. So it must be " + GLYPH2[1 - v],
              [[r, c, 1 - v]]);
        }
      }
    // 5) fallback (shouldn't happen on our boards)
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (m[r][c] === EMPTY)
          return mk([], [[r, c]], "This one needs deeper case analysis — the answer here is " + GLYPH2[state.solution[r][c]], [[r, c, state.solution[r][c]]]);
    return null;
  }
  function flash(cell) { if (!cell) return; cell.classList.add("flash"); setTimeout(() => cell.classList.remove("flash"), 900); }

  function clearBoard() {
    if (!state) return;
    for (let r = 0; r < state.size; r++)
      for (let c = 0; c < state.size; c++)
        if (state.givens[r][c] === EMPTY) { state.marks[r][c] = EMPTY; paintCell(r, c); }
    state.solved = false; coach.reset(); cancelConflictTimer(); clearConflictMarks(); setMessage("", ""); startTimer();
  }
  function setMessage(text, kind) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); }

  function shareResult() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const lines = ["☀️🌙 SunMoon"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Unlimited · " + state.size + "×" + state.size);
    if (state.solved) {
      lines.push("✅ Solved in " + formatTime(state.elapsedMs) + " ⏱️");
      const s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
    } else lines.push("Can you balance the grid? ☀️🌙");
    lines.push(base);
    const text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "SunMoon", text: text }).catch(function () {});
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { setMessage("Result copied — paste it anywhere!", "ok"); }, function () { fallbackCopy(text); });
    else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); setMessage("Result copied!", "ok"); } catch (e) { setMessage("Couldn't copy — long-press to copy.", "warn"); }
    document.body.removeChild(ta);
  }

  function boot() {
    els.board = document.getElementById("board");
    els.timer = document.getElementById("timer");
    els.message = document.getElementById("message");
    els.modeLabel = document.getElementById("mode-label");
    els.statSolved = document.getElementById("stat-solved");
    els.statStreak = document.getElementById("stat-streak");
    els.statBest = document.getElementById("stat-best");

    coach = window.HintCoach.create({ explain: explainHint, message: (t) => setMessage(t, "") });

    els.board.addEventListener("click", onBoardClick);
    document.getElementById("btn-new").addEventListener("click", () => newGame("unlimited"));
    document.getElementById("btn-daily").addEventListener("click", () => newGame("daily"));
    document.getElementById("btn-hint").addEventListener("click", hint);
    document.getElementById("btn-clear").addEventListener("click", clearBoard);
    document.getElementById("btn-share").addEventListener("click", shareResult);

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
