/*
 * Nonogram — game UI & interaction layer. Depends on generator.js (window.Nonogram).
 * Two tools: fill (■) and mark (✕). Tap toggles, drag paints; right-click always
 * marks ✕. Clues dim as their line is completed.
 */
(function () {
  "use strict";

  const EMPTY = 0, FILL = 1, X = 2;

  const els = {};
  let state = null; // { size, solution, rowClues, colClues, marks, mode, solved, startTs, elapsedMs }
  let timerId = null;
  let tool = "fill";

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function todayKey(date) { const d = date || new Date(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function yesterdayKey() { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return todayKey(d); }
  function loadStats() {
    return { solved: LS.get("ng_solved", 0), streak: LS.get("ng_streak", 0), lastDaily: LS.get("ng_lastDaily", null), best: LS.get("ng_best_" + (state ? state.size : 10), null) };
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
    const size = mode === "daily" ? 10 : +els.size.value;
    const opts = { size: size };
    if (mode === "daily") opts.seed = window.Nonogram.dailySeed();
    const p = window.Nonogram.generate(opts);
    const marks = Array.from({ length: p.size }, () => new Array(p.size).fill(EMPTY));
    state = { size: p.size, solution: p.solution, rowClues: p.rowClues, colClues: p.colClues, marks: marks, mode: mode, solved: false, elapsedMs: 0 };
    els.modeLabel.textContent = mode === "daily" ? "Daily Challenge · " + todayKey() : "Unlimited · " + p.size + "×" + p.size;
    if (mode === "daily") els.size.value = String(p.size);
    hideWinModal();
    buildBoard();
    setMessage("", "");
    els.timer.textContent = "0:00";
    startTimer();
    renderStats();
  }

  function buildBoard() {
    const n = state.size;
    els.wrap.style.setProperty("--n", n);
    els.wrap.classList.toggle("ng-wrap--big", n >= 15);

    els.colclues.innerHTML = "";
    for (let c = 0; c < n; c++) {
      const d = document.createElement("div");
      d.className = "ng-clue";
      d.dataset.c = c;
      const nums = state.colClues[c].length ? state.colClues[c] : [0];
      nums.forEach((v) => { const s = document.createElement("span"); s.textContent = v; d.appendChild(s); });
      els.colclues.appendChild(d);
    }
    els.rowclues.innerHTML = "";
    for (let r = 0; r < n; r++) {
      const d = document.createElement("div");
      d.className = "ng-clue";
      d.dataset.r = r;
      const nums = state.rowClues[r].length ? state.rowClues[r] : [0];
      nums.forEach((v) => { const s = document.createElement("span"); s.textContent = v; d.appendChild(s); });
      els.rowclues.appendChild(d);
    }

    els.board.innerHTML = "";
    els.board.classList.remove("is-won");
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "ng-cell";
        if (c > 0 && c % 5 === 0) cell.classList.add("ng-b-left");
        if (r > 0 && r % 5 === 0) cell.classList.add("ng-b-top");
        cell.dataset.r = r; cell.dataset.c = c;
        cell.setAttribute("aria-label", "row " + (r + 1) + " column " + (c + 1));
        els.board.appendChild(cell);
      }
    }
    refreshClueDone();
  }

  function cellAt(r, c) { return els.board.querySelector('.ng-cell[data-r="' + r + '"][data-c="' + c + '"]'); }
  function paintCell(r, c) {
    const cell = cellAt(r, c); if (!cell) return;
    const v = state.marks[r][c];
    cell.classList.toggle("is-fill", v === FILL);
    cell.classList.toggle("is-x", v === X);
  }

  // ---- painting ----------------------------------------------------------
  let drag = null; // { value, replaces }
  function paintValueFor(r, c, wantX) {
    const cur = state.marks[r][c];
    if (wantX) return cur === X ? EMPTY : X;
    return cur === FILL ? EMPTY : FILL;
  }
  function applyPaint(r, c) {
    const cur = state.marks[r][c];
    if (drag.value === EMPTY ? cur !== drag.replaces : cur !== EMPTY && cur !== drag.replaces) return;
    if (cur === drag.value) return;
    state.marks[r][c] = drag.value;
    paintCell(r, c);
    refreshClueDone();
    checkWin();
  }
  function onPointerDown(e) {
    const cell = e.target.closest && e.target.closest(".ng-cell");
    if (!cell || state.solved) return;
    e.preventDefault();
    const r = +cell.dataset.r, c = +cell.dataset.c;
    const wantX = tool === "x" || e.button === 2;
    const value = paintValueFor(r, c, wantX);
    drag = { value: value, replaces: value === EMPTY ? state.marks[r][c] : EMPTY };
    applyPaint(r, c);
    try { els.board.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onPointerMove(e) {
    if (!drag || state.solved) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest && el.closest(".ng-cell");
    if (cell) applyPaint(+cell.dataset.r, +cell.dataset.c);
  }
  function onPointerUp() { drag = null; }

  // ---- clue completion ---------------------------------------------------
  function runsOf(line) {
    const out = []; let run = 0;
    for (const v of line) { if (v === FILL) run++; else if (run) { out.push(run); run = 0; } }
    if (run) out.push(run);
    return out;
  }
  function sameClues(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }
  function refreshClueDone() {
    const n = state.size;
    for (let r = 0; r < n; r++) {
      const done = sameClues(runsOf(state.marks[r]), state.rowClues[r]);
      const el = els.rowclues.querySelector('.ng-clue[data-r="' + r + '"]');
      if (el) el.classList.toggle("is-done", done);
    }
    for (let c = 0; c < n; c++) {
      const col = [];
      for (let r = 0; r < n; r++) col.push(state.marks[r][c]);
      const done = sameClues(runsOf(col), state.colClues[c]);
      const el = els.colclues.querySelector('.ng-clue[data-c="' + c + '"]');
      if (el) el.classList.toggle("is-done", done);
    }
  }

  function checkWin() {
    const n = state.size;
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if ((state.marks[r][c] === FILL) !== (state.solution[r][c] === 1)) return false;
    win(); return true;
  }
  function win() {
    state.solved = true; stopTimer(); drag = null;
    els.board.classList.add("is-won");
    const elapsed = Date.now() - state.startTs; state.elapsedMs = elapsed;
    const stats = loadStats(); stats.solved += 1;
    if (state.mode === "daily") {
      const tk = todayKey();
      if (stats.lastDaily !== tk) { stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1; stats.lastDaily = tk; }
    }
    if (!stats.best || elapsed < stats.best) stats.best = elapsed;
    LS.set("ng_solved", stats.solved); LS.set("ng_streak", stats.streak); LS.set("ng_lastDaily", stats.lastDaily); LS.set("ng_best_" + state.size, stats.best);
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
    const n = state.size;
    // 1) flag a wrong cell
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const m = state.marks[r][c], s = state.solution[r][c];
        if ((m === FILL && s !== 1) || (m === X && s === 1)) {
          flash(cellAt(r, c)); setMessage("That one's wrong — try clearing it.", "warn"); return;
        }
      }
    // 2) reveal one untouched cell
    const empties = [];
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (state.marks[r][c] === EMPTY) empties.push([r, c]);
    if (!empties.length) return;
    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    state.marks[r][c] = state.solution[r][c] === 1 ? FILL : X;
    paintCell(r, c); flash(cellAt(r, c));
    refreshClueDone();
    if (!checkWin()) setMessage("Revealed one cell. Keep going!", "");
  }
  function flash(cell) { if (!cell) return; cell.classList.add("flash"); setTimeout(() => cell.classList.remove("flash"), 900); }

  function clearBoard() {
    if (!state) return;
    for (let r = 0; r < state.size; r++)
      for (let c = 0; c < state.size; c++) { state.marks[r][c] = EMPTY; paintCell(r, c); }
    state.solved = false; els.board.classList.remove("is-won");
    refreshClueDone(); setMessage("", ""); startTimer();
  }
  function setMessage(text, kind) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); }

  function setTool(t) {
    tool = t;
    els.toolFill.classList.toggle("is-active", t === "fill");
    els.toolX.classList.toggle("is-active", t === "x");
  }

  function shareResult() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const lines = ["🖼️ Nonogram"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Unlimited · " + state.size + "×" + state.size);
    if (state.solved) {
      lines.push("✅ Solved in " + formatTime(state.elapsedMs) + " ⏱️");
      const s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
    } else lines.push("Can you uncover the picture? 🖼️");
    lines.push(base);
    const text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "Nonogram", text: text }).catch(function () {});
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
    els.wrap = document.getElementById("ng-wrap");
    els.board = document.getElementById("board");
    els.colclues = document.getElementById("colclues");
    els.rowclues = document.getElementById("rowclues");
    els.timer = document.getElementById("timer");
    els.message = document.getElementById("message");
    els.modeLabel = document.getElementById("mode-label");
    els.statSolved = document.getElementById("stat-solved");
    els.statStreak = document.getElementById("stat-streak");
    els.statBest = document.getElementById("stat-best");
    els.size = document.getElementById("size");
    els.toolFill = document.getElementById("tool-fill");
    els.toolX = document.getElementById("tool-x");

    els.board.addEventListener("pointerdown", onPointerDown);
    els.board.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    els.board.addEventListener("contextmenu", (e) => e.preventDefault());

    els.toolFill.addEventListener("click", () => setTool("fill"));
    els.toolX.addEventListener("click", () => setTool("x"));
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

    setTool("fill");
    newGame("unlimited");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
