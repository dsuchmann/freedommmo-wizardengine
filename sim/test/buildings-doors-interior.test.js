import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFootprint } from '../world/buildings/footprints.js';
import { generatePattern } from '../world/buildings/patterns.js';
import { BUILDING_TYPES } from '../world/buildings/taxonomy.js';

const MIN_DOOR_SPACING = 5;
const MAX_DOORS = 4;
const MIN_DIM = 5;
const TYPE_IDS = Object.keys(BUILDING_TYPES);

test('doors: at least one, capped, and never clustered', () => {
  for (const id of TYPE_IDS) {
    if (BUILDING_TYPES[id].open) continue;
    for (let s = 0; s < 12; s++) {
      const fp = generateFootprint(1000 + s, id);
      if (!fp) continue;
      assert.ok(fp.doors.length >= 1, `${id} seed ${s}: no door`);
      assert.ok(fp.doors.length <= MAX_DOORS, `${id} seed ${s}: ${fp.doors.length} doors (> ${MAX_DOORS})`);
      for (let i = 0; i < fp.doors.length; i++) {
        for (let j = i + 1; j < fp.doors.length; j++) {
          const d = Math.abs(fp.doors[i].x - fp.doors[j].x) + Math.abs(fp.doors[i].y - fp.doors[j].y);
          assert.ok(d >= MIN_DOOR_SPACING, `${id} seed ${s}: doors clustered (dist ${d})`);
        }
      }
    }
  }
});

test('doors sit on the footprint perimeter (a tile with an empty 4-neighbour)', () => {
  const id = TYPE_IDS.find(k => !BUILDING_TYPES[k].open);
  for (let s = 0; s < 20; s++) {
    const fp = generateFootprint(3000 + s, id);
    if (!fp) continue;
    const tiles = new Set();
    for (const sec of fp.sections)
      for (let y = sec.y0; y < sec.y0 + sec.h; y++)
        for (let x = sec.x0; x < sec.x0 + sec.w; x++) tiles.add(`${x},${y}`);
    for (const d of fp.doors) {
      const open = !tiles.has(`${d.x},${d.y + 1}`) || !tiles.has(`${d.x},${d.y - 1}`) ||
        !tiles.has(`${d.x - 1},${d.y}`) || !tiles.has(`${d.x + 1},${d.y}`);
      assert.ok(open, `${id} door ${d.x},${d.y} not on perimeter`);
    }
  }
});

test('minimum building dimension for a believable interior', () => {
  for (const id of TYPE_IDS) {
    for (let s = 0; s < 6; s++) {
      const fp = generateFootprint(2000 + s, id);
      if (!fp) continue;
      assert.ok(fp.boundingBox.w >= MIN_DIM && fp.boundingBox.h >= MIN_DIM,
        `${id} seed ${s}: ${fp.boundingBox.w}x${fp.boundingBox.h} below min ${MIN_DIM}`);
    }
  }
});

test('courtyard ring band is a believable hallway (>= 3 thick) when it stays a ring', () => {
  for (const [w, h, seed] of [[16, 14, 42], [18, 16, 7], [20, 18, 99]]) {
    const r = generatePattern('courtyard', w, h, seed);
    if (r.sections.length === 4) {
      assert.ok(r.sections[0].h >= 3, `courtyard ring thin: ${r.sections[0].h}`);
    }
  }
});
