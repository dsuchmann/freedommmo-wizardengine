// Wang tile image URL list — shared between main thread and workers.
// No DOM dependencies. Pure data.

var WANG_SUFFIX = '__v000.png';
var TRANSITIONS_BASE = '/assets/pixelab/landscape_v2/transitions/';
var WANG_VARIANTS = ['wang', 'wang_25', 'wang_50', 'wang_100'];
var WANG_VARIANT_TILE_COUNTS = { wang: 16, wang_25: 16, wang_50: 16, wang_100: 25 };

var BIOME_INTERIOR = {
  beach:         { dir: 'beach_to_river',          mask: 6 },
  desert:        { dir: 'beach_to_desert',         mask: 12 },
  grassland:     { dir: 'grassland_to_forest',     mask: 6 },
  river:         { dir: 'beach_to_river',          mask: 12 },
  swamp:         { dir: 'swamp_to_forest',         mask: 6 },
  forest:        { dir: 'grassland_to_forest',     mask: 12 },
  dense_forest:  { dir: 'forest_to_dense_forest',  mask: 12 },
  tropical_forest:{ dir: 'forest_to_tropical_forest', mask: 12 },
  taiga:         { dir: 'forest_to_taiga',         mask: 12 },
  savanna:       { dir: 'grassland_to_savanna',    mask: 12 },
  steppe:        { dir: 'grassland_to_steppe',     mask: 12 },
  tundra:        { dir: 'tundra_to_snow',          mask: 6 },
  arctic:        { dir: 'tundra_to_snow',          mask: 12 },
  hills:         { dir: 'grassland_to_hills',      mask: 12 },
  mountains:     { dir: 'hills_to_mountains',      mask: 12 },
  volcanic:      { dir: 'desert_to_volcanic',      mask: 12 },
  mystic:        { dir: 'grassland_to_mystic',     mask: 12 },
  ocean:         { dir: 'deep_ocean_to_ocean',     mask: 12 },
  deep_ocean:    { dir: 'deep_ocean_to_ocean',     mask: 6 },
  shallow_water: { dir: 'ocean_to_shallow_water',  mask: 12 },
  lake:          { dir: 'lake_to_river',           mask: 6 },
};

var BIOME_CLIFF = {
  beach: 'beach_cliff', desert: 'sand_cliff', grassland: 'grass_cliff',
  forest: 'forest_cliff', dense_forest: 'forest_cliff', tropical_forest: 'forest_cliff',
  taiga: 'snow_cliff', savanna: 'savanna_cliff', steppe: 'steppe_cliff',
  swamp: 'swamp_cliff', tundra: 'tundra_cliff', arctic: 'snow_cliff',
  hills: 'hills_cliff', mountains: 'stone_cliff', volcanic: 'volcanic_cliff',
  mystic: 'mystic_cliff', ocean: 'cliff_overlay', deep_ocean: 'cliff_overlay',
  shallow_water: 'cliff_overlay', river: 'cliff_overlay', lake: 'cliff_overlay',
};

// All 21 biomes — used to generate all possible pair URLs dynamically
var ALL_BIOMES = [
  'arctic','beach','deep_ocean','dense_forest','desert','forest','grassland',
  'hills','lake','mountains','mystic','ocean','river','savanna',
  'shallow_water','steppe','swamp','taiga','tropical_forest','tundra','volcanic'
];

export { WANG_SUFFIX, TRANSITIONS_BASE, BIOME_INTERIOR, BIOME_CLIFF, ALL_BIOMES, WANG_VARIANTS, WANG_VARIANT_TILE_COUNTS };

// Build the complete URL list for all wang tile images.
// Generates URLs for all 21×20 directed pairs × all variants.
// Workers preload these — missing files just 404 silently.
export function getAllWangImageURLs() {
  var urls = [];
  var seenDirs = new Set();

  // All 210 unordered pairs (A < B) for s0.0 (wang/)
  for (var i = 0; i < ALL_BIOMES.length; i++) {
    for (var j = i + 1; j < ALL_BIOMES.length; j++) {
      var dir = ALL_BIOMES[i] + '_to_' + ALL_BIOMES[j];
      for (var m = 0; m < 16; m++) {
        urls.push(TRANSITIONS_BASE + dir + '/wang/' + dir + '__wang_' + m + WANG_SUFFIX);
      }
      seenDirs.add(dir);
    }
  }

  // All 420 directed pairs for s0.25, s0.5, s1.0
  for (var ai = 0; ai < ALL_BIOMES.length; ai++) {
    for (var bi = 0; bi < ALL_BIOMES.length; bi++) {
      if (ai === bi) continue;
      var ddir = ALL_BIOMES[ai] + '_to_' + ALL_BIOMES[bi];
      var elevVariants = ['wang_25', 'wang_50', 'wang_100'];
      for (var vi = 0; vi < elevVariants.length; vi++) {
        var variant = elevVariants[vi];
        var tileCount = WANG_VARIANT_TILE_COUNTS[variant];
        for (var em = 0; em < tileCount; em++) {
          urls.push(TRANSITIONS_BASE + ddir + '/' + variant + '/' + ddir + '__wang_' + em + WANG_SUFFIX);
        }
      }
    }
  }

  // Cliff overlays (only wang/)
  var cliffSeen = {};
  for (var bk in BIOME_CLIFF) {
    var cd = BIOME_CLIFF[bk];
    if (cliffSeen[cd]) continue;
    cliffSeen[cd] = true;
    for (var cm = 0; cm < 16; cm++) {
      urls.push(TRANSITIONS_BASE + cd + '/wang/' + cd + '__wang_' + cm + WANG_SUFFIX);
    }
  }
  return urls;
}
