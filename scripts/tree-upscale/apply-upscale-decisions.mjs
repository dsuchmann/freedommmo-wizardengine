#!/usr/bin/env node
// apply-upscale-decisions.mjs — turn an upscale-studio decision store into on-disk reality + a refreshed
// per-field manifest. Companion to gen-upscale-manifest.mjs / apply-mix.mjs / comfy-batch.py.
//
// Input: an upscale-decisions.json (the dashboard's export), schema (spec §3):
//   { "field": "medium_flora",
//     "decisions": {
//       "grassland/cornflower":    { "mode": "blend",  "blendPct": 40 },
//       "grassland/fence_post":    { "mode": "direct" },
//       "grassland/daisy_cluster": { "mode": "upscale",
//                                    "overrides": { "v007": { "mode": "direct" } } } } }
//   blendPct = the ORIGINAL's share (matches apply-mix --pct). Per-variant overrides win over object mode.
//
// Per object (and per overridden variant) the three modes resolve to:
//   • upscale — keep the AI @384 (raw). This tool does NOT run the GPU; if any @384 is missing it PRINTS
//               the exact `python comfy-batch.py --field <f> --biome <b> --type <o>` to run, and treats
//               existing @384 as satisfied. A previously-quarantined @384 is restored.
//   • blend   — ensure @384, then apply-mix scoped to that field/biome/object (per-variant when needed) at
//               the object's blendPct. Backed up + revertible exactly like a normal apply-mix run.
//   • direct  — no @384: any @384 for that variant is MOVED (never deleted) to
//               tools/_premix/_direct_quarantine/<field>/… so the manifest excludes it. Reversible.
// Then the field's manifest is regenerated so the game seam (upscaleUrl) draws each pick at draw scale.
//
// FIELD_ASSET_ROOT overrides the corpus base (offline test fixtures); premix/quarantine follow it.
//
// Usage:
//   node scripts/tree-upscale/apply-upscale-decisions.mjs --decisions path/to/upscale-decisions.json
//   node scripts/tree-upscale/apply-upscale-decisions.mjs --decisions … --dry   # plan only, touch nothing

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes('--' + k);
const DECISIONS = arg('decisions');
const DRY = has('dry');

if (!DECISIONS) { console.error('usage: apply-upscale-decisions.mjs --decisions <path> [--dry]'); process.exit(2); }
if (!fs.existsSync(DECISIONS)) { console.error('no decisions file at', DECISIONS); process.exit(2); }

const MICRO_BASE = process.env.FIELD_ASSET_ROOT
  ? path.resolve(process.env.FIELD_ASSET_ROOT)
  : path.join(REPO, 'assets/pixelab/landscape_v2/micro');
const PREMIX_BASE = process.env.FIELD_ASSET_ROOT ? path.join(MICRO_BASE, '_premix') : path.join(REPO, 'tools/_premix');
const QUARANTINE = path.join(PREMIX_BASE, '_direct_quarantine');

const store = JSON.parse(fs.readFileSync(DECISIONS, 'utf8'));
const FIELD = store.field;
if (!FIELD) { console.error('decisions file missing top-level "field"'); process.exit(2); }
const DECS = store.decisions || {};

const FIELD_DIR = path.join(MICRO_BASE, FIELD);
if (!fs.existsSync(FIELD_DIR)) { console.error(`no field dir at ${FIELD_DIR}`); process.exit(2); }

// --- helpers ----------------------------------------------------------------
function walkFiles(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}
// The variant token (e.g. "v007") for a sprite/frame path: a "v###" path segment (anim frames sit under
// ".../<v>/frame_xxx") or a "v###" suffix on the filename stem (sf__x__v001 / lg__x__v003 / v000).
function variantOf(relPath) {
  const noExt = relPath.replace(/@384\.png$/, '').replace(/\.png$/, '');
  const segs = noExt.split('/');
  for (let i = segs.length - 1; i >= 0; i--) if (/^v\d+$/.test(segs[i])) return segs[i];
  const m = segs[segs.length - 1].match(/v\d+$/);
  return m ? m[0] : null;
}
const relUnder = (root, file) => path.relative(root, file).split(path.sep).join('/');
function moveFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
}

// run apply-mix scoped to this field/biome/object (optionally one variant) at pct
function runApplyMix(biome, object, variant, pct) {
  const a = ['apply-mix.mjs', '--field', FIELD, '--biome', biome, '--type', object, '--pct', String(pct)];
  if (variant) a.push('--variant', variant);
  if (DRY) { console.log('      would run: node scripts/tree-upscale/' + a.join(' ')); return; }
  const r = spawnSync(process.execPath, [path.join(HERE, 'apply-mix.mjs'), ...a.slice(1)], {
    encoding: 'utf8', env: process.env,
  });
  if (r.status !== 0) console.error('      apply-mix failed:', r.stderr || r.stdout || ('exit ' + r.status));
  else process.stdout.write(((r.stdout || '').trim().split('\n').map((l) => '      ' + l).join('\n')) + '\n');
}

const counts = { upscale: 0, blend: 0, direct: 0, quarantined: 0, restored: 0, cmds: 0 };
const cmds = [];

// --- per-object ------------------------------------------------------------
for (const objKey of Object.keys(DECS).sort()) {
  const dec = DECS[objKey];
  const slash = objKey.indexOf('/');
  const biome = slash >= 0 ? objKey.slice(0, slash) : objKey;
  const object = slash >= 0 ? objKey.slice(slash + 1) : '';
  const objDir = path.join(FIELD_DIR, biome, object);
  const objMode = dec.mode || 'direct';
  const objPct = dec.blendPct != null ? dec.blendPct : 40;
  const overrides = dec.overrides || {};

  console.log(`\n${FIELD}/${objKey}  [${objMode}${objMode === 'blend' ? ' ' + objPct + '%' : ''}${Object.keys(overrides).length ? ' +' + Object.keys(overrides).length + ' override(s)' : ''}]`);
  if (!fs.existsSync(objDir)) { console.log('  (no object dir on disk — skipped)'); continue; }

  const effMode = (v) => (overrides[v] && overrides[v].mode) || objMode;
  const effPct = (v) => (overrides[v] && overrides[v].blendPct != null ? overrides[v].blendPct
    : (dec.blendPct != null ? dec.blendPct : 40));

  // (a) RESTORE any quarantined @384 for variants that are now NON-direct (mode toggled back).
  const qDir = path.join(QUARANTINE, FIELD, biome, object);
  for (const qf of walkFiles(qDir, [])) {
    if (!qf.endsWith('@384.png')) continue;
    const rel = relUnder(qDir, qf);
    if (effMode(variantOf(rel)) === 'direct') continue;             // still direct → leave quarantined
    const dst = path.join(objDir, rel);
    if (DRY) { console.log('  would restore from quarantine:', rel); counts.restored++; continue; }
    moveFile(qf, dst); counts.restored++;
    console.log('  restored from quarantine:', rel);
  }

  // (b) QUARANTINE @384 for variants that are now direct (no @384 → excluded from the manifest).
  for (const f of walkFiles(objDir, [])) {
    if (!f.endsWith('@384.png')) continue;
    const rel = relUnder(objDir, f);
    if (effMode(variantOf(rel)) !== 'direct') continue;
    const dst = path.join(qDir, rel);
    if (DRY) { console.log('  would quarantine (direct):', rel); counts.quarantined++; continue; }
    moveFile(f, dst); counts.quarantined++;
  }

  // What variants exist on disk (from base + remaining @384), and their effective modes.
  const variants = new Set();
  for (const f of walkFiles(objDir, [])) { if (f.endsWith('.png')) { const v = variantOf(relUnder(objDir, f)); if (v) variants.add(v); } }
  const remaining = [...variants].filter((v) => effMode(v) !== 'direct');
  const blendVs = remaining.filter((v) => effMode(v) === 'blend');
  const upscaleVs = remaining.filter((v) => effMode(v) === 'upscale');

  // (c) UPSCALE — keep raw; flag missing @384 → print the GPU command (never run it here).
  if (upscaleVs.length) {
    counts.upscale += upscaleVs.length;
    let missing = 0;
    for (const f of walkFiles(objDir, [])) {
      if (!f.endsWith('.png') || f.endsWith('@384.png')) continue;
      const v = variantOf(relUnder(objDir, f));
      if (effMode(v) !== 'upscale') continue;
      if (!fs.existsSync(f.replace(/\.png$/, '@384.png'))) missing++;
    }
    if (missing) {
      const cmd = `python comfy-batch.py --field ${FIELD} --biome ${biome} --type ${object}`;
      console.log(`  upscale: ${missing} sprite(s) lack @384 → RUN:  ${cmd}`);
      cmds.push(cmd); counts.cmds++;
    } else {
      console.log(`  upscale: @384 present for all ${upscaleVs.length} variant(s) — satisfied`);
    }
  }

  // (d) BLEND — apply-mix object-scoped when it's the whole object at one pct; else per-variant.
  if (blendVs.length) {
    counts.blend += blendVs.length;
    const pcts = new Set(blendVs.map(effPct));
    if (upscaleVs.length === 0 && pcts.size === 1) {
      runApplyMix(biome, object, null, [...pcts][0]);               // efficient whole-object blend
    } else {
      for (const v of blendVs) runApplyMix(biome, object, v, effPct(v)); // mixed object → per variant
    }
  }

  if (objMode === 'direct' && !blendVs.length && !upscaleVs.length) counts.direct++;
}

// --- regenerate this field's manifest --------------------------------------
console.log('\nregenerating manifest for field', FIELD, '…');
if (DRY) {
  console.log('  would run: node scripts/tree-upscale/gen-upscale-manifest.mjs --field ' + FIELD);
} else {
  const r = spawnSync(process.execPath, [path.join(HERE, 'gen-upscale-manifest.mjs'), '--field', FIELD], { encoding: 'utf8', env: process.env });
  process.stdout.write((r.stdout || '') + (r.stderr || ''));
}

// --- summary ---------------------------------------------------------------
console.log(`\n${DRY ? 'DRY — ' : ''}done: ${counts.upscale} upscale · ${counts.blend} blend · ${counts.quarantined} quarantined · ${counts.restored} restored`);
if (cmds.length) {
  console.log('\nGPU still needed (run these, then re-run gen-upscale-manifest.mjs):');
  for (const c of cmds) console.log('  ' + c);
}
