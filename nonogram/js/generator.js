/*
 * Nonogram puzzle engine (picture-logic / "Picross"-style).
 * --------------------------------------------------------------------------
 * Fill cells of a W×H grid so every row and column matches its clue — the
 * lengths of the runs of filled cells in order, e.g. "3 1" = a run of 3, a
 * gap, then a single.
 *
 * Every board is line-solvable: repeatedly intersecting all legal placements
 * within single rows/columns completes the whole grid. That both guarantees a
 * unique solution and guarantees you never have to guess — the no-guess bar
 * all Funduk logic puzzles meet. Framework-free; attaches window.Nonogram.
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

  function cluesOf(line) {
    const out = [];
    let run = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === 1) run++;
      else if (run) { out.push(run); run = 0; }
    }
    if (run) out.push(run);
    return out;
  }

  /*
   * Single-line deduction. cells: -1 unknown / 0 empty / 1 filled.
   * Walks every placement of the clue blocks consistent with the known cells
   * (memoized on [position, block index]) and records which values each cell
   * can take. Cells possible only one way are forced.
   * Returns a list of [index, value] deductions, or null on contradiction.
   */
  function lineDeduce(cells, clues) {
    const L = cells.length, K = clues.length;
    const canFill = new Array(L).fill(false);
    const canEmpty = new Array(L).fill(false);
    const memo = new Array((L + 1) * (K + 1)).fill(0); // 0 unseen / 1 ok / 2 fail

    function rec(pos, k) {
      const key = pos * (K + 1) + k;
      if (memo[key]) return memo[key] === 1;
      let ok = false;
      if (k === K) {
        ok = true;
        for (let i = pos; i < L; i++) if (cells[i] === 1) { ok = false; break; }
        if (ok) for (let i = pos; i < L; i++) canEmpty[i] = true;
      } else {
        const len = clues[k];
        for (let start = pos; start + len <= L; start++) {
          let fits = true;
          for (let i = start; i < start + len; i++) if (cells[i] === 0) { fits = false; break; }
          const after = start + len;
          if (fits && after < L && cells[after] === 1) fits = false;
          if (fits && rec(after < L ? after + 1 : after, k + 1)) {
            ok = true;
            for (let i = pos; i < start; i++) canEmpty[i] = true;
            for (let i = start; i < after; i++) canFill[i] = true;
            if (after < L) canEmpty[after] = true;
          }
          if (cells[start] === 1) break; // a block must cover this cell — can't start later
        }
      }
      memo[key] = ok ? 1 : 2;
      return ok;
    }

    if (!rec(0, 0)) return null;
    const found = [];
    for (let i = 0; i < L; i++) {
      if (cells[i] !== -1) continue;
      if (canFill[i] && !canEmpty[i]) found.push([i, 1]);
      else if (!canFill[i] && canEmpty[i]) found.push([i, 0]);
      else if (!canFill[i] && !canEmpty[i]) return null;
    }
    return found;
  }

  // Full line-logic solve. Solvable ⇒ the solution is unique (every step forced).
  function lineSolve(w, h, rowClues, colClues) {
    const g = Array.from({ length: h }, () => new Array(w).fill(-1));
    let changed = true;
    while (changed) {
      changed = false;
      for (let r = 0; r < h; r++) {
        const res = lineDeduce(g[r], rowClues[r]);
        if (res === null) return null;
        for (const [i, v] of res) { g[r][i] = v; changed = true; }
      }
      for (let c = 0; c < w; c++) {
        const line = new Array(h);
        for (let r = 0; r < h; r++) line[r] = g[r][c];
        const res = lineDeduce(line, colClues[c]);
        if (res === null) return null;
        for (const [i, v] of res) { g[i][c] = v; changed = true; }
      }
    }
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (g[r][c] === -1) return null;
    return g;
  }

  function generate(opts) {
    opts = opts || {};
    const n = opts.size || 10;
    const rng = typeof opts.seed === "number" ? mulberry32(opts.seed) : Math.random;

    // Random pixel fields around 50–60% density line-solve often; keep drawing
    // fresh candidates until one passes the solver (each check is ~a millisecond).
    for (let attempt = 0; attempt < 500; attempt++) {
      const density = 0.5 + rng() * 0.12;
      const grid = Array.from({ length: n }, () =>
        Array.from({ length: n }, () => (rng() < density ? 1 : 0))
      );
      let filled = 0;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) filled += grid[r][c];
      if (filled < n * 2 || filled > n * n - n) continue;

      const rowClues = grid.map(cluesOf);
      const colClues = [];
      for (let c = 0; c < n; c++) {
        const col = new Array(n);
        for (let r = 0; r < n; r++) col[r] = grid[r][c];
        colClues.push(cluesOf(col));
      }
      if (lineSolve(n, n, rowClues, colClues)) {
        return { size: n, solution: grid, rowClues: rowClues, colClues: colClues };
      }
    }
    // Practically unreachable: 500 candidates all failing. Recurse unseeded.
    return generate({ size: n });
  }

  function dailySeed(date) {
    const d = date || new Date();
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }

  window.Nonogram = window.Nonogram || {};
  window.Nonogram.generate = generate;
  window.Nonogram.dailySeed = dailySeed;
})();
