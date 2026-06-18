# Building Model — Slice 3 Handoff: Interior Rendering & Movement

**Date:** 2026-06-18 · **Branch:** `motion-eval-system` · **Status of prior work:** Slice 1 + Slice 2 **DONE & committed**. This doc hands off the **next slice**: the interaction + render layer (walk into units, change floors, click a unit, lift floor-picker). Written so you can clear context and resume cold.

> Authority: `docs/superpowers/specs/2026-06-18-building-data-model-design.md` (the spec) and `…/plans/2026-06-18-building-data-model-plan.md` (the data-model plan). The render/interaction layer is **§9.2 "Interior rendering + movement"**, which the spec explicitly **declares a SEPARATE spec consuming the data hooks** — so this slice *starts with its own design + plan*, then implements.

---

## 0. First action on resume (do this in order)

1. **Read** this doc, then spec **§4** (payloads), **§6** (vertical transit / stair cores / lift), **§9** (declared-separate render hooks), **§13** (open questions), **§14** (out-of-scope siblings).
2. **Brainstorm + mockup FIRST.** The user explicitly asked to *see* the 3/4 top-down floor view and the between-floors transition **as a localhost mockup before full build** ("would be good to see in localhost… a view of what that would look like as a mockup and then what moving between floors will look like graphically"). Use the **brainstorming skill** → produce a visual mockup on localhost → get sign-off on the look → **writing-plans skill** → implement TDD. Do **not** skip the mockup/approval gate.
3. **Implement** against the integration points in §5 below, keeping the building suite green (§6).

**The data is ready.** Every building already carries a lazy multi-floor `BlueprintNode` (`b.footprint.node`) with floors → units → rooms, circulation, stair cores, and lift. **Nothing renders or reads it yet** — that's this slice.

---

## 1. Where we are

The building system produces **one** resolved, de-overlapped building set per visible range via `resolveBuildingsInRange(seed, mx0,my0,mx1,my1)` → `{ buildings, byTile, claimTiles }`. Three consumers read it and must agree (draw-set == click-set): the main-thread renderer, the worker tile-query (baked into chunk bitmaps), and the `9` debug overlay.

- **Slice 1 (done):** unified seed (`getWorldSeed()`), single resolved set, tile-level de-overlap, `architectureClaimAt` predicate replaced the mutable `buildingClaimTiles`.
- **Slice 2 (done):** the multi-floor data model — `shapes.js`, `building-floors.js`, `vertical.js`, `floor-partition.js`, `blueprint-node.js`, and `generateFootprint` attaching the node. All pure/deterministic/lazy. 26 new tests; suite green except 2 pre-existing failures (§6).

**Today a building renders as a FLAT single-level ground plan** (filled footprint sections + door marks + wall sprites + label). Clicking only works inside the `9` overlay and opens a read-only panel showing the **flat** `footprint.interior`. No z-axis, no floor concept, no unit entry, no lift UI.

---

## 2. The data model you already have (exact shapes)

`b.footprint.node` is a `BlueprintNode` (from `buildingNode(worldSeed, ctx)` in `sim/world/buildings/blueprint-node.js`). It is **lazy** (a 100-floor tower costs nothing until a floor is touched), **memoized**, **deterministic**, and addressed by **path tuple** (`node.id` = e.g. `b/100/200/f/3/u/1/r/0`).

| Node | `.payload` shape | `.childKeys()` | `.child(key)` |
|---|---|---|---|
| **building** | `{ sections, floorRange:[min,max], aboveGroundFloors, stackPlan:[{index,use}], stairCores:[{x,y}], lift }` | floor indices `min..max` (min may be **negative** = basements) | a **floor** node |
| **floor** | `{ floorIndex, use, stairCore, lift, circulation:['x,y',…], units:[{unitKind,tiles:[{x,y}],doorTile}] }` | unit indices `0..n-1` | a **unit** node |
| **unit** | `{ unitKind, tiles:[{x,y}], doorTile:{x,y} }` | `[0]` (exactly one room) | a **room** node |
| **room** (leaf) | `{ unitKind, tiles, doorTile, interior }` (`interior` = full `generateInterior` output) | `[]` | — |

`lift` is `null` **unless** `aboveGroundFloors > 3` (locked biconditional), then `{ shaft:{x,y}, mechanismId:'generic-lift' }`.

**Coordinate frame:** node tiles (`units[].tiles`, `circulation`, `stairCores`) are **footprint-LOCAL** (same frame as `fp.sections`, relative to section `x0/y0`). The building's world origin is `b.x, b.y`. To hit-test a world click against a unit, offset unit tiles by `b.x + b.y` exactly like `building-renderer.js drawBuildingFloors` does (its tile→screen loop). The node is built with placeholder `ctx {bx:0, by:0, centrality:0.5}` (`footprints.js:256-266`) — fine for structure; if the render slice needs real per-building floor counts driven by lot centrality, thread real `bx/by/centrality` through (flagged, not a blocker).

---

## 3. The next slice — scope

Per spec **§9.2**: *"Interior rendering + movement: one floor at a time on the 3/4 camera; stair = slide to adjacent floor; lift = floor menu. Model provides per-floor interiors, unit doors, stair/lift tiles."* The user's explicit requirements from the design conversation:

- **3/4 top-down view of one floor at a time.** Show a **mockup on localhost first**, plus what **moving between floors** looks like graphically.
- **Click an individual unit to enter it.** A floor with 4 shops must have walkable space to enter/exit every shop — already guaranteed by `floor-partition.js` (every unit's `doorTile` opens onto `circulation`).
- **Consistent staircase** within the interior, at the **same screen position on every floor of its column** (guaranteed by the data: `stairCores` are fixed per column — do **not** re-pick per floor). Multi-floor units may have their **own internal sub-staircase** (sub-floor depth **≤ 1**, do not build a recursive navigator for arbitrary nesting).
- **Automated lift for buildings > 3 floors** — a "generic tubular lift thing" where you **choose floor 58**. Show the floor-select menu **iff `node.payload.lift` is non-null** (never inferred from raw `floorRange` length — basements count in `floorRange` but not in `aboveGroundFloors`).

**Distinct sibling the user ALSO wants (separate spec, §14, item 1): exterior façade stacking** — "I don't want a five-story building to look like a one-story building." That's the *exterior* appearing multi-story (façade/roof, §9 item 1 + item 3), **not** this slice's interior view. Recommend sequencing the interior floor view (item 2 — "floors/units", data ready) first, with façade stacking as the next sibling slice. Confirm order with the user during the mockup.

**Out of scope for this slice (each its own spec, §14):** exterior façade/setback geometry (item 1), roof cap (item 3), the lift **mechanism** device — teleport/pulley/tube (§9.4; this slice builds only the floor-select **interface**), and cross-building bridges/tunnels (district-level).

**Honest absence (no-mock rule):** until built, a building with no floor entered just shows its flat ground footprint, as today. Do **not** fake a one-room interior or fake occupants (`occupancySlots` are nominal; no NPCs assigned).

---

## 4. Recommended approach

**Render as a MAIN-THREAD overlay, not a worker re-bake.** The exterior is baked into the worker chunk `ImageBitmap` (can't be cheaply hidden per-frame). Cleanest: a dedicated "floor view" camera mode drawn on the main thread *on top of* the dimmed baked exterior. This sidesteps the z-order/lighting reasons floors were baked into the worker, and **`b.footprint.node` is reachable on the main thread** (it does NOT survive `postMessage`/structured-clone — see gotchas).

Suggested shape (confirm in the design pass):
1. **Floor-view state** — `{ buildingId, floorIndex, transition }` (a module global or renderer field), default floor = lowest above-ground (clamp `floorRange` to ≥0; don't assume index 0 is "ground" conceptually).
2. **Interior renderer** — mirror `drawBuildingFloors`' camera-space tile loop, but iterate `node.child(floorIdx).payload` (circulation + `units[].tiles` + each unit's `room.interior` furniture) instead of `footprint.sections`. Draw `stairCore` + `lift.shaft` tiles distinctly, at the fixed per-column position.
3. **Movement** — stand on / click the `stairCore` → slide-transition to `floorIndex ± 1`; lift shaft → floor-select menu (`node.payload.lift` gates it).
4. **Unit entry** — click a unit's tiles → focus/enter `unit.child(0).payload.interior`.

**Touch the node only for the active/selected floor** — never walk `node.children()` in a per-frame or per-tile loop (kills the laziness; `_stats.payloads` in `blueprint-node.js` exists to catch accidental eager materialization).

### TDD task sketch (write the real plan via writing-plans)
- Pure interior-layout query (`floor → walkable tiles + stair/lift/door tiles`) with tests (reuses `partitionFloor`/`vertical` outputs; deterministic).
- Floor-view state machine (enter/exit, change floor, clamp to `floorRange`, lift-gated jump) — unit-tested headless.
- Renderer/overlay wiring (mockup-first, then real).
- Browser verification (mockup screenshot → user sign-off → full build).

---

## 5. Integration points (exact files/lines)

**Click → building (today, the only path):** `src/render/sim-debug-overlay.js` — `9` overlay only. `drawSimDebugOverlay` (`:110`) rebuilds `_renderedBuildings` (screen rects, push at `:277`) every frame; `initSimDebugOverlay` (`:634`) installs window `click` (`:689`) / `mousemove` (`:677`) / `keydown` (`:635`, toggles `9`, copies with `c`). Click handler order: teleport buttons → building rects (`:706-713`) → settlement centers → clear. The click world-tile is already computed (`clickTileX/Y` ~`:717-718`) — reuse it to index into a floor's unit tile sets.

**Gameplay click (does NOT exist — net-new):** `src/input.js` is **keyboard-only**; the canvas has **zero** pointer listeners. To add "click a building" in play (spec §12 TODO at design `:210`):
- Add `canvas.addEventListener('pointerdown', …)` near boot in `src/main.js` (wiring block ~`:24`/`:89-143`).
- Invert the world↔screen transform from `src/render/canvas-renderer.js`: `tilePx` (`:235`), `camX` (`:263`), `camY` (`:264`, includes `elevationOffsetY`). These are **locals inside `draw()`** — expose them per-frame (e.g. `renderer._lastView = {camX,camY,tilePx}`, mirroring how the overlay gets them via `drawSimDebugOverlay(camX,camY,tilePx,…)` at `:441` and stashes `_lastDrawState` at `sim-debug-overlay.js:125`) so both pickers share ONE transform source.
- Resolve tile → building via `resolveBuildingsInRange(...).byTile.get('wx,wy')` (`resolved-buildings.js:96-108`) — **do not re-implement hit-testing**, and prefer this (tile-accurate to sections) over the overlay's bounding-box rect test (which hits empty courtyard/L gaps).
- Reference pattern for a canvas click→world handler: `src/world/overmap.js:32` (`getBoundingClientRect` + inverse transform).

**Render path:**
- `src/render/canvas-renderer.js:330` — the **disabled** `drawBuildingFloors` call site, and `:414` tuner-only `drawBuildingWalls`. **Best hook for the main-thread interior overlay + floor-change animation** (canvas-renderer owns the frame clock).
- `src/render/building-renderer.js` — `drawBuildingFloors:102` (camera-space tile loop, the template to mirror), `drawBuildingWalls:142` (north `:262`, E/W `:296`, interior `:348` currently `P.interiorWall=false`, south `:353`), `ensureFloorImages:29` (the `_floorImgs/_wallImgs` cache to extend with furniture sprites).
- `src/render/worker-chunk-renderer.js` — active bake: floor draw `~:1163`, **wall post-pass `:1317-1467`** (wrapped in try/catch `:1319/:1465` because a crash here previously killed ALL chunk rendering — any new worker building code is high-blast-radius; guard it). `queryBuildingTile`/`queryBuildingWall` are **ground-floor-only**; a floor-N worker bake would need floorIdx-aware siblings (avoid — prefer the overlay).
- `src/render/building-tile-query.js` — `cachedLayout:33` (floorIndex/wallIndex built from flat sections), `getBuildingsNearChunk:205`, `queryBuildingTile:233`. `.node` IS reachable here (worker regenerates buildings in-process).

**Data hooks:** `sim/world/buildings/blueprint-node.js` — `buildingNode:197`, building payload `:101-116`, floor payload `:138-146`, unit `:160-174`, room `:177-187`. `floor-partition.js partitionFloor` = walkable layout. `vertical.js selectStairCores/reserveLift` = stair/lift tiles. `interiors.js STRUCTURE:65` (`stairs_up/down`, `connects:'above'/'below'`) = furniture/structure content + transition metadata.

**Convergence TODO (do this BEFORE adding floor UI, design `:209`):** `sim-debug-overlay.js` still computes layouts **inline** via `layoutSettlement(getWorldSeed(),…)` (`:195`/`:531`) with its **own** de-overlap + `MAX_OVERLAY_BUILDINGS=80` cap (`:181-243`) — a SECOND building set that can diverge from `resolveBuildingsInRange`. Migrate the overlay onto the shared resolved set so the `9` click-set, the gameplay click-set, and the chunk renderer all resolve to the **same** building objects (and thus the same `.node`).

---

## 6. Current state (verified)

- **Branch:** `motion-eval-system` (PR base `master`; building work not yet on master).
- **Modules** (`sim/world/buildings/`): `shapes.js`, `building-floors.js`, `vertical.js`, `floor-partition.js`, `blueprint-node.js`, `tiers.js` (leaf — tier names live here to break the `layout→footprints→blueprint-node→building-floors→layout` cycle), `footprints.js` (attaches non-enumerable `.node`), `resolved-buildings.js`. Signatures are in §2 + the spec.
- **Tests:** `node --test sim/test/buildings-*.test.js sim/test/resolved-buildings.test.js sim/test/settlement-discovery.test.js sim/test/decoration-claims-architecture.test.js`. 13 building files together ≈ **107 pass / 2 fail**. The **2 failures are PRE-EXISTING and unrelated** (confirmed via git-stash): `size within type range across 20 seeds` (`buildings-footprints.test.js`) and `integration: layout fits within territory` (`buildings-layout.test.js`). The full suite is slow (>400s) — run targeted subsets.
- **Worker cache-bust:** `src/world/chunk-provider.js:134` `searchParams.set('v', '20260618c')`. **Bump this on any building-code change** — a plain `Ctrl+Shift+R` does NOT kill a running worker; bumping the token gives it a new URL so a reload spawns a fresh one. Incognito is the bulletproof check.
- **Recent building commits (newest first):** `a7c302e0a` S2.6 node attach · `ee84cb5d8` tiers leaf (cycle break) · `67e2422d1` S2.5 lazy node tree · `415f9f090` S2.1 shape catalog · `a40967b50` compound 3-wing fix · `2f013953c` S2.4 floor partition · `bd43cedc0` cache-bust bump · `3d46f3c48` stair cores+lift · `5786d8f04` S2.2 floor count/stack plan.

### ⚠️ Uncommitted working-tree changes that are NOT mine — leave them
Three tracked source files are modified by **other sessions / the asset pipeline** (3 sessions share this dir — see the "parallel agents: use worktrees" memory). Do **not** commit, revert, or build on them as if they're the building model:
- `sim/world/buildings/resolved-buildings.js` — a parallel session's **`buildingSpansCliff` terrain filter** (imports `classifyTerrainForm` from `src/world/terrain-forms.js`; skips buildings spanning a cliff/step/plateau edge). Compatible with Slice 2 (my tests passed with it present), but it's their WIP.
- `src/render/gl-compositor.js` — not building-model; another session.
- `src/world/lg-catalog.js` — the **user's background asset-gen pipeline. NEVER touch** (per CLAUDE.md).

If you need to commit interior-render work, stage **only your own files** explicitly; never `git add -A`. Consider an **isolated worktree** for implementation (the worktree memory).

---

## 7. Conventions & gotchas

- **`b.footprint.node` is NON-ENUMERABLE and holds functions** → dropped by `JSON`/`structuredClone`/spread. It survives only in the process that generated it (main thread; and inside the worker which regenerates in-process). It will **not** survive `postMessage` or sim-protocol serialize — re-derive via `buildingNode(seed, ctx)` on the far side. **Never `{...footprint}`** (a spread copy loses the node).
- **Don't eagerly walk `node.children()`** in per-frame/per-tile loops — touch `node.child(floorIdx).payload` only for the active floor; memoize. `_stats.payloads` catches accidental eager materialization.
- **`floorRange` can be negative** (basements). Pick the default/baked floor deliberately (lowest above-ground), not blindly `0`.
- **Two `interior` truths coexist:** the legacy flat `fp.interior` (what the overlay panel reads today) and node-driven per-room `room.payload.interior`. Switch to node-driven for floors **without deleting** `fp.interior` (S2.6 keeps all existing fields byte-identical).
- **Stair core consistency is a DATA guarantee** (§6) — draw it at the same screen position every floor; never re-pick per floor.
- **Lift gating is a hard biconditional** — show the menu iff `node.payload.lift` is non-null.
- **Sub-staircase depth ≤ 1** — no recursive multi-floor-unit-in-multi-floor-unit.
- **Wall calibration constants are DUPLICATED** in 3 places (`wall-config.js WALL_CONFIG`; inlined `WY/WH/NY/EWH/EWX` in the worker post-pass; fallback defaults in `building-renderer.js`) — a geometry change touches all three.
- **Wang tilesets must be 32×32** (project rule). **Sim world is infinite** — no bounded regions; everything is `f(seed, …)` + LOD. **No-mock rule** — a system is ABSENT, never FAKE.
- **The worker is fragile** — recent commits (`cd9878037`, `4a14b4dea`) were syntax errors that killed ALL chunk rendering. Verify in-browser after worker-path edits.

---

## 8. How to verify in the browser

- Dev servers run on **`:8000`** (yours, `127.0.0.1`) and **`:8123`** (another session). Both serve the working tree live. Navigate to `http://127.0.0.1:8000/index.html`.
- **Benign console noise:** the `ws://127.0.0.1:8787/` `ERR_CONNECTION_REFUSED` is the separate local **sim process** (not running) — not a code error. `lava_fern` (and similar) **404s** are un-generated assets, not code errors.
- A **healthy load** = no JS exceptions, no worker crash, chunks paint, asset requests fire. After a building-code change, **bump the cache-bust token** (§6) and hard-reload, or use incognito.
- For the mockup: the user wants to *see* the 3/4 floor view + floor-change on localhost before you build the full thing — screenshot it and get sign-off.

---

## 9. Open design questions (spec §13 — resolve during the design pass)

- Do the stair core and lift share one circulation core, or separate shafts?
- Do very tall single towers need multiple stair cores?
- Setback geometry (footprint shrinking with height) is a façade hint only now — the interior slice may assume a constant per-column footprint unless it chooses to resolve setbacks (full setback geometry is the exterior spec).
- Floor-change UX: stair = slide animation between adjacent floors; lift = scrollable floor menu ("choose floor 58"). Nail the feel in the mockup.

---

### One-paragraph resume prompt (paste-ready)
> Continue the multi-floor building model on branch `motion-eval-system`. Slice 1 + 2 (data model) are done & committed; every building has a lazy `b.footprint.node` (building→floor→unit→room, see handoff §2). Execute the **interior rendering & movement** slice (spec §9.2): one floor at a time on the 3/4 top-down camera, stair-slide between floors, lift floor-picker for >3-story buildings, click a unit to enter. Per spec §9/§14 this is a declared-separate spec — **start with a brief brainstorm + a localhost MOCKUP of the floor view and the between-floors transition, get the user's sign-off on the look, then writing-plans, then implement TDD**. Render as a main-thread overlay (hooks in handoff §5). Keep the building suite green (2 known pre-existing failures). Do NOT touch the uncommitted `resolved-buildings.js`/`gl-compositor.js`/`lg-catalog.js` (other sessions / asset pipeline). Full handoff: `docs/superpowers/2026-06-18-building-model-slice3-handoff.md`.
