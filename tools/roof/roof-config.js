// roof-config.js — footprint shape library, the 25 curated gallery roofs, and the
// live-editor parameter set. Configs were curated by the design workflow across
// biomes/materials/styles/features and normalized here to this engine's
// vocabulary. Features the engine does not yet DRAW are listed in `pending` so
// the gallery can show honest absence rather than silently dropping them.

// ── footprint shape library → sections [{x0,y0,w,h}] (same shape the game emits)
function disc(r) {
  const secs = [];
  for (let j = -r; j <= r; j++) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - j * j)));
    secs.push({ x0: -half, y0: j, w: 2 * half + 1, h: 1 });
  }
  return secs;
}
export const FOOTPRINTS = {
  square: (n = 9) => [{ x0: 0, y0: 0, w: n, h: n }],
  rectangle: (w = 13, h = 8) => [{ x0: 0, y0: 0, w, h }],
  L: (a = 11, b = 6) => [{ x0: 0, y0: 0, w: b, h: a }, { x0: 0, y0: a - b, w: a, h: b }],
  T: (a = 12, b = 5) => [{ x0: Math.floor((a - b) / 2), y0: 0, w: b, h: a }, { x0: 0, y0: 0, w: a, h: b }],
  'U-court': (a = 12, b = 4) => [{ x0: 0, y0: 0, w: b, h: a }, { x0: a - b, y0: 0, w: b, h: a }, { x0: 0, y0: a - b, w: a, h: b }],
  cross: (a = 12, b = 4) => [{ x0: Math.floor((a - b) / 2), y0: 0, w: b, h: a }, { x0: 0, y0: Math.floor((a - b) / 2), w: a, h: b }],
  'courtyard-ring': (a = 12, b = 3) => [
    { x0: 0, y0: 0, w: a, h: b }, { x0: 0, y0: a - b, w: a, h: b },
    { x0: 0, y0: 0, w: b, h: a }, { x0: a - b, y0: 0, w: b, h: a },
  ],
  'round-tower': (r = 6) => disc(r),     // hi-res disc so cones/domes read smooth
  'twin-wing': (a = 7, b = 6, gap = 3) => [
    { x0: 0, y0: 0, w: a, h: b }, { x0: 0, y0: b + gap, w: a, h: b },
    { x0: Math.floor(a / 2), y0: b, w: 1, h: gap },
  ],
  stepped: (n = 11) => [{ x0: 0, y0: 0, w: n, h: n }],
};

// ── material id → representative hex (used to tint turret/spire caps)
export const MATERIAL_HEX = {
  shingle: '#8a5a33', slate: '#59616f', clay: '#b5582f', thatch: '#bb9540',
  flatstone: '#8c8579', plank: '#7a5230', copper: '#c9743a', patina: '#46a088',
  metal: '#8a939c', sod: '#5f8a3f', bone: '#cdc4a3', crystal: '#9a6fd0',
  glazed: '#3aa0b5', mystic: '#7a4fd0',
};

// helper to assemble one config compactly
const C = (o) => o;

// The 25. style/material/features use THIS engine's ids. `pending` = requested in
// the curated design but not yet drawn by the engine (honest absence).
export const CONFIGS = [
  C({ name: 'Alpine Frost-Steeple', biome: 'arctic', type: 'chapel', shape: 'T', style: 'gable', material: 'slate',
      pitch: 1.9, overhang: 1, hue: 208, weathering: .3, moss: .05, ridgeOrientation: 'ew',
      features: ['buttress', 'finial', 'banner'], buttressCount: 4, bannerHue: 200, lightAngle: 230,
      pending: ['snow-ice', 'weathervane'] }),
  C({ name: "Trapper's Gambrel Barn", biome: 'taiga', type: 'barn', shape: 'rectangle', style: 'gambrel', material: 'plank',
      pitch: 1.4, overhang: 1, hue: 30, weathering: .4, moss: .2, knee: 2.5, capHeight: 4,
      features: ['dormer', 'chimney'], dormerCount: 2, chimneyCount: 1, lightAngle: 240,
      pending: ['moss-vines (extra)'] }),
  C({ name: 'Sod-Berm Longhouse', biome: 'tundra', type: 'longhouse', shape: 'rectangle', style: 'shed', material: 'sod',
      pitch: .6, overhang: 1, hue: 92, weathering: .35, moss: .5,
      features: ['chimney'], chimneyCount: 2, lightAngle: 235,
      pending: ['rooftop-garden (needs deck)', 'snow-ice'] }),
  C({ name: 'Cottage Cross-Gable Manor', biome: 'forest', type: 'manor', shape: 'L', style: 'crossGabled', material: 'clay',
      pitch: 1.1, overhang: 1, hue: 16, weathering: .3, moss: .25,
      features: ['dormer', 'chimney', 'finial'], dormerCount: 3, chimneyCount: 2, lightAngle: 235,
      pending: ['rain-gutters'] }),
  C({ name: 'Thatch Roundhouse Granary', biome: 'grassland', type: 'granary', shape: 'round-tower', style: 'conical', material: 'thatch',
      pitch: 1.0, overhang: 1, hue: 46, weathering: .35, moss: .3, sharpness: 2,
      features: [], lightAngle: 235,
      pending: ['stepped-eave tiers'] }),
  C({ name: 'Adobe Battlement Deck', biome: 'desert', type: 'watchtower', shape: 'square', style: 'parapet', material: 'flatstone',
      pitch: .4, overhang: 0, hue: 38, weathering: .35, moss: .05, clampHeight: .5, parapetRise: .8,
      features: ['walkdeck', 'crenellation', 'turret', 'garden'], turretCount: 4, lightAngle: 235,
      pending: ['parapet-molding'] }),
  C({ name: "Widow's-Walk Tile Villa", biome: 'beach', type: 'villa', shape: 'courtyard-ring', style: 'hip', material: 'clay',
      pitch: .7, overhang: 1, hue: 20, weathering: .4, moss: .15,
      features: [], lightAngle: 235,
      pending: ['walkable-deck (ring center open)', 'rain-gutters', 'hanging-lanterns'] }),
  C({ name: 'Slate Lookout Turret Hall', biome: 'hills', type: 'town_hall', shape: 'L', style: 'hip', material: 'slate',
      pitch: .95, overhang: 1, hue: 214, weathering: .3, moss: .12,
      features: ['turret', 'buttress', 'dormer'], turretCount: 2, buttressCount: 3, dormerCount: 3, lightAngle: 235,
      pending: ['rain-gutters'] }),
  C({ name: 'Stilt Steeple Swamp Hut', biome: 'swamp', type: 'tide_lodge', shape: 'rectangle', style: 'gable', material: 'thatch',
      pitch: 1.6, overhang: 1, hue: 44, weathering: .5, moss: .6, ridgeOrientation: 'ew',
      features: [], lightAngle: 235,
      pending: ['catslide sweep', 'rain-gutters'] }),
  C({ name: 'Palm Pavilion Pagoda', biome: 'tropical_forest', type: 'temple', shape: 'square', style: 'stepped', material: 'glazed',
      pitch: .8, overhang: 1, hue: 150, weathering: .15, moss: .05, stepWidth: 2, stepRise: .8,
      features: ['spire', 'finial'], lightAngle: 235,
      pending: ['upswept eave flare'] }),
  C({ name: 'Basalt Bastion Keep', biome: 'volcanic', type: 'armory', shape: 'square', style: 'flat', material: 'flatstone',
      pitch: .3, overhang: 0, hue: 20, sat: 8, light: 26, weathering: .4, moss: .1, clampHeight: .45,
      features: ['walkdeck', 'crenellation', 'buttress', 'chimney'], buttressCount: 4, chimneyCount: 2, lightAngle: 235,
      pending: ['parapet-molding'] }),
  C({ name: 'Crystal Witch-Hat Spire', biome: 'mystic', type: 'crystal_nexus', shape: 'round-tower', style: 'conical', material: 'crystal',
      pitch: 1.6, overhang: .5, hue: 280, weathering: .1, moss: 0, sharpness: 3.2,
      features: ['spire', 'finial'], lightAngle: 235,
      pending: ['arcane panels', 'weathervane'] }),
  C({ name: 'Alpine Chalet Throw-Eave', biome: 'mountains', type: 'inn', shape: 'rectangle', style: 'gable', material: 'shingle',
      pitch: 1.6, overhang: 2, hue: 24, weathering: .4, moss: .1, ridgeOrientation: 'ew',
      features: ['buttress', 'chimney', 'banner'], buttressCount: 2, chimneyCount: 1, bannerHue: 0, lightAngle: 240,
      pending: ['snow-ice'] }),
  C({ name: 'Bone Beast-Lair Carapace', biome: 'dense_forest', type: 'shrine', shape: 'square', style: 'pyramidal', material: 'bone',
      pitch: 1.3, overhang: 1, hue: 44, weathering: .45, moss: .3, sharpness: 1.4,
      features: ['spire', 'finial'], lightAngle: 235,
      pending: ['dragon-spine ridge crest'] }),
  C({ name: 'Imperial Glazed Dutch-Gable', biome: 'savanna', type: 'courthouse', shape: 'T', style: 'hip', material: 'glazed',
      pitch: 1.0, overhang: 1, hue: 50, weathering: .2, moss: .05,
      features: ['finial'], lightAngle: 235,
      pending: ['gablet wall', 'greek-key molding', 'skylight'] }),
  C({ name: 'Verdigris Cloister Ring', biome: 'forest', type: 'monastery', shape: 'courtyard-ring', style: 'hip', material: 'patina',
      pitch: .85, overhang: 1, hue: 165, weathering: .5, moss: .2,
      features: ['finial'], lightAngle: 235,
      pending: ['rooftop-garden', 'rain-gutters', 'cupola'] }),
  C({ name: 'Sawtooth Glassworks', biome: 'steppe', type: 'glassblower', shape: 'rectangle', style: 'sawtooth', material: 'metal',
      pitch: .9, overhang: .5, hue: 210, weathering: .4, moss: 0, toothWidth: 5,
      features: ['chimney'], chimneyCount: 2, lightAngle: 235,
      pending: ['clerestory glazing', 'rain-gutters'] }),
  C({ name: 'Bright-Copper Onion Dome', biome: 'mystic', type: 'oracle_chamber', shape: 'round-tower', style: 'domed', material: 'copper',
      pitch: 1.1, overhang: .5, hue: 22, weathering: .1, moss: 0,
      features: ['spire', 'finial', 'banner'], bannerHue: 45, lightAngle: 235,
      pending: ['ogee-onion profile'] }),
  C({ name: 'Saltbox Tavern', biome: 'grassland', type: 'tavern', shape: 'rectangle', style: 'gable', material: 'shingle',
      pitch: 1.2, overhang: 1, hue: 30, weathering: .45, moss: .18, ridgeOrientation: 'ew',
      features: ['chimney', 'dormer'], chimneyCount: 1, dormerCount: 2, lightAngle: 240,
      pending: ['asymmetric ridge', 'hanging-lanterns'] }),
  C({ name: 'Barrel-Vault Market Hall', biome: 'desert', type: 'bazaar', shape: 'rectangle', style: 'domed', material: 'clay',
      pitch: .9, overhang: 1, hue: 12, weathering: .3, moss: .1,
      features: [], lightAngle: 235,
      pending: ['true barrel profile', 'rose skylights', 'hanging-lanterns'] }),
  C({ name: 'Stepped Ziggurat Pueblo', biome: 'desert', type: 'monument', shape: 'square', style: 'stepped', material: 'flatstone',
      pitch: 1, overhang: 0, hue: 36, weathering: .4, moss: .05, stepWidth: 2, stepRise: 1,
      features: ['walkdeck', 'garden', 'banner'], bannerHue: 20, lightAngle: 235,
      pending: ['parapet-molding'] }),
  C({ name: 'Half-Hip Cottage Inn', biome: 'forest', type: 'cottage', shape: 'L', style: 'halfHip', material: 'shingle',
      pitch: 1.2, overhang: 1, hue: 34, weathering: .35, moss: .25, ridgeOrientation: 'ew',
      features: ['dormer', 'chimney'], dormerCount: 2, chimneyCount: 1, lightAngle: 235,
      pending: ['eyebrow dormers', 'rain-gutters'] }),
  C({ name: 'Butterfly Beach Pavilion', biome: 'beach', type: 'pavilion', shape: 'rectangle', style: 'butterfly', material: 'plank',
      pitch: .7, overhang: 1, hue: 34, weathering: .45, moss: .1, ridgeOrientation: 'ew',
      features: [], lightAngle: 235,
      pending: ['central scupper', 'walkable-deck', 'hanging-lanterns'] }),
  C({ name: 'Fungal Glow Moss-Den', biome: 'swamp', type: 'moss_den', shape: 'round-tower', style: 'domed', material: 'mystic',
      pitch: .9, overhang: 1, hue: 300, weathering: .3, moss: .5,
      features: ['finial'], lightAngle: 235,
      pending: ['bioluminescent pulse', 'hanging-lanterns'] }),
  C({ name: 'Living-Bark Dryad Twin-Wing', biome: 'tropical_forest', type: 'root_hall', shape: 'twin-wing', style: 'mansard', material: 'plank',
      pitch: 1.4, overhang: 1, hue: 30, weathering: .4, moss: .6, knee: 2.5, capHeight: 4,
      features: ['walkdeck', 'garden', 'finial'], lightAngle: 235,
      pending: ['branching wood ribs', 'skylight'] }),
];

// ── real game buildings ───────────────────────────────────────────────────────
import { realBuildings } from './real-buildings.js';
// roof config `type` → game taxonomy id (almost all identical)
export const TYPE_MAP = { pavilion: 'sand_pavilion' };
// 3 real game footprints for a roof config (uses the building type the roof suits)
export function getRealBuildings(cfg, n = 3, baseSeed = 1) {
  const typeId = TYPE_MAP[cfg.type] || cfg.type;
  return realBuildings(typeId, n, baseSeed);
}

// ── live-editor param set (only knobs the engine VISIBLY honors) ──────────────
import { MATERIAL_IDS } from './roof-materials.js';
const STYLE_IDS = ['hip', 'gable', 'crossGabled', 'halfHip', 'pyramidal', 'shed', 'mansard', 'gambrel', 'flat', 'parapet', 'stepped', 'conical', 'domed', 'sawtooth', 'butterfly'];
export const EDITOR_PARAMS = [
  { name: 'style', group: 'shape', kind: 'enum', options: STYLE_IDS },
  { name: 'material', group: 'material', kind: 'enum', options: MATERIAL_IDS },
  { name: 'pitch', group: 'shape', kind: 'range', min: 0.2, max: 2.2, step: 0.05 },
  { name: 'overhang', group: 'shape', kind: 'int', min: 0, max: 3, step: 1 },
  { name: 'ridgeOrientation', group: 'shape', kind: 'enum', options: ['ew', 'ns'] },
  { name: 'sharpness', group: 'shape', kind: 'range', min: 0.6, max: 4, step: 0.1 },
  { name: 'clampHeight', group: 'style', kind: 'range', min: 0.2, max: 1.5, step: 0.05 },
  { name: 'parapetRise', group: 'style', kind: 'range', min: 0, max: 1.2, step: 0.05 },
  { name: 'stepWidth', group: 'style', kind: 'int', min: 1, max: 4, step: 1 },
  { name: 'stepRise', group: 'style', kind: 'range', min: 0.3, max: 1.5, step: 0.1 },
  { name: 'hue', group: 'material', kind: 'range', min: 0, max: 360, step: 1 },
  { name: 'weathering', group: 'material', kind: 'range', min: 0, max: 1, step: 0.05 },
  { name: 'moss', group: 'material', kind: 'range', min: 0, max: 1, step: 0.05 },
  { name: 'turretCount', group: 'features', kind: 'int', min: 0, max: 8, step: 1 },
  { name: 'buttressCount', group: 'features', kind: 'int', min: 0, max: 8, step: 1 },
  { name: 'dormerCount', group: 'features', kind: 'int', min: 0, max: 8, step: 1 },
  { name: 'chimneyCount', group: 'features', kind: 'int', min: 0, max: 6, step: 1 },
  { name: 'featureScale', group: 'features', kind: 'range', min: 0.5, max: 2, step: 0.1 },
  { name: 'lightAngle', group: 'lighting', kind: 'range', min: 0, max: 360, step: 5 },
  { name: 'ambient', group: 'lighting', kind: 'range', min: 0.15, max: 0.7, step: 0.05 },
];
export const TOGGLE_FEATURES = ['turret', 'spire', 'buttress', 'crenellation', 'walkdeck', 'garden', 'chimney', 'dormer', 'finial', 'banner'];

// Build the engine-ready draw inputs from a config (+ optional editor overrides).
export function resolveConfig(cfg, ov = {}) {
  const m = { ...cfg, ...ov };
  const sections = m.sections || (FOOTPRINTS[m.shape] || FOOTPRINTS.square)();
  const geomParams = {
    pitch: m.pitch ?? 0.9, ridgeOrientation: m.ridgeOrientation ?? 'ew',
    clampHeight: m.clampHeight ?? 0.5, parapetRise: m.parapetRise ?? 0.5,
    knee: m.knee ?? 2.5, capHeight: m.capHeight ?? 4, sharpness: m.sharpness ?? 1.4,
    stepWidth: m.stepWidth ?? 2, stepRise: m.stepRise ?? 0.7, toothWidth: m.toothWidth ?? 4,
    fascia: 0.5,
  };
  const matOpts = {};
  if (m.hue != null) matOpts.hue = m.hue;
  if (m.sat != null) matOpts.sat = m.sat;
  if (m.light != null) matOpts.light = m.light;
  matOpts.weathering = m.weathering ?? 0.25;
  matOpts.moss = m.moss ?? 0.1;
  const renderCfg = {
    background: '#11131a',
    lightAngle: m.lightAngle ?? 235, lightElev: m.lightElev ?? 52, ambient: m.ambient ?? 0.36,
    features: m.features || [],
    turretCount: m.turretCount ?? 4, buttressCount: m.buttressCount ?? 4,
    chimneyCount: m.chimneyCount ?? 1, dormerCount: m.dormerCount ?? 2,
    featureScale: m.featureScale ?? 1, bannerHue: m.bannerHue ?? 0,
    _roofHexTop: MATERIAL_HEX[m.material] || '#8a5a33',
  };
  return {
    sections,
    geom: { style: m.style, overhang: m.overhang ?? 1, overhangDroop: 0.35, params: geomParams },
    materialId: m.material, matOpts, renderCfg,
    meta: m,
  };
}
