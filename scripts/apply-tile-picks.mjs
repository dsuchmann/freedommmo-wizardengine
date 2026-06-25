// scripts/apply-tile-picks.mjs <picks.json>
// Applies a curation from tools/tile-picker.html. The picks JSON is { sets:[ {srcDir, targetPattern, picks:{slot:[ids]}} ] }.
// For each slot, the chosen tile ids (in click order) become variants v0, v1, … at targetPattern (with {slot}/{n}
// substituted). Forces opacity (no crop — tiles must stay square + tileable). Re-run anytime; it overwrites.
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const p = process.argv[2];
if (!p) { console.error('usage: node scripts/apply-tile-picks.mjs <picks.json>'); process.exit(2); }
const data = JSON.parse(fs.readFileSync(p, 'utf8'));
let n = 0;
for (const set of (data.sets || [])) {
  for (const [slot, ids] of Object.entries(set.picks || {})) {
    for (let v = 0; v < ids.length; v++) {
      const src = `${set.srcDir}/${ids[v]}.png`;
      // {nnn} = zero-padded 3-digit index (roof_top__v000..v047), {n} = bare index (gable__v0..v15). Pools >9 MUST
      // use {nnn} or the renderer's padStart(3) filename (roof_top__v047) won't match (v0047 ≠ v047).
      const dest = set.targetPattern.replace('{slot}', slot).replace('{nnn}', String(v).padStart(3, '0')).replace('{n}', String(v));
      if (!fs.existsSync(src)) { console.warn('  missing src', src); continue; }
      const img = await loadImage(src);
      const W = img.width, H = img.height;
      const c = createCanvas(W, H); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, W, H); for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255; // force opaque, no crop
      x.putImageData(d, 0, 0);
      fs.mkdirSync(dest.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
      fs.writeFileSync(dest, c.toBuffer('image/png'));
      console.log(`  ${slot} v${v} ← ${src.split('/').pop()}  →  ${dest}`);
      n++;
    }
  }
}
console.log(`placed ${n} curated tiles (forced opacity) from ${p}`);
