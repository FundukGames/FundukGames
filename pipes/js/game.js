/*
 * Pipes — game UI & interaction layer. Depends on generator.js (window.Pipes).
 * Tap rotates a piece clockwise (right-click / long-press: counter-clockwise).
 * Water flows live from the source; leaf pieces are lamps that light up when
 * fed. Win = every piece lit and not a single open end.
 */
(function () {
  "use strict";

  const N = 1, E = 2, S = 4, W = 8;
  const DIRS = [
    { bit: N, dr: -1, dc: 0, opp: S },
    { bit: E, dr: 0, dc: 1, opp: W },
    { bit: S, dr: 1, dc: 0, opp: N },
    { bit: W, dr: 0, dc: -1, opp: E }
  ];

  const els = {};
  let state = null; // { size, base, rots, rots0, source, mode, solved, moves, startTs, elapsedMs }
  let timerId = null;

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function todayKey(date) { const d = date || new Date(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function yesterdayKey() { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return todayKey(d); }
  function loadStats() {
    return { solved: LS.get("pp_solved", 0), streak: LS.get("pp_streak", 0), lastDaily: LS.get("pp_lastDaily", null), best: LS.get("pp_best_" + (state ? state.size : 7), null) };
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
    const size = mode === "daily" ? 7 : +els.size.value;
    const opts = { size: size };
    if (mode === "daily") opts.seed = window.Pipes.dailySeed();
    const p = window.Pipes.generate(opts);
    state = { size: p.size, base: p.base, rots: p.rots.slice(), rots0: p.rots.slice(), source: p.source, mode: mode, solved: false, moves: 0, elapsedMs: 0 };
    els.modeLabel.textContent = mode === "daily" ? "Daily Challenge · " + todayKey() : "Unlimited · " + p.size + "×" + p.size;
    if (mode === "daily") els.size.value = String(p.size);
    hideWinModal();
    buildBoard();
    refreshFlow();
    renderMoves();
    setMessage("", "");
    els.timer.textContent = "0:00";
    startTimer();
    renderStats();
  }

  function conn(i) { return window.Pipes.rot(state.base[i], state.rots[i]); }

  function pipeSvg(mask, isSource, isLeaf) {
    const parts = [];
    if (mask & N) parts.push("M20 20 L20 1");
    if (mask & E) parts.push("M20 20 L39 20");
    if (mask & S) parts.push("M20 20 L20 39");
    if (mask & W) parts.push("M20 20 L1 20");
    let inner = '<path class="pp-pipe" d="' + parts.join(" ") + '"/>';
    if (isSource) inner += '<circle class="pp-src" cx="20" cy="20" r="9"/><circle class="pp-src-core" cx="20" cy="20" r="4"/>';
    else if (isLeaf) inner += '<circle class="pp-lamp" cx="20" cy="20" r="7.5"/>';
    else inner += '<circle class="pp-hub" cx="20" cy="20" r="4.5"/>';
    return '<svg viewBox="0 0 40 40" aria-hidden="true">' + inner + "</svg>";
  }

  function degree(mask) { let d = 0; for (let k = 0; k < 4; k++) if (mask & (1 << k)) d++; return d; }

  function buildBoard() {
    const n = state.size;
    els.board.style.setProperty("--n", n);
    els.board.classList.remove("is-won");
    els.board.innerHTML = "";
    for (let i = 0; i < n * n; i++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "pp-cell" + (i === state.source ? " is-src" : "");
      cell.dataset.i = i;
      cell.setAttribute("aria-label", "pipe row " + (Math.floor(i / n) + 1) + " column " + ((i % n) + 1));
      cell.innerHTML = pipeSvg(state.base[i], i === state.source, degree(state.base[i]) === 1);
      cell.firstChild.style.setProperty("--rot", state.rots[i]);
      els.board.appendChild(cell);
    }
  }

  // live flow: BFS from source across matched ends
  function refreshFlow() {
    const n = state.size;
    const lit = new Array(n * n).fill(false);
    lit[state.source] = true;
    const stack = [state.source];
    while (stack.length) {
      const cur = stack.pop();
      const r = Math.floor(cur / n), c = cur % n;
      const cm = conn(cur);
      for (const d of DIRS) {
        const rr = r + d.dr, cc = c + d.dc;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        const j = rr * n + cc;
        if (!lit[j] && (cm & d.bit) && (conn(j) & d.opp)) { lit[j] = true; stack.push(j); }
      }
    }
    let litCount = 0, dangling = 0;
    for (let i = 0; i < n * n; i++) {
      if (lit[i]) litCount++;
      els.board.children[i].classList.toggle("is-lit", lit[i]);
      const r = Math.floor(i / n), c = i % n, cm = conn(i);
      for (const d of DIRS) {
        const rr = r + d.dr, cc = c + d.dc;
        if (!(cm & d.bit)) continue;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) dangling++;
        else if (!(conn(rr * n + cc) & d.opp)) dangling++;
      }
    }
    els.litLabel.textContent = "💡 " + litCount + "/" + n * n;
    return { litCount: litCount, dangling: dangling };
  }

  function rotate(i, delta) {
    if (state.solved) return;
    state.rots[i] += delta;
    state.moves++;
    renderMoves();
    const svg = els.board.children[i].firstChild;
    svg.style.setProperty("--rot", state.rots[i]);
    const res = refreshFlow();
    if (res.litCount === state.size * state.size && res.dangling === 0) win();
  }
  function renderMoves() { els.moves.textContent = state.moves; }

  function win() {
    state.solved = true; stopTimer();
    els.board.classList.add("is-won");
    const elapsed = Date.now() - state.startTs; state.elapsedMs = elapsed;
    const stats = loadStats(); stats.solved += 1;
    if (state.mode === "daily") {
      const tk = todayKey();
      if (stats.lastDaily !== tk) { stats.streak = (stats.lastDaily === yesterdayKey()) ? stats.streak + 1 : 1; stats.lastDaily = tk; }
    }
    if (!stats.best || elapsed < stats.best) stats.best = elapsed;
    LS.set("pp_solved", stats.solved); LS.set("pp_streak", stats.streak); LS.set("pp_lastDaily", stats.lastDaily); LS.set("pp_best_" + state.size, stats.best);
    renderStats();
    setMessage("Connected in " + formatTime(elapsed) + " · " + state.moves + " moves!", "ok");
    showWinModal(elapsed);
  }

  function showWinModal(elapsed) {
    const modal = document.getElementById("win-modal");
    if (!modal) return;
    const sub = document.getElementById("win-sub");
    const s = loadStats();
    let txt = "Connected in " + formatTime(elapsed) + " · " + state.moves + " moves";
    if (state.mode === "daily" && s.streak > 0) txt += " · " + s.streak + " day streak";
    if (sub) sub.textContent = txt;
    modal.hidden = false;
  }
  function hideWinModal() { const m = document.getElementById("win-modal"); if (m) m.hidden = true; }

  function hint() {
    if (state.solved) return;
    const n = state.size;
    for (let i = 0; i < n * n; i++) {
      if (conn(i) !== state.base[i]) {
        let k = 0;
        while (window.Pipes.rot(state.base[i], state.rots[i] + k) !== state.base[i]) k++;
        state.rots[i] += k;
        const svg = els.board.children[i].firstChild;
        svg.style.setProperty("--rot", state.rots[i]);
        flash(els.board.children[i]);
        const res = refreshFlow();
        setMessage("Turned one piece into place. Keep going!", "");
        if (res.litCount === n * n && res.dangling === 0) win();
        return;
      }
    }
  }
  function flash(cell) { if (!cell) return; cell.classList.add("flash"); setTimeout(() => cell.classList.remove("flash"), 900); }

  function resetBoard() {
    if (!state) return;
    state.rots = state.rots0.slice();
    state.moves = 0; state.solved = false;
    els.board.classList.remove("is-won");
    for (let i = 0; i < state.size * state.size; i++)
      els.board.children[i].firstChild.style.setProperty("--rot", state.rots[i]);
    refreshFlow(); renderMoves(); setMessage("", ""); startTimer();
  }
  function setMessage(text, kind) { els.message.textContent = text; els.message.className = "message" + (kind ? " message--" + kind : ""); }

  function shareResult() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const lines = ["🔧 Pipes"];
    lines.push(state.mode === "daily" ? "Daily · " + todayKey() : "Unlimited · " + state.size + "×" + state.size);
    if (state.solved) {
      lines.push("✅ Connected in " + formatTime(state.elapsedMs) + " · " + state.moves + " moves");
      const s = loadStats(); if (state.mode === "daily" && s.streak > 0) lines.push("🔥 Streak: " + s.streak);
    } else lines.push("Can you light the whole network? 💡");
    lines.push(base);
    const text = lines.join("\n");
    if (navigator.share) navigator.share({ title: "Pipes", text: text }).catch(function () {});
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { setMessage("Result copied — paste it anywhere!", "ok"); }, function () { fallbackCopy(text); });
    else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); setMessage("Result copied!", "ok"); } catch (e) { setMessage("Couldn't copy — long-press to copy.", "warn"); }
    document.body.removeChild(ta);
  }

  // ---- input: tap CW, right-click / long-press CCW -------------------------
  let lpTimer = null, lpFired = false;
  function onPointerDown(e) {
    const cell = e.target.closest && e.target.closest(".pp-cell");
    if (!cell) return;
    lpFired = false;
    if (e.pointerType === "touch") {
      lpTimer = setTimeout(() => {
        lpFired = true;
        rotate(+cell.dataset.i, -1);
        if (navigator.vibrate) navigator.vibrate(30);
      }, 420);
    }
  }
  function cancelLp() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }
  function onClick(e) {
    const cell = e.target.closest && e.target.closest(".pp-cell");
    if (!cell || lpFired) return;
    rotate(+cell.dataset.i, 1);
  }
  function onContext(e) {
    e.preventDefault();
    const cell = e.target.closest && e.target.closest(".pp-cell");
    if (cell) rotate(+cell.dataset.i, -1);
  }

  function boot() {
    els.board = document.getElementById("board");
    els.timer = document.getElementById("timer");
    els.message = document.getElementById("message");
    els.modeLabel = document.getElementById("mode-label");
    els.litLabel = document.getElementById("litcount");
    els.moves = document.getElementById("movecount");
    els.statSolved = document.getElementById("stat-solved");
    els.statStreak = document.getElementById("stat-streak");
    els.statBest = document.getElementById("stat-best");
    els.size = document.getElementById("size");

    els.board.addEventListener("click", onClick);
    els.board.addEventListener("contextmenu", onContext);
    els.board.addEventListener("pointerdown", onPointerDown);
    els.board.addEventListener("pointerup", cancelLp);
    els.board.addEventListener("pointercancel", cancelLp);
    els.board.addEventListener("pointermove", (e) => { if (e.pointerType === "touch") cancelLp(); });

    document.getElementById("btn-new").addEventListener("click", () => newGame("unlimited"));
    document.getElementById("btn-daily").addEventListener("click", () => newGame("daily"));
    document.getElementById("btn-hint").addEventListener("click", hint);
    document.getElementById("btn-reset").addEventListener("click", resetBoard);
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
