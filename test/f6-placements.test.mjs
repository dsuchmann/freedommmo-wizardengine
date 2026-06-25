import test from 'node:test';
import assert from 'node:assert/strict';
import { f6Placements, f5Placements, f4Placements, clearClaimCaches,
  F6_BIOME_SCALE, pickF6Variant } from '../src/world/decoration-claims.js';
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

test('f5/f6 placements carry sil when catalog has it', () => {
  // find any biome+tile that yields an f6 placement (deterministic scan)
  const ti = () => ({ biome: Object.keys(LG_CATALOG)[0], transition: false });
  let p = null;
  for (let x = 0; x < 600 && !p; x++) for (let y = 0; y < 4 && !p; y++) {
    const pls = f6Placements(x, y, ti);
    if (pls.length) p = pls[0];
  }
  if (!p) return; // no F6 assets on disk in this checkout — nothing to assert
  if (p.trim) {
    assert.ok(p.sil, 'placement with trim must carry sil');
    assert.equal(p.sil.bands.length, 16);
    assert.equal(p.sil.visH, p.trim[3]);
  }
});

test('pickF6Variant maps pool position through vmap and never returns an omitted index', () => {
  const obj = { variants: 4, vmap: [0, 1, 3, 4] }; // v2 omitted from the pool
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const pk = pickF6Variant(obj, i / 1000);
    assert.ok(pk.pos >= 0 && pk.pos < 4, `pos ${pk.pos} out of [0,4)`);
    seen.add(pk.variant);
  }
  assert.ok(!seen.has(2), 'omitted variant 2 must never be selected');
  for (const v of seen) assert.ok([0, 1, 3, 4].includes(v), `unexpected variant ${v}`);
});

test('pickF6Variant is identity when no vmap (back-compat)', () => {
  const obj = { variants: 3 };
  assert.equal(pickF6Variant(obj, 0).variant, 0);
  assert.equal(pickF6Variant(obj, 0).pos, 0);
  assert.equal(pickF6Variant(obj, 0.999).variant, 2);
});

test('f6 placement variant resolves to a real on-disk vmap entry', () => {
  clearClaimCaches();
  const at = findTreeTile();
  const p = f6Placements(at[0], at[1], forest)[0];
  const o = LG_CATALOG.forest.find(x => x.name === p.name);
  assert.ok((o.vmap || []).includes(p.variant) || !o.vmap, 'p.variant must be a vmap member');
});
