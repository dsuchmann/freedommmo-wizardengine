# F5 Wiring + Field Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** F5 medium objects (96px boulders/ruins/logs) place and render live in-game, with a data-driven field registry so the tuner panel covers F5 — and every future field — with size, density, anim, and state-mix sliders.

**Architecture:** F5 mirrors the proven F4 path: generated catalog → deterministic per-tile placements with claim footprints in `decoration-claims.js` → y-sorted main-thread draw in `field2-animator.js`. New `tuneStateWeights` resolver makes lifecycle/state mixes tunable for all fields (F2/F4 hardcoded splits become defaults). New `src/dev/field-registry.js` drives the tuner panel.

**Tech Stack:** Vanilla ES modules, node:test, playwright-core headless probes (chromium-1217, swiftshader), http-server dev server.

**Spec:** `docs/superpowers/specs/2026-06-12-f5-wiring-field-registry-design.md`

**Execution environment (IMPORTANT):**
- Work in the git worktree `C:\Users\daves\AppData\Roaming\wizardgenie\projects\f5-wiring`, branch `f5-field-registry` (based on master @ 71618f4b1). NEVER work in `projects\default` — other agents switch branches there.
- All commands below run from the worktree root unless stated.
- F5 source art lives only in the MAIN checkout (untracked): `C:\Users\daves\AppData\Roaming\wizardgenie\projects\default\assets\pixelab\landscape_v2\micro\medium_objects\`. A PixelLab runner is still writing state PNGs there — Task 1 snapshots it into the worktree. Newer states picked up by re-running the catalog generator later; missing state PNGs fall back to base sprites by design.
- Unit tests: `node --test test/field-tuning.test.js test/decoration-claims-f5.test.js`
- Probes need a dev server serving the WORKTREE: `npx http-server -p 8742 -c-1 --silent .` (run in background; the main checkout's server owns :8741 — do not touch it).
- Final step merges `f5-field-registry` → `master` so the user gets one testable build.

**Key existing facts (verified against source):**
- F4 template: `f4Placements` at `src/world/decoration-claims.js:479` (salts 9700–9720), `f4SpriteUrl:528`, `_f4Cache:18`, `clearClaimCaches:471`, `getClaimMask:428` (±2 scan, comment says raise when F4+ register).
- F4 descriptors built in `buildTileDescriptor` at `src/render/field2-animator.js:601-627`, pushed into `f4Blades` (bi keyspace 90+), merged into the tile's blade list and y-sorted via `sortYOff`.
- F2 lifecycle roll: `field2-animator.js:703-709` (15/55/20/10, salt 7100+bi). F4 lifecycle roll: `decoration-claims.js:495-502` (15/55/20/8/2, salt 9705).
- Tuner: `src/dev/field-tuner.js` — `FIELDS=['f2','f3','f4']:14`, `objectsFor:38`, `apply:100`, `applySoon:117` (f3-coalescing), anim toggles `:246-267`, `initFieldTuner:337`.
- Resolver: `src/world/field-tuning.js` — `FIELD_TUNING:16`, `setFieldTuning:18`, all functions pure/worker-safe.
- Catalog generator: `scripts/gen-mf-catalog.mjs` → `src/world/mf-catalog.js` (`MF_CATALOG`, entries `{name,size,variants,statePool,anims}`).
- F5 asset naming: base `mo__<biome>__<obj>__v###.png` (96px), states `_states/<state>/mo__<biome>__<obj>__<state>__v###.png`. States on disk so far are sparse (e.g. only v000/v007/v014) — per-state variant lists are required in the catalog, NOT a single pool.
- Debug hook: `window._claims` in `src/main.js:38-54`.
- Probe: `scripts/probe-field-tuning.mjs` hardcodes `:8741` and the grassland spot x=1312,y=1312.

---

### Task 1: Snapshot F5 assets into the worktree

**Files:**
- Create: `assets/pixelab/landscape_v2/micro/medium_objects/**` (copied PNGs)

- [ ] **Step 1: Copy assets from the main checkout (exclude runner state/log files)**

```bash
cd "C:/Users/daves/AppData/Roaming/wizardgenie/projects/f5-wiring"
cp -r "C:/Users/daves/AppData/Roaming/wizardgenie/projects/default/assets/pixelab/landscape_v2/micro/medium_objects" assets/pixelab/landscape_v2/micro/
rm -f assets/pixelab/landscape_v2/micro/medium_objects/_f5_state.json assets/pixelab/landscape_v2/micro/medium_objects/_f5_run.log
```

- [ ] **Step 2: Verify the copy**

```bash
ls assets/pixelab/landscape_v2/micro/medium_objects | wc -l   # expect 16 (biome dirs)
ls assets/pixelab/landscape_v2/micro/medium_objects/grassland # expect fence_post/ field_boulder/ hay_bale/
find assets/pixelab/landscape_v2/micro/medium_objects -name "*.png" | wc -l  # expect ~800+ (768 base + states so far)
```

- [ ] **Step 3: Commit**

```bash
git add assets/pixelab/landscape_v2/micro/medium_objects
git commit -m "assets(f5): medium objects snapshot — 16 biomes x 3 objects, base variants + in-progress states"
```

---

### Task 2: Catalog generator — emit `src/world/mo-catalog.js`

**Files:**
- Modify: `scripts/gen-mf-catalog.mjs`
- Create (generated): `src/world/mo-catalog.js`

MO entries need **per-state variant lists** (`states: { cracked: [0,7,14], ... }`) because state art is landing incrementally — the renderer must know exactly which `(state, variant)` PNGs exist to apply the fallback-to-base rule honestly. Do NOT require a `_states` dir for MO objects (states are still generating; MF keeps its legacy `_states`-required exclusion).

- [ ] **Step 1: Extend the generator**

Append an MO scan block to `scripts/gen-mf-catalog.mjs` after the existing MF write (keep the MF block untouched so `mf-catalog.js` stays byte-identical). Add below the existing code:

```js
// ---- F5 medium objects -> src/world/mo-catalog.js ----
const OBJECTS = path.join(ROOT, 'assets/pixelab/landscape_v2/micro/medium_objects');
const MO_OUT = path.join(ROOT, 'src/world/mo-catalog.js');

const moCatalog = {};
for (const biome of fs.readdirSync(OBJECTS)) {
  const bdir = path.join(OBJECTS, biome);
  if (!fs.statSync(bdir).isDirectory()) continue;
  for (const obj of fs.readdirSync(bdir)) {
    const odir = path.join(bdir, obj);
    if (!fs.statSync(odir).isDirectory()) continue;
    const bases = fs.readdirSync(odir)
      .filter(f => /^mo__.*__v\d{3}\.png$/.test(f))
      .sort();
    if (!bases.length) continue;
    const size = pngWidth(path.join(odir, bases[0]));
    // per-state variant lists: states/{name} -> sorted variant indices on disk
    const states = {};
    const sroot = path.join(odir, '_states');
    if (fs.existsSync(sroot)) {
      for (const st of fs.readdirSync(sroot)) {
        const sdir = path.join(sroot, st);
        if (!fs.statSync(sdir).isDirectory()) continue;
        const vs = fs.readdirSync(sdir)
          .map(f => f.match(/__v(\d{3})\.png$/))
          .filter(Boolean)
          .map(m => parseInt(m[1], 10))
          .sort((a, b) => a - b);
        if (vs.length) states[st] = vs;
      }
    }
    // anim variants: v dirs under anim/<category> with >= 9 frames (none yet — future)
    const anims = [];
    const adir = path.join(odir, 'anim', 'wind_sway');
    if (fs.existsSync(adir)) {
      for (const vd of fs.readdirSync(adir)) {
        const m = vd.match(/^v(\d{3})$/);
        if (!m) continue;
        const frames = fs.readdirSync(path.join(adir, vd)).filter(f => /^frame_\d{3}\.png$/.test(f));
        if (frames.length >= 9) anims.push(parseInt(m[1], 10));
      }
    }
    (moCatalog[biome] = moCatalog[biome] || []).push({
      name: obj, size,
      variants: bases.length,
      states,
      anims: anims.sort((a, b) => a - b),
    });
  }
}

let moTypes = 0, moStates = 0;
for (const b in moCatalog) for (const o of moCatalog[b]) { moTypes++; moStates += Object.keys(o.states).length; }
fs.writeFileSync(MO_OUT, '// AUTO-GENERATED by scripts/gen-mf-catalog.mjs — do not edit.\n' +
  '// Regenerate as F5 state art / animations land on disk.\n' +
  'export var MO_CATALOG = ' + JSON.stringify(moCatalog, null, 1) + ';\n');
console.log(`wrote ${MO_OUT}: ${moTypes} types, ${moStates} state sets`);
```

- [ ] **Step 2: Run and verify**

```bash
node scripts/gen-mf-catalog.mjs
git diff --stat src/world/mf-catalog.js   # MUST be empty (byte-identical)
node -e "import('./src/world/mo-catalog.js').then(m => { const c = m.MO_CATALOG; const bs = Object.keys(c); console.log(bs.length, 'biomes'); if (bs.length !== 16) process.exit(1); for (const b of bs) { if (c[b].length !== 3) { console.log('BAD', b, c[b].length); process.exit(1); } for (const o of c[b]) { if (o.size !== 96) { console.log('BAD SIZE', b, o.name, o.size); process.exit(1); } } } console.log('OK: 16 biomes x 3 objects, all 96px'); console.log('sample:', JSON.stringify(c.grassland[1] || c.grassland[0]).slice(0, 200)); })"
```
Expected: `mf-catalog.js` unchanged; `OK: 16 biomes x 3 objects, all 96px`.

- [ ] **Step 3: Commit**

```bash
git add scripts/gen-mf-catalog.mjs src/world/mo-catalog.js
git commit -m "feat(f5): catalog generator scans medium_objects -> MO_CATALOG with per-state variant lists"
```

---

### Task 3: `tuneStateWeights` resolver + state order/default constants

**Files:**
- Modify: `src/world/field-tuning.js`
- Test: `test/field-tuning.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/field-tuning.test.js` (also update the existing `deepEqual` default test — see Step 3):

```js
import { tuneStateWeights, rollWeighted, F2_STATE_ORDER, F2_STATE_DEFAULTS,
  F4_STATE_ORDER, F4_STATE_DEFAULTS, F5_STATE_ORDER, f5StateDefaults } from '../src/world/field-tuning.js';

test('tuneStateWeights cascade: object > biome > master > defaults', () => {
  const d = { base: 60, cracked: 38, enchanted: 2 };
  setFieldTuning(null);
  assert.deepEqual(tuneStateWeights('f5', 'grassland', 'field_boulder', d), d);
  setFieldTuning({ f5: { states: { base: 1 } } });
  assert.deepEqual(tuneStateWeights('f5', 'grassland', 'field_boulder', d), { base: 1 });
  setFieldTuning({ f5: { states: { base: 1 }, biomes: { grassland: { states: { cracked: 1 } } } } });
  assert.deepEqual(tuneStateWeights('f5', 'grassland', 'field_boulder', d), { cracked: 1 });
  assert.deepEqual(tuneStateWeights('f5', 'desert', 'mesa_rock', d), { base: 1 }); // master still wins elsewhere
  setFieldTuning({ f5: { biomes: { grassland: { states: { cracked: 1 },
    objects: { field_boulder: { states: { enchanted: 1 } } } } } } });
  assert.deepEqual(tuneStateWeights('f5', 'grassland', 'field_boulder', d), { enchanted: 1 });
  setFieldTuning(null);
});

test('rollWeighted: normalized thresholds in declared order, zero-weight skipped', () => {
  const w = { a: 15, b: 55, c: 20, d: 10 };
  const order = ['a', 'b', 'c', 'd'];
  assert.equal(rollWeighted(w, order, 0.0), 'a');
  assert.equal(rollWeighted(w, order, 0.149), 'a');
  assert.equal(rollWeighted(w, order, 0.15), 'b');
  assert.equal(rollWeighted(w, order, 0.699), 'b');
  assert.equal(rollWeighted(w, order, 0.70), 'c');
  assert.equal(rollWeighted(w, order, 0.899), 'c');
  assert.equal(rollWeighted(w, order, 0.9), 'd');
  assert.equal(rollWeighted(w, order, 0.999), 'd');
  // weights needn't sum to 100 — relative
  assert.equal(rollWeighted({ a: 1, b: 1 }, ['a', 'b'], 0.49), 'a');
  assert.equal(rollWeighted({ a: 1, b: 1 }, ['a', 'b'], 0.51), 'b');
  // missing keys count as 0
  assert.equal(rollWeighted({ b: 1 }, ['a', 'b'], 0.0), 'b');
  // all-zero/empty -> first entry (degenerate, never crash)
  assert.equal(rollWeighted({}, ['a', 'b'], 0.5), 'a');
});

test('per-field state defaults match the historical hardcoded splits', () => {
  assert.deepEqual(F2_STATE_ORDER, ['seedling', 'normal', 'wilting', 'dead']);
  assert.deepEqual(F2_STATE_DEFAULTS, { seedling: 15, normal: 55, wilting: 20, dead: 10 });
  assert.deepEqual(F4_STATE_ORDER, ['seedling', 'base', 'wilting', 'dead', 'enchanted']);
  assert.deepEqual(F4_STATE_DEFAULTS, { seedling: 15, base: 55, wilting: 20, dead: 8, enchanted: 2 });
  assert.deepEqual(F5_STATE_ORDER, ['base', 'cracked', 'mossy_overgrown', 'burned', 'frozen', 'destroyed', 'enchanted']);
  // F5 defaults: base 60 / weathered 32 split over biome subset / destroyed 6 / enchanted 2
  const g = f5StateDefaults('grassland');
  assert.equal(g.base, 60); assert.equal(g.destroyed, 6); assert.equal(g.enchanted, 2);
  assert.equal(Object.values(g).reduce((a, b) => a + b, 0), 100);
  const a = f5StateDefaults('arctic');
  assert.equal(a.frozen, 16); assert.equal(a.cracked, 16); assert.equal(a.burned, undefined);
});

test('setFieldTuning normalizes f5', () => {
  setFieldTuning({ f5: { size: 2 } });
  assert.equal(FIELD_TUNING.f5.size, 2);
  setFieldTuning(null);
  assert.deepEqual(FIELD_TUNING, { f2: {}, f3: {}, f4: {}, f5: {} });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/field-tuning.test.js
```
Expected: FAIL — `tuneStateWeights` etc. not exported; existing `setFieldTuning replaces tree` test still passes.

- [ ] **Step 3: Implement in `src/world/field-tuning.js`**

Change line 16 and `setFieldTuning` to include f5:

```js
export var FIELD_TUNING = { f2: {}, f3: {}, f4: {}, f5: {} };

export function setFieldTuning(tree) {
  FIELD_TUNING = tree && typeof tree === 'object'
    ? { f2: tree.f2 || {}, f3: tree.f3 || {}, f4: tree.f4 || {}, f5: tree.f5 || {} }
    : { f2: {}, f3: {}, f4: {}, f5: {} };
}
```

Update the EXISTING test `setFieldTuning replaces tree and live-binding updates` (line 48): `assert.deepEqual(FIELD_TUNING, { f2: {}, f3: {}, f4: {}, f5: {} });`

Append to the file:

```js
// ---- Lifecycle / condition state mixes ------------------------------------
// Weights are RELATIVE (normalized at roll). The nearest defined `states`
// node wins whole-map: object > biome > field master > built-in defaults.
// f5.biomes.<biome>.objects.<obj>.states = { base: 60, cracked: 10, ... }
export function tuneStateWeights(field, biome, obj, defaults) {
  var f = FIELD_TUNING[field];
  var b = f && f.biomes && f.biomes[biome];
  var o = b && b.objects && b.objects[obj];
  if (o && o.states) return o.states;
  if (b && b.states) return b.states;
  if (f && f.states) return f.states;
  return defaults;
}

// Pick a state name from relative weights, walking `order` cumulatively so
// default weights reproduce the historical hardcoded thresholds exactly.
// r in [0,1). Missing keys = 0. Degenerate (all zero) -> order[0].
export function rollWeighted(weights, order, r) {
  var total = 0, i;
  for (i = 0; i < order.length; i++) total += weights[order[i]] || 0;
  if (!(total > 0)) return order[0];
  var x = r * total, acc = 0;
  for (i = 0; i < order.length; i++) {
    acc += weights[order[i]] || 0;
    if (x < acc && (weights[order[i]] || 0) > 0) return order[i];
  }
  return order[order.length - 1];
}

// Per-field state rosters + defaults (= the old hardcoded splits).
// 'base'/'normal' mean "no state sprite" (render the base variant).
export var F2_STATE_ORDER = ['seedling', 'normal', 'wilting', 'dead'];
export var F2_STATE_DEFAULTS = { seedling: 15, normal: 55, wilting: 20, dead: 10 };
export var F4_STATE_ORDER = ['seedling', 'base', 'wilting', 'dead', 'enchanted'];
export var F4_STATE_DEFAULTS = { seedling: 15, base: 55, wilting: 20, dead: 8, enchanted: 2 };
export var F5_STATE_ORDER = ['base', 'cracked', 'mossy_overgrown', 'burned', 'frozen', 'destroyed', 'enchanted'];

// F5 defaults: base 60% / weathered 32% (biome-appropriate subset, split
// evenly) / destroyed 6% / enchanted 2%. (Spec §2.)
var F5_WEATHERED = {
  arctic: ['cracked', 'frozen'], tundra: ['cracked', 'frozen'],
  taiga: ['cracked', 'frozen', 'mossy_overgrown'],
  desert: ['cracked', 'burned'], savanna: ['cracked', 'burned'], volcanic: ['cracked', 'burned'],
  swamp: ['mossy_overgrown', 'cracked'], forest: ['mossy_overgrown', 'cracked'],
  dense_forest: ['mossy_overgrown', 'cracked'], tropical_forest: ['mossy_overgrown', 'cracked'],
  mystic: ['mossy_overgrown', 'cracked'],
};
var F5_WEATHERED_DEFAULT = ['cracked', 'mossy_overgrown'];
var _f5Defaults = {};
export function f5StateDefaults(biome) {
  var hit = _f5Defaults[biome];
  if (hit) return hit;
  var w = F5_WEATHERED[biome] || F5_WEATHERED_DEFAULT;
  var d = { base: 60, destroyed: 6, enchanted: 2 };
  for (var i = 0; i < w.length; i++) d[w[i]] = 32 / w.length;
  return _f5Defaults[biome] = d;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/field-tuning.test.js
```
Expected: ALL PASS (old + new).

- [ ] **Step 5: Commit**

```bash
git add src/world/field-tuning.js test/field-tuning.test.js
git commit -m "feat(f5): tuneStateWeights resolver + rollWeighted + per-field state rosters/defaults"
```

---

### Task 4: `f5Placements` + claims + F4 migration in `decoration-claims.js`

**Files:**
- Modify: `src/world/decoration-claims.js`
- Modify: `src/main.js:38-54` (`window._claims` hook)
- Test: `test/decoration-claims-f5.test.js` (new)

- [ ] **Step 1: Write the failing tests**

Create `test/decoration-claims-f5.test.js`:

```js
// test/decoration-claims-f5.test.js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setFieldTuning } from '../src/world/field-tuning.js';
import { f5Placements, f5SpriteUrl, f4Placements, getClaimMask, clearClaimCaches }
  from '../src/world/decoration-claims.js';
import { MO_CATALOG } from '../src/world/mo-catalog.js';

const grass = (wx, wy) => ({ biome: 'grassland', transition: false });

beforeEach(() => { setFieldTuning(null); clearClaimCaches(); });

// scan a region, return [wx, wy, placement] triples
function scan(tileInfo, x0, y0, n) {
  const out = [];
  for (let wy = y0; wy < y0 + n; wy++)
    for (let wx = x0; wx < x0 + n; wx++)
      for (const p of f5Placements(wx, wy, tileInfo)) out.push([wx, wy, p]);
  return out;
}

test('f5Placements is deterministic and non-empty over a large region', () => {
  const a = scan(grass, 0, 0, 80);
  clearClaimCaches();
  const b = scan(grass, 0, 0, 80);
  assert.ok(a.length > 0, 'expected some placements in 6400 tiles at ~2%');
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
  for (const [, , p] of a) {
    assert.equal(p.biome, 'grassland');
    assert.equal(p.size, 96);
    assert.ok(MO_CATALOG.grassland.some(o => o.name === p.name));
    assert.ok(p.variant >= 0 && p.variant < MO_CATALOG.grassland.find(o => o.name === p.name).variants);
  }
});

test('density 0 -> empty; size multiplier flows to sizeTiles', () => {
  setFieldTuning({ f5: { biomes: { grassland: { density: 0 } } } });
  clearClaimCaches();
  assert.equal(scan(grass, 0, 0, 60).length, 0);

  setFieldTuning(null); clearClaimCaches();
  const base = scan(grass, 0, 0, 60);
  setFieldTuning({ f5: { biomes: { grassland: { size: 2 } } } });
  clearClaimCaches();
  const big = scan(grass, 0, 0, 60);
  assert.equal(base.length, big.length);
  for (let i = 0; i < base.length; i++)
    assert.ok(Math.abs(big[i][2].sizeTiles - base[i][2].sizeTiles * 2) < 1e-9);
});

test('state roll respects tuneStateWeights override; URL falls back to base when PNG missing', () => {
  setFieldTuning({ f5: { biomes: { grassland: { states: { enchanted: 1 } } } } });
  clearClaimCaches();
  const pls = scan(grass, 0, 0, 80);
  assert.ok(pls.length > 0);
  for (const [, , p] of pls) {
    assert.equal(p.state, 'enchanted');
    const obj = MO_CATALOG.grassland.find(o => o.name === p.name);
    const onDisk = !!(obj.states.enchanted && obj.states.enchanted.includes(p.variant));
    const url = f5SpriteUrl(p);
    if (onDisk) assert.ok(url.includes('/_states/enchanted/'), url);
    else assert.ok(!url.includes('/_states/'), 'missing PNG must fall back to base: ' + url);
  }
});

test('claim footprint is larger than F4 relative footprint and lands in the mask', () => {
  const pls = scan(grass, 0, 0, 80);
  const [wx, wy, p] = pls[0];
  const drawPx = p.sizeTiles * 32;
  assert.ok(p.fw > drawPx * 0.30, 'F5 fw must exceed F4 ratio 0.30: ' + (p.fw / drawPx));
  assert.ok(p.fh > drawPx * 0.16, 'F5 fh must exceed F4 ratio 0.16: ' + (p.fh / drawPx));
  // the footprint center cell is claimed in the 8x8 mask of its tile
  const cwx = Math.floor(p.bx / 32), cwy = Math.floor(p.by / 32);
  const mask = getClaimMask(cwx, cwy, grass);
  const c = Math.min(7, Math.max(0, Math.floor((p.bx - cwx * 32) / 4)));
  const r = Math.min(7, Math.max(0, Math.floor((p.by - cwy * 32) / 4)));
  assert.ok((mask[r] & (1 << c)) !== 0, 'F5 base center must be claimed');
});

test('F4 skips tiles that F5 claimed', () => {
  const f5Tiles = new Set(scan(grass, 0, 0, 120).map(([wx, wy]) => wx + ',' + wy));
  assert.ok(f5Tiles.size > 0);
  for (const key of f5Tiles) {
    const [wx, wy] = key.split(',').map(Number);
    assert.equal(f4Placements(wx, wy, grass).length, 0, 'F4 must skip F5 tile ' + key);
  }
});

test('F4 default state mix unchanged by the resolver migration (golden thresholds)', () => {
  // find F4 placements and verify the historical distribution boundaries hold:
  // same tile coords always produce the same state as the old hardcoded code
  // (roll < .15 seedling, < .70 base/null, < .90 wilting, < .98 dead, else enchanted)
  let checked = 0;
  for (let wy = 0; wy < 200 && checked < 25; wy++) {
    for (let wx = 0; wx < 200 && checked < 25; wx++) {
      for (const p of f4Placements(wx, wy, grass)) {
        assert.ok([null, 'seedling', 'wilting', 'dead', 'enchanted'].includes(p.state));
        checked++;
      }
    }
  }
  assert.ok(checked > 0, 'expected F4 placements');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/decoration-claims-f5.test.js
```
Expected: FAIL — `f5Placements` not exported.

- [ ] **Step 3: Implement F5 in `src/world/decoration-claims.js`**

3a. Extend imports (line 6-8):

```js
import { MO_CATALOG } from './mo-catalog.js';
import { tuneSize, tuneBiomeDensity, tuneObjDensity, tuneStateWeights, rollWeighted,
  F4_STATE_ORDER, F4_STATE_DEFAULTS, F5_STATE_ORDER, f5StateDefaults } from './field-tuning.js';
```

3b. Add F5 constants + cache next to the F4 ones (after line 29):

```js
var MO_BASE_PATH = '/assets/pixelab/landscape_v2/micro/medium_objects/';
// Per-tile chance of one medium object — rarer than F4 (spec: ~1-3%)
var F5_TILE_CHANCE = {
  grassland: 0.020, forest: 0.025, dense_forest: 0.025, tropical_forest: 0.022,
  taiga: 0.020, swamp: 0.022, mystic: 0.030, savanna: 0.018, hills: 0.025,
  steppe: 0.015, beach: 0.012, tundra: 0.012, desert: 0.010, arctic: 0.010,
  mountains: 0.028, volcanic: 0.022,
};
var _f5Cache = new Map();   // 'wx,wy,biome' -> placements
// Live-tunable per-biome F5 scale (96px native = 3 tiles at 1.0). The user
// calibrates in-game; bake final values here afterwards (F4 precedent).
export var F5_BIOME_SCALE = {
  grassland: 1.0, forest: 1.0, dense_forest: 1.0, tropical_forest: 1.0,
  taiga: 1.0, swamp: 1.0, mystic: 1.0, savanna: 1.0, hills: 1.0,
  steppe: 1.0, beach: 1.0, tundra: 1.0, desert: 1.0, arctic: 1.0,
  mountains: 1.0, volcanic: 1.0,
};
```

3c. Add `f5Placements` + `f5SpriteUrl` after `f4AnimUrlBase` (line 539). Salt block 9800+ (9800 tile chance, 9801 obj pick, 9802 variant, 9803/9804 jitter, 9805 state roll, 9814 obj density, 9820 tuneSize — mirrors F4's 9700 block; no other 98xx users exist):

```js
// One medium object per tile max. Deterministic (seed roots 9800-9820).
// Same placement contract as f4: { name, biome, size, variant, state,
// stateOnDisk, ux, uy, sizeTiles, hasAnim, bx, by, fw, fh }.
// States roll from day one (spec: honest roll); a state whose PNG hasn't
// landed renders the base variant — f5SpriteUrl checks stateOnDisk.
export function f5Placements(wx, wy, tileInfo) {
  var t = tileInfo(wx, wy);
  if (!t || t.transition) return EMPTY;
  var key = wx + ',' + wy + ',' + t.biome;
  var hit = _f5Cache.get(key);
  if (hit) return hit;
  var objs = MO_CATALOG[t.biome];
  var chance = (F5_TILE_CHANCE[t.biome] || 0) * tuneBiomeDensity('f5', t.biome);
  if (!objs || !objs.length || chance === 0) return cachePut(_f5Cache, key, EMPTY);
  if (rand2(wx, wy, 9800) > chance) return cachePut(_f5Cache, key, EMPTY);

  var obj = objs[Math.floor(rand2(wx, wy, 9801) * objs.length)];
  var objD = tuneObjDensity('f5', t.biome, obj.name);
  if (objD < 1 && rand2(wx, wy, 9814) > objD) return cachePut(_f5Cache, key, EMPTY);

  var weights = tuneStateWeights('f5', t.biome, obj.name, f5StateDefaults(t.biome));
  var st = rollWeighted(weights, F5_STATE_ORDER, rand2(wx, wy, 9805));
  if (st === 'base') st = null;
  var variant = Math.floor(rand2(wx, wy, 9802) * obj.variants);
  var stateOnDisk = !!(st && obj.states[st] && obj.states[st].indexOf(variant) !== -1);

  var ux = 0.5 + (rand2(wx, wy, 9803) - 0.5) * 0.5;
  var uy = 0.5 + (rand2(wx, wy, 9804) - 0.5) * 0.5;
  var scale = (F5_BIOME_SCALE[t.biome] || 1.0) *
    tuneSize('f5', t.biome, obj.name, variant, wx, wy, 9820);
  var sizeTiles = obj.size * scale / TILE_ART_PX; // 96px @ 1.0 -> 3 tiles
  var drawPx = obj.size * scale;
  var p = {
    name: obj.name, biome: t.biome, size: obj.size, variant: variant,
    state: st, stateOnDisk: stateOnDisk,
    ux: ux, uy: uy, sizeTiles: sizeTiles,
    hasAnim: obj.anims.indexOf(variant) !== -1,
    // base footprint ~2x F4's absolute claim at equal draw size: F4 uses
    // 0.30/0.16 of drawPx; objects are ground-heavy so claim wider+deeper.
    bx: (wx + ux) * TILE_ART_PX,
    by: (wy + uy) * TILE_ART_PX + drawPx * 0.30,
    fw: drawPx * 0.42, fh: drawPx * 0.22,
  };
  return cachePut(_f5Cache, key, [p]);
}

export function f5SpriteUrl(p) {
  if (p.state && p.stateOnDisk) {
    return MO_BASE_PATH + p.biome + '/' + p.name + '/_states/' + p.state +
      '/mo__' + p.biome + '__' + p.name + '__' + p.state + '__v' + pad3(p.variant) + '.png';
  }
  return MO_BASE_PATH + p.biome + '/' + p.name +
    '/mo__' + p.biome + '__' + p.name + '__v' + pad3(p.variant) + '.png';
}
```

3d. F5 claims first / F4 yields (locked atlas decision #7). In `f4Placements`, right after the tile-chance roll (line 488 `if (rand2(wx, wy, 9700) > chance) ...`), add:

```js
  // Larger objects claim first: a tile F5 claimed never hosts F4.
  if (f5Placements(wx, wy, tileInfo).length) return cachePut(_f4Cache, key, EMPTY);
```

3e. Migrate the F4 lifecycle roll (lines 495-502) to the resolver — REPLACE:

```js
  // Lifecycle roll: 15% seedling / 55% normal / 20% wilting / 8% dead / 2% enchanted
  var roll = rand2(wx, wy, 9705);
  var st = null;
  if (roll < 0.15) st = 'seedling';
  else if (roll < 0.70) st = null;
  else if (roll < 0.90) st = 'wilting';
  else if (roll < 0.98) st = 'dead';
  else st = 'enchanted';
```

with:

```js
  // Lifecycle roll via the tunable state-weight resolver. Defaults reproduce
  // the historical 15/55/20/8/2 split exactly (same salt, same thresholds).
  var st = rollWeighted(
    tuneStateWeights('f4', t.biome, obj.name, F4_STATE_DEFAULTS),
    F4_STATE_ORDER, rand2(wx, wy, 9705));
  if (st === 'base') st = null;
```

3f. `getClaimMask` (line 428): include F5 and widen the scan — F5 reach at tuner-max scale 2.0 is fw 0.42×192px ≈ 2.5 tiles. Change the loops from `-2..2` to `-3..3` and the concat to:

```js
      var pls = f3Placements(wx + nx, wy + ny, tileInfo)
        .concat(f4Placements(wx + nx, wy + ny, tileInfo),
                f5Placements(wx + nx, wy + ny, tileInfo));
```

Update the comment above the function: F5 96px objects reach ~2.5 tiles at max tuner scale, hence ±3.

3g. `clearClaimCaches` (line 471):

```js
export function clearClaimCaches() { _placeCache.clear(); _maskCache.clear(); _f4Cache.clear(); _f5Cache.clear(); }
```

3h. Debug hook — in `src/main.js`, inside the `window._claims` object (after the `f4:` entry, line 51), add:

```js
    f5: function (wx, wy) { return m.f5Placements(wx, wy, function (x, y) {
      var t = window._dbgChunkStore && window._dbgChunkStore.tileAt(x, y);
      return t ? { biome: t.biome, transition: !!t.transitionPair } : null; }); },
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/field-tuning.test.js test/decoration-claims-f5.test.js
```
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/decoration-claims.js src/main.js test/decoration-claims-f5.test.js
git commit -m "feat(f5): placements with tunable state roll + 2x claims, F4 yields to F5, mask scan widened to +-3"
```

---

### Task 5: Render F5 in the y-sorted pool + migrate F2 lifecycle

**Files:**
- Modify: `src/render/field2-animator.js`

No unit test possible (browser-only module); covered by the Task 7 probes. The F2 migration is behavior-preserving — `rollWeighted` with F2 defaults reproduces the exact 0.15/0.70/0.90 thresholds from the same salt (proven in Task 3 tests).

Spec error-handling note: "missing base PNG → placement skipped, console warn once" is structurally impossible here — the catalog counts variants from base PNGs actually on disk, so a 404 means a stale catalog. F5 rides the existing F4 frame-cache load path, which handles failed image loads the same way F4 does (sprite simply doesn't draw). No new code.

- [ ] **Step 1: Extend imports (lines 12-13)**

```js
import { isClaimedAt, f4Placements, f4SpriteUrl, f4AnimUrlBase, f5Placements, f5SpriteUrl } from '../world/decoration-claims.js';
import { tuneSize, tuneBiomeDensity, tuneObjDensity, tuneAnimEnabled, tuneStateWeights, rollWeighted,
  F2_STATE_ORDER, F2_STATE_DEFAULTS } from '../world/field-tuning.js';
```

- [ ] **Step 2: Push F5 descriptors into the y-sorted pool**

In `buildTileDescriptor`, immediately after the F4 loop ends (line 627, after the `f4Blades.push` block's closing `}`), add:

```js
  // ---- Field 5 medium objects (static, y-sorted with F2/F4/player) ----
  var f5pls = f5Placements(wx, wy, _claimTileInfo(chunkStore));
  for (var gi = 0; gi < f5pls.length; gi++) {
    var gp = f5pls[gi];
    f4Blades.push({
      bi: 80 + gi, // distinct trigger-key space from F2 (0-19) and F4 (90+)
      stateUrl: null,
      // No F5 anim frames exist on disk yet; the tuner gate is honored here
      // so playback lights up when art lands + catalog regenerates.
      animUrlBase: (gp.hasAnim && !gp.state
        && tuneAnimEnabled('f5', gp.biome, gp.name, 'wind_sway'))
        ? '/assets/pixelab/landscape_v2/micro/medium_objects/' + gp.biome + '/' +
          gp.name + '/anim/wind_sway/v' + (gp.variant < 10 ? '00' + gp.variant : gp.variant < 100 ? '0' + gp.variant : '' + gp.variant) + '/'
        : null,
      staticUrl: f5SpriteUrl(gp),
      isRigid: true,                       // objects never sway-rotate
      lifeScale: gp.sizeTiles,             // 96px @ 1.0 -> 3 tiles
      lifeSway: 0,
      baseAngle: 0,
      offUX: gp.ux - 0.5,
      offUY: gp.uy - 0.5,
      sortYOff: gp.uy + gp.sizeTiles * 0.30, // sort by sprite base (same rule as F4)
      ambientPeriod: 0,
      ambientPhase: 0,
      startDelay: 0,
      loopCount: 0,
      restFrame: 0
    });
  }
```

- [ ] **Step 3: Migrate the F2 lifecycle roll**

Replace lines 703-709:

```js
    // Lifecycle: seedling 15%, normal 55%, wilting 20%, dead 10%
    var stateRoll = rand2(wx, wy, 7100 + bi);
    var lifecycleState = 'normal';
    if (stateRoll < 0.15) lifecycleState = 'seedling';
    else if (stateRoll < 0.70) lifecycleState = 'normal';
    else if (stateRoll < 0.90) lifecycleState = 'wilting';
    else lifecycleState = 'dead';
```

with:

```js
    // Lifecycle via the tunable state-weight resolver. Defaults reproduce the
    // historical 15/55/20/10 split exactly (same salt, same thresholds).
    var lifecycleState = rollWeighted(
      tuneStateWeights('f2', biome, objName, F2_STATE_DEFAULTS),
      F2_STATE_ORDER, rand2(wx, wy, 7100 + bi));
```

- [ ] **Step 4: Smoke-check the module parses**

```bash
node --check src/render/field2-animator.js
```
Expected: no output (clean parse).

- [ ] **Step 5: Commit**

```bash
git add src/render/field2-animator.js
git commit -m "feat(f5): medium objects join the y-sorted draw pool; F2 lifecycle mix now tunable"
```

---

### Task 6: Field registry + registry-driven tuner

**Files:**
- Create: `src/dev/field-registry.js`
- Modify: `src/dev/field-tuner.js`

- [ ] **Step 1: Create `src/dev/field-registry.js`**

```js
// src/dev/field-registry.js
// Ordered descriptors for every tunable decoration field. The field tuner
// panel iterates this — adding F6/F7 later = one new entry, zero tuner edits.
// applyKind: 'live' fields rebuild placement caches only; 'repaint-bitmaps'
// fields (F3) are baked into chunk bitmaps and force a worker repaint.
import { SF_BIOME_OBJECTS_LIST, SF_VARIANT_COUNT, sfVariantsFor } from '../render/wang-image-list.js';
import { SS_BIOME_OBJECTS, ssAllowedVariants } from '../world/decoration-claims.js';
import { MF_CATALOG } from '../world/mf-catalog.js';
import { MO_CATALOG } from '../world/mo-catalog.js';
import { F2_STATE_ORDER, F2_STATE_DEFAULTS, F4_STATE_ORDER, F4_STATE_DEFAULTS,
  F5_STATE_ORDER, f5StateDefaults } from '../world/field-tuning.js';

function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
function none() { return []; }
function noneMap() { return {}; }

export var FIELD_REGISTRY = [
  {
    id: 'f2', label: 'F2 small flora', path: 'micro/small_flora', applyKind: 'live',
    animCategories: [['wind_sway', 'wind'], ['player_walk', 'walk']],
    objectsFor: function (biome) {
      return (SF_BIOME_OBJECTS_LIST[biome] || []).map(function (n) {
        return { name: n, variants: sfVariantsFor(biome, n) || range(SF_VARIANT_COUNT) };
      });
    },
    stateNames: function () { return F2_STATE_ORDER; },
    stateDefaults: function () { return F2_STATE_DEFAULTS; },
  },
  {
    id: 'f3', label: 'F3 small scatter', path: 'micro/small_scatter', applyKind: 'repaint-bitmaps',
    animCategories: [],
    objectsFor: function (biome) {
      return (SS_BIOME_OBJECTS[biome] || []).map(function (o) {
        var allowed = ssAllowedVariants(biome, o.name);
        return { name: o.name, variants: allowed || range(64), disabled: allowed && allowed.length === 0 };
      });
    },
    stateNames: none, stateDefaults: noneMap, // F3 lifecycle pool is worker-baked; not tunable yet
  },
  {
    id: 'f4', label: 'F4 medium flora', path: 'micro/medium_flora', applyKind: 'live',
    animCategories: [['wind_sway', 'wind'], ['player_walk', 'walk']],
    objectsFor: function (biome) {
      return (MF_CATALOG[biome] || []).map(function (o) {
        return { name: o.name, variants: range(o.variants) };
      });
    },
    stateNames: function () { return F4_STATE_ORDER; },
    stateDefaults: function () { return F4_STATE_DEFAULTS; },
  },
  {
    id: 'f5', label: 'F5 medium objects', path: 'micro/medium_objects', applyKind: 'live',
    animCategories: [['wind_sway', 'wind']],
    objectsFor: function (biome) {
      return (MO_CATALOG[biome] || []).map(function (o) {
        return { name: o.name, variants: range(o.variants) };
      });
    },
    stateNames: function () { return F5_STATE_ORDER; },
    stateDefaults: function (biome) { return f5StateDefaults(biome); },
  },
];

export function regFor(id) {
  for (var i = 0; i < FIELD_REGISTRY.length; i++) if (FIELD_REGISTRY[i].id === id) return FIELD_REGISTRY[i];
  return null;
}
export function emptyTree() {
  var t = {};
  for (var i = 0; i < FIELD_REGISTRY.length; i++) t[FIELD_REGISTRY[i].id] = {};
  return t;
}
```

- [ ] **Step 2: Refactor `src/dev/field-tuner.js` onto the registry**

2a. Replace imports of catalogs (lines 7-11) — keep `setFieldTuning`, `clearClaimCaches`, `clearF2TileDescriptors`; drop the now-registry-owned catalog imports; add:

```js
import { setFieldTuning } from '../world/field-tuning.js';
import { clearClaimCaches } from '../world/decoration-claims.js';
import { clearF2TileDescriptors } from '../render/field2-animator.js';
import { FIELD_REGISTRY, regFor, emptyTree } from './field-registry.js';
```

2b. Delete lines 14-16 (`FIELDS`, `FIELD_LABEL`, `FIELD_PATH`) and the `objectsFor` function (lines 37-53) and the now-unused local `range` helper (line 35). Replace `TREE` init (line 30):

```js
var TREE = emptyTree();
```

2c. Update every former usage:
- `FIELD_LABEL[field]` (line 214) → `regFor(field).label`
- `FIELD_PATH[field]` (line 268) → `regFor(field).path`
- `objectsFor(field, biome)` (line 233) → `regFor(field).objectsFor(biome)`
- `FIELDS.forEach` in `buildPanel` (line 325) → `FIELD_REGISTRY.forEach(function (reg) { ... reg.id.toUpperCase() ... activeField = reg.id ... })`
- reset (line 310): `TREE = emptyTree();` and keep `apply('f3')` as worst case but compute it: `apply(repaintFieldId() || activeField)` — add helper:

```js
// Worst-case apply target for global ops: any repaint-bitmaps field.
function repaintFieldId() {
  for (var i = 0; i < FIELD_REGISTRY.length; i++)
    if (FIELD_REGISTRY[i].applyKind === 'repaint-bitmaps') return FIELD_REGISTRY[i].id;
  return null;
}
```

2d. `apply` + `applySoon` key off `applyKind` instead of `field === 'f3'` — replace lines 100-125:

```js
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
```

2e. Anim toggles from the registry — replace the `if (field !== 'f3')` block (lines 246-267) with:

```js
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
```

2f. State-weight sliders — inside the `expanded[key]` block (line 270-272), render state rows BEFORE the variant rows:

```js
    if (expanded[key]) {
      var stNames = regFor(field).stateNames(biome, o.name);
      if (stNames.length) {
        var defaults = regFor(field).stateDefaults(biome, o.name);
        var cur = (peek(field, biome, o.name) || {}).states;
        stNames.forEach(function (sn) {
          var row = el('div', 'display:flex;align-items:center;gap:4px;margin:1px 0 1px 18px');
          row.appendChild(el('span', 'width:96px;overflow:hidden;white-space:nowrap;color:#b8a3e0', 'state ' + sn));
          var v = cur && cur[sn] != null ? cur[sn] : (defaults[sn] || 0);
          var val = el('span', 'width:34px;text-align:right', v.toFixed(0));
          row.appendChild(slider(0, 100, 1, v, function (x) {
            var t = node(field, biome, o.name);
            if (!t.states) { // first edit: materialize the full default map
              t.states = {};
              stNames.forEach(function (k) { t.states[k] = defaults[k] || 0; });
            }
            t.states[sn] = x;
            val.textContent = x.toFixed(0);
            applySoon(field);
          }));
          row.appendChild(val);
          wrap.appendChild(row);
        });
      }
      o.variants.forEach(function (v) { wrap.appendChild(variantRow(field, biome, o.name, v)); });
    }
```

2g. `initFieldTuner` load normalization (line 343) → registry-driven, and expose the registry for probes:

```js
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved) {
      TREE = emptyTree();
      FIELD_REGISTRY.forEach(function (r) { if (saved[r.id]) TREE[r.id] = saved[r.id]; });
    }
```

and after the `window._fieldTuning` line (353):

```js
  window._fieldRegistry = FIELD_REGISTRY.map(function (r) { return r.id; });
```

Keep `window._fieldTuning.set`'s worst-case apply: change `apply('f3')` there to `apply(repaintFieldId() || activeField)`.

- [ ] **Step 3: Smoke-check both modules parse**

```bash
node --check src/dev/field-registry.js && node --check src/dev/field-tuner.js
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/dev/field-registry.js src/dev/field-tuner.js
git commit -m "feat(tuner): data-driven field registry — F5 tab, state-weight sliders, applyKind replaces f3 special-casing"
```

---

### Task 7: Probe extension + full verification

**Files:**
- Modify: `scripts/probe-field-tuning.mjs`

- [ ] **Step 1: Parameterize the probe port**

In `scripts/probe-field-tuning.mjs` replace the hardcoded URL line with:

```js
const PORT = process.env.PROBE_PORT || 8741;
await page.goto(`http://localhost:${PORT}/?x=1312&y=1312`, { waitUntil: 'domcontentloaded' });
```

- [ ] **Step 2: Add F5 + registry assertions**

Inside the `page.evaluate` block, after the existing F4 size check, add (follow the existing result-object pattern — append fields to the returned object and to the final console assertions exactly as the f3/f4 checks do):

```js
  // (4) registry-driven tabs include f5 in order
  const registryOk = JSON.stringify(window._fieldRegistry) === JSON.stringify(['f2', 'f3', 'f4', 'f5']);

  // (5) F5 placements exist and respond to density/size/state tuning
  const f5 = () => sample((x, y) => window._claims.f5(x, y).map(p => [p.name, p.variant, +p.sizeTiles.toFixed(4), p.state]));
  const baseF5 = JSON.parse(f5());
  const f5Count = baseF5.reduce((n, a) => n + a.length, 0);

  window._fieldTuning.set({ f2: {}, f3: {}, f4: {}, f5: { biomes: { grassland: { density: 0 } } } });
  const f5HiddenOk = JSON.parse(f5()).every(a => a.length === 0);

  window._fieldTuning.set({ f2: {}, f3: {}, f4: {}, f5: { biomes: { grassland: { size: 2 } } } });
  const f5Big = JSON.parse(f5());
  let f5DoubleOk = true, f5Pairs = 0;
  for (let i = 0; i < baseF5.length; i++) {
    for (let j = 0; j < baseF5[i].length; j++) {
      f5Pairs++;
      if (Math.abs(f5Big[i][j][2] - baseF5[i][j][2] * 2) > 1e-6) f5DoubleOk = false;
    }
  }

  window._fieldTuning.set({ f2: {}, f3: {}, f4: {}, f5: { biomes: { grassland: { states: { enchanted: 1 } } } } });
  const f5EnchOk = JSON.parse(f5()).every(a => a.every(p => p[3] === 'enchanted'));

  window._fieldTuning.set({ f2: {}, f3: {}, f4: {}, f5: {} }); // restore
```

Add to the probe's pass/fail reporting: `registryOk`, `f5Count > 0`, `f5HiddenOk`, `f5DoubleOk && f5Pairs > 0`, `f5EnchOk` — each printed and folded into the exit code like the existing checks.

- [ ] **Step 3: Run the probe against a worktree server**

```bash
cd "C:/Users/daves/AppData/Roaming/wizardgenie/projects/f5-wiring"
npx http-server -p 8742 -c-1 --silent . &   # background; main checkout owns :8741
sleep 3
PROBE_PORT=8742 node scripts/probe-field-tuning.mjs
```
Expected: all checks pass, including the five new ones.

- [ ] **Step 4: Run the F2/F3 visual regression probes against the worktree**

These hardcode `:8741`; run them with a one-line env override the same way (apply the identical `PROBE_PORT` pattern to `scripts/probe-f2-visual.mjs` and `scripts/probe-f3-visual.mjs` — replace their hardcoded `8741` URL with the `PORT` const shown in Step 1):

```bash
PROBE_PORT=8742 node scripts/probe-f3-visual.mjs
PROBE_PORT=8742 node scripts/probe-f2-visual.mjs
```
Expected: both PASS (F5 must not regress F2/F3 rendering; F4-yields-to-F5 changes a few F4 placements — the F3 probe hashes chunk bitmaps which exclude F4/F5, so it must pass unchanged; the F2 probe freezes lighting and compares its own baseline within the run, so it is self-consistent).

- [ ] **Step 5: Full unit suite + commit**

```bash
node --test test/field-tuning.test.js test/decoration-claims-f5.test.js
node --test sim/test/*.test.js
git add scripts/probe-field-tuning.mjs scripts/probe-f2-visual.mjs scripts/probe-f3-visual.mjs
git commit -m "test(f5): field-tuning probe covers f5 density/size/state-mix + registry order; probes take PROBE_PORT"
```

---

### Task 8: Merge to master

- [ ] **Step 1: Final check on the branch**

```bash
cd "C:/Users/daves/AppData/Roaming/wizardgenie/projects/f5-wiring"
git status            # clean
git log --oneline master..f5-field-registry   # the ~7 commits above
```

- [ ] **Step 2: Merge (master may have moved — other agents merge too)**

```bash
git switch master     # works: no other worktree has master checked out
git merge f5-field-registry
node --test test/field-tuning.test.js test/decoration-claims-f5.test.js  # re-run on the merge result
git switch f5-field-registry   # leave master free for other agents
```
If the merge conflicts (parallel sessions land on master constantly), resolve favoring both sides' intent — F5 changes are additive and isolated to the files listed in this plan. Re-run the unit tests after resolving.

- [ ] **Step 3: Tell the user how to test**

The user's playable checkout is `projects\default` (dev server on :8741). To get the F5 build there, that checkout must be switched to master (coordinate — other agents work in that dir). The F5 assets already exist there untracked, so sprites load immediately. In-game: backtick → F5 tab → calibrate size/density/state mixes per biome; grassland teleport spot x=1312 y=1312.

---

## Out of scope (per spec)

- Player collision with F5 footprints (object-permanence kernel work).
- F5 anim playback (gate is wired; playback lands when `anim/` dirs exist and the catalog regenerates).
- F6/F7 wiring (one registry entry each, later).
- Baking the user's calibrated Copy-JSON values into source defaults (follow-up after the calibration session).
