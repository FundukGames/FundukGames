/*
 * CrownGrid — game UI & interaction layer.
 * Depends on generator.js (window.CrownGrid.generate / dailySeed).
 *
 * Interaction model:
 *   - Tap/click a cell  -> place or remove a crown (♛).
 *   - Placing a crown auto-marks ✕ on its row, column, region and neighbors.
 *     Removing it recomputes auto-marks, so they disappear when no longer implied.
 *   - Press and drag across cells -> paint ✕ marks (drag again over them to erase).
 */
(function () {
  "use strict";

  // 10-color palette for regions — vivid but light enough for dark glyphs to read.
  const PALETTE = [
    "#ff8a8a", "#9bd86e", "#7fb4f5", "#ffd84d", "#c293f0",
    "#ffb066", "#5fd6c4", "#ff9ec9", "#d0d24a", "#74c7f0"
  ];

  // Cell states (user-controlled base layer)
  const EMPTY = 0, MARK = 1, CROWN = 2;

  const els = {};
  let state = null; // { size, regions, solution, marks, auto, mode, solved, elapsedMs }
  let timerId = null;
  const pointer = { active: false, moved: false, startR: 0, startC: 0, lastKey: "", paintVal: MARK };

  // ---- localStorage stats ----------------------------------------------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  function todayKey(date) {
    const d = date || new Date();
    return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate();
  }
  function yesterdayKey() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return todayKey(d);
  }

  function loadStats() {
    return {
      solved: LS.get("cg_solved", 0),
      streak: LS.get("cg_streak", 0),
      lastDaily: LS.get("cg_lastDaily", null),
      best: LS.get("cg_best", {})
    };
  }

  function renderStats() {
    const s = loadStats();
    els.statSolved.textContent = s.solved;
    els.statStreak.textContent = s.streak;
    const b = s.best[state ? state.size : 8];
    els.statBest.textContent = b ? formatTime(b) : "—";
  }

  // ---- timer -------------------------------------------------------------
  function formatTime(ms) {
    const t = Math.floor(ms / 1000);
    const m = Math.floor(t / 60), sec = t % 60;
    return m + ":" + String(sec).padStart(2, "0");
  }
  function startTimer() {
    stopTimer();
    state.startTs = Date.now();
    timerId = setInterval(() => {
      els.timer.textContent = formatTime(Date.now() - state.startTs);
    }, 500);
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  // ---- board build & render ---------------------------------------------
  function newGame(mode, size) {
    const opts = { size: size };
    if (mode === "daily") {
      opts.seed = window.CrownGrid.dailySeed();
      opts.size = 8; // shared board for everyone
      size = 8;
    }
    const puzzle = window.CrownGrid.generate(opts);
    state = {
      size: puzzle.size,
      regions: puzzle.regions,
      solution: puzzle.solution,
      marks: Array.from({ length: puzzle.size }, () => new Array(puzzle.size).fill(EMPTY)),
      auto: Array.from({ length: puzzle.size }, () => new Array(puzzle.size).fill(false)),
      mode: mode,
      solved: false,
      elapsedMs: 0
    };
    els.modeLabel.textContent = mode === "daily"
      ? "Daily Challenge · " + todayKey()
      : "Unlimited · " + size + "×" + size;
    buildBoard();
    setMessage("", "");
    els.timer.textContent = "0:00";
    startTimer();
    renderStats();
  }

  function buildBoard() {
    const n = state.size;
    const board = els.board;
    board.innerHTML = "";
    board.style.setProperty("--n", n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cell";
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.style.background = PALETTE[state.regions[r][c] % PALETTE.length];
        cell.setAttribute("aria-label", "row " + (r + 1) + " column " + (c + 1));
        board.appendChild(cell);
      }
    }
  }

  function cellAt(r, c) {
    return els.board.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
  }

  function paintCell(r, c) {
    const cell = cellAt(r, c);
    if (!cell) return;
    const v = state.marks[r][c];
    const autoX = state.auto[r][c] && v !== CROWN;
    const showX = v === MARK || autoX;
    cell.classList.toggle("is-crown", v === CROWN);
    cell.classList.toggle("is-mark", v === MARK);
    cell.classList.toggle("is-auto", autoX && v !== MARK);
    cell.textContent = v === CROWN ? "♛" : showX ? "✕" : "";
  }

  function repaintAll() {
    for (let r = 0; r < state.size; r++)
      for (let c = 0; c < state.size; c++) paintCell(r, c);
  }

  // ---- auto-marks: every cell a crown "attacks" gets an ✕ ----------------
  function markAuto(r, c) {
    if (state.marks[r][c] !== CROWN) state.auto[r][c] = true;
  }
  function recomputeAuto() {
    const n = state.size;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) state.auto[r][c] = false;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (state.marks[r][c] !== CROWN) continue;
        const reg = state.regions[r][c];
        for (let k = 0; k < n; k++) { markAuto(r, k); markAuto(k, c); }
        for (let rr = 0; rr < n; rr++)
          for (let cc = 0; cc < n; cc++)
            if (state.regions[rr][cc] === reg) markAuto(rr, cc);
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nc >= 0 && nr < n && nc < n) markAuto(nr, nc);
          }
      }
    }
  }

  // ---- interaction (pointer: works for mouse + touch) --------------------
  function onPointerDown(e) {
    if (state.solved) return;
    const cell = e.target.closest && e.target.closest(".cell");
    if (!cell || cell.parentElement !== els.board) return;
    pointer.active = true;
    pointer.moved = false;
    pointer.startR = +cell.dataset.r;
    pointer.startC = +cell.dataset.c;
    pointer.lastKey = pointer.startR + "," + pointer.startC;
  }

  function onPointerMove(e) {
    if (!pointer.active) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest && el.closest(".cell");
    if (!cell || cell.parentElement !== els.board) return;
    const r = +cell.dataset.r, c = +cell.dataset.c;
    const key = r + "," + c;
    if (!pointer.moved) {
      // First movement -> this gesture is a drag, not a click. Decide paint mode
      // from the starting cell: if it was a manual ✕, we erase; otherwise we draw.
      pointer.moved = true;
      const sv = state.marks[pointer.startR][pointer.startC];
      pointer.paintVal = sv === MARK ? EMPTY : MARK;
      applyPaint(pointer.startR, pointer.startC);
    }
    if (key === pointer.lastKey) { e.preventDefault(); return; }
    applyPaint(r, c);
    pointer.lastKey = key;
    e.preventDefault();
  }

  function applyPaint(r, c) {
    if (state.marks[r][c] === CROWN) return; // never paint over crowns
    state.marks[r][c] = pointer.paintVal;
    paintCell(r, c);
  }

  function onPointerUp() {
    if (!pointer.active) return;
    pointer.active = false;
    if (!pointer.moved) cycleCell(pointer.startR, pointer.startC); // a plain tap
  }

  // A plain tap cycles the cell: empty -> ✕ -> ♛ -> empty.
  // If the cell already shows an auto ✕, the first tap jumps straight to a crown
  // (so it doesn't look like the tap did nothing).
  function cycleCell(r, c) {
    if (state.solved) return;
    const base = state.marks[r][c];
    if (base === CROWN) state.marks[r][c] = EMPTY;
    else if (base === MARK) state.marks[r][c] = CROWN;
    else state.marks[r][c] = state.auto[r][c] ? CROWN : MARK; // base === EMPTY
    recomputeAuto();
    repaintAll();
    clearConflicts();
    checkWin();
  }

  // ---- validation --------------------------------------------------------
  function isAdjacent(a, b) {
    return Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1;
  }

  function crownList() {
    const list = [];
    for (let r = 0; r < state.size; r++)
      for (let c = 0; c < state.size; c++)
        if (state.marks[r][c] === CROWN) list.push({ r: r, c: c });
    return list;
  }

  function findConflicts() {
    const crowns = crownList();
    const bad = new Set();
    const rowCnt = {}, colCnt = {}, regCnt = {};
    crowns.forEach((q) => {
      rowCnt[q.r] = (rowCnt[q.r] || []).concat(q);
      colCnt[q.c] = (colCnt[q.c] || []).concat(q);
      const reg = state.regions[q.r][q.c];
      regCnt[reg] = (regCnt[reg] || []).concat(q);
    });
    const mark = (arr) => { if (arr.length > 1) arr.forEach((q) => bad.add(q.r + "," + q.c)); };
    Object.values(rowCnt).forEach(mark);
    Object.values(colCnt).forEach(mark);
    Object.values(regCnt).forEach(mark);
    for (let i = 0; i < crowns.length; i++)
      for (let j = i + 1; j < crowns.length; j++)
        if (isAdjacent(crowns[i], crowns[j])) {
          bad.add(crowns[i].r + "," + crowns[i].c);
          bad.add(crowns[j].r + "," + crowns[j].c);
        }
    return bad;
  }

  function clearConflicts() {
    els.board.querySelectorAll(".cell.is-bad").forEach((c) => c.classList.remove("is-bad"));
    findConflicts().forEach((key) => {
      const [r, c] = key.split(",");
      const cell = cellAt(r, c);
      if (cell) cell.classList.add("is-bad");
    });
  }

  function checkWin() {
    const crowns = crownList();
    if (crowns.length !== state.size) return false;
    if (findConflicts().size > 0) return false;
    win();
    return true;
  }

  function win() {
    state.solved = true;
    stopTimer();
    const elapsed = Date.now() - state.startTs;
    state.elapsedMs = elapsed;
    const stats = loadStats();
    stats.solved += 1;

    if (state.mode === "daily") {
      const tk = todayKey();
      if (stats.lastDaily !== tk) {
        stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1;
        stats.lastDaily = tk;
      }
    }
    if (!stats.best[state.size] || elapsed < stats.best[state.size]) {
      stats.best[state.size] = elapsed;
    }
    LS.set("cg_solved", stats.solved);
    LS.set("cg_streak", stats.streak);
    LS.set("cg_lastDaily", stats.lastDaily);
    LS.set("cg_best", stats.best);
    renderStats();
    setMessage("🎉 Solved in " + formatTime(elapsed) + "! Tap Share to brag.", "ok");
  }

  // ---- hint / clear ------------------------------------------------------
  function hint() {
    if (state.solved) return;
    for (let r = 0; r < state.size; r++) {
      for (let c = 0; c < state.size; c++) {
        if (state.marks[r][c] === CROWN && state.solution[r] !== c) {
          flash(cellAt(r, c));
          setMessage("That crown can't be right — try removing a flagged one.", "warn");
          return;
        }
      }
    }
    for (let r = 0; r < state.size; r++) {
      const c = state.solution[r];
      if (state.marks[r][c] !== CROWN) {
        state.marks[r][c] = CROWN;
        recomputeAuto();
        repaintAll();
        flash(cellAt(r, c));
        clearConflicts();
        checkWin();
        setMessage("Revealed one crown. Keep going!", "");
        return;
      }
    }
  }

  function flash(cell) {
    if (!cell) return;
    cell.classList.add("flash");
    setTimeout(() => cell.classList.remove("flash"), 900);
  }

  function clearBoard() {
    if (!state) return;
    for (let r = 0; r < state.size; r++)
      for (let c = 0; c < state.size; c++) {
        state.marks[r][c] = EMPTY;
        state.auto[r][c] = false;
      }
    state.solved = false;
    repaintAll();
    clearConflicts();
    setMessage("", "");
    startTimer();
  }

  function setMessage(text, kind) {
    els.message.textContent = text;
    els.message.className = "message" + (kind ? " message--" + kind : "");
  }

  // ---- share (Wordle-style, spoiler-free) --------------------------------
  function shareResult() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const lines = ["👑 CrownGrid"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Unlimited · " + state.size + "×" + state.size);
    if (state.solved) {
      lines.push("✅ Solved in " + formatTime(state.elapsedMs) + " ⏱️");
      const s = loadStats();
      if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
    } else {
      lines.push("Can you crown the grid? 👑");
    }
    lines.push(base);
    const text = lines.join("\n");

    if (navigator.share) {
      navigator.share({ title: "CrownGrid", text: text }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { setMessage("📋 Result copied — paste it anywhere!", "ok"); },
        function () { fallbackCopy(text); }
      );
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); setMessage("📋 Result copied!", "ok"); }
    catch (e) { setMessage("Couldn't copy automatically — long-press to copy.", "warn"); }
    document.body.removeChild(ta);
  }

  // ---- boot --------------------------------------------------------------
  function boot() {
    els.board = document.getElementById("board");
    els.timer = document.getElementById("timer");
    els.message = document.getElementById("message");
    els.modeLabel = document.getElementById("mode-label");
    els.statSolved = document.getElementById("stat-solved");
    els.statStreak = document.getElementById("stat-streak");
    els.statBest = document.getElementById("stat-best");

    els.board.addEventListener("pointerdown", onPointerDown);
    els.board.addEventListener("pointermove", onPointerMove);
    els.board.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    document.getElementById("btn-daily").addEventListener("click", () => newGame("daily"));
    document.getElementById("btn-new").addEventListener("click", () => {
      newGame("unlimited", +document.getElementById("size-select").value);
    });
    document.getElementById("btn-hint").addEventListener("click", hint);
    document.getElementById("btn-clear").addEventListener("click", clearBoard);
    document.getElementById("btn-share").addEventListener("click", shareResult);
    document.getElementById("size-select").addEventListener("change", () => {
      newGame("unlimited", +document.getElementById("size-select").value);
    });

    newGame("unlimited", 8);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
