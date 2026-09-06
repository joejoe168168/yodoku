const assert = require('node:assert/strict');
const Y = require('./engine');
let maxMs = 0;
for (let seed = 0; seed < 250; seed++) {
  const start = performance.now(), p = Y.generate({ difficulty: 'extreme', seed });
  maxMs = Math.max(maxMs, performance.now() - start);
  assert.equal(p.n, 10); assert.equal(new Set(p.region).size, 10);
  assert.ok(Y.validatePuzzle(p)); assert.equal(Y.countSolutions(10, p.region, 2), 1);
  assert.ok(Y.logicSolve(10, p.region).solved);
  const cells = Array(100).fill(0); p.sol.forEach((c,r) => cells[r*10+c] = 2);
  assert.ok(Y.isSolved(10, p.region, cells));
  if (seed < 20) assert.deepEqual(Y.generate({ difficulty: 'extreme', seed }), p);
  const invalid = { ...p, region:p.region.map(g=>g===9?8:g) };
  assert.equal(Y.validatePuzzle(invalid), false);
}
assert.throws(()=>Y.generate({size:11,seed:0}), RangeError);
console.log(`PASS: 250 Extreme boards, ten connected regions, unique solutions, logic solvability, completion, deterministic generation and missing-region rejection. Slowest generation ${Math.round(maxMs)} ms.`);
