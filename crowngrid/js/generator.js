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
  // Two-phase: phase 1 grows every region up to `minSize` (round-robin) so
  // there are no trivial 1- or 2-cell regions; phase 2 fills the rest with
  // random frontier growth to keep irregular, deduction-worthy shapes.
  function growRegions(n, solCols, rng, minSize) {
    const region = Array.from({ length: n }, () => new Array(n).fill(-1));
    const size = new Array(n).fill(1);
    for (let r = 0; r < n; r++) region[r][solCols[r]] = r; // region id == seed row
    let remaining = n * n - n;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    function freeNeighborsOf(reg) {
      const out = [];
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) {
          if (region[r][c] !== reg) continue;
          for (const [dr, dc] of dirs) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
            if (region[nr][nc] === -1) out.push([nr, nc]);
          }
        }
      return out;
    }

    if (minSize > 1) {
      let progress = true;
      while (progress && remaining > 0) {
        progress = false;
        for (const reg of shuffle([...Array(n).keys()], rng)) {
          if (size[reg] >= minSize) continue;
          const fr = freeNeighborsOf(reg);
          if (fr.length) {
            const [r, c] = fr[Math.floor(rng() * fr.length)];
            region[r][c] = reg; size[reg]++; remaining--; progress = true;
            if (remaining === 0) break;
          }
        }
      }
    }

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
      region[r][c] = reg; size[reg]++; remaining--;
    }
    return region;
  }

  function minRegionSize(n, region) {
    const cnt = new Array(n).fill(0);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cnt[region[r][c]]++;
    return Math.min.apply(null, cnt);
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

    // We PREFER no 1-cell regions (a lone region forces its crown for free and
    // makes the board trivial), but uniqueness is mandatory and balancing region
    // sizes wrecks uniqueness on 7×7/8×8. So: grow irregular "blob" regions
    // (good uniqueness), require uniqueness, and among unique boards keep the one
    // with the largest minimum region — returning early once no region is size 1.
    const minSize = 2;

    let attempts = 0;
    let lastSol = null;
    let best = null;        // best UNIQUE board found (largest min region)
    let firstBestAt = -1;   // attempt index when we first had a usable unique board
    const POST_BEST_CAP = 4000; // stop chasing a min-size upgrade after this many extra tries
    while (attempts < budget) {
      const sol = makeSolution(n, rng);
      if (!sol) { attempts++; continue; }
      lastSol = sol;
      for (let g = 0; g < 20 && attempts < budget; g++) {
        attempts++;
        const regions = growRegions(n, sol, rng, 1);
        if (countSolutions(n, regions, 2) !== 1) continue; // uniqueness mandatory
        const m = minRegionSize(n, regions);
        if (m >= minSize) return { size: n, regions: regions, solution: sol };
        if (!best || m > best.m) best = { size: n, regions: regions, solution: sol, m: m };
        if (firstBestAt < 0) firstBestAt = attempts;
      }
      if (firstBestAt >= 0 && attempts - firstBestAt > POST_BEST_CAP) break; // ship best
    }
    if (best) return { size: best.size, regions: best.regions, solution: best.solution };
    // Last resort (essentially never): a guaranteed-solvable board.
    const sol = lastSol || makeSolution(n, Math.random) || makeSolution(n, rng);
    return { size: n, regions: growRegions(n, sol, rng, 1), solution: sol };
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
