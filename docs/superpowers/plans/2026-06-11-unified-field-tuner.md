# Unified Field Tuner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One in-game overlay (backtick key) that tunes size and density of every F2/F3/F4 decoration object — down to per-variant size ranges — plus per-object animation-category toggles (wind_sway, player_walk), multiplying down a master × biome × object × variant tree, with localStorage persistence and Copy-JSON export.

**Architecture:** New pure module `src/world/field-tuning.js` holds the tuning tree + resolvers (`tuneSize`, `tuneBiomeDensity`, `tuneObjDensity`). Placement code calls the resolvers where hardcoded constants live today; defaults (all 1.0) are byte-identical to current behavior because `rand2` is stateless. F3 is painted by chunk workers, so the tree is postMessage'd to workers and chunk bitmaps are invalidated (existing repaint path repaints them). New UI `src/dev/field-tuner.js` replaces `src/dev/f4-tuner.js`.

**Tech Stack:** Vanilla ES modules, `rand2` deterministic hash (src/core/random.js), node:test for unit tests, playwright-core headless probe for integration.

**Spec:** `docs/superpowers/specs/2026-06-11-unified-field-tuner-design.md`

**Branch note:** The repo checkout is shared with a parallel session (currently on `pass1c-simulation-lod`). Before Task 1, check `git branch --show-current`; create/switch to a `field-tuner` branch off `master` ONLY if no other session is mid-work — if unsure, ask the user. Untracked asset directories are unaffected by branch switches.

**Determinism invariant (applies to every task):** never change existing `rand2` salt usage. New rolls use NEW salts only: F2 → 7400+bi (object density), 7600+bi*4 (size); F3 → 9570+oi*4 (size); F4 → 9714 (object density), 9720 (size). `rand2` is a pure function of (x, y, salt), so adding calls never shifts existing rolls.

---

### Task 1: field-tuning.js resolver module (TDD)

**Files:**
- Create: `src/world/field-tuning.js`
- Test: `test/field-tuning.test.js` (new dir `test/` at repo root)

- [ ] **Step 1: Write the failing test**

```js
// test/field-tuning.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_TUNING, setFieldTuning, tuneSize, tuneBiomeDensity, tuneObjDensity } from '../src/world/field-tuning.js';

test('defaults are all 1.0', () => {
  setFieldTuning(null);
  assert.equal(tuneSize('f3', 'grassland', 'field_stone', 4, 10, 20, 9570), 1);
  assert.equal(tuneBiomeDensity('f3', 'grassland'), 1);
  assert.equal(tuneObjDensity('f3', 'grassland', 'field_stone'), 1);
});

test('size multiplies master x biome x object x variant', () => {
  setFieldTuning({ f4: { size: 2, biomes: { taiga: { size: 0.5, objects: {
    snow_fern: { size: 3, variants: { 7: { size: 0.25 } } } } } } } });
  // 2 * 0.5 * 3 * 0.25 = 0.75
  assert.ok(Math.abs(tuneSize('f4', 'taiga', 'snow_fern', 7, 5, 5, 9720) - 0.75) < 1e-9);
  // unknown variant: 2 * 0.5 * 3 = 3
  assert.ok(Math.abs(tuneSize('f4', 'taiga', 'snow_fern', 8, 5, 5, 9720) - 3) < 1e-9);
  // unknown object: 2 * 0.5 = 1
  assert.ok(Math.abs(tuneSize('f4', 'taiga', 'other', 0, 5, 5, 9720) - 1) < 1e-9);
});

test('size range rolls deterministically within [min,max]', () => {
  setFieldTuning({ f2: { biomes: { grassland: { objects: {
    tall_grass_blade: { variants: { 3: { sizeMin: 0.8, sizeMax: 1.2 } } } } } } } });
  const a = tuneSize('f2', 'grassland', 'tall_grass_blade', 3, 100, 200, 7600);
  const b = tuneSize('f2', 'grassland', 'tall_grass_blade', 3, 100, 200, 7600);
  assert.equal(a, b); // same coords + salt -> same roll
  assert.ok(a >= 0.8 && a <= 1.2);
  const c = tuneSize('f2', 'grassland', 'tall_grass_blade', 3, 101, 200, 7600);
  assert.notEqual(a, c); // different tile -> (almost surely) different roll
});

test('density: biome part and object part are separate', () => {
  setFieldTuning({ f3: { density: 2, biomes: { desert: { density: 0.5, objects: {
    bleached_bone: { density: 0.25 } } } } } });
  assert.equal(tuneBiomeDensity('f3', 'desert'), 1);      // 2 * 0.5
  assert.equal(tuneObjDensity('f3', 'desert', 'bleached_bone'), 0.25);
  assert.equal(tuneObjDensity('f3', 'desert', 'other'), 1);
});

test('setFieldTuning replaces tree and live-binding updates', () => {
  setFieldTuning({ f4: { size: 5 } });
  assert.equal(FIELD_TUNING.f4.size, 5);
  setFieldTuning(null);
  assert.deepEqual(FIELD_TUNING, { f2: {}, f3: {}, f4: {} });
});

test('anim categories default enabled, disable per object x category', () => {
  setFieldTuning({ f2: { biomes: { forest: { objects: {
    tree_stump: { anims: { wind_sway: false } } } } } } });
  assert.equal(tuneAnimEnabled('f2', 'forest', 'tree_stump', 'wind_sway'), false);
  assert.equal(tuneAnimEnabled('f2', 'forest', 'tree_stump', 'player_walk'), true);
  assert.equal(tuneAnimEnabled('f2', 'forest', 'fern_patch', 'wind_sway'), true);
  assert.equal(tuneAnimEnabled('f4', 'forest', 'tree_stump', 'wind_sway'), true);
  setFieldTuning(null);
  assert.equal(tuneAnimEnabled('f2', 'forest', 'tree_stump', 'wind_sway'), true);
});
```

(Also add `tuneAnimEnabled` to the import line at the top of the test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/field-tuning.test.js`
Expected: FAIL — cannot find module `../src/world/field-tuning.js`

- [ ] **Step 3: Write the implementation**

```js
// src/world/field-tuning.js
// Runtime tuning tree for decoration fields (F2 small flora, F3 small
// scatter, F4 medium flora). Size and density multipliers combine
// MULTIPLICATIVELY down the tree: master (field) x biome x object x variant.
// Missing node = 1.0, so an empty tree is byte-identical to baked defaults.
// Pure + deterministic — safe to import from chunk workers.
//
// Tree shape (all keys optional):
// { f2: { size, density, biomes: { grassland: { size|sizeMin+sizeMax, density,
//     objects: { tall_grass_blade: { size|sizeMin+sizeMax, density,
//       variants: { 3: { size|sizeMin+sizeMax } } } } } } }, f3: {...}, f4: {...} }
// Density stops at object level (variants keep their catalog weights).
import { rand2 } from '../core/random.js';

export var FIELD_TUNING = { f2: {}, f3: {}, f4: {} };

export function setFieldTuning(tree) {
  FIELD_TUNING = tree && typeof tree === 'object'
    ? { f2: tree.f2 || {}, f3: tree.f3 || {}, f4: tree.f4 || {} }
    : { f2: {}, f3: {}, f4: {} };
}

// One node's size contribution. Range nodes roll deterministically from the
// tile coords + salt (stable across frames/reloads — same hash as placement).
function nodeSize(node, wx, wy, salt) {
  if (!node) return 1;
  if (node.sizeMin != null && node.sizeMax != null) {
    if (node.sizeMax <= node.sizeMin) return node.sizeMin;
    return node.sizeMin + rand2(wx, wy, salt) * (node.sizeMax - node.sizeMin);
  }
  return node.size != null ? node.size : 1;
}

// master x biome x object x variant size multiplier for one placement.
// salt, salt+1, salt+2 are consumed for biome/object/variant range rolls.
export function tuneSize(field, biome, obj, variant, wx, wy, salt) {
  var f = FIELD_TUNING[field];
  if (!f) return 1;
  var s = f.size != null ? f.size : 1;
  var b = f.biomes && f.biomes[biome];
  if (!b) return s;
  s *= nodeSize(b, wx, wy, salt);
  var o = b.objects && b.objects[obj];
  if (!o) return s;
  s *= nodeSize(o, wx, wy, salt + 1);
  var v = o.variants && o.variants[variant];
  if (v) s *= nodeSize(v, wx, wy, salt + 2);
  return s;
}

// master x biome density multiplier (applies to whole-tile counts/chances).
export function tuneBiomeDensity(field, biome) {
  var f = FIELD_TUNING[field];
  if (!f) return 1;
  var d = f.density != null ? f.density : 1;
  var b = f.biomes && f.biomes[biome];
  if (b && b.density != null) d *= b.density;
  return d;
}

// Object-level density multiplier ONLY (biome/master part excluded so callers
// that already applied tuneBiomeDensity to a tile-level roll don't double it).
export function tuneObjDensity(field, biome, obj) {
  var f = FIELD_TUNING[field];
  if (!f) return 1;
  var b = f.biomes && f.biomes[biome];
  var o = b && b.objects && b.objects[obj];
  return o && o.density != null ? o.density : 1;
}

// Per-object, per-category animation toggle. Categories today: 'wind_sway'
// (consumed by field2-animator) and 'player_walk' (generated on disk;
// renderer wiring pending). Missing node/key = enabled (true).
export function tuneAnimEnabled(field, biome, obj, category) {
  var f = FIELD_TUNING[field];
  var b = f && f.biomes && f.biomes[biome];
  var o = b && b.objects && b.objects[obj];
  return !(o && o.anims && o.anims[category] === false);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/field-tuning.test.js`
Expected: PASS, 6 tests. (If `src/core/random.js` pulls in a browser-only import chain via `world-seed.js`, the test will throw on import — in that case read those two files; they are expected to be pure JS with no DOM access, fix is NOT needed unless proven otherwise.)

- [ ] **Step 5: Commit**

```bash
git add src/world/field-tuning.js test/field-tuning.test.js
git commit -m "feat(tuner): field-tuning module — multiplicative size/density tree with deterministic range rolls"
```

---

### Task 2: Worker + provider plumbing (F3 lives in chunk bitmaps)

**Files:**
- Modify: `src/world/chunk-worker.js` (imports at top; message handler ~line 203)
- Modify: `src/world/chunk-provider.js` (add method after `initPreload`, ~line 60)

- [ ] **Step 1: Add tuning handler to the worker**

In `src/world/chunk-worker.js`, extend the imports (after line 6):

```js
import { setFieldTuning } from '../world/field-tuning.js';
import { clearClaimCaches } from '../world/decoration-claims.js';
```

(Note: chunk-worker.js lives in `src/world/`, so the paths are `./field-tuning.js` and `./decoration-claims.js` — use:)

```js
import { setFieldTuning } from './field-tuning.js';
import { clearClaimCaches } from './decoration-claims.js';
```

In `self.onmessage` (line 203), add as the FIRST branch, before `if (data.type === 'preloadBiomes')`:

```js
  if (data.type === 'setFieldTuning') {
    setFieldTuning(data.tuning);
    clearClaimCaches(); // F3 placements/masks derive from the tree
    return;
  }
```

- [ ] **Step 2: Add applyFieldTuning to ChunkProvider**

In `src/world/chunk-provider.js`, add this method right after `initPreload` (after line 60):

```js
  // Push the field-tuning tree to every worker. When repaintChunks is true
  // (F3 edits — F3 is baked into chunk bitmaps), drop all bitmaps; pumpQueue
  // already repaints any ready chunk that lacks a bitmap.
  applyFieldTuning(tuning, repaintChunks) {
    for (const worker of this.workers) {
      worker.postMessage({ type: 'setFieldTuning', tuning });
    }
    if (repaintChunks) {
      for (const bmp of this.bitmaps.values()) bmp.close();
      this.bitmaps.clear();
      if (this._repaintPending) this._repaintPending.clear();
      this.schedulePump();
    }
  }
```

(postMessage is FIFO per worker, so the tuning message always lands before the repaint requests that pumpQueue sends afterwards.)

- [ ] **Step 3: Sanity check — game still boots**

Run: `node --test test/field-tuning.test.js` (still green), then load `http://localhost:8741/` in a browser or run the Task 7 probe's "defaults" step early if convenient. Terrain must render exactly as before.

- [ ] **Step 4: Commit**

```bash
git add src/world/chunk-worker.js src/world/chunk-provider.js
git commit -m "feat(tuner): worker tuning sync + bitmap invalidation path for F3 repaints"
```

---

### Task 3: F3 hook in f3Placements

**Files:**
- Modify: `src/world/decoration-claims.js:363-411` (`f3Placements`), import at top

- [ ] **Step 1: Import the resolvers**

At the top of `src/world/decoration-claims.js` (after line 7):

```js
import { tuneSize, tuneBiomeDensity, tuneObjDensity } from './field-tuning.js';
```

- [ ] **Step 2: Apply density + size in the placement loop**

In `f3Placements`, replace these lines (currently ~376-386):

```js
    var sparsity = obj.sparsity || 0.93;
    if (rand2(wx, wy, 9500 + oi) > (1.0 - sparsity)) continue; // SAME seeds as today
    var scale = obj.scale || 0.32;
    var ux = 0.5 + (rand2(wx, wy, 9520 + oi) - 0.5) * 0.6;     // tile units
    var uy = 0.5 + (rand2(wx, wy, 9530 + oi) - 0.5) * 0.6;
```

with:

```js
    var sparsity = obj.sparsity || 0.93;
    // Density tuning scales the acceptance probability (same roll/seed as today)
    var dMul = tuneBiomeDensity('f3', t.biome) * tuneObjDensity('f3', t.biome, obj.name);
    if (rand2(wx, wy, 9500 + oi) > (1.0 - sparsity) * dMul) continue; // SAME seeds as today
    // Variant must be known before size (per-variant tuning) — same roll as before
    var variant = allowed
      ? allowed[Math.floor(rand2(wx, wy, 9510 + oi) * allowed.length)]
      : Math.floor(rand2(wx, wy, 9510 + oi) * SS_VARIANT_COUNT);
    var scale = (obj.scale || 0.32) *
      tuneSize('f3', t.biome, obj.name, variant, wx, wy, 9570 + oi * 4);
    var ux = 0.5 + (rand2(wx, wy, 9520 + oi) - 0.5) * 0.6;     // tile units
    var uy = 0.5 + (rand2(wx, wy, 9530 + oi) - 0.5) * 0.6;
```

Then in the `p = { ... }` object literal a few lines below, replace the `variant:` ternary with the precomputed value:

```js
      variant: variant,
```

(The footprint fields `bx/by/fw/fh` already derive from `drawPx = TILE_ART_PX * scale`, so claims scale automatically — no further change.)

- [ ] **Step 3: Verify defaults unchanged**

Run: `node --test test/field-tuning.test.js` (green). The variant roll uses the identical expression and seed (9510 + oi) as before, just hoisted — placements with an empty tree are byte-identical.

- [ ] **Step 4: Commit**

```bash
git add src/world/decoration-claims.js
git commit -m "feat(tuner): F3 placements consume size/density tuning (salts 9570+)"
```

---

### Task 4: F4 hook in f4Placements

**Files:**
- Modify: `src/world/decoration-claims.js:478-520` (`f4Placements`)

- [ ] **Step 1: Apply tuning**

In `f4Placements`, replace (currently ~485-489):

```js
  var chance = F4_TILE_CHANCE[t.biome] || 0;
  if (!objs || !objs.length || chance === 0) return cachePut(_f4Cache, key, EMPTY);
  if (rand2(wx, wy, 9700) > chance) return cachePut(_f4Cache, key, EMPTY);

  var obj = objs[Math.floor(rand2(wx, wy, 9701) * objs.length)];
```

with:

```js
  var chance = (F4_TILE_CHANCE[t.biome] || 0) * tuneBiomeDensity('f4', t.biome);
  if (!objs || !objs.length || chance === 0) return cachePut(_f4Cache, key, EMPTY);
  if (rand2(wx, wy, 9700) > chance) return cachePut(_f4Cache, key, EMPTY);

  var obj = objs[Math.floor(rand2(wx, wy, 9701) * objs.length)];
  // Object-level density: <1 rejects this tile's pick (1 placement/tile max,
  // so >1 cannot add more — clamped by construction). NEW salt 9714.
  var objD = tuneObjDensity('f4', t.biome, obj.name);
  if (objD < 1 && rand2(wx, wy, 9714) > objD) return cachePut(_f4Cache, key, EMPTY);
```

Then replace (currently ~507):

```js
  var scale = F4_BIOME_SCALE[t.biome] || 1.0;
```

with:

```js
  var scale = (F4_BIOME_SCALE[t.biome] || 1.0) *
    tuneSize('f4', t.biome, obj.name, variant, wx, wy, 9720);
```

(`variant` is already computed above this line. `sizeTiles`, `drawPx`, and the footprint all derive from `scale` — claims and F2-blade culling scale automatically.)

- [ ] **Step 2: Verify defaults unchanged**

With an empty tree both new factors are 1 and the `objD < 1` branch never rolls — no rand2 stream changes. Run: `node --test test/field-tuning.test.js` (green).

- [ ] **Step 3: Commit**

```bash
git add src/world/decoration-claims.js
git commit -m "feat(tuner): F4 placements consume size/density tuning (salts 9714, 9720)"
```

---

### Task 5: F2 hook in buildTileDescriptor

**Files:**
- Modify: `src/render/field2-animator.js` (import at top; `buildTileDescriptor` ~lines 634-757)

- [ ] **Step 1: Import**

Add to the imports at the top of `src/render/field2-animator.js`:

```js
import { tuneSize, tuneBiomeDensity, tuneObjDensity, tuneAnimEnabled } from '../world/field-tuning.js';
```

- [ ] **Step 2: Biome-level density**

Right after the `baseDensity`/`tileChance` if-chain ends (after the `beach` branch, currently line 648) and BEFORE the `if (tileChance < 1.0 && rand2(wx, wy, 6999) > tileChance)` check, insert:

```js
  // F2 biome density tuning: sparse biomes (tileChance<1) scale the tile
  // chance; dense biomes scale the blade count. Default 1.0 = no change.
  var f2bd = tuneBiomeDensity('f2', biome);
  if (f2bd !== 1) {
    if (tileChance < 1.0) tileChance = Math.min(1, tileChance * f2bd);
    else baseDensity = Math.max(0, Math.round(baseDensity * f2bd));
  }
```

- [ ] **Step 3: Object-level density (per blade)**

Inside the blade loop, right after the `cold_moss_tuft` override block (currently ends line 679, `objName = objects[0]; }`) and BEFORE `var variantWl = sfVariantsFor(...)`, insert:

```js
    // Object-level density: <1 culls this blade (NEW salt 7400+bi)
    var f2od = tuneObjDensity('f2', biome, objName);
    if (f2od < 1 && rand2(wx, wy, 7400 + bi) > f2od) continue;
```

- [ ] **Step 4: Size (per blade, after variant + lifecycle known)**

Right after the lifecycle `if/else if` chain that sets `lifeScale` (currently ends line 709, after the `dead` branch), insert:

```js
    // Size tuning folds into lifecycle scale (NEW salts 7600+bi*4..+2)
    lifeScale *= tuneSize('f2', biome, objName, variantIdx, wx, wy, 7600 + bi * 4);
```

- [ ] **Step 5: Anim toggles — F2 wind_sway gate**

In `buildTileDescriptor`, line ~727 currently reads:

```js
    var animWl = sfAnimVariantsFor(biome, objName);
    var animAvail = !animWl || animWl.indexOf(variantIdx) !== -1;
```

Replace the second line with:

```js
    var animAvail = (!animWl || animWl.indexOf(variantIdx) !== -1)
      && tuneAnimEnabled('f2', biome, objName, 'wind_sway');
```

(`animAvail === false` makes `animUrlBase` null a few lines down → static sprite drawn, wind_sway frames never load. The `player_walk` category has no renderer consumer yet — its toggle is stored in the tree and exported; it gates generation and will gate the walk-disturbance renderer when that lands.)

- [ ] **Step 6: Anim toggles — F4 wind_sway gate**

In the F4 blade-building loop (~line 608), replace:

```js
      animUrlBase: (!fp.state && fp.hasAnim) ? f4AnimUrlBase(fp) : null,
```

with:

```js
      animUrlBase: (!fp.state && fp.hasAnim
        && tuneAnimEnabled('f4', fp.biome, fp.name, 'wind_sway')) ? f4AnimUrlBase(fp) : null,
```

- [ ] **Step 7: Verify defaults unchanged + commit**

Empty tree: `f2bd === 1` skips both branches, `f2od < 1` never rolls, `tuneSize` returns 1, `tuneAnimEnabled` returns true. No existing salt usage touched.

```bash
git add src/render/field2-animator.js
git commit -m "feat(tuner): F2/F4 blades consume size/density tuning + per-object anim toggles"
```

---

### Task 6: Unified tuner UI, main.js wiring, delete f4-tuner

**Files:**
- Create: `src/dev/field-tuner.js`
- Modify: `src/main.js:58` (swap tuner import) and add `window._player`
- Delete: `src/dev/f4-tuner.js`
- Modify: `src/world/decoration-claims.js:29-33` (remove now-unused `setF4BiomeScale`)

- [ ] **Step 1: Create src/dev/field-tuner.js**

```js
// Unified dev tuner for decoration fields F2/F3/F4 (F5 joins when its
// placement lands). Toggle with backtick (`). Tree: field tabs -> current
// biome -> collapsible object rows -> variant rows. Size + density combine
// multiplicatively (see src/world/field-tuning.js). Edits persist in
// localStorage ('fieldTuning'); "copy JSON" exports the tree for baking
// into source defaults, after which localStorage should be cleared.
import { setFieldTuning } from '../world/field-tuning.js';
import { clearClaimCaches, SS_BIOME_OBJECTS, ssAllowedVariants } from '../world/decoration-claims.js';
import { MF_CATALOG } from '../world/mf-catalog.js';
import { SF_BIOME_OBJECTS_LIST, SF_VARIANT_COUNT, sfVariantsFor } from '../render/wang-image-list.js';
import { clearF2TileDescriptors } from '../render/field2-animator.js';

var LS_KEY = 'fieldTuning';
var FIELDS = ['f2', 'f3', 'f4'];
var FIELD_LABEL = { f2: 'F2 small flora', f3: 'F3 small scatter', f4: 'F4 medium flora' };
var FIELD_PATH = { f2: 'micro/small_flora', f3: 'micro/small_scatter', f4: 'micro/medium_flora' };

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

var TREE = { f2: {}, f3: {}, f4: {} };
var activeField = 'f4';
var expanded = {};   // 'field/biome/obj' -> true (variant rows visible)
var checked = {};    // rowKey 'field/biome/obj' or 'field/biome/obj/v' -> true

function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }

// Enumerate { name, variants[] } for a field+biome from the live catalogs.
function objectsFor(field, biome) {
  if (field === 'f2') {
    return (SF_BIOME_OBJECTS_LIST[biome] || []).map(function (n) {
      return { name: n, variants: sfVariantsFor(biome, n) || range(SF_VARIANT_COUNT) };
    });
  }
  if (field === 'f3') {
    return (SS_BIOME_OBJECTS[biome] || []).map(function (o) {
      var allowed = ssAllowedVariants(biome, o.name);
      return { name: o.name, variants: allowed || range(64), disabled: allowed && allowed.length === 0 };
    });
  }
  return (MF_CATALOG[biome] || []).map(function (o) {
    return { name: o.name, variants: range(o.variants) };
  });
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

// Apply live: rebuild placement caches; for F3 also resync workers + repaint
// chunk bitmaps (F3 is baked into them). Always pushes the tree to workers so
// they stay in sync for newly compiled chunks.
function apply(field) {
  setFieldTuning(TREE);
  save();
  clearClaimCaches();
  clearF2TileDescriptors();
  var prov = window._debugProvider;
  if (prov && prov.applyFieldTuning) prov.applyFieldTuning(TREE, field === 'f3');
}

function currentBiome() {
  var p = window._player, cs = window._dbgChunkStore;
  if (!p || !cs) return null;
  var t = cs.tileAt(Math.floor(p.x), Math.floor(p.y));
  return t ? t.biome : null;
}

var panel = null, body = null;

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
    apply(field);
  }));
  row.appendChild(val);
  return row;
}

// Variant row: min/max size range inputs + effective readout.
function variantRow(field, biome, objName, v) {
  var key = field + '/' + biome + '/' + objName + '/' + v;
  var row = el('div', 'display:flex;align-items:center;gap:4px;margin:1px 0 1px 18px');
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

function rebuild() {
  if (!panel) return;
  body.textContent = '';
  var field = activeField;
  var biome = currentBiome();

  // --- header: biome name + teleport + master/biome rows ---
  var head = el('div', 'margin-bottom:6px');
  head.appendChild(el('div', 'color:#ffd97a;font-weight:bold', FIELD_LABEL[field] + ' — biome: ' + (biome || '?')));
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
  objectsFor(field, biome).forEach(function (o) {
    var key = field + '/' + biome + '/' + o.name;
    var wrap = el('div', 'border-top:1px solid #243250;padding:2px 0' + (o.disabled ? ';opacity:0.4' : ''));
    var row = tuneRow(o.name, '#cfe0ff', key, function () { return node(field, biome, o.name); }, 'size', 0.25, 2.0, field);
    // expand arrow + path + density on a second line
    var arrow = el('span', 'cursor:pointer;color:#7ea0d0;margin-left:4px', expanded[key] ? '▾' : '▸');
    arrow.onclick = function () { expanded[key] = !expanded[key]; rebuild(); };
    row.appendChild(arrow);
    wrap.appendChild(row);
    wrap.appendChild(tuneRow('  density', '#9fb6dd', null, function () { return node(field, biome, o.name); }, 'density', 0, 3.0, field));
    // Per-category animation toggles (F2/F4 only — F3 has no anims).
    // Categories: wind_sway (live in renderer) + player_walk (generated on
    // disk; gates future renderer wiring + generation). Unchecked = disabled.
    if (field !== 'f3') {
      var animRow = el('div', 'display:flex;align-items:center;gap:8px;margin:1px 0 1px 18px;color:#9fb6dd');
      animRow.appendChild(el('span', '', 'anim:'));
      [['wind_sway', 'wind'], ['player_walk', 'walk']].forEach(function (pair) {
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
    var path = el('div', 'color:#5e729a;font-size:10px;margin-left:18px', FIELD_PATH[field] + '/' + biome + '/' + o.name + '  (' + o.variants.length + ' variants, eff ' + effSize(field, biome, o.name).toFixed(2) + ')');
    wrap.appendChild(path);
    if (expanded[key]) {
      o.variants.forEach(function (v) { wrap.appendChild(variantRow(field, biome, o.name, v)); });
    }
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
    TREE = { f2: {}, f3: {}, f4: {} };
    checked = {};
    apply('f3'); // worst case: repaint chunks too
    rebuild();
  };
  foot.appendChild(copy); foot.appendChild(reset);
  body.appendChild(foot);
}

function buildPanel() {
  panel = el('div',
    'position:fixed;top:48px;right:8px;z-index:9999;background:rgba(10,14,24,0.92);' +
    'color:#cfe0ff;font:12px monospace;padding:8px 10px;border:1px solid #3a4a6a;' +
    'border-radius:6px;max-height:70vh;display:flex;flex-direction:column;width:360px');
  var tabs = el('div', 'display:flex;gap:4px;margin-bottom:6px');
  FIELDS.forEach(function (f) {
    var b = el('button', 'font:12px monospace;cursor:pointer;flex:1', f.toUpperCase());
    b.onclick = function () { activeField = f; rebuild(); };
    tabs.appendChild(b);
  });
  panel.appendChild(tabs);
  body = el('div', 'overflow-y:auto;flex:1');
  panel.appendChild(body);
  document.body.appendChild(panel);
  rebuild();
}

export function initFieldTuner() {
  // Old F4 tuner key is obsolete — its values were baked into F4_BIOME_SCALE
  // source on 2026-06-11. Remove so stale absolutes can't confuse anyone.
  try { localStorage.removeItem('f4BiomeScale'); } catch (e) { /* private mode */ }
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved) TREE = { f2: saved.f2 || {}, f3: saved.f3 || {}, f4: saved.f4 || {} };
  } catch (e) { /* corrupt -> defaults */ }
  setFieldTuning(TREE);
  // If saved F3 tuning exists, workers must get it before painting chunks.
  var hasF3 = TREE.f3 && (TREE.f3.size != null || TREE.f3.density != null || TREE.f3.biomes);
  var prov = window._debugProvider;
  if (prov && prov.applyFieldTuning) prov.applyFieldTuning(TREE, false);
  if (hasF3) clearClaimCaches();

  window._fieldTuning = { tree: function () { return TREE; }, set: function (t) { TREE = t; apply('f3'); }, apply: apply };

  window.addEventListener('keydown', function (e) {
    if (e.key !== '`' || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (!panel) { buildPanel(); return; }
    var hidden = panel.style.display === 'none';
    panel.style.display = hidden ? '' : 'none';
    if (hidden) rebuild(); // refresh biome on reopen
  });
}
```

- [ ] **Step 2: Wire main.js**

In `src/main.js`, replace line 58:

```js
import('./dev/f4-tuner.js').then(m => m.initF4Tuner()); // F4 size sliders (key '4')
```

with:

```js
import('./dev/field-tuner.js').then(m => m.initFieldTuner()); // field tuner (key `)
```

And after line 24 (`const player = new Player(...)`), add:

```js
window._player = player; // dev/tuner hook: current position -> current biome
```

- [ ] **Step 3: Delete the old tuner + dead export**

```bash
git rm src/dev/f4-tuner.js
```

In `src/world/decoration-claims.js`, delete the now-unused `setF4BiomeScale` (lines 29-33):

```js
export function setF4BiomeScale(biome, s) {
  F4_BIOME_SCALE[biome] = s;
  _f4Cache.clear();
  _maskCache.clear(); // footprints changed -> claim masks must rebuild
}
```

Verify nothing else imports it: `grep -rn "setF4BiomeScale" src/` must return only nothing (the old comment block above `F4_BIOME_SCALE` mentioning the '4' key panel should be updated to reference the field tuner / backtick key).

- [ ] **Step 4: Manual smoke**

Load the game (dev server serves the working tree live), press backtick: panel opens with F2/F3/F4 tabs, current biome shown, objects enumerated with paths. Drag an F4 biome size slider — plants resize live. Drag F3 density to 0 — scatter disappears as chunks repaint. Press backtick again — panel hides.

- [ ] **Step 5: Commit**

```bash
git add src/dev/field-tuner.js src/main.js src/world/decoration-claims.js
git commit -m "feat(tuner): unified F2/F3/F4 tuner UI (backtick) — per-object/per-variant size+density, replaces f4-tuner"
```

---

### Task 7: Headless integration probe (regression + behavior)

**Files:**
- Modify: `src/main.js:34-47` (expose f4Placements in the `_claims` debug object)
- Create: `scripts/probe-field-tuning.mjs`

- [ ] **Step 1: Expose f4 placements for probing**

In `src/main.js`, inside the `import('./world/decoration-claims.js').then(...)` block, add after the `placements:` entry (line 44):

```js
    f4: function (wx, wy) { return m.f4Placements(wx, wy, function (x, y) {
      var t = window._dbgChunkStore && window._dbgChunkStore.tileAt(x, y);
      return t ? { biome: t.biome, transition: !!t.transitionPair } : null; }); },
```

- [ ] **Step 2: Write the probe**

```js
// scripts/probe-field-tuning.mjs — field-tuning integration probe.
// Asserts: (1) empty tree -> placements identical before/after a tuner
// round-trip; (2) density 0 hides an F3 biome; (3) F4 size x2 doubles
// sizeTiles. Run with the dev server up on :8741.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
// grassland teleport spot (tiles guaranteed loaded around the player)
await page.goto('http://localhost:8741/?x=1312&y=1312', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._claims && window._fieldTuning && window._dbgChunkStore
  && window._dbgChunkStore.tileAt(1312, 1312), null, { timeout: 60000 });
await page.waitForTimeout(2000); // let nearby chunks finish

const res = await page.evaluate(() => {
  const sample = (fn) => {
    const out = [];
    for (let wy = 1300; wy < 1325; wy++)
      for (let wx = 1300; wx < 1325; wx++)
        out.push(fn(wx, wy));
    return JSON.stringify(out);
  };
  const f3 = () => sample((x, y) => window._claims.placements(x, y).map(p => [p.name, p.variant, +p.scale.toFixed(4)]));
  const f4 = () => sample((x, y) => window._claims.f4(x, y).map(p => [p.name, p.variant, +p.sizeTiles.toFixed(4)]));

  const baseF3 = f3(), baseF4 = f4();

  // (2) F3 grassland density 0 -> no placements
  window._fieldTuning.set({ f2: {}, f3: { biomes: { grassland: { density: 0 } } }, f4: {} });
  const f3Hidden = f3();
  const hiddenOk = JSON.parse(f3Hidden).every(a => a.length === 0);

  // (3) F4 grassland size 2x -> every sizeTiles doubles
  window._fieldTuning.set({ f2: {}, f3: {}, f4: { biomes: { grassland: { size: 2 } } } });
  const f4Big = JSON.parse(f4()), f4Base = JSON.parse(baseF4);
  let doubleOk = true, pairs = 0;
  for (let i = 0; i < f4Base.length; i++) {
    for (let j = 0; j < f4Base[i].length; j++) {
      pairs++;
      if (Math.abs(f4Big[i][j][2] - f4Base[i][j][2] * 2) > 1e-3) doubleOk = false;
    }
  }

  // (1) reset -> byte-identical to baseline (regression gate)
  window._fieldTuning.set({ f2: {}, f3: {}, f4: {} });
  const resetOk = f3() === baseF3 && f4() === baseF4;

  return { hiddenOk, doubleOk, pairs, resetOk, f3Count: JSON.parse(baseF3).flat().length };
});
console.log(JSON.stringify(res));
await browser.close();
if (!res.hiddenOk || !res.doubleOk || !res.resetOk || res.pairs === 0 || res.f3Count === 0) {
  console.error('FIELD TUNING PROBE FAILED');
  process.exit(1);
}
console.log('FIELD TUNING PROBE PASSED');
```

- [ ] **Step 3: Run the probe**

Run: `node scripts/probe-field-tuning.mjs` (dev server must be serving the working tree on :8741)
Expected: `FIELD TUNING PROBE PASSED` with `hiddenOk:true, doubleOk:true, resetOk:true`, nonzero `pairs` and `f3Count`. If `pairs` is 0, widen the sample window — grassland F4 chance is 10%/tile so 625 tiles ≈ 60 placements.

- [ ] **Step 4: Run unit tests too**

Run: `node --test test/field-tuning.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/probe-field-tuning.mjs src/main.js
git commit -m "test(tuner): headless probe — density-0 hides F3, size x2 doubles F4, reset is byte-identical"
```

---

### Task 8: F2 visual verification + handoff

- [ ] **Step 1: Manual F2 check** — teleport to grassland, open tuner, F2 tab: set `tall_grass_blade` density to 0.3 (blades thin out), size to 1.8 (blades grow), then a variant range 0.5–1.5 on one variant (mixed sizes appear, stable on reload because rolls are seeded). Uncheck `wind` on `tall_grass_blade` — blades go static (no sway frames). Re-check — sway returns. Reset all.

- [ ] **Step 2: Tell the user** the tuner is live on F2/F3/F4 with the backtick key, and that "copy JSON" output should be pasted back for baking into source defaults (F4_BIOME_SCALE-style) once calibration is done.
