// scripts/qa-tiles.mjs — validate STATIC building tiles (the companion to qa-frames.mjs, which does animation
// sequences). Catches the glitches that reach the game silently on a single tile:
//   • HOLE   — interior transparency: a transparent region NOT connected to the image edge. After solidify()
//              every wall tile should be opaque inside; a hole means a generated state ate the wall (the
//              "window removed the wall" class of bug). Flagged above a small area fraction.
//   • EMPTY  — < 35% opaque pixels: a near-blank / failed-generation tile.
//   • TINY   — far smaller than its siblings in the same material (a truncated/partial generation).
// A SCREEN, not a hard gate: writes red-boxed montages of flagged tiles to tools/_qa_tiles/.
// Usage: node scripts/qa-tiles.mjs [rootDir]
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || 'assets/pixelab/buildings/tiles/grassland';
const OUT = 'tools/_qa_tiles';
fs.mkdirSync(OUT, { recursive: true });

// Collect every <material>/<tile>__v*.png (the wired tiles) — skip anim frames, raws, _states, backups.
function findTiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    // skip anim sequences (qa-frames.mjs owns those) and any _-prefixed intermediate dir (_overlays/_raw/_states/_round*)
    if (e.isDirectory()) { if (e.name !== 'anim' && !e.name.startsWith('_')) findTiles(p, acc); continue; }
    if (/__v\d+\.png$/.test(e.name) && !/\.(bak|glitch)/.test(e.name)) acc.push(p);
  }
  return acc;
}

function analyze(img) {
  const W = img.width, H = img.height;
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H).data;
  const A = (i) => d[i * 4 + 3];
  // BFS from the border through transparent (alpha<128) pixels → mark exterior-connected transparency.
  const ext = new Uint8Array(W * H); const stack = [];
  for (let xx = 0; xx < W; xx++) { stack.push(xx); stack.push((H - 1) * W + xx); }
  for (let yy = 0; yy < H; yy++) { stack.push(yy * W); stack.push(yy * W + W - 1); }
  while (stack.length) { const i = stack.pop(); if (ext[i] || A(i) >= 128) continue; ext[i] = 1;
    const xx = i % W, yy = (i / W) | 0;
    if (xx > 0) stack.push(i - 1); if (xx < W - 1) stack.push(i + 1);
    if (yy > 0) stack.push(i - W); if (yy < H - 1) stack.push(i + W);
  }
  let opaque = 0, holes = 0;
  for (let i = 0; i < W * H; i++) { if (A(i) >= 128) opaque++; else if (!ext[i]) holes++; }
  return { W, H, opaqueFrac: opaque / (W * H), holeFrac: holes / (W * H) };
}

async function montage(name, items) {
  const TS = 120, pad = 8, cols = Math.min(items.length, 6), rows = Math.ceil(items.length / cols);
  const c = createCanvas((TS + pad) * cols + pad, (TS + 26) * rows + pad); const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.fillStyle = '#222'; x.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < items.length; k++) { const cx = k % cols, cy = (k / cols | 0); const ox = pad + cx * (TS + pad), oy = 22 + cy * (TS + 26);
    x.fillStyle = '#a00'; x.fillRect(ox - 2, oy - 2, TS + 4, TS + 4);
    try { const im = await loadImage(items[k].path); x.drawImage(im, 0, 0, im.width, im.height, ox, oy, TS, TS); } catch {}
    x.fillStyle = '#f88'; x.font = 'bold 10px sans-serif'; x.fillText(items[k].label, ox, oy - 4);
  }
  fs.writeFileSync(path.join(OUT, name + '.png'), c.toBuffer('image/png'));
}

const tiles = findTiles(ROOT);
// sibling median size per material dir, for the TINY check
const byDir = {};
const stats = [];
for (const p of tiles) { try { const img = await loadImage(p); const a = analyze(img); stats.push({ p, ...a }); (byDir[path.dirname(p)] ||= []).push(a.W * a.H); } catch { stats.push({ p, bad: true }); } }
const medArea = {}; for (const dir in byDir) { const s = byDir[dir].slice().sort((a, b) => a - b); medArea[dir] = s[s.length >> 1]; }

const flagged = []; let n = 0;
for (const s of stats) {
  const rel = path.relative(ROOT, s.p).replace(/[\\/]/g, '·');
  const reasons = [];
  if (s.bad) reasons.push('UNREADABLE');
  else {
    if (s.holeFrac > 0.004) reasons.push(`HOLE (interior transparency ${(s.holeFrac * 100).toFixed(2)}%)`);
    if (s.opaqueFrac < 0.35) reasons.push(`EMPTY (only ${(s.opaqueFrac * 100).toFixed(0)}% opaque)`);
    const med = medArea[path.dirname(s.p)] || (s.W * s.H);
    if (s.W * s.H < 0.4 * med) reasons.push(`TINY (${s.W}x${s.H} vs material median area ${med})`);
  }
  if (reasons.length) { flagged.push({ path: s.p, label: rel, reasons }); console.log(`✗ ${rel}\n    ${reasons.join('; ')}`); }
  n++;
}
if (flagged.length) await montage('flagged', flagged);
console.log(`\n${flagged.length} tile(s) flagged of ${n}. ${flagged.length ? 'Montage: ' + OUT + '/flagged.png' : 'All clean.'}`);
