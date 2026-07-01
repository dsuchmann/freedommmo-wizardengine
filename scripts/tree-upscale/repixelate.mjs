#!/usr/bin/env node
// Component B of the tree-upscale pipeline: the deterministic re-pixelation TAIL.
//
// The AI detail-add (ComfyUI/SDXL) produces a blurry, off-palette, soft-alpha
// upscale. CRISPNESS is NOT the model's job — it is recovered here, purely
// deterministically, by re-running the EXACT proven 4-step ImageMagick tail:
//
//   1. -filter point -resize <res>  : hard nearest-neighbour resize to native px grid
//   2. SrcIn de-halo                : composite color over its own opaque copy to
//                                     kill the dark fringe left by soft edges
//   3. -channel A -threshold 50%    : collapse alpha to 1-bit (matte vs. cut)
//   4. -dither None -remap palette  : snap every pixel to the locked tree palette
//
// This module ONLY shells out to `magick` — it never touches pixels itself, so it
// stays byte-for-byte identical to the hand-verified demo in tools/_repixel_demo/.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- tiny arg parser (no deps; --flag value form, matches house CLIs) -------
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) a[t.slice(2)] = argv[++i];
  }
  return a;
}

// Run magick, throw with stderr on non-zero so failures are loud, not silent.
function magick(args) {
  const r = spawnSync('magick', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`magick ${args.join(' ')}\n${r.stderr || r.stdout || `exit ${r.status}`}`);
  }
  return r.stdout;
}

/**
 * Re-pixelate one AI-upscaled sprite into a crisp, palette-locked, 1-bit-alpha PNG.
 * Pure pass-through to magick; temp files live in an OS temp dir, always cleaned up.
 *
 * `source` (the ORIGINAL sprite) is REQUIRED in production: the SDXL detail-add
 * outputs a SOLID RGB square with no usable alpha, so the silhouette must come from
 * the source's own 1-bit alpha — we keep the model's DETAIL but the source's SHAPE.
 * Without `source` we fall back to the old self-alpha tail (used by the demo/tests
 * where the input already carries the correct cutout).
 *
 * @param {{ in:string, out:string, res:number, palette:string, source?:string }} opts
 */
export function repixelate({ in: input, out, res, palette, source }) {
  const dir = mkdtempSync(join(tmpdir(), 'repixel-'));
  const s1 = join(dir, 's1.png');
  const s2 = join(dir, 's2.png');
  const s3 = join(dir, 's3.png');
  try {
    if (source) {
      // 1) model DETAIL as opaque RGB on the native grid (discard the model's alpha)
      magick([input, '-alpha', 'off', '-filter', 'point', '-resize', `${res}x${res}`, s1]);
      // 2) snap RGB to the (per-source) palette FIRST, while still fully opaque — so the
      //    remap can't flatten/drop the alpha (a palette without a transparent slot would).
      magick([s1, '-dither', 'None', '-remap', palette, s2]);
      // 3) SOURCE silhouette -> hard 1-bit mask at the same grid
      magick([source, '-alpha', 'extract', '-filter', 'point', '-resize', `${res}x${res}`, '-threshold', '50%', s3]);
      // 4) apply the source mask as alpha LAST, so the cutout survives any palette
      magick([s2, s3, '-compose', 'CopyOpacity', '-composite', out]);
    } else {
      // self-alpha tail (input already has a correct 1-bit cutout — demo/tests)
      magick([input, '-filter', 'point', '-resize', `${res}x${res}`, s1]);
      magick([s1, '(', '+clone', '-alpha', 'off', ')', '-compose', 'SrcIn', '-composite', s2]);
      magick([s2, '-channel', 'A', '-threshold', '50%', '+channel', s3]);
      magick([s3, '-dither', 'None', '-remap', palette, out]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- report helpers (used by CLI + the validator) --------------------------

/** "<w>x<h>" of an image. */
export function dimsOf(png) {
  return magick(['identify', '-format', '%wx%h', png]).trim();
}

/** Count of distinct RGB colors (alpha ignored), via -alpha off histogram. */
export function rgbColorCount(png) {
  // %k over the RGB channels only; -alpha off folds away transparency variants.
  return Number(magick(['identify', '-format', '%k', `${png}[0]`, '-alpha', 'off']).trim());
}

/** Sorted list of distinct alpha values (0..255). 1-bit alpha => <=2 entries. */
export function alphaValues(png) {
  // Pull the alpha channel as a standalone gray image, then read its histogram.
  const dir = mkdtempSync(join(tmpdir(), 'repixel-a-'));
  const a = join(dir, 'a.png');
  try {
    magick([png, '-alpha', 'extract', a]);
    const out = magick(['convert', a, '-format', '%c', 'histogram:info:']);
    // histogram lines look like: "  12345: (255,255,255) #FFFFFF gray(255)"
    const vals = new Set();
    for (const line of out.split('\n')) {
      const m = line.match(/gray\((\d+)\)/) || line.match(/\((\d+),\d+,\d+\)/);
      if (m) vals.add(Number(m[1]));
    }
    return [...vals].sort((x, y) => x - y);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- CLI entry --------------------------------------------------------------
const isMain = import.meta.url === `file://${process.argv[1]}` ||
               import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/'));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const res = Number(args.res);
  if (!args.in || !args.out || !res || !args.palette) {
    console.error('usage: node repixelate.mjs --in <up.png> --out <final.png> --res 384 --palette <palette.png> [--source <orig.png>]');
    process.exit(2);
  }
  repixelate({ in: args.in, out: args.out, res, palette: args.palette, source: args.source });
  const dims = dimsOf(args.out);
  const colors = rgbColorCount(args.out);
  const alphas = alphaValues(args.out);
  console.log(`out:      ${args.out}`);
  console.log(`dims:     ${dims}`);
  console.log(`colors:   ${colors} RGB`);
  console.log(`alpha:    ${alphas.length <= 2 ? '1-bit' : `${alphas.length}-valued`} (${alphas.join(', ')})`);
}
