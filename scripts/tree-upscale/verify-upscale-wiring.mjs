#!/usr/bin/env node
// verify-upscale-wiring.mjs — OFFLINE (no GPU, no network) proof that the generalized @384 pipeline +
// game seam behave per spec §4.3/§4.4. Builds a tiny real-pixel fixture (3 objects across the 3 modes,
// + a 2nd field) under a temp FIELD_ASSET_ROOT and asserts:
//   (a) gen-upscale-manifest emits a PER-FIELD _upscaled.json with exactly the right sorted keys;
//   (b) apply-upscale-decisions handles upscale (prints the comfy-batch command, keeps @384),
//       blend (invokes apply-mix — backup proves it ran), direct (quarantines @384, drops it from manifest);
//   (c) upscaleUrl swaps @384 for a listed key under EACH field and leaves a direct/unlisted key untouched,
//       and the large_flora (F6) path is unchanged;
//   (byte) the generalized gen-upscale-manifest produces a BYTE-IDENTICAL large_flora manifest to the
//          original F6-only algorithm (run against the real corpus, snapshot+restored — zero net change).
//
//   node scripts/tree-upscale/verify-upscale-wiring.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { upscaleUrl, __setUpscaleManifest } from '../../src/world/upscale-manifest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const node = process.execPath;
const mg = (...a) => { const r = spawnSync('magick', a, { encoding: 'utf8' }); if (r.status !== 0) throw new Error('magick ' + a.join(' ') + '\n' + (r.stderr || r.stdout)); };
let pass = 0; const ok = (m) => { pass++; console.log('  ok  ' + m); };

// --- 0. fixture -------------------------------------------------------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'upscale-fix-'));
const MICRO = path.join(TMP, 'micro');
function base(rel)  { const f = path.join(MICRO, rel + '.png');       fs.mkdirSync(path.dirname(f), { recursive: true }); mg('-size', '32x32', 'xc:#3a7d34', f); return f; }
function big(rel)   { const f = path.join(MICRO, rel + '@384.png');   fs.mkdirSync(path.dirname(f), { recursive: true }); mg('-size', '384x384', 'xc:#2f6b2a', '-alpha', 'set', f);
  // age it past apply-mix's 15s settle guard so the blend pass doesn't skip it
  const old = Date.now() / 1000 - 600; fs.utimesSync(f, old, old); return f; }
function pair(rel)  { base(rel); big(rel); }

// medium_flora (the decision field): blend / direct / upscale(+override)
pair('medium_flora/grassland/cornflower/mf__cornflower__v000');                 // BLEND 40
pair('medium_flora/grassland/fence_post/mo__fence_post__v000');                 // DIRECT (whole object)
pair('medium_flora/grassland/daisy_cluster/mf__daisy_cluster__v000');           // UPSCALE keep
pair('medium_flora/grassland/daisy_cluster/mf__daisy_cluster__v007');           // override -> DIRECT (quarantine)
base('medium_flora/grassland/daisy_cluster/mf__daisy_cluster__v001');           // UPSCALE, NO @384 -> prints command
// small_flora (a 2nd field, just to prove per-field emission + upscaleUrl across fields)
pair('small_flora/grassland/wild_herb/sf__wild_herb__v000');

const decisions = { field: 'medium_flora', decisions: {
  'grassland/cornflower':    { mode: 'blend', blendPct: 40 },
  'grassland/fence_post':    { mode: 'direct' },
  'grassland/daisy_cluster': { mode: 'upscale', overrides: { v007: { mode: 'direct' } } },
} };
const DECF = path.join(TMP, 'upscale-decisions.json');
fs.writeFileSync(DECF, JSON.stringify(decisions, null, 2));

const env = { ...process.env, FIELD_ASSET_ROOT: MICRO };
function run(script, args) {
  const r = spawnSync(node, [path.join(HERE, script), ...args], { encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`${script} exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout + r.stderr;
}
const readManifest = (field) => JSON.parse(fs.readFileSync(path.join(MICRO, field, '_upscaled.json'), 'utf8'));

// --- run apply-upscale-decisions, then regen all fields --------------------
console.log('\n# apply-upscale-decisions');
const applyOut = run('apply-upscale-decisions.mjs', ['--decisions', DECF]);
run('gen-upscale-manifest.mjs', []);     // refresh small_flora too (medium_flora already regen'd by apply)

// --- (b) modes --------------------------------------------------------------
console.log('\n# (b) three modes');
// upscale: command printed, kept @384
assert.match(applyOut, /python comfy-batch\.py --field medium_flora --biome grassland --type daisy_cluster/, 'upscale must print the comfy-batch command');
ok('upscale prints `python comfy-batch.py --field medium_flora --biome grassland --type daisy_cluster`');
assert.ok(fs.existsSync(path.join(MICRO, 'medium_flora/grassland/daisy_cluster/mf__daisy_cluster__v000@384.png')), 'upscale keeps @384');
ok('upscale keeps daisy_cluster v000 @384 on disk');
// blend: apply-mix ran -> a premix backup exists for cornflower
const premixBak = path.join(MICRO, '_premix/medium_flora/grassland/cornflower/mf__cornflower__v000@384.png');
assert.ok(fs.existsSync(premixBak), 'blend must invoke apply-mix (premix backup proves it ran)');
ok('blend invoked apply-mix (premix backup present for cornflower)');
assert.ok(fs.existsSync(path.join(MICRO, 'medium_flora/grassland/cornflower/mf__cornflower__v000@384.png')), 'blend leaves an @384 in place');
ok('blend left a mixed @384 in place for cornflower');
// direct: @384 quarantined (moved, not deleted), gone from corpus
assert.ok(!fs.existsSync(path.join(MICRO, 'medium_flora/grassland/fence_post/mo__fence_post__v000@384.png')), 'direct removes @384 from corpus');
assert.ok(fs.existsSync(path.join(MICRO, '_premix/_direct_quarantine/medium_flora/grassland/fence_post/mo__fence_post__v000@384.png')), 'direct @384 must be quarantined, not deleted');
ok('direct moved fence_post @384 to _direct_quarantine (not deleted)');
assert.ok(fs.existsSync(path.join(MICRO, '_premix/_direct_quarantine/medium_flora/grassland/daisy_cluster/mf__daisy_cluster__v007@384.png')), 'per-variant override (v007->direct) must quarantine just that variant');
assert.ok(!fs.existsSync(path.join(MICRO, 'medium_flora/grassland/daisy_cluster/mf__daisy_cluster__v007@384.png')), 'v007 @384 removed from corpus');
ok('per-variant override v007->direct quarantined just that variant (object stayed upscale)');

// --- (a) per-field manifests ------------------------------------------------
console.log('\n# (a) per-field manifests');
const mfRaw = fs.readFileSync(path.join(MICRO, 'medium_flora/_upscaled.json'), 'utf8');
const mf = JSON.parse(mfRaw);
assert.deepEqual(mf, [
  'grassland/cornflower/mf__cornflower__v000',
  'grassland/daisy_cluster/mf__daisy_cluster__v000',
], 'medium_flora manifest keys');
assert.equal(mfRaw, JSON.stringify(mf), 'manifest must be compact + already sorted');
ok('medium_flora/_upscaled.json = [cornflower v000, daisy_cluster v000] (fence_post + v007 excluded)');
assert.deepEqual(readManifest('small_flora'), ['grassland/wild_herb/sf__wild_herb__v000']);
ok('small_flora/_upscaled.json = [wild_herb v000] (separate per-field file emitted)');

// --- (c) upscaleUrl seam ----------------------------------------------------
console.log('\n# (c) upscaleUrl seam (per field, F6 unchanged)');
__setUpscaleManifest('medium_flora', mf);
__setUpscaleManifest('small_flora', readManifest('small_flora'));
__setUpscaleManifest('large_flora', ['dense_forest/ancient_oak/v000']); // F6 fixture set
const U = '/assets/pixelab/landscape_v2/micro/';
const swap = (u) => upscaleUrl(u);
assert.equal(swap(U + 'medium_flora/grassland/cornflower/mf__cornflower__v000.png'), U + 'medium_flora/grassland/cornflower/mf__cornflower__v000@384.png');
ok('medium_flora listed key -> @384');
assert.equal(swap(U + 'medium_flora/grassland/fence_post/mo__fence_post__v000.png'), U + 'medium_flora/grassland/fence_post/mo__fence_post__v000.png');
ok('medium_flora direct/unlisted key -> unchanged (original)');
assert.equal(swap(U + 'small_flora/grassland/wild_herb/sf__wild_herb__v000.png'), U + 'small_flora/grassland/wild_herb/sf__wild_herb__v000@384.png');
ok('small_flora listed key -> @384 (second field wired)');
assert.equal(swap(U + 'large_flora/dense_forest/ancient_oak/v000.png'), U + 'large_flora/dense_forest/ancient_oak/v000@384.png');
ok('large_flora (F6) listed key -> @384 (path unchanged)');
assert.equal(swap(U + 'large_flora/dense_forest/ancient_oak/v999.png'), U + 'large_flora/dense_forest/ancient_oak/v999.png');
ok('large_flora unlisted key -> unchanged');
assert.equal(swap('/some/other/path/x.png'), '/some/other/path/x.png');
ok('non-micro path -> unchanged');

// --- (byte) large_flora byte-identity vs the original F6-only algorithm ------
console.log('\n# (byte) large_flora manifest byte-identical to the original algorithm');
const REAL_LF = path.join(REPO, 'assets/pixelab/landscape_v2/micro/large_flora');
if (fs.existsSync(REAL_LF)) {
  // the ORIGINAL generator's exact logic, inline, against the real corpus
  function oldGen(dir) {
    const keys = [];
    (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { w(p); continue; } if (!e.name.endsWith('@384.png')) continue; const rel = path.relative(dir, p).split(path.sep).join('/'); keys.push(rel.slice(0, -('@384.png'.length))); } })(dir);
    keys.sort(); return JSON.stringify(keys);
  }
  const expected = oldGen(REAL_LF);
  const outFile = path.join(REAL_LF, '_upscaled.json');
  const snapshot = fs.existsSync(outFile) ? fs.readFileSync(outFile) : null;
  try {
    spawnSync(node, [path.join(HERE, 'gen-upscale-manifest.mjs'), '--field', 'large_flora'], { encoding: 'utf8', env: process.env }); // REAL corpus (no FIELD_ASSET_ROOT)
    const produced = fs.readFileSync(outFile, 'utf8');
    assert.equal(produced, expected, 'new generator must match the original F6-only output byte-for-byte');
    ok(`large_flora manifest byte-identical (${expected.length} bytes, ${JSON.parse(expected).length} keys)`);
  } finally {
    if (snapshot != null) fs.writeFileSync(outFile, snapshot); // restore exact prior bytes (no net change)
  }
} else {
  console.log('  --  real large_flora corpus absent; byte-identity check skipped');
}

// --- cleanup ----------------------------------------------------------------
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nALL ${pass} ASSERTIONS PASSED`);
