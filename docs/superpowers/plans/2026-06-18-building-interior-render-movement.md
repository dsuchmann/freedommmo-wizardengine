# Building Interior — Render & Movement Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **Implement in the MAIN working tree (not an isolated worktree)** — the `:8000` dev server serves the working tree live, and the final task is in-browser verification.

**Goal:** A main-thread "interior floor view" overlay in the running game: click a building to enter, see one floor at a time top-down (dollhouse-cutaway default / floor-plan toggle), slide between floors via the stair, take the lift to a chosen floor, and click a unit to enter it.

**Architecture:** A dedicated full-screen **floor-view mode** drawn on the main thread on top of the dimmed world (the inline floor draw is deliberately disabled at `canvas-renderer.js:326-330` for z-order/lighting reasons — we do NOT re-enable it; we add a separate mode). A pure state module owns `{node, floorIndex, transition, enteredUnit}`. The renderer consumes `resolveFloorLayout(b.footprint.node, floorIndex)` (Plan 1) and ports the proven, signed-off mockup draw/animation code. Input adds a canvas `pointerdown` + a few keys.

**Tech Stack:** Vanilla canvas 2D, ESM. Headless unit tests (`node:test`) for the pure state machine + transform math; the pixel rendering is verified in-browser (project rule: every pass ends experienceable in the running game — canvas pixels can't be meaningfully unit-tested).

**Source of truth for the visuals:** the signed-off mockup `.superpowers/brainstorm/mockup-staging/floor-view.html` — its `view()`, `drawFloor`, `drawWalls`, `glyphStair`, `glyphLift`, and `render()` animation are the proven reference to port. The game uses the SAME orthographic top-down projection the mockup used.

**Authority:** spec `…/specs/2026-06-18-building-interior-render-movement-design.md` §3-§5; render hook map (recon). Plan 1 (data foundation) is merged: `resolveFloorLayout`, `subFloors`/`privateStair`, shared lift core all green.

**Constraints:** infinite-world purity (render-only here, no sim mutation); no-mock; don't touch other sessions' files (`resolved-buildings.js`, `gl-compositor.js`, `lg-catalog.js`); the worker is fragile — this plan adds NO worker code; bump the worker cache-bust on any building-code change; stage only this plan's files.

---

## File Structure

- **Create** `src/render/floor-view-state.js` — pure interaction state machine (no DOM/canvas). Owns the active building node, floor index, transition, entered unit. Exports `enterBuilding/exitFloorView/changeFloor/gotoFloor/clearTransition/enterUnit/exitUnit/getFloorView/isFloorViewActive/liftAvailable`.
- **Create** `src/render/floor-view.js` — the overlay: world-transform stash (`updateFloorViewTransform`, `screenToWorldTile`), the centered focus transform (`focusTransform`), the interior renderer (`drawFloorView`), and click picking inside the view (`pickInFloorView`). Wall-style toggle lives here.
- **Modify** `src/render/canvas-renderer.js` — stash the world transform each frame (after `updateBuildingClaims`, ~line 324); after the debug overlay (~line 441-442), if floor view is active call `drawFloorView(ctx, w, h, performance.now())`.
- **Modify** `src/main.js` — after the canvas/input boot (~line 24-27): a `pointerdown` listener (enter a building via the resolved set, or route clicks inside the floor view), and keydown wiring (Esc = exit/step-out, `[`/`]` or `,`/`.` = floor down/up, `f` = wall-style toggle, `l` = lift menu).
- **Modify** `src/world/chunk-provider.js` — bump the cache-bust token (line ~134).
- **Create** tests `sim/test/floor-view-state.test.js`, `sim/test/floor-view-transform.test.js`.

---

## Task 1: Floor-view state machine (`floor-view-state.js`)

**Files:**
- Create: `src/render/floor-view-state.js`
- Test: `sim/test/floor-view-state.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/floor-view-state.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingNode } from '../world/buildings/blueprint-node.js';
import * as FV from '../../src/render/floor-view-state.js';

const TOWER = { bx: 0, by: 8, typeId: 'commercial', category: 'commercial', tier: 'town', centrality: 0.85 }; // has lift, floors -1..4
const HOUSE = { bx: 0, by: 0, typeId: 'house', category: 'house', tier: 'village', centrality: 0.1 };          // 1 floor, no lift

test('enterBuilding starts on the lowest above-ground floor and clears on exit', () => {
  const fv = FV.enterBuilding(buildingNode(1337, TOWER), 'b1');
  assert.equal(fv.floorIndex, 0, 'ground = lowest index >= 0 (basement is -1)');
  assert.ok(FV.isFloorViewActive());
  FV.exitFloorView();
  assert.equal(FV.isFloorViewActive(), false);
  assert.equal(FV.getFloorView(), null);
});

test('changeFloor moves by ±1 and clamps to the floor range', () => {
  FV.enterBuilding(buildingNode(1337, TOWER), 'b1'); // keys -1..4, start 0
  assert.equal(FV.changeFloor(-1), true); assert.equal(FV.getFloorView().floorIndex, -1); FV.clearTransition();
  assert.equal(FV.changeFloor(-1), false, 'cannot go below the basement'); FV.clearTransition?.();
  assert.equal(FV.getFloorView().floorIndex, -1);
  for (let i = 0; i < 5; i++) { FV.changeFloor(1); FV.clearTransition(); }
  assert.equal(FV.getFloorView().floorIndex, 4, 'clamped at the top floor');
  assert.equal(FV.changeFloor(1), false, 'cannot go above the top');
  FV.exitFloorView();
});

test('lift gating: lift only available when the building has a lift', () => {
  FV.enterBuilding(buildingNode(1337, TOWER), 'b1');
  assert.equal(FV.liftAvailable(), true);
  assert.equal(FV.gotoFloor(3, 'lift'), true); FV.clearTransition();
  assert.equal(FV.getFloorView().floorIndex, 3);
  FV.exitFloorView();
  FV.enterBuilding(buildingNode(1337, HOUSE), 'b2');
  assert.equal(FV.liftAvailable(), false);
  assert.equal(FV.gotoFloor(0, 'lift'), false, 'no lift jumps without a lift');
  FV.exitFloorView();
});

test('a transition records {kind, from, dir} and blocks further moves until cleared', () => {
  FV.enterBuilding(buildingNode(1337, TOWER), 'b1');
  assert.equal(FV.changeFloor(1), true);
  const tr = FV.getFloorView().transition;
  assert.equal(tr.kind, 'stair'); assert.equal(tr.from, 0); assert.equal(tr.dir, 1);
  assert.equal(FV.changeFloor(1), false, 'blocked mid-transition');
  FV.clearTransition();
  assert.equal(FV.getFloorView().transition, null);
  assert.equal(FV.changeFloor(1), true, 'moves again once cleared'); FV.clearTransition();
  FV.exitFloorView();
});

test('enter/exit unit toggles enteredUnitId', () => {
  FV.enterBuilding(buildingNode(1337, TOWER), 'b1');
  FV.enterUnit('u-1'); assert.equal(FV.getFloorView().enteredUnitId, 'u-1');
  FV.exitUnit(); assert.equal(FV.getFloorView().enteredUnitId, null);
  FV.exitFloorView();
});
```

- [ ] **Step 2: Run it — expect FAIL** (`node --test sim/test/floor-view-state.test.js`) — module missing.

- [ ] **Step 3: Implement `floor-view-state.js`**

```js
// src/render/floor-view-state.js — pure interaction state for the interior floor view
// (spec §4-§5). No DOM/canvas/time. The renderer reads getFloorView(); input mutates via
// the exported actions. A transition records intent only; the renderer owns its clock.
let _fv = null;

export function getFloorView() { return _fv; }
export function isFloorViewActive() { return _fv !== null; }

/** Enter a building's interior. Starts on the lowest ABOVE-ground floor (not blindly 0). */
export function enterBuilding(node, buildingId) {
  const floorKeys = node.childKeys().slice().sort((a, b) => a - b);
  const start = floorKeys.find(k => k >= 0) ?? floorKeys[0];
  _fv = { node, buildingId, floorKeys, floorIndex: start, enteredUnitId: null, transition: null };
  return _fv;
}
export function exitFloorView() { _fv = null; }

/** A lift exists iff the building reserved one (aboveGroundFloors > 3). */
export function liftAvailable() { return !!(_fv && _fv.node.payload.lift); }

/** Step one floor up (+1) or down (-1). Clamped; blocked mid-transition. */
export function changeFloor(dir) {
  if (!_fv || _fv.transition) return false;
  const next = _fv.floorKeys[_fv.floorKeys.indexOf(_fv.floorIndex) + dir];
  if (next === undefined) return false;
  return gotoFloor(next, 'stair');
}

/** Jump to a specific floor. kind 'stair' (adjacent slide) or 'lift' (express, gated). */
export function gotoFloor(target, kind) {
  if (!_fv || _fv.transition) return false;
  if (!_fv.floorKeys.includes(target) || target === _fv.floorIndex) return false;
  if (kind === 'lift' && !liftAvailable()) return false;
  const from = _fv.floorIndex;
  _fv.transition = { kind, from, dir: Math.sign(target - from) };
  _fv.floorIndex = target;
  _fv.enteredUnitId = null;
  return true;
}

export function clearTransition() { if (_fv) _fv.transition = null; }
export function enterUnit(unitId) { if (_fv) _fv.enteredUnitId = unitId; }
export function exitUnit() { if (_fv) _fv.enteredUnitId = null; }
```

- [ ] **Step 4: Run it — expect PASS** (`node --test sim/test/floor-view-state.test.js`)

- [ ] **Step 5: Commit**

```bash
git add src/render/floor-view-state.js sim/test/floor-view-state.test.js
git commit -m "feat(render): floor-view interaction state machine (enter/floor/lift/unit)"
```

---

## Task 2: Floor-view overlay module (`floor-view.js`)

**Files:**
- Create: `src/render/floor-view.js`
- Test: `sim/test/floor-view-transform.test.js` (transform math only; pixel drawing is browser-verified in Task 5)

- [ ] **Step 1: Write the failing test for the transform math**

```js
// sim/test/floor-view-transform.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateFloorViewTransform, screenToWorldTile, focusTransform } from '../../src/render/floor-view.js';

test('screenToWorldTile inverts the stashed world transform', () => {
  // world transform: screenX = wx*tilePx - camX → wx = (screenX + camX)/tilePx
  updateFloorViewTransform(/*camX*/100, /*camY*/50, /*tilePx*/40, 800, 600);
  const p = screenToWorldTile(300, 250);
  assert.equal(p.tileX, (300 + 100) / 40);
  assert.equal(p.tileY, (250 + 50) / 40);
});

test('focusTransform fits a floor bounds inside the viewport, centered', () => {
  const layout = { bounds: { minX: 4, minY: 0, maxX: 15, maxY: 8 } }; // 12 x 9 tiles
  const V = focusTransform(layout, 1000, 700);
  assert.ok(V.tile > 0 && V.tile <= 54, 'tile size clamped');
  // a tile at the bounds centre maps near screen centre
  const cx = (4 + 15) / 2, cy = (0 + 8) / 2;
  const sx = V.ox + cx * V.tile, sy = V.oy + cy * V.tile;
  assert.ok(Math.abs(sx - 500) < V.tile * 1.5, 'horizontally centered');
  assert.ok(Math.abs(sy - 350) < V.tile * 2.5, 'vertically centered (slight top bias for walls)');
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing). `node --test sim/test/floor-view-transform.test.js`

- [ ] **Step 3: Implement `floor-view.js`**

Port the proven mockup functions, adapting: (a) data source = `resolveFloorLayout(node, floorIndex)` output (`walkable:Set`, `units:[{id,unitKind,tiles,doorTile}]`, `stairTile`, `liftTile`, `multiFloorUnits`, `bounds`) instead of the mockup's raw floor payload; (b) keep the mockup's orthographic projection and the **dollhouse-cutaway/floor-plan** wall toggle; (c) colors from the mockup palette (`UNIT_COLORS`, `--circ`, stair/lift/door). Full module:

```js
// src/render/floor-view.js — main-thread interior floor-view overlay (spec §3-§5).
// Ported from the signed-off mockup (.superpowers/brainstorm/mockup-staging/floor-view.html).
// Draws ONE floor at a time on a centered focus transform, on top of the dimmed world,
// with stair-slide / lift-express transitions. Consumes resolveFloorLayout (Plan 1).
import { resolveFloorLayout } from '../../sim/world/buildings/floor-layout.js';
import {
  getFloorView, isFloorViewActive, changeFloor, gotoFloor, clearTransition,
  enterUnit, exitUnit,
} from './floor-view-state.js';

// ── world transform stash (for the ENTER click: screen → which building) ──
let _world = { camX: 0, camY: 0, tilePx: 32, w: 0, h: 0 };
export function updateFloorViewTransform(camX, camY, tilePx, w, h) { _world = { camX, camY, tilePx, w, h }; }
export function screenToWorldTile(sx, sy) {
  return { tileX: (sx + _world.camX) / _world.tilePx, tileY: (sy + _world.camY) / _world.tilePx };
}

// ── wall style toggle ──
let _wallStyle = 'doll'; // 'doll' | 'plan'
export function toggleWallStyle() { _wallStyle = _wallStyle === 'doll' ? 'plan' : 'doll'; }

// ── centered focus transform (ported from mockup view()) ──
export function focusTransform(layout, w, h) {
  const b = layout.bounds, pad = 2.2;
  const bw = b.maxX - b.minX + 1, bh = b.maxY - b.minY + 1;
  const tile = Math.max(16, Math.min(54, Math.min(w / (bw + pad), h / (bh + pad + 1.4))));
  const ox = (w - bw * tile) / 2 - b.minX * tile;
  const oy = (h - bh * tile) / 2 - b.minY * tile + tile * 0.5;
  return { tile, ox, oy };
}

const UNIT_COLORS = { apartment:'#6f8fb8', shop:'#c9a14b', business:'#c9a14b', house:'#7fa86b',
  lobby:'#9aa3b5', common:'#9aa3b5', hall:'#9aa3b5', gallery:'#8f86b8', storage:'#8a7a64', crypt:'#7a6f86', default:'#7a6a52' };
const COL = { circ:'#3b4663', door:'#c98a4b', stair:'#ffc24a', lift:'#5ad1ff' };
const unitColor = k => UNIT_COLORS[k] || UNIT_COLORS.default;

// Animation tuning
const STAIR_MS = 360, LIFT_MS = 600;
let _transStart = null, _transRef = null;

/** Resolve the layout for a given floor of the active building (memoized per floor index). */
let _layoutCache = { key: '', layout: null };
function layoutFor(fv, floorIndex) {
  const key = `${fv.buildingId}:${floorIndex}`;
  if (_layoutCache.key !== key) _layoutCache = { key, layout: resolveFloorLayout(fv.node, floorIndex) };
  return _layoutCache.layout;
}

/** MAIN ENTRY — call from canvas-renderer after the world + overlays are drawn. */
export function drawFloorView(ctx, w, h, now) {
  if (!isFloorViewActive()) { _transStart = null; _transRef = null; return; }
  const fv = getFloorView();

  // dim the world behind the floor view (reuse the renderer's fillRect-dim idiom)
  ctx.save();
  ctx.fillStyle = 'rgba(10,13,20,0.78)';
  ctx.fillRect(0, 0, w, h);

  const layout = layoutFor(fv, fv.floorIndex);
  const V = focusTransform(layout, w, h);

  if (fv.transition) {
    if (_transRef !== fv.transition) { _transRef = fv.transition; _transStart = now; }
    const dur = fv.transition.kind === 'lift' ? LIFT_MS : STAIR_MS;
    const k = Math.min(1, (now - _transStart) / dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOut
    const slide = h * 0.9, dir = fv.transition.dir;
    const fromLayout = layoutFor(fv, fv.transition.from);
    const Vf = focusTransform(fromLayout, w, h);
    const factor = fv.transition.kind === 'lift' ? 0.25 : 1;
    drawFloorLayer(ctx, fromLayout, Vf, 1 - e, dir * slide * factor * e, w, h);
    drawFloorLayer(ctx, layout, V, e, -dir * slide * factor * (1 - e), w, h);
    if (k >= 1) { clearTransition(); _transRef = null; }
  } else {
    drawFloorLayer(ctx, layout, V, 1, 0, w, h);
  }

  drawHud(ctx, fv, layout, w, h);
  ctx.restore();
}

// ── per-floor draw (ported from mockup drawFloor + drawWalls + glyphs) ──
function drawFloorLayer(ctx, layout, V, alpha, yShift, w, h) {
  const { tile, ox, oy } = V;
  const sx = x => ox + x * tile, sy = y => oy + y * tile + yShift;
  ctx.save(); ctx.globalAlpha = alpha;
  const present = new Set(layout.walkable);
  for (const u of layout.units) for (const t of u.tiles) present.add(`${t.x},${t.y}`);

  // drop shadow
  ctx.fillStyle = '#0008';
  for (const k of present) { const [x, y] = k.split(',').map(Number); ctx.fillRect(sx(x) + 2, sy(y) + 3, tile, tile); }
  // circulation
  ctx.fillStyle = COL.circ;
  for (const k of layout.walkable) { const [x, y] = k.split(',').map(Number); ctx.fillRect(sx(x), sy(y), tile - 1, tile - 1); }
  // units (+ multi-floor badge)
  const multi = new Set(layout.multiFloorUnits);
  for (const u of layout.units) {
    ctx.fillStyle = unitColor(u.unitKind);
    for (const t of u.tiles) ctx.fillRect(sx(t.x), sy(t.y), tile - 1, tile - 1);
    outline(ctx, u.tiles, sx, sy, tile, '#0b0e14', 2);
    const c = centroid(u.tiles);
    label(ctx, multi.has(u.id) ? `${u.unitKind} ⇡` : u.unitKind, sx(c.x) + tile / 2, sy(c.y) + tile / 2);
  }
  // doors
  ctx.fillStyle = COL.door;
  for (const u of layout.units) ctx.fillRect(sx(u.doorTile.x) + tile * 0.3, sy(u.doorTile.y) + tile * 0.3, tile * 0.4, tile * 0.4);
  // walls (dollhouse-cutaway default / floor-plan)
  drawWalls(ctx, present, sx, sy, tile);
  // stair + lift glyphs (fixed per-column positions)
  if (layout.stairTile) glyph(ctx, sx(layout.stairTile.x), sy(layout.stairTile.y), tile, COL.stair, '≡');
  if (layout.liftTile) glyph(ctx, sx(layout.liftTile.x), sy(layout.liftTile.y), tile, COL.lift, '⇅');
  ctx.restore();
}

function drawWalls(ctx, present, sx, sy, tile) {
  const has = (x, y) => present.has(`${x},${y}`);
  const wH = _wallStyle === 'plan' ? 0 : tile * 0.85;
  const nearH = _wallStyle === 'plan' ? 0 : tile * 0.18;
  for (const k of present) {
    const [x, y] = k.split(',').map(Number); const X = sx(x), Y = sy(y);
    if (!has(x, y - 1)) { // far/north wall
      if (wH > 0) { ctx.fillStyle = '#3a4253'; ctx.fillRect(X, Y - wH, tile, wH); brick(ctx, X, Y - wH, tile, wH); }
      else stroke(ctx, X, Y, X + tile, Y);
    }
    if (!has(x, y + 1)) { // near/south sill (cutaway)
      if (nearH > 0) { ctx.fillStyle = '#525c70'; ctx.fillRect(X, Y + tile - nearH, tile, nearH); }
      else stroke(ctx, X, Y + tile, X + tile, Y + tile);
    }
    if (!has(x - 1, y)) { ctx.fillStyle = _wallStyle === 'plan' ? '#0b0e14' : '#454e60'; ctx.fillRect(X, Y, Math.max(2, tile * 0.1), tile); }
    if (!has(x + 1, y)) { ctx.fillStyle = _wallStyle === 'plan' ? '#0b0e14' : '#454e60'; ctx.fillRect(X + tile - Math.max(2, tile * 0.1), Y, Math.max(2, tile * 0.1), tile); }
  }
}

// ── small helpers (ported) ──
function centroid(ts) { let x = 0, y = 0; for (const t of ts) { x += t.x; y += t.y; } return { x: x / ts.length, y: y / ts.length }; }
function stroke(ctx, x0, y0, x1, y1) { ctx.strokeStyle = '#0b0e14'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
function brick(ctx, X, Y, w, h) { ctx.strokeStyle = '#0007'; ctx.lineWidth = 1; const r = Math.max(4, h / 4); for (let yy = Y; yy < Y + h; yy += r) { ctx.beginPath(); ctx.moveTo(X, yy); ctx.lineTo(X + w, yy); ctx.stroke(); } }
function outline(ctx, ts, sx, sy, t, style, lw) { const s = new Set(ts.map(p => `${p.x},${p.y}`)); ctx.strokeStyle = style; ctx.lineWidth = lw; for (const p of ts) { const X = sx(p.x), Y = sy(p.y); ctx.beginPath();
  if (!s.has(`${p.x},${p.y - 1}`)) { ctx.moveTo(X, Y); ctx.lineTo(X + t, Y); }
  if (!s.has(`${p.x},${p.y + 1}`)) { ctx.moveTo(X, Y + t); ctx.lineTo(X + t, Y + t); }
  if (!s.has(`${p.x - 1},${p.y}`)) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + t); }
  if (!s.has(`${p.x + 1},${p.y}`)) { ctx.moveTo(X + t, Y); ctx.lineTo(X + t, Y + t); }
  ctx.stroke(); } }
function label(ctx, text, cx, cy) { ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const wbg = ctx.measureText(text).width + 8; ctx.fillStyle = '#0c0f15cc'; ctx.fillRect(cx - wbg / 2, cy - 8, wbg, 15); ctx.fillStyle = '#fff'; ctx.fillText(text, cx, cy); }
function glyph(ctx, X, Y, t, color, ch) { ctx.fillStyle = color; ctx.fillRect(X + 1, Y + 1, t - 2, t - 2); ctx.fillStyle = '#10131a'; ctx.font = `bold ${Math.round(t * 0.6)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, X + t / 2, Y + t / 2); }

// ── HUD: floor pill, use, controls hint, entered-unit card ──
function drawHud(ctx, fv, layout, w, h) {
  ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(20,24,33,0.85)'; ctx.fillRect(12, 12, 230, 46);
  ctx.fillStyle = '#ffc24a'; ctx.font = 'bold 15px sans-serif';
  ctx.fillText(`Floor ${fv.floorIndex}${fv.floorIndex < 0 ? ' (basement)' : fv.floorIndex === 0 ? ' (ground)' : ''}`, 20, 32);
  ctx.fillStyle = '#94a0b6'; ctx.font = '12px sans-serif';
  ctx.fillText(`${layout.use} · ${layout.units.length} unit(s) · [,/.] floor · ${liftHint(fv)}Esc exit`, 20, 50);
  if (fv.enteredUnitId) {
    const u = layout.units.find(u => u.id === fv.enteredUnitId);
    if (u) { ctx.fillStyle = 'rgba(20,24,33,0.95)'; const txt = `Entered ${u.unitKind} — Esc to step out`; const tw = ctx.measureText(txt).width + 24;
      ctx.fillRect((w - tw) / 2, h - 48, tw, 28); ctx.fillStyle = '#ffc24a'; ctx.fillText(txt, (w - tw) / 2 + 12, h - 30); }
  }
}
function liftHint(fv) { return fv.node.payload.lift ? '[l] lift · ' : ''; }

/** Click picking INSIDE the floor view: returns {type:'stair'|'lift'|'unit'|'empty', unitId?}. */
export function pickInFloorView(screenX, screenY, w, h) {
  const fv = getFloorView(); if (!fv || fv.transition) return { type: 'empty' };
  const layout = layoutFor(fv, fv.floorIndex);
  const V = focusTransform(layout, w, h);
  const tx = Math.floor((screenX - V.ox) / V.tile), ty = Math.floor((screenY - V.oy) / V.tile);
  if (layout.stairTile && layout.stairTile.x === tx && layout.stairTile.y === ty) return { type: 'stair' };
  if (layout.liftTile && layout.liftTile.x === tx && layout.liftTile.y === ty) return { type: 'lift' };
  for (const u of layout.units) if (u.tiles.some(t => t.x === tx && t.y === ty)) return { type: 'unit', unitId: u.id };
  return { type: 'empty' };
}
```

- [ ] **Step 4: Run the transform test — expect PASS** (`node --test sim/test/floor-view-transform.test.js`)

- [ ] **Step 5: Commit**

```bash
git add src/render/floor-view.js sim/test/floor-view-transform.test.js
git commit -m "feat(render): interior floor-view overlay (port mockup draw + transitions + picking)"
```

---

## Task 3: Wire the overlay into `canvas-renderer.js`

**Files:** Modify `src/render/canvas-renderer.js`

- [ ] **Step 1: Add imports** (near the other render imports at the top)

```js
import { updateFloorViewTransform, drawFloorView } from './floor-view.js';
```

- [ ] **Step 2: Stash the world transform each frame** — immediately after `updateBuildingClaims(camX, camY, tilePx, w, h);` (~line 324):

```js
updateFloorViewTransform(camX, camY, tilePx, w, h);
```

- [ ] **Step 3: Draw the overlay last** — after the `drawSimDebugOverlay(...)` / `drawWallTuner(...)` calls (~line 441-442), add:

```js
drawFloorView(ctx, w, h, performance.now());
```

- [ ] **Step 4: Manual smoke check** — load `http://127.0.0.1:8000/index.html`; the game renders normally (floor view inactive draws nothing). No console errors. (Bump cache-bust in Task 5 before reload.)

- [ ] **Step 5: Commit**

```bash
git add src/render/canvas-renderer.js
git commit -m "feat(render): hook floor-view overlay + transform stash into the frame loop"
```

---

## Task 4: Input wiring in `main.js`

**Files:** Modify `src/main.js`

- [ ] **Step 1: Add imports** (top of `main.js`)

```js
import { resolveBuildingsInRange } from '../sim/world/buildings/resolved-buildings.js';
import { getWorldSeed } from './core/world-seed.js';
import { MACRO } from '../sim/world/genesis.js';
import { REGION } from '../sim/lod/aggregate.js';
import { screenToWorldTile, pickInFloorView, toggleWallStyle } from './render/floor-view.js';
import * as FV from './render/floor-view-state.js';
```

- [ ] **Step 2: Add the pointer + key handlers** — after `const input = new InputState();` (~line 27). Resolve a clicked building via the same shared resolved set the renderer uses (`byTile`), so click-set == draw-set:

```js
const MACRO_TILES = MACRO * REGION;
canvas.addEventListener('pointerdown', (e) => {
  if (FV.isFloorViewActive()) {
    const hit = pickInFloorView(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
    if (hit.type === 'stair') FV.changeFloor(1) || FV.changeFloor(-1);     // up if possible, else down
    else if (hit.type === 'lift') openLiftMenu();
    else if (hit.type === 'unit') FV.enterUnit(hit.unitId);
    return;
  }
  // not in floor view → did we click a building? resolve via the shared set
  const { tileX, tileY } = screenToWorldTile(e.clientX, e.clientY);
  const wx = Math.floor(tileX), wy = Math.floor(tileY);
  const mx = Math.floor(wx / MACRO_TILES), my = Math.floor(wy / MACRO_TILES);
  const { byTile } = resolveBuildingsInRange(getWorldSeed(), mx - 1, my - 1, mx + 1, my + 1);
  const b = byTile.get(`${wx},${wy}`);
  if (b && b.footprint && b.footprint.node) FV.enterBuilding(b.footprint.node, `${b.x},${b.y}`);
});

window.addEventListener('keydown', (e) => {
  if (!FV.isFloorViewActive()) return;
  if (e.key === 'Escape') { const fv = FV.getFloorView(); if (fv.enteredUnitId) FV.exitUnit(); else FV.exitFloorView(); }
  else if (e.key === ',' || e.key === '[') FV.changeFloor(-1);
  else if (e.key === '.' || e.key === ']') FV.changeFloor(1);
  else if (e.key === 'f') toggleWallStyle();
  else if (e.key === 'l') openLiftMenu();
});

// Minimal lift floor-picker: prompt-based for v1 (a styled menu can follow); honest + functional.
function openLiftMenu() {
  if (!FV.liftAvailable()) return;
  const fv = FV.getFloorView();
  const choice = window.prompt(`Lift — choose a floor (${fv.floorKeys[0]}…${fv.floorKeys[fv.floorKeys.length - 1]}):`, String(fv.floorIndex));
  if (choice == null) return;
  const target = parseInt(choice, 10);
  if (!Number.isNaN(target)) FV.gotoFloor(target, 'lift');
}
```

> Note: `byTile` keys are `"wx,wy"` world tiles (Plan 1 `resolveBuildingsInRange`). If the resolved `b` exposes a different node accessor than `b.footprint.node`, adjust to match `building-renderer.js`'s access (recon confirmed `b.footprint.node`). The `prompt()` lift menu is a deliberate honest-minimal v1 — the styled scrollable picker from the mockup is a fast follow once the flow is verified.

- [ ] **Step 3: Verify `canvas` is in scope** — confirm `const canvas = document.getElementById('game')` is above this block (recon: `main.js:24`). If `canvas` isn't already a name here, use it directly from line 24.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(input): click a building to enter its floor view; keys for floor/lift/wall-style/exit"
```

---

## Task 5: Browser verification + cache-bust + sign-off

**Files:** Modify `src/world/chunk-provider.js` (cache-bust token)

- [ ] **Step 1: Bump the worker cache-bust token** (~line 134, e.g. `'20260618c'` → `'20260618d'`)

```js
searchParams.set('v', '20260618d');
```

- [ ] **Step 2: Commit the bump**

```bash
git add src/world/chunk-provider.js
git commit -m "chore(render): bump worker cache-bust for floor-view build"
```

- [ ] **Step 3: Run the full headless test set** — confirm the two new test files pass and the building suite still shows only the 2 known pre-existing fails.

```
node --test sim/test/floor-view-state.test.js sim/test/floor-view-transform.test.js sim/test/buildings-floor-layout.test.js
```
Expected: all green.

- [ ] **Step 4: Browser-verify with Playwright** (or manual). Navigate to `http://127.0.0.1:8000/index.html` (incognito or after the cache-bust). Steps + screenshots:
  1. World loads, no JS exceptions, chunks paint. (Benign noise: `ws://127.0.0.1:8787` refused, un-generated-asset 404s.)
  2. Click a building → floor-view overlay appears (dimmed world, one floor centered, dollhouse-cutaway walls, stair/lift glyphs, unit labels). **Screenshot.**
  3. Press `.` / `,` → stair-slide between floors. **Screenshot mid-transition + settled.**
  4. Press `f` → floor-plan style; press again → dollhouse. **Screenshot both.**
  5. On a tall (lift) building, press `l` → pick a floor → express jump. **Screenshot.**
  6. Click a unit → "Entered <kind>" card; `Esc` steps out; `Esc` again exits to the world. **Screenshot.**
  7. Confirm no worker crash (chunks keep rendering after entering/exiting).

- [ ] **Step 5: Show the user the real-game screenshots for final sign-off.** The look was pre-approved via the mockup; this confirms it works in the running game (project rule: experienceable in the running game). If anything reads wrong, iterate before declaring done.

- [ ] **Step 6: No further commit** unless Step 4 surfaced fixes.

---

## Self-Review

**Spec coverage:** §3 main-thread overlay + projection → Tasks 2-3 (`drawFloorView`, transform stash). §4 state machine (default lowest-above-ground, clamp, lift gate) → Task 1. §5 movement (stair-slide, lift-express, unit entry) → Tasks 1-2 + Task 4 input. Dollhouse-cutaway default + floor-plan toggle (D1) → `drawWalls`/`toggleWallStyle`. Click via shared resolved set (`byTile`) → Task 4. Honest absence (inactive = nothing drawn) → `drawFloorView` early return. Browser verification (continuous testability) → Task 5.

**Placeholder scan:** none — full code for the state machine, transform, overlay, integration, and input. The `prompt()` lift menu is explicitly a labeled honest-minimal v1, not a placeholder (it's functional + gated).

**Type consistency:** `resolveFloorLayout` output fields (`walkable/units/{id,unitKind,tiles,doorTile}/stairTile/liftTile/multiFloorUnits/bounds`) — produced by Plan 1, consumed in `drawFloorLayer`/`pickInFloorView`/`focusTransform`. State actions (`enterBuilding/changeFloor/gotoFloor/clearTransition/enterUnit/exitUnit/liftAvailable/getFloorView/isFloorViewActive`) — defined in Task 1, imported in Tasks 2 + 4. `updateFloorViewTransform/screenToWorldTile/focusTransform/drawFloorView/pickInFloorView/toggleWallStyle` — defined in Task 2, imported in Tasks 3-4. Consistent.

**Risk notes:** (1) `b.footprint.node` access in Task 4 must match how `building-renderer.js` reads it (recon confirmed). (2) The overlay draws AFTER lighting/atmosphere so it isn't dimmed by night — verify in Step 4. (3) `resolveFloorLayout` materializes all units of the active floor (acceptable — we draw them); it never walks sibling floors, preserving laziness.
