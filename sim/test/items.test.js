// sim/test/items.test.js — M5: pure item math (tool power + durability from grains).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRAINS } from '../matter/grains.js';
import { toolPowerOf, maxHpOf, WEAR_PER_USE, HP_SCALE } from '../items/items.js';

const EPS = 1e-12;

test('every grain declares hardness in [0,1]', () => {
  for (const [g, def] of Object.entries(GRAINS)) {
    assert.ok(typeof def.hardness === 'number' && def.hardness >= 0 && def.hardness <= 1,
      `grain ${g} hardness`);
  }
  // anchor values the tool math depends on
  assert.equal(GRAINS.stone.hardness, 0.95);
  assert.equal(GRAINS.cellulose.hardness, 0.3);
  assert.equal(GRAINS.lignin.hardness, 0.6);
});

test('toolPowerOf: unit-weighted hardness; 0 for null/empty/zero-unit items', () => {
  assert.equal(toolPowerOf(null), 0);
  assert.equal(toolPowerOf({ grains: {} }), 0);
  assert.equal(toolPowerOf({ grains: { cellulose: 0 } }), 0);
  // wooden composite at log ratio 0.6:0.4 → 0.6*0.3 + 0.4*0.6 = 0.42
  const wood = { grains: { cellulose: 108, lignin: 72 } };
  assert.ok(Math.abs(toolPowerOf(wood) - 0.42) < EPS);
  // pure stone item → 0.95
  assert.ok(Math.abs(toolPowerOf({ grains: { stone: 2 } }) - 0.95) < EPS);
});

test('maxHpOf: HP_SCALE × unit-weighted stability; 0 for empty', () => {
  assert.equal(maxHpOf({ grains: {} }), 0);
  // wooden composite: stability 0.6*0.5 + 0.4*0.8 = 0.62 → 62
  const wood = { grains: { cellulose: 108, lignin: 72 } };
  assert.ok(Math.abs(maxHpOf(wood) - HP_SCALE * 0.62) < 1e-9);
});

test('constants are sane', () => {
  assert.equal(HP_SCALE, 100);
  assert.equal(WEAR_PER_USE, 10);
});

test('unknown grains are ignored (forward-compat with future grain types)', () => {
  const it = { grains: { cellulose: 1, mystery_goo: 5 } };
  assert.ok(Math.abs(toolPowerOf(it) - 0.3) < EPS, 'mystery grain contributes nothing');
});
