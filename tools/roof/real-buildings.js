// real-buildings.js — pull REAL game building footprints (the exact shapes the
// world compiler emits) so roofs can be tested on actual game buildings, not
// synthetic shapes. Mirrors generateFootprint()'s steps 1–3 using the SAME rng
// draws → identical sections to what the game would place for that seed — but
// skips interior/blueprint-node generation (we only need `sections`).

// relative ../../ paths resolve the same in the browser (served root) and node.
import { rand, mix } from '../../sim/kernel/rng.js';
import { typeById } from '../../sim/world/buildings/taxonomy.js';
import { generatePattern } from '../../sim/world/buildings/patterns.js';

const SCALE = 1.5;   // generateFootprint's visual up-scale
const MIN_DIM = 5;

export function realFootprint(typeId, seed) {
  const type = typeById(typeId);
  if (!type) return null;
  const w = Math.max(MIN_DIM, Math.round((type.minW + Math.floor(rand(seed, 0x5001) * (type.maxW - type.minW + 1))) * SCALE));
  const h = Math.max(MIN_DIM, Math.round((type.minH + Math.floor(rand(seed, 0x5002) * (type.maxH - type.minH + 1))) * SCALE));
  const patternName = type.patterns[Math.floor(rand(seed, 0x5003) * type.patterns.length)];
  const { sections } = generatePattern(patternName, w, h, mix(seed, 0x5004));
  return { typeId, typeName: type.name, category: type.category, pattern: patternName, w, h, sections };
}

// n distinct real footprints for a type (varying seed; dedupe identical shapes).
export function realBuildings(typeId, n = 3, baseSeed = 1) {
  const out = [], seen = new Set();
  for (let s = 0; out.length < n && s < 400; s++) {
    const fp = realFootprint(typeId, mix(baseSeed, s + 1));
    if (!fp || !fp.sections || !fp.sections.length) continue;
    const key = fp.pattern + ':' + fp.sections.map(x => `${x.x0},${x.y0},${x.w},${x.h}`).join('|');
    if (seen.has(key)) continue;
    seen.add(key); out.push(fp);
  }
  // if a type can't produce n distinct shapes (e.g. 'rect' only at small size), repeat last
  while (out.length && out.length < n) out.push(out[out.length - 1]);
  return out;
}
