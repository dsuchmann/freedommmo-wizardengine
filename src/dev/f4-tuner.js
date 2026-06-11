// Dev panel: live per-biome size tuning for Field 4 medium flora.
// Toggle with the '4' key. Slider changes apply instantly (descriptor +
// claim caches cleared per change). Values persist in localStorage and can
// be exported as JSON to bake into F4_BIOME_SCALE defaults.
import { F4_BIOME_SCALE, setF4BiomeScale, clearClaimCaches } from '../world/decoration-claims.js';
import { clearF2TileDescriptors } from '../render/field2-animator.js';

const LS_KEY = 'f4BiomeScale';

// Teleport spots with F4 flora (player lands mid-biome; reload preserves tuning)
const BIOME_SPOTS = {
  grassland: { x: 1312, y: 1312 }, steppe: { x: -1248, y: -992 },
  beach: { x: -1248, y: -224 }, hills: { x: 1824, y: -992 },
  forest: { x: -480, y: 2080 }, swamp: { x: -1504, y: 2336 },
  savanna: { x: 2848, y: -2784 }, tropical_forest: { x: 2848, y: 288 },
  taiga: { x: -4064, y: 3360 }, arctic: { x: -4576, y: 4640 },
  dense_forest: { x: -1760, y: 4640 }, mountains: { x: 5152, y: -5088 },
  tundra: { x: -5088, y: 3104 }, desert: { x: 6688, y: -736 },
  volcanic: { x: 7712, y: -224 }, mystic: { x: -8672, y: 6688 },
};

function applyAll(values) {
  for (const b in values) setF4BiomeScale(b, values[b]);
  clearClaimCaches();
  clearF2TileDescriptors();
}

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(F4_BIOME_SCALE)); } catch (e) { /* private mode */ }
}

export function initF4Tuner() {
  // Restore persisted tuning before first frame
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { saved = null; }
  if (saved) applyAll(saved);

  let panel = null;

  function buildPanel() {
    panel = document.createElement('div');
    panel.style.cssText =
      'position:fixed;top:48px;right:8px;z-index:9999;background:rgba(10,14,24,0.92);' +
      'color:#cfe0ff;font:12px monospace;padding:10px 12px;border:1px solid #3a4a6a;' +
      'border-radius:6px;max-height:84vh;overflow-y:auto;width:300px';

    const title = document.createElement('div');
    title.textContent = 'F4 medium flora size  (toggle: 4)';
    title.style.cssText = 'font-weight:bold;margin-bottom:8px;color:#ffd97a';
    panel.appendChild(title);

    // Master slider scales every biome to the same value
    const rows = {}; // biome -> { slider, label }
    panel.appendChild(makeRow('ALL biomes', 0.65, v => {
      for (const b in F4_BIOME_SCALE) {
        setF4BiomeScale(b, v);
        if (rows[b]) { rows[b].slider.value = v; rows[b].label.textContent = v.toFixed(2); }
      }
      clearF2TileDescriptors();
      save();
    }, '#ffd97a'));

    const hr = document.createElement('div');
    hr.style.cssText = 'border-top:1px solid #3a4a6a;margin:8px 0';
    panel.appendChild(hr);

    for (const biome of Object.keys(F4_BIOME_SCALE).sort()) {
      const row = makeRow(biome, F4_BIOME_SCALE[biome], v => {
        setF4BiomeScale(biome, v);
        clearF2TileDescriptors();
        save();
      }, '#cfe0ff', BIOME_SPOTS[biome]);
      rows[biome] = row._refs;
      panel.appendChild(row);
    }

    // Export current values
    const btn = document.createElement('button');
    btn.textContent = 'copy JSON';
    btn.style.cssText = 'margin-top:8px;font:12px monospace;cursor:pointer';
    btn.onclick = () => {
      const json = JSON.stringify(F4_BIOME_SCALE, null, 2);
      console.log('[F4 tuner]', json);
      navigator.clipboard && navigator.clipboard.writeText(json);
      btn.textContent = 'copied! (also in console)';
      setTimeout(() => { btn.textContent = 'copy JSON'; }, 1500);
    };
    panel.appendChild(btn);

    document.body.appendChild(panel);
  }

  function makeRow(name, value, onInput, color, spot) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:2px 0';

    const lbl = document.createElement('span');
    lbl.style.cssText = 'width:108px;overflow:hidden;white-space:nowrap;color:' + color +
      (spot ? ';cursor:pointer;text-decoration:underline dotted' : '');
    lbl.textContent = name;
    if (spot) {
      lbl.title = 'teleport to ' + name;
      lbl.onclick = () => { location.href = '/?x=' + spot.x + '&y=' + spot.y; };
    }
    row.appendChild(lbl);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0.25'; slider.max = '1.50'; slider.step = '0.05';
    slider.value = value;
    slider.style.cssText = 'flex:1';
    row.appendChild(slider);

    const val = document.createElement('span');
    val.style.cssText = 'width:34px;text-align:right';
    val.textContent = Number(value).toFixed(2);
    row.appendChild(val);

    slider.oninput = () => {
      const v = parseFloat(slider.value);
      val.textContent = v.toFixed(2);
      onInput(v);
    };
    row._refs = { slider: slider, label: val };
    return row;
  }

  window.addEventListener('keydown', e => {
    if (e.key !== '4' || e.target instanceof HTMLInputElement) return;
    if (!panel) { buildPanel(); return; }
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
  });
}
