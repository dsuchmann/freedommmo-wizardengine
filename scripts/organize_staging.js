#!/usr/bin/env node
/**
 * Organize PixelLab review staging files into final asset paths.
 *
 * Usage: node scripts/organize_staging.js <mapping_file.json>
 *
 * The mapping file should be a JSON array of:
 *   { id: string, description: string, size: string, frameCount: number, frameIndices: number[] }
 *
 * This script:
 * 1. Reads the mapping file
 * 2. Parses each description to determine field/biome/object
 * 3. Copies frame files from staging to the correct final path
 * 4. Reports results
 */

const fs = require('fs');
const path = require('path');

const PROJECT = 'C:/Users/daves/AppData/Roaming/wizardgenie/projects/default';
const STAGING = path.join(PROJECT, 'assets/pixelab/landscape_v2/micro/_review_staging');
const MICRO = path.join(PROJECT, 'assets/pixelab/landscape_v2/micro');

// --- Description parsing ---

// Field 2: Small Flora (32x32, "small ground flora sprite")
// Field 3: Small Scatter (32x32, "small debris sprite" or water scatter)
// Field 4: Medium Flora (32x32, "medium flora sprite")
// Field 5: Medium Objects (48x48, "medium terrain object")
// Field 6: Large Objects (64x64, large things like trees)
// Water biomes have special descriptions

// Complete object->biome mappings from the master plan
const FIELD2_OBJECTS = {
  // forest
  'grass_blade_cluster': 'forest', 'small_fern': 'forest', 'clover_bloom': 'forest',
  // dense_forest
  'shade_fern': 'dense_forest', 'bracket_fungus': 'dense_forest', 'dark_herb': 'dense_forest',
  // tropical_forest
  'broad_fern': 'tropical_forest', 'orchid_sprout': 'tropical_forest', 'vine_tendril': 'tropical_forest',
  // taiga
  'frost_grass': 'taiga', 'low_juniper': 'taiga', 'cold_moss_tuft': 'taiga',
  // grassland
  'tall_grass_blade': 'grassland', 'dandelion_stem': 'grassland', 'wild_herb': 'grassland',
  // savanna
  'dry_grass_spike': 'savanna', 'thorn_sprout': 'savanna', 'acacia_seedling': 'savanna',
  // steppe
  'wind_grass': 'steppe', 'sparse_weed': 'steppe', 'dry_tuft': 'steppe',
  // desert
  'sand_grass': 'desert', 'desert_thorn': 'desert',
  // beach
  'dune_grass': 'beach', 'sea_oat': 'beach', 'beach_weed': 'beach',
  // swamp
  'cattail_base': 'swamp', 'bog_grass': 'swamp', 'swamp_herb': 'swamp',
  // hills
  'hillside_grass': 'hills', 'rock_flower_bud': 'hills', 'heather_sprig': 'hills',
  // mountains
  'alpine_tuft': 'mountains', 'rock_cress': 'mountains', 'hardy_lichen': 'mountains',
  // volcanic
  'heat_sprout': 'volcanic', 'ash_grass': 'volcanic',
  // tundra
  'tundra_grass': 'tundra', 'low_berry_bush': 'tundra', 'ice_moss': 'tundra',
  // arctic
  'frost_flower': 'arctic', 'ice_needle': 'arctic',
  // mystic
  'glow_grass_blade': 'mystic', 'aether_fern': 'mystic', 'crystal_sprout': 'mystic',
};

const FIELD3_OBJECTS = {
  // forest
  'twig_bundle': 'forest', 'acorn_cluster': 'forest', 'bark_shard': 'forest', 'small_stone': 'forest',
  // dense_forest
  'rotting_branch': 'dense_forest', 'mushroom_cluster': 'dense_forest', 'fallen_pinecone': 'dense_forest', 'moss_stone': 'dense_forest',
  // tropical_forest
  'seed_pod': 'tropical_forest', 'beetle_shell': 'tropical_forest', 'palm_nut': 'tropical_forest', 'vine_cutting': 'tropical_forest',
  // taiga
  'pine_cone': 'taiga', 'frozen_twig': 'taiga', 'resin_drop': 'taiga', 'ice_pebble': 'taiga',
  // grassland
  'field_stone': 'grassland', 'dried_flower': 'grassland', 'seed_head': 'grassland', 'snail_shell': 'grassland',
  // savanna
  'dry_bone': 'savanna', 'cracked_pod': 'savanna', 'bleached_stick': 'savanna', 'termite_chip': 'savanna',
  // steppe
  'wind_pebble': 'steppe', 'grass_ball': 'steppe', 'small_skull': 'steppe', 'dust_clod': 'steppe',
  // desert
  'bleached_bone': 'desert', 'polished_stone': 'desert', 'scorpion_shell': 'desert', 'dried_seed': 'desert',
  // beach
  'seashell': 'beach', 'sea_glass': 'beach', 'driftwood_chip': 'beach', 'coral_fragment': 'beach',
  // swamp
  'rotting_stick': 'swamp', 'frog_eggs': 'swamp', 'leech': 'swamp', 'bog_iron': 'swamp',
  // hills
  'limestone_chip': 'hills', 'quartz_pebble': 'hills', 'slate_fragment': 'hills', 'iron_nugget': 'hills',
  // mountains
  'rock_shard': 'mountains', 'ice_chunk': 'mountains', 'crystal_fragment': 'mountains', 'ore_glint': 'mountains',
  // volcanic
  'obsidian_shard': 'volcanic', 'sulfur_crystal': 'volcanic', 'charred_bone': 'volcanic', 'lava_pebble': 'volcanic',
  // tundra
  'frozen_pebble': 'tundra', 'ice_shard': 'tundra', 'lichen_rock': 'tundra', 'fossil_fragment': 'tundra',
  // arctic
  'snow_clump': 'arctic', 'ice_crystal_cluster': 'arctic', 'frozen_shell': 'arctic', 'frost_stone': 'arctic',
  // mystic
  'aether_crystal': 'mystic', 'rune_shard': 'mystic', 'glowing_pebble': 'mystic', 'stardust_cluster': 'mystic',
};

const FIELD4_OBJECTS = {
  // forest
  'wildflower_cluster': 'forest', 'forest_mushroom': 'forest', 'wood_sorrel': 'forest',
  // dense_forest
  'ghost_orchid': 'dense_forest', 'giant_mushroom': 'dense_forest', 'shelf_fungus': 'dense_forest',
  // tropical_forest
  'bird_of_paradise': 'tropical_forest', 'passion_flower': 'tropical_forest', 'heliconia': 'tropical_forest',
  // taiga
  'fireweed': 'taiga', 'arctic_poppy': 'taiga', 'wintergreen': 'taiga',
  // grassland
  'daisy_cluster': 'grassland', 'cornflower': 'grassland', 'wild_lavender': 'grassland',
  // savanna
  'flame_lily': 'savanna', 'desert_rose': 'savanna', 'aloe_rosette': 'savanna',
  // steppe
  'sage_brush': 'steppe', 'thistle': 'steppe', 'yarrow': 'steppe',
  // desert
  'prickly_pear_bloom': 'desert', 'desert_marigold': 'desert', 'sand_verbena': 'desert',
  // beach
  'sea_holly': 'beach', 'beach_morning_glory': 'beach', 'dune_daisy': 'beach',
  // swamp
  'water_lily': 'swamp', 'swamp_iris': 'swamp', 'pitcher_plant': 'swamp',
  // hills
  'mountain_bluebell': 'hills', 'rock_rose': 'hills', 'thyme_bush': 'hills',
  // mountains
  'edelweiss': 'mountains', 'alpine_gentian': 'mountains', 'snow_flower': 'mountains',
  // volcanic
  'fire_flower': 'volcanic', 'ash_bloom': 'volcanic', 'sulfur_rose': 'volcanic',
  // tundra
  'arctic_poppy_t': 'tundra', 'moss_campion': 'tundra', 'tundra_rose': 'tundra',
  // arctic
  'ice_flower': 'arctic', 'frost_bloom': 'arctic', 'crystal_rose': 'arctic',
  // mystic
  'aether_bloom': 'mystic', 'starlight_orchid': 'mystic', 'moonpetal': 'mystic',
};

const FIELD5_OBJECTS = {
  // forest
  'mossy_boulder': 'forest', 'tree_stump': 'forest', 'fallen_log': 'forest',
  // dense_forest
  'hollow_stump': 'dense_forest', 'rotting_log': 'dense_forest', 'root_mound': 'dense_forest',
  // tropical_forest
  'jungle_rock': 'tropical_forest', 'buttress_root': 'tropical_forest', 'vine_log': 'tropical_forest',
  // taiga
  'snow_rock': 'taiga', 'frost_stump': 'taiga', 'ice_log': 'taiga',
  // grassland
  'field_boulder': 'grassland', 'hay_bale': 'grassland', 'fence_post': 'grassland',
  // savanna
  'termite_mound': 'savanna', 'bone_pile': 'savanna', 'dry_well': 'savanna',
  // steppe
  'wind_rock': 'steppe', 'stone_cairn': 'steppe', 'buried_post': 'steppe',
  // desert
  'sandstone_formation': 'desert', 'bleached_skull': 'desert', 'clay_pot_shard': 'desert',
  // beach
  'tide_pool_rock': 'beach', 'beached_log': 'beach', 'anchor_relic': 'beach',
  // swamp
  'bog_log': 'swamp', 'mud_mound': 'swamp', 'rotting_dock': 'swamp',
  // hills
  'granite_outcrop': 'hills', 'stone_pile': 'hills', 'old_milestone': 'hills',
  // mountains
  'ice_boulder': 'mountains', 'frozen_cairn': 'mountains', 'cliff_fragment': 'mountains',
  // volcanic
  'obsidian_pillar': 'volcanic', 'lava_rock': 'volcanic', 'basalt_column': 'volcanic',
  // tundra
  'permafrost_mound': 'tundra', 'ice_boulder_t': 'tundra', 'frozen_bones': 'tundra',
  // arctic
  'ice_formation': 'arctic', 'snow_drift_mound': 'arctic', 'frozen_ruin': 'arctic',
  // mystic
  'rune_stone': 'mystic', 'crystal_cluster': 'mystic', 'ancient_altar': 'mystic',
};

const FIELD6_OBJECTS = {
  // forest
  'oak': 'forest', 'birch': 'forest', 'maple': 'forest',
  // dense_forest
  'ancient_oak': 'dense_forest', 'gnarled_elm': 'dense_forest', 'strangler_fig': 'dense_forest',
  // tropical_forest
  'coconut_palm': 'tropical_forest', 'jungle_tree': 'tropical_forest', 'banyan': 'tropical_forest',
  // taiga
  'spruce': 'taiga', 'snow_pine': 'taiga', 'frost_cedar': 'taiga',
  // grassland
  'meadow_oak': 'grassland', 'cherry_blossom': 'grassland', 'apple_tree': 'grassland',
  // savanna
  'acacia': 'savanna', 'baobab': 'savanna', 'thorny_acacia': 'savanna',
  // steppe
  'twisted_shrub': 'steppe', 'dead_tree': 'steppe', 'stone_monolith': 'steppe',
  // desert
  'date_palm': 'desert', 'saguaro': 'desert', 'sandstone_arch': 'desert',
  // beach
  'beach_palm': 'beach', 'coastal_pine': 'beach', 'driftwood': 'beach',
  // swamp
  'cypress': 'swamp', 'dead_willow': 'swamp', 'mangrove': 'swamp',
  // hills
  'scots_pine': 'hills', 'rowan': 'hills', 'standing_stone': 'hills',
  // mountains
  'cliff_pine': 'mountains', 'mountain_ash': 'mountains', 'rock_spire': 'mountains',
  // volcanic
  'charred_tree': 'volcanic', 'obsidian_spike': 'volcanic', 'magma_vent': 'volcanic',
  // tundra
  'frost_willow': 'tundra', 'ice_pillar': 'tundra', 'stunted_pine': 'tundra',
  // arctic
  'ice_crystal_spire': 'arctic', 'frozen_tree': 'arctic', 'crystal_ice_tower': 'arctic',
  // mystic
  'spirit_tree': 'mystic', 'crystal_tree': 'mystic', 'aether_pillar': 'mystic',
};

// Water biome objects for various fields
const WATER_OBJECTS = {
  // These are small_scatter (Field 3) for water biomes
  'floating_debris': 'ocean', 'driftwood': 'ocean',
  'foam_patch': 'river', 'river_foam': 'river',
  'light_dapple': 'lake', 'water_ripple': 'lake',
  'sand_shimmer': 'shallow_water',
  'bioluminescent': 'deep_ocean',
  'ocean_foam': 'ocean',
  'pale_bioluminescence': 'deep_ocean',
  'underwater_sparkle': 'deep_ocean',
};

// Description keyword to object_name mapping
// We need to match the end of the description to an object name
function parseDescription(desc, size) {
  const d = desc.toLowerCase();

  // Determine field from description keywords and size
  let field = null;
  let fieldPrefix = '';
  let fieldDir = '';

  if (d.includes('small ground flora sprite') || d.includes('small flora sprite')) {
    field = 2; fieldPrefix = 'sf'; fieldDir = 'small_flora';
  } else if (d.includes('small debris sprite') || d.includes('small scatter')) {
    field = 3; fieldPrefix = 'ss'; fieldDir = 'small_scatter';
  } else if (d.includes('medium flora sprite')) {
    field = 4; fieldPrefix = 'mf'; fieldDir = 'medium_flora';
  } else if (d.includes('medium terrain object')) {
    field = 5; fieldPrefix = 'mo'; fieldDir = 'medium_objects';
  } else if (size === '64x64' || size === '1dir 64x64') {
    field = 6; fieldPrefix = 'lg'; fieldDir = 'large_objects';
  } else if (size === '48x48' || size === '1dir 48x48') {
    field = 5; fieldPrefix = 'mo'; fieldDir = 'medium_objects';
  }

  // For water biome descriptions (no standard field keyword)
  if (!field) {
    // Water biome scatter objects
    if (d.includes('ocean') || d.includes('water') || d.includes('lake') ||
        d.includes('river') || d.includes('shallow') || d.includes('deep')) {
      if (size === '32x32' || size === '1dir 32x32') {
        field = 3; fieldPrefix = 'ss'; fieldDir = 'small_scatter';
      }
    }
  }

  if (!field) {
    // Default: guess from size
    if (size === '32x32' || size === '1dir 32x32') {
      field = 2; fieldPrefix = 'sf'; fieldDir = 'small_flora';
    } else if (size === '48x48' || size === '1dir 48x48') {
      field = 5; fieldPrefix = 'mo'; fieldDir = 'medium_objects';
    } else if (size === '64x64' || size === '1dir 64x64') {
      field = 6; fieldPrefix = 'lg'; fieldDir = 'large_objects';
    }
  }

  // Now determine biome and object name from description
  // Strip common prefixes
  let cleanDesc = d
    .replace(/^top-down (high fantasy )?pixel art,?\s*/i, '')
    .replace(/hyper-detailed,?\s*/gi, '')
    .replace(/jaw-dropping beauty,?\s*/gi, '')
    .replace(/rich (saturated )?colors?,?\s*/gi, '')
    .replace(/final fantasy aesthetic,?\s*/gi, '')
    .replace(/alpha-transparent background,?\s*/gi, '')
    .replace(/detailed shading,?\s*/gi, '')
    .replace(/small ground flora sprite,?\s*/gi, '')
    .replace(/small debris sprite,?\s*/gi, '')
    .replace(/medium flora sprite,?\s*/gi, '')
    .replace(/medium terrain object,?\s*/gi, '')
    .replace(/pixel art style,?\s*/gi, '')
    .replace(/,\s*/g, ' ')
    .trim();

  // Try to match against known objects
  let biome = null;
  let objectName = null;

  const allFields = [
    { map: FIELD2_OBJECTS, field: 2, prefix: 'sf', dir: 'small_flora' },
    { map: FIELD3_OBJECTS, field: 3, prefix: 'ss', dir: 'small_scatter' },
    { map: FIELD4_OBJECTS, field: 4, prefix: 'mf', dir: 'medium_flora' },
    { map: FIELD5_OBJECTS, field: 5, prefix: 'mo', dir: 'medium_objects' },
    { map: FIELD6_OBJECTS, field: 6, prefix: 'lg', dir: 'large_objects' },
  ];

  // Try exact object name match in description
  for (const { map, field: f, prefix, dir } of allFields) {
    for (const [obj, bio] of Object.entries(map)) {
      const searchTerm = obj.replace(/_/g, ' ');
      if (cleanDesc.includes(searchTerm)) {
        biome = bio;
        objectName = obj;
        if (field !== f) {
          // Override field if we found a match in a different field's objects
          field = f;
          fieldPrefix = prefix;
          fieldDir = dir;
        }
        break;
      }
    }
    if (objectName) break;
  }

  // If no exact match, try fuzzy matching on key terms
  if (!objectName) {
    // Extract the last meaningful phrase as the object description
    const parts = cleanDesc.split(/\s+/);
    const lastPhrase = parts.slice(-3).join('_').replace(/[^a-z0-9_]/g, '');
    objectName = lastPhrase || 'unknown';

    // Try to determine biome from description
    const biomes = ['forest', 'dense_forest', 'tropical_forest', 'taiga', 'grassland',
      'savanna', 'steppe', 'desert', 'beach', 'swamp', 'hills', 'mountains',
      'volcanic', 'tundra', 'arctic', 'mystic', 'ocean', 'deep_ocean',
      'shallow_water', 'river', 'lake'];

    for (const b of biomes) {
      const searchBiome = b.replace(/_/g, ' ');
      if (d.includes(searchBiome) || d.includes(b)) {
        biome = b;
        break;
      }
    }

    // Infer biome from object keywords
    if (!biome) {
      if (d.includes('frost') || d.includes('frozen') || d.includes('ice') || d.includes('snow')) biome = 'arctic';
      else if (d.includes('jungle') || d.includes('tropical')) biome = 'tropical_forest';
      else if (d.includes('dark') || d.includes('gnarled') || d.includes('ancient')) biome = 'dense_forest';
      else if (d.includes('crystal') || d.includes('aether') || d.includes('rune') || d.includes('mystic') || d.includes('glow')) biome = 'mystic';
      else if (d.includes('volcanic') || d.includes('lava') || d.includes('magma') || d.includes('obsidian') || d.includes('basalt') || d.includes('char') || d.includes('ash')) biome = 'volcanic';
      else if (d.includes('sand') || d.includes('desert') || d.includes('cactus') || d.includes('saguaro')) biome = 'desert';
      else if (d.includes('ocean') || d.includes('sea ')) biome = 'ocean';
      else if (d.includes('river') || d.includes('flowing water')) biome = 'river';
      else if (d.includes('lake') || d.includes('still water') || d.includes('calm')) biome = 'lake';
      else if (d.includes('swamp') || d.includes('bog') || d.includes('marsh')) biome = 'swamp';
      else if (d.includes('tundra') || d.includes('permafrost')) biome = 'tundra';
      else if (d.includes('mountain') || d.includes('alpine') || d.includes('cliff')) biome = 'mountains';
      else if (d.includes('hill') || d.includes('granite')) biome = 'hills';
      else if (d.includes('beach') || d.includes('coastal') || d.includes('dune') || d.includes('tide')) biome = 'beach';
      else if (d.includes('steppe') || d.includes('wind') || d.includes('buried')) biome = 'steppe';
      else if (d.includes('savanna') || d.includes('acacia') || d.includes('baobab')) biome = 'savanna';
      else if (d.includes('taiga') || d.includes('spruce') || d.includes('pine')) biome = 'taiga';
      else if (d.includes('grass') || d.includes('meadow') || d.includes('field')) biome = 'grassland';
      else if (d.includes('underwater') || d.includes('deep water') || d.includes('bioluminesc')) biome = 'deep_ocean';
      else if (d.includes('shallow')) biome = 'shallow_water';
      else biome = 'unknown';
    }
  }

  return { field, fieldPrefix, fieldDir, biome, objectName };
}

// Main
async function main() {
  const mappingFile = process.argv[2];
  if (!mappingFile) {
    console.error('Usage: node scripts/organize_staging.js <mapping_file.json>');
    process.exit(1);
  }

  const mapping = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
  console.log(`Loaded ${mapping.length} object mappings`);

  let organized = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];
  const summary = {};

  for (const obj of mapping) {
    const stagingDir = path.join(STAGING, obj.id);

    // Check if staging dir exists and has files
    if (!fs.existsSync(stagingDir)) {
      errors.push({ id: obj.id, error: 'No staging directory' });
      failed++;
      continue;
    }

    const pngFiles = fs.readdirSync(stagingDir).filter(f => f.endsWith('.png')).sort();
    if (pngFiles.length === 0) {
      errors.push({ id: obj.id, error: 'No PNG files in staging' });
      failed++;
      continue;
    }

    // Parse description
    const parsed = parseDescription(obj.description, obj.size);
    if (!parsed.field || !parsed.biome || parsed.biome === 'unknown') {
      errors.push({ id: obj.id, desc: obj.description, error: `Could not parse: field=${parsed.field}, biome=${parsed.biome}, obj=${parsed.objectName}` });
      failed++;
      continue;
    }

    // Create target directory
    const targetDir = path.join(MICRO, parsed.fieldDir, parsed.biome, parsed.objectName);
    fs.mkdirSync(targetDir, { recursive: true });

    // Count existing files in target to determine starting version number
    const existingFiles = fs.existsSync(targetDir)
      ? fs.readdirSync(targetDir).filter(f => f.endsWith('.png'))
      : [];
    let versionOffset = existingFiles.length;

    // Copy files with proper naming
    let copiedCount = 0;
    for (let i = 0; i < pngFiles.length && (versionOffset + i) < 64; i++) {
      const srcFile = path.join(stagingDir, pngFiles[i]);
      const vNum = String(versionOffset + i).padStart(3, '0');
      const destFile = path.join(targetDir, `${parsed.fieldPrefix}__${parsed.biome}__${parsed.objectName}__v${vNum}.png`);

      // Verify PNG magic bytes
      const buf = Buffer.alloc(4);
      const fd = fs.openSync(srcFile, 'r');
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);

      if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) {
        errors.push({ id: obj.id, file: pngFiles[i], error: 'Not a valid PNG file' });
        continue;
      }

      if (!fs.existsSync(destFile)) {
        fs.copyFileSync(srcFile, destFile);
        copiedCount++;
      } else {
        skipped++;
      }
    }

    organized += copiedCount;

    const key = `${parsed.fieldDir}/${parsed.biome}/${parsed.objectName}`;
    summary[key] = (summary[key] || 0) + copiedCount;
  }

  console.log('\n=== Results ===');
  console.log(`Files organized: ${organized}`);
  console.log(`Files skipped (already exist): ${skipped}`);
  console.log(`Objects failed: ${failed}`);

  if (errors.length > 0) {
    console.log('\n=== Errors ===');
    for (const e of errors) {
      console.log(`  ${e.id}: ${e.error}${e.desc ? ` (desc: ${e.desc.substring(0, 80)}...)` : ''}`);
    }
  }

  console.log('\n=== Summary by path ===');
  for (const [key, count] of Object.entries(summary).sort()) {
    console.log(`  ${key}: ${count} files`);
  }
}

main().catch(console.error);
