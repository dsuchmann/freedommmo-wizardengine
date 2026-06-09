#!/usr/bin/env node
/**
 * Reclassify objects from object_mapping.json and organize files.
 * Step 1: Read mapping, classify by field/biome/object
 * Step 2: Also read list data for sizes
 * Step 3: Copy from staging to final paths
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'C:/Users/daves/AppData/Roaming/wizardgenie/projects/default';
const STAGING = path.join(PROJECT, 'assets/pixelab/landscape_v2/micro/_review_staging');
const MICRO = path.join(PROJECT, 'assets/pixelab/landscape_v2/micro');
const API_KEY = 'de8bc1ce-8264-4c56-aa9f-03c9097ee45e';

// Ground cover (Field 1) object keywords mapped to biome
const GC_MAP = {
  // forest
  'fallen leaves': 'forest', 'moss patch': 'forest', 'pine needles': 'forest',
  'brown pine needles': 'forest', 'curled fern fronds': 'forest',
  // dense_forest
  'dark leaf mat': 'dense_forest', 'dark wet moss': 'dense_forest', 'fungal film': 'dense_forest',
  'dark humus': 'dense_forest',
  // tropical_forest
  'tropical leaves': 'tropical_forest', 'bright green moss': 'tropical_forest', 'fern fronds': 'tropical_forest',
  'broad tropical leaves': 'tropical_forest',
  // taiga
  'frost pine needles': 'taiga', 'frost lichen': 'taiga', 'bark chips': 'taiga',
  // grassland
  'grass mat': 'grassland', 'clover patch': 'grassland', 'golden thatch': 'grassland',
  'dry golden thatch': 'grassland', 'dry golden grass': 'grassland',
  // savanna
  'golden grass tuft': 'savanna', 'cracked earth': 'savanna', 'seed husks': 'savanna',
  'cracked dry earth': 'savanna',
  // steppe
  'pale grass wisps': 'steppe', 'dust patch': 'steppe', 'dried stems': 'steppe',
  'dust drift': 'steppe', 'wind-blown dust': 'steppe', 'dried brown stem': 'steppe',
  'sparse pale grass': 'steppe',
  // desert
  'sand ripple': 'desert', 'dust drift': 'desert', 'cracked clay': 'desert',
  'cracked dry clay': 'desert',
  // beach
  'wet sand': 'beach', 'sea foam': 'beach', 'tide line': 'beach',
  'dark tide line': 'beach',
  // swamp
  'algae film': 'swamp', 'sphagnum moss': 'swamp', 'waterlogged leaf': 'swamp',
  'green algae film': 'swamp', 'dark peat mud': 'swamp',
  // hills
  'hillside grass': 'hills', 'flat stone': 'hills', 'brown moss': 'hills',
  'exposed flat stone': 'hills', 'dry brown moss': 'hills',
  // mountains
  'lichen crust': 'mountains', 'frost crystals': 'mountains', 'gravel scatter': 'mountains',
  'grey lichen crust': 'mountains', 'fine gravel': 'mountains',
  // volcanic
  'ash film': 'volcanic', 'char crust': 'volcanic', 'pumice dust': 'volcanic',
  'dark ash film': 'volcanic', 'black char crust': 'volcanic', 'dark volcanic ash': 'volcanic',
  // tundra
  'frozen moss': 'tundra', 'ice crust': 'tundra', 'dead lichen': 'tundra',
  'dead grey lichen': 'tundra', 'thin ice crust': 'tundra',
  // arctic
  'snow crust': 'arctic', 'ice crystals': 'arctic', 'frost pattern': 'arctic',
  'white snow crust': 'arctic', 'delicate frost pattern': 'arctic', 'blue ice crystal': 'arctic',
  // mystic
  'glowing moss': 'mystic', 'aether tendril': 'mystic', 'crystal dust': 'mystic',
  'sparkling crystal dust': 'mystic',
};

// Small flora (Field 2)
const SF_MAP = {
  'grass blade cluster': 'forest', 'small fern': 'forest', 'clover bloom': 'forest',
  'curled fern': 'forest', 'tiny clover bloom': 'forest',
  'shade fern': 'dense_forest', 'bracket fungus': 'dense_forest', 'dark herb': 'dense_forest',
  'broad fern': 'tropical_forest', 'orchid sprout': 'tropical_forest', 'vine tendril': 'tropical_forest',
  'frost grass': 'taiga', 'low juniper': 'taiga', 'cold moss tuft': 'taiga',
  'tall grass blade': 'grassland', 'dandelion stem': 'grassland', 'wild herb': 'grassland',
  'dry grass spike': 'savanna', 'thorn sprout': 'savanna', 'acacia seedling': 'savanna',
  'small thorn sprout': 'savanna',
  'wind grass': 'steppe', 'sparse weed': 'steppe', 'dry tuft': 'steppe',
  'small dry tuft': 'steppe', 'wind-blown grass wisp': 'steppe',
  'sand grass': 'desert', 'desert thorn': 'desert', 'desert sand grass': 'desert',
  'dune grass': 'beach', 'sea oat': 'beach', 'beach weed': 'beach',
  'cattail base': 'swamp', 'bog grass': 'swamp', 'swamp herb': 'swamp',
  'rock flower bud': 'hills', 'heather sprig': 'hills',
  'alpine tuft': 'mountains', 'rock cress': 'mountains', 'hardy lichen': 'mountains',
  'heat sprout': 'volcanic', 'ash grass': 'volcanic',
  'tundra grass': 'tundra', 'low berry bush': 'tundra', 'ice moss': 'tundra',
  'frost flower': 'arctic', 'ice needle': 'arctic', 'frost-covered grass': 'arctic',
  'glow grass blade': 'mystic', 'aether fern': 'mystic', 'crystal sprout': 'mystic',
};

// Medium objects (Field 5) - 48x48
const MO_MAP = {
  'mossy boulder': 'forest', 'tree stump': 'forest', 'fallen log': 'forest',
  'old tree stump': 'forest', 'moss-covered boulder': 'forest',
  'hollow stump': 'dense_forest', 'rotting log': 'dense_forest', 'root mound': 'dense_forest',
  'jungle rock': 'tropical_forest', 'buttress root': 'tropical_forest', 'vine log': 'tropical_forest',
  'snow rock': 'taiga', 'frost stump': 'taiga', 'ice log': 'taiga',
  'field boulder': 'grassland', 'hay bale': 'grassland', 'fence post': 'grassland',
  'termite mound': 'savanna', 'bone pile': 'savanna', 'dry well': 'savanna',
  'wind rock': 'steppe', 'stone cairn': 'steppe', 'buried post': 'steppe',
  'sandstone formation': 'desert', 'bleached skull': 'desert', 'clay pot shard': 'desert',
  'tide pool rock': 'beach', 'beached log': 'beach', 'anchor relic': 'beach',
  'bog log': 'swamp', 'mud mound': 'swamp', 'rotting dock': 'swamp',
  'granite outcrop': 'hills', 'stone pile': 'hills', 'old milestone': 'hills',
  'ice boulder': 'mountains', 'frozen cairn': 'mountains', 'cliff fragment': 'mountains',
  'obsidian pillar': 'volcanic', 'lava rock': 'volcanic', 'basalt column': 'volcanic',
  'permafrost mound': 'tundra', 'frozen bones': 'tundra',
  'ice formation': 'arctic', 'snow drift mound': 'arctic', 'frozen ruin': 'arctic',
  'rune stone': 'mystic', 'crystal cluster': 'mystic', 'ancient altar': 'mystic',
};

// Large objects (Field 6) - 64x64
const LG_MAP = {
  'oak': 'forest', 'birch': 'forest', 'maple': 'forest',
  'majestic oak': 'forest', 'tall birch': 'forest', 'red maple': 'forest',
  'ancient oak': 'dense_forest', 'gnarled elm': 'dense_forest', 'strangler fig': 'dense_forest',
  'dark gnarled elm': 'dense_forest', 'ancient massive oak': 'dense_forest',
  'coconut palm': 'tropical_forest', 'jungle tree': 'tropical_forest', 'banyan': 'tropical_forest',
  'giant banyan': 'tropical_forest', 'tall coconut palm': 'tropical_forest',
  'spruce': 'taiga', 'snow pine': 'taiga', 'frost cedar': 'taiga',
  'tall spruce': 'taiga', 'snow-covered pine': 'taiga', 'frosted cedar': 'taiga',
  'meadow oak': 'grassland', 'cherry blossom': 'grassland', 'apple tree': 'grassland',
  'acacia': 'savanna', 'baobab': 'savanna', 'thorny acacia': 'savanna',
  'flat-topped acacia': 'savanna', 'massive baobab': 'savanna',
  'twisted shrub': 'steppe', 'dead tree': 'steppe', 'stone monolith': 'steppe',
  'bleached dead tree': 'steppe', 'ancient stone monolith': 'steppe',
  'date palm': 'desert', 'saguaro': 'desert', 'sandstone arch': 'desert',
  'desert date palm': 'desert', 'tall saguaro': 'desert',
  'beach palm': 'beach', 'coastal pine': 'beach', 'driftwood': 'beach',
  'artistic driftwood': 'beach', 'tall beach palm': 'beach', 'weathered coastal pine': 'beach',
  'cypress': 'swamp', 'dead willow': 'swamp', 'mangrove': 'swamp',
  'swamp cypress': 'swamp', 'dead willow tree': 'swamp',
  'scots pine': 'hills', 'rowan': 'hills', 'standing stone': 'hills',
  'ancient standing stone': 'hills',
  'cliff pine': 'mountains', 'mountain ash': 'mountains', 'rock spire': 'mountains',
  'cliff-clinging': 'mountains', 'cliff-clinging mountain pine': 'mountains',
  'charred tree': 'volcanic', 'obsidian spike': 'volcanic', 'magma vent': 'volcanic',
  'charred burnt tree': 'volcanic', 'charred blackened tree': 'volcanic',
  'frost willow': 'tundra', 'ice pillar': 'tundra', 'stunted pine': 'tundra',
  'ice crystal spire': 'arctic', 'frozen tree': 'arctic', 'crystal ice tower': 'arctic',
  'massive ice crystal spire': 'arctic', 'towering frozen crystal': 'arctic',
  'spirit tree': 'mystic', 'crystal tree': 'mystic', 'aether pillar': 'mystic',
  'pulsing aether': 'mystic', 'aether energy pillar': 'mystic',
};

// Water biome scatter objects
const WATER_MAP = {
  'floating debris': 'ocean', 'driftwood stick': 'ocean', 'ocean foam': 'ocean',
  'foam patch': 'river', 'river foam': 'river', 'bubble trail': 'river', 'flow streak': 'river',
  'light dapple': 'lake', 'soft ripple': 'lake', 'calm lake water': 'lake', 'lily pad': 'lake',
  'sand shimmer': 'shallow_water', 'shallow water ripple': 'shallow_water', 'seaweed': 'shallow_water',
  'bioluminescent': 'deep_ocean', 'dark ocean': 'deep_ocean', 'deep ocean': 'deep_ocean',
  'underwater sparkle': 'deep_ocean', 'pale bioluminescence': 'deep_ocean',
};

// Additional RPG objects for various fields
const RPG_OBJECTS = {
  'cave entrance': { biome: 'mountains', field: 6, dir: 'large_objects', prefix: 'lg' },
  'dark cave entrance': { biome: 'mountains', field: 6, dir: 'large_objects', prefix: 'lg' },
  'coal seam': { biome: 'mountains', field: 5, dir: 'medium_objects', prefix: 'mo' },
  'brown mushroom': { biome: 'forest', field: 4, dir: 'medium_flora', prefix: 'mf' },
  'morel': { biome: 'forest', field: 4, dir: 'medium_flora', prefix: 'mf' },
  'bulrush': { biome: 'swamp', field: 2, dir: 'small_flora', prefix: 'sf' },
  'brain coral': { biome: 'ocean', field: 5, dir: 'medium_objects', prefix: 'mo' },
  'branching coral': { biome: 'ocean', field: 5, dir: 'medium_objects', prefix: 'mo' },
  'arctic poppy': { biome: 'tundra', field: 4, dir: 'medium_flora', prefix: 'mf' },
  'arcane flower': { biome: 'mystic', field: 4, dir: 'medium_flora', prefix: 'mf' },
};

function classify(desc, listSize) {
  const d = desc.toLowerCase();

  // Extract the descriptive part (after removing style keywords)
  const clean = d
    .replace(/^top-down (high fantasy )?pixel art,?\s*/i, '')
    .replace(/hyper-detailed,?\s*/gi, '')
    .replace(/jaw-dropping beauty,?\s*/gi, '')
    .replace(/rich (saturated )?colors?,?\s*/gi, '')
    .replace(/final fantasy aesthetic,?\s*/gi, '')
    .replace(/alpha-transparent background,?\s*/gi, '')
    .replace(/detailed shading,?\s*/gi, '')
    .replace(/pixel art style,?\s*/gi, '')
    .replace(/top-down rpg pixel art,?\s*/gi, '')
    .replace(/fantasy pixel art rpg style,?\s*/gi, '')
    .replace(/,\s*/g, ', ')
    .trim();

  // 1. Check for explicit field keywords
  if (d.includes('small ground flora sprite')) {
    return matchFromMap(clean, SF_MAP, 2, 'sf', 'small_flora');
  }
  if (d.includes('small ground detail sprite') || d.includes('ground detail sprite')) {
    return matchFromMap(clean, GC_MAP, 1, 'gc', 'ground_cover');
  }
  if (d.includes('medium terrain object')) {
    return matchFromMap(clean, MO_MAP, 5, 'mo', 'medium_objects');
  }
  if (d.includes('medium flora sprite')) {
    return { field: 4, prefix: 'mf', dir: 'medium_flora', biome: guessBiome(d), objName: extractObjName(clean) };
  }
  if (d.includes('small debris sprite')) {
    return { field: 3, prefix: 'ss', dir: 'small_scatter', biome: guessBiome(d), objName: extractObjName(clean) };
  }

  // 2. Check size from list data
  if (listSize === '64x64') {
    return matchFromMap(clean, LG_MAP, 6, 'lg', 'large_objects');
  }
  if (listSize === '48x48') {
    return matchFromMap(clean, MO_MAP, 5, 'mo', 'medium_objects');
  }

  // 3. Water biome objects (32x32, no field keyword)
  for (const [key, biome] of Object.entries(WATER_MAP)) {
    if (d.includes(key)) {
      return { field: 3, prefix: 'ss', dir: 'small_scatter', biome, objName: key.replace(/\s+/g, '_') };
    }
  }

  // 4. Check for ground cover patterns (various ground texture descriptions)
  for (const [key, biome] of Object.entries(GC_MAP)) {
    if (clean.includes(key)) {
      return { field: 1, prefix: 'gc', dir: 'ground_cover', biome, objName: key.replace(/\s+/g, '_') };
    }
  }

  // 5. Check RPG-style objects
  for (const [key, info] of Object.entries(RPG_OBJECTS)) {
    if (d.includes(key)) {
      return { field: info.field, prefix: info.prefix, dir: info.dir, biome: info.biome, objName: key.replace(/\s+/g, '_') };
    }
  }

  // 6. Try matching against all maps
  for (const [key, biome] of Object.entries(LG_MAP)) {
    if (clean.includes(key)) {
      return { field: 6, prefix: 'lg', dir: 'large_objects', biome, objName: key.replace(/\s+/g, '_') };
    }
  }
  for (const [key, biome] of Object.entries(MO_MAP)) {
    if (clean.includes(key)) {
      return { field: 5, prefix: 'mo', dir: 'medium_objects', biome, objName: key.replace(/\s+/g, '_') };
    }
  }
  for (const [key, biome] of Object.entries(SF_MAP)) {
    if (clean.includes(key)) {
      return { field: 2, prefix: 'sf', dir: 'small_flora', biome, objName: key.replace(/\s+/g, '_') };
    }
  }

  // 7. Fallback: guess biome and use generic object name
  const biome = guessBiome(d);
  const objName = extractObjName(clean);

  // Guess field from frame count or description keywords
  let field = 2, prefix = 'sf', dir = 'small_flora';
  if (d.includes('tree') || d.includes('pillar') || d.includes('spire') || d.includes('palm') ||
      d.includes('entrance') || d.includes('cave')) {
    field = 6; prefix = 'lg'; dir = 'large_objects';
  } else if (d.includes('boulder') || d.includes('stump') || d.includes('log') || d.includes('rock') ||
             d.includes('cairn') || d.includes('mound') || d.includes('coral')) {
    field = 5; prefix = 'mo'; dir = 'medium_objects';
  } else if (d.includes('flower') || d.includes('bloom') || d.includes('mushroom') || d.includes('fungus') ||
             d.includes('orchid') || d.includes('lily') || d.includes('rose')) {
    field = 4; prefix = 'mf'; dir = 'medium_flora';
  } else if (d.includes('scatter') || d.includes('debris') || d.includes('shell') || d.includes('shard') ||
             d.includes('pebble') || d.includes('bone') || d.includes('crystal') || d.includes('nugget')) {
    field = 3; prefix = 'ss'; dir = 'small_scatter';
  } else if (d.includes('crust') || d.includes('film') || d.includes('patch') || d.includes('texture') ||
             d.includes('ripple') || d.includes('pattern') || d.includes('soil') || d.includes('mud') ||
             d.includes('moss') || d.includes('lichen') || d.includes('needles') || d.includes('leaves') ||
             d.includes('humus') || d.includes('ash') || d.includes('thatch') || d.includes('gravel') ||
             d.includes('dust') || d.includes('sand') || d.includes('foam') || d.includes('water')) {
    field = 1; prefix = 'gc'; dir = 'ground_cover';
  }

  return { field, prefix, dir, biome, objName };
}

function matchFromMap(clean, map, field, prefix, dir) {
  // Sort keys by length desc to match longest first
  const sorted = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (clean.includes(key)) {
      return { field, prefix, dir, biome: map[key], objName: key.replace(/\s+/g, '_') };
    }
  }
  // Fallback
  return { field, prefix, dir, biome: guessBiome(clean), objName: extractObjName(clean) };
}

function guessBiome(d) {
  const biomeKeywords = [
    ['tropical_forest', ['tropical', 'jungle']],
    ['dense_forest', ['dense forest', 'ancient oak', 'gnarled elm', 'strangler fig', 'dark canopy']],
    ['forest', ['forest', ' oak ', 'birch', 'maple', 'fern', 'clover']],
    ['taiga', ['taiga', 'spruce', 'snow pine', 'frost cedar', 'pine cone', 'conifer']],
    ['arctic', ['arctic', 'frozen', 'ice crystal', 'glacial', 'crystal ice']],
    ['tundra', ['tundra', 'permafrost', 'stunted pine']],
    ['volcanic', ['volcanic', 'lava', 'magma', 'obsidian', 'basalt', 'charred', ' ash ', 'char ']],
    ['mystic', ['mystic', 'aether', 'rune', 'spirit tree', 'crystal tree', 'glow', 'arcane', 'runic']],
    ['desert', ['desert', 'saguaro', 'oasis', 'bleached bone']],
    ['beach', ['beach', 'coastal', 'dune', 'tide ', 'shore']],
    ['swamp', ['swamp', 'bog', 'marsh', 'cypress', 'mangrove', 'wetland', 'sphagnum', 'peat', 'algae']],
    ['mountains', ['mountain', 'alpine', 'cliff', 'rock spire', 'granite', 'cave']],
    ['hills', ['hill', 'heather', 'rowan', 'scots pine', 'milestone']],
    ['savanna', ['savanna', 'acacia', 'baobab', 'termite', 'dry bone']],
    ['steppe', ['steppe', 'monolith', 'wind rock', 'dead tree', 'wind-blown', 'windswept']],
    ['grassland', ['grassland', 'meadow', 'cherry blossom', 'apple tree', 'field stone', 'daisy', 'cornflower']],
    ['deep_ocean', ['deep ocean', 'deep water', 'bioluminesc', 'underwater']],
    ['ocean', ['ocean', 'sea surface']],
    ['river', ['river', 'flowing water']],
    ['lake', ['lake', 'still water', 'calm water']],
    ['shallow_water', ['shallow water', 'shallow']],
  ];

  for (const [bio, keywords] of biomeKeywords) {
    if (keywords.some(kw => d.includes(kw))) return bio;
  }
  return 'unknown';
}

function extractObjName(clean) {
  // Take last meaningful phrase from the clean description
  const parts = clean.split(/,\s*/);
  let name = parts[parts.length - 1].trim() || parts[0]?.trim() || 'unknown';
  // Also try the part after the last comma
  if (name.length > 50) {
    const words = name.split(/\s+/).slice(-4);
    name = words.join(' ');
  }
  return name.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').substring(0, 40) || 'unknown';
}

// Get sizes from the list API
async function getListSizes() {
  const sizes = {};
  let offset = 0;
  while (true) {
    const body = JSON.stringify({
      jsonrpc: '2.0', id: Date.now(),
      method: 'tools/call',
      params: { name: 'list_objects', arguments: { status_filter: 'review', limit: 50, offset } }
    });

    const data = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.pixellab.ai', path: '/mcp', method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Length': Buffer.byteLength(body),
        },
      }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => {
          const m = d.match(/data:\s*(\{.+\})/s);
          resolve(m ? JSON.parse(m[1]) : JSON.parse(d));
        });
      });
      req.on('error', reject);
      req.write(body); req.end();
    });

    const text = data.result?.content?.[0]?.text || '';
    // Parse size info: id | description | 1dir 32x32 | status
    const lineRegex = /([0-9a-f-]{36})\s*\|[^|]+\|\s*1dir\s+(\d+x\d+)\s*\|/g;
    let match;
    let count = 0;
    while ((match = lineRegex.exec(text)) !== null) {
      sizes[match[1]] = match[2];
      count++;
    }

    const totalMatch = text.match(/(\d+)\s+total/);
    const total = totalMatch ? parseInt(totalMatch[1]) : 0;
    console.log(`  List sizes: offset=${offset}, found=${count}, total=${total}`);

    if (count < 50 || offset + count >= total) break;
    offset += 50;
    await new Promise(r => setTimeout(r, 200));
  }
  return sizes;
}

async function main() {
  console.log('Loading object mapping...');
  const mapping = JSON.parse(fs.readFileSync(path.join(PROJECT, 'scripts/object_mapping.json'), 'utf8'));
  console.log(`  ${mapping.length} objects loaded`);

  console.log('\nFetching sizes from list API...');
  const sizes = await getListSizes();
  console.log(`  Got sizes for ${Object.keys(sizes).length} objects`);

  // Reclassify
  console.log('\nReclassifying objects...');
  const classified = [];
  const byField = {};
  const byBiome = {};
  const unknowns = [];

  for (const obj of mapping) {
    const listSize = sizes[obj.id] || '';
    const c = classify(obj.description || '', listSize);
    obj.classified = c;
    classified.push(obj);

    const fieldKey = c.dir || 'unknown';
    byField[fieldKey] = (byField[fieldKey] || 0) + 1;
    byBiome[c.biome] = (byBiome[c.biome] || 0) + 1;

    if (c.biome === 'unknown') {
      unknowns.push({ id: obj.id, desc: obj.description?.substring(0, 80) });
    }
  }

  console.log('\nBy field:');
  for (const [k, v] of Object.entries(byField).sort()) console.log(`  ${k}: ${v}`);
  console.log('\nBy biome:');
  for (const [k, v] of Object.entries(byBiome).sort()) console.log(`  ${k}: ${v}`);

  if (unknowns.length > 0) {
    console.log(`\nUnknown biome (${unknowns.length}):`);
    for (const u of unknowns.slice(0, 15)) console.log(`  ${u.id}: ${u.desc}`);
  }

  // Organize files
  console.log('\n\nOrganizing files...');
  let organized = 0;
  let skipped = 0;
  let noStaging = 0;
  let errors = 0;
  const pathCounts = {};

  for (const obj of classified) {
    const c = obj.classified;
    if (!c.dir || !c.biome || c.biome === 'unknown') {
      errors++;
      continue;
    }

    const stagingDir = path.join(STAGING, obj.id);
    if (!fs.existsSync(stagingDir)) {
      noStaging++;
      continue;
    }

    const pngFiles = fs.readdirSync(stagingDir).filter(f => f.endsWith('.png')).sort((a, b) => {
      const numA = parseInt(a.match(/(\d+)/)?.[1] || '0');
      const numB = parseInt(b.match(/(\d+)/)?.[1] || '0');
      return numA - numB;
    });

    if (pngFiles.length === 0) {
      noStaging++;
      continue;
    }

    const targetDir = path.join(MICRO, c.dir, c.biome, c.objName);
    fs.mkdirSync(targetDir, { recursive: true });

    // Count existing to set version offset
    const existing = fs.readdirSync(targetDir).filter(f => f.endsWith('.png')).length;

    let copied = 0;
    for (let i = 0; i < pngFiles.length; i++) {
      const vNum = String(existing + i).padStart(3, '0');
      const destFile = path.join(targetDir, `${c.prefix}__${c.biome}__${c.objName}__v${vNum}.png`);

      if (fs.existsSync(destFile)) { skipped++; continue; }

      const srcFile = path.join(stagingDir, pngFiles[i]);
      // Verify PNG
      try {
        const buf = Buffer.alloc(4);
        const fd = fs.openSync(srcFile, 'r');
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) {
          continue; // Skip non-PNG
        }
        fs.copyFileSync(srcFile, destFile);
        copied++;
      } catch (e) {
        continue;
      }
    }

    organized += copied;
    if (copied > 0) {
      const key = `${c.dir}/${c.biome}/${c.objName}`;
      pathCounts[key] = (pathCounts[key] || 0) + copied;
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Files copied to final paths: ${organized}`);
  console.log(`Files skipped (already exist): ${skipped}`);
  console.log(`Objects with no staging dir: ${noStaging}`);
  console.log(`Objects that couldn't be classified: ${errors}`);

  console.log(`\nFiles by destination:`);
  for (const [key, count] of Object.entries(pathCounts).sort()) {
    console.log(`  ${key}: ${count}`);
  }

  // Save final classification
  fs.writeFileSync(path.join(PROJECT, 'scripts/object_classified.json'), JSON.stringify(classified, null, 2));
  console.log(`\nSaved classification to scripts/object_classified.json`);
}

main().catch(console.error);
