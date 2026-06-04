// Wang tile image URL list — shared between main thread and workers.
// No DOM dependencies. Pure data.

var WANG_SUFFIX = '__v000.png';
var TRANSITIONS_BASE = 'assets/pixelab/landscape_v2/transitions/';

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

export { WANG_SUFFIX, TRANSITIONS_BASE, BIOME_INTERIOR, BIOME_CLIFF, EXTRA_TRANSITION_DIRS };

// Build the complete URL list for all wang tile images
export function getAllWangImageURLs() {
  var urls = [];
  var seenDirs = new Set();
  for (var b in BIOME_INTERIOR) {
    var ie = BIOME_INTERIOR[b];
    if (seenDirs.has(ie.dir)) continue;
    seenDirs.add(ie.dir);
    for (var pm = 0; pm < 16; pm++) {
      urls.push(TRANSITIONS_BASE + ie.dir + '/wang/' + ie.dir + '__wang_' + pm + WANG_SUFFIX);
    }
  }
  for (var ei = 0; ei < EXTRA_TRANSITION_DIRS.length; ei++) {
    var ed = EXTRA_TRANSITION_DIRS[ei];
    if (seenDirs.has(ed)) continue;
    seenDirs.add(ed);
    for (var em = 0; em < 16; em++) {
      urls.push(TRANSITIONS_BASE + ed + '/wang/' + ed + '__wang_' + em + WANG_SUFFIX);
    }
  }
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
