import { getWorldSeed } from './world-seed.js';

export function hash(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = Math.imul(n, 9);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967295;
}

export function rand2(x, y, salt = 0, seed = getWorldSeed()) {
  return hash(Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed + salt, 1442695041));
}

// Index pick from a [0,1] roll. hash() can return exactly 1.0 (mixed hash
// 0xFFFFFFFF); Math.floor(r*n) then overflows to n. Clamp — identical to the
// raw floor for every r < 1, so placement determinism is untouched.
export function pickIndex(r, n) {
  var i = Math.floor(r * n);
  return i >= n ? n - 1 : i;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothNoise(x, y, scale, salt, seed = getWorldSeed()) {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = rand2(x0, y0, salt, seed);
  const b = rand2(x0 + 1, y0, salt, seed);
  const c = rand2(x0, y0 + 1, salt, seed);
  const d = rand2(x0 + 1, y0 + 1, salt, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

export function fbm(x, y, salt, seed = getWorldSeed(), baseScale = 180, octaves = 5) {
  let value = 0;
  let amplitude = 0.5;
  let scale = baseScale;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    value += smoothNoise(x, y, scale, salt + octave * 31, seed) * amplitude;
    norm += amplitude;
    scale *= 0.5;
    amplitude *= 0.5;
  }
  return norm > 0 ? value / norm : value;
}
