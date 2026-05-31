# Terrain Object System — START HERE

This document is the entry point for any agent working on terrain objects.
Read it fully before touching any file in `data/terrain_objects/` or
`scripts/core/` systems that consume this data.

---

## What the System Is

The terrain object system is a **three-axis relational model** that separates
object identity, object–world interactions, and biome placement into independent
composable pieces.

```
Objects  ×  Interactions  ×  Biomes
```

- **Objects** describe what a thing *is*: its ontology (animate vs inanimate),
  lifecycle/durability, sprite metadata, and which interactions apply to it.
- **Interactions** describe what can *happen* to an object: who triggers it,
  what effects fire, and how the animation composites over the base sprite.
- **Biomes** describe *where* an object appears and at what density, driving
  deterministic placement from the world seed.

No single file owns all three axes. Each axis lives in its own directory so
they can evolve independently.

---

## The Three Axes

| Axis | Directory | Schema |
|------|-----------|--------|
| Objects | `data/terrain_objects/objects/` | `schema/object_schema.json` |
| Interactions | `data/terrain_objects/interactions/{category}/` | `schema/interaction_schema.json` |
| Biome affinities | `data/terrain_objects/affinities/` | `schema/affinity_schema.json` |
| Biome transitions | `data/terrain_objects/transitions/` | `schema/transition_schema.json` |

Object files reference interaction IDs by string key. The runtime
`interaction_registry.gd` resolves those keys to loaded interaction data.

---

## Key Concepts

### Animate / Inanimate Ontology

Every object is either **animate** or **inanimate**. This is not about motion —
it is about whether the object has a *living lifecycle*.

- **Animate** objects (trees, bushes, crops, fungi) have `lifecycle.phases`:
  sapling → mature → old → dead. Each phase has a sprite_set and a duration
  range in game-days. The current phase gates which interactions are available
  (a sapling cannot be chopped; a dead tree cannot bloom).
- **Inanimate** objects (rocks, ore veins, ruins, bones) have
  `durability.stages`: pristine → cracked → destroyed. Damage reduces HP and
  the renderer picks the matching stage sprite. They do not age.

Both types share `break_products`: a map of trigger → item drops (on_chop,
on_mine, on_burn, etc.).

### Deterministic Placement

Objects are never randomly scattered at runtime. The `placement_engine.gd`
derives *every* object position from the world seed + cell coordinates using
a deterministic hash. The same seed always produces the same world. Affinity
files control density (objects/tile²) per biome so biome character is authored,
not emergent noise.

### Delta Persistence

The world baseline is the deterministic placement output. Deltas are the
*difference* caused by player and NPC actions: a chopped tree, a mined ore,
a planted seedling. Deltas are stored sparsely — only changed cells — in
`data/terrain_objects/deltas/` (runtime-generated, not in source control).

**World state = baseline + deltas**

On load the placement engine generates the baseline, then replays deltas on top.
This means the save file contains only changes, not the full world state.

### Entropy

Some deltas decay over time without player action. Regrown trees, refilled ore
pockets, spreading fungus — these are driven by the `delta_persistence.gd`
`entropy` field on each delta record. High entropy = fast decay back toward
baseline. Zero entropy = permanent change (a destroyed wall stays destroyed).

### Animation Compositing

Each interaction has an `animation` block with a `blend_mode`:
- `replace` — the interaction animation replaces the base idle sprite entirely.
- `overlay` — the interaction animation layers on top (e.g. rain drip on a tree
  that is also swaying in wind).
- `additive` — pixel values add (used for glow/fire effects).

The `can_composite_with` array lists interaction IDs whose animations may play
simultaneously. `animation_resolver.gd` enforces this: if two active
interactions conflict (both `replace`), higher-priority interaction wins.

---

## World State = Baseline + Deltas

```
┌─────────────────────────────────┐
│   placement_engine.gd           │
│   (world_seed + affinity data)  │
│           │                     │
│           ▼                     │
│     baseline positions          │
│           │                     │
│           ▼                     │
│   delta_persistence.gd          │
│   (load deltas from disk)       │
│           │                     │
│           ▼                     │
│     live world state            │
└─────────────────────────────────┘
```

Changes write new delta records. Entropy tick reduces delta magnitude. When
delta magnitude reaches zero the cell returns to baseline.

---

## File Flow Diagram

```
schema/*.json          (JSON Schema — validates data files)
       │
       ▼
data/terrain_objects/  (authored data files)
  objects/*.json
  interactions/{cat}/*.json
  affinities/*.json
  transitions/*.json
       │
       ▼
tools/terrain_objects/ (Python generators — produce data from tables)
  generate_interactions.py
  generate_objects.py (future)
       │
       ▼
PixelLab MCP           (sprite generation from object definitions)
  create_map_object / create_1_direction_object / create_tiles_pro
       │
       ▼
assets/catalog/terrain_objects/
  {object_id}/
    sprites/*.png
    manifest.json
       │
       ▼
GDScript runtime       (loads data + assets, drives simulation)
  object_catalog.gd    — loads & indexes all object JSON
  interaction_registry.gd — loads & indexes all interaction JSON
  biome_affinity.gd    — loads affinity + transition data
  placement_engine.gd  — deterministic baseline from seed
  delta_persistence.gd — sparse delta load/save/entropy tick
  animation_resolver.gd — composites active interaction animations
  object_instance.gd   — runtime instance: position, phase, HP, deltas
       │
       ▼
Renderer (TileMapLayer / DeferredRenderer)
  z=4 Object sprites (y-sorted)
  z=5 Roof / canopy overlays
  Animation overlays composited via blend_mode
```

---

## JSON Schema Files

| File | Validates |
|------|-----------|
| `schema/object_schema.json` | Every file in `objects/` |
| `schema/interaction_schema.json` | Every file in `interactions/**/*.json` |
| `schema/affinity_schema.json` | Every file in `affinities/` |
| `schema/transition_schema.json` | Every file in `transitions/` |

All schemas use JSON Schema draft 2020-12. Validate data files with:
```
python -m jsonschema -i data/terrain_objects/objects/oak_tree.json \
    data/terrain_objects/schema/object_schema.json
```

---

## Runtime GDScript Table

| Script | Location | Responsibility |
|--------|----------|----------------|
| `object_catalog.gd` | `scripts/core/` | Load all object JSON at startup; index by id; expose `get_object(id)` and `get_objects_by_category(prefix)` |
| `interaction_registry.gd` | `scripts/core/` | Load all interaction JSON; index by id; expose `resolve_interaction(id)` and `resolve_npc_action(action, object)` |
| `biome_affinity.gd` | `scripts/core/` | Load affinity + transition data; expose `get_affinity(biome, object_id)` |
| `placement_engine.gd` | `scripts/core/` | Deterministic baseline generation from world_seed + affinity data |
| `delta_persistence.gd` | `scripts/core/` | Sparse delta load/save; entropy tick each game-day; `apply_delta(cell, delta)` |
| `animation_resolver.gd` | `scripts/visual/` | Given a list of active interaction IDs, return composited animation frame sequence respecting blend_mode and can_composite_with |
| `object_instance.gd` | `scripts/core/` | Runtime object: id, position, current_phase / current_hp, active_deltas, instance_seed for variance |

---

## See Also

- **EXTENSION_POINTS.md** (this directory) — where to hook new systems into
  the terrain object pipeline without breaking existing data.
- **Full design spec**: `docs/superpowers/specs/2026-05-28-terrain-object-system-design.md`
- **Composition principles**: `.claude/rules/composition-principles.md` —
  non-negotiable rules about atomic layers; never stamp a whole building as
  a flat image.
