#!/usr/bin/env node
/**
 * Batch process PixelLab review objects:
 * 1. List all review objects
 * 2. Get descriptions for each
 * 3. Select all frames (promote to completed)
 * 4. Download frames to staging
 * 5. Organize staging files to final paths
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_BASE = 'https://api.pixellab.ai/mcp';
const API_KEY = 'de8bc1ce-8264-4c56-aa9f-03c9097ee45e';
const PROJECT = 'C:/Users/daves/AppData/Roaming/wizardgenie/projects/default';
const STAGING = path.join(PROJECT, 'assets/pixelab/landscape_v2/micro/_review_staging');
const MICRO = path.join(PROJECT, 'assets/pixelab/landscape_v2/micro');

// Field 6 large object names by biome from the master plan
const FIELD6_MAP = {
  'oak': 'forest', 'birch': 'forest', 'maple': 'forest',
  'ancient oak': 'dense_forest', 'gnarled elm': 'dense_forest', 'strangler fig': 'dense_forest',
  'coconut palm': 'tropical_forest', 'jungle tree': 'tropical_forest', 'banyan': 'tropical_forest',
  'spruce': 'taiga', 'snow pine': 'taiga', 'frost cedar': 'taiga',
  'meadow oak': 'grassland', 'cherry blossom': 'grassland', 'apple tree': 'grassland',
  'acacia': 'savanna', 'baobab': 'savanna', 'thorny acacia': 'savanna',
  'twisted shrub': 'steppe', 'dead tree': 'steppe', 'stone monolith': 'steppe',
  'date palm': 'desert', 'saguaro': 'desert', 'sandstone arch': 'desert',
  'beach palm': 'beach', 'coastal pine': 'beach', 'driftwood': 'beach',
  'cypress': 'swamp', 'dead willow': 'swamp', 'mangrove': 'swamp',
  'scots pine': 'hills', 'rowan': 'hills', 'standing stone': 'hills',
  'cliff pine': 'mountains', 'mountain ash': 'mountains', 'rock spire': 'mountains',
  'charred tree': 'volcanic', 'obsidian spike': 'volcanic', 'magma vent': 'volcanic',
  'frost willow': 'tundra', 'ice pillar': 'tundra', 'stunted pine': 'tundra',
  'ice crystal spire': 'arctic', 'frozen tree': 'arctic', 'crystal ice tower': 'arctic',
  'spirit tree': 'mystic', 'crystal tree': 'mystic', 'aether pillar': 'mystic',
  // Additional description keywords
  'pulsing aether energy pillar': 'mystic', 'aether energy pillar': 'mystic',
  'massive ice crystal spire': 'arctic', 'towering frozen crystal': 'arctic',
};

// Field 5 medium object names
const FIELD5_MAP = {
  'mossy boulder': 'forest', 'tree stump': 'forest', 'fallen log': 'forest',
  'old tree stump': 'forest', 'cut tree stump': 'forest',
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

// Field 2 small flora names
const FIELD2_MAP = {
  'grass blade cluster': 'forest', 'small fern': 'forest', 'clover bloom': 'forest',
  'tiny clover bloom': 'forest', 'curled fern': 'forest',
  'shade fern': 'dense_forest', 'bracket fungus': 'dense_forest', 'dark herb': 'dense_forest',
  'broad fern': 'tropical_forest', 'orchid sprout': 'tropical_forest', 'vine tendril': 'tropical_forest',
  'frost grass': 'taiga', 'low juniper': 'taiga', 'cold moss tuft': 'taiga',
  'tall grass blade': 'grassland', 'dandelion stem': 'grassland', 'wild herb': 'grassland',
  'dry grass spike': 'savanna', 'thorn sprout': 'savanna', 'acacia seedling': 'savanna',
  'small thorn sprout': 'savanna',
  'wind grass': 'steppe', 'sparse weed': 'steppe', 'dry tuft': 'steppe',
  'small dry tuft': 'steppe', 'wind-blown grass wisp': 'steppe',
  'sand grass': 'desert', 'desert thorn': 'desert',
  'dune grass': 'beach', 'sea oat': 'beach', 'beach weed': 'beach',
  'cattail base': 'swamp', 'bog grass': 'swamp', 'swamp herb': 'swamp',
  'hillside grass': 'hills', 'rock flower bud': 'hills', 'heather sprig': 'hills',
  'alpine tuft': 'mountains', 'rock cress': 'mountains', 'hardy lichen': 'mountains',
  'heat sprout': 'volcanic', 'ash grass': 'volcanic',
  'tundra grass': 'tundra', 'low berry bush': 'tundra', 'ice moss': 'tundra',
  'frost flower': 'arctic', 'ice needle': 'arctic', 'frost-covered grass tuft': 'arctic',
  'glow grass blade': 'mystic', 'aether fern': 'mystic', 'crystal sprout': 'mystic',
};

// Water biome scatter objects (Field 3)
const WATER_SCATTER_MAP = {
  'floating debris': 'ocean', 'driftwood stick': 'ocean', 'small floating debris': 'ocean',
  'foam patch': 'river', 'river foam': 'river', 'river foam patch': 'river',
  'river ripple': 'river', 'flowing current lines': 'river', 'river pebble': 'river',
  'light dapple': 'lake', 'water ripple': 'lake', 'lake water': 'lake', 'soft ripple': 'lake',
  'sand shimmer': 'shallow_water', 'shallow water': 'shallow_water',
  'bioluminescent': 'deep_ocean', 'deep ocean': 'deep_ocean', 'dark ocean': 'deep_ocean',
  'ocean foam': 'ocean', 'ocean water': 'ocean',
  'pale bioluminescence': 'deep_ocean',
  'underwater sparkle': 'deep_ocean',
};

function parseDescription(desc, size) {
  const d = desc.toLowerCase();
  let field, prefix, dir, biome, objName;

  // Determine field
  if (d.includes('small ground flora sprite')) {
    field = 2; prefix = 'sf'; dir = 'small_flora';
  } else if (d.includes('small debris sprite')) {
    field = 3; prefix = 'ss'; dir = 'small_scatter';
  } else if (d.includes('medium flora sprite')) {
    field = 4; prefix = 'mf'; dir = 'medium_flora';
  } else if (d.includes('medium terrain object')) {
    field = 5; prefix = 'mo'; dir = 'medium_objects';
  } else if (size.includes('64x64')) {
    field = 6; prefix = 'lg'; dir = 'large_objects';
  } else if (size.includes('48x48')) {
    field = 5; prefix = 'mo'; dir = 'medium_objects';
  } else if (size.includes('32x32')) {
    // Water biome scatter or small flora - check description
    let isWater = false;
    for (const [key, bio] of Object.entries(WATER_SCATTER_MAP)) {
      if (d.includes(key)) {
        field = 3; prefix = 'ss'; dir = 'small_scatter';
        biome = bio;
        objName = key.replace(/\s+/g, '_');
        isWater = true;
        break;
      }
    }
    if (!isWater) {
      field = 2; prefix = 'sf'; dir = 'small_flora';
    }
  }

  if (!biome) {
    // Clean description for matching
    const clean = d
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

    // Try matching against known objects per field
    const maps = {
      2: FIELD2_MAP,
      5: FIELD5_MAP,
      6: FIELD6_MAP,
    };

    const mapToCheck = maps[field] || {};
    // Sort keys by length descending to match longest first
    const sortedKeys = Object.keys(mapToCheck).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (clean.includes(key)) {
        biome = mapToCheck[key];
        objName = key.replace(/\s+/g, '_');
        break;
      }
    }

    // If no match, try fuzzy biome detection
    if (!biome) {
      const biomeKeywords = [
        ['tropical_forest', ['tropical', 'jungle', 'palm']],
        ['dense_forest', ['ancient oak', 'gnarled', 'strangler', 'dark', 'hollow stump', 'rotting']],
        ['forest', ['forest', 'oak', 'birch', 'maple', 'fern', 'clover']],
        ['taiga', ['taiga', 'spruce', 'snow pine', 'frost cedar', 'pine cone']],
        ['arctic', ['arctic', 'frozen', 'ice crystal', 'glacial', 'frost']],
        ['tundra', ['tundra', 'permafrost', 'stunted']],
        ['volcanic', ['volcanic', 'lava', 'magma', 'obsidian', 'basalt', 'charred', 'ash']],
        ['mystic', ['mystic', 'aether', 'rune', 'crystal tree', 'spirit tree', 'glow']],
        ['desert', ['desert', 'saguaro', 'sand', 'bleached']],
        ['beach', ['beach', 'coastal', 'dune', 'tide', 'sea ']],
        ['swamp', ['swamp', 'bog', 'marsh', 'cypress', 'mangrove']],
        ['mountains', ['mountain', 'alpine', 'cliff', 'rock spire']],
        ['hills', ['hill', 'granite', 'rowan', 'scots pine']],
        ['savanna', ['savanna', 'acacia', 'baobab', 'termite']],
        ['steppe', ['steppe', 'wind rock', 'twisted shrub', 'dead tree']],
        ['grassland', ['grassland', 'meadow', 'cherry blossom', 'apple tree', 'field']],
        ['deep_ocean', ['deep ocean', 'bioluminesc', 'underwater']],
        ['ocean', ['ocean', 'sea']],
        ['river', ['river', 'flowing']],
        ['lake', ['lake', 'still water', 'calm']],
        ['shallow_water', ['shallow']],
      ];

      for (const [bio, keywords] of biomeKeywords) {
        if (keywords.some(kw => d.includes(kw))) {
          biome = bio;
          break;
        }
      }
    }

    // Extract object name from end of description if not found
    if (!objName) {
      const parts = clean.split(/,\s*|\s{2,}/);
      const lastPart = parts[parts.length - 1].trim();
      objName = lastPart.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    }
  }

  return { field, prefix, dir, biome: biome || 'unknown', objName: objName || 'unknown' };
}

// MCP API call
function mcpCall(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: method, arguments: params }
    });

    const options = {
      hostname: 'api.pixellab.ai',
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          // Handle SSE response format: "event: message\ndata: {...}\n\n"
          let jsonStr = data;
          if (data.includes('event:') || data.includes('data:')) {
            const dataMatch = data.match(/data:\s*(\{.+\})/s);
            if (dataMatch) jsonStr = dataMatch[1];
          }
          const json = JSON.parse(jsonStr);
          resolve(json);
        } catch (e) {
          reject(new Error(`Parse error: ${data.substring(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// Download a file
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const dir = path.dirname(dest);
    fs.mkdirSync(dir, { recursive: true });

    const file = fs.createWriteStream(dest);
    protocol.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        // Verify PNG magic bytes
        const buf = Buffer.alloc(4);
        const fd = fs.openSync(dest, 'r');
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) {
          fs.unlinkSync(dest);
          reject(new Error('Not a PNG file'));
        } else {
          resolve();
        }
      });
    }).on('error', (e) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(e);
    });
  });
}

async function getObjectDetails(objectId) {
  const result = await mcpCall('get_object', { object_id: objectId, include_preview: false });
  if (result.error) throw new Error(result.error.message || JSON.stringify(result.error));
  // Parse the text content
  const content = result.result?.content?.[0]?.text || '';

  // Extract description
  const descMatch = content.match(/description:\s*(.+)/);
  const desc = descMatch ? descMatch[1].trim() : '';

  // Extract size
  const sizeMatch = content.match(/(\d+x\d+)px/);
  const size = sizeMatch ? sizeMatch[1] : '';

  // Extract frame indices
  const frameIndices = [];
  const frameRegex = /\[(\d+)\]:/g;
  let match;
  while ((match = frameRegex.exec(content)) !== null) {
    frameIndices.push(parseInt(match[1]));
  }

  // Extract frame URLs
  const frameUrls = {};
  const urlRegex = /\[(\d+)\]:\s*(https:\/\/[^\s]+)/g;
  while ((match = urlRegex.exec(content)) !== null) {
    frameUrls[parseInt(match[1])] = match[2];
  }

  return { id: objectId, description: desc, size, frameIndices, frameUrls };
}

async function selectAllFrames(objectId, indices) {
  try {
    const result = await mcpCall('select_object_frames', {
      object_id: objectId,
      indices: indices,
    });
    if (result.error) {
      if (result.error.message?.includes('not found') || result.error.message?.includes('404')) {
        return { ok: false, reason: 'already_selected' };
      }
      return { ok: false, reason: result.error.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const mode = process.argv[2] || 'all'; // 'list', 'select', 'download', 'organize', 'all'

  console.log(`Mode: ${mode}`);
  console.log('Fetching review objects list...');

  // Step 1: Get all review object IDs
  let allObjects = [];
  let offset = 0;
  while (true) {
    const result = await mcpCall('list_objects', { status_filter: 'review', limit: 50, offset });
    const content = result.result?.content?.[0]?.text || '';

    // Parse object IDs from the listing
    const idRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*\|/g;
    let match;
    let found = 0;
    while ((match = idRegex.exec(content)) !== null) {
      allObjects.push(match[1]);
      found++;
    }

    // Check total count
    const totalMatch = content.match(/(\d+)\s+total/);
    const total = totalMatch ? parseInt(totalMatch[1]) : 0;

    console.log(`  Fetched ${offset} - ${offset + found} of ${total}`);

    if (found < 50 || offset + found >= total) break;
    offset += 50;
    await sleep(200);
  }

  console.log(`\nTotal review objects: ${allObjects.length}`);

  if (mode === 'list') {
    fs.writeFileSync(path.join(PROJECT, 'scripts/review_ids.json'), JSON.stringify(allObjects, null, 2));
    console.log('Saved to scripts/review_ids.json');
    return;
  }

  // Step 2: Get details for each object
  console.log('\nGetting object details...');
  const objectDetails = [];
  const mappingPath = path.join(PROJECT, 'scripts/object_mapping.json');

  // Load existing mapping if available
  let existingMapping = {};
  if (fs.existsSync(mappingPath)) {
    const existing = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    for (const obj of existing) existingMapping[obj.id] = obj;
    console.log(`  Loaded ${existing.length} existing mappings`);
  }

  let fetched = 0;
  for (const id of allObjects) {
    if (existingMapping[id]) {
      objectDetails.push(existingMapping[id]);
      continue;
    }

    try {
      const details = await getObjectDetails(id);
      const parsed = parseDescription(details.description, details.size);
      objectDetails.push({
        id,
        description: details.description,
        size: details.size,
        frameCount: details.frameIndices.length,
        frameIndices: details.frameIndices,
        frameUrls: details.frameUrls,
        parsed,
      });
      fetched++;
      if (fetched % 10 === 0) console.log(`  Fetched ${fetched} new objects...`);
      await sleep(100); // Rate limit
    } catch (e) {
      console.error(`  Error getting ${id}: ${e.message}`);
      objectDetails.push({
        id,
        description: '',
        size: '',
        frameCount: 0,
        frameIndices: [],
        frameUrls: {},
        parsed: { field: null, prefix: '', dir: '', biome: 'unknown', objName: 'unknown' },
        error: e.message,
      });
    }
  }

  // Save mapping
  fs.writeFileSync(mappingPath, JSON.stringify(objectDetails, null, 2));
  console.log(`\nSaved ${objectDetails.length} object mappings to ${mappingPath}`);

  if (mode === 'details') return;

  // Step 3: Select frames and download
  console.log('\nSelecting frames and downloading...');
  let selected = 0;
  let selectFailed = 0;
  let downloaded = 0;
  let downloadFailed = 0;
  let alreadyHave = 0;

  for (let i = 0; i < objectDetails.length; i++) {
    const obj = objectDetails[i];
    if (!obj.frameIndices || obj.frameIndices.length === 0) continue;

    // Select frames
    if (mode === 'all' || mode === 'select') {
      const selectResult = await selectAllFrames(obj.id, obj.frameIndices);
      if (selectResult.ok) {
        selected++;
      } else if (selectResult.reason === 'already_selected') {
        // Fine, already done
      } else {
        selectFailed++;
        console.error(`  Select failed for ${obj.id}: ${selectResult.reason}`);
      }
      if ((selected + selectFailed) % 10 === 0) {
        console.log(`  Selected: ${selected}, Failed: ${selectFailed}`);
      }
      await sleep(100);
    }

    // Download frames
    if (mode === 'all' || mode === 'download') {
      const stagingDir = path.join(STAGING, obj.id);

      // Check if already have files
      let existingPngs = 0;
      if (fs.existsSync(stagingDir)) {
        existingPngs = fs.readdirSync(stagingDir).filter(f => f.endsWith('.png')).length;
      }

      if (existingPngs >= obj.frameIndices.length * 0.8) {
        alreadyHave++;
        continue; // Already downloaded enough
      }

      fs.mkdirSync(stagingDir, { recursive: true });

      // Download frames in parallel batches of 10
      const urls = Object.entries(obj.frameUrls || {});
      for (let j = 0; j < urls.length; j += 10) {
        const batch = urls.slice(j, j + 10);
        const promises = batch.map(([idx, url]) => {
          const dest = path.join(stagingDir, `frame_${idx}.png`);
          if (fs.existsSync(dest)) return Promise.resolve();
          return downloadFile(url, dest).catch(e => {
            console.error(`  Download failed: ${obj.id}/frame_${idx}: ${e.message}`);
            downloadFailed++;
          });
        });
        await Promise.all(promises);
        downloaded += batch.length;
      }
    }

    if (i % 20 === 0) {
      console.log(`  Progress: ${i}/${objectDetails.length}`);
    }
  }

  console.log(`\nSelection: ${selected} selected, ${selectFailed} failed`);
  console.log(`Download: ${downloaded} new, ${alreadyHave} already had, ${downloadFailed} failed`);

  // Step 4: Organize files to final paths
  if (mode === 'all' || mode === 'organize') {
    console.log('\nOrganizing files to final paths...');
    let organized = 0;
    let orgFailed = 0;
    const pathCounts = {};

    for (const obj of objectDetails) {
      if (!obj.parsed || !obj.parsed.dir || !obj.parsed.biome || obj.parsed.biome === 'unknown') {
        orgFailed++;
        continue;
      }

      const stagingDir = path.join(STAGING, obj.id);
      if (!fs.existsSync(stagingDir)) continue;

      const pngFiles = fs.readdirSync(stagingDir).filter(f => f.endsWith('.png')).sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

      if (pngFiles.length === 0) continue;

      const { prefix, dir, biome, objName } = obj.parsed;
      const targetDir = path.join(MICRO, dir, biome, objName);
      fs.mkdirSync(targetDir, { recursive: true });

      // Count existing files to set version offset
      const existing = fs.existsSync(targetDir)
        ? fs.readdirSync(targetDir).filter(f => f.endsWith('.png')).length
        : 0;

      let copied = 0;
      for (let i = 0; i < pngFiles.length; i++) {
        const vNum = String(existing + i).padStart(3, '0');
        const destFile = path.join(targetDir, `${prefix}__${biome}__${objName}__v${vNum}.png`);

        if (fs.existsSync(destFile)) continue;

        const srcFile = path.join(stagingDir, pngFiles[i]);
        // Verify PNG
        const buf = Buffer.alloc(4);
        const fd = fs.openSync(srcFile, 'r');
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        if (buf[0] !== 0x89 || buf[1] !== 0x50) continue;

        fs.copyFileSync(srcFile, destFile);
        copied++;
      }

      organized += copied;
      const key = `${dir}/${biome}/${objName}`;
      pathCounts[key] = (pathCounts[key] || 0) + copied;
    }

    console.log(`\nOrganized ${organized} files, ${orgFailed} objects couldn't be parsed`);
    console.log('\nFiles by path:');
    for (const [key, count] of Object.entries(pathCounts).sort()) {
      console.log(`  ${key}: ${count}`);
    }
  }
}

main().catch(console.error);
