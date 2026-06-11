# Pass 1 — The Time Metabolism & The Simulation Kernel

**Date:** 2026-06-11
**Status:** Approved in brainstorm
**Atlas position:** S4 Time Metabolism (driver) + all four S1 systems (Hypergraph Store, Sim Process & Protocol, Simulation LOD, Determinism & Deltas), designed as one coupled unit per the atlas assembly order (`2026-06-11-system-atlas-design.md` §6). The driver defines what every node and edge must record; the kernel is what every other system writes to.

---

## 1. Philosophy — what time IS (re-derived, replacing the old canon)

Time is the universal primitive uniting all entities' behavior. It is simultaneously:

- **Substance** — a conserved quantity held in reserves, flowing between beings;
- **Agency budget** — every action spends it; wealth in time is capacity to act;
- **Thermodynamic flow** — individuals cannot create it; organization captures it, conflict and entropy dissipate it.

Every system in the atlas ultimately resolves into the time dynamics of the world. This is the goal function: entities (and the player) act to capture, conserve, spend, and pass on time.

### 1.1 The ambient flux model (conservation law)

The world emits a steady **ambient time-flux**: every tile yields φ time-units per sim-second (biome-modulated; S2 owns per-tile data). Flux that no living thing captures dissipates. **Local flux is finite and shared** — total capture on a tile cannot exceed φ. From this single constraint emerge, un-scripted: carrying capacity, territory value, overpopulation pressure, and inter-civilization competition.

Nothing in the world mints time. **Birth does not mint time**: parents *invest* reserve into the child (a real transfer — pregnancy and nurture are expensive), but the child is a **new antenna** whose lifetime capture far exceeds the investment. Birth creates *capture capacity*. The same logic scales: founding a village erects a better antenna; civilization is the art of capturing more of a bounded flux. Inflation is impossible by construction — the failure mode that killed the old design's economy.

### 1.2 The reserve (entity state)

Every living entity holds exactly **one number**: its time reserve `R`. Death is `R = 0`.

```
r = C − B                      net rate
C = capture: base(species, life-stage) × condition × bonds × local-flux share
B = burn:    base metabolism × condition multipliers + discrete action costs
```

- **Vitals are not pools.** Hunger, wounds, cold, grief are *conditions* that worsen C and/or B; love, rest, safety, meaning improve them. A starving entity hemorrhages time and captures poorly.
- **Actions are discrete spends** from R: a spell, a sprint, a sword swing.
- **Senescence:** with age, base capture decays and base burn rises. Death becomes inevitable without a scripted cutoff age.

### 1.3 Scope — all living things

Every living entity holds a reserve: people, fauna, trees, grass — the F2–F7 flora already in the world. Eating IS time transfer (the berry's captured flux moves to the eater at channel efficiency). Predation, agriculture, and ecology are one economy; farming is cultivating antennas. Non-living matter (rock, water, tools) holds no reserve (`R = null`) — it conducts or stores only via later enchantment-like exceptions.

### 1.4 Death — embodiment

At death, R does not vanish: it becomes **embodied reserve `E`** in the remains, decaying exponentially back into local ambient flux. Eating, scavenging, looting, and funeral rites are all *harvests* of E at channel-specific efficiencies. Inheritance, predation, scavenging, and burial customs are one mechanic: who reaches the embodied time before it dissipates. Murder pays only what the victim still held, at harvest efficiency — the time-farming exploit is self-limiting.

### 1.5 Transfers — typed channels

All time movement goes through typed transfer channels with efficiencies (initial values, tunable; losses dissipate to local ambient — nothing leaves the economy):

| Channel | Efficiency (initial) |
|---|---|
| nurture (parent → child, care) | ~95% |
| gift / charity | ~90% |
| trade | ~85% |
| harvest of remains (eating, rites, looting) | ~50% |
| violent extraction (consuming the living) | ~30% |

A murderous-rampage strategy is *possible* (a locked requirement) but economically inferior to organization — by construction, not by rule.

### 1.6 Groups — organizations are antennas

Groups (family, village, guild, nation) are **first-class entity nodes** with their own reserve and capture rate. A group's capture is a function of its members' bond strengths and alignment (the hyperedge weights). It spends on communal things and can flow time back to members. **Distribution is not a formula — it is decided by Agency within the group** (S5): politics for free, resolving the old design's undefined "importance-based distribution" gap.

### 1.7 Sim-time vs real time

**The sim owns its clock; nothing in the kernel ever references the wall clock.** The world advances in sim-ticks; what keeps the tick loop running is a deployment policy:

- **Single-player (now):** sim process runs while the game runs; closing the game freezes the world mid-breath.
- **MMO (later):** the identical process simply never stops, on a server. Zero kernel redesign — single-player is an MMO whose server you carry with you.

Target pacing: 1 game-day ≈ 30–60 real minutes (tunable). *What is the player character when its human is offline* is an open question deferred to the Hero Function spec (S7); in single-player it never arises.

---

## 2. The Hypergraph Store (S1)

One substrate for everything. **Nodes** are anything that exists (person, tree, village, corpse, memory, recipe, god). **Hyperedges** are anything that relates (a family of five, an employment, a battle of forty, a shared goal).

### 2.1 Node shape (uniform)

```
id, type, born_tick, pos?        identity & place
R, r, last_tick                  the time annotation: reserve, net rate,
                                 last materialization tick (lazy-flow core)
attrs                            typed bag per node-type (JSON column)
embedding?                       vector, for Mind/Lore semantic retrieval
```

The time annotation on every node is the driver/kernel coupling made literal. Non-living nodes: `R = null`. Corpses: nodes whose R decays.

### 2.2 Hyperedge shape

```
id, type, members[(node_id, role)], weight, born_tick, attrs
```

Bond weights feed group capture; roles let one edge express structure ("family of 5, two parents").

### 2.3 Persistence

**SQLite via better-sqlite3** (synchronous, fast, in-process, ships in Electron/Tauri). Tables: `nodes`, `edges`, `edge_members`, `events` (causal ledger, append-only), `deltas` (§5). Embeddings via sqlite-vec. The hot working set lives in memory (JS maps / typed arrays); SQLite is durable truth, written in batched transactions at checkpoints (with WAL for crash recovery).

### 2.4 Query surface (what upper systems get)

- `get(id)`, `neighbors(id)`, `edgesOf(id, type?)`
- spatial query (entities near x,y — grid index)
- type scans; semantic search over embeddings
- **`materialize(node)`** — the only way to read R; lazily advances it to the current tick. No system touches stored R directly; the metabolism math lives in one place.

### 2.5 Causal ledger

Append-only `events` table: `tick, actor, targets[], type, magnitude, cause_event_id?`. The `cause` self-reference is the ripple chain. Full ripple semantics (impact matrix, decision records with learning) deepen in the S6 Causal Ledger pass; Pass 1 ships the table and write path.

---

## 3. Sim Process & Protocol (S1)

### 3.1 Topology

The simulation is a **separate local Node.js process**, spawned by the game shell. The canvas renderer connects via **WebSocket on localhost**. One protocol regardless of whether the server is 3ms or 80ms away — the single-player/MMO middle ground made structural.

### 3.2 Protocol (JSON now; binary framing later if profiling demands)

**Client → sim:**
- `hello` — attach, declare viewport
- `intent` — move, act, speak. The player is *an entity sending intents*, the same channel NPC Agency uses internally
- `query` — inspect entity, read lore
- `admin` — pause, save, fast-forward (dev tools)

**Sim → client:**
- `snapshot` — full attention-bubble state on attach/teleport
- `tick-delta` — bubble changes since last update (~10Hz)
- `events` — causal events worth rendering (sounds, deaths, weather)
- `time` — sim clock

### 3.3 Authority & rendering split

The sim is fully authoritative; the client predicts nothing in Pass 1 (localhost makes prediction pointless; the protocol leaves room). Terrain is deterministic from seed, so the existing chunked renderer generates its own tiles client-side and receives only *entities and deltas*. Bandwidth stays tiny.

### 3.4 Lifecycle

Launch → spawn sim → open SQLite world file → replay unflushed WAL → resume at saved tick → client attaches. Quit → checkpoint, drain, exit. Crash → last checkpoint + WAL replay; determinism (§5) makes recovery bit-identical.

---

## 4. Scheduling & Simulation LOD (S1)

### 4.1 The engine is an event queue, not a game loop

Ground truth: every reserve is `(R, r, last_tick)`; current value computed on read. The kernel's heart is a **priority queue of due events**: "entity 4811 crosses hunger threshold at tick 91,400," "fruit on tree 2207 ripens at tick 93,000," "group A's war council reconvenes at tick 88,000." Processing an event materializes the entities it touches, applies changes, recomputes rates, and schedules each entity's next implied event. A million quiet entities cost **zero CPU between events**. Rate changes re-derive affected future events.

Two samplers on top:
- **Bubble sampler (~10Hz):** fixed-rate updates for the attention bubble — presentation cadence, not truth cadence.
- **Slow sweep (~1/sim-hour/region):** re-validates scheduled events where cross-entity flux competition makes pure lazy math stale.

### 4.2 Three tiers, one truth

| Tier | Who | Resolution |
|---|---|---|
| **Full** | attention bubble | individual entities, full Agency, LLM minds eligible |
| **Procedural** | loaded ring around bubble | individuals, rule-based Agency only, coarser events |
| **Statistical** | everywhere else | populations as aggregate nodes (counts, summed R, demographics). **Group nodes (villages, civilizations) remain individual at every tier** |

**Distance defers resolution, never causation.** A war between distant civilizations A and B happens for real while the player is in C: group-level Agency decides on scheduler events, battles are real ledger events and real time-transfers between group reserves, outcomes accrue as deltas and aggregate changes, and lore propagates at physical travel speed. The player learns of it when information reaches them, and finds real ramifications on arrival.

### 4.3 Promotion / demotion

- **Promotion** (player approaches): aggregates → individuals, materialized deterministically from `seed + deltas + ledger history`. Counts, deaths, and events already true at aggregate level are honored, never contradicted.
- **Demotion:** individuals fold back into aggregates. Entities with open story-relevant state (named in ledger events, bonded to the player) are **pinned individual** regardless of distance.
- Promotion/demotion are themselves ledger events — auditable that the world never cheated.

---

## 5. Determinism, Deltas & Claims (S1)

### 5.1 The world equation

Any region's state = `f(seed, deltas, ledger)` — a pure function. Baseline (terrain, flora F0–F7, initial populations) from seed; everything that happened is a delta or derivable from the ledger. Same inputs → bit-identical world. This is also the crash-recovery and headless-probe story.

### 5.2 Deltas — the world's scars

A delta is a persistent override of baseline (tree felled, path worn, house built), keyed by location + target in the `deltas` table. **Deltas heal**: most decay toward baseline (the worn path regrows — at a rate driven by local flora's time metabolism). Maintained structures are deltas whose decay is actively *paid for*: maintenance is time spent against entropy. A ghost town is what happens when nobody pays.

### 5.3 Claims — object permanence unified

Extending the existing F2/F3 claims machinery: large objects claim space first, smaller fields fill the remainder. New entities (building, tree, camp) claim before existing visually; destruction writes a delta and releases the claim. Nothing pops in or out — promotion materializes *into* the claim map.

### 5.4 Determinism discipline

- One seeded RNG stream per system per region; no shared global RNG.
- Randomness drawn from `hash(seed, entity_id, event_tick)` — never call-order-dependent, so lazy materialization at tick N is independent of *when* it is computed.
- Event-queue ties broken by stable entity-id order.
- No wall-clock reads anywhere in the sim.
- LLM mind outputs enter the world only through ledger-recorded intents: the LLM is non-deterministic, but its effects are replayable data, preserving `f`.

---

## 6. Honest Absence, Probes & Asset-State Taxonomy

### 6.1 Honest absence

After Pass 1 the world has no Minds, no Agency, no society — and must not pretend otherwise. What honestly exists: flora and fauna-grade entities metabolizing time (growing, fruiting, starving, dying, decaying), corpses with harvestable reserves, the flux economy, and group nodes *as data shapes only* (no group decisions — that is S5). No NPC walks or talks. Pass 1's world is **alive but mindless** — exactly what a world without S4+ should be.

### 6.2 Probes (continuous testability)

1. **Conservation audit** (headless): N sim-days; total time (ambient emitted − dissipated + reserves + embodied + in-transit) balances within float tolerance. The economy provably neither mints nor leaks.
2. **Mortality curve:** 1,000 entities untouched; senescence yields a plausible lifespan distribution; corpses decay; time returns to ambient.
3. **Carrying capacity:** overpopulate a meadow; flux competition alone starves it back to sustainable density — no scripted cap.
4. **Determinism replay:** same seed + same intent log, twice → bit-identical SQLite files.
5. **Lazy/eager equivalence:** lazy run vs brute-force 10Hz run → same state within tolerance.
6. **In-game:** watch a berry bush ripen; pick it, gain time; fell a tree; watch the claim release and the stump-delta heal over weeks.

### 6.3 Asset-state taxonomy (second-order workstream)

The metabolism defines a canonical lifecycle state machine that every rendered living thing maps onto:

```
seedling → growing → mature ⇄ flourishing/wilting → senescent → dead → decaying → gone
```

Plus orthogonal axes: **yield states** (budding / fruiting / harvested), **damage states** (cut / burned / broken → stump / snag), **season dress**.

Pass 1 delivers the taxonomy plus per-archetype requirement sheets: which states each F2–F7 archetype (and future fauna / body assets) needs, at what PixelLab quantization (32px F2–3, 64px F4, 96px F5, 192px F6–7). Generation itself rides the existing pipeline. The existing F2–F4 lifecycle states (seedling / normal / wilting / dead) map 1:1 onto the core spine — nothing is thrown away.

### 6.4 Bound to later passes (nothing here is optional)

These are NOT skipped — each is a mandatory design pass in this same body of work, assigned per the atlas assembly order. The kernel designed here must accept each without rework (the node/edge/event/intent shapes in §2–§4 are their landing pads):

- Group Agency, politics, distribution decisions → S5 Society pass (group nodes, reserves, and group-decision scheduler events exist from Pass 1; the politics that drive them are S5)
- Ripple-effect depth, impact matrix, decision records with learning → S6 Causal Ledger pass (the `events` table with cause chains ships in Pass 1; ripple semantics deepen there)
- LLM mind integration → S4 Mind pass (the intent channel, embedding columns, and ledger-recorded-intent determinism rule in Pass 1 are designed specifically as its seam)
- Player-offline semantics in MMO mode → Hero Function spec (S7); never arises in single-player
- Client-side prediction → when remote play exists

---

## 7. System contract declarations (atlas §3)

**Time Metabolism:** primitives `reserve annotation (R, r, last_tick)`, `transfer`, `embodied reserve`, `flux field`. Reads: S2 tile data (flux modulation). Writes: every living node's annotation; ledger events for births, deaths, transfers. Time contract: *is* the time contract. LOD: lazy flows at all tiers; aggregates carry summed R. Honest absence: n/a — it is Pass 1. Probe: conservation audit. Assets: lifecycle taxonomy (§6.3).

**Hypergraph Store:** primitives `node`, `hyperedge`, `event`, `delta`. Reads: nothing. Writes: substrate for all. Probe: determinism replay. Assets: none.

**Sim Process & Protocol:** primitives `intent`, `snapshot`, `tick-delta`. Reads: store. Writes: clients. Probe: attach/detach/recover cycle. Assets: none.

**Simulation LOD:** primitives `tier assignment`, `aggregate node`, `promotion/demotion event`. Reads: player position, Time Metabolism rates. Writes: tier behavior of all S4–S6 systems. Probe: lazy/eager equivalence; promotion honors aggregates. Assets: none.

**Determinism & Deltas:** primitives `delta`, `claim`, `rng stream`. Reads: store, seed. Writes: S2 fields, future Object System, Pathways, Settlements. Probe: determinism replay; stump-heal. Assets: none.
