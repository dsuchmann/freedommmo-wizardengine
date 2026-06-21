# ROOF Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make procedural roofs read as believable pitched structures — continuous eave-to-ridge texture courses (not per-tile bands), smooth slope shading (no constant-distance "terrace" rings on hips), re-enabled ridge/hip/valley/finial/dormer/chimney dressing, a real eave overhang with gable/rake skirt boards on all sides (not just south), and the existing `roof_fascia.png` wired as eave trim — all WITHOUT leaving the GL pipeline (the roof draws onto the building-occluder offscreen 2D canvas, which `gl-compositor` blits into the scene FBO, so it inherits GL lighting/CRT/day-night/depth) and WITHOUT faking any system.

**Architecture:** The roof engine lives in `tools/roof/*.js` (geometry → styles → materials → features → renderer), bridged to the game by `roof-ingame.js#drawRoofForBuilding(ctx, b, camX, camY, tilePx, opts)` whose `opts` signature `{stories, northGapTiles, imageCache, roofTexture}` is FROZEN by COORDINATION. The renderer composites onto the offscreen 2D canvas the occluder hands it; ROOF owns engine internals only. Two surface paths exist: the IN-GAME path skins each facet with a 64×64 `roof_top` PNG via `cfg.texture` → `drawTexturedTile`; the localhost preview (`tools/roof-ingame-preview.html`) passes no texture → the procedural `material.fillTile`. Both must look right. The single shared touch — wiring `roof_fascia.png` into `roofTexFor` inside `src/render/building-occluder.js` — is a by-name PATCH REQUEST to COORDINATION; ROOF's drawing side accepts a new `opts.roofFascia` and degrades to the existing `fasciaColor` when absent.

**Tech Stack:** JS (browser canvas/GL + node:test), no build step.

---

## File Structure

| File | Ownership | Responsibility / change |
|---|---|---|
| `tools/roof/roof-renderer.js` | ROOF (writer) | `drawTexturedTile` continuous slope-space UV sampling full 64×64; `facetNormal`→`cornerH`-smoothed normal + along-run gradient shade (kills hip terraces); `drawSkirt` bridges N/E/W gable/rake ends (not only south) and uses a wired `roofFascia` bitmap when supplied; per-tile loop unchanged in structure. |
| `tools/roof/roof-ingame.js` | ROOF (writer) | Flip `ROOF_TUNING.surfaceOnly:false` (gated allowlist) + `noAccents:false`; re-introduce a small `overhangDroop` for the E/W/S overhang ring while keeping `noNorthOverhang` + north-gap clamp; pass `opts.roofFascia` through into `renderCfg`; build a game-safe feature set (finial/dormer/chimney/ridge only). |
| `tools/roof/roof-geometry.js` | ROOF (writer) | Expose a per-tile `slopeAxis` (eave→ridge direction + run length) on each tile record so the renderer can build a continuous slope-space UV without re-deriving topology; keep height field + roles untouched. |
| `tools/roof/roof-features.js` | ROOF (read-mostly) | No structural change; verified that finial/dormer/chimney read `grid.roleTiles` already classified at `roof-geometry.js:226-242` and run cheaply. (Touched only if a game-safe guard is needed inside `draw`.) |
| `tools/roof/__tests__/roof-geometry.test.js` | ROOF (NEW test) | node:test for `buildRoofGrid` grid invariants + the new `slopeAxis` field (eave→ridge orientation, monotone run param). |
| `tools/roof/__tests__/roof-skirt.test.js` | ROOF (NEW test) | node:test for the skirt-bridge predicate: N/E/W gable ends are detected as bridgeable rake boards, north overhang clamped. |
| `tools/roof/__tests__/roof-shade.test.js` | ROOF (NEW test) | node:test for the new `smoothNormalShade`/along-run gradient: equal-`distEdge` hip tiles get DIFFERENT shade (no terrace banding). |
| `tools/roof/__tests__/roof-uv.test.js` | ROOF (NEW test) | node:test for `slopeUV`: courses are continuous across a tile boundary (v at tile k's ridge edge == v at tile k+1's eave edge). |
| **PATCH REQUEST → COORDINATION** | not ours | `src/render/building-occluder.js#roofTexFor`/the two `drawRoofForBuilding` call-sites: load `roof_fascia.png` and pass it as `opts.roofFascia` (by-name change spelled out in Task 11). ROOF does NOT edit `building-occluder.js`. |

Visual/render changes that cannot be unit-tested are verified in `tools/roof-ingame-preview.html` (procedural path) AND the real game via raw CDP screenshot (in-game `cfg.texture` path), per the Verification section of the design spec.

---

### Task 1 — Add a node:test harness dir + a baseline grid invariant test (RED→GREEN scaffolding)

**Files:** create `tools/roof/__tests__/roof-geometry.test.js`

- [ ] Write the test file. It imports the REAL geometry builder and asserts current, known-good invariants (this also gives us a regression net before we touch geometry):

```js
// tools/roof/__tests__/roof-geometry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoofGrid } from '../roof-geometry.js';

const P = { pitch: 0.9, ridgeOrientation: 'ew', clampHeight: 0.5, parapetRise: 0.5,
  knee: 2.5, capHeight: 4, sharpness: 1.4, stepWidth: 2, stepRise: 0.7, toothWidth: 4, fascia: 0.5 };

function hipGrid() {
  return buildRoofGrid([{ x0: 0, y0: 0, w: 9, h: 6 }],
    { style: 'hip', overhang: 1, overhangDroop: 0.35, noNorthOverhang: true, params: P });
}

test('hip grid: footprint+overhang sized, ridge runs along long axis', () => {
  const g = hipGrid();
  assert.equal(g.W, 11); // 9 + 2*overhang
  assert.equal(g.H, 8);  // 6 + 2*overhang
  assert.ok(g.maxHeight > 1.5, 'a 9x6 hip at pitch .9 rises >1.5 tiles');
  const ridge = g.tiles.filter(t => t.role === 'ridge');
  assert.ok(ridge.length >= 3, 'ridge tiles exist along the long axis');
});

test('every roof tile carries a normal and a downhill dir', () => {
  const g = hipGrid();
  for (const t of g.tiles) {
    assert.equal(t.normal.length, 3);
    assert.ok(['n', 's', 'e', 'w', 'flat'].includes(t.dir));
  }
});
```

- [ ] Run it (expected PASS — pure baseline, no code change yet): `node --test tools/roof/__tests__/roof-geometry.test.js` → 2 passing.
- [ ] Commit:

```
git add tools/roof/__tests__/roof-geometry.test.js
git commit -m "test(roof): baseline hip-grid invariants before slope-UV/shade rework

Regression net for the roof render-quality pass."
```

---

### Task 2 — Geometry: expose a per-tile `slopeAxis` (eave→ridge run) for continuous UV

The continuous-course UV (Lane Fix #1) needs, per tile, the eave→ridge direction and a 0..1 run parameter so the renderer can sample the texture continuously across tile boundaries instead of restarting at every tile. Derive it from the per-tile downhill `dir` + `distEdge` already computed.

**Files:** modify `tools/roof/roof-geometry.js`; modify `tools/roof/__tests__/roof-geometry.test.js`

- [ ] Add the failing assertion first. Append to `roof-geometry.test.js`:

```js
test('each tile exposes slopeAxis {dir, run, runMax} for continuous UV', () => {
  const g = hipGrid();
  for (const t of g.tiles) {
    assert.ok(t.slopeAxis, 'slopeAxis present');
    assert.ok(['n', 's', 'e', 'w'].includes(t.slopeAxis.dir), 'uphill cardinal');
    assert.ok(t.slopeAxis.run >= 0, 'run >= 0');
    assert.ok(t.slopeAxis.runMax >= 1, 'runMax >= 1');
  }
  // two slope tiles on the SAME south face at adjacent distEdge get consecutive run values
  const south = g.tiles.filter(t => t.dir === 's' && t.role === 'slope')
    .sort((a, b) => a.distEdge - b.distEdge);
  if (south.length >= 2) assert.ok(south[1].run !== south[0].run, 'run advances eave->ridge');
});
```

- [ ] Run it (expected FAIL): `node --test tools/roof/__tests__/roof-geometry.test.js` → `slopeAxis present` assertion fails (`t.slopeAxis` is `undefined`).
- [ ] Implement. In `roof-geometry.js`, inside the per-tile assembly loop (the `tiles.push({...})` block @215-220), compute the uphill cardinal (opposite of downhill `dir`) and a run parameter from `distEdge`. Add `slopeAxis` to the pushed record. Change the `tiles.push({ ... })` call to:

```js
    // slopeAxis: the eave->ridge run for a CONTINUOUS texture UV in the renderer.
    // uphill = opposite of the downhill `dir`; run = distance from the eave (distEdge-1,
    // since eaves sit at distEdge<=1.2); runMax keeps it normalizable per face.
    const uphill = dir === 's' ? 'n' : dir === 'n' ? 's' : dir === 'e' ? 'w' : dir === 'w' ? 'e' : 'n';
    const run = Math.max(0, (fp[k] ? distEdge[k] : 0) - 1);
    tiles.push({
      i, j, gx: gox + i, gy: goy + j, h, normal, dir,
      isOverhang: !!isOverhang[k], sectionId: sectionId[k],
      role: ROLE.SLOPE, // filled below
      distEdge: fp[k] ? distEdge[k] : 0,
      slopeAxis: { dir: uphill, run, runMax: 1 }, // runMax filled below from face max
    });
```

- [ ] After the role-classification loop (after @242, before `const byRole`), normalize `runMax` to the actual max run so the UV spans 0..1 cleanly. Insert:

```js
  // Normalize slopeAxis.runMax to the largest run on the grid so v in drawTexturedTile
  // can map eave(0)->ridge(1) continuously across tiles of the same face.
  let runMaxAll = 1;
  for (const t of tiles) if (t.slopeAxis.run > runMaxAll) runMaxAll = t.slopeAxis.run;
  for (const t of tiles) t.slopeAxis.runMax = runMaxAll;
```

- [ ] Run it (expected PASS): `node --test tools/roof/__tests__/roof-geometry.test.js` → all passing.
- [ ] Commit:

```
git add tools/roof/roof-geometry.js tools/roof/__tests__/roof-geometry.test.js
git commit -m "feat(roof): per-tile slopeAxis (eave->ridge run) for continuous UV

Renderer will use this to flow texture courses unbroken instead of per-tile."
```

---

### Task 3 — UV math unit: a pure `slopeUV(tile)` helper that is continuous across tiles

Extract the slope-space UV mapping into a pure, testable function so the affine in `drawTexturedTile` can be verified without a canvas.

**Files:** modify `tools/roof/roof-renderer.js`; create `tools/roof/__tests__/roof-uv.test.js`

- [ ] Write the failing test:

```js
// tools/roof/__tests__/roof-uv.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slopeUV } from '../roof-renderer.js';

// two stacked tiles on the same south face: tile A nearer the eave (run 0..1),
// tile B one tile up the slope (run 1..2). The UV's v at A's ridge edge must equal
// v at B's eave edge => courses are continuous across the boundary.
const A = { slopeAxis: { dir: 'n', run: 0, runMax: 4 }, distEdge: 1 };
const B = { slopeAxis: { dir: 'n', run: 1, runMax: 4 }, distEdge: 2 };

test('slopeUV v is continuous across a tile boundary', () => {
  const a = slopeUV(A), b = slopeUV(B);
  // A spans v0..v1; B spans v1..v2; A.v1 === B.v0
  assert.ok(Math.abs(a.v1 - b.v0) < 1e-9, `A.v1 ${a.v1} == B.v0 ${b.v0}`);
});

test('slopeUV maps eave run=0 to v0=0 and advances monotonically', () => {
  const a = slopeUV(A);
  assert.equal(a.v0, 0);
  assert.ok(a.v1 > a.v0, 'v advances up the slope');
});
```

- [ ] Run it (expected FAIL): `node --test tools/roof/__tests__/roof-uv.test.js` → `slopeUV is not a function` (not exported yet).
- [ ] Implement `slopeUV` in `roof-renderer.js`. Add near the top (after `lightVec`, before `drawTexturedTile`):

```js
// Continuous slope-space UV for one tile. v runs eave(0)->ridge(1) using the tile's
// slopeAxis.run (a per-face course counter), so adjacent tiles on the same face share
// the boundary v value and the texture courses flow UNBROKEN (no per-tile restart).
// u runs along the ridge using the tile's grid coord so horizontal courses tile too.
export function slopeUV(t) {
  const sa = t.slopeAxis || { run: Math.max(0, (t.distEdge || 1) - 1), runMax: 1 };
  const v0 = sa.run / sa.runMax;
  const v1 = (sa.run + 1) / sa.runMax;
  return { v0, v1, dir: sa.dir || 'n' };
}
```

- [ ] Run it (expected PASS): `node --test tools/roof/__tests__/roof-uv.test.js` → 2 passing.
- [ ] Commit:

```
git add tools/roof/roof-renderer.js tools/roof/__tests__/roof-uv.test.js
git commit -m "feat(roof): pure slopeUV helper (continuous eave->ridge v)

Boundary-continuous UV; drawTexturedTile will sample the full 64px swatch with it."
```

---

### Task 4 — Renderer: continuous-slope texture (Lane Fix #1, the headline bug)

`drawTexturedTile` (@106-120) currently does `ctx.drawImage(tex, 0,0,32,32, 0,0,32,32)` — a fixed top-left 32×32 crop of a 64×64 swatch, with a tile-local affine that divides by 32 → every tile restarts the same quarter of the swatch ("repeats every tile / banded"). Replace the source rect with a slope-space window into the FULL `tex.width×tex.height`, driven by `slopeUV`.

**Files:** modify `tools/roof/roof-renderer.js`. No new unit test (canvas affine is visual); covered by Task 3's UV continuity + the harness check below.

- [ ] Change `drawTexturedTile`'s signature to receive the tile, and replace its body. Find @106-120 and replace the whole function with:

```js
// Texture-map a facet quad with a CONTINUOUS slope-space UV: u along the ridge,
// v eave->ridge (from slopeUV), sampling the FULL tex.width x tex.height so courses
// flow unbroken across tile boundaries instead of restarting a 32px crop per tile.
function drawTexturedTile(ctx, q, tex, shade, t) {
  const TW = tex.width || 32, TH = tex.height || 32;
  const { v0, v1, dir } = slopeUV(t);
  // source window: v selects the eave->ridge band; u uses the tile's along-ridge index
  // (gx for ew faces, gy for ns) modulo the swatch so horizontal courses tile seamlessly.
  const along = (dir === 'n' || dir === 's') ? t.gx : t.gy;
  const u0frac = ((along % 2) + 2) % 2 / 2;          // 2-tile horizontal repeat
  const sx = u0frac * TW, sw = TW / 2;
  // For a south/north face v0 is the eave (bottom of swatch); flip so eave samples the
  // bottom course of the texture (textures are authored eave-at-bottom).
  const sy0 = (1 - v1) * TH, sy1 = (1 - v0) * TH;
  const sy = Math.min(sy0, sy1), sh = Math.max(1, Math.abs(sy1 - sy0));
  const TL = q[0], TR = q[1], BL = q[3];
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // affine maps the chosen source window onto the quad; divide by the window size, not 32.
  ctx.transform((TR.x - TL.x) / sw, (TR.y - TL.y) / sw, (BL.x - TL.x) / sh, (BL.y - TL.y) / sh, TL.x, TL.y);
  try { ctx.drawImage(tex, sx, sy, sw, sh, 0, 0, sw, sh); } catch (e) { /* bad bitmap */ }
  ctx.restore();
  ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[1].x, q[1].y); ctx.lineTo(q[2].x, q[2].y); ctx.lineTo(q[3].x, q[3].y); ctx.closePath();
  ctx.fillStyle = shade < 1 ? `rgba(0,0,0,${Math.min(0.55, (1 - shade) * 0.7)})`
    : `rgba(255,250,230,${Math.min(0.35, (shade - 1) * 0.5)})`;
  ctx.fill();
}
```

- [ ] Update the single call site in `drawRoof` (@194) to pass the tile `t`:

```js
      drawTexturedTile(ctx, quad, cfg.texture, shade, t);
```

- [ ] Sanity-run the whole roof suite (no regressions in pure tests): `node --test tools/roof/__tests__/*.test.js` → all passing.
- [ ] VISUAL VERIFY (in-game `cfg.texture` path — this is the path that uses `drawTexturedTile`). Start the NODE server and screenshot a grassland village:
  - Serve: `HOST=localhost:8123` node dev server (per design-spec Verification). Hard-reload / incognito (workers cache).
  - Spawn at the grassland pilot: `?x=1175&y=305` (seed 42); the in-game path runs `drawRoofForBuilding` with `roofTexture` set.
  - Capture via raw CDP `Page.captureScreenshot` (Playwright `page.screenshot` hangs on the rAF game).
  - PASS = roof courses run unbroken from eave to ridge with NO per-tile band restart; WATCH for diagonal smearing (if the face-axis `dir` is wrong the affine skews). Compare to a pre-change screenshot of the same building.
- [ ] Commit:

```
git add tools/roof/roof-renderer.js
git commit -m "fix(roof): continuous slope-space texture (no per-tile band restart)

drawTexturedTile sampled a fixed 0,0,32,32 crop of a 64px swatch per tile; now
samples a slopeUV window of the FULL texture so courses flow eave->ridge unbroken."
```

---

### Task 5 — Renderer: smooth slope shade + along-run gradient (Lane Fix #2, kill hip terraces)

Hips terrace because `facetNormal` (@90-97) is computed from raw `cornerH` differences and shade quantizes by integer `distEdge` rings, so equal-distance rings read as flat color bands. Derive shade from the already-smoothed corner normal the geometry computes (`t.normal`, @204-209) plus a small along-run gradient. Leave `roof-styles.js#hip` (the HEIGHT field) untouched — the geometry is correct; only the SHADE derivation changes.

**Files:** modify `tools/roof/roof-renderer.js`; create `tools/roof/__tests__/roof-shade.test.js`

- [ ] Write the failing test:

```js
// tools/roof/__tests__/roof-shade.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoothNormalShade, lightVec } from '../roof-renderer.js';
import { buildRoofGrid } from '../roof-geometry.js';

const P = { pitch: 0.9, ridgeOrientation: 'ew', clampHeight: 0.5, parapetRise: 0.5,
  knee: 2.5, capHeight: 4, sharpness: 1.4, stepWidth: 2, stepRise: 0.7, toothWidth: 4, fascia: 0.5 };

test('equal-distEdge hip tiles get DIFFERENT shade (no terrace banding)', () => {
  const g = buildRoofGrid([{ x0: 0, y0: 0, w: 11, h: 8 }],
    { style: 'hip', overhang: 1, overhangDroop: 0.35, noNorthOverhang: true, params: P });
  const light = lightVec(235, 52);
  // two tiles at the SAME distEdge ring but on DIFFERENT faces (one south-sloping,
  // one east-sloping) must NOT share an identical shade.
  const ring = g.tiles.filter(t => Math.round(t.distEdge) === 2 && t.role === 'slope');
  const s = ring.find(t => t.dir === 's'), e = ring.find(t => t.dir === 'e');
  if (s && e) {
    const ss = smoothNormalShade(g, s, light, 0.34);
    const es = smoothNormalShade(g, e, light, 0.34);
    assert.ok(Math.abs(ss - es) > 0.02, `south ${ss.toFixed(3)} != east ${es.toFixed(3)}`);
  }
});

test('along-run gradient: a tile nearer the eave is not identical to one nearer the ridge on the same face', () => {
  const g = buildRoofGrid([{ x0: 0, y0: 0, w: 11, h: 8 }],
    { style: 'hip', overhang: 1, overhangDroop: 0.35, noNorthOverhang: true, params: P });
  const light = lightVec(235, 52);
  const south = g.tiles.filter(t => t.dir === 's' && t.role === 'slope')
    .sort((a, b) => a.distEdge - b.distEdge);
  if (south.length >= 2) {
    const lo = smoothNormalShade(g, south[0], light, 0.34);
    const hi = smoothNormalShade(g, south[south.length - 1], light, 0.34);
    assert.ok(Math.abs(lo - hi) > 0.005, `eave ${lo.toFixed(3)} != ridge ${hi.toFixed(3)}`);
  }
});
```

- [ ] Run it (expected FAIL): `node --test tools/roof/__tests__/roof-shade.test.js` → `smoothNormalShade is not a function`.
- [ ] Implement `smoothNormalShade` in `roof-renderer.js`. Add after `facetNormal` (@97):

```js
// SMOOTH shade: use the geometry's per-tile corner-averaged normal (t.normal) instead
// of the raw 2-corner facetNormal, plus a tiny along-run gradient (slightly darker
// toward the eave) so equal-distEdge hip rings stop reading as flat color terraces.
export function smoothNormalShade(grid, t, light, ambient) {
  const n = t.normal || facetNormal(grid, t);
  let lambert = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
  let shade = ambient + (1 - ambient) * lambert;
  // along-run gradient: 0 at the eave, 1 at the ridge — lifts the ridge ~6% so the
  // surface reads as a continuous slope, not stepped rings.
  const sa = t.slopeAxis;
  if (sa && sa.runMax > 0) shade *= 0.94 + 0.06 * (sa.run / sa.runMax);
  return shade;
}
```

- [ ] Run it (expected PASS): `node --test tools/roof/__tests__/roof-shade.test.js` → 2 passing.
- [ ] Wire it into `drawRoof`'s per-tile loop. Replace the `let shade = ambient + ...` line (@180) and keep the overhang dimming:

```js
    let shade = smoothNormalShade(grid, t, light, ambient);
    if (t.isOverhang) shade *= 0.82;
```

- [ ] Run the full suite: `node --test tools/roof/__tests__/*.test.js` → all passing.
- [ ] VISUAL VERIFY (BOTH paths): (a) procedural path in `tools/roof-ingame-preview.html` — open it on `:8123`, pick a hip building (e.g. `town_hall`/`manor`), confirm the hip surface grades smoothly with no concentric color rings; (b) in-game `cfg.texture` path — re-screenshot the grassland village hip roofs. PASS = no terrace banding on either.
- [ ] Commit:

```
git add tools/roof/roof-renderer.js tools/roof/__tests__/roof-shade.test.js
git commit -m "fix(roof): smooth normal + along-run shade kills hip terrace rings

Shade from the corner-averaged normal + an eave->ridge gradient; equal-distEdge
rings no longer read as flat color terraces. roof-styles height field untouched."
```

---

### Task 6 — Skirt bridge: detect N/E/W gable/rake ends (Lane Fix #5, predicate first)

`drawSkirt` (@206-240) only bridges the SOUTH face down to the wall (`toWall = view.game && d === 's'`, @226); N/E/W keep a thin fascia, so gable/rake ends read as flat cuts. First add a pure predicate that classifies a perimeter edge as a bridgeable gable/rake end, with a node test, then wire it in Task 7.

**Files:** modify `tools/roof/roof-renderer.js`; create `tools/roof/__tests__/roof-skirt.test.js`

- [ ] Write the failing test:

```js
// tools/roof/__tests__/roof-skirt.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGableRakeEdge } from '../roof-renderer.js';
import { buildRoofGrid } from '../roof-geometry.js';

const P = { pitch: 1.2, ridgeOrientation: 'ew', clampHeight: 0.5, parapetRise: 0.5,
  knee: 2.5, capHeight: 4, sharpness: 1.4, stepWidth: 2, stepRise: 0.7, toothWidth: 4, fascia: 0.5 };

test('gable roof: the E and W ends are rake edges (bridge), N is clamped', () => {
  // ridgeOrientation ew => slopes face N/S, gable WALLS face E/W. The E/W perimeter
  // edges are the rake ends that should bridge to the wall.
  const g = buildRoofGrid([{ x0: 0, y0: 0, w: 13, h: 7 }],
    { style: 'gable', overhang: 1, overhangDroop: 0.35, noNorthOverhang: true, params: P });
  // pick an eave tile on the E side
  const eTile = g.tiles.find(t => t.role === 'eave' && !t.isOverhang &&
    !(g.fp[t.j * g.W + (t.i + 1)]) ); // no footprint to the east
  assert.ok(eTile, 'found an east-perimeter eave tile');
  assert.equal(isGableRakeEdge(g, eTile, 'e', true), true, 'east end bridges as a rake');
  // the NORTH edge must NOT bridge (would poke the neighbour); noNorth guard.
  assert.equal(isGableRakeEdge(g, eTile, 'n', true), false, 'north never bridges');
});
```

- [ ] Run it (expected FAIL): `node --test tools/roof/__tests__/roof-skirt.test.js` → `isGableRakeEdge is not a function`.
- [ ] Implement `isGableRakeEdge` in `roof-renderer.js`. Add before `drawSkirt` (@206):

```js
// Should this perimeter edge bridge down to the wall top as a gable/rake board?
// SOUTH always bridges (the visible roof->wall cliff). E/W bridge when they are the
// gable/rake ends. NORTH never bridges in the game view (it would poke the neighbour).
export function isGableRakeEdge(grid, t, d, game) {
  if (!game) return false;
  if (d === 's') return true;
  if (d === 'n') return false;        // noNorthOverhang guard
  return d === 'e' || d === 'w';      // E/W rake/gable ends terminate on the wall
}
```

- [ ] Run it (expected PASS): `node --test tools/roof/__tests__/roof-skirt.test.js` → 1 passing.
- [ ] Commit:

```
git add tools/roof/roof-renderer.js tools/roof/__tests__/roof-skirt.test.js
git commit -m "feat(roof): isGableRakeEdge predicate (N/E/W skirt-bridge classifier)

South always bridges; E/W bridge as rake/gable ends; North never (neighbour guard)."
```

---

### Task 7 — Skirt: bridge N/E/W ends + a real eave overhang (Lane Fix #5 + #6)

Wire the predicate into `drawSkirt` so E/W (and S) bridge to the wall top as gable/rake boards, and re-introduce a small overhang droop so the roof actually overhangs the eaves (and optionally caps the door top on the south).

**Files:** modify `tools/roof/roof-renderer.js`; modify `tools/roof/roof-ingame.js`

- [ ] In `drawSkirt` (@226-228), replace the south-only `toWall` logic with the predicate. Change:

```js
    const toWall = view.game && d === 's';
    const bH1 = toWall ? 0 : Math.max(0, ch1 - baseDrop);
    const bH2 = toWall ? 0 : Math.max(0, ch2 - baseDrop);
```
to:

```js
    // SOUTH + E/W rake ends bridge all the way to the wall top (h=0); the thin fascia
    // only remains where we don't bridge. North is excluded by isGableRakeEdge.
    const toWall = isGableRakeEdge(grid, t, d, view.game);
    const bH1 = toWall ? 0 : Math.max(0, ch1 - baseDrop);
    const bH2 = toWall ? 0 : Math.max(0, ch2 - baseDrop);
```

- [ ] Re-introduce a small overhang droop in `roof-ingame.js`. The current `R.geom.overhangDroop = 0` (@92) flattens the overhang ring. Change @92 from:

```js
  R.geom.overhangDroop = 0;
```
to:

```js
  // Small downward droop on the E/W/S overhang ring so the eave reads as a real
  // OVERHANG (a flared lip below the wall-top plane), not an inset flat cut. North
  // is excluded by noNorthOverhang so it can't poke the neighbour. Kept small so the
  // drooped lip caps the door top on the south without hiding behind the wall.
  R.geom.overhangDroop = 0.18;
```

- [ ] Run the suite (regression net): `node --test tools/roof/__tests__/*.test.js` → all passing.
- [ ] VISUAL VERIFY (BOTH paths): preview (`roof-ingame-preview.html`, gable buildings like `tavern`/`barn` show rake boards on the E/W ends, not flat cuts) AND in-game grassland screenshot (south eave overhangs/caps the door top; E/W ends read as gable boards; the NORTH edge does NOT poke into the building behind). PASS criteria per Lane Fix #5/#6.
- [ ] Commit:

```
git add tools/roof/roof-renderer.js tools/roof/roof-ingame.js
git commit -m "fix(roof): N/E/W gable/rake skirt + real eave overhang droop

drawSkirt bridges S+E/W rake ends to the wall top (was south-only); small overhang
droop gives a real eave lip that caps the door top. North clamped (neighbour-safe)."
```

---

### Task 8 — Verify the north-gap clamp survives the new overhang (regression guard)

The overhang/skirt changes must NOT break the existing north clamp (roofs must never poke past the north wall into the neighbour). Add a focused test that drives `resolveForBuilding`-equivalent geometry and asserts no NORTH overhang tile exists.

**Files:** modify `tools/roof/__tests__/roof-skirt.test.js`

- [ ] Append the failing/guard test:

```js
test('noNorthOverhang: no overhang tile sits NORTH of the footprint', () => {
  const g = buildRoofGrid([{ x0: 0, y0: 0, w: 9, h: 6 }],
    { style: 'hip', overhang: 1, overhangDroop: 0.18, noNorthOverhang: true, params: P });
  for (const t of g.tiles) {
    if (!t.isOverhang) continue;
    // an overhang tile whose nearest footprint neighbour is to the SOUTH would be north
    // of the building; assert none exist on the north ring.
    const southFp = g.fp[(t.j + 1) * g.W + t.i];
    assert.ok(!(southFp && !g.fp[t.j * g.W + t.i] && t.j < g.ovh + 1),
      `overhang tile at (${t.i},${t.j}) must not be a NORTH ring tile`);
  }
});
```

- [ ] Run it (expected PASS — the geometry already guards north via `noNorthOverhang`, this locks it in): `node --test tools/roof/__tests__/roof-skirt.test.js` → all passing. If it FAILS, the overhang re-intro leaked a north tile → revisit the `bestJ > j` guard at `roof-geometry.js:173` before proceeding.
- [ ] Commit:

```
git add tools/roof/__tests__/roof-skirt.test.js
git commit -m "test(roof): lock no-north-overhang after re-introducing eave droop

Guards the neighbour-poke regression the north clamp prevents."
```

---

### Task 9 — Re-enable structural dressing in-game: accents + a game-safe feature set (Lane Fix #3)

The generator already draws ridge/hip/valley accents (`drawAccents` @255-272) and finial/dormer/chimney (`roof-features.js:77-181`), but in-game they ship DISABLED: `roof-ingame.js:100` sets `noAccents:true` and `ROOF_TUNING.surfaceOnly:true` (@23) nulls the features (@141). Re-enable both, but gate features to a GAME-SAFE allowlist so houses don't sprout castle turrets/spires (the crude primitives were explicitly flagged "no crude turret/spire primitives yet").

**Files:** modify `tools/roof/roof-ingame.js`

- [ ] Flip `surfaceOnly` off and add a game-safe feature allowlist constant. In `ROOF_TUNING` (@18-25) change:

```js
  surfaceOnly: true,    // v1: draw the roof SURFACE only (no crude turret/spire primitives yet)
```
to:

```js
  surfaceOnly: false,   // draw lightweight ridge/hip dressing + finial/dormer/chimney in-game
  gameFeatures: ['finial', 'dormer', 'chimney'], // game-safe: NO crude turret/spire/buttress primitives
```

- [ ] Re-enable accents in the in-game render config. Change @100 from:

```js
  const renderCfg = { ...R.renderCfg, background: false, noClear: true, noShadow: true, noAccents: true };
```
to:

```js
  // noAccents:false -> ridge/hip/valley creases (roof-renderer drawAccents). Keep
  // noShadow (game has its own building shadow) + overlay-safe background/clear.
  const renderCfg = { ...R.renderCfg, background: false, noClear: true, noShadow: true, noAccents: false };
```

- [ ] Build a game-safe feature pass instead of nulling it. Change @141 from:

```js
  const features = ROOF_TUNING.surfaceOnly ? null : opts.features || null;
```
to:

```js
  // Build a GAME-SAFE feature set: keep finial/dormer/chimney/ridge dressing (cheap,
  // read already-classified roles), suppress crude turret/spire/buttress/deck primitives.
  let features = null;
  if (!ROOF_TUNING.surfaceOnly) {
    const safe = new Set(ROOF_TUNING.gameFeatures);
    const allow = (e.roof.features || []).filter((f) => safe.has(f));
    if (allow.length) {
      e.renderCfg.features = allow;
      features = makeRoofFeatures(e.renderCfg);
    }
  }
```

- [ ] Add the `makeFeatures` import + a small wrapper at the top of `roof-ingame.js`. After the existing imports (@8-14), add:

```js
import { makeFeatures as makeRoofFeatures } from './roof-features.js';
```

- [ ] Run the suite (no pure-logic regressions): `node --test tools/roof/__tests__/*.test.js` → all passing.
- [ ] VISUAL VERIFY (in-game): re-screenshot the grassland village. PASS = ridge/hip lines now visible as subtle creases; residential buildings show finial/dormer/chimney where the rules assigned them; NO castle turrets/spires/buttresses on ordinary houses; frame rate unaffected (these are cheap per-frame passes on the occluder offscreen). Also confirm `roof-ingame-preview.html` still renders (it reads the same `surfaceOnly`).
- [ ] Commit:

```
git add tools/roof/roof-ingame.js
git commit -m "feat(roof): re-enable in-game accents + game-safe finial/dormer/chimney

surfaceOnly off + noAccents off; features gated to a safe allowlist (no crude
turret/spire/buttress). Dressing reads already-classified roof roles."
```

---

### Task 10 — Renderer: accept a `roofFascia` bitmap in `drawSkirt` (ROOF half of Lane Fix #4)

Wire the fascia drawing side FIRST, degrading to the existing procedural `fasciaColor` when no bitmap is supplied, so ROOF is not blocked on COORDINATION. The bitmap arrives via `cfg.roofFascia` (passed through `renderCfg` from `opts.roofFascia` in Task 11's patch).

**Files:** modify `tools/roof/roof-renderer.js`; modify `tools/roof/roof-ingame.js`

- [ ] Thread `cfg` into `drawSkirt`. The skirt loop (@171-173) calls `drawSkirt(ctx, grid, view, t, material)`; change BOTH the call and the signature to also pass `cfg`. At @171-173 change:

```js
  if (!cfg.noSkirt) for (const t of order) {
    if (t.isOverhang || t.role === 'eave') drawSkirt(ctx, grid, view, t, material);
  }
```
to:

```js
  if (!cfg.noSkirt) for (const t of order) {
    if (t.isOverhang || t.role === 'eave') drawSkirt(ctx, grid, view, t, material, cfg);
  }
```

- [ ] Change `drawSkirt`'s signature (@206) from `function drawSkirt(ctx, grid, view, t, material) {` to:

```js
function drawSkirt(ctx, grid, view, t, material, cfg) {
```

- [ ] In `drawSkirt`, replace the fill (@236-238) so it uses the fascia bitmap when present. Change:

```js
    const dShade = d === 's' ? 0.88 : d === 'n' ? 0.5 : 0.66; // sunlit south / shadowed north
    ctx.fillStyle = material.fasciaColor ? material.fasciaColor(dShade) : 'rgba(30,24,18,0.9)';
    ctx.fill();
```
to:

```js
    const dShade = d === 's' ? 0.88 : d === 'n' ? 0.5 : 0.66; // sunlit south / shadowed north
    const fasciaTex = cfg && cfg.roofFascia;
    if (fasciaTex) {
      // skin the eave/rake board with the authored roof_fascia.png (vertical strip),
      // clipped to the skirt quad, then dShade-darkened. Falls back below if absent.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(top1.x, top1.y); ctx.lineTo(top2.x, top2.y);
      ctx.lineTo(bot2.x, bot2.y); ctx.lineTo(bot1.x, bot1.y); ctx.closePath();
      ctx.clip();
      const minX = Math.min(top1.x, top2.x, bot1.x, bot2.x), maxX = Math.max(top1.x, top2.x, bot1.x, bot2.x);
      const minY = Math.min(top1.y, top2.y), maxY = Math.max(bot1.y, bot2.y);
      ctx.imageSmoothingEnabled = false;
      try { ctx.drawImage(fasciaTex, 0, 0, fasciaTex.width || 64, fasciaTex.height || 64, minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY)); } catch (e) { /* bad bitmap */ }
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.5, (1 - dShade) * 1.1)})`;
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = material.fasciaColor ? material.fasciaColor(dShade) : 'rgba(30,24,18,0.9)';
      ctx.fill();
    }
```

- [ ] Pass `opts.roofFascia` through into `renderCfg` in `drawRoofForBuilding` (`roof-ingame.js`). After the `e.renderCfg.texture = ...` assignment (@146-147) add:

```js
  // eave trim: the authored roof_fascia.png bitmap (from the occluder via the FROZEN
  // opts). Null in the preview (no imageCache) -> drawSkirt falls back to fasciaColor.
  e.renderCfg.roofFascia = opts.roofFascia || null;
```

- [ ] Run the suite (no pure-logic regressions): `node --test tools/roof/__tests__/*.test.js` → all passing.
- [ ] VISUAL VERIFY (preview, fallback path): open `roof-ingame-preview.html` — no `roofFascia` is supplied there, so the eave still uses `fasciaColor`; confirm no crash and the rake boards from Task 7 still render. (The in-game bitmap path is verified after Task 11 lands.)
- [ ] Commit:

```
git add tools/roof/roof-renderer.js tools/roof/roof-ingame.js
git commit -m "feat(roof): drawSkirt skins eave/rake with opts.roofFascia bitmap

Accepts cfg.roofFascia (roof_fascia.png) and falls back to procedural fasciaColor
when absent, so ROOF ships ahead of the occluder patch. Frozen signature untouched."
```

---

### Task 11 — PATCH REQUEST to COORDINATION / BUILDING-RENDER (the one shared touch, Lane Fix #4)

ROOF cannot edit `src/render/building-occluder.js`. This task records the exact by-name change for the owner of that file to apply, completing the fascia wiring. ROOF's side (Task 10) already accepts the data and degrades gracefully, so this is non-blocking.

**Files:** NONE owned by ROOF (this is a hand-off note — do NOT edit `building-occluder.js`).

- [ ] Produce the patch request and hand it to COORDINATION. The exact change:

  **File:** `src/render/building-occluder.js`
  **Imports (@21):** `roofTextureFile` is already imported from the registry; ADD `ROOF_FASCIA_FILE` to that same import line:
  ```js
  import { wallAssetDir, wallPieceFile, roofAssetDir, roofTextureFile, ROOF_FASCIA_FILE } from '../../sim/world/buildings/building-material-registry.js';
  ```
  (`ROOF_FASCIA_FILE = 'roof_fascia.png'` is already exported from `building-material-registry.js:1055`.)

  **Add a loader next to `roofTexFor` (@58-60):**
  ```js
  // The building's assigned eave-trim bitmap (roof_fascia.png), loaded lazily; null until
  // loaded or when the building has no roofSlug. Passed to the roof engine as opts.roofFascia.
  function roofFasciaFor(b) {
    return (b && b.biome && b.roofSlug) ? _imageCache.get(roofAssetDir(b.biome, b.roofSlug) + ROOF_FASCIA_FILE) : null;
  }
  ```

  **Ensure the fascia URL is in the lazy preload set.** Wherever `roofTexFor`'s URL (`roofAssetDir(b.biome,b.roofSlug)+roofTextureFile(0)`) is enqueued for `_imageCache` loading, ALSO enqueue `roofAssetDir(b.biome,b.roofSlug)+ROOF_FASCIA_FILE` (same biome/slug dir; the asset exists for all grassland materials — confirmed `assets/pixelab/buildings/roof/grassland/{thatch,clay_tile,wood_shingle,turf_sod}/roof_fascia.png`).

  **Both `drawRoofForBuilding` call-sites (@265 and @304):** add `roofFascia: roofFasciaFor(b)` to the opts object. The @265 call becomes:
  ```js
  if (_roof) { try { _roof.drawRoofForBuilding(o, b, camX, camY, tilePx, { stories: buildingFloors(b), northGapTiles: northGapTiles(b), imageCache: _imageCache, roofTexture: roofTexFor(b), roofFascia: roofFasciaFor(b) }); } catch { /* skip roof */ } }
  ```
  and the @304 call identically (with `ctx` instead of `o`).

  Note for COORDINATION: this adds a key to the FROZEN opts object but does NOT change existing keys; ROOF already reads `opts.roofFascia` defensively (`|| null`), so order of landing is safe.

- [ ] After COORDINATION lands the patch, VISUAL VERIFY (in-game bitmap path): re-screenshot grassland — the eave/rake boards now show the `roof_fascia.png` trim texture instead of the flat procedural color. PASS = fascia reads as authored eave trim; no crash on the 20 not-yet-generated biomes (they have no `roofSlug` → `null` → fallback). This task has NO ROOF commit (the commit belongs to COORDINATION's lane).

---

### Task 12 — Verify `drawAccents` ridge/hip/valley reads the re-enabled roles end-to-end

Now that accents are on in-game (Task 9), lock a test that the role classification feeding `drawAccents` is non-empty for a typical hip/gable so the dressing actually has tiles to stroke.

**Files:** modify `tools/roof/__tests__/roof-geometry.test.js`

- [ ] Append the test:

```js
test('hip+gable expose ridge tiles for drawAccents to stroke', () => {
  const hip = hipGrid();
  assert.ok(hip.roleTiles.ridge.length >= 1, 'hip has ridge tiles');
  const gable = buildRoofGrid([{ x0: 0, y0: 0, w: 13, h: 7 }],
    { style: 'gable', overhang: 1, overhangDroop: 0.18, noNorthOverhang: true, params: P });
  assert.ok(gable.roleTiles.ridge.length >= 1, 'gable has a ridge line');
});
```

- [ ] Run it (expected PASS — roles are already classified at `roof-geometry.js:226-242`): `node --test tools/roof/__tests__/roof-geometry.test.js` → all passing.
- [ ] Commit:

```
git add tools/roof/__tests__/roof-geometry.test.js
git commit -m "test(roof): assert ridge roles exist for re-enabled drawAccents

Locks that the in-game accent pass has tiles to stroke on hip+gable."
```

---

### Task 13 — Full-suite green + cross-path harness sign-off

**Files:** none (verification only).

- [ ] Run the entire roof test suite: `node --test tools/roof/__tests__/*.test.js` → ALL passing (geometry, uv, shade, skirt). Capture the count.
- [ ] Run the project sim suite to confirm no collateral breakage from the geometry record change: `npm test` (i.e. `node --test sim/test/*.test.js`) → green. (Roof modules are not imported by the sim suite, so this should be unaffected; confirm.)
- [ ] FINAL VISUAL SIGN-OFF, both paths, side-by-side before/after:
  - Procedural path: `tools/roof-ingame-preview.html` on `:8123` — cycle a few biomes (grassland, forest, mountains) + the roster (`cottage`, `manor`, `tavern`, `barn`, `town_hall`). Confirm: smooth slopes (no terraces), gable/rake boards on E/W ends, finial/dormer/chimney where assigned, no crude turrets.
  - In-game `cfg.texture` path: grassland village `?x=1175&y=305` on `:8123`, raw CDP `Page.captureScreenshot`. Confirm: continuous texture courses eave→ridge, smooth hip shade, fascia trim (after Task 11), real eave overhang capping the door, north edge not poking the neighbour.
- [ ] No commit (verification gate). If any check fails, return to the owning task before claiming completion (superpowers:verification-before-completion).

---

### Task 14 — Self-contained ROOF README note in the engine header (doc-only, no behavior change)

Leave the next reader a one-paragraph note on the two surface paths + the frozen signature + the fascia opt, since this lane changed both.

**Files:** modify `tools/roof/roof-ingame.js` (header comment only).

- [ ] Extend the file-top comment block (@1-6) with a note. Replace the existing closing line of the header (the line ending `...Roof grids/materials are cached per building.`) by appending after it:

```js
// TWO SURFACE PATHS: in-game skins each facet with a 64x64 roof_top PNG via
// opts.roofTexture (-> cfg.texture -> drawTexturedTile, continuous slope UV); the
// localhost preview passes no texture -> the procedural material.fillTile. opts is
// FROZEN by COORDINATION as {stories, northGapTiles, imageCache, roofTexture, roofFascia};
// roofFascia (roof_fascia.png) skins the eave/rake board, falling back to fasciaColor.
```

- [ ] Run the suite once more (no behavior change expected): `node --test tools/roof/__tests__/*.test.js` → all passing.
- [ ] Commit:

```
git add tools/roof/roof-ingame.js
git commit -m "docs(roof): note two surface paths + frozen opts incl roofFascia

Header guidance for the next reader; no behavior change."
```

---

## Self-Review — spec coverage for the ROOF lane

- **Lane Fix #1 — Tiled/banded surface (`roof-renderer.js:106-120`):** Tasks 2–4 replace the fixed `0,0,32,32` crop of the 64×64 swatch with a CONTINUOUS slope-space UV (`slopeUV` + `slopeAxis`) sampling the full `tex.width/height`, courses flow unbroken eave→ridge; continuity unit-tested (Task 3) and validated for diagonal smearing in the harness (Task 4). ✓
- **Lane Fix #2 — Constant-per-ring shade (hip terraces):** Task 5 derives shade from the geometry's corner-averaged normal + an along-run gradient (`smoothNormalShade`), so equal-`distEdge` rings differ; unit-tested both across-face and along-run. The hip HEIGHT field in `roof-styles.js` is intentionally left untouched (flagged in open concerns — the artifact is render-time, not geometry). ✓
- **Lane Fix #3 — Re-enable dressing shipped disabled:** Task 9 flips `surfaceOnly:false` + `noAccents:false` so `drawAccents` (ridge/hip/valley) and `roof-features.js` finial/dormer/chimney run in-game, reading roles already classified at `roof-geometry.js:226-242`; gated to a game-safe allowlist (no crude turret/spire/buttress). Task 12 locks ridge roles exist. ✓
- **Lane Fix #4 — Wire `roof_fascia.png`:** Task 10 implements the ROOF drawing side (`drawSkirt` consumes `cfg.roofFascia`, falls back to `fasciaColor`); Task 11 is the by-name PATCH REQUEST to COORDINATION for `building-occluder.js#roofTexFor`/call-sites (ROOF does not edit that file). ✓
- **Lane Fix #5 — Real eave overhang + N/E/W skirt bridge:** Task 6 adds `isGableRakeEdge`, Task 7 wires it so S+E/W rake ends bridge to the wall (was south-only @226) and re-introduces `overhangDroop=0.18`; Task 8 locks `noNorthOverhang` so the north edge can't poke the neighbour (clamp against `northGapTiles` preserved). ✓
- **Lane Fix #6 — Optional south-eave droop capping the door:** delivered by the small `overhangDroop` in Task 7 (the south overhang lip caps the door top); ships regardless of any depth pass. ✓
- **HARD CONSTRAINTS:** GL-only — all roof drawing stays on the occluder offscreen 2D canvas (`drawRoof(ctx,...)`), which `gl-compositor` blits into the scene FBO; no new 2D top-pass is added. No-mock — no faked roofs; absent roof assets degrade to procedural material / fallback. Buildings remain quantized 32px-multiple pieces (the roof is per-tile facets). Ownership glob respected: only `tools/roof/*.js`, `tools/roof/__tests__/*`, and (read-only) the preview HTML are touched; the one shared file is a patch request. Stage-by-name on every commit; small frequent commits; each commit message ends with a one-line note. ✓
- **Verification:** node:test for all pure logic (geometry/UV/shade/skirt); in-game harness on `:8123` with raw CDP screenshots for the `cfg.texture` path and `roof-ingame-preview.html` for the procedural path; before/after screenshot checks on each visual task. ✓