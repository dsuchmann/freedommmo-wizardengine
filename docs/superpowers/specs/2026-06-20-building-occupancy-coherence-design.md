# Building Occupancy & Coherence — Design

**Date:** 2026-06-20
**Status:** Design (approved cut: supply/demand seam) — pending spec review → plan
**Strata:** S3 Blueprints (supply) ↔ S5 Society (demand, not yet built)

## Goal

Make procedurally generated buildings **coherent, always-placed, and legible**:

1. **Always spawn** — a building whose chosen site is over water or a cliff relocates to the nearest valid site instead of silently vanishing. The `9` debug overlay shows exactly what spawns (today it shows "ghosts" that never materialize).
2. **Every floor has an occupant identity, multi-floor occupants are real** — a single organization/residence/business may span several floors, and that is visible when you click a building. (Floors already get a *use*; what's missing is the occupant layer and the surfacing.)
3. **Minimum footprint per function** — a thing is only built where it has enough coherent space ("square-peg footage minimum"). Function is chosen first; the building is sized to fit it.

## The central decision: a supply/demand seam

The hard requirement (user): *"set us up so swapping the placeholder society for a real Society system isn't a headache."* The atlas already declared the seam — it was just never implemented, so generation "jumped ahead" and baked occupant identity (brand names, owner hashes in `specializations.js`) straight into the building.

- **Supply (S3 Blueprints, durable):** a building offers occupancy **capacity** — a deterministic structure of **tenancies**. This survives the Society rewrite untouched.
- **Demand (S5 Society, swappable):** *who* occupies a tenancy and *why*. Built now as an isolated **placeholder `occupancyProvider`**; later, **Society becomes the provider** — same supply interface, real reasons — and nothing in building/town generation changes.

This is the atlas's existing `occupancySlots {home?, work?}` interface (Building Data Model §4.1: *"occupancySlots are nominal capacity, generated supply-side… Society is authoritative for realization — an unfilled tower is honest emptiness"*), finally implemented.

### No-mock compliance

The capacity is **real** (the space genuinely exists). The nominal occupant is a **declared placeholder** — honest absence ("supply exists; demand not yet simulated"), never a fake NPC pretending to live there. The placeholder is one named module with a documented interface, not scattered fakery.

## Locked-decision constraints honored

- **#6 buildings are spatial structures, not sprites** — a tenancy is a grouping of real floor/unit nodes, never a sprite or label glued on.
- **#2 object permanence = claims + baseline + delta** — relocation is part of the deterministic *baseline* (the building is generated at the valid site; it is pure `f(seed)`), not a runtime mutation. Re-derivable; deltas fold over it unchanged.
- **#3 discovered, not predefined** — organization *types* are eventually Society-discovered. For now nominal kinds derive from the existing taxonomy categories, but because the demand layer is swappable, discovery can drive it later without touching generation.
- **~1M-entity LOD** — relocation and tenancy derivation are pure functions inside the already-memoized per-settlement layout; no global entity-graph walk.

## Architecture

### Supply: tenancies

A **tenancy** is a coherent occupiable space within a building:

```
Tenancy = {
  id,                 // stable, path-derived: `${buildingId}/t/${i}`
  kind,               // 'household' | 'shop' | 'workshop' | 'civic' | 'religious' | 'storage' | ...
  floors: [int],      // floor indices it spans (e.g. [0,1] for a shop over a residence)
  unitIds: [string],  // the unit nodes it owns
  minTiles,           // coherence floor for this kind
  slots: { home, work } // nominal occupancy capacity (the atlas interface)
}
```

Derived deterministically from the existing `floorStackPlan` + unit layout via a pure `buildingTenancies(node)` (memoizable per building). Grouping rules per category, e.g.:
- **residential** — each apartment unit (or residential floor) → one `household` tenancy; a multi-floor unit (`unit.subFloors`) → one tenancy spanning its floors.
- **commercial/craft** — ground shopfront (+ adjacent work/storage floor) → one `shop`/`workshop` tenancy spanning those floors (`work` slots); any upper residential floors → separate `household` tenancies.
- **civic/religious** — the whole building → one institutional tenancy.

This is where *"a single organization takes up multiple floors"* lives — as a tenancy with `floors:[…]`. **Every floor belongs to exactly one tenancy** (no orphan/"vacant" floors).

### Demand: the occupancyProvider (placeholder)

```
occupancyProvider.assign(building, tenancy) -> {
  occupantId, kind, name, ...   // deterministic f(seed, buildingId, tenancyId)
}
```

- Placeholder impl: deterministic nominal generator. **The brand/owner naming currently baked into `specializations.js` moves here.**
- **Architectural niche stays supply-side** (a blacksmith building physically has a forge — that's a feature of the structure). The **business identity** ("Borin's Smithy", owner) becomes a demand-side occupant the provider assigns to the craft tenancy. That is the clean cut to unwind.
- Seam contract (documented): Society will later implement this interface, consuming `tenancies`+`slots` and producing real occupants with causal reasons. Generation never calls Society directly.

## Slice 1 — Relocation (minimal, unblocking)

**Where:** `settlementCandidates(seed, s)` in `sim/world/buildings/resolved-buildings.js` — memoized per-settlement, range-independent, the correct deterministic home for this. Today it does `buildingTouchesWater(b)` / `buildingSpansCliff(b)` → `continue` (silent drop).

**Change:** on suppression, `relocateBuilding(b, settlementOccupied)`:
- Deterministic outward spiral from `(b.x, b.y)` (canonical ring order r = 1…`MAX_RELOCATE_RADIUS`, fixed in-ring scan). For each candidate origin test: not water (`buildingTouchesWater`), not cliff (`buildingSpansCliff`), and not overlapping the **settlement's own** already-placed footprints (an intra-settlement occupied set maintained *within* `settlementCandidates` — range-independent).
- First valid wins → set `b.x, b.y` (footprint tiles are relative, so they follow). **Always spawns** in practice (per Q1: widen search). Honest-absence drop only if nothing valid within `MAX_RELOCATE_RADIUS` (pathological stranded-mid-ocean).

**Determinism:** uses only terrain (a pure field) + the settlement's own buildings (range-independent). It does **not** read the cross-settlement `occupied` set (range-dependent); cross-settlement overlaps remain resolved by the existing first-writer-wins de-overlap in `resolveBuildingsInRange`. Nearest-first spiral minimizes the chance a relocated building loses that tie-break.

**Overlay unification:** `src/render/sim-debug-overlay.js` currently runs its *own* discovery+layout and filters water but **not** cliff — the source of the "9 shows buildings that never spawn." Repoint it to consume `resolveBuildingsInRange(...).buildings` (the real resolved set) so **overlay == world == click-set** (the Building Data Model "draw-set == click-set" invariant). Optionally tag relocated buildings with a moved-from marker.

**Verify:** a headless probe over N settlements asserts ~0 buildings dropped-without-relocation (excepting islands); overlay building set == `resolveBuildingsInRange` set.

## Slice 2 — Supply seam + coherence (the heart)

**Tenancy model:** implement `buildingTenancies(node)` (pure) producing the tenancy structure above. Surface `tenancies` on the building (lazy/memoized).

**Size-to-function (Q3):** today size is picked ~independently of function (`shapes.js` weighted score) and validated only against a global `MIN_DIM = 5`. New order:
1. Choose the building's **function/type** first (from the existing taxonomy pick / settlement role).
2. **Size the footprint to satisfy that function's minimum** — grow the size tier / dimensions until `area ≥ type.minTiles` and `floors ≥ type.minFloors`, then pick a fitting shape.

Add per-type **`minTiles`** (and where relevant `minFloors`) to `sim/world/buildings/taxonomy.js` (authored, or derived from the type's required `features` footprint + its tenancies' `minTiles`). A market is then always market-sized; a temple always temple-sized. Last-resort only: if a constrained lot truly can't grow, downgrade to a function that fits (keeps the no-mock rule — never a too-small fake).

**Naming refactor (the unwind):** move occupant-facing brand/owner generation from `specializations.js` into the `occupancyProvider`; leave architectural niche/features in the structure.

**Verify:** probe asserts (a) every building's function meets its `minTiles`/`minFloors`; (b) every floor belongs to exactly one tenancy; (c) multi-floor tenancies occur; (d) swapping the provider implementation changes occupant names but not a single tile of generation.

## Slice 3 — Legibility

**Click-inspect** (`sim-debug-overlay.js` detail panel, ~lines 436–527): today it reads the legacy *flat* `footprint.interior` (single level). Extend it to iterate `floorRange` → `resolveFloorLayout(node, floorIndex)` per floor and render **floor-by-floor**: each floor's `use`, the tenancy/occupant controlling it (name + kind), and its units — marking multi-floor spans (e.g. *"Borin's Smithy — floors 0–1"*).

**`9` overlay** reflects relocation automatically (it now reads the resolved set); optional moved-marker.

This is debug UI — a 2D canvas overlay **outside** the world (not world content), so it is consistent with the GL pipeline rule (which governs world content only).

**Verify:** click a multi-floor building → panel lists each floor and the spanning occupant.

## Determinism contract

- **Relocation:** pure `f(seed, settlement)` — canonical spiral over terrain + intra-settlement occupancy; range-independent inside memoized `settlementCandidates`.
- **Tenancies:** pure `f(node)` from `floorStackPlan` + units.
- **Placeholder occupant:** pure `f(seed, buildingId, tenancyId)`.
- All re-derivable; no runtime mutation; consistent with the permanence baseline.

## Non-goals (explicit)

- **No Society simulation** — no autonomous NPC occupants, goals, or economy. The provider is a declared placeholder. (Society is a future session.)
- **No demand-driven town composition** — settlement *placement* stays supply-first; we add only function/size coherence + relocation. What-gets-built-and-why is the future Society work.
- **No new sprites/assets.**

## Open questions (resolve in the plan)

- Authored `minTiles`/`minFloors` values per building type.
- `MAX_RELOCATE_RADIUS` value (large enough to clear typical water/cliff features without runaway cost).
- Whether `tenancies` live on the node payload or as a standalone pure function (lean: standalone pure function, memoized — keeps the node lazy).

## Slice → testable outcome

| Slice | Deliverable | You can verify |
|---|---|---|
| 1 | Relocation + overlay==world | `9` overlay stops showing ghosts; spawn-rate probe ≈ 100% |
| 2 | Tenancy supply model + size-to-function + provider seam | coherence probe green; provider swap leaves generation byte-identical |
| 3 | Floor-by-floor click panel + overlay reflects relocation | click a tower → see each floor + multi-floor occupants |
