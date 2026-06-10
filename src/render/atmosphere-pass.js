// Builds the per-tile atmosphere field textures for the GL present pass.
// Same shape/convention as buildWaveField (water-wave-overlay.js): one texel
// per world tile covering the viewport plus margin. Three RGBA8 layers:
//   A = hue/sat/con/bri, B = warm/fog/shadow/night, C = mood one-hot weights.
// The GPU samples these LINEAR + a blur kernel, so per-biome values cross-fade
// spatially over a wide band — the "seamless transition" requirement.
import { getAtmosphere, packAtmosphere } from '../world/biome-atmosphere.js';

var _bufA = null, _bufB = null, _bufC = null;

export function buildAtmoField(chunkStore, tile0X, tile0Y, tilesW, tilesH) {
  var n = tilesW * tilesH * 4;
  if (!_bufA || _bufA.length !== n) {
    _bufA = new Uint8Array(n);
    _bufB = new Uint8Array(n);
    _bufC = new Uint8Array(n);
  }
  for (var ty = 0; ty < tilesH; ty++) {
    for (var tx = 0; tx < tilesW; tx++) {
      var o = (ty * tilesW + tx) * 4;
      var tile = chunkStore.tileAt(tile0X + tx, tile0Y + ty);
      packAtmosphere(getAtmosphere(tile ? tile.biome : null), _bufA, _bufB, _bufC, o);
    }
  }
  return { a: _bufA, b: _bufB, c: _bufC };
}
