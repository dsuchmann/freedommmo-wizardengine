// sim/test/grains.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRAINS, CATEGORIES } from '../matter/grains.js';

test('grain registry: categories and property-bag shape', () => {
  assert.deepEqual(CATEGORIES, ['physical', 'magical', 'spiritual', 'technical']);
  assert.ok(Object.keys(GRAINS).length >= 8);
  for (const [name, g] of Object.entries(GRAINS)) {
    assert.ok(CATEGORIES.includes(g.category), `${name} category`);
    assert.ok(g.purity >= 0 && g.purity <= 1, `${name} purity`);
    assert.ok(g.resonance >= -1 && g.resonance <= 1, `${name} resonance`);
    assert.ok(g.stability >= 0 && g.stability <= 1, `${name} stability`);
    assert.ok(g.energyDensity > 0, `${name} energyDensity`);
  }
  // Pass 2 ships physical only; other categories may be empty but the vocabulary exists.
  assert.ok(Object.values(GRAINS).some(g => g.category === 'physical'));
});
