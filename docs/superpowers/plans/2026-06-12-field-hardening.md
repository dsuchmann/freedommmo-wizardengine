# Field Hardening + Tuner UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the F5/field review follow-ups (rand2 1.0 overflow, claim-scan radius vs extreme tuner scales, duplicated F5 anim URL, trigger-machinery churn, weak golden test), fix the F2 "extra decor" claim-cull bypass, make the backtick field-tuner panel scrollable with a side panel for expanded objects, and fix the user-reported F5 visual issues: downscale pixel loss, y-sort anchor on large objects, F5↔F5 / F4↔F5 footprint overlap, and F2 blades clipping F5 footprint edges.

**Deliberately out of scope (needs its own design pass):** diagonal/tilted objects (logs) — oriented footprints for layering and base-line-aware shadows. Single-scalar y-sort and the south-most-pixel shadow anchor cannot represent a diagonal base; the fix is per-variant base-line metadata (likely auto-derived from sprite alpha), which is a spec, not a patch.

**Architecture:** All changes live in the decoration-field stack: `src/core/random.js`, `src/world/decoration-claims.js`, `src/world/field-tuning.js`, `src/render/field2-animator.js`, `src/dev/field-tuner.js`. Determinism rules are sacred: never change the rand2 hash or any salt; clamps/guards must only affect the (previously broken) edge cases.

**Tech Stack:** Vanilla JS ES modules, `node --test` for units, headless probes (`PROBE_PORT=8742`) for visual regression. Worktree: `C:\Users\daves\AppData\Roaming\wizardgenie\projects\f5-wiring`, branch `field-hardening`.

**Test commands:**
- Units: `node --test test/field-tuning.test.js test/decoration-claims-f5.test.js test/random.test.js`
- Probes (worktree): `npx http-server -p 8742 -c-1 --silent . &` then `PROBE_PORT=8742 node scripts/probe-f2-visual.mjs` and `PROBE_PORT=8742 node scripts/probe-f3-visual.mjs` and `PROBE_PORT=8742 node scripts/probe-field-tuning.mjs`

---

## Task 1: `pickIndex` helper — clamp rand2 1.0 at array/variant index sites

`hash()` in `src/core/random.js:9` is `(n >>> 0) / 4294967295` and CAN return exactly 1.0 (when the mixed hash is 0xFFFFFFFF). Every `Math.floor(rand2(...) * n)` index site then yields `n` — out-of-bounds array read (undefined name → broken URL) or invalid variant number.

**Do NOT change the divisor** — that would re-roll every placement in every world. Clamp at the consumer.

**Files:**
- Modify: `src/core/random.js`
- Modify: `src/world/decoration-claims.js` (8 sites)
- Modify: `src/render/field2-animator.js` (3 sites)
- Test: `test/random.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/random.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickIndex } from '../src/core/random.js';

test('pickIndex maps [0,1) to 0..n-1 unchanged', () => {
  assert.equal(pickIndex(0, 5), 0);
  assert.equal(pickIndex(0.19, 5), 0);
  assert.equal(pickIndex(0.2, 5), 1);
  assert.equal(pickIndex(0.999999, 5), 4);
});

test('pickIndex clamps r === 1.0 to n-1', () => {
  assert.equal(pickIndex(1.0, 5), 4);
  assert.equal(pickIndex(1.0, 1), 0);
});
```

- [ ] **Step 2: Run it — expect FAIL** (`pickIndex` not exported): `node --test test/random.test.js`

- [ ] **Step 3: Implement.** In `src/core/random.js`, after `hash`:

```js
// Index pick from a [0,1] roll. hash() can return exactly 1.0 (mixed hash
// 0xFFFFFFFF); Math.floor(r*n) then overflows to n. Clamp — identical to the
// raw floor for every r < 1, so placement determinism is untouched.
export function pickIndex(r, n) {
  var i = Math.floor(r * n);
  return i >= n ? n - 1 : i;
}
```

- [ ] **Step 4: Run test — expect PASS.**

- [ ] **Step 5: Replace the 11 vulnerable sites.** Add `pickIndex` to the existing `'../core/random.js'` import in each file.

`src/world/decoration-claims.js` (line numbers as of branch tip):
- `:397-399` → `var variant = allowed ? allowed[pickIndex(rand2(wx, wy, 9510 + oi), allowed.length)] : pickIndex(rand2(wx, wy, 9510 + oi), SS_VARIANT_COUNT);`
- `:419` → `p.state = states[pickIndex(rand2(wx, wy, 9561 + oi), states.length)];`
- `:513` → `var obj = objs[pickIndex(rand2(wx, wy, 9701), objs.length)];`
- `:526` → `variant = obj.statePool[pickIndex(rand2(wx, wy, 9706), obj.statePool.length)];`
- `:529` → `variant = pickIndex(rand2(wx, wy, 9702), obj.variants);`
- `:578` → `var obj = objs[pickIndex(rand2(wx, wy, 9801), objs.length)];`
- `:585` → `var variant = pickIndex(rand2(wx, wy, 9802), obj.variants);`

`src/render/field2-animator.js`:
- `:729-731` → `var variantIdx = variantWl ? variantWl[pickIndex(rand2(wx, wy, 7035 + bi), variantWl.length)] : pickIndex(rand2(wx, wy, 7035 + bi), SF_VARIANT_COUNT);`
- `:814` → `url: extraObjs[pickIndex(rand2(wx, wy, 7301), extraObjs.length)],`

Do NOT touch `restFrame` sites — they're consumed through `% FRAME_COUNT`.

- [ ] **Step 6: Run all units + both visual probes — expect PASS / golden match** (identical output proves determinism preserved).

- [ ] **Step 7: Commit** — `fix(fields): clamp rand2-1.0 overflow at index sites via pickIndex`

---

## Task 2: F2 "extra decor" claim-cull bypass (seed 7300 bug)

Regular F2 blades are culled when their root lands in a claimed cell (`field2-animator.js:781-785`). The rare static decor objects (`SF_EXTRA_OBJECTS`, roll at `:812`) skip that check entirely — fish piles / snow sculptures spawn inside F3/F4/F5 footprints.

**Files:**
- Modify: `src/render/field2-animator.js:809-818`

- [ ] **Step 1: Implement.** Replace the extra-decor block with (same salts, same rolls — only adds the cull):

```js
  // Rare static decor objects (e.g., tundra fish piles, snow sculptures).
  // Same claim-cull as regular blades: decor inside an F3/F4/F5 footprint
  // never existed (root = tile center + offset, drawn 1 tile @ sortY +0.5).
  var extra = null;
  var extraObjs = SF_EXTRA_OBJECTS[biome];
  if (extraObjs && rand2(wx, wy, 7300) < 0.012) {
    var exOffUX = (rand2(wx, wy, 7302) - 0.5) * 0.6;
    var exOffUY = (rand2(wx, wy, 7303) - 0.5) * 0.6;
    var exRootPx = (wx + 0.5 + exOffUX) * 32;
    var exRootPy = (wy + 0.5 + exOffUY) * 32 + 0.35 * 32;
    if (!isClaimedAt(exRootPx, exRootPy, _claimTileInfo(chunkStore))) {
      extra = {
        url: extraObjs[pickIndex(rand2(wx, wy, 7301), extraObjs.length)],
        offUX: exOffUX,
        offUY: exOffUY
      };
    }
  }
```

(Note `pickIndex` from Task 1 is already in place on line `:814` — fold it in.)

- [ ] **Step 2: Run F2 visual probe** — `PROBE_PORT=8742 node scripts/probe-f2-visual.mjs`. If the golden capture happens to contain a now-culled decor object the probe will diff; inspect the diff — the ONLY acceptable change is a removed extra-decor sprite. Re-bless the golden if so (document in commit message).

- [ ] **Step 3: Commit** — `fix(f2): claim-cull rare extra decor (seed 7300) like regular blades`

---

## Task 3: Dynamic claim-scan radius (replaces the broken ±3 assumption)

`getClaimMask` (`decoration-claims.js:448-479`) scans neighbors ±3 assuming F5 reach ≤ ~2.5 tiles. But `tuneSize` is multiplicative across 4 slider levels (each up to 2.0 → 16×) and variant numBoxes are unclamped — a large-scaled F5 placed 4+ tiles away never rasterizes into this tile's mask, so F2 blades grow inside boulders.

**Fix:** compute the scan radius from the tuning tree's actual worst case, lazily, invalidated by `clearClaimCaches()` (which every tuning apply already calls).

**Files:**
- Modify: `src/world/field-tuning.js` (export tree walker)
- Modify: `src/world/decoration-claims.js` (radius computation + use)
- Test: `test/field-tuning.test.js`, `test/decoration-claims-f5.test.js`

- [ ] **Step 1: Write the failing tests.**

Append to `test/field-tuning.test.js`:

```js
test('maxSizeMul: empty tree -> 1', () => {
  setFieldTuning(null);
  assert.equal(maxSizeMul('f5'), 1);
});

test('maxSizeMul: multiplies worst-case master/biome/object/variant', () => {
  setFieldTuning({ f5: { size: 2, biomes: {
    grassland: { size: 2, objects: {
      boulder: { sizeMin: 0.5, sizeMax: 2, variants: { 1: { size: 1.5 } } }
    } },
    desert: { size: 1.25 }
  } } });
  // 2 (master) * 2 (worst biome) * 2 (sizeMax) * 1.5 (variant) = 12
  assert.equal(maxSizeMul('f5'), 12);
  setFieldTuning(null);
});
```

Append to `test/decoration-claims-f5.test.js` (follow the existing stub-tileInfo pattern in that file):

```js
test('claimScanRadius grows with extreme f5 tuning and resets with caches', () => {
  setFieldTuning(null);
  clearClaimCaches();
  assert.equal(claimScanRadius(), 3);
  setFieldTuning({ f5: { size: 2, biomes: { grassland: { size: 2, objects: {} } } } });
  clearClaimCaches();
  assert.ok(claimScanRadius() > 3, 'radius must widen at 4x scale');
  assert.ok(claimScanRadius() <= 8, 'radius is capped');
  setFieldTuning(null);
  clearClaimCaches();
  assert.equal(claimScanRadius(), 3);
});
```

- [ ] **Step 2: Run — expect FAIL** (`maxSizeMul`, `claimScanRadius` not exported).

- [ ] **Step 3: Implement `maxSizeMul` in `src/world/field-tuning.js`:**

```js
// Worst-case node size: range nodes use sizeMax, plain nodes use size.
function nodeMax(node) {
  if (!node) return 1;
  if (node.sizeMax != null) return node.sizeMax;
  return node.size != null ? node.size : 1;
}

// Worst-case combined size multiplier for a field across the whole tree —
// master x max(biome) x max(object) x max(variant). Used to derive the
// claim-mask scan radius so extreme tuner scales can't out-reach the scan.
export function maxSizeMul(field) {
  var f = FIELD_TUNING[field];
  if (!f) return 1;
  var m = f.size != null ? f.size : 1;
  var worst = 1;
  var biomes = f.biomes || {};
  for (var bk in biomes) {
    var b = biomes[bk];
    var bm = nodeMax(b);
    var ow = 1;
    var objs = b.objects || {};
    for (var ok in objs) {
      var o = objs[ok];
      var om = nodeMax(o);
      var vw = 1;
      var vars = o.variants || {};
      for (var vk in vars) vw = Math.max(vw, nodeMax(vars[vk]));
      ow = Math.max(ow, om * vw);
    }
    worst = Math.max(worst, bm * ow);
  }
  return m * worst;
}
```

- [ ] **Step 4: Implement radius in `src/world/decoration-claims.js`.**

Add near the mask cache declarations:

```js
// Claim-scan radius (tiles). ±3 covers default scales; the tuner's
// multiplicative sliders can push footprints further, so the radius is
// derived from the tuning tree's worst case. Recomputed lazily after
// clearClaimCaches() (every tuning apply calls it). Capped at 8 — beyond
// that the mask loop cost outweighs fidelity at absurd slider combos.
var _scanR = 3;
var _scanRDirty = false;

function maxFieldReachTiles(field, basePx, scaleTable, fwK, dropK, fhK) {
  var maxBiome = 1;
  for (var k in scaleTable) maxBiome = Math.max(maxBiome, scaleTable[k]);
  var drawPx = basePx * maxBiome * maxSizeMul(field);
  // horizontal reach: ux offset (≤0.25 tile) + fw half-width;
  // vertical reach: uy offset + base drop + fh half-height (the larger wins)
  var reachPx = drawPx * Math.max(fwK, dropK + fhK);
  return 0.25 + reachPx / TILE_ART_PX;
}

function recomputeScanRadius() {
  _scanRDirty = false;
  var r = Math.max(
    maxFieldReachTiles('f3', TILE_ART_PX, { _: 0.5 }, 0.55, 0.32, 0.30),
    maxFieldReachTiles('f4', 64, F4_BIOME_SCALE, 0.30, 0.30, 0.16),
    maxFieldReachTiles('f5', 96, F5_BIOME_SCALE, 0.42, 0.30, 0.22));
  _scanR = Math.min(8, Math.max(3, Math.ceil(r)));
}

export function claimScanRadius() {
  if (_scanRDirty) recomputeScanRadius();
  return _scanR;
}
```

(`f3` base: `obj.scale` defaults ≤0.5 of `TILE_ART_PX` — pass a one-entry table `{_: 0.5}` as its "biome scale". Import `maxSizeMul` from `./field-tuning.js`.)

In `clearClaimCaches()` add `_scanRDirty = true;`:

```js
export function clearClaimCaches() { _placeCache.clear(); _maskCache.clear(); _f4Cache.clear(); _f5Cache.clear(); _scanRDirty = true; }
```

In `getClaimMask`, replace the fixed loops (`:455-456`) and update the comment (`:445-447`):

```js
// Scans this tile + neighbors out to claimScanRadius() (≥3): radius is
// derived from the tuning tree's worst-case size multipliers so tuner
// scales can't push a footprint beyond the scan (see recomputeScanRadius).
...
  var R = claimScanRadius();
  for (var ny = -R; ny <= R; ny++) {
    for (var nx = -R; nx <= R; nx++) {
```

- [ ] **Step 5: Run units — expect PASS.** Verify the radius math in the test failure output if not.

- [ ] **Step 6: Run F2 + F3 visual probes — expect golden match** (default tree → radius stays 3 → byte-identical).

- [ ] **Step 7: Commit** — `fix(claims): derive claim-scan radius from tuning-tree worst case (was fixed ±3)`

---

## Task 4: Extract `f5AnimUrlBase` (dedupe inline URL builder)

`field2-animator.js:639-643` hand-builds the F5 anim URL inline (path + pad3 duplicated). F4 already has the right shape: `f4AnimUrlBase` at `decoration-claims.js:558-560`.

**Files:**
- Modify: `src/world/decoration-claims.js` (add export, after `f5SpriteUrl`)
- Modify: `src/render/field2-animator.js:639-643`

- [ ] **Step 1: Add to `decoration-claims.js`:**

```js
export function f5AnimUrlBase(p) {
  return MO_BASE_PATH + p.biome + '/' + p.name + '/anim/wind_sway/v' + pad3(p.variant) + '/';
}
```

Verify `MO_BASE_PATH` equals `'/assets/pixelab/landscape_v2/micro/medium_objects/'` (check the const at the top of the file — if it lacks the leading `/assets/...` prefix used inline, match the inline string exactly).

- [ ] **Step 2: Use it.** In `field2-animator.js`, add `f5AnimUrlBase` to the existing `decoration-claims.js` import and replace `:639-643`:

```js
      animUrlBase: (gp.hasAnim && !gp.state
        && tuneAnimEnabled('f5', gp.biome, gp.name, 'wind_sway'))
        ? f5AnimUrlBase(gp)
        : null,
```

- [ ] **Step 3: Verify identical output.** Quick node check that the function reproduces the old inline string for `{biome:'grassland', name:'boulder', variant:7}`. Run F2 visual probe (covers descriptor build path).

- [ ] **Step 4: Commit** — `refactor(f5): extract f5AnimUrlBase, dedupe inline anim URL builder`

---

## Task 5: Skip trigger machinery for sprites that can never animate or sway

The per-frame blade loop (`field2-animator.js:921-963`) runs wind-impulse trigger tracking + neighbor contagion for EVERY blade — including static F5 objects (rigid, `ambientPeriod: 0`, usually no `animUrlBase`). Wind impulses insert `triggerTimes` Map entries for sprites that can never use them (Map churn every gust).

**CAUTION — two traps:**
1. Do NOT `continue` — the loop body also DRAWS the sprite (`:1011`).
2. Non-rigid F2 blades without anim frames still SWAY (sway = `currentEffect.rot * 1.2 * animBlend * bl.lifeSway`, and `animBlend` comes from the trigger machinery). Skipping them would freeze visible grass sway. The skip predicate must be: no frames AND no ambient AND (rigid OR `lifeSway === 0`).

**Files:**
- Modify: `src/render/field2-animator.js:921-983`

- [ ] **Step 1: Restructure the loop head.** Wrap the trigger/contagion/frame block (everything from the `// Wind impulse triggers...` comment at `:924` through the `animBlend` computation ending `:983`) in a guard, hoisting the declarations:

```js
      for (var b = 0; b < desc.blades.length; b++) {
        var bl = desc.blades[b];

        var frameIdx = bl.restFrame;
        var animBlend = 0;
        // Sprites that can never frame-animate (no anim frames, no ambient
        // trigger) nor sway-rotate (rigid, or lifeSway 0) skip trigger
        // tracking entirely — avoids triggerTimes Map churn on every wind
        // gust for static objects (all of F5, rigid F2 decor).
        var canAnimate = !!bl.animUrlBase || !!bl.ambientPeriod
          || (!bl.isRigid && bl.lifeSway !== 0);
        if (canAnimate) {
          // ... existing :924-983 body unchanged (impulse, triggerKey,
          // triggerTimes set/get, contagion, isAnimating, frameIdx,
          // animBlend) — only the `var` keywords on frameIdx/animBlend
          // are removed since they're hoisted above ...
        }
```

The existing not-animating branch at `:969-975` (frozen-at-last-frame logic) stays inside the guard untouched; the hoisted defaults reproduce its `else` arm (`frameIdx = bl.restFrame`) for skipped sprites.

- [ ] **Step 2: Verify behavior.** Run the game or F2 probe: grass must still sway on wind; F4 must still play wind_sway frames; F5 objects must still draw. `PROBE_PORT=8742 node scripts/probe-f2-visual.mjs` (probe captures a fixed frame — must match golden).

- [ ] **Step 3: Commit** — `perf(f2): skip trigger machinery for sprites that can neither animate nor sway`

---

## Task 6: Exact golden F4 lifecycle-state test

The F4 golden test in `test/decoration-claims-f5.test.js` checks state *membership* (state ∈ valid set), not exact values — a salt/threshold regression in the lifecycle migration would pass it. Pin exact computed values.

**Files:**
- Test: `test/decoration-claims-f5.test.js`

- [ ] **Step 1: Add the exact-value test** (use the file's existing grassland stub tileInfo + world-seed setup; placements at `(wx, 0)`):

```js
test('F4 grassland lifecycle states: exact golden values (salt 9705 regression pin)', () => {
  const GOLDEN = [
    [2, 0, 'wilting'], [5, 0, 'wilting'], [11, 0, 'dead'], [14, 0, null],
    [33, 0, 'wilting'], [43, 0, null], [47, 0, 'seedling'], [54, 0, null],
    [59, 0, 'seedling'], [107, 0, null],
  ];
  for (const [wx, wy, want] of GOLDEN) {
    const pls = f4Placements(wx, wy, stubTileInfo);
    assert.equal(pls.length, 1, `expected placement at ${wx},${wy}`);
    assert.equal(pls[0].state, want, `state at ${wx},${wy}`);
  }
});
```

If the stub tileInfo or seed in the file differs from what produced these pairs, recompute the golden ONCE from the current master lineage (print `wx, state` for the first ~10 placements on row 0) and pin those — the point is pinning current behavior, then the test guards future changes. Note `clearClaimCaches()` before the test if earlier tests set tuning.

- [ ] **Step 2: Run — expect PASS.** If any pair mismatches, STOP and investigate (superpowers:systematic-debugging) — either the pairs were computed under different tuning/seed (recompute per above) or there is a real regression.

- [ ] **Step 3: Commit** — `test(f4): pin exact golden lifecycle states (salt 9705)`

---

## Task 7: Tuner UX — scrollable panel, content-fit height, side panel for expanded objects

User report: (1) long object lists can't scroll; (2) expanding an object's caret produces an unscrollable variant list. Requested design: scrollable primary list; panel takes "as much room as it needs, but not more"; expanded content opens in a separate side panel, scrollable.

**Root cause of (1):** `buildPanel` (`src/dev/field-tuner.js:326-342`) makes `body` a `flex:1` child of a `max-height:70vh` flex column **without `min-height:0`** — flex items' min-height defaults to content size, so `body` grows past the cap and `overflow-y:auto` never engages.

**Files:**
- Modify: `src/dev/field-tuner.js`

- [ ] **Step 1: Fix main-panel scrolling + height.** In `buildPanel`:

```js
function buildPanel() {
  panel = el('div',
    'position:fixed;top:48px;right:8px;z-index:9999;background:rgba(10,14,24,0.92);' +
    'color:#cfe0ff;font:12px monospace;padding:8px 10px;border:1px solid #3a4a6a;' +
    'border-radius:6px;max-height:calc(100vh - 64px);display:flex;flex-direction:column;width:360px');
  ...
  body = el('div', 'overflow-y:auto;flex:1;min-height:0');
```

`min-height:0` makes the list scroll; `height` stays auto so the panel is small when content is small (content-fit), capped near the viewport.

- [ ] **Step 2: Side panel for expanded objects.** Replace the multi-key `expanded = {}` map with a single `expandedKey = null` (one object expanded at a time — the side panel hosts exactly one object's detail). Add module-level `sidePanel = null, sideBody = null, sideTitle = null`:

```js
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
```

(360px panel + 8px right + ~18px gap → `right:386px`.)

- [ ] **Step 3: Route expanded content to the side panel.** In `rebuild()`:
  - Arrow click: `arrow.onclick = function () { expandedKey = expandedKey === key ? null : key; rebuild(); };` and glyph `expandedKey === key ? '▾' : '▸'`.
  - Delete the inline `if (expanded[key]) { ...states... ...variants... }` block (`:254-279`). Move it to the end of `rebuild()`:

```js
  // --- side panel: states + variants for the expanded object ---
  if (!sidePanel) buildSidePanel();
  var ek = expandedKey && expandedKey.split('/'); // field/biome/obj
  if (ek && ek[0] === field && ek[1] === biome) {
    var eObj = regFor(field).objectsFor(biome).filter(function (o) { return o.name === ek[2]; })[0];
    if (eObj) {
      sideTitle.textContent = ek[2];
      sideBody.textContent = '';
      var stNames = regFor(field).stateNames(biome, eObj.name);
      if (stNames.length) {
        // ... existing state-rows block from :255-277, appending to sideBody
        //     instead of wrap (same code, same applySoon) ...
      }
      eObj.variants.forEach(function (v) { sideBody.appendChild(variantRow(field, biome, eObj.name, v)); });
      sidePanel.style.display = 'flex';
    } else { sidePanel.style.display = 'none'; }
  } else {
    sidePanel.style.display = 'none';
  }
```

(`variantRow`'s `margin-left:18px` indent can drop to `0` now that it's in its own panel — optional, one string edit at `:166`.)

- [ ] **Step 4: Hide side panel with the main panel.** In the backtick keydown handler (`:369-375`), when hiding: `if (sidePanel) sidePanel.style.display = 'none';` (rebuild on reopen restores it if `expandedKey` is set).

- [ ] **Step 5: Update the file header comment** (`:1-7`) — tree is now: field tabs → biome → object rows; expanded object's states/variants live in a side panel.

- [ ] **Step 6: Probe + manual check.** `PROBE_PORT=8742 node scripts/probe-field-tuning.mjs` must still pass (it drives tuner DOM — if it asserts on inline variant rows, update its selectors to look in the side panel). Manual: open backtick on a many-object biome — main list scrolls; caret opens side panel; side panel scrolls; panel is short when content is short.

- [ ] **Step 7: Commit** — `feat(tuner): scrollable panel (min-height:0 fix), content-fit height, side panel for expanded objects`

---

## Task 8: Pre-downscaled sprite cache (fix pixel loss when objects are scaled down)

The renderer is nearest-neighbor everywhere: `ctx.imageSmoothingEnabled = false` (`field2-animator.js:868`) and the GL sprite atlas uses `gl.NEAREST` MIN/MAG filters (`gl-compositor.js:790-791`). A 96px F5 sprite shrunk to half size drops every other pixel — "loses pixels and becomes strange looking". There is no mip/downscale cache anywhere.

**Fix:** when a sprite's destination size is well below its native size, draw a smoothed, downscaled copy from a cache instead of the native image. Bucketed so the cache stays small. Native-or-larger draws stay nearest-neighbor (pixel-art upscale must remain crisp).

**Files:**
- Modify: `src/render/field2-animator.js`

- [ ] **Step 1: Add the cache + helper** near `loadFrame` (`:365`):

```js
// Pre-downscaled copies for sprites drawn well below native size. Nearest-
// neighbor minification drops pixels; an area-averaged downscale (stepwise
// halving) keeps silhouettes readable. Keyed by native img + scale bucket.
// Upscale / near-native stays nearest-neighbor (crisp pixel art).
var DOWNSCALE_BUCKETS = [0.5, 0.33, 0.25];
var _downCache = new Map(); // url + '@' + bucket -> canvas

function scaledFrame(img, destPx) {
  var native = img.naturalWidth || img.width;
  if (!native || destPx >= native * 0.66) return img;
  var ratio = destPx / native;
  var bucket = DOWNSCALE_BUCKETS[0];
  for (var i = 1; i < DOWNSCALE_BUCKETS.length; i++)
    if (ratio <= DOWNSCALE_BUCKETS[i]) bucket = DOWNSCALE_BUCKETS[i];
  var key = (img.src || img._dnKey || '') + '@' + bucket;
  var hit = _downCache.get(key);
  if (hit) return hit;
  // Stepwise halving down to the bucket size (better than one big smooth pass)
  var src = img, w = native, h = img.naturalHeight || img.height;
  var target = Math.max(2, Math.round(native * bucket));
  while (w * 0.5 > target) {
    var half = document.createElement('canvas');
    half.width = Math.max(2, Math.round(w * 0.5));
    half.height = Math.max(2, Math.round(h * 0.5));
    var hctx = half.getContext('2d');
    hctx.imageSmoothingEnabled = true;
    hctx.drawImage(src, 0, 0, half.width, half.height);
    src = half; w = half.width; h = half.height;
  }
  var out = document.createElement('canvas');
  out.width = target; out.height = Math.max(2, Math.round(h * target / w));
  var octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.drawImage(src, 0, 0, out.width, out.height);
  out._f2At = img._f2At; // preserve fade-in state contract (imgFade)
  _downCache.set(key, out);
  return out;
}
```

(Check whether denoised frames are canvases without `.src` — if `loadFrame` returns canvases, give them a `_dnKey` at creation, or key the cache with a WeakMap<img, Map<bucket, canvas>> instead. Follow whichever matches `loadFrame`'s actual return type.)

- [ ] **Step 2: Use it at drawBuffer-push time** (`:1001-1020`) so BOTH the 2D path and the GL atlas upload get the downscaled bitmap:

```js
        if (!img) continue;
        var drawSize = tilePxSnapped * bl.lifeScale;
        img = scaledFrame(img, drawSize);
```

(`drawSize` is currently computed at `:1010` — hoist it above the push as shown.) Apply the same one-liner to the `desc.extra` push (`:1024-1037`, destPx = `tilePxSnapped`) — extras are 32px drawn at 1 tile, so it's a no-op there in practice, but keeps the rule uniform.

- [ ] **Step 3: Watch the imgFade contract.** `imgFade` (`:828-833`) reads/mutates `img._f2At`; the cached canvas copies `_f2At` once at creation. Verify fade still ends (mutation on the canvas copy is fine — same short-circuit). If `imgFade` mutation needs to propagate back to the native img, set both.

- [ ] **Step 4: Verify.** In-game: tuner → F5 → drop master size to 0.5 — boulders must look smoothly minified, not pixel-dropped; at size ≥ 1.0 rendering must be byte-identical (probe: `PROBE_PORT=8742 node scripts/probe-f2-visual.mjs` — golden uses default sizes, must match).

- [ ] **Step 5: Commit** — `fix(render): area-averaged downscale cache for sub-native sprite draws`

---

## Task 9: Y-sort anchor for large sprites (fix draw order around F5 objects)

`sortYOff = uy + sizeTiles * 0.30` (`field2-animator.js:651` for F5, `:621` for F4) anchors depth ~75% down the sprite, not at its visual base — fine for 0.5-tile plants, wrong for 3-tile boulders: the player and other sprites standing just below an F5's anchor but visually in front of its base get drawn behind it (and vice versa). Player threshold is `player.y + 0.4` (`:1136` GL, `:1205` 2D).

**Files:**
- Modify: `src/render/field2-animator.js:651` (and verify `:621`)

- [ ] **Step 1: Derive the true visual base from the draw transform.** Read the draw code (`:1164` GL pivot, `:1211-1214` 2D: translate to `(sx, sy + halfDraw)`, `drawImage(img, -halfDraw, -drawSize, drawSize, drawSize)` → sprite bottom edge at `sy + halfDraw` screen px = world `wy + uy - 0.5 + sizeTiles * 0.5` ... verify this against the actual code, don't trust this arithmetic blindly). Sprites visually "sit" slightly above their bottom edge (the art has ground-contact pixels a few px up), so the anchor should be the bottom edge minus a small inset (~0.1 × sizeTiles).

- [ ] **Step 2: Fix the F5 anchor** (`:651`):

```js
      sortYOff: gp.uy + gp.sizeTiles * 0.50, // sort at the sprite's visual base (3-tile objects were anchored mid-sprite at 0.30)
```

Start at 0.50; if Step 1's derivation gives a different bottom-edge coefficient, use that minus ~0.1×sizeTiles inset. **Leave F4 (0.30) and F2 alone** — at ≤2-tile sizes 0.30 sits near the base and changing them would re-sort the entire calibrated look.

- [ ] **Step 3: Verify in-game.** Walk the player a full circle around a large boulder (grassland `?x=1312&y=1312`): in front when below its base, behind when above, no mid-body pop. Check a tall F4 plant next to an F5 — the plant in the tile below must draw over the boulder's base.

- [ ] **Step 4: Probe** — F2 visual probe must still match (or diff ONLY in F5-adjacent sort order; re-bless if the new order is correct and note it in the commit).

- [ ] **Step 5: Commit** — `fix(f5): anchor y-sort at sprite visual base, not mid-sprite`

---

## Task 10: Footprint-overlap exclusion — F5 vs neighbor F5, and F4 yields to neighbor F5

F5 is one-per-tile, but adjacent tiles can each roll a large object whose footprints overlap ("two large objects next to each other... on top of each other"). Likewise a large F4 in a neighboring tile can sit inside an F5's footprint — the existing same-tile check (`decoration-claims.js:511`) doesn't see neighbors. User decision: **F5 wins** (matches locked atlas decision #7 — larger objects claim first).

**Determinism trap:** an F5 placement must not depend on neighbor F5 *final* placements (infinite recursion). Split into a private candidate function (no neighbor checks) + the public function that resolves conflicts between candidates with a deterministic priority.

**Files:**
- Modify: `src/world/decoration-claims.js`
- Test: `test/decoration-claims-f5.test.js`

- [ ] **Step 1: Write the failing tests** (use the file's existing stub-tileInfo helpers; you may need a custom stub whose F5 chance is forced high via tuning so adjacent tiles both roll candidates — set `setFieldTuning({ f5: { density: 3 } })` and restore after):

```js
test('adjacent F5 candidates with overlapping footprints: exactly one survives', () => {
  // scan a row; wherever two consecutive tiles would both place an F5 with
  // intersecting footprint ellipses, the public API must keep only one.
  let conflicts = 0;
  for (let wx = -500; wx < 500; wx++) {
    const a = f5Placements(wx, 0, stubTileInfo)[0];
    const b = f5Placements(wx + 1, 0, stubTileInfo)[0];
    if (a && b) {
      const dx = a.bx - b.bx, dy = a.by - b.by;
      const nx = dx / (a.fw + b.fw), ny = dy / (a.fh + b.fh);
      assert.ok(nx * nx + ny * ny >= 1, `overlap at ${wx},0`);
      conflicts++;
    }
  }
  // determinism: same scan twice -> same survivors
});

test('F4 yields to a neighboring F5 whose footprint covers it', () => {
  // find a tile with an F5; its 8 neighbors with an F4 candidate must not
  // place an F4 whose footprint intersects the F5 footprint.
  for (let wx = -500; wx < 500; wx++) {
    const f5 = f5Placements(wx, 0, stubTileInfo)[0];
    if (!f5) continue;
    for (let nx = -1; nx <= 1; nx++) for (let ny = -1; ny <= 1; ny++) {
      const f4 = f4Placements(wx + nx, ny, stubTileInfo)[0];
      if (!f4) continue;
      const dx = f4.bx - f5.bx, dy = f4.by - f5.by;
      const ex = dx / (f4.fw + f5.fw), ey = dy / (f4.fh + f5.fh);
      assert.ok(ex * ex + ey * ey >= 1, `F4 inside F5 footprint near ${wx},0`);
    }
  }
});
```

- [ ] **Step 2: Run — expect FAIL** (overlaps exist today).

- [ ] **Step 3: Implement.** In `decoration-claims.js`:

a. Rename the existing `f5Placements` body to a private `f5Candidate(wx, wy, tileInfo)` cached in a new `_f5CandCache` (same key shape). It contains everything up to and including the `cachePut` — candidates have NO neighbor knowledge.

b. Add a shared ellipse-overlap helper:

```js
// Footprint ellipses a,b (bx,by,fw,fh) intersect? Conservative sum-of-radii
// test on each axis — exact for circles, slightly loose for ellipses (good:
// large objects should never visually kiss).
function footprintsOverlap(a, b) {
  var nx = (a.bx - b.bx) / (a.fw + b.fw);
  var ny = (a.by - b.by) / (a.fh + b.fh);
  return nx * nx + ny * ny < 1;
}
```

c. New public `f5Placements`: candidate survives unless a HIGHER-priority overlapping neighbor candidate exists. Priority = `rand2(wx, wy, 9806)` (NEW salt — document in the 9800-9820 block comment), ties broken by `(wy, wx)` lexicographic (deterministic, never both survive):

```js
export function f5Placements(wx, wy, tileInfo) {
  var cand = f5Candidate(wx, wy, tileInfo);
  if (!cand.length) return cand;
  var key = wx + ',' + wy + ',res';
  var hit = _f5Cache.get(key);
  if (hit) return hit;
  var p = cand[0];
  var myPri = rand2(wx, wy, 9806);
  // Neighbor radius: footprints reach ~1.3 tiles at default scale; use the
  // claim scan radius so extreme tuner scales stay covered.
  var R = claimScanRadius();
  for (var ny = -R; ny <= R; ny++) {
    for (var nx = -R; nx <= R; nx++) {
      if (!nx && !ny) continue;
      var nc = f5Candidate(wx + nx, wy + ny, tileInfo);
      if (!nc.length || !footprintsOverlap(p, nc[0])) continue;
      var nPri = rand2(wx + nx, wy + ny, 9806);
      if (nPri > myPri || (nPri === myPri && (ny < 0 || (ny === 0 && nx < 0))))
        return cachePut(_f5Cache, key, EMPTY); // neighbor wins — this object never existed
    }
  }
  return cachePut(_f5Cache, key, cand);
}
```

(Add `_f5CandCache` to `clearClaimCaches()`. The unloaded-neighbor rule: if `tileInfo(wx+nx, wy+ny)` is null the candidate fn already returns EMPTY without caching — mirror `getClaimMask`'s `complete` pattern: if any neighbor tile is null, do NOT cache the resolution result.)

d. F4 yields to neighbor F5: in `f4Placements`, replace the same-tile check (`:511`) with a footprint test against final F5 placements in the 8-neighborhood + own tile, AFTER `p` is built (footprint needed) but BEFORE `cachePut`:

```js
  // Larger objects claim first (locked decision #7): an F4 whose footprint
  // intersects ANY nearby F5 footprint never existed. Checks final (post-
  // exclusion) F5 placements — F5 never consults F4, so no recursion.
  var R5 = claimScanRadius();
  for (var ny5 = -R5; ny5 <= R5; ny5++) {
    for (var nx5 = -R5; nx5 <= R5; nx5++) {
      var f5n = f5Placements(wx + nx5, wy + ny5, tileInfo);
      if (f5n.length && footprintsOverlap(p, f5n[0]))
        return cachePut(_f4Cache, key, EMPTY);
    }
  }
```

Note this REPLACES line `:511`'s early same-tile check (the nx5=ny5=0 iteration covers it) — but keep an early cheap same-tile check before the variant/state rolls if profiling matters; correctness first.

- [ ] **Step 4: Run units — expect PASS** (including determinism: run the suite twice).

- [ ] **Step 5: Visual probes.** F2/F3 probes will diff wherever an overlap used to exist (removed F4s/F5s and their claim-freed grass). Inspect: the ONLY acceptable diffs are removed overlapping objects + grass refilling freed space. Re-bless goldens, document in commit.

- [ ] **Step 6: In-game check** at grassland + a dense F5 biome: no kissing/stacked boulders, no plants growing out of boulders.

- [ ] **Step 7: Commit** — `feat(claims): footprint-overlap exclusion — F5 beats neighbor F5 (salt 9806) and nearby F4`

---

## Task 11: Tighten claim-mask edge fidelity (F2 blades clipping F5 footprint edges)

User: F2 grass density against F5 "looks amazing, but... sometimes they're not fully overlapped" — blades occasionally clip footprint edges. The mask rasterizer (`decoration-claims.js:468-473`) claims a 4px cell only if its CENTER is inside the ellipse, so up to half a cell of footprint edge goes unclaimed and a blade root lands there.

**Files:**
- Modify: `src/world/decoration-claims.js:470-472`

- [ ] **Step 1: Inflate the ellipse test by half a cell:**

```js
            var px = ox + (c + 0.5) * CELL_PX, py = oy + (r + 0.5) * CELL_PX;
            var ex = (px - p.bx) / (p.fw + CELL_PX * 0.5), ey = (py - p.by) / (p.fh + CELL_PX * 0.5);
            if (ex * ex + ey * ey < 1.0) mask[r] |= (1 << c);
```

(Half-cell inflation = a cell is claimed if ANY part of it can touch the ellipse — conservative, blades never clip the edge. Update the function comment.)

- [ ] **Step 2: Probes.** F2/F3 goldens will diff slightly (a ring of blades culled at footprint edges). Inspect, re-bless, document.

- [ ] **Step 3: Commit** — `fix(claims): half-cell inflate footprint rasterization so F2 never clips edges`

---

## Final verification

- [ ] All units: `node --test test/*.test.js` (or the project's full test set) — green.
- [ ] Probes: `probe-f2-visual.mjs`, `probe-f3-visual.mjs`, `probe-field-tuning.mjs` on `PROBE_PORT=8742` — green.
- [ ] `git log --oneline master..field-hardening` shows the 11 commits.
- [ ] In-game spot check (user is the acceptance test): tuner scrolls + side panel; shrunk F5 looks clean; walk-around sort is correct; no overlapping large objects; no grass clipping footprint edges.
- [ ] Final holistic code review (subagent), then merge to master and into the user's live checkout branch (check `git branch --show-current` in `projects\default` first — parallel agents move it).
