import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'reference/godot/assets';
const files = [];
walk(root);
const pngs = files.filter(f => /\.(png|webp|jpg|jpeg)$/i.test(f));
const grouped = {};
for (const file of pngs) {
  const parts = file.split(/[\\/]/);
  const group = parts.slice(3, -1).join('/') || 'root';
  (grouped[group] ??= []).push(file);
}
const catalog = { schema: 'freedommmo.godot-pixellab-asset-inventory.v1', root, count: pngs.length, groups: Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, v.sort()])) };
writeFileSync('reference/godot/assets/inventory.json', JSON.stringify(catalog, null, 2));
console.log(`Inventoried ${pngs.length} image assets`);

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.import') || name.endsWith('.tres')) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else files.push(path.replaceAll('\\\\', '/').replaceAll('\\', '/'));
  }
}
