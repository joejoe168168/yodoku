const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Y = require('./engine');
const failures = [], kinds = new Set();
let boards = 0, steps = 0;
function check(name, test) { try { test(); } catch (e) { failures.push(`${name}: ${e.message}`); } }
// Independent rule oracle: compare every pair instead of using the engine's coverage.
function legal(p, indexes) {
  return indexes.every((i, a) => indexes.slice(a + 1).every(j => {
    const r = Math.floor(i / p.n), c = i % p.n, rr = Math.floor(j / p.n), cc = j % p.n;
    return r !== rr && c !== cc && p.region[i] !== p.region[j] && (Math.abs(r - rr) > 1 || Math.abs(c - cc) > 1);
  }));
}
function independentSolutions(p, homes = []) {
  if (homes.length === p.n) return 1;
  let count = 0;
  for (let column = 0; column < p.n; column++) {
    const trial = homes.concat(homes.length * p.n + column);
    if (legal(p, trial)) count += independentSolutions(p, trial);
  }
  return count;
}
for (const difficulty of ['easy', 'normal', 'hard', 'ultra']) for (let seed = 0; seed < 100; seed++) {
  check(`${difficulty}/${seed}`, () => {
    const p = Y.generate({ difficulty, seed }), home = new Set(p.sol.map((c, r) => r * p.n + c));
    assert.ok(Y.validatePuzzle(p)); assert.ok(Y.logicSolve(p.n, p.region).solved, 'must be solvable by the advertised logic');
    if (seed < 10) assert.equal(independentSolutions(p), 1, 'independent rule oracle must find exactly one solution');
    const cells = Array(p.n * p.n).fill(0);
    for (let i = 0; i < cells.length; i++) {
      const cov = Y.coverage(p.n, p.region, i);
      for (let j = 0; j < cells.length; j++) assert.equal(cov.has(j), i !== j && !legal(p, [i, j]));
    }
    for (let turn = 0; !Y.isSolved(p.n, p.region, cells); turn++) {
      assert.ok(turn < cells.length * 2, 'hint loop did not finish');
      const h = Y.hint(p, cells); kinds.add(h.kind);
      assert.ok(!['none','wrong','badx'].includes(h.kind), `unexpected hint ${h.kind}`);
      const targets = h.focus || []; assert.ok(targets.length > 0);
      for (const i of targets) {
        assert.equal(cells[i], 0, 'hint must advance an undecided square');
        const place = ['single','look'].includes(h.kind);
        assert.equal(home.has(i), place, 'hint contradicts the known unique solution');
        cells[i] = place ? 2 : 1;
      }
      steps++;
    }
    assert.ok(legal(p, cells.flatMap((v, i) => v === 2 ? [i] : [])));
    const wrong = cells.findIndex((v, i) => !home.has(i));
    const mistake = Array(cells.length).fill(0); mistake[wrong] = 2;
    assert.equal(Y.hint(p, mistake).kind, 'wrong');
    mistake.fill(0); mistake[[...home][0]] = 1;
    assert.equal(Y.hint(p, mistake).kind, 'badx');
    boards++;
  });
}
check('conflicting starting board cannot be logic-solved', () => {
  const p = Y.generate({ difficulty: 'normal', seed: 0 }), cells = Array(49).fill(0);
  for (let i = 0; i < 7; i++) cells[i] = 2;
  assert.equal(Y.logicSolve(7, p.region, cells).solved, false);
});
check('device speed must not change a seeded board', () => {
  const source = fs.readFileSync('engine.js', 'utf8');
  function engine(tick) { let t = 0; const sandbox = { module: { exports: {} }, performance: { now: () => (t += tick) } }; vm.runInNewContext(source, sandbox); return sandbox.module.exports; }
  const fast = engine(.01), slow = engine(1000);
  for (let seed = 0; seed < 30; seed++) for (const difficulty of ['normal', 'hard', 'ultra']) {
    const a = fast.generate({ difficulty, seed }), b = slow.generate({ difficulty, seed });
    assert.equal(JSON.stringify(a.region), JSON.stringify(b.region), `${difficulty}/${seed} depends on elapsed wall time`);
  }
});
console.log(JSON.stringify({ boards, hintSteps: steps, hintKinds: [...kinds], failures }, null, 2));
if (failures.length) process.exitCode = 1;
