/*
 * Akari — game UI & interaction layer. Depends on generator.js (window.Akari).
 * Tap a white cell to cycle: empty → 💡 bulb → · dot (proven no-bulb) → empty.
 * Light beams render live; conflicts show after a ~1s pause so you're not
 * scolded mid-thought.
 */
(function () {
  "use strict";

  const EMPTY = 0, BULB = 1, DOT = 2;
  const WALL = -1;

  const els = {};
  let state = null; // { size, layout, clues, solution:Set, marks, mode, solved, startTs, elapsedMs }
  let timerId = null;

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function todayKey(date) { const d = date || new Date(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function yesterdayKey() { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return todayKey(d); }
  function loadStats() {
    return { solved: LS.get("ak_solved", 0), streak: LS.get("ak_streak", 0), lastDaily: LS.get("ak_lastDaily", null), best: LS.get("ak_best_" + (state ? state.size : 10), null) };
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
    if (mode === "daily") opts.seed = window.Akari.dailySeed();
    const p = window.Akari.generate(opts);
    state = {
      size: p.size, layout: p.layout, clues: p.clues, solution: new Set(p.solution),
      marks: new Array(p.size * p.size).fill(EMPTY),
      mode: mode, solved: false, elapsedMs: 0
    };
    els.modeLabel.textContent = mode === "daily" ? "Daily Challenge · " + todayKey() : "Unlimited · " + p.size + "×" + p.size;
    if (mode === "daily") els.size.value = String(p.size);
    hideWinModal();
    cancelConflictTimer();
    buildBoard();
    refreshLight();
    setMessage("", "");
    els.timer.textContent = "0:00";
    startTimer();
    renderStats();
  }

  function buildBoard() {
    const n = state.size;
    els.board.style.setProperty("--n", n);
    els.board.classList.remove("is-won");
    els.board.innerHTML = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const isWall = state.layout[r][c] === WALL;
        const cell = document.createElement(isWall ? "div" : "button");
        if (!isWall) cell.type = "button";
        cell.className = isWall ? "ak-cell ak-wall" : "ak-cell";
        cell.dataset.i = i;
        if (isWall && state.clues[r][c] >= 0) cell.textContent = state.clues[r][c];
        if (!isWall) cell.setAttribute("aria-label", "row " + (r + 1) + " column " + (c + 1));
        els.board.appendChild(cell);
      }
    }
  }

  function sight(i) {
    const n = state.size, r = Math.floor(i / n), c = i % n, out = [];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < n && cc >= 0 && cc < n && state.layout[rr][cc] !== WALL) {
        out.push(rr * n + cc);
        rr += dr; cc += dc;
      }
    }
    return out;
  }

  function refreshLight() {
    const n = state.size;
    const lit = new Array(n * n).fill(false);
    for (let i = 0; i < n * n; i++) {
      if (state.marks[i] !== BULB) continue;
      lit[i] = true;
      for (const j of sight(i)) lit[j] = true;
    }
    let unlit = 0;
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n), c = i % n;
      if (state.layout[r][c] === WALL) continue;
      const el = els.board.children[i];
      el.classList.toggle("is-lit", lit[i]);
      el.classList.toggle("is-bulb", state.marks[i] === BULB);
      el.classList.toggle("is-dot", state.marks[i] === DOT);
      if (!lit[i]) unlit++;
    }
    els.litLabel.textContent = "💡 " + (n * n - wallCount() - unlit) + "/" + (n * n - wallCount());
    return lit;
  }
  let _wallCount = null;
  function wallCount() {
    if (_wallCount === null || _wallCount.size !== state.size) {
      let cnt = 0;
      for (let r = 0; r < state.size; r++) for (let c = 0; c < state.size; c++) if (state.layout[r][c] === WALL) cnt++;
      _wallCount = { size: state.size, cnt: cnt };
    }
    return _wallCount.cnt;
  }

  function onBoardClick(e) {
    const cell = e.target.closest && e.target.closest("button.ak-cell");
    if (!cell || state.solved) return;
    const i = +cell.dataset.i;
    state.marks[i] = state.marks[i] === EMPTY ? BULB : state.marks[i] === BULB ? DOT : EMPTY;
    refreshLight();
    scheduleConflicts();
    checkWin();
  }

  // ---- validation --------------------------------------------------------
  function findConflicts() {
    const n = state.size, bad = new Set();
    for (let i = 0; i < n * n; i++) {
      if (state.marks[i] !== BULB) continue;
      for (const j of sight(i)) if (state.marks[j] === BULB) { bad.add(i); bad.add(j); }
    }
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (state.layout[r][c] !== WALL || state.clues[r][c] < 0) continue;
        let bulbs = 0, free = 0;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= n || cc < 0 || cc >= n || state.layout[rr][cc] === WALL) continue;
          if (state.marks[rr * n + cc] === BULB) bulbs++;
          else if (state.marks[rr * n + cc] === EMPTY) free++;
        }
        if (bulbs > state.clues[r][c] || bulbs + free < state.clues[r][c]) bad.add(r * n + c);
      }
    }
    return bad;
  }
  let conflictTimer = null;
  function clearConflictMarks() { els.board.querySelectorAll(".ak-cell.is-bad").forEach((c) => c.classList.remove("is-bad")); }
  function applyConflicts() {
    clearConflictMarks();
    findConflicts().forEach((i) => { const el = els.board.children[i]; if (el) el.classList.add("is-bad"); });
  }
  function cancelConflictTimer() { if (conflictTimer) { clearTimeout(conflictTimer); conflictTimer = null; } }
  function scheduleConflicts() {
    clearConflictMarks();
    cancelConflictTimer();
    conflictTimer = setTimeout(applyConflicts, 1000);
  }

  function checkWin() {
    const n = state.size;
    const lit = [];
    for (let i = 0; i < n * n; i++) lit.push(false);
    for (let i = 0; i < n * n; i++) {
      if (state.marks[i] !== BULB) continue;
      lit[i] = true;
      for (const j of sight(i)) lit[j] = true;
    }
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n), c = i % n;
      if (state.layout[r][c] === WALL) continue;
      if (!lit[i]) return false;
    }
    if (findConflicts().size > 0) return false;
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
    LS.set("ak_solved", stats.solved); LS.set("ak_streak", stats.streak); LS.set("ak_lastDaily", stats.lastDaily); LS.set("ak_best_" + state.size, stats.best);
    renderStats();
    setMessage("All lit in " + formatTime(elapsed) + "!", "ok");
    showWinModal(elapsed);
  }

  function showWinModal(elapsed) {
    const modal = document.getElementById("win-modal");
    if (!modal) return;
    const sub = document.getElementById("win-sub");
    const s = loadStats();
    let txt = "All lit in " + formatTime(elapsed);
    if (state.mode === "daily" && s.streak > 0) txt += " · " + s.streak + " day streak";
    if (sub) sub.textContent = txt;
    modal.hidden = false;
  }
  function hideWinModal() { const m = document.getElementById("win-modal"); if (m) m.hidden = true; }

  function hint() {
    if (state.solved) return;
    const n = state.size;
    // 1) flag a wrong bulb
    for (let i = 0; i < n * n; i++)
      if (state.marks[i] === BULB && !state.solution.has(i)) {
        flash(els.board.children[i]); setMessage("That bulb is wrong — try clearing it.", "warn"); return;
      }
    // 2) reveal one missing solution bulb
    const missing = [];
    state.solution.forEach((i) => { if (state.marks[i] !== BULB) missing.push(i); });
    if (!missing.length) return;
    const i = missing[Math.floor(Math.random() * missing.length)];
    state.marks[i] = BULB;
    refreshLight(); flash(els.board.children[i]);
    scheduleConflicts();
    if (!checkWin()) setMessage("Placed one bulb for you. Keep going!", "");
  }
  function flash(cell) { if (!cell) return; cell.classList.add("flash"); setTimeout(() => cell.classList.remove("flash"), 900); }

  function clearBoard() {
    if (!state) return;
    state.marks.fill(EMPTY);
    state.solved = false;
    els.board.classList.remove("is-won");
    refreshLight();
    cancelConflictTimer(); clearConflictMarks(); setMessage("", ""); startTimer();
  }
  function setMessage(text, kind) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); }

  function shareResult() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const lines = ["💡 Akari"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Unlimited · " + state.size + "×" + state.size);
    if (state.solved) {
      lines.push("✅ All lit in " + formatTime(state.elapsedMs) + " ⏱️");
      const s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
    } else lines.push("Can you light every cell? 💡");
    lines.push(base);
    const text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "Akari", text: text }).catch(function () {});
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
    els.litLabel = document.getElementById("litcount");
    els.message = document.getElementById("message");
    els.modeLabel = document.getElementById("mode-label");
    els.statSolved = document.getElementById("stat-solved");
    els.statStreak = document.getElementById("stat-streak");
    els.statBest = document.getElementById("stat-best");
    els.size = document.getElementById("size");

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
