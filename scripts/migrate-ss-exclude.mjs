// scripts/migrate-ss-exclude.mjs
// One-shot migration: seeds the F3 curation omit-set from the legacy SS_VARIANT_EXCLUDE
// map in decoration-claims.js, preserving all hand-curated exclusions in the standard
// _f3_curation.json sidecar so Field Studio can manage them going forward.
// Run once after adding f3 to field-curation.mjs SOURCES.
import { SS_VARIANT_EXCLUDE } from '../src/world/decoration-claims.js';
import { loadCuration, saveCuration } from './lib/field-curation.mjs';

const cur = loadCuration('f3');
let count = 0;
for (const [key, indices] of Object.entries(SS_VARIANT_EXCLUDE)) {
  // Sort ascending (canonical form) and deduplicate.
  cur.omits[key] = [...new Set(indices)].sort((a, b) => a - b);
  count++;
}
saveCuration('f3', cur);
console.log(`migrate-ss-exclude: seeded ${count} omit entries into _f3_curation.json`);
