// scripts/lo-montage.mjs
// Composite every REMOVED large_objects variant into labeled contact-sheet montages so the whole cull can be
// eyeballed in ~100 images instead of 3500. Each thumb is drawn over a checkerboard -> missing alpha, baked
// ground discs, square opaque tiles, and magenta-key residue all read at a glance. Grouped per species.
import fs from 'fs';
import path from 'path';
import { loadImage, createCanvas } from '@napi-rs/canvas';

const ASSET_ROOT = 'C:/Users/daves/AppData/Roaming/wizardgenie/projects/default/assets/pixelab/landscape_v2/micro/large_objects';
const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const MAN = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'tools', 'large-objects-curation-manifest.json'), 'utf8'));
const OUT = path.join(HERE, '..', 'tools', 'lo-montages');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const IMG = 148, LBL = 16, CW = IMG + 2, CH = IMG + LBL + 2, COLS = 6, ROWS = 6, PER = COLS * ROWS;
const FILE_RE = /^lg__.*__v(\d{3})\.png$/;

function fileFor(biome, species, v) {
  const dir = path.join(ASSET_ROOT, biome, species);
  for (const f of fs.readdirSync(dir)) { const m = f.match(FILE_RE); if (m && parseInt(m[1], 10) === v) return path.join(dir, f); }
  return null;
}
function checker(ctx, x, y, w, h) {
  for (let yy = 0; yy < h; yy += 12) for (let xx = 0; xx < w; xx += 12) {
    ctx.fillStyle = ((xx / 12 + yy / 12) & 1) ? '#9a9a9a' : '#c4c4c4';
    ctx.fillRect(x + xx, y + yy, 12, 12);
  }
}

const index = [];
for (const [key, info] of Object.entries(MAN.perSpecies)) {
  if (!info.removed.length) continue;
  const [biome, species] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)];
  const vs = info.removed;
  for (let part = 0; part * PER < vs.length; part++) {
    const slice = vs.slice(part * PER, part * PER + PER);
    const rows = Math.ceil(slice.length / COLS);
    const c = createCanvas(COLS * CW, rows * CH); const ctx = c.getContext('2d');
    ctx.fillStyle = '#222'; ctx.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < slice.length; i++) {
      const cx = (i % COLS) * CW + 1, cy = ((i / COLS) | 0) * CH + 1;
      checker(ctx, cx, cy, IMG, IMG);
      const fp = fileFor(biome, species, slice[i]);
      if (fp) {
        try {
          const im = await loadImage(fp);
          const s = Math.min(IMG / im.width, IMG / im.height);
          const dw = im.width * s, dh = im.height * s;
          ctx.drawImage(im, cx + (IMG - dw) / 2, cy + (IMG - dh) / 2, dw, dh);
        } catch { ctx.fillStyle = '#f0f'; ctx.fillRect(cx, cy, IMG, IMG); }
      }
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(cx + 0.5, cy + 0.5, IMG, IMG);
      ctx.fillStyle = '#fff'; ctx.fillRect(cx, cy + IMG, IMG, LBL);
      ctx.fillStyle = '#000'; ctx.font = '12px sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillText(`v${String(slice[i]).padStart(3, '0')}`, cx + 4, cy + IMG + LBL / 2 + 1);
    }
    const name = `${biome}__${species}__${part}.png`;
    fs.writeFileSync(path.join(OUT, name), c.toBuffer('image/png'));
    index.push({ file: name, biome, species, part, count: slice.length, vNumbers: slice });
  }
}
fs.writeFileSync(path.join(OUT, '_index.json'), JSON.stringify(index, null, 1));
const byBiome = {};
for (const e of index) (byBiome[e.biome] = byBiome[e.biome] || []).push(e.file);
console.log(`wrote ${index.length} montages across ${Object.keys(byBiome).length} biomes -> ${OUT}`);
for (const [b, fs_] of Object.entries(byBiome)) console.log(`  ${b.padEnd(18)} ${fs_.length} montage(s)`);
