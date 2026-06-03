import { smoothNoise, fbm, getWorldSeed } from '../core/random.js';

// Domain-warped ridge noise — creates sharp ridge lines and valleys.
// Returns value in [0,1] where 0.5 = flat, >0.5 = ridge, <0.5 = valley.
function ridgeNoise(x, y, scale, salt, seed) {
  // Sample two smooth noise layers offset by 90 degrees
  const n1 = fbm(x, y, salt, seed, scale, 3);
  const n2 = fbm(x + 300, y + 300, salt + 100, seed, scale, 3);
  // Ridge = 1 - |2n-1| (sharp peaks at n=0.5)
  const ridge = 1 - Math.abs(n1 * 2 - 1);
  const valley = 1 - Math.abs(n2 * 2 - 1);
  // Blend ridge and valley for varied terrain
  return ridge * 0.6 + valley * 0.4;
}

// Domain warp — distorts coordinates through noise for organic shapes
function warpX(x, y, seed, strength = 40) {
  return x + smoothNoise(x, y, 300, 500, seed) * strength - strength * 0.5;
}
function warpY(x, y, seed, strength = 40) {
  return y + smoothNoise(x + 700, y + 700, 300, 600, seed) * strength - strength * 0.5;
}

// Terrain shaper — takes raw 0-1 elevation and remaps it into dramatic landforms.
// Returns { elevation: 0-1, ridgeStrength: 0-1, isPeak: 0-1, valleyDepth: 0-1 }
export function shapeTerrain(wx, wy, rawElevation) {
  const seed = getWorldSeed();

  // Warp coordinates for organic shapes (Grand Canyon finger-lake style)
  const wxW = warpX(wx, wy, seed, 60);
  const wyW = warpY(wx, wy, seed, 60);

  // Ridge network at medium scale
  const ridge = ridgeNoise(wxW, wyW, 220, 700, seed);

  // Large-scale mountain ridges
  const mountainRidge = ridgeNoise(wxW, wyW, 500, 800, seed);

  // Micro-detail for texture within plateaus
  const micro = fbm(wx, wy, 500, seed, 60, 4);

  // Combine: base elevation defines overall height, ridges create structure
  // rawElevation: 0-1 continental scale
  // ridge: 0-1 ridge network (peaked at 1)
  // mountainRidge: 0-1 large ridges

  let shaped;

  if (rawElevation < 0.35) {
    // Lowlands / water — keep mostly flat with subtle valleys
    shaped = rawElevation * 0.8 + ridge * 0.15 - micro * 0.05;
  } else if (rawElevation < 0.55) {
    // Mid-elevation — interleaved plateaus and valleys
    // Ridge adds structure: where ridge > 0.6, push up into plateau; where < 0.4, cut valley
    const plateauPush = Math.max(0, (ridge - 0.55) * 2.0) * 0.25;
    const valleyCut = Math.max(0, (0.45 - ridge) * 2.0) * 0.15;
    shaped = rawElevation + plateauPush - valleyCut + micro * 0.03;
  } else if (rawElevation < 0.75) {
    // Highland — dramatic ridges and peaks
    const ridgeBoost = ridge * 0.20;
    const mountainBoost = mountainRidge * 0.15;
    shaped = rawElevation + ridgeBoost + mountainBoost + micro * 0.02;
  } else {
    // Mountain peaks — stack high with concentrated spires
    const peakConcentration = Math.pow(mountainRidge, 3) * 0.30;
    const spire = Math.pow(ridge, 2) * 0.15;
    shaped = rawElevation + peakConcentration + spire;
  }

  // Clamp and compute additional metrics
  shaped = Math.max(0, Math.min(1, shaped));
  const ridgeStrength = ridge;
  const isPeak = (shaped > 0.75 && mountainRidge > 0.7) ? (shaped - 0.75) * 4 : 0;
  const valleyDepth = (shaped < 0.45 && ridge < 0.35) ? (0.45 - shaped) * 3 : 0;

  return {
    elevation: shaped,
    ridgeStrength: ridgeStrength,
    isPeak: Math.min(1, isPeak),
    valleyDepth: Math.min(1, valleyDepth),
  };
}

// Increased cliff levels for finer vertical resolution (0-9 = 10 levels)
export function cliffLevel(elevation) {
  return Math.min(9, Math.floor(elevation * 10));
}
