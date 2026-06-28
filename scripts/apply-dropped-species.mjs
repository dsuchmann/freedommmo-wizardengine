// scripts/apply-dropped-species.mjs [field]
// Reads scripts/asset-corpus/<field>_dropped.json (a registry of scene-bound / non-object species to EXCLUDE
// wholesale and NEVER regenerate) and records droppedSpecies into that field's curation sidecar. Non-destructive:
// the variants are already omitted; this marks the SPECIES as permanently dropped so the future renderer-cull and
// the regen registry skip them. Set FIELD_ASSET_ROOT to point at the main checkout for gitignored fields.
import fs from 'fs';
import path from 'path';
import url from 'url';
import { loadCuration, saveCuration } from './lib/field-curation.mjs';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const field = process.argv[2] || 'large_objects';
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'asset-corpus', `${field}_dropped.json`), 'utf8'));
const keys = reg.droppedSpecies.map(s => s.key);
const cur = loadCuration(field);
cur.droppedSpecies = [...new Set([...(cur.droppedSpecies || []), ...keys])].sort();
saveCuration(field, cur);
console.log(`${field}: ${cur.droppedSpecies.length} species marked dropped (reason: ${reg.reason})`);
for (const k of cur.droppedSpecies) console.log(`  - ${k}`);
