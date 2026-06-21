// sim/test/coordination-registry.test.js — registry filename cases for the grassland corpus.
//   - run-bond variant (south_base__rb{n}.png) so the renderer breaks the 32px repeat per column
//   - doorwayHole(material[,shape]) -> {x0,y0,w,h} cut-out fractions (door-leaf fit)
//   - windowOverlayFile(shape, open) -> south_window_obj__{oshape}__{closed|shutters}.png
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallPieceFile, doorwayHole, windowOverlayFile, WINDOW_SHAPES }
  from '../../sim/world/buildings/building-material-registry.js';

test('south_base resolves wear-stated base and rb{n} run-bond variants', () => {
  assert.equal(wallPieceFile('south_base', {}), 'south_base__normal.png');
  assert.equal(wallPieceFile('south_base', { wear: 'mossy' }), 'south_base__mossy.png');
  assert.equal(wallPieceFile('south_base', { rbVariant: 1 }), 'south_base__rb1.png');
  assert.equal(wallPieceFile('south_base', { rbVariant: 3 }), 'south_base__rb3.png');
  // rbVariant 0 / falsy falls back to the wear base (no rb0 file on disk)
  assert.equal(wallPieceFile('south_base', { rbVariant: 0 }), 'south_base__normal.png');
});

test('doorwayHole returns the per-material cut-out rect within [0,1]', () => {
  for (const m of ['cob', 'fieldstone', 'wattle_daub', 'timber_frame']) {
    const r = doorwayHole(m);
    assert.ok(r && typeof r.x0 === 'number' && typeof r.w === 'number', `${m} returns a rect`);
    assert.ok(r.x0 >= 0 && r.x0 + r.w <= 1.0001, `${m} hole x within [0,1]`);
    assert.ok(r.y0 >= 0 && r.y0 + r.h <= 1.0001, `${m} hole y within [0,1]`);
  }
  // fieldstone is flagged for escalation (clipped opening) but still usable
  assert.equal(doorwayHole('fieldstone').escalate, true);
  // unknown material → safe default rect (no throw)
  const d = doorwayHole('nonexistent');
  assert.ok(d && d.w > 0 && d.h > 0);
});

test('windowOverlayFile maps every WINDOW_SHAPE to a closed + open object file', () => {
  for (const s of WINDOW_SHAPES) {
    const closed = windowOverlayFile(s, false);
    const open = windowOverlayFile(s, true);
    assert.match(closed, /^south_window_obj__(arched|stone|balcony)__closed\.png$/, `${s} closed`);
    assert.match(open, /^south_window_obj__(arched|stone|balcony)__shutters\.png$/, `${s} open`);
  }
  // openable default (arched carries both states)
  assert.equal(windowOverlayFile('arched', false), 'south_window_obj__arched__closed.png');
  assert.equal(windowOverlayFile('arched', true), 'south_window_obj__arched__shutters.png');
});
