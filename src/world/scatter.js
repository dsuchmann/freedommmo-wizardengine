import { rand2 } from '../core/random.js';

export function jitteredScatter(wx, wy, salt = 0, threshold = 0.5) {
  const n = rand2(Math.floor(wx / 2), Math.floor(wy / 2), salt);
  const local = rand2(wx, wy, salt + 101);
  if (local > threshold) return null;
  return {
    x: rand2(wx, wy, salt + 1),
    y: rand2(wx, wy, salt + 2),
    scale: 0.75 + rand2(wx, wy, salt + 3) * 0.65,
    frame: Math.floor(rand2(wx, wy, salt + 4) * 8),
    cluster: n
  };
}

export function patchDensity(wx, wy, salt = 0, scale = 11) {
  const gx = Math.floor(wx / scale);
  const gy = Math.floor(wy / scale);
  const a = rand2(gx, gy, salt);
  const b = rand2(gx + 1, gy, salt);
  const c = rand2(gx, gy + 1, salt);
  const d = rand2(gx + 1, gy + 1, salt);
  const fx = smooth((wx / scale) - gx);
  const fy = smooth((wy / scale) - gy);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

export function organicPresence(wx, wy, salt = 0, density = 0.5) {
  const patch = patchDensity(wx, wy, salt, 13);
  const fine = rand2(wx, wy, salt + 77);
  return patch * 0.65 + fine * 0.35 < density;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
