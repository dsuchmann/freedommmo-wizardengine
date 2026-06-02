import { statSync, existsSync, writeFileSync } from 'node:fs';

const sheets = [
  'reference/godot/assets/tilesets/grassland.png',
  'reference/godot/assets/tilesets/forest.png',
  'reference/godot/assets/tilesets/desert.png',
  'reference/godot/assets/tilesets/ocean_beach.png',
  'reference/godot/assets/tilesets/grassland_lush.png'
];
const report = sheets.map(path => ({ path, exists: existsSync(path), bytes: existsSync(path) ? statSync(path).size : 0, assumedCell: 32, assumedMasks: 16 }));
writeFileSync('reference/godot/assets/wang-audit.json', JSON.stringify({ schema: 'freedommmo.godot-wang-audit.v1', report }, null, 2));
console.log(`Audited ${report.length} Wang sheets`);
