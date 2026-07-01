// scripts/d3-download.mjs — download D3 prop candidate frames straight from the review-pack CDN (no API).
// Reads scripts/_d3_jobs.json (biome -> prop -> {group, px}); for each prop curls a 4-variant spread of
// candidate frames into assets/pixelab/buildings/dressing/<biome>/<prop>/base__vN.png, validates the PNG
// signature (skips still-processing 404s / error bodies), and records the group id in that biome's
// _pixellab_ids.json. Idempotent: re-run as more jobs finish; already-downloaded variants are kept.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = 'assets/pixelab/buildings/dressing';
const BUCKET = 'https://backblaze.pixellab.ai/file/pixellab-characters/objects/0f1031f5-9eee-4df4-996f-0a4114148eba';
const JOBS_PATH = process.argv[2] || 'scripts/_d3_jobs.json'; // field-agnostic: pass scripts/_d1_jobs.json for D1 chips
const jobs = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf8'));
const SPREAD = { 64: [0, 4, 8, 12], 96: [0, 1, 2, 3], 128: [0, 1, 2, 3] };

function curlPng(url, out) {
  try { execSync(`curl -sL "${url}" -o "${out}"`, { stdio: 'ignore' }); } catch { return false; }
  try {
    const fd = fs.openSync(out, 'r'); const b = Buffer.alloc(8); fs.readSync(fd, b, 0, 8, 0); fs.closeSync(fd);
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // \x89PNG
  } catch {}
  try { fs.unlinkSync(out); } catch {}
  return false;
}

let totalProps = 0, doneProps = 0, totalVariants = 0;
for (const [biome, props] of Object.entries(jobs)) {
  if (biome.startsWith('_')) continue;
  const idsPath = `${ROOT}/${biome}/_pixellab_ids.json`;
  let ids = {}; try { ids = JSON.parse(fs.readFileSync(idsPath, 'utf8')); } catch {}
  if (!ids._field) ids = { _field: 'D3', _note: 'D3 props per biome (disk authoritative). group = create_1_direction_object review-pack id; base__vN.png = promoted candidate frames.', ...ids };
  for (const [prop, info] of Object.entries(props)) {
    totalProps++;
    const dir = `${ROOT}/${biome}/${prop}`; fs.mkdirSync(dir, { recursive: true });
    const spread = SPREAD[info.px] || [0, 1, 2, 3];
    let got = 0;
    for (let vi = 0; vi < spread.length; vi++) {
      const out = `${dir}/base__v${vi}.png`;
      if (fs.existsSync(out) && fs.statSync(out).size > 0) { got++; continue; }
      if (curlPng(`${BUCKET}/${info.group}/rotations/frame_${spread[vi]}.png`, out)) got++;
    }
    if (got > 0) { doneProps++; totalVariants += got; ids[prop] = { base: info.group, px: info.px, variants: got, states: {}, anims: {} }; }
  }
  fs.writeFileSync(idsPath, JSON.stringify(ids, null, 1));
}
console.log(`props with art: ${doneProps}/${totalProps} | variants on disk: ${totalVariants}`);
for (const [biome, props] of Object.entries(jobs)) {
  if (biome.startsWith('_')) continue;
  const have = Object.keys(props).filter(p => fs.existsSync(`${ROOT}/${biome}/${p}/base__v0.png`)).length;
  console.log(`  ${biome}: ${have}/${Object.keys(props).length} props downloaded`);
}
