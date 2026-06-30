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
//   • upscale — RUN the FULL upscale for the winner: `python comfy-batch.py --field <f> --biome <b>
//               --type <o>` (NO --base-only → base + _states + anims, ALL variants), producing the @384
//               set on disk. Idempotent/disk-first (skips sprites already @384) — skipped entirely if the
//               object is already fully @384 unless --force. A previously-quarantined @384 is restored.
//   • blend   — run that same full comfy-batch FIRST, THEN apply-mix scoped to that field/biome/object
//               (per-variant when needed) at the object's blendPct. Backed up + revertible.
//   • direct  — no @384: any @384 for that variant is MOVED (never deleted) to
//               tools/_premix/_direct_quarantine/<field>/… so the manifest excludes it. Reversible.
// Then the field's manifest is regenerated so the game seam (upscaleUrl) draws each pick at draw scale.
//
// FIELD_ASSET_ROOT overrides the corpus base (offline test fixtures); premix/quarantine follow it.
// PYTHON_BIN overrides the python interpreter used to spawn comfy-batch (default 'python').
//
// Usage:
//   node scripts/tree-upscale/apply-upscale-decisions.mjs --decisions path/to/upscale-decisions.json
//   node scripts/tree-upscale/apply-upscale-decisions.mjs --decisions … --force # regen even if @384 present
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
const FORCE = has('force');
const PY = process.env.PYTHON_BIN || 'python';   // interpreter for comfy-batch (overridable for tests/venvs)
// comfy-batch.py self-locates the REAL corpus (it ignores FIELD_ASSET_ROOT). So when FIELD_ASSET_ROOT is set
// — an offline fixture / test corpus — we CANNOT meaningfully run it (it'd target the real assets, not the
// fixture). In that mode we RECORD the full-upscale command instead of spawning, like a --dry for the GPU step.
const FIXTURE = !!process.env.FIELD_ASSET_ROOT;

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

// True when EVERY source sprite under objDir (base/state/anim frame, non-@384) already has its @384
// sibling — i.e. the full upscale set is on disk and (absent --force) we can skip re-running the GPU.
function objFullyUpscaled(objDir) {
  let sawSource = false;
  for (const f of walkFiles(objDir, [])) {
    if (!f.endsWith('.png') || f.endsWith('@384.png')) continue;
    sawSource = true;
    if (!fs.existsSync(f.replace(/\.png$/, '@384.png'))) return false;
  }
  return sawSource;   // no sources at all → not "fully upscaled" (force a run / report nothing to do)
}

// RUN the full comfy-batch for one object (NO --base-only → base + _states + anims, all variants). This is
// the step that actually GENERATES the winners' detail on disk. Disk-first/idempotent: comfy-batch skips
// sprites already @384, so re-runs are cheap. stdio:'inherit' streams ComfyUI progress straight through to
// our stdout (so the upscale-server's SSE log shows it live). --dry prints the command and runs nothing.
function runComfyBatch(biome, object) {
  const cliArgs = ['comfy-batch.py', '--field', FIELD, '--biome', biome, '--type', object];
  if (FORCE) cliArgs.push('--force');
  const cmdStr = `${PY} ${cliArgs.join(' ')}`;
  console.log(`  $ ${cmdStr}`);
  if (DRY || FIXTURE) return cmdStr;   // record only — can't run the GPU against a fixture corpus
  const r = spawnSync(PY, [path.join(HERE, 'comfy-batch.py'), ...cliArgs.slice(1)], {
    stdio: 'inherit', env: process.env, cwd: REPO,
  });
  if (r.status !== 0) console.error(`      comfy-batch exited ${r.status == null ? '(signal/' + r.signal + ')' : r.status}`);
  return cmdStr;
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
  const qDir = path.join(QUARANTINE, FIELD, biome, object);

  // Variants present on disk (from any source sprite), and their effective modes.
  const variants = new Set();
  for (const f of walkFiles(objDir, [])) { if (f.endsWith('.png') && !f.endsWith('@384.png')) { const v = variantOf(relUnder(objDir, f)); if (v) variants.add(v); } }

  // (1) GENERATE — for any UPSCALE/BLEND variant, RUN the FULL comfy-batch (states + anims + all variants)
  // so the winner gets a complete @384 set on disk. Skip if already fully @384 (unless --force). --dry prints.
  const wantGen = [...variants].some((v) => effMode(v) === 'upscale' || effMode(v) === 'blend');
  if (wantGen) {
    if (DRY || FIXTURE) {
      cmds.push(runComfyBatch(biome, object));                       // prints the command, runs nothing
      counts.cmds++;
    } else if (!FORCE && objFullyUpscaled(objDir)) {
      console.log('  generate: @384 present for every sprite — full set already on disk (use --force to redo)');
    } else {
      runComfyBatch(biome, object);
    }
  }

  // (2) RESTORE any quarantined @384 for variants that are now NON-direct (mode toggled back).
  for (const qf of walkFiles(qDir, [])) {
    if (!qf.endsWith('@384.png')) continue;
    const rel = relUnder(qDir, qf);
    if (effMode(variantOf(rel)) === 'direct') continue;             // still direct → leave quarantined
    const dst = path.join(objDir, rel);
    if (DRY) { console.log('  would restore from quarantine:', rel); counts.restored++; continue; }
    if (fs.existsSync(dst)) { fs.rmSync(qf); continue; }            // fresh @384 already regenerated → drop stale copy
    moveFile(qf, dst); counts.restored++;
    console.log('  restored from quarantine:', rel);
  }

  // (3) QUARANTINE @384 for variants that are now direct (no @384 → excluded from the manifest).
  for (const f of walkFiles(objDir, [])) {
    if (!f.endsWith('@384.png')) continue;
    const rel = relUnder(objDir, f);
    if (effMode(variantOf(rel)) !== 'direct') continue;
    const dst = path.join(qDir, rel);
    if (DRY) { console.log('  would quarantine (direct):', rel); counts.quarantined++; continue; }
    if (fs.existsSync(dst)) fs.rmSync(dst);                          // replace any stale quarantine copy
    moveFile(f, dst); counts.quarantined++;
  }

  // Effective modes after (de)quarantine → count + drive blend.
  const remaining = [...variants].filter((v) => effMode(v) !== 'direct');
  const blendVs = remaining.filter((v) => effMode(v) === 'blend');
  const upscaleVs = remaining.filter((v) => effMode(v) === 'upscale');
  counts.upscale += upscaleVs.length;
  counts.blend += blendVs.length;

  // (4) BLEND — apply-mix object-scoped when it's the whole object at one pct; else per-variant.
  if (blendVs.length) {
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
  console.log(`\n${DRY ? 'DRY — ' : ''}full-upscale command(s) recorded (NO --base-only → states + anims + all variants)${FIXTURE ? ' [fixture: comfy-batch targets the real corpus, so not run here]' : ''}:`);
  for (const c of cmds) console.log('  ' + c);
}
