/*
 * Akari puzzle engine ("Light Up").
 * --------------------------------------------------------------------------
 * Place bulbs on white cells so every white cell is lit (bulbs beam along rows
 * and columns until a wall), no bulb shines on another bulb, and every
 * numbered wall touches exactly that many bulbs.
 *
 * Generation: symmetric wall layout → find any valid bulb arrangement → derive
 * full number clues → greedily blank clues while the puzzle stays solvable by
 * a logic solver (direct deductions + one-step proof-by-contradiction). A
 * logic-solved board is unique by construction — the no-guess bar all Funduk
 * puzzles meet. Framework-free; attaches window.Akari.
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

  const WALL = -1; // in layout: -1 wall, 0 white. clues: -2 = unnumbered wall.

  function sightLine(n, layout, r, c) {
    // all white cells a bulb at (r,c) would reach (excluding itself)
    const out = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < n && cc >= 0 && cc < n && layout[rr][cc] !== WALL) {
        out.push(rr * n + cc);
        rr += dr; cc += dc;
      }
    }
    return out;
  }

  // Find any valid bulb arrangement via backtracking (no clues involved).
  function findSolution(n, layout, sight, rng) {
    const size = n * n;
    const bulb = new Array(size).fill(false);
    const litBy = new Array(size).fill(0);

    function place(i, on) {
      bulb[i] = on;
      for (const j of sight[i]) litBy[j] += on ? 1 : -1;
    }
    function canPlace(i) {
      if (litBy[i] > 0) return false; // a seen cell can't hold a bulb
      return true;
    }
    function firstUnlit() {
      for (let i = 0; i < size; i++) {
        const r = Math.floor(i / n), c = i % n;
        if (layout[r][c] === WALL) continue;
        if (!bulb[i] && litBy[i] === 0) return i;
      }
      return -1;
    }
    let nodes = 0;
    function bt() {
      if (++nodes > 200000) return false; // give up on pathological layouts
      const cell = firstUnlit();
      if (cell === -1) return true;
      const cands = [cell].concat(sight[cell]).filter(canPlace);
      shuffle(cands, rng);
      for (const cand of cands) {
        place(cand, true);
        if (bt()) return true;
        place(cand, false);
      }
      return false;
    }
    return bt() ? bulb : null;
  }

  /*
   * Logic solver. cellState: 0 unknown / 1 bulb / 2 no-bulb.
   * Returns null on contradiction, else { done, state }.
   */
  function propagate(n, layout, clues, sight, state) {
    const size = n * n;
    let changed = true;
    function setBulb(i) {
      if (state[i] === 2) return false;
      if (state[i] === 1) return true;
      state[i] = 1; changed = true;
      for (const j of sight[i]) if (!setEmpty(j)) return false; // beams: no bulb may see another
      return true;
    }
    function setEmpty(i) {
      if (state[i] === 1) return false;
      if (state[i] === 0) { state[i] = 2; changed = true; }
      return true;
    }
    function isLit(i) {
      if (state[i] === 1) return true;
      for (const j of sight[i]) if (state[j] === 1) return true;
      return false;
    }
    while (changed) {
      changed = false;
      // numbered walls
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (layout[r][c] !== WALL || clues[r][c] < 0) continue;
          const adj = [];
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const rr = r + dr, cc = c + dc;
            if (rr >= 0 && rr < n && cc >= 0 && cc < n && layout[rr][cc] !== WALL) adj.push(rr * n + cc);
          }
          let bulbs = 0, unknowns = [];
          for (const i of adj) { if (state[i] === 1) bulbs++; else if (state[i] === 0) unknowns.push(i); }
          if (bulbs > clues[r][c]) return null;
          if (bulbs + unknowns.length < clues[r][c]) return null;
          if (bulbs === clues[r][c]) { for (const i of unknowns) if (!setEmpty(i)) return null; }
          else if (bulbs + unknowns.length === clues[r][c]) { for (const i of unknowns) if (!setBulb(i)) return null; }
        }
      }
      // every unlit cell must have a possible lighter
      for (let i = 0; i < size; i++) {
        const r = Math.floor(i / n), c = i % n;
        if (layout[r][c] === WALL) continue;
        if (isLit(i)) continue;
        const lighters = [];
        if (state[i] === 0) lighters.push(i);
        for (const j of sight[i]) if (state[j] === 0) lighters.push(j);
        if (lighters.length === 0) return null;
        if (lighters.length === 1) { if (!setBulb(lighters[0])) return null; }
      }
    }
    let done = true;
    for (let i = 0; i < size; i++) {
      const r = Math.floor(i / n), c = i % n;
      if (layout[r][c] === WALL) continue;
      if (state[i] !== 1 && !isLit(i)) { done = false; break; }
    }
    return { done: done, state: state };
  }

  function logicSolve(n, layout, clues, sight) {
    const size = n * n;
    let state = new Array(size).fill(0);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (layout[r][c] === WALL) state[r * n + c] = 2;
    let res = propagate(n, layout, clues, sight, state);
    if (!res) return { solved: false };
    state = res.state;

    let progress = true;
    while (progress && !res.done) {
      progress = false;
      for (let i = 0; i < size && !progress; i++) {
        if (state[i] !== 0) continue;
        // try bulb → contradiction ⇒ no-bulb; try no-bulb → contradiction ⇒ bulb
        const sB = state.slice(); sB[i] = 1;
        for (const j of sight[i]) { if (sB[j] === 1) { sB[i] = 9; break; } }
        let rB = null;
        if (sB[i] === 1) {
          for (const j of sight[i]) sB[j] = 2;
          rB = propagate(n, layout, clues, sight, sB);
        }
        const sE = state.slice(); sE[i] = 2;
        const rE = propagate(n, layout, clues, sight, sE);
        if (!rB && !rE) return { solved: false };
        if (!rB) { state[i] = 2; progress = true; }
        else if (!rE) { state = rB.state; progress = true; }
        if (progress) {
          res = propagate(n, layout, clues, sight, state);
          if (!res) return { solved: false };
          state = res.state;
        }
      }
    }
    return { solved: res.done, state: state };
  }

  function makeLayout(n, rng) {
    const layout = Array.from({ length: n }, () => new Array(n).fill(0));
    const target = Math.floor(n * n * (0.16 + rng() * 0.05) / 2);
    for (let k = 0; k < target; k++) {
      const r = Math.floor(rng() * n), c = Math.floor(rng() * n);
      layout[r][c] = WALL;
      layout[n - 1 - r][n - 1 - c] = WALL; // 180° rotational symmetry
    }
    return layout;
  }

  function generate(opts) {
    opts = opts || {};
    const n = opts.size || 10;
    const rng = typeof opts.seed === "number" ? mulberry32(opts.seed) : Math.random;

    for (let attempt = 0; attempt < 200; attempt++) {
      const layout = makeLayout(n, rng);
      const sight = [];
      for (let i = 0; i < n * n; i++) {
        const r = Math.floor(i / n), c = i % n;
        sight.push(layout[r][c] === WALL ? [] : sightLine(n, layout, r, c));
      }
      const bulbs = findSolution(n, layout, sight, rng);
      if (!bulbs) continue;

      // full clues from the solution
      const clues = Array.from({ length: n }, () => new Array(n).fill(-2));
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (layout[r][c] !== WALL) { clues[r][c] = -3; continue; } // white marker
          let cnt = 0;
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const rr = r + dr, cc = c + dc;
            if (rr >= 0 && rr < n && cc >= 0 && cc < n && layout[rr][cc] !== WALL && bulbs[rr * n + cc]) cnt++;
          }
          clues[r][c] = cnt;
        }
      }
      if (!logicSolve(n, layout, clues, sight).solved) continue;

      // blank clues while still logic-solvable
      const walls = [];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (layout[r][c] === WALL) walls.push([r, c]);
      for (const [r, c] of shuffle(walls, rng)) {
        const prev = clues[r][c];
        clues[r][c] = -2;
        if (!logicSolve(n, layout, clues, sight).solved) clues[r][c] = prev;
      }

      const solution = [];
      for (let i = 0; i < n * n; i++) if (bulbs[i]) solution.push(i);
      return { size: n, layout: layout, clues: clues, solution: solution };
    }
    return generate({ size: n }); // practically unreachable
  }

  function dailySeed(date) {
    const d = date || new Date();
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }

  window.Akari = window.Akari || {};
  window.Akari.generate = generate;
  window.Akari.dailySeed = dailySeed;
})();
