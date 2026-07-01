#!/usr/bin/env node
// apply-mix.mjs — the LOCKED "mix" finishing stage of the tree-upscale pipeline.
//
// The ComfyUI detail-add gives a richer trunk/bark but slightly smooths the leaf clumps. The user-approved
// fix (see tools/blend-preview.html) is a gentle BLEND back toward the original sprite:
//
//     mixed @384  =  60% upscale(@384)  +  40% original(192 → point-resized to 384)
//                    then re-snap to the per-source 64-colour palette, then re-apply the @384's 1-bit alpha.
//
// This is a PURELY DETERMINISTIC post-pass over @384 files already on disk — it does NOT touch ComfyUI.
//
// SAFE TO RUN ALONGSIDE `comfy-batch --watch`: it skips any @384 modified in the last SETTLE_SEC seconds
// (i.e. still being written), so you never read a half-finished frame. Best of all, run it with `--watch`
// in a second terminal and forget it — it re-scans every few minutes and mixes new arrivals as they land.
// You DON'T have to stop/restart the generator.
//
// NON-DESTRUCTIVE + IDEMPOTENT + REVERTIBLE:
//   • The first time a file is mixed, its RAW @384 is copied to tools/_premix/<rel> (the source of truth).
//   • Every mix re-blends FROM that backup, so re-running never compounds, and you can change --pct freely.
//   • tools/_premix/_applied.json records the pct applied per file → unchanged files are skipped on re-run.
//   • `--revert` restores every @384 from its backup (back to the raw upscale).
//   • The original 192px sprites are never written.
//
// Usage:
//   node scripts/tree-upscale/apply-mix.mjs                  # one pass over large_flora @ 40% (skips settling files)
//   node scripts/tree-upscale/apply-mix.mjs --watch          # run forever, re-scan every 3 min (start once, forget)
//   node scripts/tree-upscale/apply-mix.mjs --watch 5        # …every 5 min
//   node scripts/tree-upscale/apply-mix.mjs --biome dense_forest --type ancient_oak
//   node scripts/tree-upscale/apply-mix.mjs --field medium_flora --biome grassland --type cornflower --pct 40
//   node scripts/tree-upscale/apply-mix.mjs --field small_flora --biome grassland --type wild_herb --variant v007
//   node scripts/tree-upscale/apply-mix.mjs --pct 50         # stronger original (re-blends from backup)
//   node scripts/tree-upscale/apply-mix.mjs --dry            # list what would change, do nothing
//   node scripts/tree-upscale/apply-mix.mjs --revert         # restore raw upscales from backups
//
// After mixing the game needs no manifest change (the @384 URLs are unchanged); just hard-reload.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..', '..');

// --- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes('--' + k);

// Which field's corpus to mix. Default large_flora (the original F6 behaviour, byte-for-byte). Other
// fields live under sibling dirs and get their OWN namespaced premix backups so keys never collide.
// FIELD_ASSET_ROOT overrides the corpus base (offline test fixtures); premix follows it so the repo stays clean.
const FIELD = arg('field', 'large_flora');
const MICRO_BASE = process.env.FIELD_ASSET_ROOT
  ? path.resolve(process.env.FIELD_ASSET_ROOT)
  : path.join(REPO, 'assets/pixelab/landscape_v2/micro');
const LF = path.join(MICRO_BASE, FIELD);
const PREMIX_BASE = process.env.FIELD_ASSET_ROOT ? path.join(MICRO_BASE, '_premix') : path.join(REPO, 'tools/_premix');
const PREMIX = FIELD === 'large_flora' ? PREMIX_BASE : path.join(PREMIX_BASE, FIELD);
const APPLIED = path.join(PREMIX, '_applied.json');
const RES = 384;
const SETTLE_MS = 15_000;   // skip @384s touched within this window — they may still be mid-write

const PCT = Math.max(0, Math.min(100, Number(arg('pct', 40))));
const ONLY_BIOME = arg('biome');
const ONLY_TYPE = arg('type');
const ONLY_VARIANT = arg('variant');   // restrict to one variant id (e.g. v007) — used by apply-upscale-decisions
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity;
const DRY = has('dry');
const FORCE = has('force');
const REVERT = has('revert');
const WATCH = has('watch');
const WATCH_MIN = (() => { const v = arg('watch'); return v && !isNaN(Number(v)) ? Number(v) : 3; })();

if (!fs.existsSync(LF)) { console.error('no large_flora dir at', LF); process.exit(1); }

const magick = (a) => { const r = spawnSync('magick', a, { encoding: 'utf8' }); if (r.status !== 0) throw new Error('magick ' + a.join(' ') + '\n' + (r.stderr || r.stdout || `exit ${r.status}`)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- walk: every plain "<...>@384.png" under large_flora (base, _states, anim frames) ----------------------
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '_premix') walk(p, out); }
    else if (e.isFile() && e.name.endsWith('@384.png')) out.push(p);
  }
  return out;
}
// key = path under large_flora without "@384.png"; biome/type = first two path segments
function relKey(file) { return path.relative(LF, file).split(path.sep).join('/').replace(/@384\.png$/, ''); }
// A key belongs to variant `v` if its filename is exactly v, ends with "_v"/"__v", or has v as a
// path segment (anim frames live under ".../<v>/frame_xxx"). Mirrors apply-upscale-decisions.
function keyHasVariant(key, v) {
  if (!v) return true;
  const segs = key.split('/');
  if (segs.includes(v)) return true;
  const leaf = segs[segs.length - 1];
  return leaf === v || leaf.endsWith('_' + v) || leaf.endsWith('__' + v);
}
function passFilter(key) {
  const seg = key.split('/');
  if (ONLY_BIOME && seg[0] !== ONLY_BIOME) return false;
  if (ONLY_TYPE && seg[1] !== ONLY_TYPE) return false;
  if (ONLY_VARIANT && !keyHasVariant(key, ONLY_VARIANT)) return false;
  return true;
}

// --- revert mode ------------------------------------------------------------
function revert() {
  if (!fs.existsSync(PREMIX)) { console.log('nothing to revert (no backups).'); return; }
  let n = 0;
  for (const file of walk(LF, [])) {
    const key = relKey(file); if (!passFilter(key)) continue;
    const bak = path.join(PREMIX, path.relative(LF, file));
    if (!fs.existsSync(bak)) continue;
    if (DRY) { console.log('would restore', key); n++; continue; }
    fs.copyFileSync(bak, file); n++;
  }
  console.log(`${DRY ? 'would restore' : 'restored'} ${n} @384 file(s) from backups.`);
}

// --- mix one file (back up raw on first touch, always re-blend from backup) --
function mixOne(file, applied) {
  const key = relKey(file);
  const src = file.replace(/@384\.png$/, '.png');           // the original 192 sprite/frame
  if (!fs.existsSync(src)) return 'nosrc';

  const bak = path.join(PREMIX, path.relative(LF, file));    // backup of the RAW @384 (source of truth)
  const firstTime = !fs.existsSync(bak);
  if (!firstTime && applied[key] === PCT && !FORCE) return 'skip';

  // settle guard — don't touch a frame the generator may still be writing
  try { if (Date.now() - fs.statSync(file).mtimeMs < SETTLE_MS) return 'settling'; } catch { return 'settling'; }

  if (DRY) { return 'mix'; }

  if (firstTime) { fs.mkdirSync(path.dirname(bak), { recursive: true }); fs.copyFileSync(file, bak); }
  const raw = bak;                                           // always blend FROM the raw upscale

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mix1-'));
  try {
    const pal = path.join(tmp, 'pal.png'), o = path.join(tmp, 'o.png'), up = path.join(tmp, 'up.png');
    const bl = path.join(tmp, 'bl.png'), rm = path.join(tmp, 'rm.png'), mask = path.join(tmp, 'mask.png');
    // per-source 64-colour palette (-depth 8: Q16 magick else emits 16-bit and the QA reader false-fails darks)
    magick([src, '-alpha', 'off', '-colors', '64', '-depth', '8', pal]);
    magick([src, '-alpha', 'off', '-filter', 'point', '-resize', `${RES}x${RES}`, o]);   // original @384, crisp
    magick([raw, '-alpha', 'off', up]);                                                   // raw upscale, opaque
    // 60% upscale + 40% original:  compose:args = <src%>,<dst%>  (first=up=dst, second=o=src)
    magick([up, o, '-compose', 'blend', '-define', `compose:args=${PCT},${100 - PCT}`, '-composite', bl]);
    magick([bl, '-dither', 'None', '-remap', pal, rm]);                                   // re-lock palette
    magick([raw, '-alpha', 'extract', '-threshold', '50%', mask]);                        // raw's 1-bit silhouette
    magick([rm, mask, '-compose', 'CopyOpacity', '-composite', file]);                    // overwrite the @384
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  applied[key] = PCT;
  return 'mix';
}

// --- one pass over the corpus ----------------------------------------------
function runPass() {
  const applied = fs.existsSync(APPLIED) ? JSON.parse(fs.readFileSync(APPLIED, 'utf8')) : {};
  const files = walk(LF, []).filter((f) => passFilter(relKey(f)));
  const c = { mix: 0, skip: 0, nosrc: 0, settling: 0 };
  for (const file of files) {
    if (c.mix >= LIMIT) break;
    const r = mixOne(file, applied);
    c[r]++;
    if (!DRY && r === 'mix' && c.mix % 50 === 0) console.log(`  …${c.mix} mixed`);
  }
  if (!DRY) { fs.mkdirSync(PREMIX, { recursive: true }); fs.writeFileSync(APPLIED, JSON.stringify(applied, null, 0)); }
  return c;
}

// --- dispatch ---------------------------------------------------------------
if (REVERT) {
  revert();
} else if (WATCH) {
  console.log(`mix watch @ ${PCT}% — re-scan every ${WATCH_MIN} min, skip files <${SETTLE_MS / 1000}s old. Ctrl+C to stop.`);
  for (;;) {
    const c = runPass();
    const stamp = new Date().toLocaleTimeString();
    console.log(`[${stamp}] mixed ${c.mix}  ·  ${c.skip} already  ·  ${c.settling} settling  ·  ${c.nosrc} no-source`);
    await sleep(WATCH_MIN * 60_000);
  }
} else {
  const c = runPass();
  console.log(`\n${DRY ? 'DRY — ' : ''}mix @ ${PCT}%  (60% upscale + ${PCT}% original)`);
  console.log(`  ${DRY ? 'would mix' : 'mixed'}:   ${c.mix}`);
  console.log(`  skipped (already @ ${PCT}%): ${c.skip}`);
  if (c.settling) console.log(`  settling (too new, retry later): ${c.settling}`);
  if (c.nosrc) console.log(`  no 192 source (skipped):    ${c.nosrc}`);
  const revertFlag = FIELD === 'large_flora' ? '' : ` --field ${FIELD}`;
  console.log(`  backups: ${path.relative(REPO, PREMIX) || PREMIX}   ·   revert: node scripts/tree-upscale/apply-mix.mjs${revertFlag} --revert`);
}
