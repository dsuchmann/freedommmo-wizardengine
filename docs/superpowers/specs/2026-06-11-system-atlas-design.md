# System Atlas — The Living World as a Hypergraph of Systems

**Date:** 2026-06-11
**Status:** Approved in brainstorm; authoritative for all simulation-domain work
**Scope:** Enumerates every system the living world requires, their strata, their inter-system dependency hypergraph, the contract every system spec must satisfy, and the assembly order. This document is the map; each system gets its own spec when its design pass arrives.

---

## 0. Locked decisions (preamble)

1. **This JS project is the game.** Godot/Python/Unity/GameMaker engines are abandoned; their *designs* are living reference material. Steam-shippable someday via Electron/Tauri.
2. **Scale:** architecture targets ~1M entities from day one via simulation LOD tiers. No throwaway small-scale design.
3. **Topology:** single-player now, MMO-shaped. The simulation runs as a separate local process speaking a client/server protocol; the canvas renderer is one client of it.
4. **Cognition:** LLM minds via deterministic context-assembly. The hypergraph (relationships, embedded memories, goals, personality) compiles tight prompts for small/fast/cheap models (GPT-4.1-class + vector embeddings). Intelligence lives in the simulation; the LLM renders mind the way the canvas renders terrain.
5. **Minds are private.** Information moves between entities only through conversation and observation — never telepathically. Conversation is not a system; it is the channel between Mind and Agency: an exploration of the shared goal-hypergraph and an expression of intent.
6. **The Time Metabolism is the pinnacle driver** — and it is being re-derived from first principles. The old `TIME_SYSTEM_ARCHITECTURE.md` (Freedom project) is reference, not canon. Even the philosophy is open in Pass 1.
7. **The no-mock rule:** a system may be ABSENT but never FAKE (§4).
8. **The world bends toward the player's experience, never the player's favor** (§1, S7 Hero Function).

---

## 1. The strata and the 33 systems

Strata are dependency-ordered: each consumes the strata below. Status legend: **[built]** exists in this repo · **[extend]** designed in prior projects, to be unified/ported · **[new]** first-principles design needed · **[driver]** pinnacle driver under re-derivation · **[shaper]** acts on all strata below rather than within them.

### S1 · Simulation Kernel — the ground everything stands on
| System | Status | Essence |
|---|---|---|
| Hypergraph Store | new | THE data substrate: nodes and n-ary hyperedges for everything above; persistent (SQLite-class embedded DB), queryable, embedding-indexed |
| Sim Process & Protocol | new | separate local process; MMO-shaped client/server protocol; ticks; scheduling |
| Simulation LOD | new | attention bubble = full sim + LLM minds → nearby = procedural → distant = statistical aggregates; seamless promotion/demotion |
| Determinism & Deltas | extend | seeded deterministic baseline + delta log; world heals (deltas decay); settlements are permanent deltas; **claims unify object permanence** — large objects claim space first, smaller fields fill the remainder, destruction writes a delta; nothing ever pops in or out |

### S2 · World Substrate — largely built (this repo)
| System | Status | Essence |
|---|---|---|
| Terrain & Biomes | built | Wang tiles (32×32), 21 biomes, elevation, water |
| Decoration Fields F0–F7 | built | natural landscape; the F2/F3 claims system is the seed of the kernel claims layer |
| Rendering & Atmosphere | built | chunked canvas, y-sorted sprites, lighting, weather, CRT |
| Asset Pipeline | built | PixelLab generation at scale (10k+ generations) |

### S3 · Matter & Made Things
| System | Status | Essence |
|---|---|---|
| Material System | extend | grains: atomic matter with properties (physical/magical/spiritual/technical); nothing destroyed, only transformed |
| Object System | extend | instances with lifecycle, durability, break products; F2–F7 decorations become citizens of this system |
| Emergent Recipes | new | **no predefined recipes**: minimal interaction/assembly rules → discovered combinations → discovered recipes become canonical, teachable, repeatable |
| Blueprints | new | nested: region → settlement → district → building → wall-section; quantized into generatable sprite pieces; **buildings are spatial structures (walls/floors/doors/interiors/NPC-slots), never house-sprites** |
| Items & Equipment | extend | 25+ slots, layering, synergies, sentimental value |

### S4 · Life — conscious entities, and all living things on a continuum of mind
| System | Status | Essence |
|---|---|---|
| Time Metabolism | driver | THE goal function: finite time, consumption, transfer, death — re-derived from first principles in Pass 1 |
| Body Assembly | new | feet→shins→thighs→hips→torso→arms→hands→neck→head→hair/eyes/nose/mouth/ears/genitals; tens of thousands of part variants; blueprint composes a seamless entity + animation rig (same nested-blueprint machinery as buildings) |
| Identity | extend | attributes, personality traits, name, race (humans/elves/dwarves/orcs/dragons/spirits/constructs/…), life stage |
| Mind | new | private semantic memory graph + cheap embeddings; deterministic context-assembly → small LLM for language and local reasoning; conversations decomposed back into the graph for future reference |
| Agency | new | game-theoretic decision-making: goals, plans, risk, choice; **every action — including refusal and absence — is an active, recorded choice** |
| Relationship Hypergraph | new | social, familial, sexual, employment, commercial, rivalry, communal n-ary edges; weighted, history-bearing |
| Fauna | new | animals = the same Life stack with thinner Mind/Agency (instinct-weighted, no LLM); predation, domestication, ecology feed the time economy |

### S5 · Society — entities aggregated; conscious shaping of the landscape
| System | Status | Essence |
|---|---|---|
| Groups & Culture | extend | family → village → guild → nation; values, norms, group dynamics |
| Economy & Ownership | extend | property, trade, markets, debt; who owns which plot/house/object |
| Settlements & Zoning | extend | region → territory → city → district zoning; location suitability scoring; growth over time |
| Pathways | new | worn foot-paths (traffic suppresses flora via claims/deltas — society-intent writing into substrate-claims) + paved roads (placed objects/Wang where warranted); networks that lead to real places |
| Governance & Conflict | new | law, factions, war/peace, justice, territory disputes |

### S6 · Story & Meaning — what the world remembers and tells
| System | Status | Essence |
|---|---|---|
| Causal Ledger | extend | every action/decision/effect recorded; ripple chains; impact matrix |
| History Generation | new | world boot: generations simulated pre-player; founding myths, wars, migrations as real causal chains |
| Goals & Quests | new | shared intention nodes between entities (incl. player): "kill the bandit in two days" → a joint goal node driving both parties' behavior; outcomes remembered; betrayal possible |
| Lore & Knowledge | new | what each entity KNOWS vs what happened; rumor propagation; discovered recipes become canon |

### S7 · The Shapers — competing dungeon-masters; not IN the causal ledger, applying pressure ON it
| System | Status | Essence |
|---|---|---|
| Gods & Domains | shaper | competing divine agents (War, Creation, Death, Chaos, …); faith power from worship; mortals can ascend; intervene via events, blessings, disasters; manifest at intersections of region × culture × society |
| Moral Cosmology | shaper | morality as a contested force field — not a stat on entities but pressure flowing through cultures and regions, changing what time-acquisition is sanctioned where |
| Loremaster Function | shaper | world-level dramaturgy: which latent conflicts get fueled, which regions get catastrophes, the pacing of history — the DM seat, possibly LLM-assisted |
| Hero Function | shaper | the player-experience system (§2) |

---

## 2. The Hero Function

The player character is a distinct entity class — god-adjacent, the one entity all Shapers have a stake in. The PC entity definition (what it is, how it differs from NPCs) lives inside this system's spec. Design principle: **the world bends toward the player's experience, never the player's favor.** The player is not on a golden path: not automatically liked, not invincible, not given what they ask for. Heroism and villainy are equally supported — helping one faction is the story of harming another; pleasing one god displeases another.

Four tendrils into lower strata, each a *re-weighting* of real simulation:

1. **Openness bias (→ S4 Agency).** A small prior in NPC interaction utility toward *engaging* the player: curiosity, willingness to ask for help, offer work, propose business. Not liking, not trust, not deference — the conversational door is slightly ajar. A hostile NPC still distrusts the player; they are merely more likely to bother interacting at all.
2. **Renown propagation (→ S6 Lore & Knowledge).** Events involving the player carry amplified salience in rumor propagation: deeds travel farther and faster than an equivalent NPC's. Titles, captured weapons, faction takeovers become lore that precedes the player ("are you the one who…?"). Faction-signed: fame and infamy ride the same channel.
3. **Resurrection (→ S4 Time Metabolism).** The player's time reserve never terminally empties; death resolves as resurrection, and resurrection is a *witnessed causal event* in the ledger. Witnesses talk. "The one who returned" accrues reverence in some cultures, fear or heresy in others; the gods have opinions about an entity death won't keep.
4. **Dramaturgy bias (→ Loremaster Function).** The Loremaster weights world pacing toward the player's attention bubble: latent conflicts ripen nearby, opportunities surface within reach. It pulls for the *experience*, never the outcome — it will happily ripen a conflict the player is going to lose.

**No-mock rule with teeth:** the Hero Function may only ever re-weight real simulation (priors, salience, pacing). It never fabricates — no spawned-for-you quests, no conjured admirers. Every NPC who seeks the player out does so because real lore actually reached them through the real propagation channel.

---

## 3. The system contract

Every system spec, when its design pass arrives, must answer the same eight questions:

1. **Primitives** — the system's node and hyperedge types in the kernel store (e.g., Pathways: `path_segment`, `traffic_record`; Mind: `memory`, `belief`, `intent`).
2. **Edges out** — which other systems' primitives it reads and writes, listed explicitly. The union of these declarations IS the dependency hypergraph, maintained as a living table in this atlas (§5).
3. **Time contract** — how it metabolizes the driver: what consumes time, what generates it, what transfers it.
4. **Causal contract** — what events it emits into the ledger, with what magnitude and ripple structure.
5. **LOD behavior** — how it runs in each simulation tier (full / procedural / statistical) and how state survives promotion/demotion between tiers.
6. **Honest absence** — what the world looks like before this system exists; what its absence may never pretend.
7. **Probe** — the in-game or headless test proving the system does what it claims.
8. **Asset demand** — what (if anything) it needs generated via PixelLab, and at what quantization.

---

## 4. The no-mock rule

A system may be **absent** but never **fake**. Absence means the world simply does not have that phenomenon yet: paths can exist before economies, but no path may ever lead to a cardboard town; no NPC may be scripted while pretending to be simulated; no recipe may be hardcoded. Each system's "honest absence" declaration (§3.6) makes this checkable.

Corollary — **continuous testability:** every implementation pass ends with something experienceable in the running game or a headless probe. The standing checklist: do paths lead to real places? are those places populated by assembled entities? do they have real histories? do they remember conversations (decomposed into their semantic graphs)? do shared goals actually drive both parties' behavior? are refusals recorded as choices with relational consequences?

---

## 5. Dependency hypergraph (initial; maintained as systems are specced)

High-confidence edges known today. Each system's spec replaces its row with the full declaration.

| System | Depends on (reads) | Writes into |
|---|---|---|
| Hypergraph Store | — | everything (substrate for all) |
| Sim Process & Protocol | Hypergraph Store | client(s) |
| Simulation LOD | Sim Process, Time Metabolism | all S4–S6 systems' tier behavior |
| Determinism & Deltas | Hypergraph Store | S2 fields, Object System, Pathways, Settlements |
| Material System | Hypergraph Store | Object System, Emergent Recipes, Items |
| Object System | Material System, Determinism & Deltas | claims, break products, world objects |
| Emergent Recipes | Material System, Agency (someone must try), Lore (discovery propagates) | canonical recipe nodes |
| Blueprints | Object System, Material System | Settlements, Body Assembly (shared machinery), Asset Pipeline |
| Items & Equipment | Object System, Material System | Body Assembly (worn layers), Economy |
| Time Metabolism | Hypergraph Store | every living system (the goal function) |
| Body Assembly | Blueprints, Items, Asset Pipeline | Identity (embodiment), Entity Renderer |
| Identity | Time Metabolism | Mind, Agency, Relationships |
| Mind | Identity, Relationship Hypergraph, Lore (knowledge), embeddings | conversation channel, memory graph |
| Agency | Mind, Time Metabolism, Goals & Quests | Causal Ledger, all action systems |
| Relationship Hypergraph | Identity, Causal Ledger | Mind context, Groups & Culture |
| Fauna | Time Metabolism, Object System | ecology, Economy (resources) |
| Groups & Culture | Relationship Hypergraph, Time Metabolism (group generation) | norms pressure on Agency, Settlements |
| Economy & Ownership | Items, Time Metabolism, Agency | markets, property nodes, Governance triggers |
| Settlements & Zoning | Blueprints, Economy, Groups, Pathways, terrain suitability | permanent deltas, claims, NPC home/work slots |
| Pathways | Agency (traffic), Determinism & Deltas, terrain cost | claims (flora suppression), Settlements connectivity |
| Governance & Conflict | Groups, Economy, Moral Cosmology | Causal Ledger (wars, laws), territory claims |
| Causal Ledger | everything that acts | History Generation, Lore, Relationships |
| History Generation | full stack (headless world boot) | pre-player world state + ledger |
| Goals & Quests | Agency, Relationships, Loremaster | joint intention nodes, Agency utilities |
| Lore & Knowledge | Causal Ledger, conversation channel | Mind (what entities know), Emergent Recipes canon |
| Gods & Domains | worship (Groups), Moral Cosmology | interventions (events), Hero Function stakes |
| Moral Cosmology | Gods, Groups & Culture | sanctioned time-acquisition per region/culture |
| Loremaster Function | Causal Ledger, latent world state | event pacing, Goals & Quests seeding |
| Hero Function | player state, Lore, Loremaster | Agency priors, lore salience, resurrection events, dramaturgy weights |

---

## 6. Assembly order

**Pass 1 — Driver + Kernel, designed as one coupled unit.**
Re-derive the Time Metabolism from first principles (what is time? what is the goal function? what does every system owe the driver?) AND design the Simulation Kernel (hypergraph store schema with time-flow and causal-weight annotations; sim process + protocol; LOD tiers; determinism/deltas/claims). Rationale: the driver defines what every node and edge must record; the kernel is what every other system writes to. Designing either alone guarantees rework of the other.

**Pass 2+ — Round-robin critical paths.**
Full-integrity slices through one system at a time, order derived from §5 rather than guessed now. Constraint structure known today:
- Nothing in S4+ is built before Pass 1.
- Blueprints (S3) and Pathways (S5) can be designed early — they plug into the existing claims machinery.
- Mind and Agency require Identity. Settlements require Blueprints + Pathways + Economy primitives.
- Each pass ends experienceable: in-game or headless probe (§4).

**Methodology:** when a slice through system A reaches the depth its dependents need, switch to the next system. Run the game constantly. Never deepen a system beyond what the atlas shows anything consuming.

---

## 7. Design archaeology (where prior work lives)

The old engines are dead; the designs are alive. Primary references:

- 14-layer master architecture: `freedommmo\docs\superpowers\specs\2026-05-24-master-architecture-design.md`
- Deterministic world compiler (roads/settlements/buildings-as-structures/farms/POIs/event-log narrative): `…\2026-05-24-world-compiler-design.md`
- Terrain object 3-axis model + baseline/delta decay: `…\2026-05-28-terrain-object-system-design.md`
- Town layout JSON (zones/buildings/roads/NPC slots): `freedommmo\docs\superpowers\plans\2026-05-25-town-layout-system.md`
- Time system & causal tracking (reference, not canon): `Freedom\docs\TIME_SYSTEM_ARCHITECTURE.md`, `CAUSAL_TRACKING.md`
- Grains/objects/items/crafting/morality/gods: `Freedom\docs\SCI_FI_FANTASY_SYSTEMS.md`
- MMO topology (cells, AOI tiers, authoritative server): `Freedom\WORLD_STREAMING.md`, `ARCHITECTURE_PLAN.md`

(All under `C:\Users\daves\OneDrive\Documents\`.)
