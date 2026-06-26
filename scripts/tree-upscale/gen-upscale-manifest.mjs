#!/usr/bin/env node
// gen-upscale-manifest.mjs — scan large_flora for produced @384 upscales and write a manifest the
// renderer loads to decide which F6 sprites/frames to draw at 384 (bigger, detailed) vs the 192 source.
//
// Output: assets/pixelab/landscape_v2/micro/large_flora/_upscaled.json — a SORTED array of source keys
// (path under large_flora, no extension, no @384), e.g.:
//   "dense_forest/ancient_oak/v000"
//   "dense_forest/ancient_oak/_states/frozen/v000"
//   "dense_forest/ancient_oak/anim/wind_sway/v000/frame_000"
// The renderer rebuilds the same key from a sprite/frame URL and swaps in @384 only when it's listed.
//
// Re-run this AFTER a comfy-batch run to refresh (it's cheap — a directory walk). Only counts PLAIN
// "<stem>@384.png" outputs; ignores tuning-tagged "<stem>@384_dn30.png" experiments.
//
// Usage: node scripts/tree-upscale/gen-upscale-manifest.mjs

import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..', '..');
const LF = path.join(REPO, 'assets', 'pixelab', 'landscape_v2', 'micro', 'large_flora');
const OUT = path.join(LF, '_upscaled.json');

if (!fs.existsSync(LF)) { console.error('no large_flora dir at', LF); process.exit(1); }

const keys = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(p); continue; }
    // PLAIN @384 output only: "<stem>@384.png" (not "<stem>@384_dn30.png")
    if (!ent.name.endsWith('@384.png')) continue;
    const rel = path.relative(LF, p).split(path.sep).join('/');     // forward slashes for URLs
    keys.push(rel.slice(0, -('@384.png'.length)));                  // drop "@384.png" -> source key
  }
}
walk(LF);
keys.sort();

fs.writeFileSync(OUT, JSON.stringify(keys));
// brief summary by type
const byType = {};
for (const k of keys) { const parts = k.split('/'); const t = parts[0] + '/' + parts[1]; byType[t] = (byType[t] || 0) + 1; }
console.log(`wrote ${keys.length} upscaled keys -> ${path.relative(REPO, OUT)}`);
for (const [t, n] of Object.entries(byType).sort()) console.log(`  ${t}: ${n}`);
