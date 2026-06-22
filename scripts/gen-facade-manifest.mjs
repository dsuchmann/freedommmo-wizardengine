// scripts/gen-facade-manifest.mjs — post-process PixelLab façade sprites + build the manifest.
//
// For every assets/pixelab/buildings/facade/<biome>/<archetype>/raw__v*.png:
//   1. alpha-trim to the opaque content bbox
//   2. GROUND-APRON REMOVAL: PixelLab bakes a grass/ground patch at the base despite prompts. In
//      the BOTTOM band only (top stays untouched so green/mossy ROOFS survive), key out
//      grass-green pixels (green-dominant) → transparent. Then re-trim.
//   3. measure groundFrac (the building's ground-contact line as a fraction of content height) and
//      doorXFrac, write the cleaned sprite to whole__v*.png
//   4. emit facade-manifest.json: { biome: { archetype: [ {variant,file,groundFrac,doorXFrac,contentW,contentH} ] } }
//
// Re-runnable: processes whatever raw__ files exist (run again after regenerating any sprite).
//
// Usage: node scripts/gen-facade-manifest.mjs   (from repo root)

import { createCanvas, loadImage, ImageData } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FACADE_DIR = path.join(ROOT, 'assets', 'pixelab', 'buildings', 'facade');
const ALPHA_MIN = 24;                 // opaque threshold
const GRASS_BAND = +(process.env.GRASS_BAND || 0.42);  // bottom fraction where we key grass
const GREEN_MIN = +(process.env.GREEN_MIN || 44);      // min green channel to be "grass"

function alphaBBox(data, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > ALPHA_MIN) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return (x1 < 0) ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// is this pixel grass-green? (green clearly dominant over red and blue)
function isGrass(r, g, b) {
  return g > GREEN_MIN && g > r * 1.10 && g > b * 1.12 && (g - Math.max(r, b)) > 14;
}

// Drop ground-apron debris left after the grass key: keep the largest connected opaque component
// (the building); drop any OTHER component that is tiny (litter: flowers, stubs) or sits entirely
// inside the bottom band (the detached grass-outline ring / pebbles). 8-connectivity, iterative.
function dropApronIslands(p, W, H, bb) {
  const N = W * H;
  const label = new Int32Array(N); // 0 = transparent/unvisited
  const opaque = (i) => p[i * 4 + 3] > ALPHA_MIN;
  const comps = []; // {area, minY}
  const stack = [];
  let next = 0;
  for (let s = 0; s < N; s++) {
    if (label[s] !== 0 || !opaque(s)) continue;
    next++; const id = next;
    let area = 0, minY = H;
    stack.length = 0; stack.push(s); label[s] = id;
    while (stack.length) {
      const cur = stack.pop();
      area++; const cy = (cur / W) | 0; if (cy < minY) minY = cy;
      const cx = cur - cy * W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (label[ni] === 0 && opaque(ni)) { label[ni] = id; stack.push(ni); }
      }
    }
    comps[id] = { area, minY };
  }
  if (next <= 1) return;
  let big = 1; for (let id = 2; id <= next; id++) if (comps[id].area > comps[big].area) big = id;
  const bandTopY = bb.y0 + Math.round(bb.h * (1 - 0.32)); // "entirely in bottom band" threshold
  const drop = new Uint8Array(next + 1);
  for (let id = 1; id <= next; id++) {
    if (id === big) continue;
    if (comps[id].area < comps[big].area * 0.012 || comps[id].minY >= bandTopY) drop[id] = 1;
  }
  for (let i = 0; i < N; i++) { const id = label[i]; if (id && drop[id]) p[i * 4 + 3] = 0; }
}

function processOne(rawPath, biome, archetype, variant) {
  const out = { ok: false };
  return loadImage(rawPath).then((img) => {
    const W = img.width, H = img.height;
    const c = createCanvas(W, H); const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    const id = cx.getImageData(0, 0, W, H); const p = id.data;

    let bb = alphaBBox(p, W, H);
    if (!bb) throw new Error('empty after load: ' + rawPath);

    // grass key in the bottom band of the content bbox
    const bandTop = bb.y0 + Math.round(bb.h * (1 - GRASS_BAND));
    for (let y = bandTop; y <= bb.y1; y++) {
      for (let x = bb.x0; x <= bb.x1; x++) {
        const i = (y * W + x) * 4;
        if (p[i + 3] <= ALPHA_MIN) continue;
        if (isGrass(p[i], p[i + 1], p[i + 2])) p[i + 3] = 0;
      }
    }

    // CONNECTED-COMPONENT cleanup. Keying the green severs the grass APRON from the building,
    // leaving its outline ring + flowers + grass stubs as detached islands in the bottom band.
    // Keep the largest component (the building) always; drop any OTHER component that is either
    // tiny (litter) or sits entirely inside the bottom band (ground apron debris). This preserves
    // connected building parts (steps, porches, chimneys, signs) while erasing the apron ghost.
    dropApronIslands(p, W, H, bb);

    cx.putImageData(new ImageData(p, W, H), 0, 0);
    bb = alphaBBox(p, W, H);
    if (!bb) throw new Error('empty after key: ' + rawPath);

    // crop to content
    const cw = bb.w, ch = bb.h;
    const oc = createCanvas(cw, ch); const ox = oc.getContext('2d');
    ox.drawImage(c, bb.x0, bb.y0, cw, ch, 0, 0, cw, ch);

    // measure groundFrac: lowest row whose opaque span is >= 22% of width (the building base,
    // ignoring a thin path/shadow tail). Fraction of content height.
    const oid = ox.getImageData(0, 0, cw, ch).data;
    let groundRow = ch - 1;
    for (let y = ch - 1; y >= 0; y--) {
      let span = 0; for (let x = 0; x < cw; x++) if (oid[(y * cw + x) * 4 + 3] > ALPHA_MIN) span++;
      if (span >= cw * 0.22) { groundRow = y; break; }
    }
    const groundFrac = +((groundRow + 1) / ch).toFixed(4);

    // doorXFrac: darkest-column center in the bottom 30% (the door is dark) — fallback 0.5
    let doorXFrac = 0.5;
    {
      const y0 = Math.round(ch * 0.70);
      let best = 1e9, bestX = -1;
      for (let x = Math.round(cw * 0.2); x < Math.round(cw * 0.8); x++) {
        let sum = 0, n = 0;
        for (let y = y0; y < ch; y++) { const i = (y * cw + x) * 4; if (oid[i + 3] > ALPHA_MIN) { sum += oid[i] + oid[i + 1] + oid[i + 2]; n++; } }
        if (n > ch * 0.08) { const avg = sum / n; if (avg < best) { best = avg; bestX = x; } }
      }
      if (bestX >= 0) doorXFrac = +((bestX) / cw).toFixed(3);
    }

    const file = `assets/pixelab/buildings/facade/${biome}/${archetype}/whole__v${variant}.png`;
    fs.writeFileSync(path.join(ROOT, file), oc.toBuffer('image/png'));
    return { ok: true, variant, file, groundFrac, doorXFrac, contentW: cw, contentH: ch };
  }).catch((e) => ({ ok: false, error: String(e && e.message || e), variant }));
}

async function main() {
  if (!fs.existsSync(FACADE_DIR)) { console.error('no façade dir'); process.exit(1); }
  const manifest = {};
  const biomes = fs.readdirSync(FACADE_DIR).filter((d) => fs.statSync(path.join(FACADE_DIR, d)).isDirectory() && d !== '_pilots');
  for (const biome of biomes) {
    const bdir = path.join(FACADE_DIR, biome);
    const archetypes = fs.readdirSync(bdir).filter((d) => fs.statSync(path.join(bdir, d)).isDirectory());
    for (const arch of archetypes) {
      const adir = path.join(bdir, arch);
      const raws = fs.readdirSync(adir).filter((f) => /^raw__v\d+\.png$/.test(f)).sort();
      const entries = [];
      for (const raw of raws) {
        const variant = +raw.match(/v(\d+)/)[1];
        const stat = fs.statSync(path.join(adir, raw));
        if (stat.size < 1024) { console.warn(`skip ${arch}/${raw} (${stat.size}B)`); continue; }
        const r = await processOne(path.join(adir, raw), biome, arch, variant);
        if (r.ok) { entries.push({ variant: r.variant, file: r.file, groundFrac: r.groundFrac, doorXFrac: r.doorXFrac, contentW: r.contentW, contentH: r.contentH }); console.log(`✓ ${biome}/${arch} v${variant}  ${r.contentW}x${r.contentH}  ground=${r.groundFrac} door=${r.doorXFrac}`); }
        else console.warn(`✗ ${arch}/${raw}: ${r.error}`);
      }
      if (entries.length) { (manifest[biome] ||= {})[arch] = entries.sort((a, b) => a.variant - b.variant); }
    }
  }
  const outPath = path.join(FACADE_DIR, 'facade-manifest.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  const total = Object.values(manifest).flatMap((b) => Object.values(b)).reduce((n, a) => n + a.length, 0);
  console.log(`\nmanifest -> ${outPath}  (${total} sprites across ${Object.keys(manifest).length} biome(s))`);
}

main();
