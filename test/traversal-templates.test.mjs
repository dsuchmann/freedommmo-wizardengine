import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classFor, volumeFor, volumeForPlacement, TRAVERSAL_CLASS } from '../src/world/traversal-templates.js';

// Tree-ish sil: 192px file, trim 160 wide x 180 tall; canopy 160, trunk 24, base flare 60.
const TREE_SIL = {
  bands: [160, 160, 160, 160, 160, 160, 150, 120, 80, 40, 24, 24, 24, 24, 30, 60],
  baseW: 60, coreW: 24, coreX: 80, visH: 180,
};
// Boulder-ish sil: 96px file, trim 80w x 50h dome.
const BOULDER_SIL = { bands: [20,30,40,48,56,62,68,72,75,77,78,79,80,80,80,80], baseW: 80, coreW: 60, coreX: 40, visH: 50 };

test('classFor: field defaults and state overrides', () => {
  assert.equal(classFor('f6', 'forest_oak', null), 'tree');
  assert.equal(classFor('f6', 'forest_oak', 'stump'), 'stump');
  assert.equal(classFor('f6', 'forest_oak', 'snag'), 'snag');
  assert.equal(classFor('f5', 'field_boulder', null), 'boulder');
  assert.equal(classFor('f5', 'field_boulder', 'destroyed'), 'flora'); // rubble: no collision
  assert.equal(classFor('f4', 'snow_fern', null), 'flora');
});

test('tree volume: solid trunk core, root ramp, canopy overhead', () => {
  // sizeTiles 6 over a 192px file -> pxT = 6/192 = 0.03125 tiles per file px
  const v = volumeFor(TREE_SIL, 'tree', 6, 192);
  assert.equal(v.solidH, Infinity);                  // never jump over a trunk
  assert.ok(v.baseRX > 0.15 && v.baseRX < 0.8);      // trunk core ~ coreW/2 * pxT = 0.375
  assert.ok(v.rampW > 0);                            // roots ramp beyond the core
  assert.ok(v.rampH > 0.1 && v.rampH <= 0.35);
  assert.equal(v.topZ, null);
  assert.ok(v.overheadZ > 1);                        // canopy underside above head
  assert.ok(v.overheadR > v.baseRX);                 // canopy wider than trunk
});

test('boulder volume: finite solid, standable top, jumpable when short', () => {
  // sizeTiles 3 over 96px -> pxT = 1/32; visH 50px -> ~1.56 tiles tall art
  const v = volumeFor(BOULDER_SIL, 'boulder', 3, 96);
  assert.ok(Number.isFinite(v.solidH));
  assert.equal(v.topZ, v.solidH);
  assert.ok(v.topZ > 0.3 && v.topZ < 1.5);
  assert.equal(v.rampW, 0);
});

test('stump volume: short standable; fence: thin jumpable; flora: null; prop: solid no ramp', () => {
  const s = volumeFor(TREE_SIL, 'stump', 6, 192);
  assert.ok(s.topZ >= 0.3 && s.topZ <= 0.7);
  assert.equal(s.solidH, s.topZ);
  const f = volumeFor(BOULDER_SIL, 'fence', 3, 96);
  assert.ok(f.baseRY <= 0.15);                       // thin
  assert.ok(Number.isFinite(f.solidH));
  assert.equal(volumeFor(TREE_SIL, 'flora', 6, 192), null);
  const p = volumeFor(BOULDER_SIL, 'prop', 3, 96);
  assert.equal(p.rampW, 0);
  assert.equal(p.topZ, null);
  assert.ok(Number.isFinite(p.solidH));
});

test('no sil -> conservative fallback for solid classes, null for flora', () => {
  const v = volumeFor(null, 'tree', 6, 192);
  assert.ok(v.baseRX > 0);                           // legacy-style core radius
  assert.equal(v.solidH, Infinity);
  assert.equal(volumeFor(null, 'flora', 2, 64), null);
});

test('volumeForPlacement: positions volume at footprint center, scales by sizeTiles', () => {
  const p = { name: 'forest_oak', state: null, sizeTiles: 6, size: 192, sil: TREE_SIL,
              bx: 320, by: 640 }; // world art px
  const v = volumeForPlacement(p, 'f6');
  assert.equal(v.x, 10);  // 320/32
  assert.equal(v.y, 20);  // 640/32
  assert.equal(v.solidH, Infinity);
  // stump state switches template automatically
  const v2 = volumeForPlacement({ ...p, state: 'stump' }, 'f6');
  assert.ok(Number.isFinite(v2.solidH));
});

test('canopy-contaminated core (real ancient_oak shape) still yields sane trunk + overhead', () => {
  const OAK_SIL = { bands: [87,120,160,185,185,185,180,170,160,150,150,150,140,130,120,55],
    baseW: 116, coreW: 142, coreX: 88, visH: 187 };
  const v = volumeFor(OAK_SIL, 'tree', 6, 192);
  assert.ok(v.baseRX <= 0.9 + 1e-9, `trunk clamped, got ${v.baseRX}`);   // cap = sizeTiles*0.15
  assert.ok(v.rampW > 0, 'root ramp survives contamination');
  assert.ok(v.overheadZ != null && v.overheadZ > 1, `canopy found, overheadZ=${v.overheadZ}`);
});
