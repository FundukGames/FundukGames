/*
 * Pipes puzzle engine ("Net"-style rotation puzzle).
 * --------------------------------------------------------------------------
 * Every cell holds a pipe piece; rotate pieces so the whole network joins into
 * one leak-free system fed from the source in the middle. The solution is a
 * random spanning tree of the grid, so a solved board connects every cell with
 * no loops and no open ends.
 *
 * Uniqueness: a backtracking counter enumerates every rotation assignment that
 * produces a leak-free connected network; boards with more than one such
 * configuration are rejected. So the solved state you reach is THE solution —
 * no ambiguous straights or swappable elbows. Framework-free; window.Pipes.
 *
 * Directions are bitmasks: N=1 E=2 S=4 W=8. rot(conn, k) rotates 90°·k CW.
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

  const N = 1, E = 2, S = 4, W = 8;
  const DIRS = [
    { bit: N, dr: -1, dc: 0, opp: S },
    { bit: E, dr: 0, dc: 1, opp: W },
    { bit: S, dr: 1, dc: 0, opp: N },
    { bit: W, dr: 0, dc: -1, opp: E }
  ];
  function rot(conn, k) {
    k = ((k % 4) + 4) % 4;
    for (let i = 0; i < k; i++) conn = ((conn << 1) | (conn >> 3)) & 15;
    return conn;
  }

  // Random spanning tree via randomized DFS; returns per-cell connection masks.
  function makeTree(n, rng) {
    const conn = new Array(n * n).fill(0);
    const seen = new Array(n * n).fill(false);
    const start = Math.floor(rng() * n * n);
    const stack = [start];
    seen[start] = true;
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const r = Math.floor(cur / n), c = cur % n;
      const options = shuffle(DIRS.slice(), rng).filter((d) => {
        const rr = r + d.dr, cc = c + d.dc;
        return rr >= 0 && rr < n && cc >= 0 && cc < n && !seen[rr * n + cc];
      });
      if (!options.length) { stack.pop(); continue; }
      const d = options[0];
      const nxt = (r + d.dr) * n + (c + d.dc);
      conn[cur] |= d.bit;
      conn[nxt] |= d.opp;
      seen[nxt] = true;
      stack.push(nxt);
    }
    return conn;
  }

  // Count leak-free connected rotation assignments (stop at `limit`).
  function countSolutions(n, base, limit) {
    // distinct orientations per cell (I-pieces have 2, crosses 1, others 4)
    const variants = base.map((b) => {
      const set = [];
      for (let k = 0; k < 4; k++) {
        const v = rot(b, k);
        if (!set.includes(v)) set.push(v);
      }
      return set;
    });
    const chosen = new Array(n * n).fill(0);
    let found = 0;

    function connectedAll() {
      const seen = new Array(n * n).fill(false);
      const stack = [0];
      seen[0] = true;
      let cnt = 1;
      while (stack.length) {
        const cur = stack.pop();
        const r = Math.floor(cur / n), c = cur % n;
        for (const d of DIRS) {
          const rr = r + d.dr, cc = c + d.dc;
          if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
          const nxt = rr * n + cc;
          if (seen[nxt]) continue;
          if ((chosen[cur] & d.bit) && (chosen[nxt] & d.opp)) { seen[nxt] = true; cnt++; stack.push(nxt); }
        }
      }
      return cnt === n * n;
    }

    function bt(idx) {
      if (found >= limit) return;
      if (idx === n * n) { if (connectedAll()) found++; return; }
      const r = Math.floor(idx / n), c = idx % n;
      for (const v of variants[idx]) {
        // west side must match east side of the placed left neighbor (or wall)
        const westOk = c === 0 ? !(v & W) : ((chosen[idx - 1] & E) ? (v & W) : !(v & W));
        if (!westOk) continue;
        const northOk = r === 0 ? !(v & N) : ((chosen[idx - n] & S) ? (v & N) : !(v & N));
        if (!northOk) continue;
        if (c === n - 1 && (v & E)) continue; // no leaks into the right wall
        if (r === n - 1 && (v & S)) continue; // ... or the bottom wall
        chosen[idx] = v;
        bt(idx + 1);
        if (found >= limit) return;
      }
      chosen[idx] = 0;
    }
    bt(0);
    return found;
  }

  function generate(opts) {
    opts = opts || {};
    const n = opts.size || 7;
    const rng = typeof opts.seed === "number" ? mulberry32(opts.seed) : Math.random;

    for (let attempt = 0; attempt < 300; attempt++) {
      const base = makeTree(n, rng);
      if (countSolutions(n, base, 2) !== 1) continue;

      // scramble: random rotation per piece, ensuring a real mess
      let rots, misplaced;
      do {
        rots = base.map(() => Math.floor(rng() * 4));
        misplaced = 0;
        for (let i = 0; i < base.length; i++) if (rot(base[i], rots[i]) !== base[i]) misplaced++;
      } while (misplaced < Math.max(3, Math.floor(n * n * 0.5)));

      return { size: n, base: base, rots: rots, source: Math.floor(n * n / 2) };
    }
    return generate({ size: n }); // practically unreachable
  }

  function dailySeed(date) {
    const d = date || new Date();
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }

  window.Pipes = window.Pipes || {};
  window.Pipes.generate = generate;
  window.Pipes.rot = rot;
  window.Pipes.dailySeed = dailySeed;
})();
