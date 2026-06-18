import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectStairCores, reserveLift, interiorCells, LIFT_THRESHOLD } from '../world/buildings/vertical.js';
import { generatePattern } from '../world/buildings/patterns.js';

const interiorSet = (sections) => new Set(interiorCells(sections).interior.map(c => `${c.x},${c.y}`));

test('rect: one stair core, on an interior floor tile', () => {
  const { sections } = generatePattern('rect', 10, 8, 42);
  const cores = selectStairCores(sections);
  assert.equal(cores.length, 1);
  const interior = interiorSet(sections);
  assert.ok(interior.has(`${cores[0].x},${cores[0].y}`), 'core must be an interior floor tile');
});

test('stair core is never a perimeter/wall/exterior tile (all 4 neighbours inside)', () => {
  for (const [pat, w, h, seed] of [['rect', 12, 9, 1], ['L', 14, 10, 2], ['T', 13, 11, 3], ['winged', 16, 10, 4], ['courtyard', 18, 16, 5]]) {
    const { sections } = generatePattern(pat, w, h, seed);
    const tiles = new Set();
    for (const s of sections)
      for (let y = s.y0; y < s.y0 + s.h; y++)
        for (let x = s.x0; x < s.x0 + s.w; x++) tiles.add(`${x},${y}`);
    for (const c of selectStairCores(sections)) {
      assert.ok(tiles.has(`${c.x},${c.y - 1}`) && tiles.has(`${c.x},${c.y + 1}`) &&
        tiles.has(`${c.x - 1},${c.y}`) && tiles.has(`${c.x + 1},${c.y}`),
        `${pat} core ${c.x},${c.y} touches outside/perimeter`);
    }
  }
});

test('disjoint complex (compound) gets one core per wing', () => {
  // compound = 2-3 buildings joined by 1-wide corridors (no interior in the corridor),
  // so each building is its own interior component.
  const { sections } = generatePattern('compound', 26, 16, 7);
  const cores = selectStairCores(sections);
  assert.ok(cores.length >= 2, `expected one core per wing, got ${cores.length}`);
});

test('selectStairCores is deterministic', () => {
  const { sections } = generatePattern('winged', 16, 12, 99);
  assert.deepEqual(selectStairCores(sections), selectStairCores(sections));
});

test('lift reserved only above 3 above-ground floors', () => {
  const core = { x: 5, y: 5 };
  assert.equal(reserveLift(1, core), null);
  assert.equal(reserveLift(LIFT_THRESHOLD, core), null);
  const lift = reserveLift(LIFT_THRESHOLD + 1, core);
  assert.ok(lift && lift.shaft && lift.mechanismId, 'lift should be reserved above the threshold');
  assert.equal(reserveLift(40, null), null, 'no core => no lift');
});
