// scripts/build-asset-manifest.mjs — assemble THE unified master manifest for PixelLab building art from the
// existing sources, so ONE machine-readable file is the single source of truth for the whole matrix:
//   every biome × wall material × {10 tile states (9 wall + gable) + 2 animations}
//   + every biome × roofSlug × {4 roof_top variants + optional fascia}      (the ROOF dimension)
//   + a pointer to the props (dressing) pipeline.
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
// ROOF dimension — per-biome surface textures keyed on roofSlug (building-materials.json `roofs`), NOT per wall
// material: roofs are assigned to buildings by position-hash rendezvous, independent of the wall material. Generated
// via create_tiles_pro (square_topdown / segmentation). The renderer rotates 4 variants per building (NV=4) for town
// variety, so 4 is the completeness target. roof_fascia.png is an OPTIONAL eave trim (grassland has it; desert's flat
// parapet roofs skip it → procedural fascia) — tracked but never a blocker.
const ROOF_VARIANTS = ['v000', 'v001', 'v002', 'v003'];
const ROOF_ROOT = path.join(ROOT, 'roof');
// Biomes whose tile-corpus prompt tokens ({FOUNDATION}/{DOOR}/{WINDOW}/{WALLPLATE} + per-material FACE/EDGE) are
// AUTHORED (a tile-corpus manifest exists). The other 19 are enumerated here but token-pending (the framework
// gap to fill before they can be generated).
const TOKENS_AUTHORED = new Set(['grassland', 'desert', 'mystic', 'forest', 'volcanic',
  'mountains', 'hills', 'taiga', 'dense_forest', 'savanna', 'steppe', 'swamp', 'tundra',
  'arctic', 'tropical_forest', 'beach', 'river', 'lake', 'shallow_water', 'ocean', 'deep_ocean']);

const ledgerFor = (biome) => {
  const p = path.join(TILES_ROOT, biome, '_pixellab_ids.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).materials || {}; } catch { return {}; }
};
// Roof IDs live in the SAME per-biome ledger under a `roofs` key, keyed by roofSlug (not material).
const roofLedgerFor = (biome) => {
  const p = path.join(TILES_ROOT, biome, '_pixellab_ids.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).roofs || {}; } catch { return {}; }
};
// v0 is the canonical (required) tile; v1 is an OPTIONAL second variant for richness (tracked, not required).
const tileStatus = (biome, mat, state, variant = 'v0') => fs.existsSync(path.join(TILES_ROOT, biome, mat, `${state}__${variant}.png`)) ? 'done' : 'pending';
const roofVariantStatus = (biome, slug, variant) => fs.existsSync(path.join(ROOF_ROOT, biome, slug, `roof_top__${variant}.png`)) ? 'done' : 'pending';
const roofFasciaPresent = (biome, slug) => fs.existsSync(path.join(ROOF_ROOT, biome, slug, 'roof_fascia.png'));
const animStatus = (biome, mat, kind) => {
  const d = path.join(TILES_ROOT, biome, mat, 'anim', kind);
  if (!fs.existsSync(d)) return 'pending';
  return fs.readdirSync(d).filter((f) => /^frame_\d+\.png$/.test(f)).length >= 9 ? 'done' : 'pending';
};

const out = { version: 1, generated_from: 'building-materials.json + tile-corpus model + per-biome _pixellab_ids.json', token_framework: 'docs/superpowers/specs/2026-06-22-tile-corpus-manifest.md (+ desert override)', biomes: {} };
let total = 0, done = 0;            // per-material wall corpus (9 tiles + gable + 2 anims), v0 canonical
let v1Total = 0, v1Done = 0;       // optional v1 tile variants (richness, not required)
let roofTotalAll = 0, roofDoneAll = 0; // roof_top variants across all biome × roofSlug
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
    for (const t of TILES) {
      const st = tileStatus(biome, mat, t);          // v0 — canonical, required
      const v1 = tileStatus(biome, mat, t, 'v1');    // v1 — optional richness
      tiles[t] = { status: st, v1, id: ids[t] || null };
      total++; if (st === 'done') done++;
      v1Total++; if (v1 === 'done') v1Done++;
    }
    const anims = {};
    for (const a of ANIMS) { const st = animStatus(biome, mat, a); anims[a] = { status: st }; total++; if (st === 'done') done++; }
    materials[mat] = { name: w.name || mat, palette: w.palette || null, source: diskMats.length ? 'tile-corpus' : 'plan', base_id: ids.base || null, tiles, anims };
  }
  // ROOF dimension — per roofSlug (from building-materials.json `roofs`), 4 variants the renderer rotates (NV=4).
  const roofLed = roofLedgerFor(biome);
  const roofs = {};
  for (const r of (bdef.roofs || [])) {
    const variants = {}; let present = 0;
    for (const v of ROOF_VARIANTS) { const st = roofVariantStatus(biome, r.slug, v); variants[v] = st; roofTotalAll++; if (st === 'done') { roofDoneAll++; present++; } }
    roofs[r.slug] = { name: r.name || r.slug, palette: r.palette || null, variants, present, complete: present === ROOF_VARIANTS.length, fascia: roofFasciaPresent(biome, r.slug), ids: roofLed[r.slug] || null };
  }
  out.biomes[biome] = { displayName: bdef.displayName, tokens_authored: TOKENS_AUTHORED.has(biome), materials, roofs };
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

out.summary = {
  biomes: Object.keys(out.biomes).length,
  building_assets: total, done, pending: total - done, pct: Math.round(100 * done / total),
  roof_assets: roofTotalAll, roof_done: roofDoneAll, roof_pct: roofTotalAll ? Math.round(100 * roofDoneAll / roofTotalAll) : 0,
  v1_variants: v1Total, v1_done: v1Done, v1_pct: v1Total ? Math.round(100 * v1Done / v1Total) : 0,
  biomes_token_authored: [...TOKENS_AUTHORED], prop_objects: propCount,
};
fs.writeFileSync(path.join(ROOT, 'manifest/building-asset-manifest.json'), JSON.stringify(out, null, 2));

console.log(`MASTER MANIFEST → ${path.join(ROOT, 'manifest/building-asset-manifest.json')}`);
console.log(`${out.summary.biomes} biomes · ${total} wall-corpus assets, ${done} done (${out.summary.pct}%) · roofs ${roofDoneAll}/${roofTotalAll} (${out.summary.roof_pct}%) · v1 variants ${v1Done}/${v1Total} (${out.summary.v1_pct}%) · ${propCount} prop objects (not generated)\n`);
console.log('  biome             walls(v0)  roofs   v1');
for (const [b, bd] of Object.entries(out.biomes)) {
  const mats = Object.values(bd.materials);
  const td = mats.reduce((s, m) => s + Object.values(m.tiles).filter((x) => x.status === 'done').length + Object.values(m.anims).filter((x) => x.status === 'done').length, 0);
  const tt = mats.length * (TILES.length + ANIMS.length);
  const roofVals = Object.values(bd.roofs || {});
  const rd = roofVals.reduce((s, r) => s + r.present, 0), rt = roofVals.length * ROOF_VARIANTS.length;
  const v1d = mats.reduce((s, m) => s + Object.values(m.tiles).filter((x) => x.v1 === 'done').length, 0), v1t = mats.length * TILES.length;
  if (td > 0 || bd.tokens_authored || rd > 0) console.log(`  ${bd.tokens_authored ? '✍ ' : '  '}${b.padEnd(15)} ${String(td).padStart(3)}/${String(tt).padEnd(3)}  ${String(rd).padStart(2)}/${String(rt).padEnd(2)}  ${String(v1d).padStart(2)}/${String(v1t).padEnd(2)}${bd.tokens_authored ? '' : '   (tokens TODO)'}`);
}
console.log(`\n  ${out.summary.biomes - TOKENS_AUTHORED.size} biomes still need tile-corpus tokens authored before they can generate.`);
