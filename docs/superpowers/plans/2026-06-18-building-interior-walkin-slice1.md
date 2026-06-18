# Building Interior — Walk-In, In-World (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Implement in the MAIN working tree (the :8000/:8123 dev servers serve it live; the orchestrator browser-verifies). Steps use checkbox syntax.

**Goal:** Make buildings DIEGETIC: the player walks through a doorway into a building (no click, no loading screen), the building's CURRENT floor renders in-world with real tiles at its real position with the player on top, the outer world dims, walking onto the stairs/lift changes floor, and walls block movement.

**Architecture:** The player never leaves world coordinates. "Inside" = an active-interior state (which building + which floor) that drives (a) an in-world render pass, (b) a collision gate, (c) a per-frame walk-onto trigger. Reuse `resolveFloorLayout` (footprint-LOCAL tiles; world = b.x+localX, b.y+localY), the real floor/wall sprites + loaders, and `resolveBuildingsInRange().byTile`/`footprint.doors`/`footprint.node`. This REPLACES the click→dollhouse overlay as the gameplay path (overlay code stays inert).

**Slice-1 scope (build now):** walk-in via door tile · render current floor in-world (floor + walls) · dim outer world (alpha scales mildly with floor index — a first taste of "world recedes") · south-wall see-through near the player · stairs change floor by movement direction · lift steps a floor (P2 merged → lift tile is walkable) · wall collision · exit on walking off the footprint.

**Deferred (recorded in memory, fast-follows):** full bokeh depth-of-field + fake clouds at high floors · smooth "world recedes" animation on floor change · E/W/N see-through for corridor/hallway shapes · roof-fade animation · per-floor/unit materials + furniture · lift floor-picker UI.

**Constraints:** no-mock; infinite-world (render only); the renderer is high-blast-radius — make minimal, anchored edits and `node --check` every file; do NOT touch the worker (`worker-chunk-renderer.js`), `resolved-buildings.js`, `gl-compositor.js`, `lg-catalog.js`; stage only this plan's files.

---

## File Structure

- **Create** `src/render/active-interior.js` — pure-ish state: which building/floor the player is in, the active floor `layout`, `enterAt/exitInterior/changeFloor`, and the collision predicate `isWalkableLocal`. Plus `dimAlphaForFloor(floorIndex)`.
- **Create** `src/render/interior-renderer.js` — `drawInteriorWorld(ctx, camX, camY, tilePx, w, h, playerTile)`: dims the outer world, draws the active floor's tiles + walls in-world, with south-wall see-through near the player.
- **Create** `sim/test/active-interior.test.js` — TDD the state + collision predicate.
- **Modify** `src/render/canvas-renderer.js` — replace the inert `drawFloorView` overlay call with the in-world interior passes at the right z-order seams.
- **Modify** `src/main.js` — remove the click→enter pointerdown + overlay keydowns; add the per-frame walk-in/stair/lift trigger after `player.update`, and inject interior collision into the movement object.
- **Modify** `src/physics/movement.js` — small helper export so collision can gate on the interior layout (or gate via a wrapped resolver in main.js — see Task 4).
- **Leave inert:** `src/render/floor-view.js`, `src/render/floor-view-state.js` (the click-overlay modeling tool — no longer wired to gameplay; keep for now).

---

## Task 1: Active-interior state + collision predicate (`active-interior.js`)

**Files:** Create `src/render/active-interior.js`, Test `sim/test/active-interior.test.js`

- [ ] **Step 1: Failing test**

```js
// sim/test/active-interior.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingNode } from '../world/buildings/blueprint-node.js';
import * as AI from '../../src/render/active-interior.js';

const TOWER = { bx: 0, by: 8, typeId: 'commercial', category: 'commercial', tier: 'town', centrality: 0.85 }; // lift, floors -1..4
const HOUSE = { bx: 0, by: 0, typeId: 'house', category: 'house', tier: 'village', centrality: 0.1 };

function fakeBuilding(ctx, x, y) { return { x, y, footprint: { node: buildingNode(1337, ctx) } }; }

test('enterAt starts on the lowest above-ground floor and records world origin', () => {
  const b = fakeBuilding(TOWER, 100, 200);
  const ai = AI.enterAt(b);
  assert.equal(ai.floorIndex, 0);
  assert.equal(ai.bx, 100); assert.equal(ai.by, 200);
  assert.ok(ai.layout && ai.layout.walkable instanceof Set, 'layout resolved for the start floor');
  assert.ok(AI.isInside());
  AI.exitInterior(); assert.equal(AI.isInside(), false);
});

test('changeFloor steps and clamps, re-resolving the layout', () => {
  AI.enterAt(fakeBuilding(TOWER, 0, 0)); // keys -1..4 start 0
  assert.equal(AI.changeFloor(-1), true); assert.equal(AI.getActiveInterior().floorIndex, -1);
  assert.equal(AI.changeFloor(-1), false, 'clamped at basement');
  for (let i = 0; i < 6; i++) AI.changeFloor(1);
  assert.equal(AI.getActiveInterior().floorIndex, 4, 'clamped at top');
  // layout follows the floor
  assert.equal(AI.getActiveInterior().layout.floorIndex, 4);
  AI.exitInterior();
});

test('isWalkableLocal: circulation + units + stair + lift walkable; walls/void block', () => {
  AI.enterAt(fakeBuilding(TOWER, 0, 0));
  const L = AI.getActiveInterior().layout;
  const [sx, sy] = [...L.walkable][0].split(',').map(Number);
  assert.equal(AI.isWalkableLocal(sx, sy), true, 'a circulation tile is walkable');
  if (L.stairTile) assert.equal(AI.isWalkableLocal(L.stairTile.x, L.stairTile.y), true, 'stair walkable');
  if (L.liftTile) assert.equal(AI.isWalkableLocal(L.liftTile.x, L.liftTile.y), true, 'lift walkable (P2)');
  const u0 = L.units[0]; const t = u0.tiles[0];
  assert.equal(AI.isWalkableLocal(t.x, t.y), true, 'a unit floor tile is walkable');
  assert.equal(AI.isWalkableLocal(9999, 9999), false, 'off-footprint void blocks');
  AI.exitInterior();
});

test('dimAlphaForFloor increases with height and clamps', () => {
  assert.ok(AI.dimAlphaForFloor(0) < AI.dimAlphaForFloor(3), 'higher floor dims more');
  assert.ok(AI.dimAlphaForFloor(50) <= 0.9, 'clamped');
  assert.ok(AI.dimAlphaForFloor(0) >= 0.3, 'ground floor already dims the outside');
});
```

- [ ] **Step 2: Run — expect FAIL** (`node --test sim/test/active-interior.test.js`)

- [ ] **Step 3: Implement `active-interior.js`**

```js
// src/render/active-interior.js — diegetic "inside a building" state (slice 1).
// The player never leaves world coordinates; this just tracks WHICH building/floor
// is active, the active floor layout (footprint-LOCAL tiles), the collision predicate,
// and the outer-world dim that grows with height. See feedback memory: interior-visual-vision.
import { resolveFloorLayout } from '../../sim/world/buildings/floor-layout.js';

let _ai = null; // { building, node, bx, by, floorKeys, floorIndex, layout, lastTrigger }

export function getActiveInterior() { return _ai; }
export function isInside() { return _ai !== null; }

/** Enter a building (b has .x,.y,.footprint.node). Starts on the lowest above-ground floor. */
export function enterAt(building) {
  const node = building.footprint.node;
  const floorKeys = node.childKeys().slice().sort((a, b) => a - b);
  const floorIndex = floorKeys.find(k => k >= 0) ?? floorKeys[0];
  _ai = { building, node, bx: building.x, by: building.y, floorKeys, floorIndex,
    layout: resolveFloorLayout(node, floorIndex), lastTrigger: null };
  return _ai;
}
export function exitInterior() { _ai = null; }

/** Step a floor (+1 up / -1 down). Clamped; re-resolves the layout. */
export function changeFloor(dir) {
  if (!_ai) return false;
  const next = _ai.floorKeys[_ai.floorKeys.indexOf(_ai.floorIndex) + dir];
  if (next === undefined) return false;
  _ai.floorIndex = next;
  _ai.layout = resolveFloorLayout(_ai.node, next);
  _ai.lastTrigger = null;
  return true;
}

/** Footprint-LOCAL walkability for the active floor (collision == draw). */
export function isWalkableLocal(lx, ly) {
  if (!_ai) return true;
  const L = _ai.layout;
  if (L.walkable.has(lx + ',' + ly)) return true;
  if (L.stairTile && L.stairTile.x === lx && L.stairTile.y === ly) return true;
  if (L.liftTile && L.liftTile.x === lx && L.liftTile.y === ly) return true;
  for (const u of L.units) if (u.tiles.some(t => t.x === lx && t.y === ly)) return true;
  return false;
}

/** Outer-world dim alpha — grows with height (first taste of "the world recedes").
 *  Full bokeh/clouds exaggeration is a deferred fast-follow. */
export function dimAlphaForFloor(floorIndex) {
  const above = Math.max(0, floorIndex);
  return Math.min(0.9, 0.35 + above * 0.06);
}
```

- [ ] **Step 4: Run — expect PASS** · **Step 5: Commit** (`git add src/render/active-interior.js sim/test/active-interior.test.js && git commit -m "feat(interior): active-interior state + collision predicate + height dim [walk-in slice 1]"`)

---

## Task 2: In-world interior renderer (`interior-renderer.js`)

**Files:** Create `src/render/interior-renderer.js` (browser-verified, no unit test — canvas pixels).

- [ ] **Step 1: Implement.** Reuse the floor/wall sprite loaders from `building-renderer.js` (`ensureFloorImages` / `_floorImgs` / `_wallImgs`) — export them if needed, or re-implement the same loader here. Draw with the SAME world projection (`sx = Math.floor(wx*tilePx - camX)`).

```js
// src/render/interior-renderer.js — draws the active building's CURRENT floor in-world
// (slice 1). Dims the outer world (grows with height), draws floor + walls at the real
// position, and makes the south wall see-through near the player so it never occludes them.
import { getActiveInterior, isInside, dimAlphaForFloor } from './active-interior.js';
import { ensureFloorImages, getFloorImg, getWallImg } from './building-renderer.js'; // add these exports (Task 2 Step 2)

/** Call AFTER terrain/water, BEFORE the player sprite draws (so the player lands on top). */
export function drawInteriorFloorWorld(ctx, camX, camY, tilePx, w, h) {
  if (!isInside()) return;
  ensureFloorImages();
  const ai = getActiveInterior();
  // 1) dim the outer world (height-scaled). Drawn first so the interior floor (next) is bright over it.
  ctx.save();
  ctx.fillStyle = `rgba(8,10,18,${dimAlphaForFloor(ai.floorIndex).toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);
  // 2) floor tiles for the active floor (circulation + every unit tile), in-world
  const L = ai.layout, t = Math.ceil(tilePx), pad = 1;
  const tiles = new Set(L.walkable);
  for (const u of L.units) for (const tl of u.tiles) tiles.add(tl.x + ',' + tl.y);
  ctx.imageSmoothingEnabled = false;
  const floorImg = getFloorImg(ai.building.footprint?.interior?.floor?.material) || getFloorImg('wood_plank');
  for (const k of tiles) {
    const [lx, ly] = k.split(',').map(Number);
    const sx = Math.floor((ai.bx + lx) * tilePx - camX), sy = Math.floor((ai.by + ly) * tilePx - camY);
    if (sx + t < 0 || sy + t < 0 || sx > w || sy > h) continue;
    if (floorImg) ctx.drawImage(floorImg, sx, sy, t + pad, t + pad);
  }
  // 3) stair + lift markers (placeholder tint until dedicated sprites land)
  marker(ctx, ai, L.stairTile, '#caa23a', camX, camY, tilePx, t);
  if (L.liftTile) marker(ctx, ai, L.liftTile, '#4aa6c8', camX, camY, tilePx, t);
  ctx.restore();
}

/** Call AFTER the player sprite, so walls occlude the player — EXCEPT the south wall near
 *  the player, which is drawn see-through (skipped) so it never hides the character. */
export function drawInteriorWallsWorld(ctx, camX, camY, tilePx, w, h, playerTile) {
  if (!isInside()) return;
  const ai = getActiveInterior(), L = ai.layout, t = Math.ceil(tilePx), pad = 1;
  const present = new Set(L.walkable);
  for (const u of L.units) for (const tl of u.tiles) present.add(tl.x + ',' + tl.y);
  const has = (x, y) => present.has(x + ',' + y);
  const plx = playerTile ? playerTile.x - ai.bx : null, ply = playerTile ? playerTile.y - ai.by : null;
  const wallImg = getWallImg('south_base');
  ctx.save(); ctx.imageSmoothingEnabled = false;
  for (const k of present) {
    const [lx, ly] = k.split(',').map(Number);
    if (has(lx, ly + 1)) continue;               // not a south edge
    // SEE-THROUGH: skip the south wall within 1 tile of the player so it never occludes them
    if (plx !== null && Math.abs(lx - plx) <= 1 && ly >= ply && ly - ply <= 1) continue;
    const wx = ai.bx + lx, wy = ai.by + ly;
    const sx = Math.floor(wx * tilePx - camX);
    const wallH = Math.round(tilePx * 1.2);
    const sy = Math.floor((wy + 1) * tilePx - camY) - wallH;
    if (sx + t < 0 || sx > w) continue;
    if (wallImg) ctx.drawImage(wallImg, 0, 0, 32, 128, sx, sy, t + pad, wallH + pad);
    else { ctx.fillStyle = '#3a4253'; ctx.fillRect(sx, sy, t, wallH); }
  }
  ctx.restore();
}

function marker(ctx, ai, tile, color, camX, camY, tilePx, t) {
  if (!tile) return;
  const sx = Math.floor((ai.bx + tile.x) * tilePx - camX), sy = Math.floor((ai.by + tile.y) * tilePx - camY);
  ctx.fillStyle = color; ctx.fillRect(sx + 2, sy + 2, t - 4, t - 4);
}
```

- [ ] **Step 2: Add the three exports to `src/render/building-renderer.js`** so the interior renderer reuses the loaded sprites (do NOT duplicate the image loaders):
```js
export function getFloorImg(mat) { return _floorImgs[mat] || _floorImgs.wood_plank || null; }
export function getWallImg(name) { return _wallImgs[name] || null; }
// ensureFloorImages is already a function — add `export` to its declaration.
```

- [ ] **Step 3: `node --check`** both files. **Step 4: Commit** (`git add src/render/interior-renderer.js src/render/building-renderer.js && git commit -m "feat(interior): in-world floor+wall renderer with dim + south-wall see-through [walk-in slice 1]"`)

---

## Task 3: Wire the interior passes into `canvas-renderer.js` (correct z-order)

**Files:** Modify `src/render/canvas-renderer.js`

- [ ] **Step 1:** Imports — replace the floor-view overlay import:
```js
import { drawInteriorFloorWorld, drawInteriorWallsWorld } from './interior-renderer.js';
```
- [ ] **Step 2:** At the DISABLED `drawBuildingFloors` call site (~line 326-336, after water/`updateBuildingClaims`, BEFORE the player/F2 sprites are drawn), add:
```js
drawInteriorFloorWorld(ctx, camX, camY, tilePx, w, h);
```
- [ ] **Step 3:** AFTER the player sprite / F2 animations are drawn (recon: near the existing post-F2 `drawBuildingWalls` hook ~line 420), add — passing the player's tile so the south wall opens up around them:
```js
drawInteriorWallsWorld(ctx, camX, camY, tilePx, w, h, { x: Math.floor(player.x), y: Math.floor(player.y) });
```
- [ ] **Step 4:** REMOVE the now-inert overlay call `drawFloorView(ctx, w, h, performance.now());` and its import (the click-overlay is retired from gameplay). Keep the files.
- [ ] **Step 5:** `node --check src/render/canvas-renderer.js`. Smoke-load is the orchestrator's job. **Commit** (`git add src/render/canvas-renderer.js && git commit -m "feat(interior): hook in-world interior floor (under player) + walls (over) into the frame [walk-in slice 1]"`)

---

## Task 4: Walk-in trigger + collision in `main.js` (+ movement seam)

**Files:** Modify `src/main.js`, `src/physics/movement.js`

- [ ] **Step 1:** Imports in `main.js`:
```js
import * as AI from './render/active-interior.js';
import { resolveBuildingsInRange } from '../sim/world/buildings/resolved-buildings.js'; // if not already imported
```
- [ ] **Step 2:** REMOVE the old click→enter `canvas.addEventListener('pointerdown', …)` and the overlay keydown handlers (`,`/`.`/`f`/`l`/Esc → FV) added previously. (The walk-in trigger replaces them.)
- [ ] **Step 3:** Add the interior collision gate **inside `src/physics/movement.js`** — placed exactly where terrain is already gated, so we reuse the existing per-axis blocking and don't guess `resolveMovement`'s return shape. `main.js` keeps calling `player.update(...)` with the unchanged movement object.
  1. Import at the top of `movement.js`: `import { isInside, getActiveInterior, isWalkableLocal } from '../render/active-interior.js';` (no import cycle: active-interior → floor-layout only).
  2. READ `resolveMovement` (~136-153) and `canOccupy`/`canEnterTile` to find where each candidate axis destination is accepted/rejected.
  3. At that same per-axis acceptance point, add: `if (isInside()) { const ai = getActiveInterior(); if (!isWalkableLocal(Math.floor(destX) - ai.bx, Math.floor(destY) - ai.by)) { /* reject this axis exactly as a failed canOccupy does */ } }` — using whatever local variable holds the candidate destination for that axis. When NOT inside, the gate is a no-op and open-world movement stays byte-identical.
> The point is correctness: after this, walking into a wall tile is blocked the same way walking into impassable terrain is. Verify by reading the real code — do not leave collision that fails to block.

- [ ] **Step 4:** Add the per-frame walk-in / floor-change trigger AFTER `player.update(...)`:
```js
{
  const ptx = Math.floor(player.x), pty = Math.floor(player.y);
  if (!AI.isInside()) {
    // entering: stand on a building door tile → walk in
    const mt = MACRO * REGION; const mx = Math.floor(ptx / mt), my = Math.floor(pty / mt);
    const { byTile } = resolveBuildingsInRange(getWorldSeed(), mx, my, mx, my);
    const b = byTile.get(ptx + ',' + pty);
    if (b && b.footprint && b.footprint.node && (b.footprint.doors || []).some(d => b.x + d.x === ptx && b.y + d.y === pty)) {
      AI.enterAt(b);
    }
  } else {
    const ai = AI.getActiveInterior();
    const lx = ptx - ai.bx, ly = pty - ai.by;
    // exit: walked off the footprint
    if (!AI.isWalkableLocal(lx, ly)) { /* off-floor: only happens at the door edge */ }
    const onFootprint = ai.layout.walkable.has(lx + ',' + ly) || ai.layout.units.some(u => u.tiles.some(t => t.x === lx && t.y === ly)) || (ai.layout.stairTile && ai.layout.stairTile.x === lx && ai.layout.stairTile.y === ly) || (ai.layout.liftTile && ai.layout.liftTile.x === lx && ai.layout.liftTile.y === ly);
    if (!onFootprint) { AI.exitInterior(); }
    else {
      const trig = lx + ',' + ly;
      const onStair = ai.layout.stairTile && ai.layout.stairTile.x === lx && ai.layout.stairTile.y === ly;
      const onLift = ai.layout.liftTile && ai.layout.liftTile.x === lx && ai.layout.liftTile.y === ly;
      if ((onStair || onLift) && ai.lastTrigger !== trig) {
        const ax = input.axis ? input.axis() : { x: 0, y: 0 };
        const dir = ax.y < -0.2 ? 1 : ax.y > 0.2 ? -1 : 1; // push up/north = ascend, down = descend, default up
        AI.changeFloor(dir);
        ai.lastTrigger = trig;
      } else if (!onStair && !onLift) {
        ai.lastTrigger = null; // reset edge-trigger when off the stair/lift
      }
    }
  }
}
```
> Adapt `MACRO`/`REGION`/`getWorldSeed`/`input.axis` to the real imports already in `main.js` (recon confirms `axis()` exists on InputState; `MACRO`/`REGION`/`getWorldSeed` may need importing — mirror `building-renderer.js`).

- [ ] **Step 5:** `node --check src/main.js src/physics/movement.js`. **Commit** (`git add src/main.js src/physics/movement.js && git commit -m "feat(interior): walk-in via door tile + walk-onto stairs/lift + wall collision [walk-in slice 1]"`)

---

## Task 5: Headless + browser verification (orchestrator)

- [ ] Run `node --test sim/test/active-interior.test.js` → green.
- [ ] In-browser (Playwright, capture via canvas toDataURL — page.screenshot is unreliable on this GPU page): teleport/move the player onto a building's door tile, confirm the interior renders in-world with the player on top + outer world dimmed; walk onto the stair and confirm the floor changes + dim deepens; confirm walls block; walk off the footprint to exit. Screenshot each and show the user. Tune dim/see-through/wall-height live.

---

## Self-Review
- Walk-in (no click/load) → Task 4 trigger. In-world current-floor render → Task 2/3. Dim outer world + height dim → `dimAlphaForFloor` + Task 2. South-wall see-through near player → `drawInteriorWallsWorld`. Stairs by movement dir + lift → Task 4. Collision → Task 4 + `isWalkableLocal`. Reuse: `resolveFloorLayout`, sprites, `byTile`/`doors`/`node`.
- Placeholder scan: stair/lift markers + a single wood floor material are intentional slice-1 placeholders (real per-floor materials + dedicated stair/lift sprites + bokeh/clouds are deferred, recorded in memory). The `resolveMovement` wrapper + the `main.js:224` call shape must be adapted to the REAL signatures (flagged inline) — the implementer reads them and conforms.
