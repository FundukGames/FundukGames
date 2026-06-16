/*
 * CrownGrid puzzle engine
 * --------------------------------------------------------------------------
 * A "Queens-style" logic puzzle: place one crown in every row, every column
 * and every colored region, with no two crowns touching (incl. diagonally).
 *
 * This file is framework-free and attaches a single global: window.CrownGrid.
 * Mechanics (rules) are not copyrightable; visuals/branding here are original.
 */
(function () {
  "use strict";

  // --- Seedable PRNG (mulberry32) so the Daily puzzle is identical for all ---
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
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

  // --- Step 1: a valid solution = one crown per row/col, none king-adjacent ---
  // Because each row/col holds exactly one crown, the only way two crowns can
  // touch is between consecutive rows, so |col[r] - col[r-1]| must be >= 2.
  function makeSolution(n, rng) {
    const cols = new Array(n).fill(-1);
    const used = new Array(n).fill(false);

    function bt(r) {
      if (r === n) return true;
      const order = shuffle([...Array(n).keys()], rng);
      for (const c of order) {
        if (used[c]) continue;
        if (r > 0 && Math.abs(c - cols[r - 1]) < 2) continue;
        cols[r] = c;
        used[c] = true;
        if (bt(r + 1)) return true;
        used[c] = false;
        cols[r] = -1;
      }
      return false;
    }
    return bt(0) ? cols : null;
  }

  // --- Step 2: grow N contiguous regions, one per crown seed ---
  function growRegions(n, solCols, rng) {
    const region = Array.from({ length: n }, () => new Array(n).fill(-1));
    for (let r = 0; r < n; r++) region[r][solCols[r]] = r; // region id == seed row
    let remaining = n * n - n;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    while (remaining > 0) {
      const edges = [];
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (region[r][c] !== -1) continue;
          for (const [dr, dc] of dirs) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
            if (region[nr][nc] !== -1) edges.push([r, c, region[nr][nc]]);
          }
        }
      }
      const [r, c, reg] = edges[Math.floor(rng() * edges.length)];
      region[r][c] = reg;
      remaining--;
    }
    return region;
  }

  // --- Solver: count solutions up to `limit` (for uniqueness checking) ---
  function countSolutions(n, region, limit) {
    let count = 0;
    const usedCol = new Array(n).fill(false);
    const usedReg = new Array(n).fill(false);
    const colAt = new Array(n).fill(-1);

    function bt(r) {
      if (count >= limit) return;
      if (r === n) { count++; return; }
      for (let c = 0; c < n; c++) {
        if (usedCol[c]) continue;
        const reg = region[r][c];
        if (usedReg[reg]) continue;
        if (r > 0 && Math.abs(c - colAt[r - 1]) < 2) continue;
        usedCol[c] = true; usedReg[reg] = true; colAt[r] = c;
        bt(r + 1);
        usedCol[c] = false; usedReg[reg] = false;
      }
    }
    bt(0);
    return count;
  }

  // Total region-layout attempts before giving up on uniqueness. Tuned so that
  // sizes 6-8 are effectively always uniquely solvable (measured 60/60), while
  // keeping worst-case generation under ~0.5s. Uniqueness gets exponentially
  // rarer as the board grows, so the budget scales with size.
  function attemptBudget(n) {
    if (n <= 6) return 3000;
    if (n === 7) return 5000;
    return 9000;
  }

  // --- Public: generate a (preferably unique) puzzle ---
  // opts: { size, seed }  -> returns { size, regions, solution }
  function generate(opts) {
    opts = opts || {};
    const n = opts.size || 8;
    const rng = typeof opts.seed === "number" ? mulberry32(opts.seed) : Math.random;
    const budget = attemptBudget(n);

    let attempts = 0;
    let lastSol = null;
    while (attempts < budget) {
      const sol = makeSolution(n, rng);
      if (!sol) { attempts++; continue; }
      lastSol = sol;
      // Try several region layouts per solution before reshuffling the solution.
      for (let g = 0; g < 20 && attempts < budget; g++) {
        attempts++;
        const regions = growRegions(n, sol, rng);
        if (countSolutions(n, regions, 2) === 1) {
          return { size: n, regions: regions, solution: sol };
        }
      }
    }
    // Fallback (rare for n<=8): a guaranteed-solvable board so we never hard-fail.
    const sol = lastSol || makeSolution(n, Math.random);
    return { size: n, regions: growRegions(n, sol, rng), solution: sol };
  }

  // Deterministic seed for a given calendar day (UTC) -> integer YYYYMMDD.
  function dailySeed(date) {
    const d = date || new Date();
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }

  window.CrownGrid = window.CrownGrid || {};
  window.CrownGrid.generate = generate;
  window.CrownGrid.dailySeed = dailySeed;
})();
