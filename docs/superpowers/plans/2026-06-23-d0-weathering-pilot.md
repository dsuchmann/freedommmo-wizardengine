# D0 Weathering Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first dressing field — D0 weathering — as procedural coverage tints (bottom-weighted ground grime + per-column tonal variation) painted into the building silhouette bitmap through the GL pipeline, on grassland buildings, toggleable + live-tunable, visible in-game today, with zero new assets.

**Architecture:** A new isolated module `src/render/dressing/d0-weathering.js` holds the *pure* coverage math (`weatheringCoverage`, `grimeAlpha`) and the per-column paint helper (`paintWeatheredColumn`). `building-occluder.js` gains a `drawWeatheringPass()` that walks each exposed south perimeter wall column (mirroring the existing cob-foundation post-pass) and calls the paint helper; it is invoked inside `drawBuildingTextured()` after the walls and before the roof, in BOTH the tile-corpus and legacy branches, so it shows on the default per-object depth pass. A `weathering` sub-flag in `building-render-flags.js` gates it; `window._weathering` is the live tuner. Because it paints into the silhouette ctx that is blitted into the GL scene FBO via `glc.drawSceneOverlayBitmap`, it inherits lighting/day-night/CRT for free — no 2D overlay.

**Tech Stack:** ES modules; Canvas2D into the GL-routed silhouette bitmap; deterministic `rand2`/`fbm` from `src/core/random.js`; Node built-in test runner (`node --test`).

**Honest-absence:** `age`/`maintenance`/`wealth` have no sim source yet, so intensity derives only from a deterministic per-column hash + the tuner strength (per the manifest's D0 note). When `age` is wired later, it multiplies `coverage`.

---

## File Structure

- **Create** `src/render/dressing/d0-weathering.js` — pure coverage math + `paintWeatheredColumn` + `WEATHERING` tuner object. One responsibility: the D0 weathering *look*. DOM-free except an optional `window._weathering` mirror.
- **Create** `test/d0-weathering.test.mjs` — unit tests for the pure functions + the paint helper (via a recording fake ctx).
- **Modify** `src/render/building-render-flags.js` — add the `weathering` sub-flag.
- **Modify** `src/render/building-occluder.js` — import the paint helper, add `drawWeatheringPass()`, and call it in `drawBuildingTextured()` (two sites). Geometry stays here (the authority); the look stays in the dressing module.

---

### Task 1: Pure weathering coverage math (TDD)

**Files:**
- Create: `src/render/dressing/d0-weathering.js`
- Test: `test/d0-weathering.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/d0-weathering.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatheringCoverage, grimeAlpha } from '../src/render/dressing/d0-weathering.js';

test('weatheringCoverage is deterministic and within [0,1]', () => {
  const a = weatheringCoverage(10, 20, { strength: 1, seed: 7 });
  const b = weatheringCoverage(10, 20, { strength: 1, seed: 7 });
  assert.equal(a, b);
  assert.ok(a >= 0 && a <= 1, `coverage ${a} out of range`);
});

test('weatheringCoverage scales with strength; 0 strength → 0', () => {
  assert.equal(weatheringCoverage(3, 4, { strength: 0, seed: 1 }), 0);
  const lo = weatheringCoverage(3, 4, { strength: 0.5, seed: 1 });
  const hi = weatheringCoverage(3, 4, { strength: 1.0, seed: 1 });
  assert.ok(hi >= lo, `hi ${hi} should be >= lo ${lo}`);
});

test('grimeAlpha is bottom-weighted, bounded, and 0 at/above grimeFrac', () => {
  const opts = { grimeFrac: 0.5, grimeMax: 0.6 };
  const bottom = grimeAlpha(0.0, 1, opts);
  const mid = grimeAlpha(0.25, 1, opts);
  assert.ok(bottom >= mid, 'heavier at the bottom');
  assert.equal(grimeAlpha(0.5, 1, opts), 0);
  assert.equal(grimeAlpha(0.8, 1, opts), 0);
  assert.ok(bottom <= 1 && bottom >= 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/d0-weathering.test.mjs`
Expected: FAIL — `Cannot find module '.../src/render/dressing/d0-weathering.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/render/dressing/d0-weathering.js`:

```js
// src/render/dressing/d0-weathering.js
// D0 WEATHERING — the first dressing field. Procedural coverage tints (bottom-weighted ground grime +
// per-column tonal variation) painted INTO the building silhouette bitmap (mechanism A) so they inherit
// the GL lighting/day-night/CRT present pass like everything else — never a 2D overlay. Zero assets.
//
// Honest-absence: `age` has no sim source yet, so intensity derives only from a deterministic per-column
// hash + the tuner strength. When age is wired it multiplies `coverage`.
//
// Live-tune from the console: window._weathering.strength = 1.4; window._weathering.enabled = false;

import { rand2, fbm } from '../../core/random.js';

const SALT = 0xD0; // D0 dressing channel (distinct from the F-field salts)

export const WEATHERING = {
  enabled: true,
  strength: 1.0,   // master coverage multiplier
  grimeFrac: 0.45, // fraction of the column height (from the bottom) the ground grime climbs
  grimeMax: 0.5,   // peak grime alpha at the very bottom
  toneMax: 0.18,   // per-column tonal soft-light wash peak alpha
  bands: 6,        // horizontal bands used to render the grime gradient
};
if (typeof window !== 'undefined') window._weathering = window._weathering || WEATHERING;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Per-column weathering coverage in [0,1], deterministic from world coords. Organic large-scale
 *  variation (fbm) blended with per-column jitter (rand2), scaled by strength. */
export function weatheringCoverage(wx, wy, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._weathering) || WEATHERING;
  const strength = opts.strength != null ? opts.strength : cfg.strength;
  if (!(strength > 0)) return 0;
  const big = fbm(wx * 32, wy * 32, SALT, opts.seed);
  const jit = rand2(wx, wy, SALT + 1, opts.seed);
  return clamp01((0.65 * big + 0.35 * jit) * strength);
}

/** Grime alpha at vertical fraction vFrac (0 = bottom of the column, 1 = top). Monotonic non-increasing
 *  in vFrac; exactly 0 at/above grimeFrac. */
export function grimeAlpha(vFrac, coverage, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._weathering) || WEATHERING;
  const grimeFrac = opts.grimeFrac != null ? opts.grimeFrac : cfg.grimeFrac;
  const grimeMax = opts.grimeMax != null ? opts.grimeMax : cfg.grimeMax;
  if (vFrac >= grimeFrac) return 0;
  const tt = 1 - vFrac / grimeFrac; // 1 at bottom → 0 at grimeFrac
  return clamp01(coverage * grimeMax * tt * tt);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/d0-weathering.test.mjs`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/render/dressing/d0-weathering.js test/d0-weathering.test.mjs
git commit -m "feat(dressing): D0 weathering coverage math (pure, tested)"
```

---

### Task 2: The per-column paint helper (TDD with a recording ctx)

**Files:**
- Modify: `src/render/dressing/d0-weathering.js`
- Test: `test/d0-weathering.test.mjs`

- [ ] **Step 1: Write the failing test** (append to `test/d0-weathering.test.mjs`)

```js
import { paintWeatheredColumn } from '../src/render/dressing/d0-weathering.js';

function recordingCtx() {
  const calls = [];
  return {
    calls,
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000',
    save() {}, restore() {},
    fillRect(x, y, w, h) { calls.push({ x, y, w, h, alpha: this.globalAlpha, op: this.globalCompositeOperation }); },
  };
}

test('paintWeatheredColumn paints grime heavier near the bottom', () => {
  const ctx = recordingCtx();
  const rect = { dx: 0, top: 0, dw: 32, colH: 128 };
  paintWeatheredColumn(ctx, rect, { wx: 5, wy: 6 },
    { enabled: true, strength: 1, grimeFrac: 0.5, grimeMax: 0.6, toneMax: 0.18, bands: 6, seed: 2 });
  const grime = ctx.calls.filter((c) => c.op === 'multiply');
  assert.ok(grime.length > 0, 'paints grime bands');
  grime.sort((a, b) => b.y - a.y); // largest y (bottom) first
  assert.ok(grime[0].alpha >= grime[grime.length - 1].alpha, 'bottom band darker than top band');
});

test('paintWeatheredColumn is a no-op when disabled', () => {
  const ctx = recordingCtx();
  paintWeatheredColumn(ctx, { dx: 0, top: 0, dw: 32, colH: 128 }, { wx: 5, wy: 6 },
    { enabled: false, strength: 1, seed: 2 });
  assert.equal(ctx.calls.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/d0-weathering.test.mjs`
Expected: FAIL — `paintWeatheredColumn is not exported` / not a function.

- [ ] **Step 3: Write the minimal implementation** (append to `src/render/dressing/d0-weathering.js`)

```js
/** Paint weathering over ONE wall column. rect = {dx, top, dw, colH} screen px; world = {wx, wy} of the
 *  column's ground tile. Stacked semi-transparent bands (testable + real-canvas-safe): a soft-light
 *  tonal wash over the whole column + multiply ground grime concentrated at the bottom. No-op when
 *  disabled, coverage 0, or zero-sized. Pass no `opts` in production to read window._weathering live. */
export function paintWeatheredColumn(ctx, rect, world, opts = {}) {
  const cfg = (typeof window !== 'undefined' && window._weathering) || WEATHERING;
  const enabled = opts.enabled != null ? opts.enabled : cfg.enabled;
  if (!enabled) return;
  const { dx, top, dw, colH } = rect;
  if (dw <= 0 || colH <= 0) return;
  const coverage = weatheringCoverage(world.wx, world.wy, opts);
  if (coverage <= 0) return;
  const toneMax = opts.toneMax != null ? opts.toneMax : cfg.toneMax;
  const bands = Math.max(1, (opts.bands != null ? opts.bands : cfg.bands) | 0);
  ctx.save();
  // 1) per-column tonal wash (soft-light) — breaks the flat tile repeat
  const tone = rand2(world.wx, world.wy, SALT + 2, opts.seed) - 0.5;
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = clamp01(coverage * toneMax);
  ctx.fillStyle = tone < 0 ? '#000000' : '#ffffff';
  ctx.fillRect(dx, top, dw, colH);
  // 2) bottom-weighted ground grime (multiply) — stacked bands from the bottom up
  ctx.globalCompositeOperation = 'multiply';
  const bandH = colH / bands;
  for (let i = 0; i < bands; i++) {
    const a = grimeAlpha(i / bands, coverage, opts);
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#4a3f33'; // damp-earth grime
    ctx.fillRect(dx, top + colH - (i + 1) * bandH, dw, bandH + 1);
  }
  ctx.restore();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/d0-weathering.test.mjs`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/render/dressing/d0-weathering.js test/d0-weathering.test.mjs
git commit -m "feat(dressing): D0 weathering per-column paint helper (tested via recording ctx)"
```

---

### Task 3: Render flag + GL-routed integration + live tuner

**Files:**
- Modify: `src/render/building-render-flags.js:22-34`
- Modify: `src/render/building-occluder.js` (import near top; new `drawWeatheringPass`; two calls in `drawBuildingTextured`)

- [ ] **Step 1: Add the `weathering` sub-flag**

In `src/render/building-render-flags.js`, inside the `BUILDING_RENDER` object (after the `roof: true,` line ~25), add:

```js
  weathering: true, // ON — D0 dressing: procedural ground-grime + tonal weathering on south wall columns
```

- [ ] **Step 2: Import the paint helper in `building-occluder.js`**

Near the other render imports at the top of `src/render/building-occluder.js`, add:

```js
import { paintWeatheredColumn } from './dressing/d0-weathering.js';
```

(`renderOn`, `WALL_CONFIG`, `buildingFloors`, and `tileExtent` are already in scope in this file.)

- [ ] **Step 3: Add the weathering post-pass**

In `src/render/building-occluder.js`, immediately AFTER the `drawWalls` function (after its closing `}` at line ~466), add:

```js
// D0 WEATHERING post-pass — tint each exposed SOUTH perimeter wall COLUMN with procedural ground grime +
// tonal variation. Mechanism A: painted into the silhouette ctx, so it rides the GL present pass (lighting/
// CRT/day-night) — never a 2D overlay. Walks the same south-perimeter columns as the cob-foundation pass.
function drawWeatheringPass(ctx, b, camX, camY, tilePx, w, h) {
  if (!renderOn('weathering')) return;
  const fp = b && b.footprint, sections = (fp && fp.sections) || [];
  if (!sections.length) return;
  const t = Math.round(tilePx);
  const wH = Math.round(tilePx * WALL_CONFIG.wallHeight);
  const WY = WALL_CONFIG.wallYOffset;
  const stories = buildingFloors(b);
  const tsy = (wy) => Math.round(wy * tilePx - camY);
  const floorSet = new Set();
  for (const s of sections) for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) floorSet.add((s.x0 + dx) + ',' + (s.y0 + dy));
  for (const s of sections) {
    const lr = s.y0 + s.h - 1, fbY = b.y + s.y0 + s.h;
    for (let dx = 0; dx < s.w; dx++) {
      const lx = s.x0 + dx;
      if (floorSet.has(lx + ',' + (lr + 1))) continue; // south neighbour inside → not a south face
      const ex = tileExtent(b.x + lx, tilePx, camX, 1);
      const groundTop = tsy(fbY) - wH + Math.round(t * WY);
      const colTop = groundTop - (stories - 1) * wH;
      const colH = stories * wH;
      if (ex.dx + ex.dw < 0 || ex.dx > w || colTop + colH < 0 || colTop > h) continue;
      paintWeatheredColumn(ctx, { dx: ex.dx, top: colTop, dw: ex.dw, colH }, { wx: b.x + lx, wy: fbY });
    }
  }
}
```

- [ ] **Step 4: Call it in `drawBuildingTextured` (both branches, after walls, before roof)**

In `src/render/building-occluder.js drawBuildingTextured()`:

Change the tile-corpus return line (~538) from:
```js
  if (drawBuildingTiles(ctx, b, camX, camY, tilePx, w, h)) { if (b) b._wallPath = 'tiles'; drawRoof(); return true; }
```
to:
```js
  if (drawBuildingTiles(ctx, b, camX, camY, tilePx, w, h)) { if (b) b._wallPath = 'tiles'; drawWeatheringPass(ctx, b, camX, camY, tilePx, w, h); drawRoof(); return true; }
```

Change the legacy branch (~546-547) from:
```js
  drawWalls(ctx, b, camX, camY, tilePx, w, h);
  drawRoof();
```
to:
```js
  drawWalls(ctx, b, camX, camY, tilePx, w, h);
  drawWeatheringPass(ctx, b, camX, camY, tilePx, w, h);
  drawRoof();
```

- [ ] **Step 5: Verify nothing broke the existing suite + sanity-check the module loads**

Run: `node --test test/d0-weathering.test.mjs`
Expected: PASS (5 tests).

Run: `node -e "import('./src/render/dressing/d0-weathering.js').then(m=>console.log('exports:', Object.keys(m).join(',')))"`
Expected: prints `exports: WEATHERING,weatheringCoverage,grimeAlpha,paintWeatheredColumn` (no import error from the dependency chain).

- [ ] **Step 6: Commit**

```bash
git add src/render/building-render-flags.js src/render/building-occluder.js
git commit -m "feat(dressing): wire D0 weathering into the GL building pass (flag + south-column post-pass)"
```

---

### Task 4: In-game visual verification (the real proof)

**Files:** none (verification + screenshots). Rendering correctness is verified in the running game per the project's continuous-testability rule — the pure logic is already unit-tested in Tasks 1–2.

- [ ] **Step 1: Serve the game**

Run (background): `npx http-server -p 8137 -c-1 .`
(`-c-1` disables caching so edits show on reload — see the dev-server-caching memory.)

- [ ] **Step 2: Open the game and find a grassland building**

Using the Playwright MCP browser: navigate to the served game (`http://127.0.0.1:8137/` — confirm the entry HTML; it is the project's index). Move/teleport to a grassland settlement so a tile-corpus building is on screen at normal zoom.

- [ ] **Step 3: Capture weathering OFF vs ON**

In the page console (via `browser_evaluate`):
```js
window._buildingRender.weathering = false;
```
Screenshot (`_off.png`). Then:
```js
window._buildingRender.weathering = true;
```
Screenshot (`_on.png`).

Expected: in `_on.png`, the south walls show darker ground grime rising ~45% up from the base and subtle per-column tonal variation; `_off.png` shows clean walls. The effect is under the roof, aligned to the wall columns (no seam/drift), and visibly receives the same day-night/CRT shading as the wall (it is in the silhouette bitmap, not a flat overlay).

- [ ] **Step 4: Confirm the live tuner**

In the console:
```js
window._weathering.strength = 2.0; // heavier
window._weathering.strength = 0.4; // lighter
window._weathering.grimeFrac = 0.7; // grime climbs higher
```
Screenshot each. Expected: intensity + climb height respond live without reload.

- [ ] **Step 5: Confirm determinism**

Walk away from the building and back (or teleport away and return). Expected: the SAME building shows the SAME weathering pattern (seed-derived, re-derivable) — no flicker/re-roll.

- [ ] **Step 6: Commit the verification note**

Save the before/after screenshots under `tools/` and record the result in the PLAN doc progress log (`docs/superpowers/specs/2026-06-23-dressing-and-grounds-PLAN.md` §7), then:
```bash
git add docs/superpowers/specs/2026-06-23-dressing-and-grounds-PLAN.md
git commit -m "docs(dressing): D0 weathering pilot verified in-game (grassland)"
```

---

## Self-Review

**Spec coverage** (against `2026-06-23-building-dressing-system-design.md` §1–§8 for D0):
- D0 = mechanism A, decal/coverage into the building bitmap → Tasks 2–3 paint into the silhouette ctx. ✓
- Coverage sub-grain (scalar + bottom/gravity mask, NOT discrete states) → `weatheringCoverage` scalar + `grimeAlpha` directional falloff. ✓
- Procedural provenance (no PixelLab) → pure canvas tints. ✓
- GL routing, never a 2D overlay → paints into the silhouette bitmap blitted via `glc.drawSceneOverlayBitmap`. ✓
- Determinism, seed-derived, per-tile (wx,wy) → `rand2`/`fbm` keyed on world coords; verified in Task 4 Step 5. ✓
- Honest-absence for age → intensity from hash+strength only, documented. ✓
- Per-field flag + tuner (reuse patterns) → `renderOn('weathering')` + `window._weathering`. ✓
- NOT yet covered (intentionally deferred past the pilot): the full `surfacesIndex` (pilot rides the existing south-perimeter walk instead), the `field-registry`/`field-tuner` slider UI (pilot uses a console knob), water-stain streaks + wetness gating (needs the wetness scalar, honestly absent). These are the documented D0 follow-ups, not pilot scope.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every command has expected output. ✓

**Type consistency:** `weatheringCoverage(wx,wy,opts)`, `grimeAlpha(vFrac,coverage,opts)`, `paintWeatheredColumn(ctx,{dx,top,dw,colH},{wx,wy},opts)`, `drawWeatheringPass(ctx,b,camX,camY,tilePx,w,h)`, flag key `weathering`, tuner `window._weathering` — names identical across Tasks 1–4. ✓
