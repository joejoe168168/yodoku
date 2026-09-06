/* Yodoku puzzle engine
 * Rules: place one dino in every row, column and colour region; dinos may not touch, even diagonally.
 * This file is dependency-free and works in the browser (window.Yodoku) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Yodoku = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- deterministic RNG (mulberry32) ----------
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function shuffle(arr, r) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }

  // ---------- solution: one dino per row/col, no touching ----------
  function randomSolution(n, r) {
    const cols = new Array(n).fill(-1), used = new Array(n).fill(false);
    function bt(row) {
      if (row === n) return true;
      const order = shuffle(Array.from({ length: n }, (_, i) => i), r);
      for (const c of order) {
        if (used[c]) continue;
        if (row > 0 && Math.abs(c - cols[row - 1]) <= 1) continue;
        cols[row] = c; used[c] = true;
        if (bt(row + 1)) return true;
        used[c] = false;
      }
      cols[row] = -1; return false;
    }
    bt(0);
    return cols;
  }

  // ---------- regions: grow one region out of each solution cell ----------
  function growRegions(n, sol, r) {
    const N = n * n, region = new Int8Array(N).fill(-1);
    const weight = new Array(n);
    for (let i = 0; i < n; i++) { region[i * n + sol[i]] = i; weight[i] = 0.25 + Math.pow(r(), 1.3) * 1.9; }
    let assigned = n;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (assigned < N) {
      // candidate (cell, region) pairs, weighted by region weight
      const cands = []; let total = 0;
      for (let idx = 0; idx < N; idx++) {
        if (region[idx] !== -1) continue;
        const y = (idx / n) | 0, x = idx % n;
        for (const [dx, dy] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const g = region[ny * n + nx];
          if (g === -1) continue;
          cands.push([idx, g, weight[g]]); total += weight[g];
        }
      }
      let pick = r() * total, chosen = cands[cands.length - 1];
      for (const c of cands) { pick -= c[2]; if (pick <= 0) { chosen = c; break; } }
      region[chosen[0]] = chosen[1]; assigned++;
      // occasionally cool a region so sizes stay varied
      if (r() < 0.08) weight[chosen[1]] *= 0.55;
    }
    return region;
  }

  // ---------- brute force solution counter (stops at `limit`) ----------
  function countSolutions(n, region, limit) {
    limit = limit || 2;
    const usedCol = new Array(n).fill(false), usedReg = new Array(n).fill(false);
    let count = 0, prev = -5;
    function bt(row, prevCol) {
      if (row === n) { count++; return count >= limit; }
      const base = row * n;
      for (let c = 0; c < n; c++) {
        if (usedCol[c] || Math.abs(c - prevCol) <= 1) continue;
        const g = region[base + c];
        if (usedReg[g]) continue;
        usedCol[c] = true; usedReg[g] = true;
        const stop = bt(row + 1, c);
        usedCol[c] = false; usedReg[g] = false;
        if (stop) return true;
      }
      return false;
    }
    bt(0, prev);
    return count;
  }

  // collect up to `limit` full solutions (as arrays of column per row)
  function findSolutions(n, region, limit) {
    const usedCol = new Array(n).fill(false), usedReg = new Array(n).fill(false), cols = new Array(n), out = [];
    function bt(row, prevCol) {
      if (row === n) { out.push(cols.slice()); return out.length >= limit; }
      const base = row * n;
      for (let c = 0; c < n; c++) {
        if (usedCol[c] || Math.abs(c - prevCol) <= 1) continue;
        const g = region[base + c];
        if (usedReg[g]) continue;
        usedCol[c] = true; usedReg[g] = true; cols[row] = c;
        const stop = bt(row + 1, c);
        usedCol[c] = false; usedReg[g] = false;
        if (stop) return true;
      }
      return false;
    }
    bt(0, -5);
    return out;
  }
  function regionConnected(n, region, g, seedIdx) {
    const N = n * n; let size = 0; for (let i = 0; i < N; i++) if (region[i] === g) size++;
    const seen = new Uint8Array(N), stack = [seedIdx]; seen[seedIdx] = 1; let reached = 0;
    while (stack.length) {
      const i = stack.pop(); reached++;
      const y = (i / n) | 0, x = i % n;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx; if (!seen[j] && region[j] === g) { seen[j] = 1; stack.push(j); }
      }
    }
    return reached === size;
  }
  // Try to make a multi-solution board unique by moving boundary cells that an alternate solution relies on.
  function repair(n, region, sol, r, maxIter) {
    const seedOf = sol.map((c, row) => row * n + c);
    for (let it = 0; it < (maxIter || 14); it++) {
      const sols = findSolutions(n, region, 2);
      if (sols.length < 2) return sols.length === 1;
      const alt = sols.find(s => s.some((c, row) => c !== sol[row])) || sols[1];
      const rows = shuffle(alt.map((c, row) => row).filter(row => alt[row] !== sol[row]), r);
      let moved = false;
      for (const row of rows) {
        const c = row * n + alt[row], g = region[c];
        if (seedOf[g] === c) continue;
        const y = row, x = alt[row], opts = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const h = region[ny * n + nx]; if (h !== g && !opts.includes(h)) opts.push(h);
        }
        shuffle(opts, r);
        for (const h of opts) {
          region[c] = h;
          if (regionConnected(n, region, g, seedOf[g])) { moved = true; break; }
          region[c] = g;
        }
        if (moved) break;
      }
      if (!moved) return false;
    }
    return countSolutions(n, region, 2) === 1;
  }

  // ---------- human-style logic solver (for difficulty rating and hints) ----------
  // state: cand (Uint8Array, 1 = still possible), placed (Uint8Array, 1 = dino)
  function makeState(n, region, cells) {
    const N = n * n, cand = new Uint8Array(N).fill(1), placed = new Uint8Array(N);
    const st = { n, region, cand, placed };
    if (cells) {
      for (let i = 0; i < N; i++) if (cells[i] === 1) cand[i] = 0;          // player X
      for (let i = 0; i < N; i++) if (cells[i] === 2) placeAt(st, i);       // player dino
    }
    return st;
  }
  function placeAt(st, idx) {
    const { n, region, cand, placed } = st;
    const y = (idx / n) | 0, x = idx % n, g = region[idx];
    placed[idx] = 1;
    for (let i = 0; i < n; i++) { cand[y * n + i] = 0; cand[i * n + x] = 0; }
    for (let i = 0; i < n * n; i++) if (region[i] === g) cand[i] = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < n && ny < n) cand[ny * n + nx] = 0;
    }
  }
  function groupCells(st) {
    const { n, region } = st, N = n * n;
    const rows = [], cols = [], regs = [];
    for (let i = 0; i < n; i++) { rows.push([]); cols.push([]); regs.push([]); }
    for (let i = 0; i < N; i++) { rows[(i / n) | 0].push(i); cols[i % n].push(i); regs[region[i]].push(i); }
    return { rows, cols, regs };
  }
  function groupHasDino(st, cells) { for (const c of cells) if (st.placed[c]) return true; return false; }
  function liveCands(st, cells) { const out = []; for (const c of cells) if (st.cand[c]) out.push(c); return out; }

  // Returns the next deduction step or null. Each step: {type, place?:idx, eliminate?:[idx], group?, msg}
  function nextStep(st, groups) {
    const { n, region, cand, placed } = st;
    const N = n * n;
    const kinds = [['region', groups.regs], ['row', groups.rows], ['column', groups.cols]];

    // T1: a group with exactly one live candidate
    for (const [name, list] of kinds) {
      for (let k = 0; k < n; k++) {
        const cells = list[k];
        if (groupHasDino(st, cells)) continue;
        const live = liveCands(st, cells);
        if (live.length === 0) return { type: 'contradiction' };
        if (live.length === 1) return { type: 'single', place: live[0], group: { kind: name, index: k, cells }, msg: `Only one spot left in this ${name}.` };
      }
    }
    // T3: a region confined to one row/column -> other cells of that line go
    for (let g = 0; g < n; g++) {
      const cells = groups.regs[g];
      if (groupHasDino(st, cells)) continue;
      const live = liveCands(st, cells);
      const rows = new Set(live.map(i => (i / n) | 0)), cols = new Set(live.map(i => i % n));
      if (rows.size === 1) {
        const row = [...rows][0], elim = groups.rows[row].filter(i => cand[i] && region[i] !== g);
        if (elim.length) return { type: 'confined', eliminate: elim, group: { kind: 'region', index: g, cells: live }, msg: 'This region fits in a single row, so the rest of that row is off-limits.' };
      }
      if (cols.size === 1) {
        const col = [...cols][0], elim = groups.cols[col].filter(i => cand[i] && region[i] !== g);
        if (elim.length) return { type: 'confined', eliminate: elim, group: { kind: 'region', index: g, cells: live }, msg: 'This region fits in a single column, so the rest of that column is off-limits.' };
      }
    }
    // T4: k regions together span only k rows (or cols), k = 2..3 -> those lines belong to them
    for (const [lineName, lineOf, lines] of [['rows', i => (i / n) | 0, groups.rows], ['columns', i => i % n, groups.cols]]) {
      const open = []; // regions without a dino
      for (let g = 0; g < n; g++) if (!groupHasDino(st, groups.regs[g])) open.push(g);
      const span = {}; for (const g of open) span[g] = new Set(liveCands(st, groups.regs[g]).map(lineOf));
      for (let k = 2; k <= 3; k++) {
        const combo = [];
        const rec = (start) => {
          if (combo.length === k) {
            const union = new Set(); for (const g of combo) for (const l of span[g]) union.add(l);
            if (union.size === k) {
              const set = new Set(combo), elim = [];
              for (const l of union) for (const i of lines[l]) if (cand[i] && !set.has(region[i])) elim.push(i);
              if (elim.length) return { type: 'set', eliminate: elim, group: { kind: 'regions', index: combo.slice(), cells: combo.flatMap(g => liveCands(st, groups.regs[g])) }, msg: `${k} regions share just ${k} ${lineName}, so nothing else can sit on those ${lineName}.` };
            }
            return null;
          }
          for (let i = start; i < open.length; i++) { combo.push(open[i]); const res = rec(i + 1); combo.pop(); if (res) return res; }
          return null;
        };
        const res = rec(0); if (res) return res;
      }
    }
    // T5: single-cell lookahead. Placing here would starve some group -> eliminate.
    for (let idx = 0; idx < N; idx++) {
      if (!cand[idx]) continue;
      const trial = { n, region, cand: cand.slice(), placed: placed.slice() };
      placeAt(trial, idx);
      for (const [name, list] of kinds) {
        for (let k = 0; k < n; k++) {
          const cells = list[k];
          if (groupHasDino(trial, cells)) continue;
          if (liveCands(trial, cells).length === 0) {
            return { type: 'lookahead', eliminate: [idx], group: { kind: name, index: k, cells: liveCands(st, cells) }, msg: `A dino here would leave this ${name} with nowhere to go.` };
          }
        }
      }
    }
    return null;
  }

  function applyStep(st, step) {
    if (step.place !== undefined) placeAt(st, step.place);
    if (step.eliminate) for (const i of step.eliminate) st.cand[i] = 0;
  }

  function logicSolve(n, region, cells) {
    const st = makeState(n, region, cells), groups = groupCells(st);
    const stats = { single: 0, confined: 0, set: 0, lookahead: 0, steps: 0 };
    if (cells && conflicts(n, region, cells).bad.size) return { solved: false, stats, st };
    let placedCount = 0; for (let i = 0; i < n * n; i++) placedCount += st.placed[i];
    while (placedCount < n) {
      const step = nextStep(st, groups);
      if (!step || step.type === 'contradiction') return { solved: false, stats, st };
      stats[step.type]++; stats.steps++;
      applyStep(st, step);
      if (step.place !== undefined) placedCount++;
    }
    return { solved: isSolved(n, region, Array.from(st.placed, v => v ? 2 : 0)), stats, st };
  }

  // difficulty score: higher = harder
  function rate(n, region) {
    const res = logicSolve(n, region, null);
    const s = res.stats;
    if (!res.solved) return 100 + n;
    return s.confined * 1.5 + s.set * 4 + s.lookahead * 6 + n * 0.5;
  }

  const DIFFS = {
    easy:   { n: 6, min: 0,  max: 7,  label: 'Easy' },
    normal: { n: 7, min: 4,  max: 16, label: 'Normal' },
    hard:   { n: 8, min: 12, max: 40, label: 'Hard' },
    ultra:  { n: 9, min: 22, max: 95, label: 'Ultra' }
  };

  function generate(opts) {
    const diff = DIFFS[opts.difficulty] || DIFFS.normal;
    const n = opts.size || diff.n;
    if (!Number.isInteger(n) || n < 4 || n > 9) throw new RangeError('Puzzle size must be between 4 and 9');
    const r = rng(opts.seed >>> 0);
    // A fixed candidate budget keeps Daily and seed-based restores identical on
    // fast desktops and slow phones. Elapsed wall time must not pick the board.
    const maxCands = opts.candidates || 40;
    let best = null, bestDist = Infinity, cands = 0, tries = 0;
    while (tries < 5000) {
      tries++;
      const sol = randomSolution(n, r);
      const region = growRegions(n, sol, r);
      let unique = countSolutions(n, region, 2) === 1;
      if (!unique) unique = repair(n, region, sol, r);
      if (unique && validatePuzzle({ n, region: Array.from(region), sol })) {
        cands++;
        const logic = logicSolve(n, region);
        if (!logic.solved) continue;
        const s = logic.stats;
        const score = s.confined * 1.5 + s.set * 4 + s.lookahead * 6 + n * 0.5;
        const dist = score < diff.min ? diff.min - score : score > diff.max ? score - diff.max : 0;
        if (dist < bestDist) { bestDist = dist; best = { n, region: Array.from(region), sol, score }; }
        if (dist === 0) break;
      }
      if (best && cands >= maxCands) break;
    }
    if (!best) throw new Error('Unable to generate a valid puzzle');
    best.seed = opts.seed >>> 0; best.difficulty = opts.difficulty; best.tries = tries;
    return best;
  }

  // Check generated and restored boards before they reach the player.
  // Every colour must exist, be connected, and contain one solution dino.
  function validatePuzzle(puzzle) {
    if (!puzzle) return false;
    const { n, region, sol } = puzzle;
    if (!Number.isInteger(n) || n < 4 || n > 9 || !Array.isArray(region) || region.length !== n * n || !Array.isArray(sol) || sol.length !== n) return false;
    if (region.some(g => !Number.isInteger(g) || g < 0 || g >= n) || new Set(region).size !== n) return false;
    if (sol.some(c => !Number.isInteger(c) || c < 0 || c >= n) || new Set(sol).size !== n) return false;
    const homes = sol.map((c, row) => row * n + c);
    if (new Set(homes.map(i => region[i])).size !== n) return false;
    for (let row = 1; row < n; row++) if (Math.abs(sol[row] - sol[row - 1]) <= 1) return false;
    return homes.every(i => regionConnected(n, region, region[i], i));
  }

  // ---------- gameplay helpers ----------
  function conflicts(n, region, cells) {
    const bad = new Set(), dinos = [];
    for (let i = 0; i < n * n; i++) if (cells[i] === 2) dinos.push(i);
    for (let a = 0; a < dinos.length; a++) for (let b = a + 1; b < dinos.length; b++) {
      const i = dinos[a], j = dinos[b];
      const yi = (i / n) | 0, xi = i % n, yj = (j / n) | 0, xj = j % n;
      if (yi === yj || xi === xj || region[i] === region[j] || (Math.abs(yi - yj) <= 1 && Math.abs(xi - xj) <= 1)) { bad.add(i); bad.add(j); }
    }
    return { bad, count: dinos.length };
  }
  function isSolved(n, region, cells) {
    const c = conflicts(n, region, cells);
    return c.count === n && c.bad.size === 0;
  }
  // Visible conflicts only; this never consults the solution.
  function conflictDetails(n, region, cells) {
    const dinos = cells.flatMap((v, i) => v === 2 ? [i] : []), issues = [];
    for (const kind of ['row', 'column', 'region']) for (let k = 0; k < n; k++) {
      const group = Array.from({ length: n * n }, (_, i) => i).filter(i =>
        (kind === 'row' ? Math.floor(i / n) : kind === 'column' ? i % n : region[i]) === k);
      const pair = dinos.filter(i => group.includes(i));
      if (pair.length > 1) issues.push({ kind, dinos: pair, area: group, message: `These dinos share ${kind} ${k + 1}. Give each one a separate ${kind}.` });
    }
    for (let a = 0; a < dinos.length; a++) for (let b = a + 1; b < dinos.length; b++) {
      const i = dinos[a], j = dinos[b];
      if (Math.abs(Math.floor(i / n) - Math.floor(j / n)) === 1 && Math.abs(i % n - j % n) === 1)
        issues.push({ kind: 'diagonal', dinos: [i, j], area: [i, j], message: 'These dinos touch diagonally. Leave a little space between them.' });
    }
    return issues;
  }
  // cells covered by a dino at idx (row, col, region, neighbours)
  function coverage(n, region, idx) {
    const out = new Set(), y = (idx / n) | 0, x = idx % n, g = region[idx];
    for (let i = 0; i < n; i++) { out.add(y * n + i); out.add(i * n + x); }
    for (let i = 0; i < n * n; i++) if (region[i] === g) out.add(i);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < n && ny < n) out.add(ny * n + nx);
    }
    out.delete(idx);
    return out;
  }

  // Hint: what should the player look at next?
  function hint(puzzle, cells) {
    const { n, region, sol } = puzzle;
    const solIdx = new Set(sol.map((c, row) => row * n + c));
    // 1. a wrongly placed dino
    for (let i = 0; i < n * n; i++) if (cells[i] === 2 && !solIdx.has(i)) return { kind: 'wrong', cells: [i], msg: 'This dino is in the wrong spot.' };
    // 2. an X sitting on a dino's true home
    for (let i = 0; i < n * n; i++) if (cells[i] === 1 && solIdx.has(i)) return { kind: 'badx', cells: [i], msg: 'One of your X marks is hiding a dino\'s home.' };
    // 3. next logical step from the current position
    const st = makeState(n, region, cells), groups = groupCells(st);
    const step = nextStep(st, groups);
    if (step && step.type !== 'contradiction') {
      const focus = step.place !== undefined ? [step.place] : step.eliminate;
      return { kind: step.type, cells: step.group ? step.group.cells : focus, focus, msg: step.msg };
    }
    // 4. fallback: point at the smallest open region
    let bestG = -1, bestLive = Infinity;
    for (let g = 0; g < n; g++) { const cs = groups.regs[g]; if (groupHasDino(st, cs)) continue; const live = liveCands(st, cs).length; if (live < bestLive) { bestLive = live; bestG = g; } }
    if (bestG >= 0) return { kind: 'look', cells: liveCands(st, groups.regs[bestG]), focus: [sol[0] >= 0 ? [...solIdx].find(i => region[i] === bestG) : null], msg: 'Try working on this region next.' };
    return { kind: 'none', cells: [], msg: 'You\'re almost there!' };
  }

  function dailySeed(dateStr) { return hashString('yodoku-daily-' + dateStr); }
  function dailySize(dateStr) { // rotate sizes through the week
    const d = new Date(dateStr + 'T00:00:00');
    return [8, 6, 7, 7, 8, 8, 9][d.getDay()];
  }
  function dailyDifficulty(dateStr) { const n = dailySize(dateStr); return n <= 6 ? 'easy' : n === 7 ? 'normal' : n === 8 ? 'hard' : 'ultra'; }

  return { _i: { randomSolution, growRegions, repair, findSolutions }, rng, hashString, generate, validatePuzzle, countSolutions, logicSolve, rate, conflicts, conflictDetails, isSolved, coverage, hint, dailySeed, dailySize, dailyDifficulty, DIFFS };
});
