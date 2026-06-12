import test from 'node:test';
import assert from 'node:assert/strict';
import { f6Placements, f5Placements, f4Placements, clearClaimCaches,
  F6_BIOME_SCALE } from '../src/world/decoration-claims.js';
import { LG_CATALOG } from '../src/world/lg-catalog.js';

// tileInfo stub: everything is forest, no transitions (forest has oak on disk).
const forest = () => ({ biome: 'forest', transition: false });

function findTreeTile() { // deterministic scan for a tile that hosts an F6 tree
  for (let wy = 0; wy < 400; wy++) for (let wx = 0; wx < 400; wx++) {
    if (f6Placements(wx, wy, forest).length) return [wx, wy];
  }
  return null;
}

test('f6 placements exist in forest, are deterministic, and carry trim data', () => {
  clearClaimCaches();
  assert.ok(LG_CATALOG.forest?.length, 'oak must be in the catalog (run gen-mf-catalog first)');
  const at = findTreeTile();
  assert.ok(at, 'no tree in 400x400 forest — F6_TILE_CHANCE broken');
  const [wx, wy] = at;
  const a = f6Placements(wx, wy, forest)[0];
  clearClaimCaches();
  const b = f6Placements(wx, wy, forest)[0];
  assert.deepEqual(a, b); // deterministic across cache clears
  assert.ok(a.trim === null || (Array.isArray(a.trim) && a.trim.length === 4));
  assert.ok(a.fw > 0 && a.fh > 0 && a.sizeTiles > 0);
});

test('claim footprint uses the alpha trim, not the file edge', () => {
  clearClaimCaches();
  const [wx, wy] = findTreeTile();
  const p = f6Placements(wx, wy, forest)[0];
  if (!p.trim) return; // fully-opaque art: nothing to assert
  const drawPx = p.size * (p.sizeTiles * 32 / p.size); // = sizeTiles * TILE_ART_PX
  const visW = p.trim[2] * (drawPx / p.size);
  assert.ok(p.fw <= visW * 0.5 + 1e-6, `fw ${p.fw} must fit inside trimmed half-width ${visW * 0.5}`);
  assert.ok(p.fw < drawPx * 0.5, 'fw must be smaller than the file half-width');
});

test('bigger fields claim first: a tree tile hosts no F5/F4', () => {
  clearClaimCaches();
  const [wx, wy] = findTreeTile();
  assert.equal(f5Placements(wx, wy, forest).length, 0);
  assert.equal(f4Placements(wx, wy, forest).length, 0);
});

test('F6_BIOME_SCALE exports all 16 biomes at 1.0', () => {
  assert.equal(Object.keys(F6_BIOME_SCALE).length, 16);
  for (const v of Object.values(F6_BIOME_SCALE)) assert.equal(v, 1.0);
});
