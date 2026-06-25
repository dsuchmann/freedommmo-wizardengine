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
execFileSync('node', ['scripts/gen-mf-catalog.mjs'], { stdio: 'inherit' });
