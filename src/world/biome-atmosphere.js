// Per-biome atmosphere configs — authored by the user in the brainstorm tuner
// (docs/superpowers/specs/2026-06-10-biome-atmosphere-tuning.json). Sliders:
// hue ±60°, sat/con/bri percent (100 = neutral), warm/fog/shadow/night 0-100.
// Mood = grading personality (tone curve + screen-space overlays in shader).

export var MOOD_IDS = ['filmic', 'painterly', 'muted', 'chiaroscuro'];

export var BIOME_ATMOSPHERE = {
  grassland:       { mood: 'filmic',      hue: 1,   sat: 115, con: 111, bri: 110, warm: 88,  fog: 0,  shadow: 50, night: 1 },
  forest:          { mood: 'filmic',      hue: 0,   sat: 99,  con: 122, bri: 111, warm: 0,   fog: 0,  shadow: 62, night: 6 },
  dense_forest:    { mood: 'muted',       hue: -13, sat: 140, con: 112, bri: 90,  warm: 0,   fog: 2,  shadow: 50, night: 25 },
  tropical_forest: { mood: 'filmic',      hue: 2,   sat: 95,  con: 131, bri: 103, warm: 57,  fog: 13, shadow: 50, night: 12 },
  taiga:           { mood: 'muted',       hue: 10,  sat: 100, con: 126, bri: 107, warm: 100, fog: 0,  shadow: 50, night: 20 },
  swamp:           { mood: 'chiaroscuro', hue: 1,   sat: 83,  con: 119, bri: 99,  warm: 0,   fog: 25, shadow: 53, night: 12 },
  steppe:          { mood: 'muted',       hue: -6,  sat: 104, con: 112, bri: 102, warm: 26,  fog: 10, shadow: 49, night: 5 },
  savanna:         { mood: 'muted',       hue: -2,  sat: 91,  con: 122, bri: 103, warm: 100, fog: 31, shadow: 50, night: 6 },
  desert:          { mood: 'filmic',      hue: -6,  sat: 68,  con: 101, bri: 109, warm: 100, fog: 0,  shadow: 50, night: 0 },
  beach:           { mood: 'filmic',      hue: 1,   sat: 86,  con: 91,  bri: 108, warm: 34,  fog: 32, shadow: 50, night: 0 },
  hills:           { mood: 'chiaroscuro', hue: -15, sat: 101, con: 109, bri: 112, warm: 6,   fog: 27, shadow: 41, night: 5 },
  mountains:       { mood: 'muted',       hue: -6,  sat: 110, con: 119, bri: 110, warm: 81,  fog: 0,  shadow: 50, night: 25 },
  tundra:          { mood: 'chiaroscuro', hue: 8,   sat: 117, con: 98,  bri: 103, warm: 0,   fog: 40, shadow: 50, night: 8 },
  arctic:          { mood: 'painterly',   hue: -6,  sat: 77,  con: 109, bri: 96,  warm: 0,   fog: 11, shadow: 50, night: 3 },
  volcanic:        { mood: 'chiaroscuro', hue: -1,  sat: 109, con: 114, bri: 106, warm: 100, fog: 9,  shadow: 47, night: 21 },
  mystic:          { mood: 'chiaroscuro', hue: 0,   sat: 89,  con: 127, bri: 107, warm: 0,   fog: 4,  shadow: 50, night: 11 },
  river:           { mood: 'filmic',      hue: 1,   sat: 113, con: 117, bri: 100, warm: 0,   fog: 23, shadow: 58, night: 13 },
  lake:            { mood: 'filmic',      hue: -2,  sat: 124, con: 107, bri: 105, warm: 0,   fog: 3,  shadow: 50, night: 2 },
  shallow_water:   { mood: 'filmic',      hue: 4,   sat: 103, con: 109, bri: 99,  warm: 31,  fog: 0,  shadow: 51, night: 17 },
  ocean:           { mood: 'chiaroscuro', hue: 2,   sat: 112, con: 113, bri: 110, warm: 44,  fog: 0,  shadow: 49, night: 3 },
  deep_ocean:      { mood: 'chiaroscuro', hue: 2,   sat: 99,  con: 112, bri: 130, warm: 0,   fog: 2,  shadow: 50, night: 53 },
};

var DEFAULT_ATMO = { mood: 'painterly', hue: 0, sat: 100, con: 105, bri: 100, warm: 30, fog: 15, shadow: 50, night: 25 };

export function getAtmosphere(biomeId) {
  return BIOME_ATMOSPHERE[biomeId] || DEFAULT_ATMO;
}

// Pack one biome's config into three parallel RGBA byte quads at offset o.
// A: hue (128 = 0°, full range ±60°), sat, con, bri (0..255 = 0..200%)
// B: warm, fog, shadow, night (0..255 = slider 0..100)
// C: mood one-hot (bilinear filtering blends these into smooth mood weights)
export function packAtmosphere(cfg, outA, outB, outC, o) {
  outA[o]     = Math.round((cfg.hue + 60) / 120 * 255);
  outA[o + 1] = Math.round(cfg.sat / 200 * 255);
  outA[o + 2] = Math.round(cfg.con / 200 * 255);
  outA[o + 3] = Math.round(cfg.bri / 200 * 255);
  outB[o]     = Math.round(cfg.warm * 2.55);
  outB[o + 1] = Math.round(cfg.fog * 2.55);
  outB[o + 2] = Math.round(cfg.shadow * 2.55);
  outB[o + 3] = Math.round(cfg.night * 2.55);
  var mi = MOOD_IDS.indexOf(cfg.mood);
  if (mi < 0) mi = 1;
  outC[o]     = mi === 0 ? 255 : 0;
  outC[o + 1] = mi === 1 ? 255 : 0;
  outC[o + 2] = mi === 2 ? 255 : 0;
  outC[o + 3] = mi === 3 ? 255 : 0;
}
