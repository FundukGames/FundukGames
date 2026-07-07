/*
 * Sudoku — game UI & interaction layer. Depends on generator.js (window.Sudoku).
 * Select a cell, then tap a number (or use the keyboard 1-9 / Backspace).
 */
(function () {
  "use strict";

  const els = {};
  let state = null; // { solution, puzzle, marks, difficulty, mode, solved, elapsedMs, sel, startTs }
  let timerId = null;

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function todayKey(date) { const d = date || new Date(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function yesterdayKey() { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return todayKey(d); }
  function loadStats() { return { solved: LS.get("su_solved", 0), streak: LS.get("su_streak", 0), lastDaily: LS.get("su_lastDaily", null), best: LS.get("su_best", {}) }; }
  function renderStats() {
    const s = loadStats();
    els.statSolved.textContent = s.solved;
    els.statStreak.textContent = s.streak;
    const b = s.best[state ? state.difficulty : "medium"];
    els.statBest.textContent = b ? formatTime(b) : "—";
  }

  function formatTime(ms) { const t = Math.floor(ms / 1000); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }
  function startTimer() { stopTimer(); state.startTs = Date.now(); timerId = setInterval(() => { els.timer.textContent = formatTime(Date.now() - state.startTs); }, 500); }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function newGame(mode, difficulty) {
    difficulty = difficulty || "medium";
    const opts = { difficulty: difficulty };
    if (mode === "daily") { opts.seed = window.Sudoku.dailySeed(); opts.difficulty = "medium"; difficulty = "medium"; }
    const p = window.Sudoku.generate(opts);
    state = {
      solution: p.solution, puzzle: p.puzzle,
      marks: p.puzzle.map((row) => row.slice()),
      difficulty: difficulty, mode: mode, solved: false, elapsedMs: 0, sel: null
    };
    els.modeLabel.textContent = mode === "daily" ? "Daily Challenge · " + todayKey() : "Unlimited · " + difficulty;
    hideWinModal();
    buildBoard();
    setMessage("", "");
    els.timer.textContent = "0:00";
    startTimer();
    renderStats();
  }

  function buildBoard() {
    const board = els.board;
    board.innerHTML = "";
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "su-cell" + (state.puzzle[r][c] !== 0 ? " is-given" : "");
        cell.dataset.r = r; cell.dataset.c = c;
        cell.setAttribute("aria-label", "row " + (r + 1) + " column " + (c + 1));
        board.appendChild(cell);
        paintCell(r, c);
      }
    }
  }
  function cellAt(r, c) { return els.board.querySelector('.su-cell[data-r="' + r + '"][data-c="' + c + '"]'); }
  function paintCell(r, c) { const cell = cellAt(r, c); if (cell) cell.textContent = state.marks[r][c] ? state.marks[r][c] : ""; }

  function selectCell(r, c) {
    state.sel = { r: r, c: c };
    updateHighlights();
  }
  function updateHighlights() {
    els.board.querySelectorAll(".su-cell").forEach((cell) => cell.classList.remove("is-sel", "is-peer", "is-same"));
    if (!state.sel) return;
    const { r, c } = state.sel;
    const selVal = state.marks[r][c];
    const br = r - (r % 3), bc = c - (c % 3);
    els.board.querySelectorAll(".su-cell").forEach((cell) => {
      const cr = +cell.dataset.r, cc = +cell.dataset.c;
      if (cr === r && cc === c) return; // the selected cell gets is-sel only
      if (cr === r || cc === c || (cr >= br && cr < br + 3 && cc >= bc && cc < bc + 3)) cell.classList.add("is-peer");
      if (selVal && state.marks[cr][cc] === selVal) cell.classList.add("is-same");
    });
    cellAt(r, c).classList.add("is-sel");
  }

  function place(v) {
    if (state.solved || !state.sel) return;
    const { r, c } = state.sel;
    if (state.puzzle[r][c] !== 0) return; // given, locked
    state.marks[r][c] = v;
    paintCell(r, c);
    updateHighlights();
    clearConflicts();
    checkWin();
  }

  function findConflicts() {
    const m = state.marks, bad = new Set();
    const scan = (cells) => {
      const seen = {};
      cells.forEach(([r, c]) => { const v = m[r][c]; if (v) (seen[v] = seen[v] || []).push([r, c]); });
      Object.values(seen).forEach((arr) => { if (arr.length > 1) arr.forEach(([r, c]) => bad.add(r + "," + c)); });
    };
    for (let r = 0; r < 9; r++) scan(Array.from({ length: 9 }, (_, c) => [r, c]));
    for (let c = 0; c < 9; c++) scan(Array.from({ length: 9 }, (_, r) => [r, c]));
    for (let br = 0; br < 9; br += 3)
      for (let bc = 0; bc < 9; bc += 3) {
        const cells = [];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cells.push([br + i, bc + j]);
        scan(cells);
      }
    return bad;
  }
  function clearConflicts() {
    els.board.querySelectorAll(".su-cell.is-bad").forEach((c) => c.classList.remove("is-bad"));
    findConflicts().forEach((key) => { const [r, c] = key.split(","); const cell = cellAt(r, c); if (cell) cell.classList.add("is-bad"); });
  }
  function isFull() { for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (state.marks[r][c] === 0) return false; return true; }
  function checkWin() { if (!isFull() || findConflicts().size > 0) return false; win(); return true; }

  function win() {
    state.solved = true; stopTimer();
    const elapsed = Date.now() - state.startTs; state.elapsedMs = elapsed;
    const stats = loadStats(); stats.solved += 1;
    if (state.mode === "daily") {
      const tk = todayKey();
      if (stats.lastDaily !== tk) { stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1; stats.lastDaily = tk; }
    }
    if (!stats.best[state.difficulty] || elapsed < stats.best[state.difficulty]) stats.best[state.difficulty] = elapsed;
    LS.set("su_solved", stats.solved); LS.set("su_streak", stats.streak); LS.set("su_lastDaily", stats.lastDaily); LS.set("su_best", stats.best);
    renderStats();
    setMessage("Solved in " + formatTime(elapsed) + "!", "ok");
    showWinModal(elapsed);
  }
  function showWinModal(elapsed) {
    const modal = document.getElementById("win-modal"); if (!modal) return;
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
    // flag a wrong filled cell first
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++)
      if (state.puzzle[r][c] === 0 && state.marks[r][c] !== 0 && state.marks[r][c] !== state.solution[r][c]) {
        flash(cellAt(r, c)); setMessage("That number is wrong — try clearing it.", "warn"); return;
      }
    // reveal selected empty cell, else first empty
    let target = null;
    if (state.sel && state.marks[state.sel.r][state.sel.c] === 0) target = state.sel;
    if (!target) { for (let r = 0; r < 9 && !target; r++) for (let c = 0; c < 9; c++) if (state.marks[r][c] === 0) { target = { r: r, c: c }; break; } }
    if (target) {
      state.marks[target.r][target.c] = state.solution[target.r][target.c];
      paintCell(target.r, target.c); flash(cellAt(target.r, target.c));
      updateHighlights(); clearConflicts(); checkWin();
      setMessage("Revealed one cell. Keep going!", "");
    }
  }
  function flash(cell) { if (!cell) return; cell.classList.add("is-same"); setTimeout(() => updateHighlights(), 600); }

  function clearBoard() {
    if (!state) return;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (state.puzzle[r][c] === 0) { state.marks[r][c] = 0; paintCell(r, c); }
    state.solved = false; updateHighlights(); clearConflicts(); setMessage("", ""); startTimer();
  }
  function setMessage(text, kind) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); }

  function shareResult() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const lines = ["🔢 Sudoku"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Unlimited · " + state.difficulty);
    if (state.solved) { lines.push("✅ Solved in " + formatTime(state.elapsedMs) + " ⏱️"); const s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak); }
    else lines.push("Can you crack the grid? 🔢");
    lines.push(base);
    const text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "Sudoku", text: text }).catch(function () {});
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { setMessage("Result copied!", "ok"); }, function () { fallbackCopy(text); });
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

    els.board.addEventListener("click", (e) => {
      const cell = e.target.closest && e.target.closest(".su-cell");
      if (cell) selectCell(+cell.dataset.r, +cell.dataset.c);
    });
    els.pad = document.getElementById("pad");
    els.pad.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("button"); if (!b) return;
      place(b.dataset.v === "0" ? 0 : +b.dataset.v);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key >= "1" && e.key <= "9") place(+e.key);
      else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") place(0);
    });

    document.getElementById("btn-new").addEventListener("click", () => newGame("unlimited", document.getElementById("diff-select").value));
    document.getElementById("btn-daily").addEventListener("click", () => newGame("daily"));
    document.getElementById("btn-hint").addEventListener("click", hint);
    document.getElementById("btn-clear").addEventListener("click", clearBoard);
    document.getElementById("btn-share").addEventListener("click", shareResult);
    document.getElementById("diff-select").addEventListener("change", () => newGame("unlimited", document.getElementById("diff-select").value));

    const winNew = document.getElementById("win-new");
    if (winNew) winNew.addEventListener("click", () => newGame("unlimited", document.getElementById("diff-select").value));
    const winShare = document.getElementById("win-share");
    if (winShare) winShare.addEventListener("click", shareResult);
    const winClose = document.getElementById("win-close");
    if (winClose) winClose.addEventListener("click", hideWinModal);

    newGame("unlimited", "easy");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
