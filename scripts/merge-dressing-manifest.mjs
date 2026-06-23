// Merge + verify the building-dressing manifest parts into one manifest.
// Reusable: re-run after authoring more biomes/fields. Node ESM.
import fs from 'fs';
import path from 'path';

const dir = path.resolve('docs/superpowers/specs/dressing-manifest-parts');
const out = path.resolve('docs/superpowers/specs/2026-06-23-dressing-manifest.json');
const fields = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'];

const parts = {};
for (const f of fields) parts[f] = JSON.parse(fs.readFileSync(path.join(dir, f + '.json'), 'utf8'));

// Normalize any leftover uppercase D7_ ids to lowercase (nothing references them; keeps the manifest uniform).
for (const c of parts.D7.categories || []) {
  if (/^D7_/.test(c.id)) c.id = 'd7_' + c.id.slice(3);
  for (const o of c.objects || []) if (/^D7_/.test(o.id)) o.id = 'd7_' + o.id.slice(3);
}

const ids = new Set();
for (const f of fields)
  for (const c of parts[f].categories || []) {
    ids.add(c.id);
    for (const o of c.objects || []) ids.add(o.id);
  }

function holdsIds(attach) {
  if (!attach || attach === 'none') return [];
  if (typeof attach === 'object') return (attach.holds || []).filter((x) => typeof x === 'string');
  if (typeof attach === 'string') {
    const m = attach.match(/holds\s*=\s*\[([^\]]*)\]/);
    return m ? m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean) : [];
  }
  return [];
}

const unresolved = [], strDestruct = [], upperIds = [];
let catCount = 0, objCount = 0;
const prov = { pixellab: 0, procedural: 0, hybrid: 0, other: 0 };

for (const f of fields)
  for (const c of parts[f].categories || []) {
    catCount++;
    if (/^D[0-7]_/.test(c.id)) upperIds.push(c.id);
    for (const o of c.objects || []) {
      objCount++;
      if (/^D[0-7]_/.test(o.id)) upperIds.push(o.id);
      prov[o.source] !== undefined ? prov[o.source]++ : prov.other++;
      if (typeof o.destructible === 'string' && o.destructible !== 'none') strDestruct.push(`${f}:${o.id}`);
      for (const h of holdsIds(o.attach)) if (!ids.has(h)) unresolved.push(`${f}:${o.id} attach→${h}`);
      if (Array.isArray(o.fires)) for (const r of o.fires) if (!ids.has(r)) unresolved.push(`${f}:${o.id} fires→${r}`);
    }
  }

const manifest = {
  version: '1.0',
  generated: '2026-06-23',
  biomePilot: 'grassland',
  schemaRef: 'docs/superpowers/specs/2026-06-23-building-dressing-system-design.md',
  fields: fields.map((f) => parts[f]),
};
fs.writeFileSync(out, JSON.stringify(manifest, null, 2));

console.log(`categories=${catCount}  objects=${objCount}`);
console.log('provenance', prov);
console.log(`uppercase dN ids: ${upperIds.length}`, upperIds.slice(0, 12));
console.log(`string destructibles: ${strDestruct.length}`, strDestruct.slice(0, 12));
console.log(`unresolved refs: ${unresolved.length}`);
unresolved.slice(0, 40).forEach((u) => console.log('  ' + u));
console.log(`wrote ${out} (${fs.statSync(out).size} bytes)`);
console.log(unresolved.length === 0 && upperIds.length === 0 && strDestruct.length === 0 ? 'VERIFY: PASS' : 'VERIFY: ISSUES');
