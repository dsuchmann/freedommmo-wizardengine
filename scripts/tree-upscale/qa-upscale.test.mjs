// scripts/tree-upscale/qa-upscale.test.mjs
// node --test  scripts/tree-upscale/qa-upscale.test.mjs
//
// Locks in Component D's gate behaviour against the REAL demo PNGs plus three derived
// fault fixtures (built once with the same `magick` tail the production pipeline uses,
// so the test exercises real pixels, never synthetic mocks). Each fixture isolates one
// check so a future threshold change that silently breaks a check is caught here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQA } from './qa-upscale.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DEMO = path.join(REPO, 'tools', '_repixel_demo');
const OAK = path.join(REPO, 'assets/pixelab/landscape_v2/micro/large_flora/dense_forest/ancient_oak');

const FINAL   = path.join(DEMO, 'final.png');     // known-good 384px repixel of v000
const PALETTE = path.join(DEMO, 'palette.png');   // master swatch
const SRC0    = path.join(OAK, 'v000.png');       // source the demo was built from
const SRC1    = path.join(OAK, 'v001.png');       // a differently-shaped lifecycle variant

const mg = (...a) => execFileSync('magick', a, { stdio: ['ignore', 'ignore', 'ignore'] });

// Build the derived fault fixtures once. If `magick` is unavailable the whole suite skips
// rather than failing for an environment reason.
let haveMagick = true;
const BLUR   = path.join(DEMO, '_t_blur.png');    // smoothed → fails alpha+palette+crispness
const DRIFT  = path.join(DEMO, '_t_drift.png');   // v001 run through the real tail → fails silhouette only
const OFFPAL = path.join(DEMO, '_t_offpal.png');  // tinted final → fails palette only

test.before(() => {
  try {
    // (a) gaussian blur of the good final: destroys 1-bit alpha, palette and blockiness at once.
    mg(FINAL, '-blur', '0x3', BLUR);
    // (b) the EXACT proven repixel tail on v001 against v000's palette → crisp, in-palette, 1-bit,
    //     but a different silhouette from v000. Isolates the IoU check.
    const d1 = path.join(DEMO, '_t_d1.png'), d2 = path.join(DEMO, '_t_d2.png'), d3 = path.join(DEMO, '_t_d3.png');
    mg(SRC1, '-filter', 'point', '-resize', '384x384', d1);
    mg(d1, '(', '+clone', '-alpha', 'off', ')', '-compose', 'SrcIn', '-composite', d2);
    mg(d2, '-channel', 'A', '-threshold', '50%', '+channel', d3);
    mg(d3, '-dither', 'None', '-remap', PALETTE, DRIFT);
    // (c) shift the red channel of the good final: stays crisp + 1-bit + same silhouette, colours
    //     leave the palette. Isolates the palette check.
    mg(FINAL, '-channel', 'R', '-evaluate', 'add', '30%', '+channel', OFFPAL);
  } catch {
    haveMagick = false;
  }
});

test.after(() => {
  for (const f of ['_t_blur.png', '_t_drift.png', '_t_offpal.png', '_t_d1.png', '_t_d2.png', '_t_d3.png']) {
    try { fs.unlinkSync(path.join(DEMO, f)); } catch {}
  }
});

test('PASS: real known-good final.png passes every check', async () => {
  const r = await runQA({ final: FINAL, source: SRC0, palette: PALETTE });
  assert.equal(r.pass, true, JSON.stringify(r.reasons));
  for (const [name, c] of Object.entries(r.checks)) assert.equal(c.pass, true, `check ${name} should pass`);
  assert.deepEqual(r.reasons, []);
});

test('FAIL: gaussian-blurred final trips alpha, palette and crispness', async (t) => {
  if (!haveMagick) return t.skip('magick unavailable');
  const r = await runQA({ final: BLUR, source: SRC0, palette: PALETTE });
  assert.equal(r.pass, false);
  assert.equal(r.checks.alpha.pass, false, 'blur should break 1-bit alpha');
  assert.equal(r.checks.palette.pass, false, 'blur invents off-palette colours');
  assert.equal(r.checks.crispness.pass, false, 'blur is not blocky');
  assert.ok(r.reasons.length >= 3);
});

test('FAIL (isolated): silhouette drift — crisp+in-palette v001 tail vs v000 source', async (t) => {
  if (!haveMagick) return t.skip('magick unavailable');
  const r = await runQA({ final: DRIFT, source: SRC0, palette: PALETTE });
  assert.equal(r.pass, false);
  assert.equal(r.checks.alpha.pass, true, 'tail output is 1-bit');
  assert.equal(r.checks.palette.pass, true, 'remapped to palette');
  assert.equal(r.checks.crispness.pass, true, 'point-repixel is blocky');
  assert.equal(r.checks.silhouette.pass, false, 'v001 shape differs from v000');
  assert.ok(r.checks.silhouette.iou < 0.8);
});

test('FAIL (isolated): off-palette tint trips ONLY the palette check', async (t) => {
  if (!haveMagick) return t.skip('magick unavailable');
  const r = await runQA({ final: OFFPAL, source: SRC0, palette: PALETTE });
  assert.equal(r.pass, false);
  assert.equal(r.checks.alpha.pass, true);
  assert.equal(r.checks.silhouette.pass, true, 'tint preserves silhouette');
  assert.equal(r.checks.crispness.pass, true, 'tint preserves blockiness');
  assert.equal(r.checks.palette.pass, false, 'tinted colours are off-world');
});

test('errors when a required arg is missing', async () => {
  await assert.rejects(() => runQA({ final: FINAL, source: SRC0 }), /palette/);
});
