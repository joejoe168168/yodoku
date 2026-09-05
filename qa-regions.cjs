const assert = require('node:assert/strict');
const Y = require('./engine');
let tested = 0;
for (const difficulty of ['easy', 'normal', 'hard', 'ultra']) {
  for (let seed = 0; seed < 250; seed++) {
    const p = Y.generate({ difficulty, seed });
    assert.ok(Y.validatePuzzle(p), `${difficulty} seed ${seed}: invalid regions or solution`);
    assert.equal(new Set(p.region).size, p.n);
    assert.equal(Y.countSolutions(p.n, p.region, 2), 1);
    const cells = Array(p.n * p.n).fill(0);
    p.sol.forEach((c, row) => cells[row * p.n + c] = 2);
    assert.ok(Y.isSolved(p.n, p.region, cells));
    tested++;
  }
}
const p = Y.generate({ difficulty: 'normal', seed: 17 });
assert.equal(Y.validatePuzzle({ ...p, region: p.region.map(g => g === 6 ? 0 : g) }), false, 'reject six-colour Normal saves');
assert.equal(Y.validatePuzzle({ ...p, region: p.region.slice(1) }), false);
assert.equal(Y.validatePuzzle({ ...p, sol: Array(7).fill(0) }), false);
assert.equal(Y.validatePuzzle(null), false);
console.log(`PASS: ${tested} boards across all difficulties have exactly N connected regions, valid placements, and one solution; malformed saves rejected.`);
