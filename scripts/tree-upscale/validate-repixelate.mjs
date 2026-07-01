#!/usr/bin/env node
// Self-validation for repixelate.mjs against a REAL tree asset.
// Asserts the three contract guarantees of the tail:
//   1. output is exactly --res square (384x384)
//   2. alpha is 1-bit (<=2 distinct values)
//   3. every output RGB color is present in the supplied palette (remap is total)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repixelate, dimsOf, alphaValues } from './repixelate.mjs';

const IN = 'assets/pixelab/landscape_v2/micro/large_flora/dense_forest/ancient_oak/v000.png';
const PALETTE = 'tools/_repixel_demo/palette.png';
const RES = 384;

function magick(args) {
  const r = spawnSync('magick', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`magick ${args.join(' ')}\n${r.stderr}`);
  return r.stdout;
}

// Return Set of "R,G,B" strings for the opaque pixels of an image.
function colorSet(png) {
  // -alpha off so transparent regions don't introduce a phantom RGB;
  // histogram:info: enumerates every distinct color exactly once.
  const out = magick([png, '-alpha', 'off', '-format', '%c', 'histogram:info:']);
  const set = new Set();
  for (const line of out.split('\n')) {
    const m = line.match(/\((\d+),(\d+),(\d+)/);
    if (m) set.add(`${+m[1]},${+m[2]},${+m[3]}`);
  }
  return set;
}

const dir = mkdtempSync(join(tmpdir(), 'repixel-val-'));
const out = join(dir, 'final.png');
let pass = true;
const log = (ok, msg) => { pass = pass && ok; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

try {
  repixelate({ in: IN, out, res: RES, palette: PALETTE });

  // 1) dims
  const dims = dimsOf(out);
  log(dims === `${RES}x${RES}`, `dims == ${RES}x${RES} (got ${dims})`);

  // 2) 1-bit alpha
  const alphas = alphaValues(out);
  log(alphas.length <= 2, `alpha has <=2 unique values (got ${alphas.length}: ${alphas.join(', ')})`);

  // 3) every output color in palette
  const palColors = colorSet(PALETTE);
  const outColors = colorSet(out);
  const strays = [...outColors].filter((c) => !palColors.has(c));
  log(strays.length === 0,
    `all ${outColors.size} output colors are in the ${palColors.size}-color palette` +
    (strays.length ? ` (${strays.length} stray: ${strays.slice(0, 3).join(' ')}...)` : ''));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(pass ? '\nALL ASSERTS PASSED' : '\nVALIDATION FAILED');
process.exit(pass ? 0 : 1);
