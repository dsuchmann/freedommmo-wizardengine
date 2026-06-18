# Building Data Model — Implementation Plan

> **For agentic workers:** TDD, one task at a time, keep `node --test sim/test/*.test.js` green (baseline 380). Spec: `docs/superpowers/specs/2026-06-18-building-data-model-design.md`. Plan derived from a code-grounded multi-agent planning pass + adversarial review (conditional-GO; spec falsehoods corrected).

**Goal:** Ship the resolved-building-set bug fix (Slice 1), then the multi-floor nested building model (Slice 2).

**Architecture:** Settlement node is the pure unit (`layoutSettlement`, cached per macro-cell). One resolved building set (capped + tile-level de-overlapped + claim-resolved) shared by draw / floor-wall query / labels / click. Lazy `BlueprintNode` floors/units/rooms on top. One claims system via a pure `architectureClaimAt` predicate (net-new tier above F6; deletes the mutable `buildingClaimTiles`).

---

## SLICE 1 — seed unification + one resolved building set (fixes #50/#51)

### S1.1 — `settlement-discovery.js` (one pure, seed-respecting discovery)
- **New:** `sim/world/buildings/settlement-discovery.js`, `sim/test/settlement-discovery.test.js`
- Extract the discover logic triplicated across `sim-debug-overlay.js discoverSettlements (24-101)`, `building-renderer.js discoverBuildings (81-138)`, `building-tile-query.js cachedLayout (32-77)` into ONE module taking an **explicit seed** (never `getWorldSeed`). Export `discoverSettlementsInMacroRange(seed,mx0,my0,mx1,my1)` reproducing chronicle→site→water-skip byte-for-byte (same rand salts `mx*7+1/my*13+2`, `mx*11+3/my*17+4`, same WATER set, same `chronicleTier/settlementState/macroCellPeoples` calls, same founding-event race pick). Export `siteForMacro(seed,mx,my)` (single source of the offset formula). Move the tier-spacing suppression (overlay 66-100: `MIN_SPACING`, `TIER_RANK`) here as `suppressBySpacing(settlements)`.
- **Tests:** (a) `discoverSettlementsInMacroRange(42,…)` deepEquals current overlay output for a fixed range w/ a settlement; (b) determinism (two calls deepEqual); (c) seed divergence (seed 7 ≠ seed 42); (d) `siteForMacro(42,…)` == inline offset formula.

### S1.2 — `resolved-buildings.js` (one set: cap + tile-level de-overlap + claim tiles)
- **New:** `sim/world/buildings/resolved-buildings.js`, `sim/test/resolved-buildings.test.js`
- Pure `resolveBuildingsInRange(seed,mx0,my0,mx1,my1) → {buildings, byTile:Map, claimTiles:Set}`: discover+suppress → per kept settlement `layoutSettlement(seed,{x,y},tier,race,biome)` (seed param, **not** 42) → per-building water-skip → **one deterministic tile-level de-overlap**: walk settlements sorted `(mx,my,x,y)` then building index into a global occupied Set, first writer wins (2-tile margin, mirrors overlay `globalOccupied 294-307`); whole-building demotion if a stair/door tile is lost. `byTile` from footprint **sections** (matching `floorIndex 88-108`, not bbox). `claimTiles` = sections + `CLAIM_MARGIN` + NORTH band (renderer 128-134). `MAX_SETTLEMENT_RADIUS=220`, `MAX_RESOLVED_BUILDINGS=80` (kept in Slice 1).
- **Tests:** (a) no two buildings' section tiles share a key across the set; (b) determinism on `buildings[].{x,y,footprint.typeId}`; (c) `byTile` sampled building resolves to it; (d) `claimTiles` covers floor + north band; (e) cap respected; (f) **range-independence** (a building shared by two overlapping ranges kept identically).

### S1.3 — `building-renderer.js` consumes the resolved set
- **Edit:** `src/render/building-renderer.js`
- Delete `WORLD_SEED=42` (18) + bespoke `discoverBuildings (81-138)` incl `buildingClaimTiles.clear()/.add()`; remove the `buildingClaimTiles` import. In `updateBuildingClaims` compute the macro range and call `resolveBuildingsInRange(getWorldSeed(),…)`; `_cache.buildings = result.buildings`; keep the frame cache gate. Floors/walls keep iterating `_cache.buildings`.
- **Tests:** assert source no longer contains `buildingClaimTiles` / `WORLD_SEED = 42` (render fns are canvas-bound; behavior covered by S1.2 + S1.7 seed test).

### S1.4 — delete `buildingClaimTiles`; pure architecture predicate
- **Edit:** `src/world/decoration-claims.js`; **New:** `sim/test/decoration-claims-architecture.test.js`
- Remove `export const buildingClaimTiles` (553). Add `setArchitectureClaim(predicate)` (default `()=>false`) + internal `architectureClaimAt(wx,wy)`. Replace the 4 read sites (`isClaimedAt 558`, `f4Placements 601`, `f5Placements`, `f6Placements 805`): `buildingClaimTiles.has(...)` → `architectureClaimAt(wx,wy)`. Producers call `setArchitectureClaim(wx,wy => claimSet.has(wx+','+wy))` from the resolved `claimTiles`. `setArchitectureClaim` must `clearClaimCaches()` on predicate-identity change.
- **Tests:** (a) default false → flora still places; (b) `setArchitectureClaim(()=>true)` → f4/f5/f6 return EMPTY, isClaimedAt true; (c) **purity:** predicate from `resolveBuildingsInRange(42,…).claimTiles`, getClaimMask identical computed twice w/ no canvas call; (d) `clearClaimCaches` preserves `_archClaim`; (e) predicate change clears caches.

### S1.5 — cross-settlement de-overlap correctness (owner tie-break)
- **Edit:** `sim/world/buildings/resolved-buildings.js`; **New:** `sim/test/resolved-buildings-deoverlap.test.js`
- The S1.2 global-occupied sweep is the single owner authority: contested tile → building from lower-`(mx,my,x,y)` settlement (then lower index) wins; loser's contending tiles dropped (whole-building demotion if stair/door lost). Define `MAX_SETTLEMENT_RADIUS=220` (world_capital `TIER_SIZE 440 / TIER_RADIUS 220`).
- **Tests:** (a) no cross-settlement overlap in a dense range; (b) side-independence (same owner from either side of a boundary); (c) isolated settlement loses 0 buildings; (d) small-vs-large contention resolves by sort consistently; (e) no demoted building leaves a dangling door/stair.

### S1.6 — `building-tile-query.js`: 9×9 ring + resolved set (incl worker)
- **Edit:** `src/render/building-tile-query.js`; **New:** `sim/test/building-tile-query-ring.test.js`
- `NEIGHBOR_RING_R = ceil(220/64) = 4` (9×9). Replace the `−1..+1` loops in `queryBuildingTile (268-275)`, `queryBuildingWall (293-301)`, `isBuildingClaimed (315-334)` AND `getBuildingsNearChunk`'s 0..2 scan (243-252) with the shared ring. Rebuild `cachedLayout` `floorIndex/wallIndex (82,114)` from the resolved+de-overlapped set so worker set == main set. Worker uses `getWorldSeed()` (set via `setWorldSeed(data.seed)`). Wire `setArchitectureClaim` on the worker from resolved `claimTiles`. Keep `getBuildingsNearChunk` return shape (array of `{x,footprint}`).
- **Tests (node, seed 42):** (a) world_capital footprint ⊆ ±R macros (R covers 220); (b) boundary tile returns same building from home macro and from `MAX_SETTLEMENT_RADIUS` away; (c) worker == resolved (`byTile` parity). Smoke: walls draw in browser before merge.

### S1.7 — `sim-debug-overlay.js` onto the resolved set (seed + labels + click)
- **Edit:** `src/render/sim-debug-overlay.js`; **New:** `sim/test/overlay-resolved-set.test.js`
- Delete `WORLD_SEED=42 (20)`; replace ALL hardcoded-seed uses with `getWorldSeed()` (epochs 33, rand 47-48, peoples/tier/name 41/55/61, `layoutSettlement(42,…)` at 259 + 595, `findSettlementOfTier 664-691`). Replace `discoverSettlements` with the shared module. Replace the per-frame inline draw + bespoke `globalOccupied` (246-342) with iteration over `resolveBuildingsInRange(getWorldSeed(),…).buildings`; populate `_renderedBuildings` (click set, 341) from THAT set so fills/labels/click are one set. Keep the click handler + camera-bucket cache gate.
- **Tests:** (a) seed convergence (seed 7): overlay click-set tiles == tile-query set == resolved `byTile`; (b) no `= 42` / `layoutSettlement(42,` in source; (c) `_renderedBuildings` derived from the resolved set. Visual: non-42 seed walls/labels/clicks via the verify/run skill.

### S1.8 — gameplay click handler + browser verification
- **Edit:** `src/main.js`
- Add a building click/inspect handler in normal gameplay hit-testing the resolved set (so every drawn building is clickable, not just the overlay).
- **Verify:** serve the working tree + Playwright as before; confirm overlapping/un-clickable buildings are gone at a non-42 seed and clicking a drawn building works.

**Slice 1 commit checkpoint:** tests green + browser-verified → commit "fix: one resolved building set (seed-unified, de-overlapped, clickable) — #50/#51".

---

## SLICE 2 — the multi-floor model (on Slice 1)

### S2.1 — `shapes.js` (archetype + size; wraps `patterns.js`, never replaces it)
- Pure `resolveShape(seed,buildingType,tier,centrality)` + `realizeFootprintFromShape(shape,seed)`. Palette maps onto existing `patterns.js` primitives (byte-identical via `generatePattern`) PLUS new compounds (twin-wing, double-court, campus-cluster, long-arcade) as section-unions + 1-wide corridors. `centrality∈[0,1]` passed in.
- **Tests:** determinism; seed→archetype variety; sizeTier monotone w/h; every footprint a connected section-union; primitives deepEqual `patterns.generatePattern`.

### S2.2 — `building-floors.js` (floor count + `floorStackPlan`, ancestor-only)
- `floorCount(seed,type,tier,centrality) → {floorRange:[min,max], aboveGroundFloors}` (min≤0, max≥0, ground always exists); per-type profiles scaled by tier×centrality; ~100 only as rare world_capital landmark w/ explicit cap. `floorStackPlan(seed,floorRange,type)` indexed by floor → `{use}`.
- **Tests:** determinism; `aboveGroundFloors`===count≥0; mean floorCount monotone across tiers; `P(≥20)` below cap; stackPlan length===span, every index has use; basement=storage/crypt, ground=lobby/shopfront, top residential for apartment; per-type bounds.

### S2.3 — `vertical.js` (stair cores + lift; per-column, basement-safe)
- `selectStairCores(sections,floorRange)`: one core per connected vertical column = interior floor cell in the **intersection of every floor's interior cells** (centroid-nearest, tie-break); empty-intersection → deterministic fallback (per-floor cores + recorded break). `reserveLift(aboveGroundFloors)` iff >3 (opaque `mechanismId`). `internalStairForUnit` for multi-floor units (depth 1).
- **Tests:** core is interior floor cell on every floor incl basement+ground differing-setback; fallback fires on constructed case; determinism; disjoint-wing → one core per wing; lift biconditional `>3`; mechanismId opaque; tie-break stable.

### S2.4 — `floor-partition.js` (circulation-first + bounded retry + fallback)
- `partitionFloor(seed,floorSections,stairCore,floorUse) → {circulation, units:[{unitKind,tiles,doorTile}]}`. Place core → grow circulation → partition remainder by unitKind → door each unit onto circulation. Validity = every unit flood-fill reachable. Retry bounded at fixed K; exhaustion → deterministic fallback (single-unit absorbs stair). Multi-floor units expose `subFloors` (depth 1).
- **Tests:** every doorTile reachable over 50 seeds; total (adversarial courtyard/compound never throws; fallback asserted); determinism; retry ≤ K (counter); units disjoint, units∪circulation===interior; subFloors depth ≤1.

### S2.5 — wire kinds into `blueprint-node.js` (lazy materialize + claim-safety)
- Register `building/floor/unit/room` payload generators: `building.generatePayload` pulls shape (S2.1) + floors (S2.2) + cores (S2.3); `enumerateChildren` = floor-index range (O(1)); `materializeChild(floorIdx)` builds that floor lazily (S2.4), cached by path tuple; floor→unit→room similarly; `room` baseline = `f(worldSeed,unit.id)` reusing `generateInterior` (delta fields excluded). `ancestorContext` = CLOSED struct. Claim-safety: no generated doorTile/stairCore is a claim-lost tile.
- **Tests:** lazy counter (floor N only); untouched 100-floor tower O(1); same path byte-identical across regeneration (cache-evict safe); subFloor depth ≤1; ancestorContext no sibling ref; claim-safety.

### S2.6 — integrate node into `layout.js`/`footprints.js` (back-compat shell; keep 380 green)
- `generateFootprint` keeps ALL existing fields unchanged and ADDITIONALLY attaches `node` (the building BlueprintNode). Node hangs off each placed building; feeds the Slice-1 resolved set driving tileIndex/labels/click. Do NOT alter `placeBuildings` collision or bbox math. `floorRange/stairCores` are by-products read from `b.footprint.node`.
- **Tests:** **REGRESSION GATE: full suite stays 380/380** (existing buildings tests deepEqual vs snapshot); new: `b.footprint.node` exists w/ kind 'building' + floorRange/floorStackPlan/stairCores; `layout.queryTile` unchanged; node realized sections deepEqual `footprint.sections`.

---

## Notes
- §11 tests in the spec are the source of truth for assertions; each task's tests mirror the existing suite's deepEqual style.
- Lift threshold `>3 aboveGroundFloors` is **locked**. Architecture claim tier is **net-new** (not pre-reserved). De-overlap is **tile-level** (not territory rects). Ring is **9×9** (R=4).
