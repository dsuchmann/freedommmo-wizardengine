import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSockets, projectSocket, SOCKET_V, UPPER_TILE_KEEP } from '../src/render/dressing/socket-index.js';
import { WALL_CONFIG } from '../src/render/wall-config.js';

// A 4×3 rectangular building at world (10, 20): one south door at local (1,2), one window at (3,2).
function building(floors = 1) {
  const fp = {
    sections: [{ x0: 0, y0: 0, w: 4, h: 3 }],
    boundingBox: { w: 4, h: 3 },
    doors: [{ x: 1, y: 2 }],
    windows: [{ x: 3, y: 2 }],
  };
  if (floors > 1) fp.node = { payload: { aboveGroundFloors: floors } };
  return { x: 10, y: 20, biome: 'grassland', wallSlug: 'fieldstone', footprint: fp };
}

test('buildSockets emits door/window/corner/eave sockets for the south face', () => {
  const socks = buildSockets(building(1));
  const byKind = (k) => socks.filter((s) => s.kind === k);
  assert.equal(byKind('above_door').length, 1, 'one door lintel');
  assert.equal(byKind('beside_door').length, 2, 'two lantern-flank sockets per door');
  assert.equal(byKind('on_door').length, 1, 'one on-door socket (knocker)');
  assert.equal(byKind('window_sill').length, 1, 'one ground-floor window sill');
  assert.equal(byKind('window_jamb').length, 2, 'two window jambs (shutter L+R)');
  assert.equal(byKind('wall_corner').length, 2, 'two corners (1 storey × 2 ends)');
  assert.equal(byKind('roof_edge').length, 1, 'one eave');
  // door socket anchors at the door tile centre, ground floor
  const door = byKind('above_door')[0];
  assert.equal(door.cxLocal, 1.5);
  assert.equal(door.floor, 0);
});

test('window sills stack per storey; corners run full height; eave rides the top storey', () => {
  const socks = buildSockets(building(3));
  const sills = socks.filter((s) => s.kind === 'window_sill');
  assert.equal(sills.length, 3, 'one sill per storey');
  assert.deepEqual(sills.map((s) => s.floor).sort(), [0, 1, 2]);
  const corners = socks.filter((s) => s.kind === 'wall_corner');
  assert.equal(corners.length, 6, 'corners on every storey (3 × 2 ends)');
  assert.deepEqual([...new Set(corners.map((s) => s.floor))].sort(), [0, 1, 2]);
  const eave = socks.find((s) => s.kind === 'roof_edge');
  assert.equal(eave.floor, 2, 'eave on the top storey');
});

test('a measured window anchor moves the sill to the real opening (height + centre)', () => {
  const plain = buildSockets(building(1)).find((s) => s.kind === 'window_sill');
  const measured = buildSockets(building(1), { winAnchor: { xFrac: 0.6, sillV: 0.42 } }).find((s) => s.kind === 'window_sill');
  assert.equal(measured.v, 0.42, 'sill height comes from the art');
  // xFrac 0.6 shifts +0.4 tile (0.1 of a 4-tile tile = 0.4 tiles) off the geometric centre
  assert.ok(Math.abs(measured.cxLocal - (plain.cxLocal + 0.4)) < 1e-9, `centre shifted to the opening (${measured.cxLocal})`);
});

test('projectSocket matches the renderer storey-stack (runGroundY − (floor+v)·wH)', () => {
  const b = building(2);
  const camX = 5, camY = 7, tilePx = 32;
  const wH = Math.round(tilePx * WALL_CONFIG.wallHeight);
  const WY = WALL_CONFIG.wallYOffset;
  // wall corners stack by EXACTLY one storey (the upper-tile crop only shifts window openings, not corners)
  const c1 = buildSockets(b).find((q) => q.kind === 'wall_corner' && q.floor === 1);
  const p = projectSocket(b, c1, camX, camY, tilePx);
  const groundY = Math.round((b.y + c1.runY + 1) * tilePx - camY) + Math.round(tilePx * WY);
  assert.equal(p.x, Math.round((b.x + c1.cxLocal) * tilePx - camX));
  assert.equal(p.y, groundY - (1 + SOCKET_V.wall_corner) * wH);
  const c0 = buildSockets(b).find((q) => q.kind === 'wall_corner' && q.floor === 0);
  assert.equal(projectSocket(b, c0, camX, camY, tilePx).y - p.y, wH, 'corners stack by exactly one storey');
});

test('upper-storey window sockets ride the cropped upper-tile opening (lower than a flat +wH stack)', () => {
  const b = building(2);
  const camX = 0, camY = 0, tilePx = 32;
  const wH = Math.round(tilePx * WALL_CONFIG.wallHeight);
  const WY = WALL_CONFIG.wallYOffset;
  const g = buildSockets(b).find((q) => q.kind === 'window_sill' && q.floor === 0);
  const u = buildSockets(b).find((q) => q.kind === 'window_sill' && q.floor === 1);
  const groundY = Math.round((b.y + u.runY + 1) * tilePx - camY) + Math.round(tilePx * WY);
  // floor 0 = the untransformed ground sill
  assert.equal(projectSocket(b, g, camX, camY, tilePx).y, groundY - (0 + SOCKET_V.window_sill) * wH);
  // floor 1 = crop-transformed sill v' = 1 − (1 − v)/KEEP
  const upV = 1 - (1 - SOCKET_V.window_sill) / UPPER_TILE_KEEP;
  const pu = projectSocket(b, u, camX, camY, tilePx);
  assert.equal(pu.y, groundY - (1 + upV) * wH);
  assert.ok(pu.y > groundY - (1 + SOCKET_V.window_sill) * wH, 'upper sill sits lower than a naive +wH stack');
});

test('eave projects to the column top (groundY − stories·wH)', () => {
  const b = building(2);
  const camX = 0, camY = 0, tilePx = 32;
  const wH = Math.round(tilePx * WALL_CONFIG.wallHeight);
  const WY = WALL_CONFIG.wallYOffset;
  const eave = buildSockets(b).find((s) => s.kind === 'roof_edge');
  const p = projectSocket(b, eave, camX, camY, tilePx);
  const groundY = Math.round((b.y + eave.runY + 1) * tilePx - camY) + Math.round(tilePx * WY);
  assert.equal(p.y, groundY - 2 * wH); // 2 storeys tall → eave at the top
});

test('buildSockets is empty for a building with no footprint', () => {
  assert.deepEqual(buildSockets({ x: 0, y: 0 }), []);
});
