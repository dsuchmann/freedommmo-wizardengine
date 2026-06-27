import { test } from 'node:test';
import assert from 'node:assert/strict';
import { southRuns } from '../../src/render/building-tiles.js';

// Locate a run by its (y, x0); fail loudly if absent so a wrong run-split is obvious.
function run(runs, y, x0) {
  const r = runs.find(r => r.y === y && r.x0 === x0);
  assert.ok(r, `expected a run at y=${y}, x0=${x0}; got ${JSON.stringify(runs)}`);
  return r;
}

test('rectangle: both run ends are true outer edges', () => {
  const fp = { sections: [{ x0: 0, y0: 0, w: 3, h: 2 }] };
  const runs = southRuns(fp);
  const r = run(runs, 1, 0);
  assert.equal(r.x1, 3);
  assert.equal(r.interiorLeft, false);
  assert.equal(r.interiorRight, false);
});

test('plus/cross: arm ends that abut the trunk are interior junctions', () => {
  // vertical trunk x=1 (y0..2) + horizontal bar y=1 (x0..2) => a plus.
  const fp = { sections: [
    { x0: 1, y0: 0, w: 1, h: 3 },
    { x0: 0, y0: 1, w: 3, h: 1 },
  ] };
  const runs = southRuns(fp);

  // West arm: left end is open grass (edge), right end abuts the trunk (interior).
  const west = run(runs, 1, 0);
  assert.equal(west.x1, 1);
  assert.equal(west.interiorLeft, false);
  assert.equal(west.interiorRight, true);

  // East arm: left end abuts the trunk (interior), right end is open grass (edge).
  const east = run(runs, 1, 2);
  assert.equal(east.x1, 3);
  assert.equal(east.interiorLeft, true);
  assert.equal(east.interiorRight, false);

  // Trunk's south tip: sticks out south, flanked by grass on both sides (edges).
  const tip = run(runs, 2, 1);
  assert.equal(tip.x1, 2);
  assert.equal(tip.interiorLeft, false);
  assert.equal(tip.interiorRight, false);
});
