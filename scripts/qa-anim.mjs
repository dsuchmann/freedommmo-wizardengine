// scripts/qa-anim.mjs — QA GATE for an aperture animation (door swing / window shutters).
//
// The moving part (shutters/door leaf) is CENTRED; the WALL around it must stay PERFECTLY STATIC across
// every frame. The v3 text animation sometimes wobbles/warps the whole wall (visible as drifting studs /
// panels). Detect it: sample the OUTER side-wall columns (pure wall — the open shutters/door don't reach
// the far edges) at mid height, and measure each frame's mean RGB diff vs frame 0. Clean animation → only
// the centre moves → low wall diff. Distortion → the wall drifts → high wall diff → regenerate.
//
// Usage: node scripts/qa-anim.mjs <frame_dir>   (expects frame_000.png .. frame_008.png) → PASS/FAIL.
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const dir = process.argv[2];
if (!dir) { console.error('usage: qa-anim.mjs <frame_dir>'); process.exit(2); }
const frames = [];
for (let i = 0; i < 16; i++) {
  const f = `${dir}/frame_${String(i).padStart(3, '0')}.png`;
  if (fs.existsSync(f)) frames.push(await loadImage(f));
}
if (frames.length < 2) { console.log(`FAIL <2 frames  [${dir}]`); process.exit(1); }

const W = frames[0].width, H = frames[0].height;
const data = frames.map(im => { const c = createCanvas(W, H).getContext('2d'); c.drawImage(im, 0, 0); return c.getImageData(0, 0, W, H).data; });
// outer side-wall band (avoid the centred aperture) at mid height (avoid wall-plate top + foundation bottom)
const inWall = (x, y) => (x < 0.16 * W || x > 0.84 * W) && y > 0.2 * H && y < 0.85 * H;

const f0 = data[0];
let maxMean = 0, worst = 0;
for (let fi = 1; fi < data.length; fi++) {
  let sum = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inWall(x, y)) continue;
    const i = (y * W + x) * 4;
    if (f0[i + 3] < 30 && data[fi][i + 3] < 30) continue;
    sum += Math.abs(f0[i] - data[fi][i]) + Math.abs(f0[i + 1] - data[fi][i + 1]) + Math.abs(f0[i + 2] - data[fi][i + 2]);
    n++;
  }
  const mean = n ? sum / (3 * n) : 0;
  if (mean > maxMean) { maxMean = mean; worst = fi; }
}
const TH = 10;
const pass = maxMean <= TH;
console.log(`${pass ? 'PASS' : 'FAIL'}  wall-distortion mean=${maxMean.toFixed(1)} (thresh ${TH}, worst frame ${worst})  [${dir}]`);
process.exit(pass ? 0 : 1);
