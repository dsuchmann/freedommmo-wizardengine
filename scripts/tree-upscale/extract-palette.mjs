// scripts/tree-upscale/extract-palette.mjs [--biome <name>|all] [--colors 48] [--out scripts/tree-upscale/palettes/]
// COMPONENT C of the tree-upscale pipeline. The AI detail-add (ComfyUI) invents new colors; the deterministic
// re-pixelation tail then `magick -remap`s every upscaled tree back onto a SHARED, biome-true palette so the whole
// forest stays palette-consistent. This script MANUFACTURES those remap palettes from the real tree art.
//
// For each biome we union the colors of ALL its large_flora trees (base v0NN.png + lifecycle _states/**, which carry
// biome-specific colors like burned/frozen/enchanted) and median-cut to --colors. _global.png unions every biome.
// Output is a 1-row, fully-opaque, unique-colors PNG — exactly what `magick -remap palette.png` wants.
//
// WHY ImageMagick (not canvas) for the cut: IM's `-unique-colors` + `+append` + `-colors` is the same median-cut
// the proven tail uses, so the palette we emit and the remap that consumes it agree by construction.
//
// PERF + correctness, learned the hard way:
//   • Spawning one magick per tree = ~1s Windows process-start × hundreds = minutes. Instead ONE magick per biome
//     reads the whole file list (@listfile) and reduces every frame in a single pass.
//   • Some lifecycle states (frozen ice, enchanted glow) are NOT tight pixel-art — they carry 15k–21k gradient
//     colors. Unioned raw, the final median-cut crawls AND glow colors swamp the tree's true palette. So we cap EACH
//     source to --colors first (per-frame `-colors`), giving every tree an equal, bounded vote before the union.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FLORA_ROOT = 'assets/pixelab/landscape_v2/micro/large_flora';
// anim/ frames are pure transforms of the static sprites — redundant color-wise and heavy — so we skip them and
// only mine STATIC sources: every vNNN.png variant plus the lifecycle state PNGs under _states/.
const STATIC_PNG = /^v\d{3}\.png$/i;

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const wantBiome = arg('biome', 'all');
const COLORS = Math.max(1, parseInt(arg('colors', '48'), 10) || 48);
const OUT = arg('out', 'scripts/tree-upscale/palettes/');
const TMP = path.join(OUT, '.tmp'); // scratch strips, cleaned each run

const magick = (args) => execFileSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'] });
const identify = (file, fmt) => execFileSync('magick', ['identify', '-format', fmt, file], { encoding: 'utf8' }).trim();

// Collect every static tree PNG under a biome (recurses type dirs + _states, skips anim/).
function biomeSources(biome) {
  const root = path.join(FLORA_ROOT, biome);
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'anim') walk(p); }       // _states yes, anim no
      else if (STATIC_PNG.test(e.name)) out.push(p);
    }
  };
  if (fs.existsSync(root) && fs.statSync(root).isDirectory()) walk(root);
  return out.sort();
}

// Reduce a list of source PNGs to per-source capped unique-colors strips, in ONE magick pass, writing <stem>-NNNN.png.
// Threshold alpha to 1-bit first (dithered edges can't smuggle stray colors), cap each frame to COLORS (so a 21k-color
// glow state votes with the same weight as a 40-color tree), then emit each frame's unique colors. Returns strip paths.
function reduceToStrips(sources, stem) {
  const listFile = `${stem}.lst`;
  fs.writeFileSync(listFile, sources.join('\n')); // @listfile sidesteps the command-line length cap
  magick([
    `@${listFile}`,
    '-alpha', 'on', '-channel', 'A', '-threshold', '50%', '+channel', // force 1-bit alpha
    '-colors', String(COLORS), '-unique-colors',                      // per-frame cap → equal bounded vote
    `${stem}-%04d.png`,
  ]);
  fs.rmSync(listFile, { force: true });
  // Magick numbers frames 0..N-1 in input order; reconstruct that exact list.
  return sources.map((_, i) => `${stem}-${String(i).padStart(4, '0')}.png`);
}

// Append already-tiny strips → one quantized 1-row palette PNG. The append canvas is now ≤N·COLORS px, so this is
// instant. `-alpha off` drops the per-source transparent slots (they merge into the art's own near-black — verified,
// no stray color), then median-cut to COLORS opaque colors. FINALLY we append ONE transparent pixel: the proven tail
// ends in `-remap palette.png`, and `-remap` only keeps a pixel transparent if the palette itself contains a
// transparent color (the proven demo palette.png does exactly this — channels=srgba, alpha k=2). Without it the remap
// silently flattens every tree's transparent surround into an opaque sprite. So a correct remap palette is
// COLORS opaque colors + 1 transparent entry.
function buildPaletteFromStrips(strips, outFile) {
  if (!strips.length) return null;
  const listFile = `${outFile}.lst`;
  fs.writeFileSync(listFile, strips.join('\n'));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  magick([
    `@${listFile}`,
    '+append', '-unique-colors',
    '-alpha', 'off', '-unique-colors',
    '-colors', String(COLORS), '-unique-colors',  // COLORS opaque colors, one per cell
    '(', '-size', '1x1', 'xc:none', ')', '+append', // + a transparent cell so -remap preserves sprite alpha
    // WHY -depth 8: this is a Q16 ImageMagick build, so without this the palette PNG is written at 16
    // bits/channel. `magick -remap` (the repixelate tail) then ROUNDS 16->8 (4597/257 -> 18) while the QA
    // gate's @napi-rs/canvas decoder FLOORS the same sample (4597>>8 -> 17). That off-by-one makes the QA
    // palette set miss the very colors the tail snapped to, so a byte-correct sprite fails QA on its darkest
    // pixels. Emitting the palette at 8-bit kills the ambiguity: both consumers read identical bytes.
    '-depth', '8',
    outFile,
  ]);
  fs.rmSync(listFile, { force: true });
  return outFile;
}

// Validate: a usable -remap palette is a real PNG, exactly 1 row tall, carries a transparent entry (so remap keeps
// sprite alpha), and has > 0 and <= COLORS *opaque* colors. Total unique colors = opaque + the 1 transparent slot.
function validate(file) {
  const wh = identify(file, '%w %h').split(' ').map(Number);
  const hasAlpha = identify(file, '%[channels]').includes('a');
  const opaqueColors = parseInt(identify(file, '%k'), 10) - (hasAlpha ? 1 : 0); // the lone none-pixel is the +1
  const ok = wh[1] === 1 && hasAlpha && opaqueColors > 0 && opaqueColors <= COLORS;
  return { width: wh[0], height: wh[1], colors: opaqueColors, hasAlpha, ok };
}

// ── run ──────────────────────────────────────────────────────────────────────
const allBiomes = fs.readdirSync(FLORA_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name)
  .sort();
const biomes = wantBiome === 'all' ? allBiomes : [wantBiome];

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
console.log(`extract-palette: colors=${COLORS} out=${OUT} biomes=${biomes.join(',')}`);
const globalStrips = [];
const report = [];
for (const biome of biomes) {
  const sources = biomeSources(biome);
  if (!sources.length) { console.warn(`  ${biome}: no static tree PNGs — skipped`); continue; }
  const strips = reduceToStrips(sources, path.join(TMP, biome));
  globalStrips.push(...strips); // reuse the same per-source strips for the world palette — no re-reduce
  const outFile = path.join(OUT, `${biome}.png`);
  buildPaletteFromStrips(strips, outFile);
  const v = validate(outFile);
  report.push({ biome, sources: sources.length, ...v });
  console.log(`  ${biome}: ${sources.length} sources → ${outFile}  (${v.colors} colors +alpha, ok=${v.ok})`);
  if (!v.ok) throw new Error(`palette validation failed for ${biome}: ${JSON.stringify(v)}`);
}

// _global only makes sense when sourcing every biome (the proven shared-world palette). Reuses the per-source strips.
if (wantBiome === 'all') {
  const gOut = path.join(OUT, '_global.png');
  buildPaletteFromStrips(globalStrips, gOut);
  const gv = validate(gOut);
  report.push({ biome: '_global', sources: globalStrips.length, ...gv });
  console.log(`  _global: ${globalStrips.length} sources → ${gOut}  (${gv.colors} colors +alpha, ok=${gv.ok})`);
  if (!gv.ok) throw new Error(`palette validation failed for _global: ${JSON.stringify(gv)}`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\nSUMMARY  biome / sources / colors / ok');
for (const r of report) console.log(`  ${r.biome.padEnd(16)} ${String(r.sources).padStart(5)}  ${String(r.colors).padStart(3)}  ${r.ok}`);
