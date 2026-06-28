// scripts/qa-gate.mjs [field] [--apply]
// Reads tools/field-manifest.<field>.json (run gen-field-manifest first) and reports the deterministic QA flags
// per species. With --apply, UNIONs every BLANK variant into the curation omit-set — the only auto-safe reject
// (empty / failed magenta renders). All other flags (GROUND, SQUARE, CROP, SCALE) are ADVISORY for human review
// and are never auto-omitted. Non-destructive: only the omit-set sidecar is touched, never the PNGs. Works for
// any field; set FIELD_ASSET_ROOT to point the sidecar at the main checkout for gitignored fields (large_objects).
import fs from 'fs';
import path from 'path';
import url from 'url';
import { loadCuration, saveCuration } from './lib/field-curation.mjs';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const field = process.argv.slice(2).find(a => !a.startsWith('--')) || 'large_objects';
const apply = process.argv.includes('--apply');
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', `field-manifest.${field}.json`), 'utf8'));

const counts = {};
const failed = {};            // "biome/species" -> [v...]  (BLANK magenta plate OR BROKEN undecodable stub = a failed render)
let total = 0, flagged = 0;
for (const biome in man.biomes) for (const sp in man.biomes[biome]) {
  const key = `${biome}/${sp}`;
  for (const v of man.biomes[biome][sp].variants) {
    total++;
    const fl = (v.qa && v.qa.flags) || [];
    if (fl.length) flagged++;
    for (const f of fl) counts[f] = (counts[f] || 0) + 1;
    if (fl.includes('BLANK') || fl.includes('BROKEN')) (failed[key] = failed[key] || []).push(v.v);
  }
}
console.log(`field ${field}: ${total} variants, ${flagged} carry >=1 QA flag`);
console.log(`flag counts: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join('  ') || '(none)'}`);
const failKeys = Object.keys(failed).sort();
const failTotal = failKeys.reduce((s, k) => s + failed[k].length, 0);
console.log(`FAILED renders (BLANK + BROKEN, auto-rejectable): ${failTotal} variants across ${failKeys.length} species`);
for (const k of failKeys.slice(0, 40)) console.log(`  ${k}: ${failed[k].length}`);

if (!apply) { console.log(`\n(report only — pass --apply to UNION the failed-render variants into the ${field} omit-set)`); process.exit(0); }
const cur = loadCuration(field);
let added = 0;
for (const [key, vs] of Object.entries(failed)) {
  const set = new Set(cur.omits[key] || []);
  const before = set.size;
  for (const v of vs) set.add(v);
  if (set.size !== before) { cur.omits[key] = [...set].sort((a, b) => a - b); added += set.size - before; }
}
cur.history = [...(cur.history || []), { appliedAt: new Date().toISOString(), source: 'qa-gate:BLANK', added }];
saveCuration(field, cur);
console.log(`\napplied: +${added} new BLANK variants unioned into the ${field} omit-set${added ? ' (sidecar updated)' : ' (no change — already omitted)'}`);
