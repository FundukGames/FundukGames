/*
 * Trail — game UI & interaction layer. Depends on generator.js (window.Trail).
 * Draw one continuous path through every cell, visiting the numbers in order.
 * Press and drag across cells (mouse or touch); drag back to undo.
 */
(function () {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";
  const els = {};
  let state = null; // { size, num, k, solution, path, mode, solved, elapsedMs }
  let timerId = null;
  let dragging = false;

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function todayKey(date) { const d = date || new Date(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function yesterdayKey() { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return todayKey(d); }
  function loadStats() { return { solved: LS.get("trail_solved", 0), streak: LS.get("trail_streak", 0), lastDaily: LS.get("trail_lastDaily", null), best: LS.get("trail_best", {}) }; }
  function renderStats() {
    const s = loadStats();
    els.statSolved.textContent = s.solved;
    els.statStreak.textContent = s.streak;
    const b = s.best[state ? state.size : 6];
    els.statBest.textContent = b ? formatTime(b) : "—";
  }
  function formatTime(ms) { const t = Math.floor(ms / 1000); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }
  function startTimer() { stopTimer(); state.startTs = Date.now(); timerId = setInterval(() => { els.timer.textContent = formatTime(Date.now() - state.startTs); }, 500); }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function newGame(mode, size) {
    size = size || 6;
    const opts = { size: size };
    if (mode === "daily") { opts.seed = window.Trail.dailySeed(); opts.size = 6; size = 6; }
    let p = window.Trail.generate(opts);
    for (let i = 0; i < 5 && !p; i++) p = window.Trail.generate({ size: size });
    state = { size: p.size, num: p.num, k: p.k, solution: p.path, path: [], mode: mode, solved: false, elapsedMs: 0 };
    els.modeLabel.textContent = mode === "daily" ? "Daily Challenge · " + todayKey() : "Unlimited · " + size + "×" + size;
    hideWinModal();
    buildBoard();
    render();
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
        const idx = r * n + c;
        const cell = document.createElement("div");
        cell.className = "zip-cell";
        cell.dataset.idx = idx;
        if (state.num[idx]) cell.innerHTML = '<span class="zip-badge">' + state.num[idx] + "</span>";
        board.appendChild(cell);
      }
    }
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "zip-svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    const poly = document.createElementNS(SVGNS, "polyline");
    poly.setAttribute("class", "zip-path");
    svg.appendChild(poly);
    board.appendChild(svg);
    els.poly = poly;
  }

  function render() {
    const n = state.size, set = new Set(state.path);
    els.board.querySelectorAll(".zip-cell").forEach((cell) => {
      cell.classList.toggle("visited", set.has(+cell.dataset.idx));
    });
    const pts = state.path.map((idx) => {
      const r = (idx / n) | 0, c = idx % n;
      return ((c + 0.5) / n * 100).toFixed(2) + "," + ((r + 0.5) / n * 100).toFixed(2);
    }).join(" ");
    els.poly.setAttribute("points", pts);
  }

  function adjacent(a, b) {
    const n = state.size;
    const ar = (a / n) | 0, ac = a % n, br = (b / n) | 0, bc = b % n;
    return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
  }
  function numbersInPath() { let c = 0; for (const idx of state.path) if (state.num[idx]) c++; return c; }
  function canExtendTo(idx) {
    if (state.path.indexOf(idx) >= 0) return false;
    if (state.path.length === 0) return state.num[idx] === 1;
    if (!adjacent(state.path[state.path.length - 1], idx)) return false;
    if (state.num[idx] !== 0 && state.num[idx] !== numbersInPath() + 1) return false;
    return true;
  }

  function cellIdxFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest && el.closest(".zip-cell");
    return cell && cell.parentElement === els.board ? +cell.dataset.idx : -1;
  }

  function onDown(e) {
    if (state.solved) return;
    const idx = cellIdxFromPoint(e.clientX, e.clientY);
    if (idx < 0) return;
    const pos = state.path.indexOf(idx);
    if (pos >= 0) { state.path = state.path.slice(0, pos + 1); dragging = true; render(); return; }
    if (canExtendTo(idx)) { state.path.push(idx); dragging = true; render(); checkWin(); }
  }
  function onMove(e) {
    if (!dragging || state.solved) return;
    const idx = cellIdxFromPoint(e.clientX, e.clientY);
    if (idx < 0) return;
    const last = state.path[state.path.length - 1];
    if (idx === last) { e.preventDefault(); return; }
    if (state.path.length >= 2 && idx === state.path[state.path.length - 2]) { state.path.pop(); render(); e.preventDefault(); return; }
    if (canExtendTo(idx)) { state.path.push(idx); render(); checkWin(); e.preventDefault(); }
  }
  function onUp() { dragging = false; }

  function checkWin() {
    const total = state.size * state.size;
    if (state.path.length !== total) return false;
    if (state.num[state.path[state.path.length - 1]] !== state.k) return false;
    win(); return true;
  }
  function win() {
    state.solved = true; stopTimer();
    const elapsed = Date.now() - state.startTs; state.elapsedMs = elapsed;
    const stats = loadStats(); stats.solved += 1;
    if (state.mode === "daily") {
      const tk = todayKey();
      if (stats.lastDaily !== tk) { stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1; stats.lastDaily = tk; }
    }
    if (!stats.best[state.size] || elapsed < stats.best[state.size]) stats.best[state.size] = elapsed;
    LS.set("trail_solved", stats.solved); LS.set("trail_streak", stats.streak); LS.set("trail_lastDaily", stats.lastDaily); LS.set("trail_best", stats.best);
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
    let i = 0;
    while (i < state.path.length && i < state.solution.length && state.path[i] === state.solution[i]) i++;
    if (i < state.path.length) {
      state.path = state.path.slice(0, i); render();
      setMessage("Your path went off-track — trimmed back to the last correct step.", "warn");
      return;
    }
    if (state.solution.length > state.path.length) {
      state.path.push(state.solution[state.path.length]);
      render(); checkWin();
      setMessage("Revealed the next step. Keep going!", "");
    }
  }
  function clearBoard() { if (!state) return; state.path = []; state.solved = false; render(); setMessage("", ""); startTimer(); }
  function setMessage(text, kind) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); }

  function shareResult() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const lines = ["🔗 Trail"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Unlimited · " + state.size + "×" + state.size);
    if (state.solved) { lines.push("✅ Solved in " + formatTime(state.elapsedMs) + " ⏱️"); const s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak); }
    else lines.push("Can you connect the dots? 🔗");
    lines.push(base);
    const text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "Trail", text: text }).catch(function () {});
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

    els.board.addEventListener("pointerdown", onDown);
    els.board.addEventListener("pointermove", onMove);
    els.board.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    document.getElementById("btn-new").addEventListener("click", () => newGame("unlimited", +document.getElementById("size-select").value));
    document.getElementById("btn-daily").addEventListener("click", () => newGame("daily"));
    document.getElementById("btn-hint").addEventListener("click", hint);
    document.getElementById("btn-clear").addEventListener("click", clearBoard);
    document.getElementById("btn-share").addEventListener("click", shareResult);
    document.getElementById("size-select").addEventListener("change", () => newGame("unlimited", +document.getElementById("size-select").value));

    const winNew = document.getElementById("win-new");
    if (winNew) winNew.addEventListener("click", () => newGame("unlimited", +document.getElementById("size-select").value));
    const winShare = document.getElementById("win-share");
    if (winShare) winShare.addEventListener("click", shareResult);
    const winClose = document.getElementById("win-close");
    if (winClose) winClose.addEventListener("click", hideWinModal);

    newGame("unlimited", 6);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
