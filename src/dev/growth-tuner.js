// src/dev/growth-tuner.js — in-game tuning panel for the D2 SURFACE-GROWTH dressing field (moss + lichen).
// Dev HUD "Growth" tab (press ` , pick the tab). Mutates window._growth LIVE — the building layer re-renders
// each frame, so edits take effect next frame. Persists in localStorage; "copy config" exports a DEFAULTS
// literal for baking into src/render/dressing/d2-growth.js.
import { GROWTH, GROWTH_DEFAULTS } from '../render/dressing/d2-growth.js';
import { registerDevTool, openTab } from './dev-hud.js';

const LS_KEY = 'growthTuning';
const KNOBS = [
  { key: 'enabled',     kind: 'bool',  desc: 'master on/off' },
  { key: 'strength',    kind: 'range', range: [0, 3, 0.05], desc: 'coverage intensity multiplier' },
  { key: 'lichen',      kind: 'bool',  desc: 'lichen crust (stone-host, dry-tolerant)' },
  { key: 'moss',        kind: 'bool',  desc: 'moss (wetness-driven, bottom-weighted)' },
  { key: 'lichenColor', kind: 'color', desc: 'lichen tint (soft-light)' },
  { key: 'mossColor',   kind: 'color', desc: 'moss tint (soft-light)' },
];
const inputs = {};

function el(tag, css, text) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(GROWTH)); } catch (e) { /* private mode */ } }
function set(key, v) { GROWTH[key] = v; save(); }

function rangeRow(k) {
  const [min, max, step] = k.range;
  const row = el('div', 'display:flex;align-items:center;gap:6px;margin:2px 0');
  row.appendChild(el('span', 'width:80px;color:#cfe0ff', k.key));
  const s = el('input', 'flex:1;min-width:80px'); s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = GROWTH[k.key];
  const out = el('span', 'width:40px;text-align:right;color:#9fb6dd'); out.textContent = Number(GROWTH[k.key]).toFixed(2);
  s.oninput = () => { const v = parseFloat(s.value); set(k.key, v); out.textContent = v.toFixed(2); };
  row.appendChild(s); row.appendChild(out);
  inputs[k.key] = { set: (v) => { s.value = v; out.textContent = Number(v).toFixed(2); } };
  return row;
}
function boolRow(k) {
  const row = el('div', 'display:flex;align-items:center;gap:6px;margin:2px 0');
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!GROWTH[k.key]; cb.onchange = () => set(k.key, cb.checked);
  row.appendChild(cb); row.appendChild(el('span', 'color:#cfe0ff', k.key)); row.appendChild(el('span', 'color:#5e729a;font-size:10px', k.desc));
  inputs[k.key] = { set: (v) => { cb.checked = !!v; } };
  return row;
}
function colorRow(k) {
  const row = el('div', 'display:flex;align-items:center;gap:6px;margin:2px 0');
  row.appendChild(el('span', 'width:80px;color:#cfe0ff', k.key));
  const c = el('input', 'width:48px;height:20px;background:none;border:1px solid #3a4a6a'); c.type = 'color'; c.value = GROWTH[k.key];
  c.oninput = () => set(k.key, c.value);
  row.appendChild(c); row.appendChild(el('span', 'color:#5e729a;font-size:10px', k.desc));
  inputs[k.key] = { set: (v) => { c.value = v; } };
  return row;
}
function syncInputs() { for (const k of KNOBS) if (inputs[k.key]) inputs[k.key].set(GROWTH[k.key]); }
function copyConfig() {
  const q = (v) => typeof v === 'string' ? `'${v}'` : v;
  const text = 'const DEFAULTS = {\n' + KNOBS.map((k) => `  ${k.key}: ${q(GROWTH[k.key])},`).join('\n') + '\n};';
  console.log('[growth tuner]\n' + text);
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  return text;
}

function mountGrowthTuner(container) {
  container.appendChild(el('div', 'color:#5e729a;font-size:10px;margin-bottom:4px',
    'lichen crust on stone walls; moss from wetness (biome + water-proximity), lush in wet biomes, bottom-weighted.'));
  for (const k of KNOBS) {
    if (k.kind === 'bool') container.appendChild(boolRow(k));
    else if (k.kind === 'color') container.appendChild(colorRow(k));
    else container.appendChild(rangeRow(k));
  }
  const fz = el('div', 'display:flex;align-items:center;gap:6px;margin:6px 0 2px;border-top:1px solid #243250;padding-top:6px');
  const fzcb = el('input'); fzcb.type = 'checkbox'; fzcb.checked = !!(window._lighting && window._lighting.paused);
  fzcb.onchange = () => { const L = window._lighting; if (!L) return; L.paused = fzcb.checked; if (fzcb.checked) L.time = 0.5; };
  fz.appendChild(fzcb); fz.appendChild(el('span', 'color:#9fb6dd', 'freeze day @ noon (A/B)'));
  container.appendChild(fz);
  const foot = el('div', 'display:flex;gap:6px;margin-top:8px;border-top:1px solid #3a4a6a;padding-top:6px');
  const copy = el('button', 'font:11px monospace;cursor:pointer;flex:1', 'copy config');
  copy.onclick = () => { copyConfig(); copy.textContent = 'copied!'; setTimeout(() => { copy.textContent = 'copy config'; }, 1500); };
  const reset = el('button', 'font:11px monospace;cursor:pointer;flex:1', 'reset');
  reset.onclick = () => { Object.assign(GROWTH, GROWTH_DEFAULTS); save(); syncInputs(); };
  foot.appendChild(copy); foot.appendChild(reset); container.appendChild(foot);
  syncInputs();
}

export function initGrowthTuner() {
  try { const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (saved && typeof saved === 'object') for (const k in GROWTH_DEFAULTS) if (saved[k] !== undefined) GROWTH[k] = saved[k]; } catch (e) { /* defaults */ }
  window._growthTuner = { toggle: () => openTab('growth'), copy: copyConfig, reset: () => { Object.assign(GROWTH, GROWTH_DEFAULTS); save(); syncInputs(); } };
  registerDevTool({ id: 'growth', label: 'Growth', order: 12, mount: mountGrowthTuner });
}
