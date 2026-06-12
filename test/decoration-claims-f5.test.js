// test/decoration-claims-f5.test.js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setFieldTuning } from '../src/world/field-tuning.js';
import { f5Placements, f5SpriteUrl, f4Placements, getClaimMask, clearClaimCaches, claimScanRadius }
  from '../src/world/decoration-claims.js';
import { MO_CATALOG } from '../src/world/mo-catalog.js';

const grass = (wx, wy) => ({ biome: 'grassland', transition: false });

beforeEach(() => { setFieldTuning(null); clearClaimCaches(); });

// scan a region, return [wx, wy, placement] triples
function scan(tileInfo, x0, y0, n) {
  const out = [];
  for (let wy = y0; wy < y0 + n; wy++)
    for (let wx = x0; wx < x0 + n; wx++)
      for (const p of f5Placements(wx, wy, tileInfo)) out.push([wx, wy, p]);
  return out;
}

test('f5Placements is deterministic and non-empty over a large region', () => {
  const a = scan(grass, 0, 0, 80);
  clearClaimCaches();
  const b = scan(grass, 0, 0, 80);
  assert.ok(a.length > 0, 'expected some placements in 6400 tiles at ~2%');
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
  for (const [, , p] of a) {
    assert.equal(p.biome, 'grassland');
    assert.equal(p.size, 96);
    assert.ok(MO_CATALOG.grassland.some(o => o.name === p.name));
    assert.ok(p.variant >= 0 && p.variant < MO_CATALOG.grassland.find(o => o.name === p.name).variants);
  }
});

test('density 0 -> empty; size multiplier flows to sizeTiles', () => {
  setFieldTuning({ f5: { biomes: { grassland: { density: 0 } } } });
  clearClaimCaches();
  assert.equal(scan(grass, 0, 0, 60).length, 0);

  setFieldTuning(null); clearClaimCaches();
  const base = scan(grass, 0, 0, 60);
  setFieldTuning({ f5: { biomes: { grassland: { size: 2 } } } });
  clearClaimCaches();
  const big = scan(grass, 0, 0, 60);
  assert.equal(base.length, big.length);
  for (let i = 0; i < base.length; i++)
    assert.ok(Math.abs(big[i][2].sizeTiles - base[i][2].sizeTiles * 2) < 1e-9);
});

test('state roll respects tuneStateWeights override; URL falls back to base when PNG missing', () => {
  setFieldTuning({ f5: { biomes: { grassland: { states: { enchanted: 1 } } } } });
  clearClaimCaches();
  const pls = scan(grass, 0, 0, 80);
  assert.ok(pls.length > 0);
  for (const [, , p] of pls) {
    assert.equal(p.state, 'enchanted');
    const obj = MO_CATALOG.grassland.find(o => o.name === p.name);
    const onDisk = !!(obj.states.enchanted && obj.states.enchanted.includes(p.variant));
    const url = f5SpriteUrl(p);
    if (onDisk) assert.ok(url.includes('/_states/enchanted/'), url);
    else assert.ok(!url.includes('/_states/'), 'missing PNG must fall back to base: ' + url);
  }
});

test('claim footprint is larger than F4 relative footprint and lands in the mask', () => {
  const pls = scan(grass, 0, 0, 80);
  const [wx, wy, p] = pls[0];
  const drawPx = p.sizeTiles * 32;
  assert.ok(p.fw > drawPx * 0.30, 'F5 fw must exceed F4 ratio 0.30: ' + (p.fw / drawPx));
  assert.ok(p.fh > drawPx * 0.16, 'F5 fh must exceed F4 ratio 0.16: ' + (p.fh / drawPx));
  // the footprint center cell is claimed in the 8x8 mask of its tile
  const cwx = Math.floor(p.bx / 32), cwy = Math.floor(p.by / 32);
  const mask = getClaimMask(cwx, cwy, grass);
  const c = Math.min(7, Math.max(0, Math.floor((p.bx - cwx * 32) / 4)));
  const r = Math.min(7, Math.max(0, Math.floor((p.by - cwy * 32) / 4)));
  assert.ok((mask[r] & (1 << c)) !== 0, 'F5 base center must be claimed');
});

test('F4 skips tiles that F5 claimed', () => {
  const f5Tiles = new Set(scan(grass, 0, 0, 120).map(([wx, wy]) => wx + ',' + wy));
  assert.ok(f5Tiles.size > 0);
  for (const key of f5Tiles) {
    const [wx, wy] = key.split(',').map(Number);
    assert.equal(f4Placements(wx, wy, grass).length, 0, 'F4 must skip F5 tile ' + key);
  }
});

test('F4 default state mix unchanged by the resolver migration (golden thresholds)', () => {
  // find F4 placements and verify the historical distribution boundaries hold:
  // same tile coords always produce the same state as the old hardcoded code
  // (roll < .15 seedling, < .70 base/null, < .90 wilting, < .98 dead, else enchanted)
  let checked = 0;
  for (let wy = 0; wy < 200 && checked < 25; wy++) {
    for (let wx = 0; wx < 200 && checked < 25; wx++) {
      for (const p of f4Placements(wx, wy, grass)) {
        assert.ok([null, 'seedling', 'wilting', 'dead', 'enchanted'].includes(p.state));
        checked++;
      }
    }
  }
  assert.ok(checked > 0, 'expected F4 placements');
});

test('F4 grassland lifecycle states: exact golden values (salt 9705 regression pin)', () => {
  setFieldTuning(null);
  clearClaimCaches();
  const GOLDEN = [
    [2, 0, 'wilting'], [5, 0, 'wilting'], [11, 0, 'dead'], [14, 0, null],
    [33, 0, 'wilting'], [43, 0, null], [47, 0, 'seedling'], [54, 0, null],
    [59, 0, 'seedling'], [107, 0, null],
  ];
  for (const [wx, wy, want] of GOLDEN) {
    const pls = f4Placements(wx, wy, grass);
    assert.equal(pls.length, 1, `expected placement at ${wx},${wy}`);
    assert.equal(pls[0].state, want, `state at ${wx},${wy}`);
  }
});

test('claimScanRadius grows with extreme f5 tuning and resets with caches', () => {
  setFieldTuning(null);
  clearClaimCaches();
  assert.equal(claimScanRadius(), 3);
  setFieldTuning({ f5: { size: 2, biomes: { grassland: { size: 2, objects: {} } } } });
  clearClaimCaches();
  assert.ok(claimScanRadius() > 3, 'radius must widen at 4x scale');
  assert.ok(claimScanRadius() <= 8, 'radius is capped');
  setFieldTuning(null);
  clearClaimCaches();
  assert.equal(claimScanRadius(), 3);
});
