#!/usr/bin/env node
// gen-upscale-manifest.mjs — scan each decoration field for produced @384 upscales and write, PER FIELD,
// a manifest the renderer loads to decide which sprites/frames to draw at 384 (bigger, detailed) vs the
// native source. One file per field: assets/pixelab/landscape_v2/micro/<field>/_upscaled.json
//
// Each manifest is a SORTED array of source keys (path under that field's dir, no extension, no @384), e.g.
// for large_flora:
//   "dense_forest/ancient_oak/v000"
//   "dense_forest/ancient_oak/_states/frozen/v000"
//   "dense_forest/ancient_oak/anim/wind_sway/v000/frame_000"
// The renderer rebuilds the same key from a sprite/frame URL and swaps in @384 only when it's listed.
//
// Re-run this AFTER a comfy-batch / apply-upscale-decisions run to refresh (it's cheap — a directory walk).
// Only counts PLAIN "<stem>@384.png" outputs; ignores tuning-tagged "<stem>@384_dn30.png" experiments.
//
// The large_flora output is byte-identical to the original F6-only generator (same walk, sort, compact JSON).
//
// Fields come from fields.json. Set FIELD_ASSET_ROOT to point the per-field corpora at a different base
// (e.g. an offline test fixture); default is <repo>/assets/pixelab/landscape_v2/micro.
//
// Usage:
//   node scripts/tree-upscale/gen-upscale-manifest.mjs              # regen every field's manifest
//   node scripts/tree-upscale/gen-upscale-manifest.mjs --field medium_flora   # just one field

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const FIELDS = JSON.parse(fs.readFileSync(path.join(HERE, 'fields.json'), 'utf8'));

// Base dir that contains the per-field corpora. FIELD_ASSET_ROOT overrides for fixtures/tests.
const MICRO_BASE = process.env.FIELD_ASSET_ROOT
  ? path.resolve(process.env.FIELD_ASSET_ROOT)
  : path.join(REPO, 'assets', 'pixelab', 'landscape_v2', 'micro');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const ONLY_FIELD = arg('field');

// Collect every plain "<stem>@384.png" under a field dir, keyed by path relative to that dir.
function walk(dir, fieldDir, keys) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(p, fieldDir, keys); continue; }
    if (!ent.name.endsWith('@384.png')) continue;                  // PLAIN @384 only (not "@384_dn30.png")
    const rel = path.relative(fieldDir, p).split(path.sep).join('/'); // forward slashes for URLs
    keys.push(rel.slice(0, -('@384.png'.length)));                 // drop "@384.png" -> source key
  }
  return keys;
}

function genField(field) {
  const dir = path.join(MICRO_BASE, field);
  if (!fs.existsSync(dir)) { console.log(`  ${field}: no dir (skipped)`); return; }
  const keys = walk(dir, dir, []);
  keys.sort();
  const out = path.join(dir, '_upscaled.json');
  fs.writeFileSync(out, JSON.stringify(keys));
  // brief per-object summary
  const byObj = {};
  for (const k of keys) { const parts = k.split('/'); const t = parts[0] + '/' + parts[1]; byObj[t] = (byObj[t] || 0) + 1; }
  console.log(`wrote ${keys.length} upscaled keys -> ${path.relative(REPO, out) || out}`);
  for (const [t, n] of Object.entries(byObj).sort()) console.log(`    ${t}: ${n}`);
}

const fieldNames = ONLY_FIELD ? [ONLY_FIELD] : Object.keys(FIELDS);
for (const f of fieldNames) genField(f);
