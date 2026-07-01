# Building-Bake Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the building sprite bake off the main thread into a Web Worker (OffscreenCanvas) so a single large building's ~1.3–2.8 s bake never freezes loading.

**Architecture:** A dedicated `building-bake-worker` receives a *serialized* building snapshot (geometry + material/roof slugs + pre-computed world facts + tuning knobs), fetches its own tile textures as `ImageBitmap` (cached in-worker), renders walls + dressing + roof to an `OffscreenCanvas` using the SAME Canvas2D draw code as today, and returns the finished bake as a **transferable `ImageBitmap`**. The main thread uploads that bitmap to a GL texture exactly as it uploads the current baked canvas. The existing synchronous bake stays intact behind a flag (`window._bakeWorker`) as a fallback and A/B reference.

**Tech Stack:** ES module Web Worker, OffscreenCanvas 2D, `createImageBitmap`/`fetch` (both worker-available), `postMessage` with transferables, WebGL2 `texImage2D(…, ImageBitmap)`.

---

## Why this plan exists (context for the implementer)

The bake is the expensive step of drawing a building. `getBuildingSprite` → `buildSprite` → `drawBuildingTextured` renders walls, D0–D2 dressing, awnings, and the **roof** to a canvas once, then uploads it as a cached GL texture. The roof alone (`tools/roof/roof-renderer.js drawRoof`) is ~2000 ms of software Canvas2D for a large (18×12) building. It is throttled to **one building per frame** (`BUILD_BUDGET = 1`), so on entering a town the main thread freezes ~2 s per building, in series. That is the user's #1 loading complaint.

A dependency-graph investigation (2026-07-01) established:

- **The bake is ~entirely worker-portable.** Canvas creation is already `OffscreenCanvas`-first with a `document.createElement` fallback; `getImageData`/`putImageData` exist on worker OffscreenCanvas 2D. The **only** genuine DOM API in the whole bake graph is `new Image()` (HTMLImageElement), used by 7 module-level image caches.
- **Input is serializable.** The bake reads `b.x, b.y, b.biome, b.wallSlug, b.roofSlug, b.tier, b.footprint{sections, boundingBox, doors, windows, typeId, category, tier, pattern}` — plain geometry/IDs. Memoized caches are attached to `b` as live refs (`b._floorSetCache`, `b._wallPath`, `fp._southRuns`, …) but are all regenerable, so send a clean snapshot, not the live object.
- **Two world helpers** used during bake pull in the world-seed + biome classifier chain: `northGapTiles` (via `queryBuildingTile`) and `buildingWaterProximity` (via `isWaterTile`). Pre-compute both on the main thread and pass them in the bake message (the roof already accepts `northGapTiles` as an opt), so the worker does not need the world-gen classifier chain.
- **GL upload stays main-thread** (`gl-compositor.js:1425 texImage2D`); the worker returns a transferable `ImageBitmap`, which `texImage2D` accepts directly.

**The one strategic risk (Task 1 gates the whole plan):** the roof today is deliberately rendered to a **DOM `<canvas>`** because main-thread OffscreenCanvas 2D "often falls back to SOFTWARE" for the sheared per-facet `drawImage` (`building-occluder.js:763-771`). In a worker there is *only* OffscreenCanvas. Moving off-thread **guarantees the jam disappears** (main thread is free) but may **not shrink** the 2000 ms if worker OffscreenCanvas 2D is also software. Task 1 measures this before any refactor:
- If worker OffscreenCanvas 2D is GPU-accelerated → roof is both un-jammed AND fast (best case).
- If it stays software → still a win (2 s off the main thread = pop-in delay, not a freeze), and a future GL-geometry roof becomes the follow-up. Either outcome justifies the move; Task 1 just tells us which follow-up we owe.

**Repo discipline (this codebase, non-negotiable):**
- Shared repo with parallel sessions. **Commit by explicit file name — NEVER `git add -A`.**
- Worker module changes need a `?v=` cache-bust bump where the worker is instantiated (see `chunk-provider.js` `new Worker(new URL('…?v=…'))` precedent).
- Never touch other sessions' uncommitted asset changes.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- No mock/shortcut versions of systems (project rule). The fallback path stays real, not stubbed.

**Test runner:** this repo runs node-based tests (see existing `tests/` + `scripts/*.mjs`). Where a task says "test", write a `node --test` (`node:test`) file under `tests/` unless an adjacent test uses a different harness — match the neighbor. Pure-data tasks (serialization, ImageBitmap cache keys) are unit-testable in node; canvas/GL tasks are validated with the headless harness `scripts/pw-shot.mjs` (real GPU) — that is the integration gate, not a unit test.

---

## File Structure

**Create:**
- `src/render/building-bake-worker.js` — the worker entry. Receives bake requests, owns the in-worker ImageBitmap tile cache, runs the ported bake, returns a transferable ImageBitmap. One responsibility: bake a serialized building to a bitmap.
- `src/render/building-bake-snapshot.js` — pure function `snapshotBuilding(b, worldFacts)` → a plain serializable bake request. One responsibility: define the main-thread↔worker contract. Shared by both threads (imported by the worker for JSDoc/shape only; the snapshot is built main-thread).
- `src/render/building-image-source.js` — a thin abstraction over "get a drawable image by URL" with two backends: main-thread `HTMLImageElement` (today's behavior) and worker `ImageBitmap` (`fetch`+`createImageBitmap`). One responsibility: decouple the 7 image caches from `new Image()`. The bake draw code calls `imageSource.get(url)` and reads `.width`/`.height`/`.ready` instead of `new Image()`/`.naturalWidth`/`.complete`.
- `src/render/building-bake-client.js` — main-thread client: owns the `Worker`, sends snapshots, resolves per-building promises with the returned ImageBitmap, applies backpressure (mirrors `BUILD_BUDGET`). One responsibility: main-thread orchestration of the worker.
- `tests/building-bake-snapshot.test.mjs`, `tests/building-image-source.test.mjs` — unit tests for the two pure/near-pure pieces.
- `scripts/bench-offscreen-roof.mjs` — Task 1 de-risk benchmark harness (Playwright, hard-timeout wrapped).

**Modify:**
- `tools/roof/roof-renderer.js` — swap `new Image()`/`_imageCache` reads for `imageSource.get`; read `.width`/`.height` (already ORed in most places).
- `src/render/building-tiles.js` — swap `_img`/`img()` (`:57-61`) for `imageSource`.
- `src/render/building-renderer.js` — swap `_wallImgs`/`_floorImgs` (`:47,:66`).
- `src/render/building-occluder.js` — `_tex`/`_imageCache` (`:161-170`) → `imageSource`; forward tuning knobs into the snapshot instead of reading `window.*`; the roof sub-canvas (`_roofGpuCv`, `:769`) becomes the worker OffscreenCanvas in the worker path.
- `src/render/dressing/d1-chips.js` (`:32`), `d3-props.js` (`:26`), `vine-render.js` (`:36`), `aperture-measure.js` (`:16`) — `new Image()` → `imageSource`.
- `src/render/building-sprite-cache.js` — add the worker path: when `window._bakeWorker`, request via `building-bake-client` and receive an ImageBitmap; else current sync path. Keep alpha-crop for the sync path.
- `src/render/canvas-renderer.js` (`:812-818`) — call the client; upload the returned ImageBitmap via `drawBuildingSprite` (already accepts a canvas/bitmap).
- `src/render/gl-compositor.js` — confirm `drawBuildingSprite`/`texImage2D` (`:1397,:1425`) accept `ImageBitmap` (they do); no change expected, add a guard/test.

---

## Task 1: De-risk — benchmark worker OffscreenCanvas 2D sheared-drawImage

**This task gates the whole plan. Do not start Task 2 until this reports a number.** It writes NO production code — a throwaway benchmark answering: does worker OffscreenCanvas 2D GPU-accelerate the roof's sheared `drawImage`, or stay software?

**Files:**
- Create: `scripts/bench-offscreen-roof.mjs`

- [ ] **Step 1: Write the benchmark harness**

Mirror `scripts/pw-shot.mjs` (playwright-core + system Chrome, headless uses the real GPU). It loads a blank page, then in three contexts renders **the same** sheared-drawImage workload (216 facets, each a `ctx.save(); ctx.transform(shear); ctx.drawImage(tex, …); ctx.restore()` over a ~1374×1998 target) and times 5 runs of each, reporting median ms:
  - (A) main-thread **DOM `<canvas>`** (today's roof path — the baseline),
  - (B) main-thread **OffscreenCanvas**,
  - (C) **worker** OffscreenCanvas (create the worker inline via a `Blob` URL, run the same workload, `postMessage` the timing back).

Use a 256×256 offscreen-generated texture (fill + a few rects) as the drawImage source so no assets are needed. ALWAYS invoke wrapped in a hard timeout.

```js
// scripts/bench-offscreen-roof.mjs — throwaway de-risk benchmark. Not shipped.
// Usage: timeout 90 node scripts/bench-offscreen-roof.mjs
import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage();
p.on('console', m => console.log('PAGE:', m.text().slice(0, 200)));
await p.setContent('<!doctype html><body></body>');
const res = await p.evaluate(async () => {
  const W = 1374, H = 1998, FACETS = 216, RUNS = 5;
  function mkTex() { const c = new OffscreenCanvas(256, 256); const x = c.getContext('2d');
    x.fillStyle = '#8a6'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 40; i++) { x.fillStyle = `hsl(${i * 9},50%,${30 + i}%)`; x.fillRect((i * 37) % 256, (i * 53) % 256, 24, 18); }
    return c.transferToImageBitmap(); }
  function workload(ctx, tex) {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < FACETS; i++) {
      const px = (i * 61) % (W - 120), py = (i * 47) % (H - 90);
      ctx.save(); ctx.setTransform(1, 0.28, -0.14, 1, px, py); ctx.drawImage(tex, 0, 0, 256, 256, 0, 0, 118, 86); ctx.restore();
    } }
  function med(a) { a = [...a].sort((x, y) => x - y); return a[a.length >> 1]; }
  const tex = mkTex();
  // A: DOM canvas
  const dom = document.createElement('canvas'); dom.width = W; dom.height = H; const dctx = dom.getContext('2d');
  const A = []; for (let r = 0; r < RUNS; r++) { const t = performance.now(); workload(dctx, tex); dctx.getImageData(0, 0, 1, 1); A.push(performance.now() - t); }
  // B: main-thread OffscreenCanvas
  const off = new OffscreenCanvas(W, H); const octx = off.getContext('2d');
  const B = []; for (let r = 0; r < RUNS; r++) { const t = performance.now(); workload(octx, tex); octx.getImageData(0, 0, 1, 1); B.push(performance.now() - t); }
  // C: worker OffscreenCanvas
  const src = `self.onmessage = async () => {
    const W=${W},H=${H},FACETS=${FACETS},RUNS=${RUNS};
    const c=new OffscreenCanvas(256,256),x=c.getContext('2d');x.fillStyle='#8a6';x.fillRect(0,0,256,256);
    for(let i=0;i<40;i++){x.fillStyle='hsl('+(i*9)+',50%,'+(30+i)+'%)';x.fillRect((i*37)%256,(i*53)%256,24,18);}
    const tex=c.transferToImageBitmap();
    const off=new OffscreenCanvas(W,H),ctx=off.getContext('2d');
    function wl(){ctx.clearRect(0,0,W,H);for(let i=0;i<FACETS;i++){const px=(i*61)%(W-120),py=(i*47)%(H-90);ctx.save();ctx.setTransform(1,0.28,-0.14,1,px,py);ctx.drawImage(tex,0,0,256,256,0,0,118,86);ctx.restore();}}
    const C=[];for(let r=0;r<RUNS;r++){const t=performance.now();wl();ctx.getImageData(0,0,1,1);C.push(performance.now()-t);}
    postMessage(C); };`;
  const wURL = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(wURL);
  const C = await new Promise(res => { w.onmessage = e => res(e.data); w.postMessage(1); });
  return { A: med(A), B: med(B), C: med(C), A_all: A, B_all: B, C_all: C };
});
console.log('MEDIAN ms  A(DOM):', res.A.toFixed(1), ' B(main-Offscreen):', res.B.toFixed(1), ' C(worker-Offscreen):', res.C.toFixed(1));
console.log('RAW', JSON.stringify(res));
await b.close();
```

- [ ] **Step 2: Run it**

Run: `timeout 90 node scripts/bench-offscreen-roof.mjs`
Expected: three median numbers. Interpretation:
  - If **C ≈ B ≈ A** (all fast, tens of ms) → worker OffscreenCanvas is GPU-accelerated; the roof is fast off-thread. Best case.
  - If **A fast but B,C ~1000 ms+** → confirms OffscreenCanvas 2D is software on this machine; the worker removes the jam but the roof stays slow — record that a GL-geometry roof is the follow-up.
  - Either way the worker-move proceeds; only the follow-up differs.

- [ ] **Step 3: Record the verdict in the roadmap**

Append the three medians + interpretation to `docs/superpowers/plans/2026-06-30-autonomous-overnight-roadmap.md` under a "Bake-worker de-risk (2026-07-01)" heading. This is the decision record the rest of the plan depends on.

- [ ] **Step 4: Commit**

```bash
git add scripts/bench-offscreen-roof.mjs docs/superpowers/plans/2026-06-30-autonomous-overnight-roadmap.md
git commit -m "bench(bake-worker): measure worker OffscreenCanvas 2D sheared-drawImage cost

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The bake request snapshot (pure, serializable contract)

Define the exact data the worker needs so nothing live crosses the boundary.

**Files:**
- Create: `src/render/building-bake-snapshot.js`
- Test: `tests/building-bake-snapshot.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { snapshotBuilding } from '../src/render/building-bake-snapshot.js';

test('snapshot is structured-clone-safe and holds only geometry+ids+facts', () => {
  const b = {
    x: 100, y: 200, biome: 'grassland', wallSlug: 'cob', roofSlug: 'thatch', tier: 2,
    footprint: { boundingBox: { w: 6, h: 4 }, sections: [{ x: 0, y: 0, w: 6, h: 4 }],
      doors: [{ x: 2, y: 3 }], windows: [{ x: 1, y: 1 }], typeId: 'house', category: 'residential', tier: 2, pattern: 'A' },
    _floorSetCache: new Set([1, 2]),           // live memo — must NOT survive
    _wallPath: { current: true },              // live memo — must NOT survive
  };
  const facts = { northGapTiles: [[100, 199]], waterProximity: 0.4, knobs: { weatheringAmt: 0.3 } };
  const snap = snapshotBuilding(b, facts);
  // round-trips through structuredClone (the postMessage boundary)
  const clone = structuredClone(snap);
  assert.deepStrictEqual(clone, snap);
  // carries the real inputs
  assert.strictEqual(snap.wallSlug, 'cob');
  assert.strictEqual(snap.footprint.doors.length, 1);
  assert.strictEqual(snap.facts.waterProximity, 0.4);
  // strips live memo refs
  assert.ok(!('_floorSetCache' in snap));
  assert.ok(!('_wallPath' in snap));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/building-bake-snapshot.test.mjs`
Expected: FAIL — `snapshotBuilding` not defined.

- [ ] **Step 3: Implement**

```js
// src/render/building-bake-snapshot.js
// Pure: builds the serializable bake request that crosses the worker boundary.
// NOTHING live (no Sets/refs/DOM) — only geometry, ids, and pre-computed world facts.
export function snapshotBuilding(b, facts) {
  const fp = b.footprint || {};
  return {
    x: b.x, y: b.y, biome: b.biome, wallSlug: b.wallSlug, roofSlug: b.roofSlug, tier: b.tier,
    footprint: {
      boundingBox: { w: fp.boundingBox?.w | 0, h: fp.boundingBox?.h | 0 },
      sections: (fp.sections || []).map(s => ({ x: s.x | 0, y: s.y | 0, w: s.w | 0, h: s.h | 0 })),
      doors: (fp.doors || []).map(d => ({ x: d.x | 0, y: d.y | 0 })),
      windows: (fp.windows || []).map(w => ({ x: w.x | 0, y: w.y | 0 })),
      typeId: fp.typeId, category: fp.category, tier: fp.tier, pattern: fp.pattern,
    },
    // pre-computed on the main thread so the worker needs no world-gen classifier chain:
    facts: {
      northGapTiles: (facts?.northGapTiles || []).map(t => [t[0] | 0, t[1] | 0]),
      waterProximity: +(facts?.waterProximity || 0),
      knobs: { ...(facts?.knobs || {}) }, // tuning values snapshotted from window.* (see Task 6)
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/building-bake-snapshot.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/building-bake-snapshot.js tests/building-bake-snapshot.test.mjs
git commit -m "feat(bake-worker): serializable building bake snapshot

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Image-source abstraction (decouple the bake from `new Image()`)

The bake draw code must stop calling `new Image()` directly and instead call an injected `imageSource`. Two backends: main-thread `HTMLImageElement` (identical behavior to today) and worker `ImageBitmap`. This is the mechanical unblock for the whole worker path.

**Files:**
- Create: `src/render/building-image-source.js`
- Test: `tests/building-image-source.test.mjs`

- [ ] **Step 1: Write the failing test** (worker backend is the testable/pure part; the DOM backend needs a browser and is covered by the Task 9 harness)

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { makeBitmapImageSource } from '../src/render/building-image-source.js';

test('bitmap image source caches by url and exposes width/height/ready', async () => {
  const calls = [];
  // inject fake fetch+decode so the test is pure (no network, no browser)
  const fakeFetch = async (url) => { calls.push(url); return { blob: async () => ({ _url: url }) }; };
  const fakeDecode = async (blob) => ({ width: 64, height: 48, _from: blob._url });
  const src = makeBitmapImageSource({ fetchFn: fakeFetch, decodeFn: fakeDecode });

  const a1 = src.get('/tiles/wall.png');      // first get kicks off load, returns a not-ready handle
  assert.strictEqual(a1.ready, false);
  await src.whenSettled();                     // await all in-flight decodes
  const a2 = src.get('/tiles/wall.png');       // second get hits cache, ready
  assert.strictEqual(a2.ready, true);
  assert.strictEqual(a2.width, 64);
  assert.strictEqual(a2.height, 48);
  assert.strictEqual(a2.bitmap._from, '/tiles/wall.png');
  src.get('/tiles/wall.png');                  // still cached — no new fetch
  assert.strictEqual(calls.length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/building-image-source.test.mjs`
Expected: FAIL — `makeBitmapImageSource` not defined.

- [ ] **Step 3: Implement both backends**

```js
// src/render/building-image-source.js
// One drawable-image cache abstraction, two backends. The bake draw code calls
// `src.get(url)` and reads `.ready` / `.width` / `.height` / the drawable via `.bitmap`
// (ImageBitmap in a worker) or `.img` (HTMLImageElement on the main thread).
// A handle is ALWAYS returned immediately; `.ready` flips true once decoded.

// Worker backend: fetch + createImageBitmap. fetchFn/decodeFn injectable for tests.
export function makeBitmapImageSource(opts = {}) {
  const fetchFn = opts.fetchFn || ((u) => fetch(u));
  const decodeFn = opts.decodeFn || (async (blob) => createImageBitmap(blob));
  const cache = new Map();   // url -> handle {ready,width,height,bitmap}
  const inflight = new Set();
  function get(url) {
    let h = cache.get(url);
    if (h) return h;
    h = { ready: false, width: 0, height: 0, bitmap: null, url };
    cache.set(url, h);
    const pr = (async () => {
      const res = await fetchFn(url);
      const blob = await res.blob();
      const bmp = await decodeFn(blob);
      h.bitmap = bmp; h.width = bmp.width; h.height = bmp.height; h.ready = true;
    })().catch(() => { h.broken = true; }).finally(() => inflight.delete(pr));
    inflight.add(pr);
    return h;
  }
  async function whenSettled() { while (inflight.size) await Promise.all([...inflight]); }
  return { get, whenSettled, _cache: cache };
}

// Main-thread backend: HTMLImageElement, behavior identical to today's `new Image()` caches.
export function makeDomImageSource() {
  const cache = new Map();
  function get(url) {
    let h = cache.get(url);
    if (h) return h;
    const img = new Image();
    h = { ready: false, get width() { return img.naturalWidth || img.width; },
      get height() { return img.naturalHeight || img.height; }, img, url };
    img.onload = () => { h.ready = true; };
    img.onerror = () => { h.broken = true; };
    img.src = url;
    cache.set(url, h);
    return h;
  }
  return { get, whenSettled: async () => {}, _cache: cache };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/building-image-source.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/building-image-source.js tests/building-image-source.test.mjs
git commit -m "feat(bake-worker): image-source abstraction (DOM Image + worker ImageBitmap)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Thread `imageSource` through the bake draw code (main-thread path unchanged)

Replace direct `new Image()`/`_imageCache`/`_img` usage in the bake call graph with an `imageSource` parameter. On the main thread, inject `makeDomImageSource()` — behavior must be **byte-identical** to today. This is a pure refactor with zero behavior change; the harness screenshot before/after must match.

**Files:**
- Modify: `tools/roof/roof-renderer.js`, `src/render/building-tiles.js` (`:53-61`), `src/render/building-renderer.js` (`:47,:66`), `src/render/building-occluder.js` (`:161-170`), `src/render/dressing/d1-chips.js` (`:32`), `d3-props.js` (`:26`), `vine-render.js` (`:36`), `aperture-measure.js` (`:16`), `src/render/building-sprite-cache.js` (owns the shared source instance)

- [ ] **Step 1: Add a shared main-thread source in the sprite cache**

In `building-sprite-cache.js`, near the top-level state, create one shared DOM source and pass it down through the render call so every module uses the same cache:

```js
import { makeDomImageSource } from './building-image-source.js';
const _domImages = makeDomImageSource();   // module-singleton, replaces the 7 scattered new Image() Maps
```

Thread `_domImages` into `buildSprite(...)` → `renderFn(ctx, b, tilePx, { imageSource: _domImages, ... })`.

- [ ] **Step 2: Convert each image cache to accept the injected source**

For EACH of the 7 caches, replace the module-local `new Image()` map with a lookup on the passed `imageSource`. Pattern (building-tiles.js `img()` example):

```js
// BEFORE (building-tiles.js ~:57)
// const _img = new Map();
// function img(url){ let m=_img.get(url); if(!m){ m=new Image(); m.src=url; _img.set(url,m);} return m; }
// drawImage(img(url), …); readiness via img(url).complete && img(url).naturalWidth

// AFTER
function img(url, imageSource) { return imageSource.get(url); }         // handle {ready,width,height,img|bitmap}
function drawable(h) { return h.bitmap || h.img; }                       // works for both backends
// draw: if (h.ready) ctx.drawImage(drawable(h), …);
// readiness gate: h.ready (replaces .complete && .naturalWidth)
```

Apply the identical pattern to `roof-renderer.js` (`cfg.texture`/`fascia`/`gableTex`), `building-renderer.js`, `building-occluder.js _tex`, `d1-chips.js`, `d3-props.js`, `vine-render.js`, `aperture-measure.js`. Every `.naturalWidth`/`.naturalHeight`/`.complete` read becomes `.width`/`.height`/`.ready` on the handle.

- [ ] **Step 3: Verify no `new Image()` remains in the bake graph**

Run: `grep -rn "new Image()" src/render/roof-renderer.js tools/roof/roof-renderer.js src/render/building-tiles.js src/render/building-renderer.js src/render/building-occluder.js src/render/dressing/`
Expected: no matches in the bake path (the DOM backend's single `new Image()` lives only in `building-image-source.js`).

- [ ] **Step 4: Harness parity check (behavior unchanged)**

Run: `timeout 55 node scripts/pw-shot.mjs --x=1239 --y=1280` (a grassland town)
Expected: STATE sane, **zero new JS errors**, buildings still render. Compare `screenshots/pw.png` to a pre-change capture — must be visually identical (this task changes plumbing, not pixels).

- [ ] **Step 5: Commit**

```bash
git add tools/roof/roof-renderer.js src/render/building-tiles.js src/render/building-renderer.js src/render/building-occluder.js src/render/dressing/d1-chips.js src/render/dressing/d3-props.js src/render/dressing/vine-render.js src/render/dressing/aperture-measure.js src/render/building-sprite-cache.js
git commit -m "refactor(bake-worker): inject imageSource; remove new Image() from bake graph (no behavior change)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Pre-compute world facts on the main thread

The two world helpers used during bake (`northGapTiles`, `waterProximity`) must be computed main-thread and passed in the snapshot, so the worker needs no world-gen chain.

**Files:**
- Modify: `src/render/canvas-renderer.js` (where the bake is requested, ~:812), `src/render/building-occluder.js` (accept facts instead of calling the helpers when facts are supplied)

- [ ] **Step 1: Compute facts at request time**

At the bake call site (`canvas-renderer.js:812`), before requesting the bake, compute:

```js
import { queryBuildingTile } from '../world/building-tile-query.js';   // northGap source
import { buildingWaterProximity } from './building-occluder.js';       // export it if not already
function computeWorldFacts(b) {
  // north gap tiles the roof already consumes as an opt:
  const northGapTiles = northGapTilesFor(b);        // reuse existing helper that wraps queryBuildingTile
  const waterProximity = buildingWaterProximity(b); // existing, seed-based, pure
  return { northGapTiles, waterProximity };
}
```

- [ ] **Step 2: Make the bake consume supplied facts**

In `building-occluder.js drawBuildingTextured`, when `opts.facts` is present, use `opts.facts.northGapTiles` / `opts.facts.waterProximity` instead of calling `queryBuildingTile` / `buildingWaterProximity` inline. When absent (pure sync fallback with no facts), keep the inline calls. This keeps the sync path working AND lets the worker path pass facts.

- [ ] **Step 3: Harness parity check**

Run: `timeout 55 node scripts/pw-shot.mjs --x=1239 --y=1280`
Expected: identical render, zero new errors (facts computed main-thread == facts computed inline; roofs/water-wetness unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/render/canvas-renderer.js src/render/building-occluder.js
git commit -m "feat(bake-worker): pre-compute northGap+waterProximity facts main-thread

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Snapshot the tuning knobs

Every dressing/roof `window._*` knob defaults in a worker. Snapshot their live values into `facts.knobs` so the worker bake matches the tuned main-thread look.

**Files:**
- Modify: `src/render/building-bake-snapshot.js` (already carries `knobs`), and each dressing/roof module to read a knob from an injected `knobs` object when provided, else `window.*`

- [ ] **Step 1: Enumerate the knobs**

Collect the knob keys the bake reads (from the dependency report): `window._weathering` (d0), `window._damage` (d1-damage), `window._chips` (d1-chips), `window._growth` (d2), `window._vines`, `window._roofKnob` (roof-renderer `:486-490`), `window._tileWalls`/`window._tileMaterial` (building-tiles), `window._spot`/`window._windowFit` (building-occluder). Build the `knobs` object at request time:

```js
function snapshotKnobs() {
  const w = (typeof window !== 'undefined') ? window : {};
  return { weathering: w._weathering, damage: w._damage, chips: w._chips, growth: w._growth,
    vines: w._vines, roof: w._roofKnob, tileWalls: w._tileWalls, tileMaterial: w._tileMaterial,
    spot: w._spot, windowFit: w._windowFit };
}
```

Pass `snapshotKnobs()` into `snapshotBuilding(b, { …facts, knobs })`.

- [ ] **Step 2: Make each module prefer injected knobs**

In each module, change `const cfg = window._weathering || DEFAULTS` to `const cfg = (opts?.knobs?.weathering) || (typeof window!=='undefined' && window._weathering) || DEFAULTS`. Thread `opts.knobs` down from `drawBuildingTextured`. When neither is set, DEFAULTS (today's behavior) — no change for untuned users.

- [ ] **Step 3: Harness parity check**

Run: `timeout 55 node scripts/pw-shot.mjs --x=1239 --y=1280`
Expected: identical render (untuned defaults path), zero new errors.

- [ ] **Step 4: Commit**

```bash
git add src/render/building-bake-snapshot.js src/render/building-occluder.js src/render/roof-renderer.js src/render/dressing/d0-weathering.js src/render/dressing/d1-damage.js src/render/dressing/d1-chips.js src/render/dressing/d2-growth.js src/render/dressing/vine-render.js src/render/building-tiles.js
git commit -m "feat(bake-worker): snapshot tuning knobs into bake request

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: The worker

The worker receives a snapshot, ensures its ImageBitmap tile cache has every URL the bake needs, renders to an OffscreenCanvas via the SAME ported draw code, alpha-crops, and posts back a transferable ImageBitmap.

**Files:**
- Create: `src/render/building-bake-worker.js`

- [ ] **Step 1: Two-phase bake (load, then draw)** — because worker image loads are async, the bake is: (1) resolve every URL the building needs to a ready ImageBitmap, then (2) draw synchronously. The URL set comes from the same material/roof/dressing resolvers the draw code uses; expose a `collectBakeUrls(snapshot)` from the shared draw modules so the worker can pre-warm the cache before drawing.

```js
// src/render/building-bake-worker.js
import { makeBitmapImageSource } from './building-image-source.js';
import { drawBuildingTexturedCore } from './building-occluder.js'; // the ported, DOM-free core
import { collectBakeUrls } from './building-occluder.js';
import { alphaBBox } from './building-sprite-cache.js';            // pure, export it

const imageSource = makeBitmapImageSource();  // persistent cross-bake ImageBitmap cache

self.onmessage = async (e) => {
  const { snapshot, tilePx, reqId } = e.data;
  try {
    // phase 1: ensure every needed texture is decoded
    const urls = collectBakeUrls(snapshot, tilePx);
    urls.forEach(u => imageSource.get(u));
    await imageSource.whenSettled();
    // phase 2: draw (synchronous) to a work canvas
    const bb = snapshot.footprint.boundingBox;
    const W = Math.max(1, bb.w * tilePx * 2), H = Math.max(1, bb.h * tilePx * 3); // generous; cropped next
    const work = new OffscreenCanvas(W, H);
    const ctx = work.getContext('2d', { willReadFrequently: true });
    drawBuildingTexturedCore(ctx, snapshot, tilePx, { imageSource, knobs: snapshot.facts.knobs, facts: snapshot.facts });
    // alpha crop → tight bitmap
    const { x, y, w, h } = alphaBBox(ctx, W, H);
    const tight = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
    tight.getContext('2d').drawImage(work, x, y, w, h, 0, 0, w, h);
    const bitmap = tight.transferToImageBitmap();
    self.postMessage({ reqId, ok: true, bitmap, ox: x, oy: y, w, h }, [bitmap]);
  } catch (err) {
    self.postMessage({ reqId, ok: false, error: String(err && err.message || err) });
  }
};
```

> **Note for the implementer:** `drawBuildingTexturedCore` and `collectBakeUrls` are the DOM-free extraction of today's `drawBuildingTextured`. Task 4 already removed `new Image()`; this step extracts the pure draw core (no `window.*` reads — all via `opts.knobs`; no `document` — canvas is passed in). The existing `drawBuildingTextured` becomes a thin main-thread wrapper that builds a DOM source + knobs from `window` and calls the core, preserving the sync path.

- [ ] **Step 2: Extract `drawBuildingTexturedCore` + `collectBakeUrls`**

Refactor `building-occluder.js`: pull the body of `drawBuildingTextured` into `drawBuildingTexturedCore(ctx, snapshot, tilePx, opts)` that takes ONLY `ctx`, the serializable `snapshot`, `tilePx`, and `opts{imageSource,knobs,facts}`. Add `collectBakeUrls(snapshot, tilePx)` that returns the array of every texture URL the core will draw (walls per material, roof texture/fascia/gable, dressing sprites) — factor it out of the same resolvers the core uses so the two never drift.

- [ ] **Step 3: Sanity-run the worker in node isn't possible (needs OffscreenCanvas); defer validation to Task 9's harness.** Commit the scaffold.

```bash
git add src/render/building-bake-worker.js src/render/building-occluder.js src/render/building-sprite-cache.js
git commit -m "feat(bake-worker): worker entry + DOM-free draw core + url collector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Main-thread client + wiring behind `window._bakeWorker`

**Files:**
- Create: `src/render/building-bake-client.js`
- Modify: `src/render/building-sprite-cache.js`, `src/render/canvas-renderer.js`

- [ ] **Step 1: The client** — owns the Worker, maps `reqId → {resolve}`, mirrors `BUILD_BUDGET` backpressure (cap in-flight bakes so we don't flood the worker), returns a promise of `{bitmap, ox, oy, w, h}`.

```js
// src/render/building-bake-client.js
let _worker = null, _seq = 0, _inflight = new Map(), _queue = [];
const MAX_INFLIGHT = 2;
function worker() {
  if (!_worker) {
    _worker = new Worker(new URL('./building-bake-worker.js?v=bakeworker1', import.meta.url), { type: 'module' });
    _worker.onmessage = (e) => {
      const { reqId } = e.data; const p = _inflight.get(reqId); if (!p) return;
      _inflight.delete(reqId); p(e.data); pump();
    };
  }
  return _worker;
}
function pump() {
  while (_queue.length && _inflight.size < MAX_INFLIGHT) {
    const job = _queue.shift(); _inflight.set(job.reqId, job.resolve);
    worker().postMessage({ snapshot: job.snapshot, tilePx: job.tilePx, reqId: job.reqId });
  }
}
export function requestBake(snapshot, tilePx) {
  return new Promise((resolve) => { _queue.push({ reqId: ++_seq, snapshot, tilePx, resolve }); pump(); });
}
export function bakeWorkerInFlight() { return _inflight.size + _queue.length; }
```

- [ ] **Step 2: Wire the sprite cache** — in `getBuildingSprite`, when `window._bakeWorker`, snapshot the building, `requestBake`, and on resolution build the cached GL-ready entry from the returned ImageBitmap (store `bitmap` + offset like the sync path stores `canvas`). While the bake is in flight, return the previous/placeholder (buildings already tolerate warmup frames). When the flag is off, current sync path verbatim.

- [ ] **Step 3: Wire the uploader** — in `canvas-renderer.js:812-818`, when a worker bake entry is present, pass its `bitmap` to `this.glc.drawBuildingSprite(spriteKey, bitmap, …)`. `texImage2D` accepts ImageBitmap (`gl-compositor.js:1425`) — no compositor change; add a one-line guard test that `drawBuildingSprite` handles an ImageBitmap arg.

- [ ] **Step 4: Bump the worker cache-bust** — anytime `building-bake-worker.js` or its imports change, bump `?v=bakeworkerN` in the client.

- [ ] **Step 5: Commit**

```bash
git add src/render/building-bake-client.js src/render/building-sprite-cache.js src/render/canvas-renderer.js
git commit -m "feat(bake-worker): main-thread client + wiring behind window._bakeWorker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Integration validation (harness + main-thread-jam measurement)

**Files:**
- Modify: `scripts/pw-shot.mjs` (add an optional `--bakeWorker` flag that sets `window._bakeWorker=true` before load) OR set it via `p.evaluate` like `--gpu`.

- [ ] **Step 1: Add long-task instrumentation** — in the client or sprite cache, when `window._bakeWorker`, record the longest main-thread stall around bake handling into `window._bakeJam` (should be ~0 — the point). Keep the sync path's `_bbWorst` for comparison.

- [ ] **Step 2: A/B the jam** — capture both:

Run: `timeout 60 node scripts/pw-shot.mjs --x=1239 --y=1280` (sync path; read `window._bbWorst` — expect ~1300–2800 ms)
Run: `timeout 60 node scripts/pw-shot.mjs --x=1239 --y=1280 --bakeWorker` (worker path; read `window._bakeJam` — expect main-thread stalls of tens of ms; buildings still appear, just a beat later)
Expected: worker path shows the main-thread jam gone. Buildings render identically (compare screenshots). Zero new console errors.

- [ ] **Step 3: Record results** in the roadmap doc (sync `_bbWorst` vs worker `_bakeJam`, plus the Task 1 roof number, to state whether the roof also got faster or merely un-jammed).

- [ ] **Step 4: Commit**

```bash
git add scripts/pw-shot.mjs docs/superpowers/plans/2026-06-30-autonomous-overnight-roadmap.md
git commit -m "test(bake-worker): A/B main-thread jam, sync vs worker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: USER GATE — visual sign-off.** Before flipping `window._bakeWorker` on by default, the user walks into a town and confirms: (a) no loading freeze, (b) buildings look identical to the sync bake. Only after that, default the flag on (like `gpuTerrain`). Do NOT default-on blind — building visuals need human eyes (per the F6-sort regression lesson).

---

## Self-Review

**Spec coverage:**
- De-risk benchmark first → Task 1. ✓
- Serializable contract → Task 2. ✓
- `new Image()` removal (the one true blocker) → Task 3 (abstraction) + Task 4 (thread it through all 7 caches). ✓
- World-helper pre-compute → Task 5. ✓
- Tuning knobs (else they default in-worker) → Task 6. ✓
- Worker + DOM-free draw core + transferable ImageBitmap return → Task 7. ✓
- Main-thread client + GL upload of ImageBitmap + flag gate → Task 8. ✓
- Jam-gone validation + user visual gate → Task 9. ✓
- Fallback sync path preserved throughout (flag-gated, real not stubbed — honors no-mock rule). ✓

**Placeholder scan:** No TBD/TODO. Each code step shows code. Error paths are concrete (worker posts `{ok:false,error}`; image source sets `.broken`).

**Type consistency:** the snapshot shape (`{x,y,biome,wallSlug,roofSlug,tier,footprint{...},facts{northGapTiles,waterProximity,knobs}}`) is identical in Tasks 2, 6, 7, 8. Image handle shape (`{ready,width,height,bitmap|img,broken}`) identical in Tasks 3, 4, 7. `requestBake`/`collectBakeUrls`/`drawBuildingTexturedCore`/`alphaBBox` names consistent across Tasks 7–8.

**Known risk carried forward:** Task 1's outcome decides whether the roof also needs a later GL-geometry rewrite; the plan proceeds either way because off-thread already kills the jam (the user's actual complaint). If Task 1 shows worker OffscreenCanvas is software AND the pop-in delay (building appears ~2 s after entering view) is judged unacceptable at Task 9, the follow-up is a separate GL-roof plan — out of scope here.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, two-stage review between tasks. Good fit: tasks are well-bounded and mostly independent.
2. **Inline Execution** — execute here with checkpoints.

**Task 1 (the benchmark) should run first regardless of mode** — its number decides whether the roof gets faster or merely un-jammed, and it's cheap. Task 9's flag-flip needs the user's visual sign-off (do not default-on blind).
