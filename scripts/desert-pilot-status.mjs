// scripts/desert-pilot-status.mjs — THE deterministic progress tracker + verifier for the desert
// tile-corpus pilot. Single source of truth: it enumerates the FULL required asset set per material from the
// manifest, checks the disk, runs the validators (qa-tiles + qa-frames), and prints DONE / MISSING / BROKEN +
// the exact next actions. RUN THIS AT EVERY STEP instead of relying on memory — it tells you what's left and
// verifies what's there. A material is only DONE when every tile exists, every anim has its frames, and both
// validators pass. (Generalises to any biome via argv[2]; defaults to desert.)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const BIOME = process.argv[2] || 'desert';
const ROOT = `assets/pixelab/buildings/tiles/${BIOME}`;
const MATERIALS = (process.argv[3] || 'adobe,mudbrick,sandstone,reed_palm').split(',');
// Manifest required set (per material): 9 wall tile states + the gable + 2 animations.
const GROUND = ['ground_plain', 'ground_window', 'ground_door', 'ground_left_corner', 'ground_right_corner'];
const UPPER = ['upper_plain', 'upper_window', 'upper_left_corner', 'upper_right_corner'];
const GABLE = ['gable']; // south roof→wall gable-end fill — create_tiles_pro (NOT create_object_state). See 2026-06-24-gable-tile-workflow.md
const TILES = [...GROUND, ...UPPER, ...GABLE];
const ANIMS = ['door', 'window']; // each must have 9 frames
// ROOFS — per roofSlug (from building-materials.json `roofs`), independent of wall material; create_tiles_pro,
// 4 variants (v000–v003) the renderer rotates per building for town variety. roof_fascia.png is OPTIONAL.
const ROOF_VARIANTS = ['v000', 'v001', 'v002', 'v003'];
let ROOF_SLUGS = [];
try { ROOF_SLUGS = ((JSON.parse(fs.readFileSync('assets/pixelab/buildings/manifest/building-materials.json', 'utf8')).biomes[BIOME] || {}).roofs || []).map((r) => r.slug); } catch { /* no roofs defined for this biome */ }
const roofDir = (slug) => path.join('assets/pixelab/buildings/roof', BIOME, slug);

const tileOk = (p) => fs.existsSync(p);
const animFrames = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /^frame_\d+\.png$/.test(x)).length : 0;

const todo = [];
const rows = [];
for (const m of MATERIALS) {
  const D = path.join(ROOT, m);
  const row = { m, tiles: {}, v1: {}, anims: {} };
  for (const t of TILES) {
    const ok = tileOk(path.join(D, `${t}__v0.png`)); row.tiles[t] = ok;        // v0 — canonical, required
    row.v1[t] = tileOk(path.join(D, `${t}__v1.png`));                          // v1 — optional richness variant
    if (!ok) todo.push(t === 'gable'
      ? `${m}: tile gable MISSING — create_tiles_pro (square_topdown / top-down / segmentation) of the ${m} gable, then solidify. See docs/superpowers/specs/2026-06-24-gable-tile-workflow.md`
      : `${m}: tile ${t} MISSING — create_object_state of the ${m} base (NEVER fresh/reconstruct)`);
  }
  for (const a of ANIMS) { const n = animFrames(path.join(D, 'anim', a)); row.anims[a] = n >= 9; if (n < 9) todo.push(`${m}: anim ${a} MISSING (${n}/9 frames) — animate_object the ${a} state, download, normalize-anim-frames`); }
  rows.push(row);
}

// ROOF rows — per roofSlug for this biome (independent of materials). create_tiles_pro, target 4 variants.
const roofRows = [];
for (const slug of ROOF_SLUGS) {
  const variants = ROOF_VARIANTS.map((v) => tileOk(path.join(roofDir(slug), `roof_top__${v}.png`)));
  const present = variants.filter(Boolean).length;
  const fascia = tileOk(path.join(roofDir(slug), 'roof_fascia.png'));
  roofRows.push({ slug, variants, present, fascia });
  if (present === 0) todo.push(`roof ${slug}: ALL 4 variants MISSING — create_tiles_pro (square_topdown/top-down/segmentation), solidify → roof/${BIOME}/${slug}/roof_top__v000..v003.png`);
  else if (present < ROOF_VARIANTS.length) todo.push(`roof ${slug}: ${present}/4 variants — generate ${ROOF_VARIANTS.length - present} more create_tiles_pro variant(s) for town variety`);
}

const run = (cmd) => { try { return execSync(cmd, { encoding: 'utf8' }); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };
const qaTiles = run(`node scripts/qa-tiles.mjs ${ROOT}`);
const qaFrames = run(`node scripts/qa-frames.mjs ${ROOT}`);
const tileFlags = qaTiles.split('\n').filter((l) => l.trim().startsWith('✗'));
const frameFlags = qaFrames.split('\n').filter((l) => l.includes('✗') || l.includes('SIZE_DRIFT') || l.includes('SETTLE') || l.includes('FROZEN'));
for (const f of tileFlags) todo.push(`QA tile FAIL: ${f.trim()} — retry/refine the create_object_state`);
for (const f of frameFlags) todo.push(`QA anim FAIL: ${f.trim()}`);

const sym = (b) => b ? '✓' : '·';
const cell = (t) => t.replace('ground_', 'g.').replace('upper_', 'u.').slice(0, 7).padEnd(7);
console.log(`\n=== BUILDING TILE-CORPUS STATUS (${BIOME}) ===`);
console.log('material   | ' + TILES.map(cell).join('') + '| door🎬 win🎬');
for (const r of rows) console.log(r.m.padEnd(10) + ' | ' + TILES.map((t) => sym(r.tiles[t]).padEnd(7)).join('') + '|  ' + sym(r.anims.door) + '     ' + sym(r.anims.window));

// Roof matrix (per roofSlug — NOT per material).
if (roofRows.length) {
  console.log(`\n=== ROOFS (${BIOME}) — create_tiles_pro · target 4 variants v000–v003 ===`);
  console.log('roofSlug        | v000 v001 v002 v003 | fascia');
  for (const r of roofRows) console.log(r.slug.padEnd(15) + ' |  ' + r.variants.map((b) => sym(b)).join('    ') + '  | ' + (r.fascia ? ' ✓' : ' · (optional)'));
}

const total = MATERIALS.length * (TILES.length + ANIMS.length);
const done = rows.reduce((s, r) => s + TILES.filter((t) => r.tiles[t]).length + ANIMS.filter((a) => r.anims[a]).length, 0);
const roofTot = roofRows.length * ROOF_VARIANTS.length;
const roofDone = roofRows.reduce((s, r) => s + r.present, 0);
const v1Done = rows.reduce((s, r) => s + TILES.filter((t) => r.v1[t]).length, 0);
const v1Tot = rows.length * TILES.length;
console.log(`\nPROGRESS: walls ${done}/${total} (${(100 * done / total) | 0}%) · roofs ${roofDone}/${roofTot}${roofTot ? ` (${(100 * roofDone / roofTot) | 0}%)` : ''} · v1 variants ${v1Done}/${v1Tot} (optional)  |  qa-tiles: ${tileFlags.length} fail, qa-frames: ${frameFlags.length} fail`);
console.log(`\n=== NEXT ACTIONS (${todo.length}) ===`);
todo.forEach((t) => console.log('  • ' + t));
if (!todo.length) console.log(`  ✅ ${BIOME.toUpperCase()} COMPLETE — all wall tiles + anims present, all roof variants present, validators clean. Ready to wire + review.`);
