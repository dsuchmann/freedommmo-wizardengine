const fs = require('fs');

// Read all source pieces
const config = fs.readFileSync('_generated_config.txt', 'utf8');
const fullSect = fs.readFileSync('_full_section.txt', 'utf8');
const tileSect = fs.readFileSync('_tilepainter_section.txt', 'utf8');
const curr = fs.readFileSync('src/render/tile-painter.js', 'utf8');

// PART 1: Imports header
let result = `import { rand2, smoothNoise } from '../core/random.js';
import { paletteFor } from './palette.js';
import { paintMicroLayers } from './micro-layer-painter.js';
import { buildLandscapeRecipe } from './landscape-recipe.js';

// ============================================================
// PixelLab base target colors — RGB for each biome material
// ============================================================
const PIXEL_BASE_TARGET_RGB = Object.freeze({
  'swamp/wet_mud': [62, 72, 52],
  'swamp/mud_pool': [42, 54, 38],
  'beach/sand': [194, 178, 138],
  'forest/soil': [72, 58, 38],
});

const PIXEL_SWAMP_DECALS = {};
const PIXEL_SWAMP_TRANSITION_WANG = {};
const PIXEL_SWAMP_TRANSITION_SETS = {};
const PIXEL_TRANSITION_TARGET_RGB = {};

const preparedPixelBaseCache = new Map();
const pixelBaseImageCache = new Map();
const prerenderedWang = new Map();

`;

// PART 2: Generated PIXEL_BASE config
result += config + '\n\n';

// PART 3: Helper functions from current file
const importEnd = curr.indexOf('export function shade');
const macroStart = curr.indexOf('function paintSwampMacroObjects');
result += curr.substring(importEnd, macroStart) + '\n\n';

// PART 4: Macro objects
const macroEnd = curr.indexOf('function paintSwampPixelLocalOverlays');
result += curr.substring(macroStart, macroEnd) + '\n\n';

// PART 5: Full section (paintSwampPixelLocalOverlays + paintPixelLabBase)
result += fullSect + '\n\n';

// PART 6: paintTerrainTile from tile section
const terrainIdx = tileSect.indexOf('export function paintTerrainTile');
result += tileSect.substring(terrainIdx) + '\n\n';

// PART 7: End of file
const compEnd = curr.indexOf('export function paintCompositorDebugLayer');
result += '\n' + curr.substring(compEnd);

fs.writeFileSync('src/render/tile-painter.js', result, 'utf8');
console.log('Written:', result.length, 'bytes,', result.split('\n').length, 'lines');
console.log('Has paintPixelLabBase:', result.includes('function paintPixelLabBase'));
console.log('Has paintSwampPixelLocalOverlays:', result.includes('function paintSwampPixelLocalOverlays'));
console.log('Has PIXEL_BASE_TILE_VARIANTS with content:', result.includes('v000'));
