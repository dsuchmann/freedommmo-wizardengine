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

var EXTRA_TRANSITION_DIRS = [
  'beach_to_desert','beach_to_grassland','beach_to_forest','beach_to_hills',
  'dense_forest_to_mystic','dense_forest_to_tropical_forest',
  'desert_to_hills','desert_to_savanna',
  'forest_to_dense_forest','forest_to_hills',
  'forest_to_mystic','forest_to_savanna','forest_to_taiga','forest_to_tropical_forest',
  'grassland_to_desert','grassland_to_forest','grassland_to_hills','grassland_to_mystic',
  'grassland_to_savanna','grassland_to_steppe','grassland_to_taiga',
  'hills_to_mountains','hills_to_volcanic',
  'lake_to_forest','lake_to_grassland','lake_to_river','lake_to_shallow_water','lake_to_swamp',
  'mountains_to_snow','mountains_to_volcanic',
  'ocean_to_beach','ocean_to_shallow_water',
  'river_to_forest','river_to_grassland','river_to_hills','river_to_swamp',
  'savanna_to_hills','savanna_to_steppe',
  'shallow_water_to_beach','shallow_water_to_river','shallow_water_to_swamp',
  'steppe_to_desert','steppe_to_hills',
  'swamp_to_beach','swamp_to_dense_forest','swamp_to_forest','swamp_to_grass',
  'swamp_to_taiga','swamp_to_tropical_forest',
  'taiga_to_hills','taiga_to_mountains',
  'tropical_forest_to_mystic',
  'tundra_to_hills','tundra_to_mountains','tundra_to_snow','tundra_to_steppe','tundra_to_taiga'
];

export { WANG_SUFFIX, TRANSITIONS_BASE, BIOME_INTERIOR, BIOME_CLIFF, EXTRA_TRANSITION_DIRS, WANG_VARIANTS, WANG_VARIANT_TILE_COUNTS };

// Build the complete URL list for all wang tile images
export function getAllWangImageURLs() {
  var urls = [];
  var seenDirs = new Set();

  // Collect all transition directories
  for (var b in BIOME_INTERIOR) {
    var ie = BIOME_INTERIOR[b];
    seenDirs.add(ie.dir);
  }
  for (var ei = 0; ei < EXTRA_TRANSITION_DIRS.length; ei++) {
    seenDirs.add(EXTRA_TRANSITION_DIRS[ei]);
  }

  // For each transition dir, generate URLs for all variants that exist on disk
  seenDirs.forEach(function(dir) {
    for (var vi = 0; vi < WANG_VARIANTS.length; vi++) {
      var variant = WANG_VARIANTS[vi];
      var tileCount = WANG_VARIANT_TILE_COUNTS[variant];
      for (var m = 0; m < tileCount; m++) {
        urls.push(TRANSITIONS_BASE + dir + '/' + variant + '/' + dir + '__wang_' + m + WANG_SUFFIX);
      }
    }
  });

  // Cliff overlays (only wang/ — cliffs don't have elevation variants)
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
