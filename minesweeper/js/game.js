/*
 * Minesweeper — game UI & interaction layer. Depends on generator.js (window.Mines).
 * Dig / Flag tools, right-click flags, long-press flags on touch, chording on
 * numbers. Unlimited boards generate after your first dig (so it's always safe);
 * the Daily opens its start area for everyone at the same spot.
 */
(function () {
  "use strict";

  const DIFFS = {
    easy: { w: 9, h: 9, mines: 10, label: "Easy · 9×9" },
    medium: { w: 16, h: 16, mines: 40, label: "Medium · 16×16" },
    hard: { w: 24, h: 16, mines: 80, label: "Hard · 24×16" }
  };
  const COVERED = 0, OPEN = 1, FLAG = 2;

  const els = {};
  let state = null; // { w, h, mines, mine, numbers, cells, mode, diff, phase, startTs, elapsedMs, pending }
  let timerId = null;
  let tool = "dig";

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function todayKey(date) { const d = date || new Date(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function yesterdayKey() { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return todayKey(d); }
  function loadStats() {
    return { solved: LS.get("ms_solved", 0), streak: LS.get("ms_streak", 0), lastDaily: LS.get("ms_lastDaily", null), best: LS.get("ms_best_" + (state ? state.diff : "medium"), null) };
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
    const diff = mode === "daily" ? "medium" : els.diff.value;
    const d = DIFFS[diff];
    state = {
      w: d.w, h: d.h, mines: d.mines, diff: diff, mode: mode,
      mine: null, numbers: null,
      cells: new Array(d.w * d.h).fill(COVERED),
      phase: "idle", elapsedMs: 0, pending: false
    };
    els.modeLabel.textContent = mode === "daily" ? "Daily · " + todayKey() : d.label;
    if (mode === "daily") els.diff.value = "medium";
    stopTimer();
    els.timer.textContent = "0:00";
    hideModal();
    buildBoard();
    renderCounter();
    renderStats();
    if (mode === "daily") {
      const safe = [Math.floor(d.h / 2), Math.floor(d.w / 2)];
      state.board = window.Mines.generate({ w: d.w, h: d.h, mines: d.mines, safe: safe, seed: window.Mines.dailySeed() });
      adoptBoard(state.board);
      state.phase = "playing";
      startTimer();
      openCell(safe[0] * d.w + safe[1]);
      setMessage("Daily board — the opening is done for you. No guessing needed!", "");
    } else {
      setMessage("Dig anywhere to start — the first cell is always safe.", "");
    }
  }

  function adoptBoard(b) { state.mine = b.mine; state.numbers = b.numbers; }

  function ensureBoard(idx) {
    if (state.mine) return;
    const safe = [Math.floor(idx / state.w), idx % state.w];
    state.board = window.Mines.generate({ w: state.w, h: state.h, mines: state.mines, safe: safe });
    adoptBoard(state.board);
    state.phase = "playing";
    setMessage("", "");
    startTimer();
  }

  function buildBoard() {
    const { w, h } = state;
    els.board.style.setProperty("--w", w);
    els.board.classList.toggle("ms-board--wide", w > 16);
    els.board.classList.remove("is-done");
    els.board.innerHTML = "";
    for (let i = 0; i < w * h; i++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "ms-cell";
      cell.dataset.i = i;
      cell.setAttribute("aria-label", "row " + (Math.floor(i / w) + 1) + " column " + ((i % w) + 1));
      els.board.appendChild(cell);
    }
  }

  function cellEl(i) { return els.board.children[i]; }
  function paintCell(i) {
    const el = cellEl(i); if (!el) return;
    const st = state.cells[i];
    el.className = "ms-cell";
    el.textContent = "";
    if (st === FLAG) { el.classList.add("is-flag"); el.textContent = "🚩"; }
    else if (st === OPEN) {
      el.classList.add("is-revealed");
      const n = state.numbers[i];
      if (n > 0) { el.textContent = n; el.classList.add("n" + n); }
    }
  }
  function paintAll() { for (let i = 0; i < state.w * state.h; i++) paintCell(i); }

  function renderCounter() {
    let flags = 0;
    for (const s of state.cells) if (s === FLAG) flags++;
    els.mines.textContent = "🚩 " + (state.mines - flags);
  }

  function neighbors(i) {
    const { w, h } = state, r = Math.floor(i / w), c = i % w, out = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < h && cc >= 0 && cc < w) out.push(rr * w + cc);
      }
    return out;
  }

  function openCell(i) {
    if (state.cells[i] !== COVERED) return;
    if (state.mine[i]) { lose(i); return; }
    const stack = [i];
    while (stack.length) {
      const j = stack.pop();
      if (state.cells[j] !== COVERED) continue;
      state.cells[j] = OPEN;
      paintCell(j);
      if (state.numbers[j] === 0) for (const k of neighbors(j)) if (state.cells[k] === COVERED) stack.push(k);
    }
    checkWin();
  }

  function chord(i) {
    const n = state.numbers[i];
    if (n <= 0) return;
    let flags = 0;
    for (const j of neighbors(i)) if (state.cells[j] === FLAG) flags++;
    if (flags !== n) return;
    for (const j of neighbors(i)) {
      if (state.cells[j] === COVERED) {
        if (state.mine[j]) { lose(j); return; }
        openCell(j);
        if (state.phase !== "playing") return;
      }
    }
  }

  function toggleFlag(i) {
    if (state.phase !== "playing" && state.phase !== "idle") return;
    if (!state.mine) return; // no flags before the first dig
    if (state.cells[i] === OPEN) return;
    state.cells[i] = state.cells[i] === FLAG ? COVERED : FLAG;
    paintCell(i);
    renderCounter();
  }

  function dig(i) {
    if (state.phase === "won" || state.phase === "lost") return;
    if (state.cells[i] === FLAG) return;
    if (state.cells[i] === OPEN) { chord(i); return; }
    ensureBoard(i);
    openCell(i);
  }

  function lose(boomIdx) {
    state.phase = "lost"; stopTimer();
    state.elapsedMs = Date.now() - state.startTs;
    for (let i = 0; i < state.w * state.h; i++) {
      if (state.mine[i]) {
        const el = cellEl(i);
        el.className = "ms-cell is-revealed is-mine" + (i === boomIdx ? " is-boom" : "");
        el.textContent = "💣";
      } else if (state.cells[i] === FLAG) {
        const el = cellEl(i);
        el.classList.add("is-wrong");
      }
    }
    els.board.classList.add("is-done");
    setMessage("Boom! That was a mine — but this board is beatable by logic. Try again?", "warn");
    showModal("Boom! 💥", "Every board here is solvable without guessing — give this one another go.", true);
  }

  function checkWin() {
    if (state.phase !== "playing") return;
    for (let i = 0; i < state.w * state.h; i++)
      if (!state.mine[i] && state.cells[i] !== OPEN) return;
    state.phase = "won"; stopTimer();
    const elapsed = Date.now() - state.startTs; state.elapsedMs = elapsed;
    for (let i = 0; i < state.w * state.h; i++)
      if (state.mine[i] && state.cells[i] !== FLAG) { state.cells[i] = FLAG; paintCell(i); }
    renderCounter();
    els.board.classList.add("is-done");
    const stats = loadStats(); stats.solved += 1;
    if (state.mode === "daily") {
      const tk = todayKey();
      if (stats.lastDaily !== tk) { stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1; stats.lastDaily = tk; }
    }
    if (!stats.best || elapsed < stats.best) stats.best = elapsed;
    LS.set("ms_solved", stats.solved); LS.set("ms_streak", stats.streak); LS.set("ms_lastDaily", stats.lastDaily); LS.set("ms_best_" + state.diff, stats.best);
    renderStats();
    setMessage("Cleared in " + formatTime(elapsed) + "!", "ok");
    const s = loadStats();
    let txt = "Cleared in " + formatTime(elapsed);
    if (state.mode === "daily" && s.streak > 0) txt += " · " + s.streak + " day streak";
    showModal("Cleared! 🎉", txt, false);
  }

  function retrySame() {
    if (!state.board) { newGame(state.mode); return; }
    state.cells = new Array(state.w * state.h).fill(COVERED);
    state.phase = "playing";
    els.board.classList.remove("is-done");
    paintAll();
    renderCounter();
    hideModal();
    setMessage("", "");
    startTimer();
    if (state.mode === "daily") openCell(Math.floor(state.h / 2) * state.w + Math.floor(state.w / 2));
  }

  function hint() {
    if (state.phase === "won" || state.phase === "lost") return;
    if (!state.mine) { setMessage("Dig your first cell first — it's always safe!", ""); return; }
    // 1) a wrong flag?
    for (let i = 0; i < state.w * state.h; i++)
      if (state.cells[i] === FLAG && !state.mine[i]) {
        flash(cellEl(i)); setMessage("That flag is wrong — remove it.", "warn"); return;
      }
    // 2) reveal a safe covered cell next to the opened area (or any safe cell)
    const frontier = [], rest = [];
    for (let i = 0; i < state.w * state.h; i++) {
      if (state.cells[i] !== COVERED || state.mine[i]) continue;
      (neighbors(i).some((j) => state.cells[j] === OPEN) ? frontier : rest).push(i);
    }
    const pool = frontier.length ? frontier : rest;
    if (!pool.length) return;
    const i = pool[Math.floor(Math.random() * pool.length)];
    openCell(i);
    if (state.phase === "playing") { flash(cellEl(i)); setMessage("Opened one safe cell. Keep going!", ""); }
  }
  function flash(el) { if (!el) return; el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 900); }

  function setMessage(text, kind) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); }

  function showModal(title, sub, lost) {
    const modal = document.getElementById("win-modal");
    if (!modal) return;
    document.getElementById("win-title").textContent = title;
    document.getElementById("win-sub").textContent = sub;
    document.getElementById("win-retry").hidden = !lost;
    modal.hidden = false;
  }
  function hideModal() { const m = document.getElementById("win-modal"); if (m) m.hidden = true; }

  function shareResult() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const lines = ["💣 Minesweeper (no-guess)"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : DIFFS[state.diff].label);
    if (state.phase === "won") {
      lines.push("✅ Cleared in " + formatTime(state.elapsedMs) + " ⏱️");
      const s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
    } else lines.push("Can you clear it without guessing? 💣");
    lines.push(base);
    const text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "Minesweeper", text: text }).catch(function () {});
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { setMessage("Result copied — paste it anywhere!", "ok"); }, function () { fallbackCopy(text); });
    else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); setMessage("Result copied!", "ok"); } catch (e) { setMessage("Couldn't copy — long-press to copy.", "warn"); }
    document.body.removeChild(ta);
  }

  function setTool(t) {
    tool = t;
    els.toolDig.classList.toggle("is-active", t === "dig");
    els.toolFlag.classList.toggle("is-active", t === "flag");
  }

  // ---- input: click digs, right-click / long-press / Flag-tool flags ------
  let lpTimer = null, lpFired = false;
  function onPointerDown(e) {
    const cell = e.target.closest && e.target.closest(".ms-cell");
    if (!cell) return;
    lpFired = false;
    if (e.pointerType === "touch") {
      lpTimer = setTimeout(() => {
        lpFired = true;
        toggleFlag(+cell.dataset.i);
        if (navigator.vibrate) navigator.vibrate(30);
      }, 380);
    }
  }
  function cancelLp() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }
  function onClick(e) {
    const cell = e.target.closest && e.target.closest(".ms-cell");
    if (!cell || lpFired) return;
    const i = +cell.dataset.i;
    if (tool === "flag" && state.cells[i] !== OPEN) toggleFlag(i);
    else dig(i);
  }
  function onContext(e) {
    e.preventDefault();
    const cell = e.target.closest && e.target.closest(".ms-cell");
    if (cell) toggleFlag(+cell.dataset.i);
  }

  function boot() {
    els.board = document.getElementById("board");
    els.timer = document.getElementById("timer");
    els.mines = document.getElementById("minecount");
    els.message = document.getElementById("message");
    els.modeLabel = document.getElementById("mode-label");
    els.statSolved = document.getElementById("stat-solved");
    els.statStreak = document.getElementById("stat-streak");
    els.statBest = document.getElementById("stat-best");
    els.diff = document.getElementById("difficulty");
    els.toolDig = document.getElementById("tool-dig");
    els.toolFlag = document.getElementById("tool-flag");

    els.board.addEventListener("click", onClick);
    els.board.addEventListener("contextmenu", onContext);
    els.board.addEventListener("pointerdown", onPointerDown);
    els.board.addEventListener("pointerup", cancelLp);
    els.board.addEventListener("pointercancel", cancelLp);
    els.board.addEventListener("pointermove", (e) => { if (e.pointerType === "touch") cancelLp(); });

    els.toolDig.addEventListener("click", () => setTool("dig"));
    els.toolFlag.addEventListener("click", () => setTool("flag"));
    document.getElementById("btn-new").addEventListener("click", () => newGame("unlimited"));
    document.getElementById("btn-daily").addEventListener("click", () => newGame("daily"));
    document.getElementById("btn-hint").addEventListener("click", hint);
    document.getElementById("btn-share").addEventListener("click", shareResult);
    els.diff.addEventListener("change", () => newGame("unlimited"));

    document.getElementById("win-new").addEventListener("click", () => newGame("unlimited"));
    document.getElementById("win-retry").addEventListener("click", retrySame);
    const winShare = document.getElementById("win-share");
    if (winShare) winShare.addEventListener("click", shareResult);
    const winClose = document.getElementById("win-close");
    if (winClose) winClose.addEventListener("click", hideModal);

    setTool("dig");
    newGame("unlimited");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
