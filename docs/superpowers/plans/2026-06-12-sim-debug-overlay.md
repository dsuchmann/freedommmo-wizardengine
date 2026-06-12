# Sim Debug Overlay (paths / roads / settlements planning view) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dev-toggled renderer overlay (key `9`) that draws translucent shapes from live SimClient state — worn-path intensity, road segments, placement deltas, and a sim-event ticker — so invisible simulation is never mistaken for absent simulation.

**Architecture:** One new module `src/render/sim-debug-overlay.js` with a pure, node-testable collector (`collectDebugDrawables(sim)`) and a DOM-side draw + key-wiring layer. Renderer integration is two lines in `canvas-renderer.js` (import + call) and two lines in `main.js` (import + init) — deliberately rebase-trivial because other agents own those files' surroundings. Strictly read-only over `window._simClient`; **no edits under `sim/` ever** (other agents' territory).

**Tech Stack:** Vanilla ESM, Canvas 2D, node:test for the collector, playwright-core headless probe (pattern: `scripts/probe-f2-visual.mjs`).

**Honest-absence note (spec §Component 5):** the wire protocol today exposes: `path` entities `{id,type:'path',x,y,wear}`; road segments as `matter` entities `{type:'matter',archetype:'road_segment',x,y,...}` (condition is server-private by design — `sim/test/protocol.test.js`); deltas `{id,tick,x,y,target,kind,attrs}`; events stripped to `{id,tick,type,actor,targets,magnitude}` (no attrs — settlement positions/territory/districts/plots are NOT on the wire). The overlay draws exactly these and renders settlement_founded events in the ticker. When the sim lane later serializes settlement geometry, extend `collectDebugDrawables` — do not fake shapes now.

**Verified integration surfaces (re-check line numbers before editing — other agents touch these files):**
- `src/render/canvas-renderer.js:222` `draw(chunkStore, player, lighting, camera, provider, weather)`; locals `tilePx = WORLD.tileSize * camera.zoom`, `camX = player.x * tilePx - w/2`, `camY = player.y * tilePx - h/2 + (camera.elevationOffsetY ?? 0)`; existing overlay call `drawElevationOverlay(ctx, chunkStore, camX, camY, w, h, sun, camera)` at :430.
- World→screen: `sx = Math.floor(tx * tilePx - camX)`, `sy = Math.floor(ty * tilePx - camY)` (`src/render/elevation-overlay.js:40-41`).
- Key pattern: self-registered `window.addEventListener('keydown', ...)` like `src/dev/field-tuner.js:355`. Taken keys (main.js:130-154 + tuner): r m f escape l 0 h g c t p `` ` ``. **Use `9`.**
- Sim state: `window._simClient` (set in `src/main.js:114`) with `.entities` (Map id→entity), `.deltas` (array), `.events` (most-recent batch, replaced per `events` message — the overlay must accumulate), `.tick`.

---

### Task 1: Pure drawable collector + tests

**Files:**
- Create: `src/render/sim-debug-overlay.js`
- Test: `test/sim-debug-overlay.test.mjs`

- [ ] **Step 1: Write the failing tests** — create `test/sim-debug-overlay.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDebugDrawables, accumulateEvents } from '../src/render/sim-debug-overlay.js';

const fakeSim = () => ({
  tick: 120,
  entities: new Map([
    ['p1', { id: 'p1', type: 'path', x: 10, y: 11, wear: 4 }],
    ['p2', { id: 'p2', type: 'path', x: 10, y: 12, wear: 0 }],
    ['r1', { id: 'r1', type: 'matter', archetype: 'road_segment', x: 20, y: 21 }],
    ['m1', { id: 'm1', type: 'matter', archetype: 'boulder', x: 30, y: 31 }],
    ['n1', { id: 'n1', type: 'npc', x: 40, y: 41 }],
  ]),
  deltas: [
    { id: 1, tick: 90, x: 10, y: 11, target: 'p1', kind: 'worn', attrs: {} },
    { id: 2, tick: 95, x: 20, y: 21, target: 'r1', kind: 'paved', attrs: {} },
  ],
});

test('collector extracts paths with wear, road segments, and deltas — nothing else', () => {
  const d = collectDebugDrawables(fakeSim());
  assert.deepEqual(d.paths, [{ x: 10, y: 11, wear: 4 }, { x: 10, y: 12, wear: 0 }]);
  assert.deepEqual(d.roads, [{ x: 20, y: 21 }]);
  assert.deepEqual(d.deltas, [{ x: 10, y: 11, kind: 'worn' }, { x: 20, y: 21, kind: 'paved' }]);
});

test('collector is null-safe before the sim connects', () => {
  assert.deepEqual(collectDebugDrawables(null),
    { paths: [], roads: [], deltas: [], tick: -1 });
  assert.deepEqual(collectDebugDrawables({ entities: new Map(), deltas: null, tick: 3 }).deltas, []);
});

test('event accumulator keeps a capped, deduped ledger across replaced batches', () => {
  const seen = [];
  accumulateEvents(seen, [{ id: 1, tick: 10, type: 'settlement_founded' }, { id: 2, tick: 10, type: 'trade' }]);
  accumulateEvents(seen, [{ id: 2, tick: 10, type: 'trade' }, { id: 3, tick: 11, type: 'road_funded' }]);
  assert.deepEqual(seen.map(e => e.id), [1, 2, 3]); // deduped by id, order kept
  for (let i = 0; i < 80; i++) accumulateEvents(seen, [{ id: 100 + i, tick: 12 + i, type: 'x' }]);
  assert.equal(seen.length, 50);                    // capped at 50, oldest dropped
  assert.equal(seen[0].id, 130); // 83 unique events total (1,2,3,100..179) minus 33 oldest
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/sim-debug-overlay.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure half of `src/render/sim-debug-overlay.js`:**

```js
// Dev debug overlay: draws live sim state (worn paths, road segments, deltas,
// event ticker) as translucent shapes. READ-ONLY over window._simClient.
// Toggle: key 9. Pure collector below is node-testable (no DOM at module top).
// Wire reality 2026-06-12: settlement geometry (territory/districts/plots) is
// NOT serialized to clients; only stripped events arrive. Extend
// collectDebugDrawables when the sim lane puts those on the wire — never fake.

const EVENT_CAP = 50;

export function collectDebugDrawables(sim) {
  const out = { paths: [], roads: [], deltas: [], tick: sim?.tick ?? -1 };
  if (!sim?.entities) return out;
  for (const e of sim.entities.values()) {
    if (e.type === 'path') out.paths.push({ x: e.x, y: e.y, wear: e.wear ?? 0 });
    else if (e.type === 'matter' && e.archetype === 'road_segment') out.roads.push({ x: e.x, y: e.y });
  }
  for (const d of sim.deltas ?? []) {
    if (d.x != null && d.y != null) out.deltas.push({ x: d.x, y: d.y, kind: d.kind });
  }
  return out;
}

export function accumulateEvents(seen, batch) {
  const have = new Set(seen.map(e => e.id));
  for (const e of batch ?? []) if (!have.has(e.id)) seen.push(e);
  if (seen.length > EVENT_CAP) seen.splice(0, seen.length - EVENT_CAP);
  return seen;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test test/sim-debug-overlay.test.mjs`
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/sim-debug-overlay.js test/sim-debug-overlay.test.mjs
git commit -m "feat(render): sim debug overlay — pure drawable collector + event accumulator"
```

---

### Task 2: Draw layer, toggle key, renderer hookup

**Files:**
- Modify: `src/render/sim-debug-overlay.js` (append draw + init)
- Modify: `src/render/canvas-renderer.js` (~:430 — import + one call; RE-READ the file first, other agents edit it)
- Modify: `src/main.js` (import + init; RE-READ first)

- [ ] **Step 1: Append the DOM half to `src/render/sim-debug-overlay.js`:**

```js
let enabled = false;
const seenEvents = [];
let lastEventsRef = null;

const DELTA_COLORS = { worn: 'rgba(255,180,0,0.9)', paved: 'rgba(130,130,255,0.9)' };

export function drawSimDebugOverlay(ctx, camX, camY, tilePx, w, h) {
  if (!enabled) return;
  const sim = (typeof window !== 'undefined') ? window._simClient : null;
  if (sim && sim.events !== lastEventsRef) {       // events batches are replaced; accumulate
    accumulateEvents(seenEvents, sim.events);
    lastEventsRef = sim.events;
  }
  const d = collectDebugDrawables(sim);
  const onScreen = (sx, sy) => sx > -tilePx && sy > -tilePx && sx < w + tilePx && sy < h + tilePx;

  for (const p of d.paths) {                       // worn-path intensity: amber, alpha by wear
    const sx = Math.floor(p.x * tilePx - camX), sy = Math.floor(p.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = `rgba(255,180,0,${(0.15 + 0.55 * Math.min(1, p.wear / 8)).toFixed(3)})`;
    ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
  }
  for (const r of d.roads) {                       // road segments: blue outline boxes
    const sx = Math.floor(r.x * tilePx - camX), sy = Math.floor(r.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = 'rgba(130,130,255,0.25)';
    ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
    ctx.strokeStyle = 'rgba(130,130,255,0.9)';
    ctx.strokeRect(sx + 0.5, sy + 0.5, Math.ceil(tilePx) - 1, Math.ceil(tilePx) - 1);
  }
  for (const dd of d.deltas) {                     // deltas: small corner ticks, color by kind
    const sx = Math.floor(dd.x * tilePx - camX), sy = Math.floor(dd.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = DELTA_COLORS[dd.kind] ?? 'rgba(255,0,255,0.9)';
    ctx.fillRect(sx + 2, sy + 2, Math.max(3, tilePx / 6), Math.max(3, tilePx / 6));
  }
  // event ticker, top-right: last 8 events; settlement_founded highlighted.
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(w - 320, 8, 312, 16 * 9 + 10);
  ctx.fillStyle = '#9ad';
  ctx.fillText(`SIM DEBUG  tick=${d.tick}  paths=${d.paths.length} roads=${d.roads.length} deltas=${d.deltas.length}`, w - 14, 22);
  seenEvents.slice(-8).forEach((e, i) => {
    ctx.fillStyle = e.type === 'settlement_founded' ? '#ffd24a' : '#ccc';
    ctx.fillText(`[${e.tick}] ${e.type}`, w - 14, 38 + 16 * i);
  });
  ctx.textAlign = 'left';                          // restore default for other draw code
}

export function initSimDebugOverlay() {
  window.addEventListener('keydown', (e) => {
    if (e.key !== '9' || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    enabled = !enabled;
  });
  window._simDebugOverlay = { toggle: () => { enabled = !enabled; }, isEnabled: () => enabled }; // probe hook
}
```

- [ ] **Step 2: Hook into the renderer.** RE-READ `src/render/canvas-renderer.js` around the imports and :430 (line numbers may have drifted — locate the `drawElevationOverlay(...)` call inside `draw()`). Add the import next to the elevation-overlay import, and the call immediately AFTER the `drawElevationOverlay(...)` line (overlay sits on top; locals `ctx, camX, camY, tilePx, w, h` are all in scope there):

```js
import { drawSimDebugOverlay } from './sim-debug-overlay.js';
```
```js
    drawSimDebugOverlay(ctx, camX, camY, tilePx, w, h);
```

- [ ] **Step 3: Wire the key.** RE-READ `src/main.js`; next to the field-tuner import/usage add:

```js
import { initSimDebugOverlay } from './render/sim-debug-overlay.js';
```
and once during startup (near where `window._simClient` is assigned, main.js:~114):
```js
initSimDebugOverlay();
```

- [ ] **Step 4: Verify nothing broke headlessly**

Run: `node --test test/sim-debug-overlay.test.mjs` → 3/3 PASS.
Run: `node --check src/render/sim-debug-overlay.js 2>/dev/null || node -e "import('./src/render/sim-debug-overlay.js').then(()=>console.log('import OK'))"`
Expected: `import OK` (module must import cleanly in node — DOM access only inside functions).

- [ ] **Step 5: Commit**

```bash
git add src/render/sim-debug-overlay.js src/render/canvas-renderer.js src/main.js
git commit -m "feat(render): sim debug overlay draw layer — key 9, two-line renderer hookup"
```

---

### Task 3: Headless visual probe

**Files:**
- Create: `scripts/probe-sim-debug-overlay.mjs`

Model: `scripts/probe-f2-visual.mjs` (playwright-core, swiftshader, port 8741). The probe needs the dev server on 8741 (start it the same way the F2 probe run did; if it is not running, start a static server: `npx http-server -p 8741 --silent &` from the repo root, or use whatever the F2 probe used — check git log / running processes first). The sim server is NOT required: the probe injects a fake `_simClient`.

- [ ] **Step 1: Write `scripts/probe-sim-debug-overlay.mjs`:**

```js
// Headless probe: sim debug overlay draws path/road/delta shapes + ticker.
// Injects a fake _simClient (no sim server needed); toggles via window._simDebugOverlay.
import { chromium } from 'playwright-core';

const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:8741/?x=1312&y=1312', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._simDebugOverlay && window._dbgRenderer, null, { timeout: 60000 });
await page.waitForTimeout(4000); // let chunks render

const result = await page.evaluate(async () => {
  // fake sim state centered on the player so shapes land on screen
  const px = 1312, py = 1312;
  const entities = new Map();
  for (let i = 0; i < 6; i++) entities.set('p' + i, { id: 'p' + i, type: 'path', x: px - 3 + i, y: py, wear: i * 2 });
  entities.set('r0', { id: 'r0', type: 'matter', archetype: 'road_segment', x: px, y: py + 2 });
  window._simClient = { tick: 999, entities, deltas: [{ id: 1, tick: 1, x: px + 1, y: py + 2, target: 'r0', kind: 'paved', attrs: {} }], events: [{ id: 1, tick: 998, type: 'settlement_founded', actor: 5, targets: [], magnitude: 1 }] };

  const canvas = document.querySelector('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const grab = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const diffCount = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i+1] !== b[i+1] || a[i+2] !== b[i+2]) n++; return n; };

  await new Promise(r => setTimeout(r, 500));
  const before = grab();
  window._simDebugOverlay.toggle();
  await new Promise(r => setTimeout(r, 500));
  const after = grab();
  window._simDebugOverlay.toggle();
  await new Promise(r => setTimeout(r, 500));
  const restored = grab();
  return { enabledDiff: diffCount(before, after), restoredDiff: diffCount(before, restored), enabled: false };
});

console.log(JSON.stringify(result));
// overlay must change a meaningful pixel area when on, and (modulo ambient animation) mostly restore when off
if (result.enabledDiff < 500) { console.error('FAIL: overlay drew almost nothing'); process.exit(1); }
if (result.restoredDiff > result.enabledDiff * 0.5) { console.error('FAIL: overlay did not clear on toggle-off'); process.exit(1); }
console.log('PROBE PASS: overlay draws and clears');
await browser.close();
```

- [ ] **Step 2: Run the probe**

Run: `node scripts/probe-sim-debug-overlay.mjs`
Expected: `PROBE PASS: overlay draws and clears` and a JSON line with `enabledDiff` in the thousands. If ambient animation (water/weather) makes `restoredDiff` flaky, freeze lighting the way `probe-f2-visual.mjs` does (`window._lighting` manipulation) and re-run rather than loosening thresholds blindly.

- [ ] **Step 3: Commit**

```bash
git add scripts/probe-sim-debug-overlay.mjs
git commit -m "test(render): headless probe — sim debug overlay draws paths/roads/deltas and clears"
```

---

## Verification (whole plan)

1. `node --test test/sim-debug-overlay.test.mjs` — 3/3 green.
2. `node scripts/probe-sim-debug-overlay.mjs` — PROBE PASS.
3. `git diff master --stat` for this work touches only: the new module, the new test, the new probe, and ≤2 lines each in `canvas-renderer.js` / `main.js`. Nothing under `sim/`.
4. Manual (optional): run game, press `9`, see amber path tiles / blue road boxes / ticker; press `9` again, gone.

## Out of scope

- Serializing settlement geometry (territory/districts/plots/ownership) — sim lane owns the protocol; overlay extends when it lands.
- Road condition display — condition is deliberately server-private.
- F6 size tuner / W2 renderer wiring — separate plan, blocked on tree sprites landing.
