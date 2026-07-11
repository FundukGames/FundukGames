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
    for (let r = 0; r < state.size; r++)
      for (let c = 0; c < state.size; c++)
        if (!state.givens[r][c] && state.marks[r][c] && state.marks[r][c] !== state.solution[r][c]) {
          flash(cellAt(r, c)); setMessage("That one's wrong — try clearing it.", "warn"); return;
        }
    const empties = [];
    for (let r = 0; r < state.size; r++)
      for (let c = 0; c < state.size; c++)
        if (!state.marks[r][c]) empties.push([r, c]);
    if (!empties.length) return;
    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    state.marks[r][c] = state.solution[r][c];
    paintCell(r, c); flash(cellAt(r, c));
    scheduleConflicts();
    if (!checkWin()) setMessage("Revealed one cell. Keep going!", "");
  }
  function flash(cell) { if (!cell) return; cell.classList.add("flash"); setTimeout(() => cell.classList.remove("flash"), 900); }

  function clearBoard() {
    if (!state) return;
    for (let r = 0; r < state.size; r++)
      for (let c = 0; c < state.size; c++)
        if (!state.givens[r][c]) { state.marks[r][c] = 0; paintCell(r, c); }
    state.solved = false;
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
