const fs = require('fs');

// Read fragments
const curr = fs.readFileSync('src/render/tile-painter.js', 'utf8');
const fullSect = fs.readFileSync('_full_section.txt', 'utf8');
const tileSect = fs.readFileSync('_tilepainter_section.txt', 'utf8');

// Part 1: Imports
const importEnd = curr.indexOf('export function shade');
const header = curr.substring(0, importEnd);

// Part 2: Shade/tint/clamp etc from current file
const shadeFn = curr.substring(importEnd, curr.indexOf('function paintSwampMacroObjects'));

// Part 3: Macro objects from current file  
const macroFn = curr.substring(
  curr.indexOf('function paintSwampMacroObjects'),
  curr.indexOf('function assembleLandscapeLayers')
);

// Part 4: Full section (paintSwampPixelLocalOverlays + paintPixelLabBase)
// Find paintPixelLabBase start in fullSect
const plabIdx = fullSect.indexOf('function paintPixelLabBase');
const localFn = fullSect.substring(0, plabIdx);
const plabFn = fullSect.substring(plabIdx);

// Part 5: Tile section (assembleLandscapeLayers + paintTerrainTile + rest)
const alIdx = tileSect.indexOf('function assembleLandscapeLayers');
const terraFn = tileSect.substring(alIdx);

// Part 6: End of file from current
const compEnd = curr.indexOf('export function paintCompositorDebugLayer');
const endPart = curr.substring(compEnd);

// Build final
const result = [
  header.trim(),
  shadeFn.trim(),
  macroFn.trim(),
  localFn.trim(),
  plabFn.trim(),
  terraFn.trim(),
  endPart.trim()
].join('\n\n');

fs.writeFileSync('src/render/tile-painter.js', result, 'utf8');
console.log('Written:', result.length, 'bytes,', result.split('\n').length, 'lines');
console.log('Has paintPixelLabBase:', result.includes('function paintPixelLabBase'));
console.log('Has paintSwampPixelLocalOverlays:', result.includes('function paintSwampPixelLocalOverlays'));
console.log('Has paintTerrainTile:', result.includes('function paintTerrainTile'));
console.log('Has assembleLandscapeLayers:', result.includes('function assembleLandscapeLayers'));
