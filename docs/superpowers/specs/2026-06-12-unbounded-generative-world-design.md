# Unbounded Generative World — Design

**Date:** 2026-06-12
**Lane:** third agent (asset corpus / client), redirected by user to sim kernel architecture.
**Status:** design approved by user (this conversation); spec pending user review.
**Atlas placement:** S1 (kernel: bounds removal, LOD), S2 (climate oracle as substrate), S5 (settlements/roads genesis), S6 (chronicle → story). Edges declared per phase below.

## Directive

The simulated world must be as infinite as the map: "no matter where i am there is a world."
Nothing may be bound to a fixed grid region. The user confirmed the failure concretely:
the bootstrap world (`bounds 0,0,320,320`) landed entirely in the ocean biome — 1,291
entities simulating fish-adjacent nothing while the player stood in a living landscape
thousands of tiles away.

Arrival semantics are **all of**: ancient places (history "always" there), young places
(grown since genesis), and virgin wilderness — interwoven, fully generative, driven by
where the player goes, what the world history produces, and the stories that explain it.
A massive causal hypergraph connects domains; domains carry hypergraphs internally.

## Core principle: history is a field

Terrain works because `classifyBiome(x, y)` is a pure function — the mountain was always
there, you just looked. History must work identically: a deterministic generative function
over space and time, evaluated lazily, at hierarchical scales. Not "simulate everything
always" (unbounded work), not "generate on first visit" (order-dependent). Hierarchical
purity:

```
L0  World epochs          pure f(seed)                        ages, climate shifts, mythic events
L1  Continental currents  pure f(seed, macro-cell, L0)        migrations, peoples, cultures
L2  Regional chronicle    pure f(seed, region, L1, climate)   foundings, abandonments, wars, roads
L3  Local genesis         pure f(seed, area, L2)              this village, these buildings, these NPCs
Δ   Live deltas           running sim + player actions        overrides baseline forever (locked decision #7)
```

Each layer is a pure function of the seed and the **coarser** layers. Long-range coherence
(an empire spanning 50 regions) lives at the coarse scale, so any region evaluates
independently yet agrees with its neighbors — the same trick Wang tiles use for seamless
infinite terrain. The A/B/C arrival modes are not modes: L1/L2 decide *what kind of place*
anywhere is — ancient heartland, young colony, or land the chronicle says no one reached.
Wilderness is the chronicle's **recorded reason** nobody came, not an unpopulated default.

## Peoples: biome-anchored races as L1 anchors

Every biome has a **requisite race that rhymes with it** — a canonical affinity, often
otherworldly, loosely tied to the biome's substance (user direction, 2026-06-12):
volcanic → a golem-kind; mystic → surreal crystal humanoids; swamp → an orc-like people
that is **never called "orc"** — names are invented, unique to this world; mountains →
living stone people. Humans exist alongside, not instead.

Affinity is a factor, not a quota: any given biome region may *manifest* anywhere from
zero to all races. The race table declares each people's biome affinities; how races
actually appear in the world — as cultures, settlements, dynamic civilizations,
communities, populations — is decided by the generative system itself (L1/L2 + the live
sim), with biome affinity as **one input among many** (suitability, chronicle events,
migrations, conflicts).

Races are the **groupings history generation anchors to**: L1 derives each macro-cell's
peoples from its biomes' affinities + seed; L2 chronicles are interactions of those
peoples (migrations, trade, war, syncretism at biome borders). A culture's "fingerprint"
— naming language, building idiom, road style, ruin signature, beliefs — derives from
race × biome × chronicle, so two crystal-folk regions feel related but not identical.
This is expected to need heavy iteration; the structure (race table per biome, fingerprint
derivation functions) lands in Phase 3, with content tuned over many passes. Race
identity also feeds the body-plan substrate (L2a derives proportions/parts per race —
golem and stone-folk part manifests are corpus rows, pilot-gated like all composables).

Faces: face is one part layer of the character stack; expressions are a small set of
part **states** (like hand states), not generated faces — at our zoom a face is a few
pixels, so the budget is a handful of state sprites per race/direction, possibly omitted
entirely at first (honest absence). We never generate per-individual faces.

## One hypergraph, not two

Generated history and lived history are the same data structure. The kernel's existing
nodes/edges/events tables are a causal graph the live sim writes. Chronicle layers emit
the **same records**: event nodes (`founding`, `famine`, `war`, `road_funded`) joined by
causal hyperedges (drought + overpopulation → migration → three foundings → road).
Materializing a region backfills its chronicle into the graph; the sim then continues it
**forward**. There is no seam where worldgen ends and simulation begins — the sim is the
chronicle function running at maximum resolution inside the attention bubble. The LOD
tiers (full → procedural → statistical) are resolutions of one history process.

Domains (society, economy, ecology, belief, conflict, …) define internal hypergraph
schemas; causality crosses domains freely — one graph, typed nodes, typed hyperedges.
Stories are **derived, never invented**: the LLM narrates chains of causal edges (the way
it renders minds, locked decision #3); every "why is this here" resolves to real edges.

## What dies

`kernel.bounds` and every load-bearing check on it (verified inventory, 2026-06-12):

| Site | Today | Becomes |
|---|---|---|
| `sim/kernel/kernel.js:17–20` | stores bounds; seeds outside fail | bounds = null forever; field removed at the end of Phase 1 |
| `sim/server/main.js:11–46` | CLI bounds/start rects | spawn rect replaced by genesis-at-attention (Phase 2); interim: start rect chosen by suitability |
| `sim/world/spawn.js:64–78` | iterates regions inside bounds, edge-clips | spawn derives from suitability field at any region |
| `sim/time/lifecycle.js:103–106` | seeds rejected outside bounds | seeds land by climate/suitability, never by extent |
| `sim/society/settlements.js:18–40` | founding/territory clipped to bounds | gated by suitability score + reachability only |
| `sim/society/growth.js:79–94` | expansion rejected at bounds edge | gated by suitability/terrain cost |
| `sim/world/routing.js:24–28` | A* domain = bounds | cost horizon: search radius budget (terrain cost already deterministic everywhere) |
| `sim/world/crossings.js:49–52` | crossings rejected outside bounds | gated by hydrology/terrain only |
| `sim/world/actions.js:315–324` | moves rejected at bounds | unrestricted (terrain cost governs) |
| `sim/store/checkpoint.js:22,35` | persists bounds | persists deltas + materialization frontier, never extent |

Already unbounded (no work): LOD tiers (infinite region keys), aggregates, scheduler
(entity-keyed; no per-tile arrays anywhere), viewport wire (`nodesNear`), climate oracle
+ P3 `scoreSite` (deterministic at any coordinate). No O(area) loops exist in production.

## Build order — four phases, separate plans, in sequence

### Phase 1 — Unbind the kernel
Remove every bounds gate (table above). Suitability-gated seeding; A* with a cost-budget
horizon instead of a domain rect; boot picks the start area by **searching the suitability
field near the requested spawn** (never again a blind rect in the ocean). Checkpoint schema
drops bounds. Deliverable: the live sim works wherever the player stands.
*Atlas edges: S1 kernel ↔ S2 climate oracle (read), S5 settlements (gate change).*

### Phase 2 — Genesis field (L2/L3 minimal)
Deterministic settlements + roads baseline at any coordinate: seeded settlement placement
over `scoreSite` at region scale; deterministic road graph between neighbor settlements
(existing `planRoute` over the climate oracle); materialize on LOD promotion; live deltas
overlay (permanence, locked decision #7). Includes the materialization-frontier record so
backfill happens exactly once per region. Deliverable: press 9 anywhere — settlements and
roads exist, and the sim continues them live.
*Atlas edges: S5 settlements/pathways ← S2 oracle; S1 LOD drives materialization.*

### Phase 3 — Chronicle hypergraph (L0/L1 + causal backfill)
World epochs and continental currents as pure functions; the biome-anchored race table
and culture-fingerprint derivation (Peoples section above); regional chronicles emitting
typed causal events into the kernel graph; age/ruin/abandonment states flow from chronicle
to genesis (a town the chronicle abandoned materializes as ruins). Domain schemas
(society/economy/ecology/belief/conflict) declared; cross-domain hyperedges.
*Atlas edges: S6 story substrate ← S5/S4; one-graph contract with S1 store.*

### Phase 4 — Story rendering
LLM narration over causal chains (deterministic context assembly, locked decision #3);
NPCs reference chronicle facts in conversation; "why is this bridge broken" resolves to
edges. No invented facts — narration fails honestly when the chain is absent.
*Atlas edges: S6 ↔ S5 minds; client surfaces (dialogue, inspection).*

## Determinism contract

- Same seed ⇒ same world everywhere, independent of visit order. Enforced by layer
  purity: L(n) reads only seed + L(<n) + the climate oracle, never sibling regions of the
  same layer and never materialization state.
- Backfill is idempotent: chronicle events carry deterministic ids
  (`hash(seed, layer, cell, ordinal)`); re-materializing a region is a no-op.
- Live deltas always win over baseline (one permanence system; no second override path).

## Honest absences

- Phase 1 alone: no settlements/roads exist anywhere yet (the sim only continues what
  spawn seeded near the player) — visible society arrives in Phase 2, never faked sooner.
- Phase 2 alone: settlements have no history — they are present-state genesis only; no
  ruins, no ages, no explanations. Nothing pretends otherwise until Phase 3.
- Phase 3 alone: chronicle exists as graph data; NPCs cannot yet tell it (Phase 4).
- Wilderness is a chronicle verdict (Phase 3+); in Phase 2 it is simply "suitability/
  seeded placement put nothing here."

## Verification

- Node tests per phase: bounds-gate removals (seed/found/expand/route succeed far from
  origin; identical results across visit orders); genesis determinism (same seed ⇒ same
  settlement set in a far region, materialize-twice idempotence); chronicle id stability.
- Headless probes (continuous-testability rule): Phase 1 — boot sim, teleport player probe
  to ±50k tiles, verify seeding/sim activity near the bubble; Phase 2 — press-9 collector
  shows settlements/roads at three uncorrelated far coordinates; Phase 3 — query "why"
  chains for a materialized ruin; Phase 4 — NPC narration cites real edge ids.
- The ocean-spawn regression test: boot with the old default coordinates; assert the
  start area resolves to land with positive suitability.

## Constraints

- Shared working tree: implementation in a worktree per parallel-agent rule; exact-path
  staging; coordinate with the P3 settlements lane (this design consumes its
  `scoreSite`/`findSettlementSite` — extend, don't fork).
- Wire protocol stays viewport/radius-based; settlement geometry crossing the wire is the
  sim lane's serialization call (extend the debug-overlay collector when it lands).
- Phases ship one at a time, each with its own plan doc and close-out; later phases must
  not be partially smuggled into earlier ones.
