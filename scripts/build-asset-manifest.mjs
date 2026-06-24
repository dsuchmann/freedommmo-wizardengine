// scripts/build-asset-manifest.mjs — assemble THE unified master manifest for PixelLab building art from the
// existing sources, so ONE machine-readable file is the single source of truth for the whole matrix:
//   every biome × wall material × {10 tile states (9 wall + gable) + 2 animations}  +  a pointer to the props (dressing) pipeline.
// Each asset cell carries its PixelLab object id (from the per-biome _pixellab_ids.json ledger) and a live
// status derived from disk (PNG presence / anim frame count). Re-run anytime — idempotent, disk-authoritative.
//   node scripts/build-asset-manifest.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'assets/pixelab/buildings';
const MAT = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest/building-materials.json'), 'utf8'));
const TILES_ROOT = path.join(ROOT, 'tiles');
const GROUND = ['ground_plain', 'ground_window', 'ground_door', 'ground_left_corner', 'ground_right_corner'];
const UPPER = ['upper_plain', 'upper_window', 'upper_left_corner', 'upper_right_corner'];
// GABLE: the south roof→wall gable-end fill — a per-MATERIAL tile state generated via create_tiles_pro
// (NOT create_1_direction_object). A NEW dimension across biome × material (checks `gable__v0.png`).
// See docs/superpowers/specs/2026-06-24-gable-tile-workflow.md.
const GABLE = ['gable'];
const TILES = [...GROUND, ...UPPER, ...GABLE];
const ANIMS = ['door', 'window'];
// Biomes whose tile-corpus prompt tokens ({FOUNDATION}/{DOOR}/{WINDOW}/{WALLPLATE} + per-material FACE/EDGE) are
// AUTHORED (a tile-corpus manifest exists). The other 19 are enumerated here but token-pending (the framework
// gap to fill before they can be generated).
const TOKENS_AUTHORED = new Set(['grassland', 'desert']);

const ledgerFor = (biome) => {
  const p = path.join(TILES_ROOT, biome, '_pixellab_ids.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).materials || {}; } catch { return {}; }
};
const tileStatus = (biome, mat, state) => fs.existsSync(path.join(TILES_ROOT, biome, mat, `${state}__v0.png`)) ? 'done' : 'pending';
const animStatus = (biome, mat, kind) => {
  const d = path.join(TILES_ROOT, biome, mat, 'anim', kind);
  if (!fs.existsSync(d)) return 'pending';
  return fs.readdirSync(d).filter((f) => /^frame_\d+\.png$/.test(f)).length >= 9 ? 'done' : 'pending';
};

const out = { version: 1, generated_from: 'building-materials.json + tile-corpus model + per-biome _pixellab_ids.json', token_framework: 'docs/superpowers/specs/2026-06-22-tile-corpus-manifest.md (+ desert override)', biomes: {} };
let total = 0, done = 0;
for (const [biome, bdef] of Object.entries(MAT.biomes)) {
  const led = ledgerFor(biome);
  const materials = {};
  // Material list is DISK-FIRST: if a biome already has a tile-corpus on disk, those dirs ARE the canonical
  // materials (the tile-corpus vocabulary supersedes the older building-materials.json plan, whose slugs can
  // differ — e.g. desert 'adobe' vs the plan's 'smooth_adobe'). Un-started biomes fall back to the plan slugs.
  const diskDir = path.join(TILES_ROOT, biome);
  const diskMats = fs.existsSync(diskDir) ? fs.readdirSync(diskDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name) : [];
  const planBySlug = Object.fromEntries((bdef.walls || []).map((w) => [w.slug, w]));
  const matList = diskMats.length ? diskMats : Object.keys(planBySlug);
  for (const mat of matList) {
    const ids = led[mat] || {}, w = planBySlug[mat] || {};
    const tiles = {};
    for (const t of TILES) { const st = tileStatus(biome, mat, t); tiles[t] = { status: st, id: ids[t] || null }; total++; if (st === 'done') done++; }
    const anims = {};
    for (const a of ANIMS) { const st = animStatus(biome, mat, a); anims[a] = { status: st }; total++; if (st === 'done') done++; }
    materials[mat] = { name: w.name || mat, palette: w.palette || null, source: diskMats.length ? 'tile-corpus' : 'plan', base_id: ids.base || null, tiles, anims };
  }
  out.biomes[biome] = { displayName: bdef.displayName, tokens_authored: TOKENS_AUTHORED.has(biome), materials };
}

// Props (building dressing D0–D7): reference the dressing manifest; none generated yet (D0 procedural, D3 = first
// PixelLab batch). Counted best-effort so the master manifest acknowledges props + their pipeline + status.
let propCount = 0;
try {
  const dress = JSON.parse(fs.readFileSync('docs/superpowers/specs/2026-06-23-dressing-manifest.json', 'utf8'));
  const objs = Array.isArray(dress) ? dress : (dress.objects || (dress.categories || []).flatMap((c) => c.objects || []));
  propCount = Array.isArray(objs) ? objs.length : 0;
} catch { /* leave 0 */ }
out.props = { source: 'docs/superpowers/specs/2026-06-23-dressing-manifest.json', objects: propCount, status: 'design_only_not_generated' };

out.summary = { biomes: Object.keys(out.biomes).length, building_assets: total, done, pending: total - done, pct: Math.round(100 * done / total), biomes_token_authored: [...TOKENS_AUTHORED], prop_objects: propCount };
fs.writeFileSync(path.join(ROOT, 'manifest/building-asset-manifest.json'), JSON.stringify(out, null, 2));

console.log(`MASTER MANIFEST → ${path.join(ROOT, 'manifest/building-asset-manifest.json')}`);
console.log(`${out.summary.biomes} biomes · ${total} building assets · ${done} done (${out.summary.pct}%) · ${propCount} prop objects (not generated)\n`);
for (const [b, bd] of Object.entries(out.biomes)) {
  const mats = Object.values(bd.materials);
  const td = mats.reduce((s, m) => s + Object.values(m.tiles).filter((x) => x.status === 'done').length + Object.values(m.anims).filter((x) => x.status === 'done').length, 0);
  const tt = mats.length * (TILES.length + ANIMS.length);
  if (td > 0 || bd.tokens_authored) console.log(`  ${bd.tokens_authored ? '✍ ' : '  '}${b.padEnd(15)} ${String(td).padStart(3)}/${tt}${bd.tokens_authored ? '' : '   (tokens TODO)'}`);
}
console.log(`\n  ${out.summary.biomes - TOKENS_AUTHORED.size} biomes still need tile-corpus tokens authored before they can generate.`);
