# Building resolve → Web Worker (eliminate the walk-into-town stutter)

**2026-06-29.** Root cause of the remaining walk stutter: `resolveBuildingsInRange` runs
synchronously in the draw `mid` pass on every macro-cell crossing, and `layoutSettlement` is
**21ms (village) / 60ms (town) / 155ms (city)** per *newly-encountered* settlement. Verified via
`window._drawProf` (mid spikes 90–677ms) + `window._dbgResolveBreakdown` (layoutMs dominates,
~96ms/cold settlement). Not a hotspot/loop — it's ~0.26ms × hundreds of `generateFootprint` calls,
**atomic per settlement** (a 155ms city layout is indivisible on one thread → amortizing can't smooth
it). Interior gen is only 2% (already made lazy), buildingNode 1%, grow loop 1.0 iters (clean).

## Feasibility — CONFIRMED
Terrain is a **pure procedural f(x,y,seed)**: `classifyBiomeNoStream` / `classifyTerrainForm`
(terrain-suitability.js header says so explicitly). No loaded chunk data → a worker can resolve
buildings entirely from the seed. The classifiers read `getWorldSeed()` (localStorage, absent in a
worker → DEFAULT_SEED 42), so the worker MUST call `setWorldSeed(seed)` from the first message.

## The one hard part — the blueprint `node`
`footprint.node` (blueprint-node.js `buildingNode`) is **non-enumerable + carries functions** → dropped
by `postMessage`/structuredClone. Render consumers of node:
- `building-shadow.js` → `node.payload.aboveGroundFloors` (shadow length) — PER-FRAME-ish, common path.
- `resolved-buildings.js:~239` → `node.payload.aboveGroundFloors` (height-aware north claim) — runs IN
  the worker during resolve, so fine there.
- `active-interior.js` / `floor-view.js` → `resolveFloorLayout(node, …)` — walk-in only, RARE, one building.
- `sim-debug-overlay.js` → `node.payload.stackPlan` / `buildingTenancies(node)` — '9' overlay only.

Also `footprint.interior` is now a lazy enumerable getter → structuredClone INVOKES it (interior computed
in the worker, posted as data) — acceptable (off-thread).

### Strategy for node
1. In the worker, before posting, copy the cheap scalar the common path needs onto a PLAIN field:
   `fp.aboveGroundFloors = fp.node?.payload?.aboveGroundFloors ?? 1`. Change `building-shadow.js` to read
   `fp.aboveGroundFloors ?? fp.node?.payload?.aboveGroundFloors ?? 1`.
2. Walk-in + '9' overlay need the FULL functional node. Rebuild it **on demand** on the main thread when
   the player enters a building / opens the overlay: re-resolve just that ONE building synchronously (cheap)
   or expose the footprint generation seed so `buildingNode(genSeed, ctx)` reattaches exactly. Carrying the
   gen seed: `placeBuildings` builds each fp via `generateFootprint(mix(...), …)`; stash that seed as an
   ENUMERABLE `fp._genSeed` so it survives the clone, then main-thread lazy getter:
   `Object.defineProperty(fp,'node',{enumerable:false,get(){return buildingNode(fp._genSeed,{bx:0,by:0,typeId,category,tier,centrality:0.5,race,sections})}})`.
   (Check the `structuredClone(fp)` field-set test still passes; `_genSeed` is a new enumerable field.)

## Files
- NEW `sim/world/buildings/resolve-worker.js` — `onmessage({seed,mx0,my0,mx1,my1,reqId})` →
  `setWorldSeed(seed)`; `const {buildings,claimTiles}=resolveBuildingsInRange(...)`; attach
  `aboveGroundFloors`+`_genSeed`; `postMessage({reqId,buildings,claimKeys:[...claimTiles]})`.
- NEW `src/render/building-resolve-client.js` — owns the Worker; `request(seed,range,key)` (dedupe by key,
  only-latest-queued); on message → reattach lazy `node`, build `claimSet`, set `latest={key,buildings,claimSet}`,
  fire a claim callback. `getLatest()`. Graceful: if Worker ctor throws (or `window._buildingWorker!==true`),
  no-op so caller uses the sync path.
- EDIT `src/render/building-renderer.js` `updateBuildingClaims`: if `window._buildingWorker`,
  `client.request(seed,range,key)` and serve `client.getLatest()?.buildings` (keep previous until the new
  set arrives — brief, like chunk streaming; on first-ever/teleport show nothing for ~1-10 frames). Else the
  current synchronous path (UNCHANGED — default).
- EDIT `building-shadow.js` (aboveGroundFloors plain-field fallback).
- EDIT `footprints.js` (expose `_genSeed`) OR `placeBuildings`.

## Flag + rollout
`window._buildingWorker` (default **OFF** → zero change to today's working build). User flips it on and
verifies: buildings appear after crossings without a freeze; **shadows** correct (aboveGroundFloors);
**walk into a building** works (node rebuild); **'9' overlay** works. Once verified → default ON.

## Verify (browser — REQUIRED, can't be done headless)
1. `window._buildingWorker=true`, walk into a town → smooth, buildings stream in (no mid-pass spike;
   `window._drawProf` mid stays low; `window._perf` no 67ms frames).
2. Shadows present + correct length on multi-story buildings.
3. Enter a building (walk-in) → floors/stairs work. Press 9 → overlay labels/tenancies render.
4. Teleport across biomes → buildings appear within ~10 frames, no empties that persist.

## Done this session (the OTHER stutter layers, all committed on building-facade-blocks)
atlas strip-key bucketing (flash) · atlas 8192²→16384² · GPU-path atlas-reset hidden · AMORT_BUDGET_MS
8→3 · lazy footprint interior · reverted the broken sync-amortization (buildings load correctly).
