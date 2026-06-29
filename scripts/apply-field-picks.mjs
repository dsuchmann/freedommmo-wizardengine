// scripts/apply-field-picks.mjs <field-picks.json>
// Merges a dashboard export into the durable curation sidecar (the omit-set), then re-runs gen-mf-catalog so the
// in-game catalog excludes the omitted variants via vmap. Non-destructive: no PNGs are moved or deleted.
import fs from 'fs';
import { execFileSync } from 'child_process';
import { loadCuration, mergePicks, saveCuration } from './lib/field-curation.mjs';

const p = process.argv[2];
if (!p) { console.error('usage: node scripts/apply-field-picks.mjs <field-picks.json>'); process.exit(2); }
const picks = JSON.parse(fs.readFileSync(p, 'utf8'));
const field = picks.field || 'f6';
const next = mergePicks(loadCuration(field), picks, new Date().toISOString());
saveCuration(field, next);
const summary = Object.fromEntries(Object.entries(next.omits).map(([k, v]) => [k, v.length]));
console.log(`omits now:`, JSON.stringify(summary));
console.log(`regen worklist: ${next.regenWorklist.length} variants`);

const VMAP_SOURCES = new Set(['f4', 'f5', 'f6', 'f2']); // sources with an auto-generated vmap catalog (gen-mf-catalog)
// Refresh this source's dashboard manifest so its omit flags reflect the new sidecar.
execFileSync('node', ['scripts/gen-field-manifest.mjs', field], { stdio: 'inherit' });
// Cull from the in-game catalog only for the vmap-backed landscape sources; others (dressing, F2/F3) record the
// omit-set here and cull via their own renderer/index when that wiring lands.
if (VMAP_SOURCES.has(field)) {
  execFileSync('node', ['scripts/gen-mf-catalog.mjs'], { stdio: 'inherit' });
} else {
  console.log(`(${field}: omit-set recorded + manifest refreshed; in-game cull wires via its own system separately.)`);
}
