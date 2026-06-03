import { rand2, smoothNoise } from '../core/random.js';

var SURFACE_BASE = 'assets/pixelab/landscape_v2/surface_overlays/';
var _decalCache = {};

function preloadDecal(src) {
  if (_decalCache[src]) return;
  var img = new Image();
  img.src = src;
  _decalCache[src] = img;
}

// Biome → decal directory mapping for surface detail overlays
var BIOME_DECAL_DIR = {
  forest:        'forest_detail',
  dense_forest:  'dense_forest_detail',
  tropical_forest:'dense_forest_detail',
  grassland:     'grassland_detail',
  savanna:       'savanna_detail',
  steppe:        'steppe_detail',
  swamp:         'swamp_detail',
  taiga:         'taiga_detail',
  tundra:        'tundra_detail',
  arctic:        'arctic_detail',
  hills:         'hills_detail',
  mountains:     'mountains_detail',
  beach:         'beach_detail',
  desert:        'desert_detail',
  volcanic:      'volcanic_detail',
  mystic:        'mystic_detail',
  ocean:         'deep_ocean_detail',
  deep_ocean:    'deep_ocean_detail',
  shallow_water: 'lake_detail',
  river:         'lake_detail',
  lake:          'lake_detail',
};

// Preload all decals for all biomes
var _preloadedDirs = {};
for (var db in BIOME_DECAL_DIR) {
  var dd = BIOME_DECAL_DIR[db];
  if (_preloadedDirs[dd]) continue;
  _preloadedDirs[dd] = true;
  for (var dv = 0; dv < 16; dv++) {
    var vstr = 'v' + String(dv).padStart(3, '0');
    preloadDecal(SURFACE_BASE + dd + '/decals/' + dd + '__overlay__' + vstr + '.png');
  }
}

// Decal tier assignments per biome. TierA = anchor/dense, TierB = fill, TierC = scatter
var DECAL_TIERS = {
  // Tier A: prominent anchor decals (v002,v009,v015)
  anchor:   [2,9,15],
  // Tier B: fill texture decals (v000,v004,v006,v008,v010,v012)
  fill:     [0,4,6,8,10,12],
  // Tier C: sparse scatter (v001,v005,v007,v011,v013,v014)
  scatter:  [1,5,7,11,13,14],
};

// Get decal variant path for a biome and variant index
function decalSrc(biome, variant) {
  var dd = BIOME_DECAL_DIR[biome];
  if (!dd) return null;
  var vstr = 'v' + String(variant).padStart(3, '0');
  return SURFACE_BASE + dd + '/decals/' + dd + '__overlay__' + vstr + '.png';
}

export function paintSurfaceDecals(ctx, tile, sx, sy, size, sun) {
  var biome = tile.biome;
  var dd = BIOME_DECAL_DIR[biome];
  if (!dd) return;

  var wx = tile.wx, wy = tile.wy;

  // Skip on cliff edges (already have cliff overlay drawn)
  if (tile._isCliffEdge) return;

  // === Density determination ===
  // Base density from vegetation data in microLayers
  var vegetation = 0.5;
  if (tile.stack && tile.stack.microLayers) {
    vegetation = tile.stack.microLayers.vegetationDensity || 0.5;
  } else {
    // Fallback: estimate from biome and moisture
    var moist = tile.climate.moisture || 0.5;
    var bio = tile.biome;
    if (bio === 'forest' || bio === 'dense_forest' || bio === 'tropical_forest' || bio === 'swamp') vegetation = 0.7 + moist * 0.3;
    else if (bio === 'desert' || bio === 'beach' || bio === 'volcanic') vegetation = 0.2;
    else if (bio === 'tundra' || bio === 'arctic' || bio === 'mountains') vegetation = 0.3;
    else vegetation = 0.4 + moist * 0.4;
  }
  var densityBase = Math.min(1, vegetation * 1.2 + 0.15);

  // Elevation: higher = sparser, valleys = denser
  var el = tile.climate.elevation;
  if (el > 0.65) densityBase *= 0.6;
  else if (el < 0.40) densityBase *= 1.3;

  // Use noise for spatial coherence (creates "zones" of density)
  var zoneNoise = smoothNoise(wx, wy, 300, 900);
  var density = densityBase * (0.6 + zoneNoise * 0.8);

  // === Decal stacking ===
  // These decals are OPAQUE tiles (no alpha transparency in the PNGs).
  // We use 'overlay' blend mode at low alpha so they add texture detail
  // to the Wang base without replacing it with a dark background.
  // Only 1 decal per tile to avoid over-darkening.
  var layers = [];
  var hash0 = rand2(wx, wy, 400);

  // Pick one decal from the appropriate tier based on density.
  // Decals are opaque PNGs — use soft-light blend to add texture detail
  // without replacing the Wang tile. Alpha controls how much detail shows.
  if (density > 0.45 && hash0 > 0.50) {
    // High density: anchor decal (Tier A) — prominent detail
    var anchorIdx = Math.floor(rand2(wx, wy, 403) * DECAL_TIERS.anchor.length);
    layers.push({
      variant: DECAL_TIERS.anchor[anchorIdx],
      alpha: 0.35 + rand2(wx, wy, 404) * 0.25,
      blend: 'soft-light',
      tier: 'anchor'
    });
  } else if (density > 0.25) {
    // Medium density: fill decal (Tier B) — general texture
    var fillIdx = Math.floor(rand2(wx, wy, 401) * DECAL_TIERS.fill.length);
    layers.push({
      variant: DECAL_TIERS.fill[fillIdx],
      alpha: 0.25 + rand2(wx, wy, 402) * 0.20,
      blend: 'soft-light',
      tier: 'fill'
    });
  } else if (density > 0.10 && rand2(wx, wy, 405) > 0.50) {
    // Low density: scatter decal (Tier C) — subtle hint
    var scatterIdx = Math.floor(rand2(wx, wy, 406) * DECAL_TIERS.scatter.length);
    layers.push({
      variant: DECAL_TIERS.scatter[scatterIdx],
      alpha: 0.18 + rand2(wx, wy, 407) * 0.15,
      blend: 'soft-light',
      tier: 'scatter'
    });
  }

  // === Draw each layer ===
  for (var li = 0; li < layers.length; li++) {
    var layer = layers[li];
    var src = decalSrc(biome, layer.variant);
    if (!src) continue;
    var img = _decalCache[src];
    if (!img || !img.complete || !img.naturalWidth) continue;

    ctx.save();

    // Sub-tile offset (±4px jitter) to break grid alignment
    var ox = (rand2(wx, wy, 500 + li * 3) - 0.5) * 8;
    var oy = (rand2(wx, wy, 501 + li * 3) - 0.5) * 8;

    // Random rotation/flip for variation
    var rot = Math.floor(rand2(wx, wy, 502 + li * 3) * 4) * Math.PI / 2;
    var flip = rand2(wx, wy, 503 + li * 3) > 0.5;

    ctx.translate(sx + size/2 + ox, sy + size/2 + oy);
    ctx.rotate(rot);
    if (flip) ctx.scale(-1, 1);

    ctx.globalAlpha = layer.alpha;
    ctx.globalCompositeOperation = layer.blend;

    ctx.drawImage(img, 0, 0, 32, 32, -size/2, -size/2, size, size);

    ctx.restore();
  }
}
