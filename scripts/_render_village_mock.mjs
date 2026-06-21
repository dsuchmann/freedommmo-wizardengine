// Headless render mirroring building-occluder.js drawWalls (facade-tile sampling) against the
// REAL grassland assets — verifies tiling to arbitrary widths at NON-32 zoom, window/door
// centring, corners, and material variety. Output: scripts/_village_mock.png
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync, existsSync } from 'fs';

const BASE = 'assets/pixelab/buildings/walls/grassland';
const t = 44;                 // px/tile (deliberately NOT 32, to prove zoom-robustness)
const WH = t * 4, wp = 1;

const BUILDINGS = [
  { mat: 'wattle_daub',  w: 6, door: 'plank',         win: 'arched' },
  { mat: 'timber_frame', w: 9, door: 'iron_banded',   win: 'round' },
  { mat: 'fieldstone',   w: 5, door: 'arched_double', win: 'shuttered' },
  { mat: 'cob',          w: 7, door: 'carved',        win: 'bay' },
];

async function tryLoad(p) { return existsSync(p) ? loadImage(p).catch(() => null) : null; }
async function loadMat(b) {
  const d = `${BASE}/${b.mat}`;
  const [base, cw, ce, win, door] = await Promise.all([
    tryLoad(`${d}/south_base__normal.png`), tryLoad(`${d}/south_corner_west__normal.png`),
    tryLoad(`${d}/south_corner_east__normal.png`), tryLoad(`${d}/south_window__${b.win}.png`),
    tryLoad(`${d}/south_door__${b.door}.png`),
  ]);
  return { base, cw, ce, win, door, P: !!(base && base.width >= 96) };
}

const totalW = BUILDINGS.reduce((a, b) => a + (b.w + 2) * t, 0) + t;
const H = WH + 3 * t;
const cv = createCanvas(totalW, H);
const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
ctx.fillStyle = '#7fb0d8'; ctx.fillRect(0, 0, totalW, H);
ctx.fillStyle = '#5fa64b'; ctx.fillRect(0, WH + t, totalW, H - WH - t);

// --- mirror of drawWalls' facade helpers ---
function facadeTile(img, P, c, dx, dy) {
  if (!P) { ctx.drawImage(img, 0, 8, 32, 112, dx, dy, t + wp, WH + wp); return; }
  const ux = dx - ((((c) % 4) + 4) % 4) * t;
  ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, t + wp, WH + wp); ctx.clip();
  ctx.drawImage(img, 0, 0, 128, 128, ux, dy, 4 * t, WH + wp); ctx.restore();
}
function facadeWide(img, P, dx, dy) {
  if (!P) { ctx.drawImage(img, 0, 8, 64, 112, dx, dy, 2 * t + wp, WH + wp); return; }
  const ux = dx - t;
  ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, 2 * t + wp, WH + wp); ctx.clip();
  ctx.drawImage(img, 0, 0, 128, 128, ux, dy, 4 * t, WH + wp); ctx.restore();
}

let x0 = t, missing = [];
for (const b of BUILDINGS) {
  const m = await loadMat(b);
  if (!m.base) { missing.push(b.mat); x0 += (b.w + 2) * t; continue; }
  const y = t, doorTile = Math.floor(b.w / 2), winTile = 2, skip = new Set();
  for (let dx = 0; dx < b.w; dx++) {
    if (skip.has(dx)) continue;
    const sx = x0 + dx * t, c = dx;
    if (dx === 0 && m.cw) { facadeTile(m.base, m.P, c, sx, y); facadeTile(m.cw, m.P, 0, sx - t, y); }
    else if (dx === b.w - 1 && m.ce) { facadeTile(m.base, m.P, c, sx, y); facadeTile(m.ce, m.P, 3, sx + t, y); }
    else if (dx === doorTile && dx >= 2 && dx < b.w - 2 && m.door) { facadeWide(m.door, m.P, sx, y); skip.add(dx + 1); }
    else if (dx === winTile && m.win) { facadeWide(m.win, m.P, sx, y); skip.add(dx + 1); }
    else facadeTile(m.base, m.P, c, sx, y);
  }
  ctx.fillStyle = '#0a0d12'; ctx.font = '13px sans-serif';
  ctx.fillText(`${b.mat} (${b.w}w) door:${b.door} win:${b.win}`, x0, WH + 2 * t);
  x0 += (b.w + 2) * t;
}
writeFileSync('scripts/_village_mock.png', cv.toBuffer('image/png'));
console.log('wrote scripts/_village_mock.png', cv.width + 'x' + cv.height, missing.length ? 'MISSING:' + missing : '');
