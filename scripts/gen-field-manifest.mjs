// scripts/gen-field-manifest.mjs [sourceId|--all]   (default f6)
// Scans ALL on-disk variants for a source and emits factual per-variant metadata for tools/field-studio.html.
// Factual only — NO judgment. Marks current omit-state from the curation sidecar so the dashboard resumes.
// --all regenerates every source's manifest AND writes tools/field-sources.json (dashboard tab list).
import fs from 'fs';
import path from 'path';
import url from 'url';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { SOURCES, sourceById, loadCuration, omitSetMap } from './lib/field-curation.mjs';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
// Scan assets from FIELD_ASSET_ROOT when set (e.g. the MAIN checkout for gitignored fields like large_objects);
// outputs still land in this checkout's tools/. Mirrors field-curation.mjs ASSET_BASE.
const ASSET_ROOT = process.env.FIELD_ASSET_ROOT ? path.resolve(process.env.FIELD_ASSET_ROOT) : ROOT;

// Read a PNG's opaque bbox + fill + magenta-key count via canvas pixels.
// Tolerates undecodable files (some on-disk variants are saved API error stubs, not real PNGs):
// returns a broken sentinel so the dashboard surfaces them instead of the whole source aborting.
async function measure(file) {
  let img;
  try { img = await loadImage(file); }
  catch (e) { return { size: 0, bbox: [0, 0, 0, 0], fill: 0, area: 0, magenta: 0, opaque: 0, broken: true }; }
  const W = img.width, H = img.height;
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H).data;
  let minX = W, minY = H, maxX = -1, maxY = -1, opaque = 0, magenta = 0;
  const rowMin = new Int32Array(H).fill(W), rowMax = new Int32Array(H).fill(-1), rowCnt = new Int32Array(H);
  for (let p = 0, i = 0; i < d.length; i += 4, p++) {
    const a = d[i + 3];
    if (a < 16) continue;
    const px = p % W, py = (p / W) | 0;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
    if (px < rowMin[py]) rowMin[py] = px; if (px > rowMax[py]) rowMax[py] = px;
    rowCnt[py]++; opaque++;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 220 && g < 60 && b > 220) magenta++; // ~PixelLab key RGB(246,4,252) + halo
  }
  if (maxX < 0) return { size: W, bbox: [0, 0, 0, 0], fill: 0, area: 0, magenta, opaque: 0 };
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  // Band metrics for the baked-GROUND heuristic: a ground disc is a wide, near-solid opaque band at the very
  // bottom, wider than the body (trunk) just above it.
  const bandWidth = (y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) if (rowMax[y] >= 0) { s += rowMax[y] - rowMin[y] + 1; n++; } return n ? s / n : 0; };
  const bandFill = (y0, y1, w) => { let s = 0; for (let y = y0; y < y1; y++) s += rowCnt[y]; const rows = y1 - y0; return (w > 0 && rows > 0) ? s / (w * rows) : 0; };
  const by0 = Math.floor(H * 0.88), bottomWidth = bandWidth(by0, H);
  return { size: W, bbox: [minX, minY, bw, bh], fill: +(opaque / (bw * bh)).toFixed(3), area: bw * bh, magenta, opaque,
    bottomWidth: Math.round(bottomWidth), bottomFill: +bandFill(by0, H, bottomWidth).toFixed(3),
    midWidth: Math.round(bandWidth(Math.floor(H * 0.40), Math.floor(H * 0.60))) };
}

// Deterministic pre-curation QA gate: pixel-only flags that catch the MECHANICAL failures (so human curation
// only sees real art decisions), derived from the large_objects audit. BLANK = empty/failed magenta render;
// SQUARE = opaque plate to the edges; CROP = crown/base clipped at the top/bottom edge; GROUND = wide near-solid
// base band (baked ground disc); SCALE (added per-species in genOne) = area far from the species median.
// Reusable for every field. HALO is intentionally NOT gated — self-luminous subjects (mystic/magma) need a glow.
function qaFlags(m) {
  if (m.broken) return { flags: ['BROKEN'] };
  const W = m.size; if (!W) return { flags: [] };
  const total = W * W; // PixelLab map objects are square
  const opaqueFrac = m.opaque / total, magentaFrac = m.magenta / total;
  const flags = [];
  if (opaqueFrac < 0.01 || magentaFrac > 0.5) flags.push('BLANK');
  if (m.fill >= 0.95 && m.area >= 0.97 * total) flags.push('SQUARE');
  if (m.bbox[1] <= 0) flags.push('CROP'); // crown clipped at the TOP edge (a base at the bottom edge is normal for a grounded specimen)
  if (m.bottomWidth >= 0.5 * W && m.bottomWidth >= 1.6 * m.midWidth && m.bottomFill >= 0.55) flags.push('GROUND');
  return { flags, opaqueFrac: +opaqueFrac.toFixed(3), magentaFrac: +magentaFrac.toFixed(3) };
}

async function genOne(id) {
  const src = sourceById(id);
  const rel = src.root;
  const ABS = path.join(ASSET_ROOT, rel);
  const OUT = path.join(ROOT, 'tools', `field-manifest.${id}.json`);
  const re = new RegExp(src.fileRegex);
  const omit = omitSetMap(loadCuration(id));

  // group = top-level dir (e.g. biome), object = 2nd-level dir (e.g. species/prop). Skip _-prefixed dirs.
  const biomes = {};
  let count = 0;
  for (const biome of fs.readdirSync(ABS).sort()) {
    if (biome.startsWith('_')) continue;
    const bdir = path.join(ABS, biome);
    if (!fs.statSync(bdir).isDirectory()) continue;
    for (const species of fs.readdirSync(bdir).sort()) {
      if (species.startsWith('_')) continue;
      const odir = path.join(bdir, species);
      if (!fs.statSync(odir).isDirectory()) continue;
      const files = fs.readdirSync(odir).filter(f => re.test(f)).sort();
      if (!files.length) continue;
      const omitSet = omit.get(biome + '/' + species) || new Set();
      const variants = [];
      let size = 0;
      for (const f of files) {
        const v = parseInt(f.match(re)[1], 10);
        const m = await measure(path.join(odir, f));
        if (m.size) size = m.size;
        variants.push({ v, file: `/${rel}/${biome}/${species}/${f}`, bbox: m.bbox, fill: m.fill,
          area: m.area, magenta: m.magenta, omit: omitSet.has(v), qa: qaFlags(m), ...(m.broken ? { broken: true } : {}) });
        count++;
      }
      variants.sort((a, b) => a.v - b.v);
      const areas = variants.map(x => x.area).filter(a => a > 0).sort((a, b) => a - b);
      const median = areas.length ? areas[areas.length >> 1] : 1;
      for (const x of variants) {
        x.scaleVsMedian = +(x.area / median).toFixed(2);
        if (x.qa && !x.qa.flags.includes('BROKEN') && (x.scaleVsMedian < 0.4 || x.scaleVsMedian > 2.5)) x.qa.flags.push('SCALE');
      }
      (biomes[biome] = biomes[biome] || {})[species] = { size, variants };
      process.stdout.write(`\r${id} ${biome}/${species} (${count})        `);
    }
  }
  const qaFlagCounts = {};
  for (const bm in biomes) for (const sp in biomes[bm]) for (const vv of biomes[bm][sp].variants)
    for (const fl of (vv.qa && vv.qa.flags || [])) qaFlagCounts[fl] = (qaFlagCounts[fl] || 0) + 1;
  fs.writeFileSync(OUT, JSON.stringify({ field: id, generatedAt: new Date().toISOString(), root: rel, qaFlagCounts, biomes }));
  console.log(`\nwrote ${OUT}: ${count} variants across ${Object.keys(biomes).length} ${src.group}s`);
  console.log(`  QA flags: ${Object.entries(qaFlagCounts).map(([k, n]) => `${k}=${n}`).join(' ') || '(none)'}`);
  return { id, label: src.label, groups: Object.keys(biomes).length, count };
}

const arg = process.argv[2] || 'f6';
if (arg === '--all') {
  const summary = [];
  for (const s of SOURCES) {
    try {
      summary.push(await genOne(s.id));
    } catch (e) {
      console.error(`  skipped ${s.id}: ${e.message}`);
    }
  }
  const SRC_OUT = path.join(ROOT, 'tools', 'field-sources.json');
  fs.writeFileSync(SRC_OUT, JSON.stringify(SOURCES.map(s => ({ id: s.id, label: s.label })), null, 1) + '\n');
  console.log(`\nwrote ${SRC_OUT}`);
  console.log('\nper-source:');
  for (const r of summary) console.log(`  ${r.id.padEnd(14)} ${String(r.groups).padStart(3)} groups · ${r.count} variants`);
} else {
  await genOne(arg);
}
