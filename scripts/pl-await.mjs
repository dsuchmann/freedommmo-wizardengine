// scripts/pl-await.mjs <objectId> <out.png> [--project <uuid>] [--timeout <sec>] [--no-solidify]
//                                          [--anim <animId> --frames <N> --animdir <dir>] [--max-holes <pct>]
// Deterministic "await + capture + gate" for a fired PixelLab object, so the pipeline never needs a manual poll
// loop. Polls the asset's CDN URL until it materialises (jobs are SLOW on the credit-fallback queue), downloads,
// runs de-magenta (strips stray magenta key-pixels) then solidify (force opacity), and prints the hole%.
//   OBJECT mode (default): rotation tile → de-magenta → solidify → <out.png>; prints "READY <out> <holes>% holes".
//     exit 2 + "HIGH_HOLES" if holes > --max-holes (default 25) → caller should RE-ROLL (bad random alpha-matte roll).
//   ANIM mode (--anim): downloads frames 0..N-1 → de-magenta each → <animdir>/frame_NNN.png (caller runs
//     normalize-anim-frames + fit-anim-frames + freeze-anim-band). prints "READY anim <N> frames".
//   exit 1 + "TIMEOUT" if the job never appears within --timeout (default 900s).
import { loadImage } from '@napi-rs/canvas';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const a = process.argv.slice(2);
const pos = a.filter((x) => !x.startsWith('--'));
const flag = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? (a[i + 1] && !a[i + 1].startsWith('--') ? a[i + 1] : true) : d; };
const objectId = pos[0], out = pos[1];
if (!objectId || (!out && !flag('animdir'))) { console.error('usage: pl-await.mjs <objectId> <out.png> [--anim <id> --frames N --animdir <dir>] [--max-holes 25]'); process.exit(3); }
const PROJ = flag('project', '0f1031f5-9eee-4df4-996f-0a4114148eba');
const timeout = +(flag('timeout', 900)) * 1000;
const maxHoles = +(flag('max-holes', 25));
const noSolid = flag('no-solidify', false);
const BASE = `https://backblaze.pixellab.ai/file/pixellab-characters/objects/${PROJ}/${objectId}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dl(url, to) {
  try { const r = await fetch(url); if (!r.ok) return false; const b = Buffer.from(await r.arrayBuffer()); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, b); await loadImage(to); return true; } catch { return false; }
}
async function pollDl(url, to) { const dl0 = Date.now() + timeout; while (Date.now() < dl0) { if (await dl(url, to)) return true; await sleep(10000); } return false; }

const animId = flag('anim', null);
if (animId) {
  const animdir = flag('animdir', out && path.dirname(out));
  const N = +(flag('frames', 9));
  const aurl = (i) => `${BASE}/animations/${animId}/unknown/${i}.png`;
  if (!await pollDl(aurl(0), `${animdir}/frame_000.png`)) { console.log('TIMEOUT'); process.exit(1); }
  for (let i = 1; i < N; i++) { const f = `${animdir}/frame_${String(i).padStart(3, '0')}.png`; if (!await dl(aurl(i), f)) { console.log('TIMEOUT frame ' + i); process.exit(1); } }
  for (let i = 0; i < N; i++) { const f = `${animdir}/frame_${String(i).padStart(3, '0')}.png`; execSync(`node scripts/de-magenta.mjs "${f}" "${f}"`); }
  console.log(`READY anim ${N} frames -> ${animdir}`);
  process.exit(0);
}

const tmp = out + '.raw.png';
if (!await pollDl(`${BASE}/rotations/unknown.png`, tmp)) { console.log('TIMEOUT'); process.exit(1); }
execSync(`node scripts/de-magenta.mjs "${tmp}" "${tmp}"`);
if (noSolid) { fs.copyFileSync(tmp, out); fs.rmSync(tmp); console.log(`READY ${out}`); process.exit(0); }
const so = execSync(`node scripts/solidify.mjs "${tmp}" "${out}"`).toString();
fs.rmSync(tmp, { force: true });
const m = so.match(/(\d+)% holes/); const holes = m ? +m[1] : 0;
console.log(`READY ${out} ${holes}% holes`);
if (holes > maxHoles) { console.log(`HIGH_HOLES (${holes}% > ${maxHoles}%) — RE-ROLL`); process.exit(2); }
process.exit(0);
