// scripts/curate-large-objects.mjs <field-picks.large_objects.json>
// One-off: large_objects assets live in the MAIN checkout (gitignored, absent from this worktree), so the
// generic apply-field-picks (which roots at the worktree) can't see them. This reuses the canonical
// mergePicks transform but writes the durable curation sidecar into the MAIN asset root, then scans the real
// assets to emit a kept-vs-removed manifest + the flat list of removed PNGs to analyze. Non-destructive.
import fs from 'fs';
import path from 'path';
import { mergePicks } from './lib/field-curation.mjs';

const ASSET_ROOT = 'C:/Users/daves/AppData/Roaming/wizardgenie/projects/default/assets/pixelab/landscape_v2/micro/large_objects';
const SIDECAR = path.join(ASSET_ROOT, '_large_objects_curation.json');
const FILE_RE = /^lg__.*__v(\d{3})\.png$/;

const picksPath = process.argv[2];
if (!picksPath) { console.error('usage: node scripts/curate-large-objects.mjs <picks.json>'); process.exit(2); }
const picks = JSON.parse(fs.readFileSync(picksPath, 'utf8'));

// 1) Durable sidecar via the canonical merge (REPLACE-per-touched-species).
const prior = fs.existsSync(SIDECAR)
  ? JSON.parse(fs.readFileSync(SIDECAR, 'utf8'))
  : { field: 'large_objects', omits: {}, history: [], regenWorklist: [] };
prior.field = 'large_objects';
const next = mergePicks(prior, picks, new Date().toISOString());
fs.writeFileSync(SIDECAR, JSON.stringify(next, null, 1) + '\n');

// 2) Scan the real assets -> kept vs removed per species, verifying every omit maps to a real file.
const omit = new Map(Object.entries(next.omits).map(([k, vs]) => [k, new Set(vs)]));
const manifest = {};
const removedFiles = [];        // flat list of absolute paths (analysis input)
let totalKept = 0, totalRemoved = 0;
const missing = [];             // omit indices with no matching file on disk
const dirMissing = [];          // species in picks whose dir is absent on disk

for (const [key, omitSet] of omit) {
  const [biome, species] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)];
  const dir = path.join(ASSET_ROOT, biome, species);
  if (!fs.existsSync(dir)) { dirMissing.push(key); continue; }
  const onDisk = new Map();     // v -> filename
  for (const f of fs.readdirSync(dir)) { const m = f.match(FILE_RE); if (m) onDisk.set(parseInt(m[1], 10), f); }
  const kept = [], removed = [];
  for (const v of [...onDisk.keys()].sort((a, b) => a - b)) (omitSet.has(v) ? removed : kept).push(v);
  for (const v of omitSet) {
    if (!onDisk.has(v)) missing.push(`${key}:v${String(v).padStart(3, '0')}`);
    else removedFiles.push(path.join(dir, onDisk.get(v)));
  }
  manifest[key] = { keptCount: kept.length, removedCount: removed.length, onDisk: onDisk.size, kept, removed };
  totalKept += kept.length; totalRemoved += removed.length;
}

const TOOLS = path.join(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..', 'tools');
fs.mkdirSync(TOOLS, { recursive: true });
fs.writeFileSync(path.join(TOOLS, 'large-objects-curation-manifest.json'),
  JSON.stringify({ generatedAt: next.history.at(-1).appliedAt, assetRoot: ASSET_ROOT,
    totals: { speciesTouched: omit.size, kept: totalKept, removed: totalRemoved, missing: missing.length },
    dirMissing, missing, perSpecies: manifest }, null, 1) + '\n');
fs.writeFileSync(path.join(TOOLS, 'large-objects-removed-files.json'), JSON.stringify(removedFiles, null, 0));

console.log(`sidecar  -> ${SIDECAR}`);
console.log(`species touched: ${omit.size}`);
console.log(`removed (records): ${totalRemoved}  | kept-after: ${totalKept}  | on-disk missing: ${missing.length}  | dirs missing: ${dirMissing.length}`);
console.log(`removed files resolved on disk: ${removedFiles.length}`);
if (dirMissing.length) console.log(`DIRS MISSING: ${dirMissing.join(', ')}`);
if (missing.length) console.log(`FIRST MISSING: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' …' : ''}`);
