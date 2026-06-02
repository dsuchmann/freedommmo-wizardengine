const fs = require('fs');
const path = require('path');

// ==================== CONFIG GENERATION ====================
const baseDir = 'assets/pixelab/landscape_v2/base';
const families = fs.readdirSync(baseDir).filter(f => 
  fs.statSync(path.join(baseDir, f)).isDirectory()
);

// Build PIXEL_BASE_TILE_VARIANTS
function buildVariants(name) {
  const dir = path.join(baseDir, name, 'tiles');
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.png'))
      .sort()
      .map(f => 'assets/pixelab/landscape_v2/base/' + name.replace(/_/g, '/') + '/tiles/' + f);
  } catch (e) { return []; }
}

function buildWang(name) {
  const dir = path.join(baseDir, name, 'wang');
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
    const result = {};
    files.forEach(f => {
      const m = f.match(/wang__v(\d+)/);
      if (m) result[parseInt(m[1])] = 'assets/pixelab/landscape_v2/base/' + name.replace(/_/g, '/') + '/wang/' + f;
    });
    return result;
  } catch (e) { return {}; }
}

const parts = [];
parts.push('// Auto-generated PixelLab variant config');
parts.push('');
parts.push('const PIXEL_BASE_TILE_VARIANTS = {');
families.forEach(f => {
  const v = buildVariants(f);
  const key = f.replace(/_/g, '/');
  parts.push('  \'' + key + '\': ' + JSON.stringify(v) + ',');
});
parts.push('};');

parts.push('');
parts.push('const PIXEL_BASE_WANG_VARIANTS = {');
families.forEach(f => {
  const w = buildWang(f);
  const key = f.replace(/_/g, '/');
  parts.push('  \'' + key + '\': ' + JSON.stringify(w) + ',');
});
parts.push('};');

parts.push('');
parts.push('const PIXEL_BASE_FOUNDATION_SRC = {};');

const config = parts.join('\n');
fs.writeFileSync('_generated_config.txt', config);
console.log('Config written:', config.length, 'bytes');
