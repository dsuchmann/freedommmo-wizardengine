// Builds the per-tile atmosphere field textures for the GL present pass.
// Same shape/convention as buildWaveField (water-wave-overlay.js): one texel
// per world tile covering the viewport plus margin. Three RGBA8 layers:
//   A = hue/sat/con/bri, B = warm/fog/shadow/night, C = mood one-hot weights.
// The GPU samples these LINEAR + a blur kernel, so per-biome values cross-fade
// spatially over a wide band — the "seamless transition" requirement.
import { getAtmosphere, packAtmosphere } from '../world/biome-atmosphere.js';

var _bufA = null, _bufB = null, _bufC = null;

// Per-frame memo of the packed 12 bytes (A:4, B:4, C:4) for each distinct biome.
// getAtmosphere/packAtmosphere are pure functions of the biome id, so packing a
// biome once and copying the result to every tile of that biome is byte-identical
// to packing each tile individually — it just avoids the redundant recompute
// (thousands of tiles collapse to ~one pack per distinct biome). Rebuilt each
// call so runtime edits to BIOME_ATMOSPHERE (tuner) still take effect.
var _packCache = new Map();
var _scrA = new Uint8Array(4), _scrB = new Uint8Array(4), _scrC = new Uint8Array(4);

export function buildAtmoField(chunkStore, tile0X, tile0Y, tilesW, tilesH) {
  var n = tilesW * tilesH * 4;
  if (!_bufA || _bufA.length !== n) {
    _bufA = new Uint8Array(n);
    _bufB = new Uint8Array(n);
    _bufC = new Uint8Array(n);
  }
  var cache = _packCache;
  cache.clear();
  for (var ty = 0; ty < tilesH; ty++) {
    for (var tx = 0; tx < tilesW; tx++) {
      var o = (ty * tilesW + tx) * 4;
      var tile = chunkStore.tileAt(tile0X + tx, tile0Y + ty);
      var biome = tile ? tile.biome : null;
      var packed = cache.get(biome);
      if (packed === undefined) {
        packAtmosphere(getAtmosphere(biome), _scrA, _scrB, _scrC, 0);
        packed = new Uint8Array(12);
        packed[0] = _scrA[0]; packed[1] = _scrA[1]; packed[2] = _scrA[2]; packed[3] = _scrA[3];
        packed[4] = _scrB[0]; packed[5] = _scrB[1]; packed[6] = _scrB[2]; packed[7] = _scrB[3];
        packed[8] = _scrC[0]; packed[9] = _scrC[1]; packed[10] = _scrC[2]; packed[11] = _scrC[3];
        cache.set(biome, packed);
      }
      _bufA[o] = packed[0]; _bufA[o + 1] = packed[1]; _bufA[o + 2] = packed[2]; _bufA[o + 3] = packed[3];
      _bufB[o] = packed[4]; _bufB[o + 1] = packed[5]; _bufB[o + 2] = packed[6]; _bufB[o + 3] = packed[7];
      _bufC[o] = packed[8]; _bufC[o + 1] = packed[9]; _bufC[o + 2] = packed[10]; _bufC[o + 3] = packed[11];
    }
  }
  return { a: _bufA, b: _bufB, c: _bufC };
}
