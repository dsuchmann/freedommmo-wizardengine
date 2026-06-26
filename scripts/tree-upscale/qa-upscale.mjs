// scripts/tree-upscale/qa-upscale.mjs
// Component D — the QA gate that REJECTS bad tree upscales before they reach the corpus.
//
// An AI detail-add (ComfyUI/SDXL) can quietly ruin a sprite in ways a human only
// notices in-game: it smooths the blocky pixels, invents off-palette colours, softens
// the 1-bit alpha into a fuzzy halo, or drifts the silhouette so the tree no longer
// matches its footprint/claim. The deterministic re-pixelation tail is SUPPOSED to undo
// all of that — this gate proves it actually did, on the real PNG, so a regression in the
// model or the tail can't slip a smeared sprite into the game.
//
// CLI:
//   node scripts/tree-upscale/qa-upscale.mjs --final <final.png> --source <source.png> --palette <palette.png>
// Exit 0 = PASS, 1 = FAIL. Always prints JSON {pass, checks:{...}, reasons:[...]} to stdout.
//
// All pixel reads go through @napi-rs/canvas (same lib the rest of scripts/ uses) so the
// gate is pure-JS + deterministic — no GPU, no model, no shell magick dependency at runtime.
import { loadImage, createCanvas } from '@napi-rs/canvas';

// ---- tunable thresholds (WHY each is here, not just the number) -------------------------
const MAX_ALPHA_VALUES = 2;   // 1-bit alpha = at most {0, 255}; the sources are 1-bit, the upscale must stay so.
const MAX_UNIQUE_RGB   = 160; // pixel-art trees here sit ~19–105 colours; AI-smooth output blows past this with blends.
const MIN_FLAT_SHARE   = 0.25; // share of orthogonal neighbour PAIRS that are byte-identical. The re-pixel tail
                               //   already guarantees hard pixels + <=64 colours, so this only needs to catch
                               //   genuinely-degenerate noise (a gaussian-blurred mush bands to ~0.15). BUSY but
                               //   crisp sprites (frozen ice/frost/sparkle detail) legitimately sit ~0.30 — 0.40
                               //   false-failed them. 0.25 passes detailed art, still rejects ~0.15 smear.
                               //   NB: we count equal *pairs*, not "all-4-equal" pixels — at a 2x repixel the interior
                               //   of a 2x2 block shares only 2 of its 4 neighbours, so "all-4-equal" is misleadingly low.
const MIN_SILHOUETTE_IOU = 0.80; // alpha IoU vs the source point-upscaled to final res — guards shape drift.

// Read a PNG into {w, h, data:Uint8ClampedArray RGBA}. createCanvas avoids any resampling.
async function readRGBA(path) {
  const img = await loadImage(path);
  const w = img.width, h = img.height;
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

// Point-resample a {w,h,data} RGBA buffer to (tw,th) with nearest-neighbour — matches
// `magick -filter point -resize`, so the silhouette we compare against is the SAME upscale
// the production tail starts from (no smoothing introduced by us).
function pointResample(src, tw, th) {
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(src.h - 1, Math.floor((y * src.h) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(src.w - 1, Math.floor((x * src.w) / tw));
      const si = (sy * src.w + sx) * 4, di = (y * tw + x) * 4;
      out[di] = src.data[si]; out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2]; out[di + 3] = src.data[si + 3];
    }
  }
  return { w: tw, h: th, data: out };
}

const ALPHA_CUT = 128; // treat alpha >= this as "opaque" for silhouette/binary purposes.

// (1) ALPHA is 1-bit: at most MAX_ALPHA_VALUES distinct alpha bytes appear.
function checkAlpha(fin) {
  const seen = new Set();
  for (let i = 3; i < fin.data.length; i += 4) {
    seen.add(fin.data[i]);
    if (seen.size > MAX_ALPHA_VALUES + 4) break; // early-out; we only need to know it exceeds the cap
  }
  return { pass: seen.size <= MAX_ALPHA_VALUES, distinctAlpha: seen.size, allowed: MAX_ALPHA_VALUES };
}

// (2) PALETTE conformance: every non-transparent final pixel's RGB exists in the palette.
//     The palette is a master swatch (may be wider than the sprite actually uses) — we only
//     require containment, never equality. Transparent pixels are ignored (their RGB is moot).
function checkPalette(fin, pal) {
  const allowed = new Set();
  for (let i = 0; i < pal.data.length; i += 4) {
    if (pal.data[i + 3] < ALPHA_CUT) continue; // skip the palette's own transparent slot
    allowed.add((pal.data[i] << 16) | (pal.data[i + 1] << 8) | pal.data[i + 2]);
  }
  let offWorld = 0, opaque = 0;
  const sampleBad = [];
  for (let i = 0; i < fin.data.length; i += 4) {
    if (fin.data[i + 3] < ALPHA_CUT) continue;
    opaque++;
    const rgb = (fin.data[i] << 16) | (fin.data[i + 1] << 8) | fin.data[i + 2];
    if (!allowed.has(rgb)) {
      offWorld++;
      if (sampleBad.length < 5) sampleBad.push('#' + rgb.toString(16).padStart(6, '0'));
    }
  }
  return { pass: offWorld === 0, paletteSize: allowed.size, opaquePixels: opaque, offPalettePixels: offWorld, sample: sampleBad };
}

// (3) NOT smoothed/blurry: two proxies must BOTH hold.
//   (a) unique RGB count stays under MAX_UNIQUE_RGB (blends explode this — the demo blur hit 33k vs ~105),
//   (b) "flat share" — fraction of orthogonal neighbour PAIRS that are byte-identical. To avoid
//       double-counting and direction bias we only look right + down from each opaque pixel; a pair counts
//       only when BOTH ends are opaque (transparent/off-canvas neighbours are skipped, never penalised).
//       Blocky pixel-art is full of identical runs (good demo ~0.70); a gaussian blur makes nearly every
//       neighbour differ (~0.15), so this cleanly catches a smoothed upscale the colour cap might miss.
function checkCrispness(fin) {
  const { w, h, data } = fin;
  const uniq = new Set();
  let opaque = 0, pairs = 0, equalPairs = 0;
  const idx = (x, y) => (y * w + x) * 4;
  const sameRGB = (a, b) => data[a] === data[b] && data[a + 1] === data[b + 1] && data[a + 2] === data[b + 2];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (data[i + 3] < ALPHA_CUT) continue;
      opaque++;
      uniq.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      // right + down only → each opaque-opaque pair is counted once.
      if (x + 1 < w) { const ni = idx(x + 1, y); if (data[ni + 3] >= ALPHA_CUT) { pairs++; if (sameRGB(i, ni)) equalPairs++; } }
      if (y + 1 < h) { const ni = idx(x, y + 1); if (data[ni + 3] >= ALPHA_CUT) { pairs++; if (sameRGB(i, ni)) equalPairs++; } }
    }
  }
  const flatShare = pairs ? equalPairs / pairs : 0;
  return {
    pass: uniq.size <= MAX_UNIQUE_RGB && flatShare >= MIN_FLAT_SHARE,
    uniqueRGB: uniq.size, maxUniqueRGB: MAX_UNIQUE_RGB,
    opaquePixels: opaque,
    flatShare: +flatShare.toFixed(4), minFlatShare: MIN_FLAT_SHARE,
  };
}

// (4) SILHOUETTE preserved: alpha IoU between final and the source point-upscaled to final res.
//     Both reduced to binary masks at ALPHA_CUT; IoU = |A∩B| / |A∪B|.
function checkSilhouette(fin, src) {
  const up = pointResample(src, fin.w, fin.h);
  let inter = 0, union = 0;
  for (let i = 3; i < fin.data.length; i += 4) {
    const a = fin.data[i] >= ALPHA_CUT, b = up.data[i] >= ALPHA_CUT;
    if (a && b) inter++;
    if (a || b) union++;
  }
  const iou = union ? inter / union : 1; // two empty masks are trivially identical
  return { pass: iou >= MIN_SILHOUETTE_IOU, iou: +iou.toFixed(4), minIoU: MIN_SILHOUETTE_IOU };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--final') out.final = argv[++i];
    else if (argv[i] === '--source') out.source = argv[++i];
    else if (argv[i] === '--palette') out.palette = argv[++i];
  }
  return out;
}

// Run the full gate. Returns {pass, checks, reasons} — exported so node --test can drive it
// without spawning a process or touching exit codes.
export async function runQA({ final, source, palette }) {
  if (!final || !source || !palette) {
    throw new Error('need --final, --source and --palette');
  }
  const [fin, src, pal] = await Promise.all([readRGBA(final), readRGBA(source), readRGBA(palette)]);

  const checks = {
    alpha: checkAlpha(fin),
    palette: checkPalette(fin, pal),
    crispness: checkCrispness(fin),
    silhouette: checkSilhouette(fin, src),
  };

  const reasons = [];
  if (!checks.alpha.pass)
    reasons.push(`alpha not 1-bit: ${checks.alpha.distinctAlpha} distinct values (max ${checks.alpha.allowed})`);
  if (!checks.palette.pass)
    reasons.push(`${checks.palette.offPalettePixels} off-palette pixels e.g. ${checks.palette.sample.join(',')}`);
  if (!checks.crispness.pass) {
    if (checks.crispness.uniqueRGB > checks.crispness.maxUniqueRGB)
      reasons.push(`too many colours: ${checks.crispness.uniqueRGB} > ${checks.crispness.maxUniqueRGB} (smoothed?)`);
    if (checks.crispness.flatShare < checks.crispness.minFlatShare)
      reasons.push(`flat-neighbour share ${checks.crispness.flatShare} < ${checks.crispness.minFlatShare} (blurry, not blocky)`);
  }
  if (!checks.silhouette.pass)
    reasons.push(`silhouette IoU ${checks.silhouette.iou} < ${checks.silhouette.minIoU} (shape drift)`);

  return { pass: reasons.length === 0, checks, reasons };
}

// CLI entrypoint — only runs when invoked directly, not when imported by tests.
const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await runQA(args);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.pass ? 0 : 1);
  } catch (err) {
    process.stdout.write(JSON.stringify({ pass: false, checks: {}, reasons: [String(err.message || err)] }, null, 2) + '\n');
    process.exit(1);
  }
}
