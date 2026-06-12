// sim/test/suitability.test.js — P3: deterministic site scoring over the real climate
// oracle; every component carries evidence (reason codes). Water tiles unscoreable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { scoreSite, findSettlementSite, WEIGHTS, WATER_SCAN_R } from '../society/suitability.js';
import { tileCost } from '../world/routing.js';

const MIXED = { x0: 926, y0: 0, w: 28, h: 14 };   // river wedge (NW) + grassland
const GRASS = { x0: 938, y0: 6, w: 16, h: 8 };    // pure grassland (may be unused; drop if unused)

function makeKernel(bounds = MIXED) { return new Kernel({ seed: 7, bounds }); }

test('P3 scoreSite: water tile is unscoreable (null); land tile yields full reason codes', () => {
  const k = makeKernel();
  assert.equal(scoreSite(k, 930, 0, MIXED), null, 'river tile refused');
  const s = scoreSite(k, 940, 8, MIXED);
  assert.ok(s, 'land tile scored');
  assert.ok(s.score >= 0 && s.score <= 1, 'score normalized');
  for (const c of ['water', 'fertility', 'defensibility', 'trade']) {
    assert.ok(c in s.reasons, `reason code ${c} present`);
    assert.ok(s.reasons[c].score >= 0 && s.reasons[c].score <= 1, `${c} component normalized`);
  }
  // weighted sum identity — the headline score IS its reasons, nothing hidden
  const expect = WEIGHTS.water * s.reasons.water.score + WEIGHTS.fertility * s.reasons.fertility.score
    + WEIGHTS.defensibility * s.reasons.defensibility.score + WEIGHTS.trade * s.reasons.trade.score;
  assert.ok(Math.abs(s.score - expect) < 1e-12, 'score = weighted sum of reason components');
});

test('P3 scoreSite: water access carries evidence — tile near river beats waterless tile on the water component', () => {
  const k = makeKernel();
  // (938,6) sits within WATER_SCAN_R of the river wedge edge; deep grass (945,12) does not (verify empirically; adjust coords).
  const near = scoreSite(k, 938, 6, MIXED);
  const far = scoreSite(k, 945, 12, MIXED);
  assert.ok(near.reasons.water.score > far.reasons.water.score, 'closer to water scores higher');
  assert.ok(near.reasons.water.nearest, 'evidence: nearest water tile recorded');
  assert.equal(tileCost(near.reasons.water.nearest.x, near.reasons.water.nearest.y), Infinity,
    'recorded nearest tile is actually water');
  assert.equal(far.reasons.water.nearest, null, 'no water in range → null evidence, score 0');
  assert.equal(far.reasons.water.score, 0);
});

test('P3 trade component: no settlements → 0 with declared absence; reachable settlement → > 0 with via evidence', () => {
  const k = makeKernel();
  const s0 = scoreSite(k, 940, 8, MIXED);
  assert.equal(s0.reasons.trade.score, 0, 'first settlement has no neighbors — honest 0');
  assert.equal(s0.reasons.trade.via, null);
  // arrange a settlement node (shape-only — real founding tested in settlements.test.js)
  k.graph.boot(() => {
    k.graph.createNode({ type: 'settlement', tick: 0, x: 945, y: 10, attrs: { territory: { x0: 941, y0: 6, w: 9, h: 8 }, noFlux: true } });
  });
  const s1 = scoreSite(k, 940, 8, MIXED);
  assert.ok(s1.reasons.trade.score > 0, 'reachable settlement raises trade');
  assert.ok(s1.reasons.trade.via != null, 'evidence: which settlement');
});

test('P3 findSettlementSite: argmax in rect, deterministic, never water, twice-identical', () => {
  const k = makeKernel();
  const a = findSettlementSite(k, MIXED);
  const b = findSettlementSite(k, MIXED);
  assert.ok(a, 'site found in mixed rect');
  assert.deepEqual(a, b, 'deterministic');
  assert.ok(tileCost(a.x, a.y) !== Infinity, 'site is land');
  // it really is the maximum: no scanned tile beats it (spot-check full rescan)
  for (let y = MIXED.y0; y < MIXED.y0 + MIXED.h; y++) for (let x = MIXED.x0; x < MIXED.x0 + MIXED.w; x++) {
    const s = scoreSite(k, x, y, MIXED);
    if (s) assert.ok(s.score <= a.score + 1e-12, `no tile beats the chosen site (${x},${y})`);
  }
});
