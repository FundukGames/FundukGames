/*
 * Hashi puzzle engine ("Bridges" / Hashiwokakero).
 * --------------------------------------------------------------------------
 * Connect the numbered islands with horizontal/vertical bridges: at most two
 * per pair, no crossings, every island's count satisfied, everything joined
 * into one network.
 *
 * Generation is constructive: grow a connected web of islands and bridges on
 * the grid (occasionally adding a cycle), then read the numbers off it. A
 * board is only served if a counting-logic solver can rebuild the whole thing
 * from forced moves alone — every step of the kind "this island's remaining
 * bridges exceed what its other neighbors can take, so this link is forced".
 * Forced-only completion means the solution is unique and no guessing is ever
 * needed. Framework-free; attaches window.Hashi.
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

  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // Build a connected bridge web on an n×n grid. Returns { islands, edges }.
  // islands: [{r,c}], edges: [{a,b,count}] with a/b island indices.
  function construct(n, targetIslands, rng) {
    const cell = Array.from({ length: n }, () => new Array(n).fill(-1)); // island idx
    const blocked = Array.from({ length: n }, () => new Array(n).fill(false)); // bridge body
    const islands = [];
    const edges = [];

    function addIsland(r, c) {
      islands.push({ r: r, c: c });
      cell[r][c] = islands.length - 1;
      return islands.length - 1;
    }
    addIsland(2 + Math.floor(rng() * (n - 4)), 2 + Math.floor(rng() * (n - 4)));

    let guard = 0;
    while (islands.length < targetIslands && guard++ < targetIslands * 60) {
      const from = islands[Math.floor(rng() * islands.length)];
      const [dr, dc] = DIRS[Math.floor(rng() * 4)];
      // collect stops: walk outward, cells must be free of islands and bridges
      const stops = [];
      let r = from.r + dr, c = from.c + dc;
      while (r >= 0 && r < n && c >= 0 && c < n && cell[r][c] === -1 && !blocked[r][c]) {
        stops.push([r, c]);
        r += dr; c += dc;
      }
      if (stops.length < 2) continue; // need at least distance 2 for a visible span
      const pick = stops[1 + Math.floor(rng() * (stops.length - 1))];
      const to = addIsland(pick[0], pick[1]);
      const a = cell[from.r][from.c];
      for (let rr = Math.min(from.r, pick[0]), cc = Math.min(from.c, pick[1]); ;) {
        if (dr !== 0) { rr++; if (rr >= Math.max(from.r, pick[0])) break; blocked[rr][from.c] = true; }
        else { cc++; if (cc >= Math.max(from.c, pick[1])) break; blocked[from.r][cc] = true; }
      }
      edges.push({ a: a, b: to, count: 1 + (rng() < 0.45 ? 1 : 0) });
    }

    // a few cycle edges between already-placed aligned islands with a clear path
    const extraTries = Math.floor(islands.length * 0.6);
    for (let t = 0; t < extraTries; t++) {
      const i = Math.floor(rng() * islands.length);
      const A = islands[i];
      const [dr, dc] = DIRS[Math.floor(rng() * 4)];
      let r = A.r + dr, c = A.c + dc, ok = true, hit = -1;
      const path = [];
      while (r >= 0 && r < n && c >= 0 && c < n) {
        if (cell[r][c] !== -1) { hit = cell[r][c]; break; }
        if (blocked[r][c]) { ok = false; break; }
        path.push([r, c]);
        r += dr; c += dc;
      }
      if (!ok || hit < 0 || path.length < 1) continue;
      const j = hit;
      if (edges.some((e) => (e.a === i && e.b === j) || (e.a === j && e.b === i))) continue;
      for (const [rr, cc] of path) blocked[rr][cc] = true;
      edges.push({ a: i, b: j, count: 1 + (rng() < 0.45 ? 1 : 0) });
    }

    return { islands: islands, edges: edges };
  }

  /*
   * Counting-logic solver. Rebuilds bridges from numbers via forced moves only.
   * Returns true if it fully reconstructs a valid connected network.
   */
  function logicSolve(n, islands, numbers) {
    const k = islands.length;
    const cell = Array.from({ length: n }, () => new Array(n).fill(-1));
    islands.forEach((p, i) => { cell[p.r][p.c] = i; });
    // bridgesOn[r][c] = 'h' | 'v' when a bridge body crosses that cell
    const body = Array.from({ length: n }, () => new Array(n).fill(null));
    const placed = {}; // "a-b" -> count (a<b)
    const remaining = numbers.slice();

    function key(a, b) { return a < b ? a + "-" + b : b + "-" + a; }
    function getPlaced(a, b) { return placed[key(a, b)] || 0; }

    function visibleNeighbors(i) {
      const out = [];
      const p = islands[i];
      for (const [dr, dc] of DIRS) {
        let r = p.r + dr, c = p.c + dc;
        while (r >= 0 && r < n && c >= 0 && c < n) {
          if (cell[r][c] !== -1) { out.push(cell[r][c]); break; }
          const bb = body[r][c];
          if (bb) {
            // A bridge body along our walking direction can only be the i↔j
            // bridge itself (any other same-row/col bridge would need an island
            // between us). Perpendicular bodies are crossings — sight blocked.
            const along = dc !== 0 ? "h" : "v";
            if (bb !== along) break;
          }
          r += dr; c += dc;
        }
      }
      return out;
    }

    function addBridges(a, b, count) {
      const cur = getPlaced(a, b);
      placed[key(a, b)] = cur + count;
      remaining[a] -= count; remaining[b] -= count;
      if (remaining[a] < 0 || remaining[b] < 0) return false;
      if (cur === 0) {
        const A = islands[a], B = islands[b];
        if (A.r === B.r) {
          for (let c = Math.min(A.c, B.c) + 1; c < Math.max(A.c, B.c); c++) body[A.r][c] = "h";
        } else {
          for (let r = Math.min(A.r, B.r) + 1; r < Math.max(A.r, B.r); r++) body[r][A.c] = "v";
        }
      }
      return true;
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < k; i++) {
        if (remaining[i] <= 0) continue;
        const nbs = visibleNeighbors(i).filter((j) => j !== i);
        const caps = nbs.map((j) => Math.min(2 - getPlaced(i, j), remaining[j], remaining[i]));
        const total = caps.reduce((s, x) => s + x, 0);
        if (total < remaining[i]) return false; // contradiction
        for (let t = 0; t < nbs.length; t++) {
          const need = remaining[i] - (total - caps[t]);
          if (need > 0) {
            if (!addBridges(i, nbs[t], need)) return false;
            changed = true;
          }
        }
        if (changed) break; // recompute visibility fresh
      }
    }
    if (remaining.some((x) => x !== 0)) return false;
    // connectivity
    const adj = Array.from({ length: k }, () => []);
    Object.keys(placed).forEach((kk) => {
      if (!placed[kk]) return;
      const [a, b] = kk.split("-").map(Number);
      adj[a].push(b); adj[b].push(a);
    });
    const seen = new Array(k).fill(false);
    const stack = [0]; seen[0] = true; let cnt = 1;
    while (stack.length) {
      const cur = stack.pop();
      for (const j of adj[cur]) if (!seen[j]) { seen[j] = true; cnt++; stack.push(j); }
    }
    return cnt === k;
  }

  function generate(opts) {
    opts = opts || {};
    const n = opts.size || 11;
    const targetIslands = opts.islands || Math.round(n * n * 0.14);
    const rng = typeof opts.seed === "number" ? mulberry32(opts.seed) : Math.random;

    for (let attempt = 0; attempt < 400; attempt++) {
      const web = construct(n, targetIslands, rng);
      if (web.islands.length < targetIslands * 0.75) continue;
      const numbers = new Array(web.islands.length).fill(0);
      for (const e of web.edges) { numbers[e.a] += e.count; numbers[e.b] += e.count; }
      if (!logicSolve(n, web.islands, numbers)) continue;
      return { size: n, islands: web.islands.map((p, i) => ({ r: p.r, c: p.c, num: numbers[i] })), solution: web.edges };
    }
    return generate({ size: n, islands: targetIslands }); // practically unreachable
  }

  function dailySeed(date) {
    const d = date || new Date();
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }

  window.Hashi = window.Hashi || {};
  window.Hashi.generate = generate;
  window.Hashi.dailySeed = dailySeed;
})();
