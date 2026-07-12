/*
 * Futoshiki — game UI & interaction layer. Depends on generator.js (window.Futoshiki).
 * Select a cell, tap a number on the pad (or type it). Inequality signs sit
 * between the tiles; conflicts surface after a ~1s pause.
 */
(function () {
  "use strict";

  const els = {};
  let state = null; // { size, solution, givens, h, v, marks, mode, solved, startTs, elapsedMs, sel }
  let timerId = null;
  let coach = null; // explanatory-hint controller (window.HintCoach)

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function todayKey(date) { const d = date || new Date(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function yesterdayKey() { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return todayKey(d); }
  function loadStats() {
    return { solved: LS.get("fu_solved", 0), streak: LS.get("fu_streak", 0), lastDaily: LS.get("fu_lastDaily", null), best: LS.get("fu_best_" + (state ? state.size : 5), null) };
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
    const size = mode === "daily" ? 5 : +els.size.value;
    setMessage("Generating…", "");
    // let the message paint before the (possibly ~1s on 7×7) generation runs
    setTimeout(function () {
      const opts = { size: size };
      if (mode === "daily") opts.seed = window.Futoshiki.dailySeed();
      const p = window.Futoshiki.generate(opts);
      const marks = p.givens.map((row) => row.slice());
      state = { size: p.size, solution: p.solution, givens: p.givens, h: p.h, v: p.v, marks: marks, mode: mode, solved: false, elapsedMs: 0, sel: null };
      els.modeLabel.textContent = mode === "daily" ? "Daily Challenge · " + todayKey() : "Unlimited · " + p.size + "×" + p.size;
      if (mode === "daily") els.size.value = String(p.size);
      hideWinModal();
      if (coach) coach.reset();
      cancelConflictTimer();
      buildBoard();
      buildPad();
      setMessage("", "");
      els.timer.textContent = "0:00";
      startTimer();
      renderStats();
    }, 30);
  }

  function buildBoard() {
    const n = state.size, board = els.board;
    board.innerHTML = "";
    board.style.setProperty("--n", n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "fu-cell" + (state.givens[r][c] ? " is-given" : "");
        cell.dataset.r = r; cell.dataset.c = c;
        cell.setAttribute("aria-label", "row " + (r + 1) + " column " + (c + 1));
        board.appendChild(cell);
        paintCell(r, c);
      }
    }
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (c < n - 1 && state.h[r][c]) addEdge(state.h[r][c] === 1 ? "‹" : "›", (c + 1) / n * 100, (r + 0.5) / n * 100, false);
        if (r < n - 1 && state.v[r][c]) addEdge(state.v[r][c] === 1 ? "‹" : "›", (c + 0.5) / n * 100, (r + 1) / n * 100, true);
      }
    }
  }
  function addEdge(glyph, leftPct, topPct, vertical) {
    const e = document.createElement("div");
    e.className = "fu-edge" + (vertical ? " fu-edge--v" : "");
    e.textContent = glyph;
    e.style.left = leftPct + "%";
    e.style.top = topPct + "%";
    els.board.appendChild(e);
  }

  function buildPad() {
    const n = state.size;
    els.pad.innerHTML = "";
    els.pad.style.setProperty("--cols", n + 1);
    for (let v = 1; v <= n; v++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = v;
      b.addEventListener("click", () => enter(v));
      els.pad.appendChild(b);
    }
    const del = document.createElement("button");
    del.type = "button";
    del.innerHTML = "⌫";
    del.setAttribute("aria-label", "Erase");
    del.addEventListener("click", () => enter(0));
    els.pad.appendChild(del);
  }

  function cellAt(r, c) { return els.board.querySelector('.fu-cell[data-r="' + r + '"][data-c="' + c + '"]'); }
  function paintCell(r, c) {
    const cell = cellAt(r, c); if (!cell) return;
    const v = state.marks[r][c];
    cell.textContent = v || "";
  }
  function repaintSelection() {
    els.board.querySelectorAll(".fu-cell").forEach((el) => {
      el.classList.remove("is-sel", "is-peer", "is-same");
    });
    if (!state.sel) return;
    const [sr, sc] = state.sel;
    const val = state.marks[sr][sc];
    for (let r = 0; r < state.size; r++) {
      for (let c = 0; c < state.size; c++) {
        const el = cellAt(r, c);
        if (r === sr && c === sc) el.classList.add("is-sel");
        else if (r === sr || c === sc) el.classList.add("is-peer");
        if (val && state.marks[r][c] === val && !(r === sr && c === sc)) el.classList.add("is-same");
      }
    }
  }

  function onBoardClick(e) {
    const cell = e.target.closest && e.target.closest(".fu-cell");
    if (!cell || state.solved) return;
    state.sel = [+cell.dataset.r, +cell.dataset.c];
    repaintSelection();
  }

  function enter(v) {
    if (!state.sel || state.solved) return;
    coach.reset();
    const [r, c] = state.sel;
    if (state.givens[r][c]) { flash(cellAt(r, c)); return; }
    state.marks[r][c] = v === state.marks[r][c] ? 0 : v;
    paintCell(r, c);
    repaintSelection();
    scheduleConflicts();
    checkWin();
  }

  // ---- validation --------------------------------------------------------
  function findConflicts() {
    const n = state.size, m = state.marks, bad = new Set();
    const add = (r, c) => bad.add(r + "," + c);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const v = m[r][c];
        if (!v) continue;
        for (let i = 0; i < n; i++) {
          if (i !== c && m[r][i] === v) { add(r, c); add(r, i); }
          if (i !== r && m[i][c] === v) { add(r, c); add(i, c); }
        }
        if (c < n - 1 && state.h[r][c] && m[r][c + 1]) {
          const lt = v < m[r][c + 1];
          if ((state.h[r][c] === 1) !== lt) { add(r, c); add(r, c + 1); }
        }
        if (r < n - 1 && state.v[r][c] && m[r + 1][c]) {
          const lt = v < m[r + 1][c];
          if ((state.v[r][c] === 1) !== lt) { add(r, c); add(r + 1, c); }
        }
      }
    return bad;
  }
  let conflictTimer = null;
  function clearConflictMarks() { els.board.querySelectorAll(".fu-cell.is-bad").forEach((c) => c.classList.remove("is-bad")); }
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
    for (let r = 0; r < state.size; r++) for (let c = 0; c < state.size; c++) if (!state.marks[r][c]) return false;
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
    state.sel = null; repaintSelection();
    const elapsed = Date.now() - state.startTs; state.elapsedMs = elapsed;
    const stats = loadStats(); stats.solved += 1;
    if (state.mode === "daily") {
      const tk = todayKey();
      if (stats.lastDaily !== tk) { stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1; stats.lastDaily = tk; }
    }
    if (!stats.best || elapsed < stats.best) stats.best = elapsed;
    LS.set("fu_solved", stats.solved); LS.set("fu_streak", stats.streak); LS.set("fu_lastDaily", stats.lastDaily); LS.set("fu_best_" + state.size, stats.best);
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
    // a wrong entry trumps any teaching — point at it first
    for (let r = 0; r < state.size; r++)
      for (let c = 0; c < state.size; c++)
        if (!state.givens[r][c] && state.marks[r][c] && state.marks[r][c] !== state.solution[r][c]) {
          coach.reset();
          flash(cellAt(r, c)); setMessage("That one's wrong — try clearing it.", "warn"); return;
        }
    coach.press();
  }

  // ---- explanatory hints: candidates, signs and singles, spelled out ------
  function buildCands() {
    const n = state.size, m = state.marks, cd = [];
    for (let r = 0; r < n; r++) {
      cd.push([]);
      for (let c = 0; c < n; c++) {
        if (m[r][c]) { cd[r].push([m[r][c]]); continue; }
        const used = new Set();
        for (let i = 0; i < n; i++) { if (m[r][i]) used.add(m[r][i]); if (m[i][c]) used.add(m[i][c]); }
        cd[r].push(Array.from({ length: n }, (_, i) => i + 1).filter((v) => !used.has(v)));
      }
    }
    return cd;
  }
  // singles + inequality fixpoint; false on contradiction
  function pruneAll(cd) {
    const n = state.size;
    let ch = true;
    while (ch) {
      ch = false;
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) {
          const s = cd[r][c];
          if (!s.length) return false;
          if (s.length !== 1) continue;
          const v = s[0];
          for (let i = 0; i < n; i++) {
            if (i !== c) { const t = cd[r][i], k = t.indexOf(v); if (k >= 0) { if (t.length === 1) return false; t.splice(k, 1); ch = true; } }
            if (i !== r) { const t = cd[i][c], k = t.indexOf(v); if (k >= 0) { if (t.length === 1) return false; t.splice(k, 1); ch = true; } }
          }
        }
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) {
          const doP = (aR, aC, bR, bC) => { // a < b
            const A = cd[aR][aC], B = cd[bR][bC];
            const maxB = Math.max.apply(null, B), minA = Math.min.apply(null, A);
            const A2 = A.filter((x) => x < maxB), B2 = B.filter((x) => x > minA);
            if (A2.length !== A.length) { cd[aR][aC] = A2; ch = true; }
            if (B2.length !== B.length) { cd[bR][bC] = B2; ch = true; }
            return A2.length && B2.length;
          };
          if (c < n - 1 && state.h[r][c] && !(state.h[r][c] === 1 ? doP(r, c, r, c + 1) : doP(r, c + 1, r, c))) return false;
          if (r < n - 1 && state.v[r][c] && !(state.v[r][c] === 1 ? doP(r, c, r + 1, c) : doP(r + 1, c, r, c))) return false;
        }
    }
    return true;
  }
  function explainHint() {
    const n = state.size, m = state.marks;
    const mk = (premise, target, text, r, c, v) => ({
      premise: premise, target: target, text: text,
      apply: () => {
        state.marks[r][c] = v;
        paintCell(r, c);
        setMessage("", "");
        repaintSelection();
        scheduleConflicts(); checkWin();
      }
    });
    const lineEls = (isRow, idx, exceptC) => {
      const out = [];
      for (let k = 0; k < n; k++) {
        if (k === exceptC) continue;
        out.push(isRow ? cellAt(idx, k) : cellAt(k, idx));
      }
      return out;
    };

    const cd = buildCands();
    if (!pruneAll(cd)) return null; // shouldn't happen with correct entries

    // 1) naked single
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (!m[r][c] && cd[r][c].length === 1) {
          const v = cd[r][c][0];
          // was it row/column alone, or did the signs do the squeezing?
          const used = new Set();
          for (let i = 0; i < n; i++) { if (m[r][i]) used.add(m[r][i]); if (m[i][c]) used.add(m[i][c]); }
          const plain = n - used.size === 1;
          const premise = [];
          for (let i = 0; i < n; i++) {
            if (m[r][i] && i !== c) premise.push(cellAt(r, i));
            if (m[i][c] && i !== r) premise.push(cellAt(i, c));
          }
          return mk(premise, [cellAt(r, c)],
            plain
              ? "Its row and column already contain every other value — only " + v + " is left for this cell"
              : "Between the numbers already in its row and column and the ‹ › signs squeezing it, only " + v + " remains possible here",
            r, c, v);
        }
    // 2) hidden single (row, then column)
    for (let r = 0; r < n; r++)
      for (let v = 1; v <= n; v++) {
        const spots = [];
        for (let c = 0; c < n; c++) if (!m[r][c] && cd[r][c].includes(v)) spots.push(c);
        if (spots.length === 1 && !m[r].includes(v))
          return mk(lineEls(true, r, spots[0]), [cellAt(r, spots[0])],
            "Scan this row for " + v + ": the signs and the other columns rule it out everywhere else — it can only live here",
            r, spots[0], v);
      }
    for (let c = 0; c < n; c++)
      for (let v = 1; v <= n; v++) {
        const spots = [];
        let present = false;
        for (let r = 0; r < n; r++) { if (m[r][c] === v) present = true; if (!m[r][c] && cd[r][c].includes(v)) spots.push(r); }
        if (spots.length === 1 && !present)
          return mk(lineEls(false, c, spots[0]), [cellAt(spots[0], c)],
            "Scan this column for " + v + ": it's ruled out everywhere else — it can only live here",
            spots[0], c, v);
      }
    // 3) one-step contradiction
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        if (m[r][c] || cd[r][c].length !== 2) continue;
        for (const v of cd[r][c]) {
          const t = cd.map((row) => row.map((s) => s.slice()));
          t[r][c] = [v];
          if (!pruneAll(t)) {
            const other = cd[r][c].find((x) => x !== v);
            return mk([cellAt(r, c)], [cellAt(r, c)],
              "This cell is down to " + cd[r][c].join(" or ") + ". Test " + v + ": following the signs and singles, some cell runs out of options — so it must be " + other,
              r, c, other);
          }
        }
      }
    // 4) fallback
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (!m[r][c])
          return mk([], [cellAt(r, c)],
            "This one needs deeper case analysis — the answer here is " + state.solution[r][c],
            r, c, state.solution[r][c]);
    return null;
  }
  function flash(cell) { if (!cell) return; cell.classList.add("flash"); setTimeout(() => cell.classList.remove("flash"), 900); }

  function clearBoard() {
    if (!state) return;
    for (let r = 0; r < state.size; r++)
      for (let c = 0; c < state.size; c++)
        if (!state.givens[r][c]) { state.marks[r][c] = 0; paintCell(r, c); }
    state.solved = false;
    coach.reset();
    repaintSelection();
    cancelConflictTimer(); clearConflictMarks(); setMessage("", ""); startTimer();
  }
  function setMessage(text, kind) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); }

  function shareResult() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const lines = ["⚖️ Futoshiki"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Unlimited · " + state.size + "×" + state.size);
    if (state.solved) {
      lines.push("✅ Solved in " + formatTime(state.elapsedMs) + " ⏱️");
      const s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
    } else lines.push("Can you satisfy every inequality? ⚖️");
    lines.push(base);
    const text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "Futoshiki", text: text }).catch(function () {});
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { setMessage("Result copied — paste it anywhere!", "ok"); }, function () { fallbackCopy(text); });
    else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); setMessage("Result copied!", "ok"); } catch (e) { setMessage("Couldn't copy — long-press to copy.", "warn"); }
    document.body.removeChild(ta);
  }

  function onKey(e) {
    if (!state || state.solved) return;
    if (e.key >= "1" && e.key <= String(state.size)) { enter(+e.key); e.preventDefault(); }
    else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") { enter(0); e.preventDefault(); }
    else if (e.key.startsWith("Arrow") && state.sel) {
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      const r = Math.min(state.size - 1, Math.max(0, state.sel[0] + d[0]));
      const c = Math.min(state.size - 1, Math.max(0, state.sel[1] + d[1]));
      state.sel = [r, c];
      repaintSelection();
      e.preventDefault();
    }
  }

  function boot() {
    els.board = document.getElementById("board");
    els.pad = document.getElementById("pad");
    els.timer = document.getElementById("timer");
    els.message = document.getElementById("message");
    els.modeLabel = document.getElementById("mode-label");
    els.statSolved = document.getElementById("stat-solved");
    els.statStreak = document.getElementById("stat-streak");
    els.statBest = document.getElementById("stat-best");
    els.size = document.getElementById("size");

    coach = window.HintCoach.create({ explain: explainHint, message: (t) => setMessage(t, "") });

    els.board.addEventListener("click", onBoardClick);
    window.addEventListener("keydown", onKey);
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
