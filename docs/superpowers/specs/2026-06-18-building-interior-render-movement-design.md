# Building Interior Rendering & Movement — Design

**Date:** 2026-06-18
**Status:** Design (implementation plan to follow via writing-plans). Brainstormed with a signed-off localhost mockup (`.superpowers/brainstorm/.../floor-view.html`) over **real** generated `buildingNode` data.
**Atlas stratum:** S3 Blueprints — the **render/interaction consumer** of the building data model. Edges to S1 (the resolved building set / claims), the canvas renderer (a client per the MMO topology), and the lift-mechanism spec (§9.4, out of scope here).
**Authority consumed:** `2026-06-18-building-data-model-design.md` (the data model; this is its declared-separate §9.2 "Interior rendering + movement" spec) and the Slice-3 handoff `docs/superpowers/2026-06-18-building-model-slice3-handoff.md` (integration points).

**Goal:** Let the player **see and move through the interior of a multi-floor building** — one floor at a time on the 3/4 top-down camera, slide between adjacent floors via the stair, take a lift to a chosen floor in tall buildings, and click a unit to enter its room — rendering the **real lazy `b.footprint.node`** with no faked layouts and without breaking the infinite-world purity or the fragile worker.

---

## 1. What already exists (and what this builds on)

Every building carries a lazy, deterministic `b.footprint.node` (`buildingNode(worldSeed, ctx)`): **building → floor → unit → room**, with per-floor `circulation`, `units[].tiles/doorTile`, fixed `stairCores`, and a `lift` reserved iff `aboveGroundFloors > 3`. The data is **reachable on the main thread** but does **not** survive `structuredClone`/`postMessage` (non-enumerable, holds functions) — re-derive on the far side.

Today a building renders as a **flat single-level footprint**; nothing reads the floor/unit/room tree. A signed-off mockup (built over real `seed=1337` data for a house, a 3-floor shop block, and a 6-floor lift tower) validated the look and feel of this slice.

### Locked decisions (from the mockup sign-off + design Q&A)
- **D1 — Wall read:** **dollhouse-cutaway** is the default interior view (far/north walls tall, near/south walls cut away for a 2.5D read), with a **clean floor-plan** style available as a toggle.
- **D2 — Transition feel:** **stair = vertical slide** between adjacent floors; **lift = floor-picker → faster express jump** (picker shown iff `node.payload.lift != null`).
- **D3 — Multi-floor units:** **build them first** (data prerequisite P1) — implement the already-specified `subFloors` + private internal stair (depth ≤ 1), so a shop can have a back-stair to an upstairs room.
- **D4 — Stair + lift:** **one shared walkable core** — stair and lift both sit in carved circulation on every floor (data prerequisite P2).
- **D5 — Sequencing:** interior floor view now; exterior façade stacking is the **next** sibling slice (own spec).

---

## 2. Data prerequisites (build before the render layer)

These are **small amendments to the existing data model**, already specified there but stubbed in Slice 2. They ship and test as pure-data steps before any rendering.

### P1 — Multi-floor units (`subFloors`, depth ≤ 1)
*Spec authority:* data-model §4 (unit `subFloors?`) + §6 (private internal stairs). *Current stub:* `blueprint-node.js:165` `childKeys(){ return [0]; }` (always one room).

- A unit becomes multi-floor **deterministically** from `f(unit.seed, unitKind, tileCount)` — only large enough, eligible-kind units (e.g. a `shop`/`apartment` above a tile threshold); houses/lobbies/storage stay single-room. Probability/threshold tuned so multi-floor units are the **minority**, not the default.
- A multi-floor unit's payload gains `subFloors` (a small count, **≥2 ⇒ multi-floor**) and a **`privateStair`** tile (interior cell of the unit, fixed across its sub-floors — same selection rule as the building stair core, scoped to the unit's tiles). Entry is **once**, from the main floor circulation via the unit's `doorTile`; the private stair moves between the unit's own sub-floors.
- **Recursion capped at 1:** a sub-floor's room is a leaf — a unit inside a multi-floor unit may **not** itself be multi-floor (enforced in the generator; tested).
- **Node shape:** the `unit` node enumerates **sub-floor** children for a multi-floor unit (each sub-floor → exactly one room), and the existing single `[0]→room` for a single-floor unit. Lazy + memoized like every other node; `_stats.payloads` proves a sub-floor materializes only when touched.
- **Honest absence preserved:** single-floor units are unchanged byte-for-byte; only eligible units gain sub-floors.

### P2 — Shared lift + stair core (lift tile always walkable)
*Spec authority:* resolves data-model open-Q §13 ("share a circulation core"). *Current bug:* `reserveLift` (`vertical.js:83`) places the shaft at `{core.x+1, core.y}`, but `partitionFloor`/`singleUnit` (`floor-partition.js:65`) reserve **only** the stair core into circulation — so on `SINGLE_USE` floors (shopfront, storage, lobby, hall, crypt) and small interiors the lift shaft lands **inside a unit**. On multi-unit floors it is covered **only** when the corridor runs horizontally along `core.y`; a vertical corridor (`x === core.x`) leaves the shaft (`core.x+1, core.y`) inside a unit too — so the fix must be unconditional, not corridor-dependent.

- Thread the **lift shaft tile** into `partitionFloor` and **carve it into circulation on every floor** (both the `singleUnit` path and the small-interior early return), exactly as the stair core is carved. Stair + lift become one contiguous walkable core.
- **Invariant (tested):** on every floor of a lift building, both `stairCore` and `lift.shaft` are members of `circulation`, and no unit's `tiles` contain either. Door-reachability (every unit `doorTile` adjacent to circulation) is preserved.
- If carving the lift tile would orphan a unit, the existing deterministic single-unit fallback applies (total, never throws).

---

## 3. Render architecture — main-thread overlay

**Render the active interior floor as a main-thread overlay on top of the dimmed baked exterior — not a worker re-bake.** The exterior is baked into the worker chunk `ImageBitmap` (can't be cheaply hidden per-frame) and the worker is fragile/high-blast-radius; the `.node` is reachable on the main thread. Hook the overlay + floor-change animation at the **disabled `drawBuildingFloors` call site** in `canvas-renderer.js:330` (the frame clock lives here).

- **Projection:** orthographic straight top-down mirroring the real renderer — `screen = world*tilePx − cam` (`canvas-renderer.js` `tilePx/camX/camY`); the 2.5D look comes from **tall wall sprites billboarded upward** (north behind, south in front), matching `building-renderer.js drawBuildingFloors:102`/`drawBuildingWalls:142`. The mockup mirrors this loop; the real overlay reuses the renderer's per-frame view (expose `renderer._lastView = {camX,camY,tilePx}` so picker and renderer share **one** transform).
- **Wall styles (D1):** dollhouse-cutaway default; floor-plan toggle. Wall sprites are the existing `stone_brick_tiles` set; floor tiles are the existing per-material wang sets (`floors/{material}/`).
- **Camera mode:** a dedicated "floor view" state — entering a building dims the world and draws the active floor; exiting restores the normal view.

---

## 4. Floor-view state machine

`floorView = { buildingId, floorIndex, transition, enteredUnitId? }` (a renderer field; default `null` = normal play).
- **Enter** a building → `floorIndex = ` lowest **above-ground** floor (clamp to `floorRange`; do **not** assume index 0 — basements are negative). **Exit** → clear.
- **Change floor** clamps to `floorRange`; **lift jump** allowed only when `node.payload.lift != null`.
- Touches `node.child(floorIdx).payload` **only for the active floor** — never walks `node.children()` in a per-frame/per-tile loop (preserves laziness; `_stats.payloads` guards eager materialization). Memoize the active floor's resolved layout.

---

## 5. Movement model

- **Stair (D2):** stand-on / click the `stairCore` → **slide** to `floorIndex ± 1` (the shared core, fixed screen position every floor of the column — a **data** guarantee; never re-pick per floor).
- **Lift (D2):** click the `lift.shaft` (or a lift button) → **floor-picker menu** → **express** transition to the chosen floor. Menu gated strictly on `node.payload.lift != null` (never inferred from raw `floorRange` length — basements count there but not in `aboveGroundFloors`).
- **Multi-floor unit (P1):** entering such a unit reveals its **private internal stair**; using it slides between the unit's ≤1 sub-floors (same slide feel, scoped to the unit).
- **Unit entry:** click a unit's tiles → **enter** `unit.child(…)→room.payload.interior` (the lazy `f(unitId)` interior — furniture/structure/objects). Every unit is reachable: its `doorTile` opens onto circulation (guaranteed by `floor-partition.js`).

---

## 6. The pure interior-layout query (the testable core)

A pure function `resolveFloorLayout(node, floorIndex) → { walkable:Set<'x,y'>, units:[{id,unitKind,tiles,doorTile}], stairTile, liftTile|null, multiFloorUnits:[unitId], bounds }` — deterministic, reuses `partitionFloor`/`vertical` outputs, touches only the active floor. The renderer and the click hit-test both consume this **one** result (draw-set == click-set). Unit hit-testing resolves a world tile via the resolved set's `byTile`, **not** a bespoke bounding-box test (avoids empty courtyard/L gaps).

---

## 7. Integration points (from handoff §5)

- **Render hook:** `canvas-renderer.js:330` (overlay + animation); mirror `building-renderer.js drawBuildingFloors:102`.
- **Gameplay click (net-new):** add a `pointerdown` listener near boot in `src/main.js`; invert the world↔screen transform via the shared `_lastView`; resolve tile→building via `resolveBuildingsInRange(...).byTile`.
- **Convergence TODO (before floor UI):** migrate `sim-debug-overlay.js` (which still computes its own building set inline via `layoutSettlement(...)`, with its own cap/de-overlap) onto the **shared resolved set**, so the `9` click-set, the gameplay click-set, and the chunk renderer resolve to the **same** building objects (and thus the same `.node`).
- **Worker:** prefer the overlay; `queryBuildingTile`/`queryBuildingWall` are ground-floor-only — do **not** add a floor-N worker bake. Bump the cache-bust token (`chunk-provider.js`) on any building-code change.

---

## 8. Honest absence (no-mock)

Until a floor is entered, a building shows its flat footprint exactly as today. No faked one-room interiors, no faked occupants (`occupancySlots` stay nominal; Society assigns NPCs — out of scope). A building with `lift == null` simply has no lift UI. Multi-floor units appear only where the generator deterministically produces them.

---

## 9. Testing — assertable predicates (TDD)

**Data prerequisites**
- **P1:** an eligible large unit materializes `subFloors ≥ 2` + a `privateStair` tile that is an interior cell of the unit, fixed across its sub-floors; an ineligible/small unit is byte-identical to today (one room); **recursion depth never exceeds 1** (a sub-floor room is a leaf); sub-floors materialize lazily (`_stats.payloads`). Determinism: byte-identical across repeated generation.
- **P2:** on every floor of a lift building, `stairCore ∈ circulation` **and** `lift.shaft ∈ circulation`, and no unit `tiles` contain either; every unit `doorTile` is flood-fill-reachable from the shared core; `lift present ⟺ aboveGroundFloors > 3` still holds.

**Render/movement (headless state machine)**
- Floor-view state clamps to `floorRange` (incl. negative basements); default floor is lowest above-ground.
- Lift menu offered **iff** `node.payload.lift != null`; lift jump reaches any floor in range; stair changes by ±1 only.
- `resolveFloorLayout` is deterministic (byte-identical) and equals the click hit-test source (draw-set == click-set).
- Entering a unit yields its `room.interior`; entering a multi-floor unit exposes its private-stair navigation (≤1 sub-floor).
- Laziness: rendering floor N over many frames materializes payloads only for N (+ ancestors), never N±1.

**Regression:** the building suite stays green (the **2 known pre-existing failures** — `size within type range across 20 seeds`, `integration: layout fits within territory` — remain the only reds).

---

## 10. File structure & build order

**Order (D3: data first):**
1. **P1 — multi-floor units:** `blueprint-node.js` (unit kind: deterministic sub-floor enumeration + private stair; recursion guard), helpers in `vertical.js`/`floor-partition.js` as needed; tests in `sim/test/`.
2. **P2 — shared lift core:** `floor-partition.js` (`partitionFloor`/`singleUnit` carve the lift shaft into circulation), thread the shaft from `blueprint-node.js`; tests.
3. **Convergence:** migrate `sim-debug-overlay.js` onto the shared resolved set.
4. **Pure query:** `resolveFloorLayout` (new, e.g. `sim/world/buildings/floor-layout.js` or a render-side module) + tests.
5. **Floor-view state machine** (new render module) + headless tests.
6. **Render overlay + movement:** `canvas-renderer.js` hook, interior draw (mirror `building-renderer.js`), wall-style toggle, stair-slide + lift-express animation, click→enter wiring (`main.js`).
7. **Browser verification:** screenshot the real floor view + transitions; confirm no worker crash; bump cache-bust.

Each step ends green and is independently reviewable.

---

## 11. Open questions (resolve during implementation)

- Multi-floor-unit eligibility threshold + rate (tile-count cutoff, eligible kinds) — tune so they're a tasteful minority.
- Very tall single towers: one stair core is assumed (compound-wing multi-core already handled by data); revisit only if a single column reads as too sparse.
- Dollhouse-cutaway exact wall heights/occlusion vs the real `wallH = tilePx×4` (the mockup used a readable height; the real overlay reconciles with the sprite set).
- Lift express animation: flash-through-floors vs direct fade — finalize in-browser.

---

## 12. Out of scope (separate specs)

Exterior façade stacking (next sibling, D5) · roof caps · the lift **mechanism** device (teleport/pulley/tube — this slice builds only the floor-select interface) · NPC home/work assignment · rich room content beyond the lazy `room` contract · cross-building bridge/tunnel traversal.
