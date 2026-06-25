// scripts/gen-field-manifest.mjs [field]   (default f6)
// Scans ALL on-disk variants for a field and emits factual per-variant metadata for tools/field-studio.html.
// Factual only — NO judgment. Marks current omit-state from the curation sidecar so the dashboard resumes.
import fs from 'fs';
import path from 'path';
import url from 'url';
import { loadImage } from '@napi-rs/canvas';
import { FIELD_ROOTS, loadCuration, omitSetMap } from './lib/field-curation.mjs';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const field = process.argv[2] || 'f6';
const rel = FIELD_ROOTS[field];
const ABS = path.join(ROOT, rel);
const OUT = path.join(ROOT, 'tools', `field-manifest.${field}.json`);
const omit = omitSetMap(loadCuration(field));

// Read a PNG's opaque bbox + fill + magenta-key count via canvas pixels.
async function measure(file) {
  const img = await loadImage(file);
  const W = img.width, H = img.height;
  const { createCanvas } = await import('@napi-rs/canvas');
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H).data;
  let minX = W, minY = H, maxX = -1, maxY = -1, opaque = 0, magenta = 0;
  for (let p = 0, i = 0; i < d.length; i += 4, p++) {
    const a = d[i + 3];
    if (a < 16) continue;
    const px = p % W, py = (p / W) | 0;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
    opaque++;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 220 && g < 60 && b > 220) magenta++; // ~PixelLab key RGB(246,4,252) + halo
  }
  if (maxX < 0) return { size: W, bbox: [0, 0, 0, 0], fill: 0, area: 0, magenta };
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  return { size: W, bbox: [minX, minY, bw, bh], fill: +(opaque / (bw * bh)).toFixed(3), area: bw * bh, magenta };
}

const biomes = {};
let count = 0;
for (const biome of fs.readdirSync(ABS).sort()) {
  const bdir = path.join(ABS, biome);
  if (!fs.statSync(bdir).isDirectory()) continue;
  for (const species of fs.readdirSync(bdir).sort()) {
    const odir = path.join(bdir, species);
    if (!fs.statSync(odir).isDirectory()) continue;
    const files = fs.readdirSync(odir).filter(f => /^v\d{3}\.png$/.test(f)).sort();
    if (!files.length) continue;
    const omitSet = omit.get(biome + '/' + species) || new Set();
    const variants = [];
    let size = 0;
    for (const f of files) {
      const v = parseInt(f.match(/^v(\d{3})\.png$/)[1], 10);
      const m = await measure(path.join(odir, f));
      size = m.size;
      variants.push({ v, file: `/${rel}/${biome}/${species}/${f}`, bbox: m.bbox, fill: m.fill,
        area: m.area, magenta: m.magenta, omit: omitSet.has(v) });
      count++;
    }
    const areas = variants.map(x => x.area).filter(a => a > 0).sort((a, b) => a - b);
    const median = areas.length ? areas[areas.length >> 1] : 1;
    for (const x of variants) x.scaleVsMedian = +(x.area / median).toFixed(2);
    (biomes[biome] = biomes[biome] || {})[species] = { size, variants };
    process.stdout.write(`\r${biome}/${species} (${count})        `);
  }
}
fs.writeFileSync(OUT, JSON.stringify({ field, generatedAt: new Date().toISOString(), root: rel, biomes }));
console.log(`\nwrote ${OUT}: ${count} variants across ${Object.keys(biomes).length} biomes`);
