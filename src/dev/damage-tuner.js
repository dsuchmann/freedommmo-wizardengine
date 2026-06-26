// src/dev/damage-tuner.js — in-game tuning panel for the D1 DAMAGE dressing field.
// Lives as the "Damage" tab of the Dev HUD (press ` , then pick the tab). Mutates window._damage LIVE —
// the building layer re-renders the damage into the silhouette bitmap every frame, so edits take effect
// next frame with no cache to clear. Persists in localStorage ('damageTuning'); "copy config" exports a
// literal for baking into src/render/dressing/d1-damage.js DEFAULTS.
//
// The `age` slider is special: D1's age driver is HONESTLY ABSENT (no sim source), so age defaults to
// null and the age-driven layers (cracks, dry-rot) render nothing in the world. Tick "preview age" to
// inject a synthetic age 0..1 and SEE those layers — it's a preview, not a faked world driver.
import { DAMAGE, DAMAGE_DEFAULTS } from '../render/dressing/d1-damage.js';
import { registerDevTool, openTab } from './dev-hud.js';

const LS_KEY = 'damageTuning';

// Bool/range knobs (age handled by its own preview row; see below).
const KNOBS = [
  { key: 'enabled',   kind: 'bool',  desc: 'master on/off' },
  { key: 'strength',  kind: 'range', range: [0, 3, 0.05],   desc: 'decay intensity multiplier' },
  { key: 'disrepair', kind: 'range', range: [0, 1.5, 0.05], desc: 'per-building wear prevalence (0=wetness-only)' },
  { key: 'cracks',    kind: 'bool',  desc: 'hairline / structural cracks (disrepair-driven)' },
  { key: 'flaking',   kind: 'bool',  desc: 'paint / render flaking (disrepair + freeze-thaw)' },
  { key: 'rot',       kind: 'bool',  desc: 'wet rot, bottom-weighted (wetness/disrepair)' },
  { key: 'runnels',   kind: 'bool',  desc: 'eroded drip runnels, top-weighted (wetness)' },
  { key: 'rust',      kind: 'bool',  desc: 'iron rust streaks (wetness/disrepair)' },
];
// Full key list for copy-config (matches the DEFAULTS literal, age + disrepair included).
const CONFIG_KEYS = ['enabled', 'strength', 'disrepair', 'age', 'cracks', 'flaking', 'rot', 'runnels', 'rust'];

const inputs = {}; // key -> { set(v) }

function el(tag, css, text) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text != null) e.textContent = text;
  return e;
}

function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(DAMAGE)); } catch (e) { /* private mode */ } }
function set(key, v) { DAMAGE[key] = v; save(); }

function rangeRow(knob) {
  const [min, max, step] = knob.range;
  const row = el('div', 'display:flex;align-items:center;gap:6px;margin:2px 0');
  row.appendChild(el('span', 'width:78px;color:#cfe0ff', knob.key));
  const s = el('input', 'flex:1;min-width:80px');
  s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = DAMAGE[knob.key];
  const out = el('span', 'width:40px;text-align:right;color:#9fb6dd');
  out.textContent = Number(DAMAGE[knob.key]).toFixed(2);
  s.oninput = () => { const v = parseFloat(s.value); set(knob.key, v); out.textContent = v.toFixed(2); };
  row.appendChild(s); row.appendChild(out);
  inputs[knob.key] = { set: (v) => { s.value = v; out.textContent = Number(v).toFixed(2); } };
  return row;
}

function boolRow(knob) {
  const row = el('div', 'display:flex;align-items:center;gap:6px;margin:2px 0');
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!DAMAGE[knob.key];
  cb.onchange = () => set(knob.key, cb.checked);
  row.appendChild(cb);
  row.appendChild(el('span', 'color:#cfe0ff', knob.key));
  row.appendChild(el('span', 'color:#5e729a;font-size:10px', knob.desc));
  inputs[knob.key] = { set: (v) => { cb.checked = !!v; } };
  return row;
}

// age preview: checkbox (active?) + slider. Unchecked → age=null (honest absence). Checked → age=value.
function ageRow() {
  const row = el('div', 'display:flex;align-items:center;gap:6px;margin:6px 0 2px;border-top:1px solid #243250;padding-top:6px');
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = DAMAGE.age != null;
  const s = el('input', 'flex:1;min-width:70px'); s.type = 'range'; s.min = 0; s.max = 1; s.step = 0.01;
  s.value = DAMAGE.age != null ? DAMAGE.age : 0.6;
  const out = el('span', 'width:54px;text-align:right;color:#9fb6dd');
  const render = () => { out.textContent = cb.checked ? Number(s.value).toFixed(2) : 'absent'; s.disabled = !cb.checked; };
  const apply = () => { set('age', cb.checked ? parseFloat(s.value) : null); render(); };
  cb.onchange = apply; s.oninput = apply; render();
  row.appendChild(cb);
  row.appendChild(el('span', 'width:64px;color:#cfe0ff', 'age (preview)'));
  row.appendChild(s); row.appendChild(out);
  inputs.age = { set: (v) => { cb.checked = v != null; if (v != null) s.value = v; render(); } };
  return row;
}

function syncInputs() {
  for (const k of CONFIG_KEYS) if (inputs[k]) inputs[k].set(DAMAGE[k]);
}

function copyConfig() {
  const q = (v) => v === null ? 'null' : (typeof v === 'string' ? `'${v}'` : v);
  const lines = CONFIG_KEYS.map((k) => `  ${k}: ${q(DAMAGE[k])},`);
  const text = 'const DEFAULTS = {\n' + lines.join('\n') + '\n};';
  console.log('[damage tuner]\n' + text);
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  return text;
}

function mountDamageTuner(container) {
  container.appendChild(el('div', 'color:#5e729a;font-size:10px;margin-bottom:4px',
    'wetness from biome (wet→rot/runnels, cold→freeze-thaw). disrepair = per-building wear baseline (~1 in 4). age slider previews uniform aging.'));
  for (const k of KNOBS) {
    if (k.kind === 'bool') container.appendChild(boolRow(k));
    else container.appendChild(rangeRow(k));
    if (k.key === 'disrepair') container.appendChild(ageRow()); // age preview right after the disrepair knob
  }

  // freeze-noon helper — honest A/B needs day/night frozen (same as the weathering tuner).
  const fz = el('div', 'display:flex;align-items:center;gap:6px;margin:6px 0 2px;border-top:1px solid #243250;padding-top:6px');
  const fzcb = el('input'); fzcb.type = 'checkbox';
  fzcb.checked = !!(window._lighting && window._lighting.paused);
  fzcb.onchange = () => { const L = window._lighting; if (!L) return; L.paused = fzcb.checked; if (fzcb.checked) L.time = 0.5; };
  fz.appendChild(fzcb);
  fz.appendChild(el('span', 'color:#9fb6dd', 'freeze day @ noon (A/B)'));
  container.appendChild(fz);

  const foot = el('div', 'display:flex;gap:6px;margin-top:8px;border-top:1px solid #3a4a6a;padding-top:6px');
  const copy = el('button', 'font:11px monospace;cursor:pointer;flex:1', 'copy config');
  copy.onclick = () => { copyConfig(); copy.textContent = 'copied!'; setTimeout(() => { copy.textContent = 'copy config'; }, 1500); };
  const reset = el('button', 'font:11px monospace;cursor:pointer;flex:1', 'reset');
  reset.onclick = () => { Object.assign(DAMAGE, DAMAGE_DEFAULTS); save(); syncInputs(); };
  foot.appendChild(copy); foot.appendChild(reset);
  container.appendChild(foot);

  syncInputs();
}

export function initDamageTuner() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved && typeof saved === 'object') for (const k in DAMAGE_DEFAULTS) if (saved[k] !== undefined) DAMAGE[k] = saved[k];
  } catch (e) { /* corrupt -> defaults */ }

  window._damageTuner = {
    toggle: () => openTab('damage'),
    copy: copyConfig,
    reset: () => { Object.assign(DAMAGE, DAMAGE_DEFAULTS); save(); syncInputs(); },
  };
  registerDevTool({ id: 'damage', label: 'Damage', order: 11, mount: mountDamageTuner });
}
