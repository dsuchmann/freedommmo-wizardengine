// scripts/dl-states.mjs — download completed grassland state variants (raw) + montage for inspection.
// Reads _corpus.json states_v0, fetches each rotation PNG (skips still-processing), writes raw to
// <root>/_states_raw/<mat>__<state>.png, and builds a labelled montage -> tools/_states_montage.png
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
const ROOT = 'assets/pixelab/buildings/tiles/grassland';
const RAW = ROOT + '/_states_raw';
fs.mkdirSync(RAW, { recursive: true });
const corpus = JSON.parse(fs.readFileSync(ROOT + '/_corpus.json', 'utf8'));
const OBASE = 'https://backblaze.pixellab.ai/file/pixellab-characters/objects/0f1031f5-9eee-4df4-996f-0a4114148eba';
const STATES = corpus.states_v0._states;
const MATS = ['fieldstone', 'cob', 'timber_frame', 'wattle_daub'];

async function fetchPng(id) {
  try { const r = await fetch(`${OBASE}/${id}/rotations/unknown.png`); if (!r.ok) return null; const b = Buffer.from(await r.arrayBuffer()); return b.length > 2000 ? b : null; } catch { return null; }
}

const have = {};
let done = 0, pend = 0;
for (const mat of MATS) {
  for (const st of STATES) {
    const id = corpus.states_v0[mat] && corpus.states_v0[mat][st];
    if (!id) { pend++; continue; }
    const f = `${RAW}/${mat}__${st}.png`;
    if (fs.existsSync(f)) { have[`${mat}__${st}`] = f; done++; continue; }
    const buf = await fetchPng(id);
    if (buf) { fs.writeFileSync(f, buf); have[`${mat}__${st}`] = f; done++; console.log('dl ' + mat + ' ' + st); }
    else { pend++; }
  }
}
console.log(`\ndownloaded/cached: ${done}   pending: ${pend}`);

// montage: rows = materials, cols = states
const C = 150, pad = 4, labelH = 22;
const cv = createCanvas(C * STATES.length + 120, (C + labelH) * MATS.length + 24);
const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
c.fillStyle = '#333'; c.fillRect(0, 0, cv.width, cv.height);
c.fillStyle = '#fff'; c.font = '13px sans-serif';
for (let s = 0; s < STATES.length; s++) c.fillText(STATES[s], 120 + s * C + 4, 16);
for (let m = 0; m < MATS.length; m++) {
  const oy = 24 + m * (C + labelH);
  c.fillStyle = '#fff'; c.fillText(MATS[m], 6, oy + C / 2);
  for (let s = 0; s < STATES.length; s++) {
    const key = `${MATS[m]}__${STATES[s]}`, ox = 120 + s * C;
    c.fillStyle = '#3f7a34'; c.fillRect(ox, oy, C - pad, C);   // grass bg
    if (have[key]) { try { const img = await loadImage(have[key]); const sc = Math.min((C - pad) / img.width, C / img.height); c.drawImage(img, 0, 0, img.width, img.height, ox, oy, img.width * sc, img.height * sc); } catch {} }
    else { c.fillStyle = '#222'; c.fillRect(ox, oy, C - pad, C); c.fillStyle = '#888'; c.fillText('…', ox + C / 2, oy + C / 2); }
  }
}
fs.writeFileSync('tools/_states_montage.png', cv.toBuffer('image/png'));
console.log('wrote tools/_states_montage.png');
