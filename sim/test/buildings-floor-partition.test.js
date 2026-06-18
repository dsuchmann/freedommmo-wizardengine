import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionFloor } from '../world/buildings/floor-partition.js';
import { selectStairCores, interiorCells } from '../world/buildings/vertical.js';
import { generatePattern } from '../world/buildings/patterns.js';

const key = (x, y) => `${x},${y}`;

function floorFor(pat, w, h, seed, use) {
  const { sections } = generatePattern(pat, w, h, seed);
  const core = selectStairCores(sections)[0];
  return { sections, core, part: partitionFloor(seed, sections, core, use) };
}

const CASES = [
  ['rect', 16, 12, 1], ['rect', 20, 14, 2], ['L', 16, 12, 3],
  ['T', 15, 13, 4], ['winged', 18, 12, 5], ['courtyard', 20, 18, 6],
];

test('every unit is reachable: its doorTile is adjacent to a circulation tile', () => {
  for (const [pat, w, h, s] of CASES) {
    const { part } = floorFor(pat, w, h, s, 'residential');
    for (const u of part.units) {
      const d = u.doorTile;
      const adj = [[d.x + 1, d.y], [d.x - 1, d.y], [d.x, d.y + 1], [d.x, d.y - 1]]
        .some(([x, y]) => part.circulation.has(key(x, y)));
      assert.ok(adj, `${pat}/${s}: unit door ${d.x},${d.y} not adjacent to circulation`);
      // door must belong to the unit it opens
      assert.ok(u.tiles.some(t => t.x === d.x && t.y === d.y), `${pat}/${s}: door not in its unit`);
    }
  }
});

test('units are pairwise disjoint and disjoint from circulation', () => {
  for (const [pat, w, h, s] of CASES) {
    const { part } = floorFor(pat, w, h, s, 'commercial');
    const seen = new Set();
    for (const u of part.units) {
      for (const t of u.tiles) {
        const k = key(t.x, t.y);
        assert.ok(!seen.has(k), `${pat}/${s}: tile ${k} in two units`);
        assert.ok(!part.circulation.has(k), `${pat}/${s}: tile ${k} in unit AND circulation`);
        seen.add(k);
      }
    }
  }
});

test('units ∪ circulation === the floor interior (full coverage, no leaks)', () => {
  for (const [pat, w, h, s] of CASES) {
    const { sections, part } = floorFor(pat, w, h, s, 'residential');
    const interior = new Set(interiorCells(sections).interior.map(c => key(c.x, c.y)));
    const covered = new Set(part.circulation);
    for (const u of part.units) for (const t of u.tiles) covered.add(key(t.x, t.y));
    assert.equal(covered.size, interior.size, `${pat}/${s}: coverage ${covered.size} != interior ${interior.size}`);
    for (const k of interior) assert.ok(covered.has(k), `${pat}/${s}: interior ${k} uncovered`);
    for (const k of covered) assert.ok(interior.has(k), `${pat}/${s}: covered ${k} not interior`);
  }
});

test('single-occupancy use yields exactly one unit (the stair is the circulation)', () => {
  const { part } = floorFor('rect', 16, 12, 7, 'lobby');
  assert.equal(part.units.length, 1, 'lobby floor should be one unit');
});

test('a multi-unit residential floor produces more than one apartment', () => {
  const { part } = floorFor('rect', 22, 16, 8, 'residential');
  assert.ok(part.units.length >= 2, `expected multiple apartments, got ${part.units.length}`);
  assert.ok(part.units.every(u => u.unitKind === 'apartment'), 'residential units are apartments');
});

test('deterministic', () => {
  const a = floorFor('winged', 18, 14, 11, 'commercial').part;
  const b = floorFor('winged', 18, 14, 11, 'commercial').part;
  assert.deepEqual([...a.circulation].sort(), [...b.circulation].sort());
  assert.deepEqual(a.units, b.units);
});

test('total: adversarial small / degenerate footprints never throw', () => {
  for (const [pat, w, h] of [['rect', 5, 5], ['rect', 6, 5], ['L', 7, 6], ['T', 6, 6]]) {
    for (let s = 0; s < 8; s++) {
      const { sections } = generatePattern(pat, w, h, s);
      const core = selectStairCores(sections)[0];
      assert.doesNotThrow(() => partitionFloor(s, sections, core, 'residential'), `${pat} ${w}x${h}/${s}`);
    }
  }
});
