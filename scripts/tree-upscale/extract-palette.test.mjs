// node --test scripts/tree-upscale/extract-palette.test.mjs
// Regression-locks the COMPONENT C contract: extract-palette.mjs emits per-biome + _global remap palettes that the
// proven re-pixelation tail can consume to produce a 384px, 1-bit-alpha, palette-locked tree. We generate into a
// throwaway out dir over a tiny biome subset (fast) and assert structure + the end-to-end tail behavior on real art.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');                 // repo root (cwd-independent)
const OUT = path.join(HERE, '_test-out');                 // throwaway palette dir
const COLORS = 16;                                        // small N → fast, contract is N-agnostic
const magick = (args) => execFileSync('magick', args, { cwd: ROOT, encoding: 'utf8' });
const id = (file, fmt) => magick(['identify', '-format', fmt, file]).trim();

before(() => {
  fs.rmSync(OUT, { recursive: true, force: true });
  // forest is the spec's canonical biome and includes wild 15k-color frozen/enchanted states — the stress case.
  execFileSync('node', ['scripts/tree-upscale/extract-palette.mjs', '--biome', 'forest', '--colors', String(COLORS), '--out', OUT],
    { cwd: ROOT, stdio: 'ignore' });
});
after(() => fs.rmSync(OUT, { recursive: true, force: true }));

test('emits a valid forest palette PNG', () => {
  const pal = path.join(OUT, 'forest.png');
  assert.ok(fs.existsSync(pal), 'forest.png written');
  assert.equal(id(pal, '%m'), 'PNG');
  assert.equal(Number(id(pal, '%h')), 1, 'palette is a single row');
});

test('palette holds <= COLORS opaque colors plus one transparent remap slot', () => {
  const pal = path.join(OUT, 'forest.png');
  assert.ok(id(pal, '%[channels]').includes('a'), 'palette carries an alpha channel');
  const total = Number(id(pal, '%k'));
  const opaque = total - 1; // the lone none-pixel is the transparent slot
  assert.ok(opaque > 0 && opaque <= COLORS, `opaque colors ${opaque} in (0, ${COLORS}]`);
});

test('proven tail with this palette → 384px, 1-bit alpha, colors locked to palette', () => {
  const pal = path.join(OUT, 'forest.png');
  const src = 'assets/pixelab/landscape_v2/micro/large_flora/forest/oak/v000.png';
  const w = path.join(OUT, '_tail');
  fs.mkdirSync(w, { recursive: true });
  const P = (f) => path.join(w, f);
  // Stand in for the (absent) AI upscale by point-scaling the real source to 384, then run the EXACT proven tail.
  magick([src, '-filter', 'point', '-resize', '384x384', P('UP.png')]);
  magick([P('UP.png'), '-filter', 'point', '-resize', '384x384', P('s1.png')]);
  magick([P('s1.png'), '(', '+clone', '-alpha', 'off', ')', '-compose', 'SrcIn', '-composite', P('s2.png')]);
  magick([P('s2.png'), '-channel', 'A', '-threshold', '50%', '+channel', P('s3.png')]);
  magick([P('s3.png'), '-dither', 'None', '-remap', pal, P('final.png')]);

  assert.equal(id(P('final.png'), '%w %h'), '384 384', 'output is 384x384');
  // 1-bit alpha preserved: the transparent slot in the palette keeps the tree's surround transparent.
  const alphaLevels = Number(magick([P('final.png'), '-channel', 'A', '-separate', '-format', '%k', 'info:']).trim());
  assert.equal(alphaLevels, 2, 'alpha stays 1-bit (transparent + opaque)');
  // Colors are locked to the palette: remapping again is a no-op (idempotent ⇒ colors ⊆ palette).
  magick([P('final.png'), '-dither', 'None', '-remap', pal, P('final2.png')]);
  const diff = magick(['compare', '-metric', 'AE', P('final.png'), P('final2.png'), 'null:']).trim();
  assert.equal(diff.replace(/[^\d.]/g, '') || '0', '0', 'colors are a strict subset of the palette');
});
