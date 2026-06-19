// roof-rules.js — deterministic f(biome, buildingType, tier, seed, pattern) → roof
// config. Turns the design workflow's biome→roof table + building-type overlays
// into an engine-ready config (style/material/features/params), so ANY real game
// building auto-gets a biome-correct, program-appropriate roof.
//
// Precedence (from the biome design): (1) hard CLIMATE floor (biome) — snow biomes
// forbid flat/deck styles; (2) PROGRAM override (building type) — smithy ≠ thatch,
// watchtower → turret+battlement, granary → steep vent; (3) tier/aesthetic upgrade;
// (4) remaining freedom filled by biome-ranked weights sampled with f(seed).
//
// Output shape matches a roof-config CONFIGS entry (minus sections) so it flows
// straight through resolveConfig() → the engine.

import { rand, mix } from '../../sim/kernel/rng.js';

// ── helpers ──────────────────────────────────────────────────────────────────
function strHash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const uniq = (a) => [...new Set(a)];
const lerp = (rng, r) => rng[0] + (rng[1] - rng[0]) * r;
const r2 = (v) => Math.round(v * 100) / 100;
function pickRanked(list, r, decay = 0.5) {
  if (!list.length) return undefined;
  const w = list.map((_, i) => Math.pow(decay, i));
  const sum = w.reduce((a, b) => a + b, 0);
  let t = r * sum;
  for (let i = 0; i < list.length; i++) { t -= w[i]; if (t <= 0) return list[i]; }
  return list[list.length - 1];
}

// ── pattern → which engine styles make geometric sense on that footprint ──────
const PATTERN_STYLES = {
  rect: ['hip', 'gable', 'gambrel', 'shed', 'mansard', 'flat', 'parapet', 'stepped', 'sawtooth', 'butterfly', 'halfHip'],
  L: ['hip', 'crossGabled', 'gable', 'halfHip', 'mansard', 'flat', 'parapet'],
  T: ['hip', 'crossGabled', 'gable', 'halfHip', 'mansard'],
  courtyard: ['hip', 'flat', 'parapet', 'mansard', 'stepped'],
  winged: ['hip', 'gable', 'crossGabled', 'mansard', 'flat'],
  compound: ['hip', 'flat', 'parapet', 'stepped', 'mansard', 'gable'],
  round: ['conical', 'domed', 'pyramidal', 'hip'],
};
const DECK_STYLES = new Set(['flat', 'parapet', 'stepped', 'mansard']);
const FLAT_STYLES = new Set(['flat', 'parapet']);
const NO_SNOW_STYLES = new Set(['flat', 'parapet', 'butterfly', 'sawtooth', 'domed']); // can't shed snow
const DECK_FEATS = new Set(['walkdeck', 'garden', 'crenellation']);
const PEAK_FEATS = new Set(['spire']);

// ── biome climate profiles (materials/styles ranked; features w/ probability) ──
// pitch = [lo,hi] rise/tile; overhang = [lo,hi] tiles; deck = walkable allowed;
// snow = forbid flat/deck/dome styles; weather/moss = [lo,hi].
const P = (o) => o;
const BIOME_PROFILES = {
  arctic:  P({ materials: ['slate', 'patina', 'shingle', 'sod'], styles: ['gable', 'hip', 'pyramidal', 'mansard'], features: [{ id: 'buttress', p: .6 }, { id: 'finial', p: .3 }], pitch: [1.6, 2.1], overhang: [0, 1], deck: false, snow: true, weather: [.2, .4], moss: [0, .08] }),
  tundra:  P({ materials: ['sod', 'shingle', 'plank', 'slate'], styles: ['shed', 'gable', 'hip'], features: [{ id: 'chimney', p: .6 }], pitch: [.5, .8], overhang: [1, 1], deck: false, snow: true, weather: [.3, .5], moss: [.2, .5] }),
  taiga:   P({ materials: ['plank', 'shingle', 'sod', 'slate'], styles: ['gable', 'gambrel', 'hip'], features: [{ id: 'buttress', p: .4 }, { id: 'dormer', p: .4 }, { id: 'chimney', p: .6 }], pitch: [1.4, 1.9], overhang: [1, 2], deck: false, snow: true, weather: [.3, .5], moss: [.1, .3] }),
  forest:  P({ materials: ['shingle', 'slate', 'clay', 'plank'], styles: ['hip', 'gable', 'crossGabled', 'mansard'], features: [{ id: 'dormer', p: .5 }, { id: 'chimney', p: .6 }, { id: 'finial', p: .2 }], pitch: [.9, 1.3], overhang: [1, 1], deck: false, snow: false, weather: [.25, .45], moss: [.15, .4] }),
  dense_forest: P({ materials: ['shingle', 'plank', 'slate', 'sod'], styles: ['hip', 'gable', 'pyramidal', 'crossGabled'], features: [{ id: 'finial', p: .4 }, { id: 'chimney', p: .4 }], pitch: [1.1, 1.5], overhang: [1, 1], deck: false, snow: false, weather: [.35, .55], moss: [.3, .6] }),
  tropical_forest: P({ materials: ['thatch', 'plank', 'clay', 'copper'], styles: ['hip', 'gable', 'conical'], features: [{ id: 'garden', p: .4 }, { id: 'finial', p: .3 }], pitch: [1.4, 1.9], overhang: [2, 2], deck: false, snow: false, weather: [.3, .5], moss: [.4, .65] }),
  grassland: P({ materials: ['thatch', 'shingle', 'clay', 'sod'], styles: ['hip', 'gable', 'shed', 'conical'], features: [{ id: 'finial', p: .3 }, { id: 'chimney', p: .4 }], pitch: [.8, 1.2], overhang: [1, 1], deck: false, snow: false, weather: [.3, .5], moss: [.1, .3] }),
  savanna: P({ materials: ['thatch', 'clay', 'shingle', 'flatstone'], styles: ['hip', 'shed', 'gable', 'flat'], features: [{ id: 'finial', p: .2 }], pitch: [.6, 1.0], overhang: [1, 1], deck: false, snow: false, weather: [.35, .55], moss: [.05, .2] }),
  steppe:  P({ materials: ['thatch', 'sod', 'shingle', 'flatstone'], styles: ['hip', 'gable', 'shed', 'sawtooth'], features: [{ id: 'chimney', p: .4 }], pitch: [.7, 1.1], overhang: [1, 1], deck: false, snow: false, weather: [.35, .55], moss: [.1, .3] }),
  desert:  P({ materials: ['flatstone', 'clay', 'copper', 'bone'], styles: ['flat', 'parapet', 'stepped', 'domed', 'shed'], features: [{ id: 'walkdeck', p: .7 }, { id: 'crenellation', p: .5 }, { id: 'garden', p: .35 }], pitch: [.3, .5], overhang: [0, 0], deck: true, snow: false, weather: [.3, .5], moss: [0, .05] }),
  beach:   P({ materials: ['clay', 'plank', 'patina', 'thatch'], styles: ['hip', 'gable', 'shed', 'parapet'], features: [{ id: 'walkdeck', p: .5 }, { id: 'finial', p: .2 }], pitch: [.7, 1.0], overhang: [1, 2], deck: true, snow: false, weather: [.35, .55], moss: [.05, .2] }),
  hills:   P({ materials: ['slate', 'flatstone', 'shingle', 'clay'], styles: ['gable', 'hip', 'crossGabled', 'mansard', 'stepped'], features: [{ id: 'buttress', p: .4 }, { id: 'turret', p: .25 }, { id: 'dormer', p: .35 }], pitch: [1.0, 1.4], overhang: [1, 1], deck: true, snow: false, weather: [.3, .5], moss: [.15, .4] }),
  mountains: P({ materials: ['slate', 'shingle', 'flatstone', 'copper'], styles: ['gable', 'hip', 'shed', 'mansard'], features: [{ id: 'buttress', p: .5 }, { id: 'chimney', p: .6 }], pitch: [1.6, 2.1], overhang: [2, 2], deck: false, snow: true, weather: [.3, .5], moss: [.1, .35] }),
  swamp:   P({ materials: ['thatch', 'plank', 'sod', 'shingle'], styles: ['gable', 'hip', 'shed', 'conical'], features: [{ id: 'finial', p: .2 }], pitch: [1.4, 1.9], overhang: [2, 2], deck: false, snow: false, weather: [.45, .6], moss: [.5, .7] }),
  volcanic: P({ materials: ['flatstone', 'bone', 'patina', 'slate'], styles: ['flat', 'parapet', 'stepped', 'shed', 'mansard'], features: [{ id: 'crenellation', p: .5 }, { id: 'buttress', p: .4 }, { id: 'walkdeck', p: .4 }, { id: 'chimney', p: .4 }], pitch: [.3, .6], overhang: [0, 1], deck: true, snow: false, weather: [.4, .6], moss: [.05, .2] }),
  mystic:  P({ materials: ['crystal', 'patina', 'slate', 'bone'], styles: ['conical', 'domed', 'pyramidal', 'gambrel', 'stepped'], features: [{ id: 'spire', p: .7 }, { id: 'turret', p: .5 }, { id: 'finial', p: .6 }, { id: 'crenellation', p: .3 }], pitch: [1.3, 1.9], overhang: [0, 1], deck: true, snow: false, weather: [.05, .25], moss: [.1, .35] }),
};

// ── building-type / category overlays ─────────────────────────────────────────
const CATEGORY_RULES = {
  residential: { features: [{ id: 'dormer', p: .4 }, { id: 'chimney', p: .6 }] },
  commercial:  { styles: ['hip', 'gable', 'sawtooth'], features: [{ id: 'finial', p: .2 }] },
  craft:       { noThatch: true, styles: ['shed', 'gable', 'hip'], features: [{ id: 'chimney', p: .85 }, { id: 'finial', p: .25 }] },
  agricultural:{ styles: ['gambrel', 'hip', 'conical'], features: [{ id: 'finial', p: .25 }], noDeck: true },
  civic:       { styles: ['hip', 'gable', 'mansard'], features: [{ id: 'dormer', p: .5 }, { id: 'finial', p: .4 }] },
  religious:   { styles: ['domed', 'pyramidal', 'conical', 'hip'], matUpgrade: ['copper', 'slate'], features: [{ id: 'spire', p: .7 }, { id: 'finial', p: .7 }, { id: 'crenellation', p: .3 }] },
  military:    { styles: ['parapet', 'flat', 'pyramidal', 'hip'], matUpgrade: ['slate', 'flatstone', 'metal'], features: [{ id: 'crenellation', p: .8 }, { id: 'turret', p: .5 }, { id: 'walkdeck', p: .7 }, { id: 'buttress', p: .4 }], forceDeck: true },
  infrastructure: { styles: ['conical', 'hip', 'shed'], features: [{ id: 'finial', p: .3 }] },
  entertainment: { styles: ['hip', 'gable', 'sawtooth'], features: [{ id: 'banner', p: .4 }] },
  race_specific: { features: [{ id: 'finial', p: .4 }] },
};
const TYPE_RULES = {
  watchtower: { styles: ['conical', 'pyramidal', 'parapet', 'flat'], matUpgrade: ['slate', 'flatstone'], features: [{ id: 'turret', p: 1 }, { id: 'crenellation', p: .8 }, { id: 'walkdeck', p: .7 }, { id: 'buttress', p: .4 }], turretCount: 1, forceDeck: true },
  lighthouse: { styles: ['conical'], features: [{ id: 'finial', p: 1 }] },
  silo:       { styles: ['conical', 'domed'], features: [{ id: 'finial', p: .5 }], noDeck: true },
  granary:    { styles: ['conical', 'pyramidal', 'hip'], features: [{ id: 'finial', p: .5 }], pitchMul: 1.2, noDeck: true },
  barn:       { styles: ['gambrel', 'gable', 'hip'], features: [{ id: 'dormer', p: .5 }, { id: 'finial', p: .2 }], noDeck: true },
  mill:       { styles: ['conical', 'hip', 'gable'], features: [{ id: 'finial', p: .4 }], noDeck: true },
  temple:     { styles: ['domed', 'pyramidal', 'conical'], matUpgrade: ['glazed', 'copper', 'slate'], features: [{ id: 'spire', p: .9 }, { id: 'finial', p: .8 }, { id: 'crenellation', p: .4 }, { id: 'walkdeck', p: .4 }] },
  monastery:  { styles: ['hip', 'mansard', 'domed'], matUpgrade: ['copper', 'slate'], features: [{ id: 'finial', p: .6 }, { id: 'garden', p: .5 }, { id: 'walkdeck', p: .4 }] },
  manor:      { styles: ['mansard', 'hip', 'crossGabled'], matUpgrade: ['slate', 'copper'], features: [{ id: 'dormer', p: .7 }, { id: 'turret', p: .4 }, { id: 'finial', p: .5 }, { id: 'walkdeck', p: .35 }, { id: 'garden', p: .3 }], turretCount: 2 },
  villa:      { styles: ['hip', 'mansard', 'parapet'], matUpgrade: ['clay', 'copper'], features: [{ id: 'walkdeck', p: .6 }, { id: 'garden', p: .4 }, { id: 'finial', p: .3 }], forceDeck: true },
  town_hall:  { styles: ['hip', 'mansard', 'gable'], matUpgrade: ['slate', 'copper'], features: [{ id: 'dormer', p: .5 }, { id: 'finial', p: .5 }, { id: 'banner', p: .4 }] },
  bazaar:     { styles: ['hip', 'sawtooth', 'gable'], features: [{ id: 'banner', p: .3 }] },
  crystal_nexus: { styles: ['conical', 'domed', 'pyramidal'], matUpgrade: ['crystal'], features: [{ id: 'spire', p: 1 }, { id: 'finial', p: .8 }] },
};

// ── the resolver ──────────────────────────────────────────────────────────────
export function resolveRoof(biome, typeId, tier, seedNum, pattern, category) {
  const prof = BIOME_PROFILES[biome] || BIOME_PROFILES.grassland;
  const TR = TYPE_RULES[typeId] || CATEGORY_RULES[category] || {};
  const seed = mix(strHash(biome), strHash(typeId), (seedNum | 0));

  // 1. STYLE — biome ranking, type bias prepended, filtered by footprint pattern.
  let styles = uniq((TR.styles || []).concat(prof.styles));
  const allowed = PATTERN_STYLES[pattern] || PATTERN_STYLES.rect;
  styles = styles.filter((s) => allowed.includes(s));
  if (prof.snow) styles = styles.filter((s) => !NO_SNOW_STYLES.has(s)); // climate floor
  if (!styles.length) styles = allowed.filter((s) => !(prof.snow && NO_SNOW_STYLES.has(s)));
  if (!styles.length) styles = allowed;
  const style = pickRanked(styles, rand(seed, 0x11));
  const deckStyle = DECK_STYLES.has(style);

  // 2. MATERIAL — biome ranking; program filter (no thatch on fire/craft) + upgrade.
  let mats = prof.materials.slice();
  if (TR.noThatch) mats = mats.filter((m) => m !== 'thatch');
  if (TR.matUpgrade) mats = uniq(TR.matUpgrade.concat(mats));
  const material = pickRanked(uniq(mats), rand(seed, 0x12));

  // 3. PARAMS — pitch ceiling & overhang from biome climate.
  let pitch = lerp(prof.pitch, rand(seed, 0x13));
  if (TR.pitchMul) pitch = Math.min(2.2, pitch * TR.pitchMul);
  let overhang = TR.overhang != null ? TR.overhang : Math.round(lerp(prof.overhang, rand(seed, 0x14)));

  // 4. FEATURES — type-forced then biome, gated by deck-biome/deck-style & snow.
  const allowDeck = (prof.deck || TR.forceDeck) && !TR.noDeck;
  const want = (TR.features || []).concat(prof.features || []);
  const feats = new Set();
  for (const f of want) {
    if (DECK_FEATS.has(f.id) && !(allowDeck && deckStyle)) continue;
    if (PEAK_FEATS.has(f.id) && FLAT_STYLES.has(style)) continue;
    if (feats.has(f.id)) continue;
    if (rand(seed, 0x200 + (strHash(f.id) % 0x97)) < (f.p ?? 1)) feats.add(f.id);
  }

  return {
    name: `${biome} ${typeId}`, biome, type: typeId, style, material,
    pitch: r2(pitch), overhang,
    weathering: r2(lerp(prof.weather, rand(seed, 0x15))), moss: r2(lerp(prof.moss, rand(seed, 0x16))),
    ridgeOrientation: rand(seed, 0x17) < 0.5 ? 'ew' : 'ns',
    sharpness: r2(1.4 + rand(seed, 0x18) * 1.6),
    clampHeight: 0.5, parapetRise: 0.7, stepWidth: 2, stepRise: 0.8, knee: 2.5, capHeight: 4,
    features: [...feats],
    turretCount: TR.turretCount ?? 4, buttressCount: 3, chimneyCount: 1, dormerCount: 2,
    bannerHue: 30, lightAngle: 235, ambient: 0.36,
  };
}

export const LAND_BIOMES = Object.keys(BIOME_PROFILES);
export { BIOME_PROFILES };
