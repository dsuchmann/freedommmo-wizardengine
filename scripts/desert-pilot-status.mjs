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

const tileOk = (p) => fs.existsSync(p);
const animFrames = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /^frame_\d+\.png$/.test(x)).length : 0;

const todo = [];
const rows = [];
for (const m of MATERIALS) {
  const D = path.join(ROOT, m);
  const row = { m, tiles: {}, anims: {} };
  for (const t of TILES) { const ok = tileOk(path.join(D, `${t}__v0.png`)); row.tiles[t] = ok; if (!ok) todo.push(t === 'gable'
    ? `${m}: tile gable MISSING — create_tiles_pro (square_topdown / top-down / segmentation) of the ${m} gable, then solidify. See docs/superpowers/specs/2026-06-24-gable-tile-workflow.md`
    : `${m}: tile ${t} MISSING — create_object_state of the ${m} base (NEVER fresh/reconstruct)`); }
  for (const a of ANIMS) { const n = animFrames(path.join(D, 'anim', a)); row.anims[a] = n >= 9; if (n < 9) todo.push(`${m}: anim ${a} MISSING (${n}/9 frames) — animate_object the ${a} state, download, normalize-anim-frames`); }
  rows.push(row);
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
console.log(`\n=== DESERT PILOT STATUS (${BIOME}) ===`);
console.log('material   | ' + TILES.map(cell).join('') + '| door🎬 win🎬');
for (const r of rows) console.log(r.m.padEnd(10) + ' | ' + TILES.map((t) => sym(r.tiles[t]).padEnd(7)).join('') + '|  ' + sym(r.anims.door) + '     ' + sym(r.anims.window));

const total = MATERIALS.length * (TILES.length + ANIMS.length);
const done = rows.reduce((s, r) => s + TILES.filter((t) => r.tiles[t]).length + ANIMS.filter((a) => r.anims[a]).length, 0);
console.log(`\nPROGRESS: ${done}/${total} assets present (${(100 * done / total) | 0}%)  |  qa-tiles: ${tileFlags.length} fail, qa-frames: ${frameFlags.length} fail`);
console.log(`\n=== NEXT ACTIONS (${todo.length}) ===`);
todo.forEach((t) => console.log('  • ' + t));
if (!todo.length) console.log('  ✅ DESERT PILOT COMPLETE — all tiles present, all anims present, validators clean. Ready to wire + roof + review.');
