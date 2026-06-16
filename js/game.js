/*
 * CrownGrid — game UI & interaction layer.
 * Depends on generator.js (window.CrownGrid.generate / dailySeed).
 */
(function () {
  "use strict";

  // 10-color palette for regions (original colors, distinct & accessible-ish).
  const PALETTE = [
    "#f6c0c0", "#c7e2b3", "#bcd4f0", "#f3e1a8", "#d8c2ec",
    "#f7cda2", "#b6e3da", "#e9b6cf", "#c9c9a3", "#a8d8ef"
  ];

  // Cell states
  const EMPTY = 0, MARK = 1, CROWN = 2;

  const els = {};
  let state = null; // { size, regions, solution, marks, mode, seed, startTs, solved }
  let timerId = null;

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
      // Daily uses a fixed size so everyone shares the same board.
      opts.size = 8;
      size = 8;
    }
    const puzzle = window.CrownGrid.generate(opts);
    state = {
      size: puzzle.size,
      regions: puzzle.regions,
      solution: puzzle.solution,
      marks: Array.from({ length: puzzle.size }, () => new Array(puzzle.size).fill(EMPTY)),
      mode: mode,
      solved: false
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
    const v = state.marks[r][c];
    cell.classList.toggle("is-mark", v === MARK);
    cell.classList.toggle("is-crown", v === CROWN);
    cell.textContent = v === CROWN ? "♛" : v === MARK ? "✕" : "";
  }

  // ---- interaction -------------------------------------------------------
  function onBoardClick(e) {
    const cell = e.target.closest(".cell");
    if (!cell || state.solved) return;
    const r = +cell.dataset.r, c = +cell.dataset.c;
    // cycle empty -> mark -> crown -> empty
    state.marks[r][c] = (state.marks[r][c] + 1) % 3;
    paintCell(r, c);
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
    const n = state.size;
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
    const bad = findConflicts();
    bad.forEach((key) => {
      const [r, c] = key.split(",");
      const cell = cellAt(r, c);
      if (cell) cell.classList.add("is-bad");
    });
  }

  function checkWin() {
    const n = state.size;
    const crowns = crownList();
    if (crowns.length !== n) return false;
    if (findConflicts().size > 0) return false;
    win();
    return true;
  }

  function win() {
    state.solved = true;
    stopTimer();
    const elapsed = Date.now() - state.startTs;
    const stats = loadStats();
    stats.solved += 1;

    // Daily streak handling
    if (state.mode === "daily") {
      const tk = todayKey();
      if (stats.lastDaily !== tk) {
        stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1;
        stats.lastDaily = tk;
      }
    }
    // Best time per size
    if (!stats.best[state.size] || elapsed < stats.best[state.size]) {
      stats.best[state.size] = elapsed;
    }
    LS.set("cg_solved", stats.solved);
    LS.set("cg_streak", stats.streak);
    LS.set("cg_lastDaily", stats.lastDaily);
    LS.set("cg_best", stats.best);
    renderStats();
    setMessage("🎉 Solved in " + formatTime(elapsed) + "!", "ok");
  }

  // ---- helpers (hint / clear) -------------------------------------------
  function hint() {
    if (state.solved) return;
    // 1) If any placed crown is wrong, flag the first one.
    for (let r = 0; r < state.size; r++) {
      for (let c = 0; c < state.size; c++) {
        if (state.marks[r][c] === CROWN && state.solution[r] !== c) {
          flash(cellAt(r, c));
          setMessage("That crown can't be right — try removing a flagged one.", "warn");
          return;
        }
      }
    }
    // 2) Otherwise reveal one correct crown not yet placed.
    for (let r = 0; r < state.size; r++) {
      const c = state.solution[r];
      if (state.marks[r][c] !== CROWN) {
        state.marks[r][c] = CROWN;
        paintCell(r, c);
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
        paintCell(r, c);
      }
    state.solved = false;
    clearConflicts();
    setMessage("", "");
    startTimer();
  }

  function setMessage(text, kind) {
    els.message.textContent = text;
    els.message.className = "message" + (kind ? " message--" + kind : "");
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

    els.board.addEventListener("click", onBoardClick);
    document.getElementById("btn-daily").addEventListener("click", () => newGame("daily"));
    document.getElementById("btn-new").addEventListener("click", () => {
      const size = +document.getElementById("size-select").value;
      newGame("unlimited", size);
    });
    document.getElementById("btn-hint").addEventListener("click", hint);
    document.getElementById("btn-clear").addEventListener("click", clearBoard);
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
