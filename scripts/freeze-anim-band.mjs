// scripts/freeze-anim-band.mjs <materialDir> <kind> [topFrac=0.18]
// Restore a STATIC top band (the eave/wallplate cap) over every animation frame. v3 animate_object cannot hold
// non-moving regions perfectly still — during a door swing it MELTS the top eave band (blobby/holey in the mid
// frames) even though only the leaf should move. Since that band is static, we composite the clean band straight
// from the static tile (`ground_<kind>__v0.png`) onto each frame's top `topFrac`. The leaf (below the band) keeps
// its v3 motion. Requires frames already fit to the static dims (run fit-anim-frames.mjs first). Idempotent.
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const [, , dir, kind, fracA] = process.argv;
if (!dir || !kind) { console.error('usage: freeze-anim-band.mjs <materialDir> <door|window> [topFrac]'); process.exit(2); }
const frac = +(fracA || 0.18);
const staticP = `${dir}/ground_${kind}__v0.png`;
const animDir = `${dir}/anim/${kind}`;
if (!fs.existsSync(staticP) || !fs.existsSync(animDir)) { console.log(`skip ${dir} ${kind}`); process.exit(0); }
const st = await loadImage(staticP);
const W = st.width, H = st.height, bandH = Math.round(H * frac);
const frames = fs.readdirSync(animDir).filter((f) => /^frame_\d+\.png$/.test(f)).sort();
for (const fn of frames) {
  const fr = await loadImage(`${animDir}/${fn}`);
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.drawImage(fr, 0, 0, fr.width, fr.height, 0, 0, W, H);   // frame body (normalised to static dims)
  x.drawImage(st, 0, 0, W, bandH, 0, 0, W, bandH);          // clean static eave band over the top
  fs.writeFileSync(`${animDir}/${fn}`, c.toBuffer('image/png'));
}
console.log(`freeze ${dir.split(/[\\/]/).slice(-1)} ${kind}: static top ${Math.round(frac * 100)}% (${bandH}px) → ${frames.length} frames`);
