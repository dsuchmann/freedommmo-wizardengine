#!/usr/bin/env node
// gen-upscale-preview-manifest.mjs — build the QA/preview manifest the upscale-studio dashboard loads.
//
// Scans the 5 object fields in fields.json for a biome (default grassland), and for each object dir
// emits EVERY base variant (default = ALL — the dashboard now reviews every variant, not a sample of 3)
// with web URLs for: the raw PixelLab original, the AI @384 upscale (null if not produced yet =
// "upscale pending"), and any anim frame lists (+ @384 frames). An optional sample arg still caps the
// count (cheap previews) but is no longer the default.
//
// Asset root: assets live in the MAIN checkout (gitignored). Override with FIELD_ASSET_ROOT; otherwise
// defaults to the repo root that contains this script. Web URLs are emitted relative to the asset root
// so serving that root makes "/assets/..." resolve.
//
// Usage:
//   node scripts/tree-upscale/gen-upscale-preview-manifest.mjs [biome] [sampleN]
//   node scripts/tree-upscale/gen-upscale-preview-manifest.mjs grassland        # ALL base variants (default)
//   node scripts/tree-upscale/gen-upscale-preview-manifest.mjs grassland 3      # cap to first 3/object
//   FIELD_ASSET_ROOT=/path/to/checkout node scripts/tree-upscale/gen-upscale-preview-manifest.mjs grassland
//   (env: UPSCALE_SAMPLE overrides N; --sample=N also accepted; omit all = ALL variants)
//
// Output: tools/upscale-preview.<biome>.json
//   { biome, generatedAt, assetRoot, sample, fields: [
//       { field, label, drawPx, objects: [
//           { field, biome, object, drawPx, hasUpscale,
//             variants: [ { v, original, upscale|null, anim:[...], animUpscale:[...] } ] } ] } ] }
//   (the per-object shape — field, biome, object, drawPx, hasUpscale, variants[] — is the spec §4.2 shape;
//    it is wrapped in a per-field list so the dashboard can build tabs.)

import fs from 'node:fs';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(SCRIPT_DIR, '..', '..');
const ASSET_ROOT = process.env.FIELD_ASSET_ROOT
  ? path.resolve(process.env.FIELD_ASSET_ROOT)
  : REPO;

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('-'));
const biome = positional[0] || 'grassland';
const flagSample = (argv.find((a) => a.startsWith('--sample=')) || '').split('=')[1];
// Default = ALL variants (Infinity). An explicit env/flag/positional still caps to the first N.
const sampleRaw = process.env.UPSCALE_SAMPLE || flagSample || positional[1];
const SAMPLE = (sampleRaw != null && sampleRaw !== '') ? parseInt(sampleRaw, 10) : Infinity;

// Tab order for the dashboard (F2, F3, F4, F5, F6, large_objects).
const FIELD_ORDER = ['small_flora', 'small_scatter', 'medium_flora', 'medium_objects', 'large_flora', 'large_objects'];

const FIELDS = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'fields.json'), 'utf8'));

function webUrl(abs) {
  return '/' + path.relative(ASSET_ROOT, abs).split(path.sep).join('/');
}
function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
}
const pad3 = (n) => String(n).padStart(3, '0');

// Pick the most preview-worthy anim dir for an object: prefer wind_sway, else first alphabetically.
function pickAnimType(animTypes) {
  if (animTypes.includes('wind_sway')) return 'wind_sway';
  return animTypes.slice().sort()[0] || null;
}

// For a variant (numeric index `num`, base filename stem `stem`) gather anim + animUpscale frame URLs.
function variantAnim(objDir, num) {
  const animRoot = path.join(objDir, 'anim');
  const animType = pickAnimType(listDirs(animRoot));
  if (!animType) return { anim: [], animUpscale: [] };
  const vDir = path.join(animRoot, animType, 'v' + pad3(num));
  if (!fs.existsSync(vDir)) return { anim: [], animUpscale: [] };
  const files = listFiles(vDir).filter((f) => f.endsWith('.png'));
  const base = files.filter((f) => /^frame_\d+\.png$/.test(f)).sort();
  const up = files.filter((f) => /^frame_\d+@384\.png$/.test(f)).sort();
  return {
    anim: base.map((f) => webUrl(path.join(vDir, f))),
    animUpscale: up.map((f) => webUrl(path.join(vDir, f))),
  };
}

const out = { biome, generatedAt: new Date().toISOString(), assetRoot: ASSET_ROOT, sample: Number.isFinite(SAMPLE) ? SAMPLE : null, fields: [] };
let totalObjects = 0;
let totalVariants = 0;
let withUpscale = 0;

for (const fieldName of FIELD_ORDER) {
  const cfg = FIELDS[fieldName];
  if (!cfg) continue;
  const re = new RegExp(cfg.file_re);
  const biomeDir = path.join(ASSET_ROOT, ...cfg.root.split('/'), biome);
  const fieldEntry = { field: fieldName, label: cfg.label || fieldName, drawPx: cfg.draw_px, objects: [] };

  for (const object of listDirs(biomeDir).sort()) {
    const objDir = path.join(biomeDir, object);
    // Base variant files: <stem>.png whose stem matches file_re; exclude @384.
    const variants = [];
    for (const f of listFiles(objDir)) {
      if (!f.endsWith('.png') || f.includes('@384')) continue;
      const stem = f.slice(0, -4);
      const m = stem.match(re);
      if (!m) continue;
      variants.push({ num: parseInt(m[1], 10), stem, file: f });
    }
    variants.sort((a, b) => a.num - b.num);
    if (!variants.length) continue;

    const sampled = (Number.isFinite(SAMPLE) ? variants.slice(0, SAMPLE) : variants).map(({ num, stem, file }) => {
      const original = webUrl(path.join(objDir, file));
      const upAbs = path.join(objDir, stem + '@384.png');
      const upscale = fs.existsSync(upAbs) ? webUrl(upAbs) : null;
      const { anim, animUpscale } = variantAnim(objDir, num);
      totalVariants += 1;
      return { v: 'v' + pad3(num), original, upscale, anim, animUpscale };
    });

    const hasUpscale = sampled.some((s) => s.upscale || s.animUpscale.length);
    if (hasUpscale) withUpscale += 1;
    totalObjects += 1;
    fieldEntry.objects.push({ field: fieldName, biome, object, drawPx: cfg.draw_px, hasUpscale, variants: sampled });
  }
  out.fields.push(fieldEntry);
}

const OUT = path.join(REPO, 'tools', `upscale-preview.${biome}.json`);
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

console.log(`wrote ${path.relative(REPO, OUT)}`);
console.log(`  asset root: ${ASSET_ROOT}`);
console.log(`  biome: ${biome} · sample N: ${Number.isFinite(SAMPLE) ? SAMPLE : 'ALL'}`);
console.log(`  objects: ${totalObjects} (${withUpscale} with @384) · variants emitted: ${totalVariants}`);
for (const f of out.fields) {
  const up = f.objects.filter((o) => o.hasUpscale).length;
  console.log(`    ${f.field}: ${f.objects.length} objects (${up} @384), drawPx ${f.drawPx}`);
}
