/*
 * Futoshiki puzzle engine (inequality latin square).
 * --------------------------------------------------------------------------
 * Fill the n×n grid so every row and column contains 1…n exactly once and all
 * < / > signs between neighbors hold.
 *
 * Generation: random latin square → start from ALL givens and ALL inequality
 * signs → greedily strip both while a logic solver still completes the board.
 * The solver uses candidate propagation (row/col elimination, hidden singles,
 * inequality pruning) plus one-step proof-by-contradiction — so every shipped
 * board is solvable without guessing and unique. Candidates are bitmasks and
 * the expensive contradiction pass only runs when plain propagation stalls.
 * Framework-free; attaches window.Futoshiki.
 */
(function () {
  "use strict";

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function makeLatin(n, rng) {
    const g = Array.from({ length: n }, () => new Array(n).fill(0));
    function ok(r, c, v) {
      for (let i = 0; i < n; i++) if (g[r][i] === v || g[i][c] === v) return false;
      return true;
    }
    function bt(idx) {
      if (idx === n * n) return true;
      const r = Math.floor(idx / n), c = idx % n;
      for (const v of shuffle(Array.from({ length: n }, (_, i) => i + 1), rng)) {
        if (ok(r, c, v)) {
          g[r][c] = v;
          if (bt(idx + 1)) return true;
          g[r][c] = 0;
        }
      }
      return false;
    }
    bt(0);
    return g;
  }

  function popcount(x) {
    x = x - ((x >> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
    return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
  }
  const lowBitIdx = (x) => 31 - Math.clz32(x & -x); // index of lowest set bit
  const highBitIdx = (x) => 31 - Math.clz32(x);     // index of highest set bit

  /*
   * Candidate masks: cells[i] has bit (v-1) set iff value v is possible.
   * h[r][c]: relation (r,c) vs (r,c+1): 0 none / 1 "<" / 2 ">". v likewise.
   * Returns false on contradiction, else true (cells mutated in place).
   */
  function propagate(n, cells, h, v) {
    const full = (1 << n) - 1;
    let changed = true;
    while (changed) {
      changed = false;
      // singles eliminate along row/col
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const m = cells[r * n + c];
          if (m === 0) return false;
          if ((m & (m - 1)) !== 0) continue; // not a single
          for (let i = 0; i < n; i++) {
            if (i !== c) { const j = r * n + i; if (cells[j] & m) { cells[j] &= ~m; changed = true; } }
            if (i !== r) { const j = i * n + c; if (cells[j] & m) { cells[j] &= ~m; changed = true; } }
          }
        }
      }
      // hidden singles
      for (let r = 0; r < n; r++) {
        for (let v2 = 0; v2 < n; v2++) {
          const bit = 1 << v2;
          let spot = -1, cnt = 0;
          for (let c = 0; c < n; c++) if (cells[r * n + c] & bit) { spot = c; if (++cnt > 1) break; }
          if (cnt === 0) return false;
          if (cnt === 1 && cells[r * n + spot] !== bit) { cells[r * n + spot] = bit; changed = true; }
        }
      }
      for (let c = 0; c < n; c++) {
        for (let v2 = 0; v2 < n; v2++) {
          const bit = 1 << v2;
          let spot = -1, cnt = 0;
          for (let r = 0; r < n; r++) if (cells[r * n + c] & bit) { spot = r; if (++cnt > 1) break; }
          if (cnt === 0) return false;
          if (cnt === 1 && cells[spot * n + c] !== bit) { cells[spot * n + c] = bit; changed = true; }
        }
      }
      // inequality pruning: a < b ⇒ a keeps values < max(b), b keeps values > min(a)
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const i = r * n + c;
          if (c < n - 1 && h[r][c]) {
            const j = i + 1;
            const a = h[r][c] === 1 ? i : j, b = h[r][c] === 1 ? j : i;
            const ka = cells[a] & ((1 << highBitIdx(cells[b])) - 1);
            const kb = cells[b] & (full & ~((1 << (lowBitIdx(cells[a]) + 1)) - 1));
            if (ka !== cells[a]) { cells[a] = ka; changed = true; }
            if (kb !== cells[b]) { cells[b] = kb; changed = true; }
            if (!cells[a] || !cells[b]) return false;
          }
          if (r < n - 1 && v[r][c]) {
            const j = i + n;
            const a = v[r][c] === 1 ? i : j, b = v[r][c] === 1 ? j : i;
            const ka = cells[a] & ((1 << highBitIdx(cells[b])) - 1);
            const kb = cells[b] & (full & ~((1 << (lowBitIdx(cells[a]) + 1)) - 1));
            if (ka !== cells[a]) { cells[a] = ka; changed = true; }
            if (kb !== cells[b]) { cells[b] = kb; changed = true; }
            if (!cells[a] || !cells[b]) return false;
          }
        }
      }
    }
    return true;
  }

  function freshCells(n, givens) {
    const full = (1 << n) - 1;
    const cells = new Uint16Array(n * n);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        cells[r * n + c] = givens[r][c] ? (1 << (givens[r][c] - 1)) : full;
    return cells;
  }
  function allSingles(n, cells) {
    for (let i = 0; i < n * n; i++) { const m = cells[i]; if (!m || (m & (m - 1))) return false; }
    return true;
  }

  function logicSolve(n, givens, h, v) {
    const cells = freshCells(n, givens);
    if (!propagate(n, cells, h, v)) return false;
    if (allSingles(n, cells)) return true;

    // escalate: one-step contradiction testing
    let progress = true;
    while (progress && !allSingles(n, cells)) {
      progress = false;
      for (let i = 0; i < n * n && !progress; i++) {
        let m = cells[i];
        if (!(m & (m - 1))) continue; // single
        while (m) {
          const bit = m & -m; m &= m - 1;
          const t = cells.slice();
          t[i] = bit;
          if (!propagate(n, t, h, v)) {
            cells[i] &= ~bit;
            if (!propagate(n, cells, h, v)) return false;
            progress = true;
            break;
          }
        }
      }
    }
    return allSingles(n, cells);
  }

  function generate(opts) {
    opts = opts || {};
    const n = opts.size || 5;
    const rng = typeof opts.seed === "number" ? mulberry32(opts.seed) : Math.random;

    const sol = makeLatin(n, rng);
    const givens = sol.map((row) => row.slice());
    const h = Array.from({ length: n }, () => new Array(n).fill(0));
    const v = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        if (c < n - 1) h[r][c] = sol[r][c] < sol[r][c + 1] ? 1 : 2;
        if (r < n - 1) v[r][c] = sol[r][c] < sol[r + 1][c] ? 1 : 2;
      }

    // strip givens first (a real futoshiki shows few numbers), then edges
    const givenHandles = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) givenHandles.push(["g", r, c]);
    const edgeHandles = [];
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        if (c < n - 1) edgeHandles.push(["h", r, c]);
        if (r < n - 1) edgeHandles.push(["v", r, c]);
      }
    const order = shuffle(givenHandles, rng).concat(shuffle(edgeHandles, rng));

    for (const [type, r, c] of order) {
      let prev;
      if (type === "g") { prev = givens[r][c]; givens[r][c] = 0; }
      else if (type === "h") { prev = h[r][c]; h[r][c] = 0; }
      else { prev = v[r][c]; v[r][c] = 0; }
      if (!logicSolve(n, givens, h, v)) {
        if (type === "g") givens[r][c] = prev;
        else if (type === "h") h[r][c] = prev;
        else v[r][c] = prev;
      }
    }

    return { size: n, solution: sol, givens: givens, h: h, v: v };
  }

  function dailySeed(date) {
    const d = date || new Date();
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }

  window.Futoshiki = window.Futoshiki || {};
  window.Futoshiki.generate = generate;
  window.Futoshiki.dailySeed = dailySeed;
})();
