// sim/test/objects.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBJECT_DEFS, defOf, stageFor, damageTaken, TERMINAL } from '../matter/objects.js';
import { ARCHETYPE_YIELD } from '../matter/composition.js';

test('catalog closure: every break product has a def-or-terminal and a grain yield', () => {
  for (const [cls, def] of Object.entries(OBJECT_DEFS)) {
    for (const p of def.breakProducts ?? []) {
      assert.ok(OBJECT_DEFS[p.class] || TERMINAL.has(p.class), `${cls} product ${p.class} in catalog`);
      const hasYield = Object.keys(ARCHETYPE_YIELD).some(k => p.class.startsWith(k)) || ARCHETYPE_YIELD[p.class];
      assert.ok(hasYield, `${cls} product ${p.class} has grain yield`);
    }
  }
  // explicit entries added to M1's table
  for (const cls of ['pebble', 'rock_chunk', 'stone_dust', 'wood_scrap']) {
    assert.ok(ARCHETYPE_YIELD[cls], `${cls} explicit yield`);
  }
});

test('defOf: longest-prefix archetype-class matching', () => {
  assert.equal(defOf('boulder_small'), OBJECT_DEFS.boulder);
  assert.equal(defOf('rock_chunk'), OBJECT_DEFS.rock_chunk);   // longest prefix beats 'rock'
  assert.equal(defOf('stone_dust'), null);                      // terminal: no def
  assert.equal(defOf('totally_unknown'), null);
});

test('stageFor derives stage from hp fraction', () => {
  assert.equal(stageFor(100, 100), 'intact');
  assert.equal(stageFor(75, 100), 'cracked');     // boundary: >0.75 is intact
  assert.equal(stageFor(41, 100), 'cracked');
  assert.equal(stageFor(40, 100), 'fractured');
  assert.equal(stageFor(10, 100), 'shattered');
  assert.equal(stageFor(0, 100), 'shattered');
});

test('damageTaken applies typed resistance', () => {
  const def = OBJECT_DEFS.boulder;
  assert.equal(damageTaken(def, 'blunt', 20), 10);   // 0.5 taken
  assert.equal(damageTaken(def, 'sharp', 20), 4);    // 0.2 taken
  assert.equal(damageTaken(def, 'unknown', 20), 0);  // unknown type: no effect (honest)
});
