// Unified dev tuner for decoration fields. Field tabs come from
// src/dev/field-registry.js — adding a field there adds its tab here.
// Lives as the "Fields" tab of the Dev HUD (press ` , then pick the tab).
// Tree: field tabs -> current biome -> object rows.
// Clicking the expand arrow (▸) on an object opens a side panel to the left
// of the main panel showing that object's state-weight rows and variant rows.
// Size + density combine multiplicatively (see src/world/field-tuning.js).
// Edits persist in localStorage ('fieldTuning'); "copy JSON" exports the tree
// for baking into src/world/field-tuning-defaults.js (see re-bake instructions there).
// After baking, clear stale localStorage (DevTools → Application → Clear Site Data).
// "Reset all" returns to BAKED defaults (field-tuning-defaults.js), not empty tree.
import { setFieldTuning } from '../world/field-tuning.js';
import { clearClaimCaches } from '../world/decoration-claims.js';
import { clearF2TileDescriptors } from '../render/field2-animator.js';
import { FIELD_REGISTRY, regFor, emptyTree } from './field-registry.js';
import { registerDevTool, openTab } from './dev-hud.js';

var LS_KEY = 'fieldTuning';

// Teleport spots (same as the old F4 tuner)
var BIOME_SPOTS = {
  grassland: { x: 1312, y: 1312 }, steppe: { x: -1248, y: -992 },
  beach: { x: -1248, y: -224 }, hills: { x: 1824, y: -992 },
  forest: { x: -480, y: 2080 }, swamp: { x: -1504, y: 2336 },
  savanna: { x: 2848, y: -2784 }, tropical_forest: { x: 2848, y: 288 },
  taiga: { x: -4064, y: 3360 }, arctic: { x: -4576, y: 4640 },
  dense_forest: { x: -1760, y: 4640 }, mountains: { x: 5152, y: -5088 },
  tundra: { x: -5088, y: 3104 }, desert: { x: 6688, y: -736 },
  volcanic: { x: 7712, y: -224 }, mystic: { x: -8672, y: 6688 },
};

var TREE = emptyTree();
var activeField = 'f4';
var expandedKey = null;  // 'field/biome/obj' or null — one object expanded at a time
var checked = {};        // rowKey 'field/biome/obj' or 'field/biome/obj/v' -> true

// Worst-case apply target for global ops: any repaint-bitmaps field.
function repaintFieldId() {
  for (var i = 0; i < FIELD_REGISTRY.length; i++)
    if (FIELD_REGISTRY[i].applyKind === 'repaint-bitmaps') return FIELD_REGISTRY[i].id;
  return null;
}

// Get-or-create a tree node. Call with fewer args for shallower nodes.
function node(field, biome, obj, variant) {
  var f = TREE[field];
  if (biome == null) return f;
  f.biomes = f.biomes || {};
  var b = f.biomes[biome] = f.biomes[biome] || {};
  if (obj == null) return b;
  b.objects = b.objects || {};
  var o = b.objects[obj] = b.objects[obj] || {};
  if (variant == null) return o;
  o.variants = o.variants || {};
  return o.variants[variant] = o.variants[variant] || {};
}

// Read-only lookup — undefined when untouched.
function peek(field, biome, obj, variant) {
  var f = TREE[field];
  var b = f && f.biomes && f.biomes[biome];
  if (obj == null) return b;
  var o = b && b.objects && b.objects[obj];
  if (variant == null) return o;
  return o && o.variants && o.variants[variant];
}

function midSize(n) {
  if (!n) return 1;
  if (n.sizeMin != null && n.sizeMax != null) return (n.sizeMin + n.sizeMax) / 2;
  return n.size != null ? n.size : 1;
}

// Effective size (range-mids) for readouts: master x biome x object x variant.
function effSize(field, biome, obj, variant) {
  var f = TREE[field];
  return (f.size != null ? f.size : 1) * midSize(peek(field, biome)) *
    midSize(obj != null ? peek(field, biome, obj) : null) *
    midSize(variant != null ? peek(field, biome, obj, variant) : null);
}

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(TREE)); } catch (e) { /* private mode */ }
}

// Apply live: rebuild placement caches; repaint-bitmaps fields (F3) also
// resync workers + repaint chunk bitmaps (they're baked into them). Always
// pushes the tree to workers so they stay in sync for newly compiled chunks.
function apply(field) {
  setFieldTuning(TREE);
  save();
  clearClaimCaches();
  clearF2TileDescriptors();
  var prov = window._debugProvider;
  var repaint = regFor(field) && regFor(field).applyKind === 'repaint-bitmaps';
  if (prov && prov.applyFieldTuning) prov.applyFieldTuning(TREE, repaint);
}

// Debounce (sliders fire continuously). Coalesce by applyKind — if a
// repaint-bitmaps edit lands in the window, the final apply MUST run as that
// field (it's the only kind that purges chunk bitmaps).
var applyTimer = 0;
var applyRepaintPending = null;
function applySoon(field) {
  var reg = regFor(field);
  if (reg && reg.applyKind === 'repaint-bitmaps') applyRepaintPending = field;
  clearTimeout(applyTimer);
  applyTimer = setTimeout(function () {
    var f = applyRepaintPending || field;
    applyRepaintPending = null;
    apply(f);
  }, 200);
}

function currentBiome() {
  var p = window._player, cs = window._dbgChunkStore;
  if (!p || !cs) return null;
  var t = cs.tileAt(Math.floor(p.x), Math.floor(p.y));
  return t ? t.biome : null;
}

var panel = null, body = null;
var sidePanel = null, sideBody = null, sideTitle = null;

function el(tag, css, text) {
  var e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text != null) e.textContent = text;
  return e;
}

function slider(min, max, step, value, onInput) {
  var s = el('input', 'flex:1;min-width:60px');
  s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = value;
  s.oninput = function () { onInput(parseFloat(s.value)); };
  return s;
}

function numBox(value, onChange, width) {
  var n = el('input', 'width:' + (width || 44) + 'px;font:11px monospace;background:#16203a;color:#cfe0ff;border:1px solid #3a4a6a');
  n.type = 'number'; n.step = '0.05'; n.value = value;
  n.onchange = function () { var v = parseFloat(n.value); if (!isNaN(v)) onChange(v); };
  return n;
}

// One labeled slider+readout row for a tree node's size or density.
function tuneRow(label, color, key, getN, prop, min, max, field) {
  var row = el('div', 'display:flex;align-items:center;gap:4px;margin:1px 0');
  if (key != null) {
    var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!checked[key];
    cb.onchange = function () { checked[key] = cb.checked; };
    row.appendChild(cb);
  }
  row.appendChild(el('span', 'width:96px;overflow:hidden;white-space:nowrap;color:' + color, label));
  var n = getN();
  var cur = prop === 'size' ? midSize(n) : (n && n.density != null ? n.density : 1);
  var val = el('span', 'width:34px;text-align:right', cur.toFixed(2));
  row.appendChild(slider(min, max, 0.05, cur, function (v) {
    var t = getN();
    if (prop === 'size') { delete t.sizeMin; delete t.sizeMax; t.size = v; }
    else t.density = v;
    val.textContent = v.toFixed(2);
    applySoon(field);
  }));
  row.appendChild(val);
  return row;
}

// Variant row: min/max size range inputs + effective readout.
function variantRow(field, biome, objName, v) {
  var key = field + '/' + biome + '/' + objName + '/' + v;
  var row = el('div', 'display:flex;align-items:center;gap:4px;margin:1px 0');
  var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!checked[key];
  cb.onchange = function () { checked[key] = cb.checked; };
  row.appendChild(cb);
  row.appendChild(el('span', 'width:42px;color:#8fa3c8', 'v' + (v < 10 ? '00' + v : v < 100 ? '0' + v : v)));
  var n = peek(field, biome, objName, v) || {};
  var lo = n.sizeMin != null ? n.sizeMin : (n.size != null ? n.size : 1);
  var hi = n.sizeMax != null ? n.sizeMax : (n.size != null ? n.size : 1);
  var eff = el('span', 'width:78px;color:#7ea0d0');
  function setEff() { eff.textContent = 'eff ' + (effSize(field, biome, objName, v)).toFixed(2); }
  function setRange(a, b) {
    var t = node(field, biome, objName, v);
    delete t.size;
    t.sizeMin = Math.min(a, b); t.sizeMax = Math.max(a, b);
    setEff(); apply(field);
  }
  var loBox = numBox(lo, function (x) { lo = x; setRange(lo, hi); });
  var hiBox = numBox(hi, function (x) { hi = x; setRange(lo, hi); });
  row.appendChild(loBox); row.appendChild(el('span', '', '–')); row.appendChild(hiBox);
  setEff(); row.appendChild(eff);
  return row;
}

function buildSidePanel() {
  sidePanel = el('div',
    'position:fixed;top:48px;right:386px;z-index:9999;background:rgba(10,14,24,0.92);' +
    'color:#cfe0ff;font:12px monospace;padding:8px 10px;border:1px solid #3a4a6a;' +
    'border-radius:6px;max-height:calc(100vh - 64px);display:none;flex-direction:column;width:330px');
  var head = el('div', 'display:flex;align-items:center;margin-bottom:6px');
  sideTitle = el('span', 'color:#ffd97a;font-weight:bold;flex:1');
  var close = el('span', 'cursor:pointer;color:#7ea0d0;padding:0 4px', '✕');
  close.onclick = function () { expandedKey = null; rebuild(); };
  head.appendChild(sideTitle); head.appendChild(close);
  sidePanel.appendChild(head);
  sideBody = el('div', 'overflow-y:auto;flex:1;min-height:0');
  sidePanel.appendChild(sideBody);
  document.body.appendChild(sidePanel);
}

function rebuild() {
  if (!panel) return;
  body.textContent = '';
  var field = activeField;
  var biome = currentBiome();

  // --- header: biome name + teleport + master/biome rows ---
  var head = el('div', 'margin-bottom:6px');
  head.appendChild(el('div', 'color:#ffd97a;font-weight:bold', regFor(field).label + ' — biome: ' + (biome || '?')));
  var tp = el('select', 'font:11px monospace;background:#16203a;color:#cfe0ff;margin:3px 0;width:100%');
  tp.appendChild(el('option', '', 'teleport to biome…'));
  Object.keys(BIOME_SPOTS).sort().forEach(function (b) { tp.appendChild(el('option', '', b)).value = b; });
  tp.onchange = function () {
    var s = BIOME_SPOTS[tp.value];
    if (s) location.href = '/?x=' + s.x + '&y=' + s.y;
  };
  head.appendChild(tp);
  head.appendChild(tuneRow('MASTER size', '#ffd97a', null, function () { return node(field); }, 'size', 0.25, 2.0, field));
  head.appendChild(tuneRow('MASTER density', '#ffd97a', null, function () { return node(field); }, 'density', 0, 3.0, field));
  if (biome) {
    head.appendChild(tuneRow('biome size', '#ffb87a', null, function () { return node(field, biome); }, 'size', 0.25, 2.0, field));
    head.appendChild(tuneRow('biome density', '#ffb87a', null, function () { return node(field, biome); }, 'density', 0, 3.0, field));
  }
  body.appendChild(head);
  if (!biome) return;

  // --- object rows ---
  regFor(field).objectsFor(biome).forEach(function (o) {
    var key = field + '/' + biome + '/' + o.name;
    var wrap = el('div', 'border-top:1px solid #243250;padding:2px 0' + (o.disabled ? ';opacity:0.4' : ''));
    var row = tuneRow(o.name, '#cfe0ff', key, function () { return node(field, biome, o.name); }, 'size', 0.25, 2.0, field);
    // expand arrow + path + density on a second line
    var arrow = el('span', 'cursor:pointer;color:#7ea0d0;margin-left:4px', expandedKey === key ? '▾' : '▸');
    arrow.onclick = function () { expandedKey = expandedKey === key ? null : key; rebuild(); };
    row.appendChild(arrow);
    wrap.appendChild(row);
    wrap.appendChild(tuneRow('  density', '#9fb6dd', null, function () { return node(field, biome, o.name); }, 'density', 0, 3.0, field));
    // Per-category animation toggles from the registry (F3 has none).
    // Categories: wind_sway (live in renderer) + player_walk (generated on
    // disk; gates future renderer wiring + generation). Unchecked = disabled.
    var animCats = regFor(field).animCategories;
    if (animCats.length) {
      var animRow = el('div', 'display:flex;align-items:center;gap:8px;margin:1px 0 1px 18px;color:#9fb6dd');
      animRow.appendChild(el('span', '', 'anim:'));
      animCats.forEach(function (pair) {
        var cat = pair[0];
        var lbl = el('label', 'display:flex;align-items:center;gap:2px;cursor:pointer');
        var acb = el('input'); acb.type = 'checkbox';
        var an = peek(field, biome, o.name);
        acb.checked = !(an && an.anims && an.anims[cat] === false);
        acb.onchange = function () {
          var t = node(field, biome, o.name);
          t.anims = t.anims || {};
          if (acb.checked) delete t.anims[cat]; else t.anims[cat] = false;
          if (!Object.keys(t.anims).length) delete t.anims;
          apply(field);
        };
        lbl.appendChild(acb);
        lbl.appendChild(el('span', '', pair[1]));
        animRow.appendChild(lbl);
      });
      wrap.appendChild(animRow);
    }
    var path = el('div', 'color:#5e729a;font-size:10px;margin-left:18px', regFor(field).path + '/' + biome + '/' + o.name + '  (' + o.variants.length + ' variants, eff ' + effSize(field, biome, o.name).toFixed(2) + ')');
    wrap.appendChild(path);
    body.appendChild(wrap);
  });

  // --- bulk apply ---
  var bulk = el('div', 'border-top:1px solid #3a4a6a;margin-top:6px;padding-top:6px;display:flex;gap:4px;align-items:center');
  bulk.appendChild(el('span', '', 'set checked size:'));
  var bv = numBox(1.0, function () {}, 50);
  bulk.appendChild(bv);
  var bbtn = el('button', 'font:11px monospace;cursor:pointer', 'apply');
  bbtn.onclick = function () {
    var v = parseFloat(bv.value);
    if (isNaN(v)) return;
    for (var k in checked) {
      if (!checked[k]) continue;
      var parts = k.split('/'); // field/biome/obj[/variant]
      var t = parts.length === 4
        ? node(parts[0], parts[1], parts[2], parseInt(parts[3], 10))
        : node(parts[0], parts[1], parts[2]);
      delete t.sizeMin; delete t.sizeMax; t.size = v;
    }
    apply(field); rebuild();
  };
  bulk.appendChild(bbtn);
  body.appendChild(bulk);

  // --- export / reset ---
  var foot = el('div', 'display:flex;gap:6px;margin-top:6px');
  var copy = el('button', 'font:11px monospace;cursor:pointer', 'copy JSON');
  copy.onclick = function () {
    var json = JSON.stringify(TREE, null, 2);
    console.log('[field tuner]', json);
    if (navigator.clipboard) navigator.clipboard.writeText(json);
    copy.textContent = 'copied!';
    setTimeout(function () { copy.textContent = 'copy JSON'; }, 1500);
  };
  var reset = el('button', 'font:11px monospace;cursor:pointer', 'reset all');
  reset.onclick = function () {
    TREE = emptyTree();
    checked = {};
    apply(repaintFieldId() || activeField); // worst case: repaint chunks too
    rebuild();
  };
  foot.appendChild(copy); foot.appendChild(reset);
  body.appendChild(foot);

  // --- side panel: states + variants for the expanded object ---
  if (!sidePanel) buildSidePanel();
  var ek = expandedKey && expandedKey.split('/'); // [field, biome, obj]
  if (ek && ek[0] === field && ek[1] === biome) {
    var eObj = regFor(field).objectsFor(biome).filter(function (o) { return o.name === ek[2]; })[0];
    if (eObj) {
      sideTitle.textContent = ek[2];
      sideBody.textContent = '';
      var stNames = regFor(field).stateNames(biome, eObj.name);
      if (stNames.length) {
        var defaults = regFor(field).stateDefaults(biome, eObj.name);
        var curStates = (peek(field, biome, eObj.name) || {}).states;
        stNames.forEach(function (sn) {
          var srow = el('div', 'display:flex;align-items:center;gap:4px;margin:1px 0');
          srow.appendChild(el('span', 'width:96px;overflow:hidden;white-space:nowrap;color:#b8a3e0', 'state ' + sn));
          var sv = curStates && curStates[sn] != null ? curStates[sn] : (defaults[sn] || 0);
          var sval = el('span', 'width:34px;text-align:right', sv.toFixed(0));
          srow.appendChild(slider(0, 100, 1, sv, (function (snCap) {
            return function (x) {
              var t = node(field, biome, eObj.name);
              if (!t.states) {
                t.states = {};
                stNames.forEach(function (k) { t.states[k] = defaults[k] || 0; });
              }
              t.states[snCap] = x;
              sval.textContent = x.toFixed(0);
              applySoon(field);
            };
          })(sn)));
          srow.appendChild(sval);
          sideBody.appendChild(srow);
        });
      }
      eObj.variants.forEach(function (v) { sideBody.appendChild(variantRow(field, biome, eObj.name, v)); });
      sidePanel.style.display = 'flex';
    } else {
      sidePanel.style.display = 'none';
    }
  } else {
    sidePanel.style.display = 'none';
  }
}

// Mount the field tuner into the Dev HUD body (the shell scrolls; we don't add our own scroll). The
// per-object side panel still pops out as its own fixed element to the left of the HUD.
function mountFieldTuner(container) {
  panel = container; // rebuild()'s `if (!panel) return` guard keys off this
  var tabs = el('div', 'display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap');
  FIELD_REGISTRY.forEach(function (reg) {
    var b = el('button', 'font:12px monospace;cursor:pointer;flex:1', reg.id.toUpperCase());
    b.onclick = function () { activeField = reg.id; rebuild(); };
    tabs.appendChild(b);
  });
  container.appendChild(tabs);
  body = el('div', '');
  container.appendChild(body);
  rebuild();
}

// Leaving the Fields tab: stash the side panel (it's a separate fixed element on document.body).
function unmountFieldTuner() {
  if (sidePanel) sidePanel.style.display = 'none';
}

export function initFieldTuner() {
  // Old F4 tuner key is obsolete — its values were baked into F4_BIOME_SCALE
  // source on 2026-06-11. Remove so stale absolutes can't confuse anyone.
  try { localStorage.removeItem('f4BiomeScale'); } catch (e) { /* private mode */ }
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved) {
      TREE = emptyTree();
      FIELD_REGISTRY.forEach(function (r) { if (saved[r.id]) TREE[r.id] = saved[r.id]; });
    }
  } catch (e) { /* corrupt -> defaults */ }
  setFieldTuning(TREE);
  // If saved tuning exists for a repaint-bitmaps field (F3), chunks may
  // already have been painted with the default tree before this module
  // loaded — drop bitmaps so they repaint.
  var rf = repaintFieldId();
  var rt = rf && TREE[rf];
  var hasRepaintTuning = !!(rt && (rt.size != null || rt.density != null || rt.biomes));
  var prov = window._debugProvider;
  if (prov && prov.applyFieldTuning) prov.applyFieldTuning(TREE, hasRepaintTuning);
  if (hasRepaintTuning) clearClaimCaches();

  window._fieldTuning = { tree: function () { return TREE; }, set: function (t) { TREE = emptyTree(); FIELD_REGISTRY.forEach(function (r) { if (t && t[r.id]) TREE[r.id] = t[r.id]; }); apply(repaintFieldId() || activeField); }, apply: apply };
  window._fieldRegistry = FIELD_REGISTRY.map(function (r) { return r.id; });
  window._fieldTunerToggle = function () { openTab('fields'); };

  // Register as the Dev HUD "Fields" tab (the old ` key now opens the HUD shell, which owns the tabs).
  registerDevTool({ id: 'fields', label: 'Fields', order: 20, mount: mountFieldTuner, unmount: unmountFieldTuner });
}
