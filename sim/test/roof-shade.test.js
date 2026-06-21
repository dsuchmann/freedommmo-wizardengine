// roof-shade.test.js — smooth normal + along-run gradient shading kills hip "terrace"
// rings. Shade is derived from the geometry's corner-averaged normal (t.normal) plus a
// tiny eave->ridge gradient, so equal-distEdge rings stop reading as flat color bands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoothNormalShade, lightVec } from '../../tools/roof/roof-renderer.js';
import { buildRoofGrid } from '../../tools/roof/roof-geometry.js';

const P = { pitch: 0.9, ridgeOrientation: 'ew', clampHeight: 0.5, parapetRise: 0.5,
  knee: 2.5, capHeight: 4, sharpness: 1.4, stepWidth: 2, stepRise: 0.7, toothWidth: 4, fascia: 0.5 };

function hip() {
  return buildRoofGrid([{ x0: 0, y0: 0, w: 11, h: 8 }],
    { style: 'hip', overhang: 1, overhangDroop: 0.35, noNorthOverhang: true, params: P });
}

test('equal-distEdge hip tiles get DIFFERENT shade (no terrace banding)', () => {
  const g = hip();
  const light = lightVec(235, 52);
  // two tiles at the SAME distEdge ring but on DIFFERENT faces (south vs east) must NOT
  // share an identical shade.
  const ring = g.tiles.filter(t => Math.round(t.distEdge) === 2 && t.role === 'slope');
  const s = ring.find(t => t.dir === 's'), e = ring.find(t => t.dir === 'e');
  if (s && e) {
    const ss = smoothNormalShade(g, s, light, 0.34);
    const es = smoothNormalShade(g, e, light, 0.34);
    assert.ok(Math.abs(ss - es) > 0.02, `south ${ss.toFixed(3)} != east ${es.toFixed(3)}`);
  }
});

test('along-run gradient: eave tile differs from ridge tile on the same face', () => {
  const g = hip();
  const light = lightVec(235, 52);
  const south = g.tiles.filter(t => t.dir === 's' && t.role === 'slope')
    .sort((a, b) => a.distEdge - b.distEdge);
  if (south.length >= 2) {
    const lo = smoothNormalShade(g, south[0], light, 0.34);
    const hi = smoothNormalShade(g, south[south.length - 1], light, 0.34);
    assert.ok(Math.abs(lo - hi) > 0.005, `eave ${lo.toFixed(3)} != ridge ${hi.toFixed(3)}`);
  }
});

test('smoothNormalShade is bounded and finite', () => {
  const g = hip();
  const light = lightVec(235, 52);
  for (const t of g.tiles) {
    const s = smoothNormalShade(g, t, light, 0.34);
    assert.ok(Number.isFinite(s) && s >= 0 && s <= 2, `shade ${s} in [0,2]`);
  }
});
