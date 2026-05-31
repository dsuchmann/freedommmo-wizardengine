# FreedomMMO Master Architecture Design

## Vision

FreedomMMO is a simulation-first 2D MMORPG where **every visual is a projection of simulation state**. The world is not a tilemap with sprites - it's a hypergraph of composable elements where the tilemap is one rendering projection. Time is the primary resource. All entities are NPCs with complete lifecycles. There are no traditional "enemies" - only living beings competing for finite time.

## Core Design Principle

**Everything is a stack of composable layers with properties. Visuals are always derivatives of simulation state, never the reverse.**

A tile is not "a grass sprite" - it's a material stack `[bedrock, ore_vein, rock, sand, soil, grass]` where each layer has properties (hardness, flammability, depth). The visual is generated from that stack. When lightning hits it, grass burns, the stack changes, the visual updates.

An entity is not "a sprite" - it's a body with 25+ slots where items layer. The visual composites body + equipped items. PixelLab generates each layer independently.

## Architecture Layers

### Layer 0: Grain Data Model (Foundation)
**Spec:** `2026-05-24-L0-grain-data-model.md`

The atomic unit of all matter in the world. Grains have types (physical, magical, spiritual, technical), properties (purity, resonance, stability, energy_level), and environmental state (temperature, pressure, magical_charge).

**Key types:**
- `Grain` - single material instance with properties
- `GrainStack` - ordered list of grains at a position (depth-sorted)
- `GrainRegistry` - catalog of all grain templates (sand, iron, mithril, arcane_dust...)

**Ported from:** `freedom/core/types.py`, `SCI_FI_FANTASY_SYSTEMS.md` grain system

### Layer 1: World State Graph
**Spec:** `2026-05-24-L1-world-state-graph.md`

The spatial container for grain stacks. Each world cell contains a grid of grain stacks. Cells relate to adjacent cells. The world is a graph of cells, each cell a grid of positions, each position a grain stack.

**Key types:**
- `WorldCell` - 128x128 tile cell with grain stacks per position
- `WorldGraph` - graph of cells with adjacency relationships
- `Position` - (cell_id, x, y) uniquely identifies any grain stack

**Ported from:** `WORLD_STREAMING.md` cell architecture, `DATA_SCHEMAS.md` world cells

### Layer 2: Material Registry
**Spec:** `2026-05-24-L2-material-registry.md`

Database of grain templates, material recipes, and composition rules. Defines what grains exist, how they combine, what emergent properties arise.

**Key types:**
- `GrainTemplate` - defines a grain type with default properties
- `MaterialRecipe` - defines grain combinations that produce materials
- `EmergentProperty` - rules for properties that emerge from grain interactions

**Ported from:** `SCI_FI_FANTASY_SYSTEMS.md` object system, grain compositions

### Layer 3: Simulation Engine
**Spec:** `2026-05-24-L3-simulation-engine.md`

The tick-based processor that advances world state. Each tick processes pending interactions, applies rules, propagates effects, updates grain stacks.

**Key types:**
- `SimTick` - single simulation step
- `InteractionQueue` - pending state changes to process
- `PropagationRule` - how effects spread (fire spreads to adjacent flammable grains)

**Ported from:** Server architecture concepts, `ARCHITECTURE_PLAN.md` tick rate design

### Layer 4: Interaction Rules
**Spec:** `2026-05-24-L4-interaction-rules.md`

The rule engine defining how things affect each other. Dig removes top grain layers. Fire burns flammable grains. Water erodes soft grains. Lightning cracks brittle grains.

**Key types:**
- `InteractionType` - enumeration of action types (dig, burn, freeze, cast, strike...)
- `InteractionRule` - maps (action_type, target_grain_type) → state_change
- `MutationResult` - describes what happens to a grain stack after interaction

**Ported from:** `SCI_FI_FANTASY_SYSTEMS.md` crafting interactions, morality consequences

### Layer 5: Time System
**Spec:** `2026-05-24-L5-time-system.md`

The core game mechanic. All entities have finite time. Time is consumed by existing, transferred through sharing/trading/combat. 10 life stages from Fetus to Elderly with different consumption rates. Death scaling after age 70.

**Key types:**
- `TimePool` - an entity's remaining time
- `TimeTransfer` - a transfer event (consumption 30%, sharing 95%, trading 85%...)
- `LifeStage` - current stage with consumption multiplier
- `GroupTimeGen` - group membership generating time (family 2.0x, village 1.5x...)

**Ported from:** `TIME_SYSTEM_ARCHITECTURE.md` (complete design exists)

### Layer 6: Causal Tracker
**Spec:** `2026-05-24-L6-causal-tracker.md`

Every action recorded with direct effects, ripple effects, temporal chains, spatial chains. Decision records track options considered, chosen option, reasoning, outcomes, learning.

**Key types:**
- `CausalEvent` - single recorded event with cause/effect chain
- `DecisionRecord` - entity decision with context, options, outcome
- `ImpactMatrix` - source→target mapping with magnitude and persistence
- `EntityHistory` - complete chronological record per entity

**Ported from:** `CAUSAL_TRACKING.md` (complete design exists)

### Layer 7: Terrain Generator
**Spec:** `2026-05-24-L7-terrain-generator.md`

Populates grain stacks using noise-based generation. Multi-octave noise produces elevation, moisture, temperature → biome classification → grain stack templates per position. Each position gets a depth-sorted stack of materials appropriate to its biome and local conditions.

**Key changes from current system:**
- Output is grain stacks, not flat tile IDs
- Much higher frequency noise for fine detail
- Unique seeds per region (no repetition)
- Feature placement (individual rocks, trees, water bodies)

**Builds on:** L0 (grain model), L2 (material registry)
**Replaces:** Current `python_generator_gpu.py` tile-ID-based generation

### Layer 8: Feature Placement
**Spec:** `2026-05-24-L8-feature-placement.md`

Places complex features on top of base terrain: trees (multi-tile), rock formations, water bodies, caves, paths, structures. Features are compositions of grain stacks that override base terrain.

**Key types:**
- `Feature` - multi-position grain stack override (a tree occupies multiple positions)
- `FeatureTemplate` - blueprint for a feature type
- `PlacementRule` - conditions for where a feature can spawn

**New system** (not in Python prototype)

### Layer 9: Entity Composition
**Spec:** `2026-05-24-L9-entity-composition.md`

Entities are bodies with 25+ equipment slots. Each slot can hold layered items. Items have grain compositions affecting properties. The entity's visual, stats, and capabilities are all derived from its composition.

**Equipment slots:** head, face, ears, neck, shoulders, upper_arms, lower_arms, hands, fingers, chest, back, waist, upper_legs, lower_legs, feet, ankles, tattoos, implants, accessories...

**Key types:**
- `EntityBody` - base body with species-specific attributes
- `EquipmentSlot` - named slot with item capacity and layer priority
- `EquippedItem` - item in a slot with layer position
- `EntityStats` - computed stats derived from body + equipment

**Ported from:** `SCI_FI_FANTASY_SYSTEMS.md` item system (25+ slots, layering, set bonuses, synergies)

### Layer 10: NPC AI
**Spec:** `2026-05-24-L10-npc-ai.md`

Goal-oriented AI with personality traits. NPCs have survival instincts, form relationships, make decisions based on personality (empathy, aggression, greed, courage...). All decisions recorded via causal tracker.

**Key types:**
- `NPCBrain` - decision-making engine per entity
- `Goal` - something an NPC is trying to achieve
- `PersonalityProfile` - trait values affecting decisions
- `Relationship` - connection between entities with history

**Ported from:** `freedom/npc/ai_engine.py`, `TIME_SYSTEM_ARCHITECTURE.md` personality traits

### Layer 11: Tile Renderer
**Spec:** `2026-05-24-L11-tile-renderer.md`

Reads grain stacks and composites the visual. The top-visible grain determines the primary visual. Grain properties affect rendering (wet sand vs dry sand, burnt grass vs fresh grass). Multiple grains at the surface blend.

**Key types:**
- `TileVisual` - computed visual for a position from its grain stack
- `VisualAtom` - single sprite/texture for a grain type (from PixelLab)
- `CompositeRule` - how to blend multiple visible grains

**New system** (replaces current flat-color tileset)

### Layer 12: Entity Renderer
**Spec:** `2026-05-24-L12-entity-renderer.md`

Composites entity visuals from body + equipment layers. Each equipment item has a visual layer. Layers composite in order (body → undergarments → clothing → armor → accessories → held items).

**Key types:**
- `EntityVisual` - computed composite sprite for an entity
- `EquipmentVisual` - sprite for an item in a specific slot
- `LayerCompositor` - composites multiple sprite layers into final visual

**Builds on:** L9 (entity composition), L13 (asset pipeline)

### Layer 13: Asset Pipeline
**Spec:** `2026-05-24-L13-asset-pipeline.md`

Generates visual atoms via PixelLab MCP. Each grain type gets sprite variants. Each equipment item gets directional sprites. Tilesets generated as Wang tiles for seamless blending. Assets cached locally, regenerated on demand.

**Key types:**
- `AssetRequest` - request to PixelLab for a specific visual
- `AssetCache` - local cache of generated sprites
- `TilesetGenerator` - generates complete tilesets for a biome
- `CharacterGenerator` - generates character sprites with equipment layers

**Uses:** PixelLab MCP (connected), ComfyUI (local RTX 3090), godot-ai MCP

### Layer 14: Interaction Animation System
**Spec:** `2026-05-24-L14-interaction-animation.md`

Choreographed interactions between entities. Every physical interaction (combat, pickup, embrace, surgery, etc.) has a template defining which body parts contact which, in what sequence, at what relative positions. Templates are parameterized by entity state (missing limbs, armor, size differences). PixelLab generates sprite frames per pose. Frames are cached by interaction-type + entity-composition hash.

**Key types:**
- `InteractionTemplate` - choreography definition (sequence of poses, body part contacts)
- `PoseFrame` - single frame in a choreography (entity positions, body part states)
- `InteractionInstance` - runtime instance binding template to specific entities
- `AnimationCache` - caches generated frames by template + composition hash

**Builds on:** L9 (entity composition), L12 (entity renderer), L13 (asset pipeline)

### Cross-Cutting: CI & Testing Infrastructure
**Spec:** `2026-05-24-CI-testing-infrastructure.md`

Multi-layer testing runs on every PR:
- **Layer 1:** Python structural tests (file existence, method signatures, JSON validity) - EXISTS
- **Layer 2:** GDScript runtime tests (instantiate classes, call methods, verify behavior in Godot headless)
- **Layer 3:** Integration tests (systems working together - serialization roundtrips, registry loading, persistence cycles)
- **Layer 4:** Security baseline (password hashing, session entropy, input sanitization, RPC authority)

Every new layer (L0-L14) must add runtime tests that run on every PR.

## Dependency Graph

```
L0 Grain Model ──────┬──── L2 Material Registry
                      │
L1 World State ───────┤
                      │
                      ├──── L3 Simulation Engine ──── L4 Interaction Rules
                      │
                      ├──── L5 Time System ──── L6 Causal Tracker
                      │
                      ├──── L7 Terrain Gen ──── L8 Feature Placement
                      │
                      ├──── L9 Entity Composition ──── L10 NPC AI
                      │
                      └──── L11 Tile Renderer ──── L13 Asset Pipeline
                                                         │
                             L12 Entity Renderer ─────────┘
```

## Already Built (from yesterday's session)

These systems exist on main and will be integrated:
- `NetworkManager.gd` - ENet multiplayer (L14: Networking)
- `PlayerSyncManager.gd` - position sync (L14)
- `ChatManager.gd` + `ChatUI.gd` - chat system
- `PersistenceManager.gd` - JSON save/load (will need to save grain state)
- `AuthManager.gd` - player auth
- `ServerConfig.gd` + `GameTime.gd` - config and time tracking
- `Player.gd` + `Player.tscn` - player character (will be rebuilt on L9/L12)
- CI pipeline with 100+ test assertions

## Implementation Order

**Phase 1: Foundation (L0-L2)** - Data models, no rendering changes
**Phase 2: Simulation (L3-L6)** - Processing engine, time system port
**Phase 3: World Gen (L7-L8)** - New terrain generator outputting grain stacks
**Phase 4: Rendering (L11-L13)** - Visual pipeline with PixelLab integration
**Phase 5: Entities (L9-L10, L12)** - Entity composition, AI, entity rendering
**Phase 6: Integration** - Wire everything together, QA in Godot (F5)

## QA Process

Each phase ends with a Godot F5 test:
- Phase 1: Data model tests pass, grain stacks can be created/queried
- Phase 2: Simulation ticks process, time system works
- Phase 3: Click world map → see grain-stack-based terrain (still colored tiles)
- Phase 4: Same terrain now renders with PixelLab sprites
- Phase 5: Entity walks on terrain with layered equipment
- Phase 6: Full game loop - login, explore, interact, persist
