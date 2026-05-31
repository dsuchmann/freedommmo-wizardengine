# Terrain Object System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a three-axis relational model (Objects x Interactions x Biomes) that replaces hardcoded object placement with data-driven, animated, lifecycle-aware terrain objects.

**Architecture:** JSON data definitions (objects, interactions, affinities, transitions) consumed by GDScript runtime (ObjectCatalog, PlacementEngine, AnimationResolver, DeltaPersistence). Python tooling generates data files from taxonomy tables and orchestrates PixelLab asset generation. Placement is deterministic from world_seed with sparse time-decaying deltas for mutations.

**Tech Stack:** GDScript (Godot 4.4), Python 3 (data generators), JSON (data definitions), PixelLab MCP (sprite generation)

**Spec:** `docs/superpowers/specs/2026-05-28-terrain-object-system-design.md`

**DevBox:** Each task corresponds to a DevBox run. Create run before editing code, commit on run branch, submit code result.

**Progress (updated 2026-05-28): ALL TASKS COMPLETE**
- [x] Task 1: Directory Structure + JSON Schemas — DONE (commit 4b0bb9f)
- [x] Task 2: Schema Documentation — DONE (commit 58cacf4)
- [x] Task 3: Interaction Definitions Generator — DONE (commit 6f5f74c, 38 interactions)
- [x] Task 4: Object Definitions Generator — DONE (196 objects)
- [x] Task 5: Biome Data Generator — DONE (18 affinities, 30 transitions)
- [x] Task 6: Data Validation Script — DONE (0 errors, 0 warnings across 282 files)
- [x] Task 7: ObjectInstance Data Class — DONE (commit 9abdae4)
- [x] Task 8: Data Loaders (Catalog, Registry, Affinity) — DONE (commit cbc57fc)
- [x] Task 9: Placement Engine — DONE (commit dbc9bb6, thread-safe)
- [x] Task 10: Delta Persistence — DONE (commit 8ab781e)
- [x] Task 11: Animation Resolver — DONE (commit 8ab781e)
- [x] Task 12: Renderer Integration — DONE (commit 80a5a3d, graceful fallback)
- [x] Task 13: Generation Queue Builder — DONE (commit 126d0d2, 5,002 items queued)
- [x] Task 14: PixelLab Generation Runner — DONE (commit 126d0d2, 7 prompt templates)
- [x] Task 15: Test Character Sprite — DONE (commit f4a6543)
- [x] Task 16: End-to-End Verification — DONE (all generators + validation pass clean)

**Key codebase facts:**
- Chunk size: 64x64 tiles (ChunkData.SIZE = 64)
- Tile pixel size: 32px (_world_scale = 32)
- ChunkData fields: elevation, slope, biome_id, vegetation_density, vegetation_species, water_distance, ocean_distance, fertility, precipitation, walkability
- DeferredRenderer._render_object_sprites() at line 884 — current hardcoded placement
- DeferredRenderer._render_detail_decorations() at line 616 — current hardcoded details
- WorldManager._init_systems() at lines 69-180 — system registration pattern
- GDScript: NEVER use `:=` with Dictionary.get(), abs(), or untyped returns — always use `=`

---

## File Map

### New Files — Schema & Docs
| File | Responsibility |
|------|---------------|
| `data/terrain_objects/schema/README.md` | Start-here guide for future agents |
| `data/terrain_objects/schema/EXTENSION_POINTS.md` | Hooks for identity, weather, seasons, buildings |
| `data/terrain_objects/schema/object_schema.json` | JSON Schema for object definitions |
| `data/terrain_objects/schema/interaction_schema.json` | JSON Schema for interaction definitions |
| `data/terrain_objects/schema/affinity_schema.json` | JSON Schema for biome affinities |
| `data/terrain_objects/schema/transition_schema.json` | JSON Schema for biome transitions |

### New Files — Python Data Generators
| File | Responsibility |
|------|---------------|
| `tools/terrain_objects/generate_interactions.py` | Generates ~30 interaction JSON files from embedded data |
| `tools/terrain_objects/generate_objects.py` | Generates ~200+ object JSON files from taxonomy |
| `tools/terrain_objects/generate_biome_data.py` | Generates 18 affinity + ~50 transition JSON files |
| `tools/terrain_objects/validate_data.py` | Validates all JSON against schemas, checks referential integrity |
| `tools/terrain_objects/build_generation_queue.py` | Walks object x interaction x phase matrix, builds PixelLab queue |
| `tools/terrain_objects/run_pixellab_generation.py` | Executes PixelLab generation from queue |

### New Files — GDScript Runtime
| File | Responsibility |
|------|---------------|
| `scripts/core/terrain_objects/object_catalog.gd` | Loads object JSONs, indexes by id/category, resolves break_products |
| `scripts/core/terrain_objects/interaction_registry.gd` | Loads interaction JSONs, matches triggers to objects |
| `scripts/core/terrain_objects/biome_affinity.gd` | Loads affinity JSONs, queries object pools per biome |
| `scripts/core/terrain_objects/placement_engine.gd` | 7-step deterministic placement pipeline |
| `scripts/core/terrain_objects/delta_persistence.gd` | Delta log: save/load/decay/prune |
| `scripts/core/terrain_objects/animation_resolver.gd` | Priority stack, compositing, sprite sheet player |
| `scripts/core/terrain_objects/object_instance.gd` | ObjectInstance data class |

### Modified Files
| File | Change |
|------|--------|
| `scripts/core/world_compiler/deferred_renderer.gd` | Replace _render_object_sprites() and _render_detail_decorations() with PlacementEngine calls |
| `scripts/autoload/WorldManager.gd` | Register ObjectCatalog, PlacementEngine, DeltaPersistence, AnimationResolver |

---

## Task 1: Directory Structure + JSON Schemas

**Files:**
- Create: `data/terrain_objects/schema/object_schema.json`
- Create: `data/terrain_objects/schema/interaction_schema.json`
- Create: `data/terrain_objects/schema/affinity_schema.json`
- Create: `data/terrain_objects/schema/transition_schema.json`

- [ ] **Step 1: Create directory tree**

```bash
mkdir -p data/terrain_objects/{schema,objects/vegetation/{tree/{deciduous,conifer,tropical,dead,palm,willow},bush/{flowering,thorny,berry},shrub,grass/{tall,short,reed,aquatic},flower/{wildflower,tropical,mushroom},vine,moss,lichen,algae,fern,crop},objects/mineral/{rock/{boulder,pebble,crystal,volcanic,sandstone},ore/{iron,gold,gem,coal},cliff_face},objects/water_feature/{wave,foam,whirlpool,waterfall,splash,puddle,ice},objects/ground_cover/{leaf_litter,pine_needles,sand_drift,snow_drift,mud_patch,ice_sheet,ash_layer,gravel,peat},objects/structure_natural/{log,nest,den,coral,shell,bone,web,hive},interactions/{traversal,player_action,environmental,ambient,state_reactive,biome_blending},affinities,transitions,generation/prompts}
mkdir -p assets/catalog/terrain_objects
mkdir -p tools/terrain_objects
mkdir -p scripts/core/terrain_objects
```

- [ ] **Step 2: Write object JSON schema**

Create `data/terrain_objects/schema/object_schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Terrain Object Definition",
  "type": "object",
  "required": ["id", "category", "ontology", "interactions"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
    "category": { "type": "string", "description": "Slash-separated taxonomy path" },
    "ontology": { "enum": ["animate", "inanimate"] },
    "size": {
      "type": "array", "items": { "type": "integer", "minimum": 1 },
      "minItems": 2, "maxItems": 2,
      "description": "[width, height] in tiles"
    },
    "blocking": { "type": "boolean", "default": false },
    "anchor": { "type": "string", "default": "bottom_center" },
    "pixel_size": { "type": "integer", "default": 32 },
    "interactions": {
      "type": "array", "items": { "type": "string" },
      "description": "Interaction IDs this object supports (used when ontology=inanimate)"
    },
    "lifecycle": {
      "type": "object",
      "description": "Only for ontology=animate",
      "properties": {
        "phases": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id", "size", "sprite_set"],
            "properties": {
              "id": { "type": "string" },
              "duration_days": {
                "type": "array", "items": { "type": ["integer", "null"] },
                "minItems": 2, "maxItems": 2
              },
              "size": {
                "type": "array", "items": { "type": "integer" }, "minItems": 2, "maxItems": 2
              },
              "sprite_set": { "type": "string" }
            }
          }
        },
        "phase_interactions": {
          "type": "object",
          "additionalProperties": {
            "type": "array", "items": { "type": "string" }
          }
        }
      }
    },
    "durability": {
      "type": "object",
      "description": "Only for ontology=inanimate",
      "properties": {
        "hp": { "type": "integer", "minimum": 1 },
        "resistances": {
          "type": "object",
          "additionalProperties": { "type": "number", "minimum": 0, "maximum": 1 }
        },
        "stages": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id", "hp_range", "sprite_set"],
            "properties": {
              "id": { "type": "string" },
              "hp_range": {
                "type": "array", "items": { "type": "integer" }, "minItems": 2, "maxItems": 2
              },
              "sprite_set": { "type": "string" }
            }
          }
        },
        "break_products": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["object_id"],
            "properties": {
              "object_id": { "type": "string" },
              "count": {
                "oneOf": [
                  { "type": "integer" },
                  { "type": "array", "items": { "type": "integer" }, "minItems": 2, "maxItems": 2 }
                ]
              },
              "on_stage": { "type": "string" }
            }
          }
        }
      }
    },
    "variance": {
      "type": "object",
      "properties": {
        "branching_seed": { "type": "boolean" },
        "leaf_density": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 },
        "lean_angle": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 },
        "color_shift": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 },
        "scale_variance": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 }
      }
    },
    "break_products": {
      "type": "object",
      "description": "For animate objects: keyed by trigger (on_chop, on_burn, etc.)",
      "additionalProperties": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["object_id"],
          "properties": {
            "object_id": { "type": "string" },
            "count": {
              "oneOf": [
                { "type": "integer" },
                { "type": "array", "items": { "type": "integer" }, "minItems": 2, "maxItems": 2 }
              ]
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Write interaction JSON schema**

Create `data/terrain_objects/schema/interaction_schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Interaction Definition",
  "type": "object",
  "required": ["id", "category", "trigger", "animation"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
    "category": {
      "enum": ["traversal", "player_action", "environmental", "ambient", "state_reactive", "biome_blending"]
    },
    "trigger": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": {
          "enum": ["entity_action", "environmental", "proximity", "timer", "state_change", "always", "time_of_day", "season"]
        },
        "requires_tool": { "type": "string" },
        "requires_target": {
          "type": "object",
          "properties": {
            "ontology": { "enum": ["animate", "inanimate"] },
            "category_prefix": { "type": "string" },
            "min_phase": { "type": "string" },
            "blocking": { "type": "boolean" },
            "property": { "type": "string" }
          }
        },
        "weather_field": { "type": "string" },
        "threshold": { "type": "number" }
      }
    },
    "effects": {
      "type": "object",
      "properties": {
        "damage": {
          "type": "object",
          "properties": {
            "amount": { "type": "integer" },
            "type": { "type": "string" }
          }
        },
        "state_transition": { "type": ["string", "null"] },
        "spawn_products": {
          "type": "object",
          "properties": { "on_destroy": { "type": "boolean" } }
        },
        "particle": { "type": "string" },
        "sound": { "type": "string" }
      }
    },
    "animation": {
      "type": "object",
      "required": ["frames", "duration_ms", "loop"],
      "properties": {
        "frames": {
          "type": "array", "items": { "type": "integer" }, "minItems": 2, "maxItems": 2
        },
        "duration_ms": {
          "type": "array", "items": { "type": "integer" }, "minItems": 2, "maxItems": 2
        },
        "loop": { "type": "boolean" },
        "directional": { "type": "boolean", "default": false },
        "intensity_variable": { "type": "boolean", "default": false },
        "blend_mode": { "enum": ["replace", "overlay", "additive"], "default": "replace" },
        "can_composite_with": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

- [ ] **Step 4: Write affinity JSON schema**

Create `data/terrain_objects/schema/affinity_schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Biome Affinity Definition",
  "type": "object",
  "required": ["biome_id", "object_pools"],
  "properties": {
    "biome_id": { "type": "string" },
    "object_pools": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["object_id", "density"],
        "properties": {
          "object_id": { "type": "string" },
          "density": { "type": "number", "minimum": 0, "maximum": 1 },
          "cluster_mode": { "enum": ["perlin", "scatter", "edge_follow", "water_follow"], "default": "scatter" },
          "cluster_scale": { "type": "number", "default": 0.3 },
          "elevation_range": {
            "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2
          },
          "moisture_range": {
            "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2
          },
          "slope_max": { "type": "number" },
          "distance_rules": {
            "type": "object",
            "properties": {
              "min_water": { "type": ["integer", "null"] },
              "max_water": { "type": ["integer", "null"] },
              "min_road": { "type": ["integer", "null"] },
              "max_road": { "type": ["integer", "null"] }
            }
          },
          "lifecycle_distribution": {
            "type": "object",
            "additionalProperties": { "type": "number" }
          },
          "variant_count": { "type": "integer", "minimum": 1, "default": 1 }
        }
      }
    },
    "ambient": {
      "type": "object",
      "properties": {
        "wind_baseline": { "type": "number" },
        "moisture_baseline": { "type": "number" },
        "light_filter": { "type": ["string", "null"] }
      }
    }
  }
}
```

- [ ] **Step 5: Write transition JSON schema**

Create `data/terrain_objects/schema/transition_schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Biome Transition Definition",
  "type": "object",
  "required": ["biome_a", "biome_b", "blend_width"],
  "properties": {
    "biome_a": { "type": "string" },
    "biome_b": { "type": "string" },
    "blend_width": { "type": "integer", "minimum": 1 },
    "edge_objects": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["object_id", "density"],
        "properties": {
          "object_id": { "type": "string" },
          "density": { "type": "number", "minimum": 0, "maximum": 1 }
        }
      }
    },
    "gradient": {
      "type": "object",
      "properties": {
        "biome_a_objects": { "enum": ["linear_fadeout", "hard_cutoff", "noise_blend"] },
        "biome_b_objects": { "enum": ["linear_fadein", "hard_cutoff", "noise_blend"] }
      }
    }
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add data/terrain_objects/schema/
git commit -m "feat(terrain-objects): JSON schemas for object, interaction, affinity, transition"
```

---

## Task 2: Schema Documentation

**Files:**
- Create: `data/terrain_objects/schema/README.md`
- Create: `data/terrain_objects/schema/EXTENSION_POINTS.md`

- [ ] **Step 1: Write README.md**

Create `data/terrain_objects/schema/README.md`:

```markdown
# Terrain Object System — START HERE

## What This Is

A three-axis relational model for all objects composing the game world's terrain.
Every biome is composed of atomic, layered, animated objects — not flat textures.

## The Three Axes

1. **Object Catalog** (`data/terrain_objects/objects/`) — what exists
   - Animate objects: lifecycle phases (seedling → mature → dead → decomposing)
   - Inanimate objects: durability stages (intact → cracked → shattered → break_products)
   - Every object has a category, interactions, variance parameters

2. **Interaction Schema** (`data/terrain_objects/interactions/`) — what can happen to it
   - Categories: traversal, player_action, environmental, ambient, state_reactive, biome_blending
   - Each defines: trigger conditions, effects (damage/state/products), animation spec

3. **Biome Affinity Matrix** (`data/terrain_objects/affinities/`) — where it appears
   - 18 biome files, each listing object pools with density, clustering, elevation/moisture rules
   - Lifecycle distribution: what phase ratio at world generation
   - Biome transitions (`data/terrain_objects/transitions/`): edge objects + gradient rules

## Key Concepts

- **Deterministic placement**: world_seed + chunk_position → always same objects
- **Delta persistence**: mutations stored as sparse time-decaying deltas
- **Entropy**: deltas decay (stumps regrow, pits fill) — world heals itself
- **Animation compositing**: base + overlay + additive layers, priority-resolved

## World State = Baseline + Deltas

```
Baseline (never stored):  world_seed → Perlin noise → placement decisions
Deltas (sparse storage):  { position, mutation, timestamp, decay_model }
On load:  regenerate baseline → apply surviving deltas → render
```

## File Flow

```
schema/*.json → validates → objects/ + interactions/ + affinities/ + transitions/
                                ↓
tools/terrain_objects/build_generation_queue.py → generation/queue.json
                                ↓
tools/terrain_objects/run_pixellab_generation.py → assets/catalog/terrain_objects/
                                ↓
scripts/core/terrain_objects/object_catalog.gd ← loads JSON at runtime
scripts/core/terrain_objects/placement_engine.gd ← reads affinities + ChunkData → ObjectInstances
scripts/core/terrain_objects/animation_resolver.gd ← resolves animation priority stack
scripts/core/terrain_objects/delta_persistence.gd ← saves/loads/decays mutations
                                ↓
deferred_renderer.gd ← renders ObjectInstances with animations
```

## JSON Schemas

- `object_schema.json` — validates object definitions
- `interaction_schema.json` — validates interaction definitions
- `affinity_schema.json` — validates biome affinity files
- `transition_schema.json` — validates biome transition files

## Runtime GDScript

| Script | Responsibility |
|--------|---------------|
| `object_catalog.gd` | Loads all object JSONs, index by id and category |
| `interaction_registry.gd` | Loads interactions, matches triggers to objects |
| `biome_affinity.gd` | Loads affinities, queries pools per biome |
| `placement_engine.gd` | 7-step deterministic placement from ChunkData |
| `delta_persistence.gd` | Delta log with time-decay and entropy |
| `animation_resolver.gd` | Priority stack + sprite sheet compositing |
| `object_instance.gd` | ObjectInstance data class |

## See Also

- `EXTENSION_POINTS.md` — hooks for identity, weather, seasons, buildings, NPCs
- `docs/superpowers/specs/2026-05-28-terrain-object-system-design.md` — full design spec
```

- [ ] **Step 2: Write EXTENSION_POINTS.md**

Create `data/terrain_objects/schema/EXTENSION_POINTS.md`:

```markdown
# Extension Points — Terrain Object System

This document tells future agents where to hook new systems into the terrain object framework.

## Identity System (not yet built)

**Current state:** Each ObjectInstance has an `instance_seed` for visual variance only.

**Where to hook:**
- `data/terrain_objects/schema/object_schema.json` → add `identity` block to schema
- `scripts/core/terrain_objects/object_instance.gd` → add `identity_id: int` field
- `scripts/core/terrain_objects/object_catalog.gd` → add `get_object_identity()` method

**What to add:**
- `identity_id` linking to EntitySystem
- Growth history (near water = taller, crowded = thinner canopy)
- Damage scars (lightning strike = scar texture overlay)
- Relationship to neighbors (symbiosis, competition)
- Persistent tracking across sessions via delta system

## Weather Integration (not yet built)

**Current state:** Environmental interactions (wind, rain, lightning) are defined but read no live data.

**Where to hook:**
- `data/terrain_objects/interactions/environmental/*.json` → `trigger.weather_field` already defined
- `scripts/core/terrain_objects/animation_resolver.gd` → `_get_weather_intensity()` method
- `scripts/core/terrain_objects/delta_persistence.gd` → weather modifies `recovery_time`

**What to add:**
- AnimationResolver queries WeatherSystem for wind_speed, precipitation, temperature
- Environmental interactions scale animation intensity with weather values
- Rain accelerates `fill` decay type on pit deltas
- Drought slows `regrow` decay on vegetation deltas

## Seasonal System (not yet built)

**Current state:** `seasonal_change` interaction defined. Lifecycle phases have duration_days.

**Where to hook:**
- Object lifecycle phases → add `season_locked: string` field (e.g., "bloom" only in spring)
- Animation sets → `seasonal_spring.png`, `seasonal_autumn.png` overlay sprites
- `scripts/core/terrain_objects/animation_resolver.gd` → check GameTime.season

**What to add:**
- Animate objects check current season for bloom/fruit/autumn_color/bare transitions
- Deciduous trees: spring=budding, summer=full, autumn=colored, winter=bare
- Flowers: bloom only in appropriate season
- Ground cover: snow_drift density increases in winter

## Building Integration (not yet built)

**Current state:** Inanimate object durability + break_products pattern exists.

**Where to hook:**
- `data/terrain_objects/objects/` → add `structure/` category (wall, floor, door, roof, furniture)
- `scripts/core/terrain_objects/placement_engine.gd` → settlement footprint suppression
- `scripts/core/terrain_objects/delta_persistence.gd` → `permanent` decay type

**What to add:**
- Walls, floors, doors, roofs as inanimate objects with durability
- Settlement footprint = permanent delta suppressing baseline regrowth
- When structure removed, permanent flag lifts, regrow begins
- Furniture as small inanimate objects placed on floor tiles

## NPC Interaction (not yet built)

**Current state:** Interactions use `entity_action` trigger type, designed for any entity.

**Where to hook:**
- `data/terrain_objects/interactions/player_action/` → applies to ALL entities, not just player
- `scripts/core/terrain_objects/interaction_registry.gd` → `resolve_npc_action()` method
- NPC goal graph → reference `object_id` as action target

**What to add:**
- NPCs can chop, mine, farm, gather using same interaction system
- NPC schedules reference terrain objects (woodcutter → nearest tree)
- NPC actions create same deltas as player actions
```

- [ ] **Step 3: Commit**

```bash
git add data/terrain_objects/schema/README.md data/terrain_objects/schema/EXTENSION_POINTS.md
git commit -m "docs(terrain-objects): README start-here guide and extension points for future agents"
```

---

## Task 3: Interaction Definitions Generator

**Files:**
- Create: `tools/terrain_objects/generate_interactions.py`
- Output: `data/terrain_objects/interactions/**/*.json` (~30 files)

- [ ] **Step 1: Write the generator script**

Create `tools/terrain_objects/generate_interactions.py`:

```python
#!/usr/bin/env python3
"""Generate all interaction definition JSON files from embedded data table."""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "data" / "terrain_objects" / "interactions"

INTERACTIONS = [
    # --- traversal ---
    {
        "id": "walk_through",
        "category": "traversal",
        "trigger": {"type": "proximity", "requires_target": {"blocking": False}},
        "effects": {"particle": "grass_rustle", "sound": "step_vegetation"},
        "animation": {"frames": [4, 6], "duration_ms": [400, 600], "loop": False,
                      "directional": True, "blend_mode": "replace"},
    },
    {
        "id": "run_through",
        "category": "traversal",
        "trigger": {"type": "proximity", "requires_target": {"blocking": False}},
        "effects": {"particle": "grass_burst", "sound": "step_vegetation_fast"},
        "animation": {"frames": [4, 6], "duration_ms": [200, 400], "loop": False,
                      "directional": True, "blend_mode": "replace"},
    },
    {
        "id": "swim_past",
        "category": "traversal",
        "trigger": {"type": "proximity", "requires_target": {"category_prefix": "water_feature"}},
        "effects": {"particle": "water_ripple", "sound": "water_splash"},
        "animation": {"frames": [6, 8], "duration_ms": [500, 800], "loop": False,
                      "blend_mode": "overlay"},
    },
    {
        "id": "fly_over",
        "category": "traversal",
        "trigger": {"type": "proximity"},
        "effects": {"particle": "shadow_pass"},
        "animation": {"frames": [2, 4], "duration_ms": [300, 500], "loop": False,
                      "blend_mode": "overlay"},
    },
    {
        "id": "land_on",
        "category": "traversal",
        "trigger": {"type": "entity_action"},
        "effects": {"particle": "dust_impact", "sound": "thud"},
        "animation": {"frames": [4, 6], "duration_ms": [200, 400], "loop": False,
                      "blend_mode": "replace"},
    },
    {
        "id": "push_aside",
        "category": "traversal",
        "trigger": {"type": "proximity", "requires_target": {"property": "pushable"}},
        "effects": {"sound": "bush_rustle"},
        "animation": {"frames": [4, 6], "duration_ms": [300, 500], "loop": False,
                      "directional": True, "blend_mode": "replace"},
    },
    # --- player_action ---
    {
        "id": "chop",
        "category": "player_action",
        "trigger": {"type": "entity_action", "requires_tool": "axe",
                    "requires_target": {"ontology": "animate", "category_prefix": "vegetation", "min_phase": "sapling"}},
        "effects": {"damage": {"amount": 25, "type": "sharp"}, "spawn_products": {"on_destroy": True},
                    "particle": "wood_chips", "sound": "chop_wood"},
        "animation": {"frames": [4, 8], "duration_ms": [300, 600], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "mine",
        "category": "player_action",
        "trigger": {"type": "entity_action", "requires_tool": "pickaxe",
                    "requires_target": {"ontology": "inanimate", "category_prefix": "mineral"}},
        "effects": {"damage": {"amount": 20, "type": "blunt"}, "spawn_products": {"on_destroy": True},
                    "particle": "stone_chips", "sound": "pickaxe_hit"},
        "animation": {"frames": [4, 6], "duration_ms": [300, 500], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "dig",
        "category": "player_action",
        "trigger": {"type": "entity_action", "requires_tool": "shovel",
                    "requires_target": {"category_prefix": "ground_cover"}},
        "effects": {"damage": {"amount": 50, "type": "blunt"}, "particle": "dirt_toss", "sound": "dig"},
        "animation": {"frames": [4, 6], "duration_ms": [400, 600], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "pick",
        "category": "player_action",
        "trigger": {"type": "entity_action",
                    "requires_target": {"property": "pickable"}},
        "effects": {"state_transition": "picked", "sound": "pluck"},
        "animation": {"frames": [3, 4], "duration_ms": [200, 300], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "burn_ignite",
        "category": "player_action",
        "trigger": {"type": "entity_action", "requires_tool": "torch",
                    "requires_target": {"property": "flammable"}},
        "effects": {"state_transition": "burning", "particle": "fire_start", "sound": "ignite"},
        "animation": {"frames": [6, 10], "duration_ms": [800, 1500], "loop": True, "blend_mode": "replace"},
    },
    {
        "id": "freeze_cast",
        "category": "player_action",
        "trigger": {"type": "entity_action", "requires_tool": "frost_spell"},
        "effects": {"state_transition": "frozen", "particle": "frost_burst", "sound": "freeze"},
        "animation": {"frames": [6, 8], "duration_ms": [500, 800], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "plant",
        "category": "player_action",
        "trigger": {"type": "entity_action", "requires_tool": "seed"},
        "effects": {"state_transition": "seedling", "particle": "soil_pat", "sound": "plant"},
        "animation": {"frames": [4, 6], "duration_ms": [400, 600], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "water_plant",
        "category": "player_action",
        "trigger": {"type": "entity_action", "requires_tool": "bucket",
                    "requires_target": {"ontology": "animate", "category_prefix": "vegetation"}},
        "effects": {"particle": "water_pour", "sound": "water_pour"},
        "animation": {"frames": [4, 6], "duration_ms": [400, 600], "loop": False, "blend_mode": "overlay"},
    },
    {
        "id": "climb",
        "category": "player_action",
        "trigger": {"type": "entity_action",
                    "requires_target": {"property": "climbable"}},
        "effects": {"sound": "climb_bark"},
        "animation": {"frames": [4, 6], "duration_ms": [500, 800], "loop": False, "blend_mode": "replace"},
    },
    # --- environmental ---
    {
        "id": "wind",
        "category": "environmental",
        "trigger": {"type": "environmental", "weather_field": "wind_speed", "threshold": 0.1},
        "effects": {},
        "animation": {"frames": [6, 10], "duration_ms": [600, 1200], "loop": True,
                      "intensity_variable": True, "blend_mode": "replace",
                      "can_composite_with": ["rain", "idle"]},
    },
    {
        "id": "rain",
        "category": "environmental",
        "trigger": {"type": "environmental", "weather_field": "precipitation", "threshold": 0.1},
        "effects": {},
        "animation": {"frames": [4, 8], "duration_ms": [400, 800], "loop": True,
                      "intensity_variable": True, "blend_mode": "overlay",
                      "can_composite_with": ["wind", "idle"]},
    },
    {
        "id": "lightning_strike",
        "category": "environmental",
        "trigger": {"type": "environmental", "weather_field": "lightning"},
        "effects": {"damage": {"amount": 80, "type": "electrical"}, "state_transition": "burning",
                    "particle": "lightning_flash", "sound": "thunder_crack"},
        "animation": {"frames": [6, 10], "duration_ms": [300, 600], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "flood",
        "category": "environmental",
        "trigger": {"type": "environmental", "weather_field": "water_level", "threshold": 0.5},
        "effects": {"state_transition": "submerged"},
        "animation": {"frames": [6, 8], "duration_ms": [800, 1200], "loop": True, "blend_mode": "overlay"},
    },
    {
        "id": "fire_spread",
        "category": "environmental",
        "trigger": {"type": "proximity", "requires_target": {"property": "flammable"}},
        "effects": {"state_transition": "burning", "particle": "ember_float", "sound": "fire_crackle"},
        "animation": {"frames": [6, 10], "duration_ms": [600, 1000], "loop": True, "blend_mode": "replace"},
    },
    {
        "id": "erosion",
        "category": "environmental",
        "trigger": {"type": "timer"},
        "effects": {"damage": {"amount": 1, "type": "erosion"}},
        "animation": {"frames": [2, 4], "duration_ms": [2000, 4000], "loop": False, "blend_mode": "replace"},
    },
    # --- ambient ---
    {
        "id": "idle",
        "category": "ambient",
        "trigger": {"type": "always"},
        "effects": {},
        "animation": {"frames": [4, 8], "duration_ms": [800, 1600], "loop": True, "blend_mode": "replace"},
    },
    {
        "id": "idle_variant",
        "category": "ambient",
        "trigger": {"type": "timer"},
        "effects": {},
        "animation": {"frames": [4, 6], "duration_ms": [600, 1000], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "day_shift",
        "category": "ambient",
        "trigger": {"type": "time_of_day"},
        "effects": {},
        "animation": {"frames": [2, 4], "duration_ms": [2000, 4000], "loop": False, "blend_mode": "overlay"},
    },
    {
        "id": "night_shift",
        "category": "ambient",
        "trigger": {"type": "time_of_day"},
        "effects": {},
        "animation": {"frames": [2, 4], "duration_ms": [2000, 4000], "loop": False, "blend_mode": "overlay"},
    },
    {
        "id": "seasonal_change",
        "category": "ambient",
        "trigger": {"type": "season"},
        "effects": {},
        "animation": {"frames": [4, 8], "duration_ms": [4000, 8000], "loop": False, "blend_mode": "overlay"},
    },
    # --- state_reactive ---
    {
        "id": "crack",
        "category": "state_reactive",
        "trigger": {"type": "state_change"},
        "effects": {"particle": "dust_puff", "sound": "crack"},
        "animation": {"frames": [3, 5], "duration_ms": [200, 400], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "wilt",
        "category": "state_reactive",
        "trigger": {"type": "state_change"},
        "effects": {},
        "animation": {"frames": [4, 8], "duration_ms": [2000, 4000], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "bloom",
        "category": "state_reactive",
        "trigger": {"type": "state_change"},
        "effects": {"particle": "pollen_burst"},
        "animation": {"frames": [6, 10], "duration_ms": [2000, 4000], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "fruit",
        "category": "state_reactive",
        "trigger": {"type": "state_change"},
        "effects": {},
        "animation": {"frames": [4, 6], "duration_ms": [2000, 4000], "loop": False, "blend_mode": "overlay"},
    },
    {
        "id": "regrow",
        "category": "state_reactive",
        "trigger": {"type": "timer"},
        "effects": {},
        "animation": {"frames": [6, 10], "duration_ms": [4000, 8000], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "collapse",
        "category": "state_reactive",
        "trigger": {"type": "state_change"},
        "effects": {"particle": "dust_cloud", "sound": "tree_fall"},
        "animation": {"frames": [8, 12], "duration_ms": [800, 1500], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "decompose",
        "category": "state_reactive",
        "trigger": {"type": "timer"},
        "effects": {},
        "animation": {"frames": [4, 8], "duration_ms": [4000, 8000], "loop": False, "blend_mode": "replace"},
    },
    {
        "id": "fungal_growth",
        "category": "state_reactive",
        "trigger": {"type": "timer"},
        "effects": {},
        "animation": {"frames": [4, 8], "duration_ms": [4000, 8000], "loop": False, "blend_mode": "overlay"},
    },
    {
        "id": "insect_swarm",
        "category": "state_reactive",
        "trigger": {"type": "timer"},
        "effects": {"particle": "buzzing_insects"},
        "animation": {"frames": [6, 10], "duration_ms": [1000, 2000], "loop": True, "blend_mode": "additive"},
    },
    # --- biome_blending ---
    {
        "id": "edge_fade",
        "category": "biome_blending",
        "trigger": {"type": "proximity"},
        "effects": {},
        "animation": {"frames": [2, 4], "duration_ms": [1000, 2000], "loop": True, "blend_mode": "overlay"},
    },
    {
        "id": "submersion",
        "category": "biome_blending",
        "trigger": {"type": "proximity"},
        "effects": {},
        "animation": {"frames": [4, 8], "duration_ms": [800, 1500], "loop": True, "blend_mode": "overlay"},
    },
    {
        "id": "overgrowth",
        "category": "biome_blending",
        "trigger": {"type": "timer"},
        "effects": {},
        "animation": {"frames": [4, 8], "duration_ms": [4000, 8000], "loop": False, "blend_mode": "overlay"},
    },
]


def main():
    count = 0
    for interaction in INTERACTIONS:
        cat_dir = OUT_DIR / interaction["category"]
        cat_dir.mkdir(parents=True, exist_ok=True)
        filepath = cat_dir / f"{interaction['id']}.json"
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(interaction, f, indent=2)
        count += 1
    print(f"Generated {count} interaction definitions in {OUT_DIR}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the generator**

```bash
cd C:/Users/daves/OneDrive/Documents/freedommmo
python tools/terrain_objects/generate_interactions.py
```

Expected: `Generated 35 interaction definitions in data/terrain_objects/interactions`

- [ ] **Step 3: Verify output — spot check a file**

```bash
cat data/terrain_objects/interactions/player_action/chop.json
```

Expected: Valid JSON with id="chop", category="player_action", trigger with requires_tool="axe".

- [ ] **Step 4: Commit**

```bash
git add tools/terrain_objects/generate_interactions.py data/terrain_objects/interactions/
git commit -m "feat(terrain-objects): interaction definitions generator — 35 interactions"
```

---

## Task 4: Object Definitions Generator

**Files:**
- Create: `tools/terrain_objects/generate_objects.py`
- Output: `data/terrain_objects/objects/**/*.json` (~200+ files)

This is the largest data generation task. The script contains the full taxonomy with lifecycle phases, durability stages, interactions, variance, and break_products for every object type.

- [ ] **Step 1: Write the generator script**

Create `tools/terrain_objects/generate_objects.py`:

```python
#!/usr/bin/env python3
"""Generate all object definition JSON files from embedded taxonomy data.

Each object gets lifecycle (animate) or durability (inanimate) data,
interaction lists, variance parameters, and break_product chains.
"""

import json
import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "data" / "terrain_objects" / "objects"

# --- Shared lifecycle/durability templates ---

TREE_LIFECYCLE = {
    "phases": [
        {"id": "seedling",    "duration_days": [30, 60],    "size": [1, 1], "sprite_set": "seedling/"},
        {"id": "sapling",     "duration_days": [60, 120],   "size": [1, 2], "sprite_set": "sapling/"},
        {"id": "juvenile",    "duration_days": [120, 360],  "size": [1, 2], "sprite_set": "juvenile/"},
        {"id": "mature",      "duration_days": [360, None],  "size": [2, 3], "sprite_set": "mature/"},
        {"id": "old_growth",  "duration_days": [720, None],  "size": [2, 4], "sprite_set": "old_growth/"},
        {"id": "dying",       "duration_days": [30, 90],    "size": [2, 4], "sprite_set": "dying/"},
        {"id": "dead",        "duration_days": [60, 180],   "size": [2, 3], "sprite_set": "dead/"},
        {"id": "decomposing", "duration_days": [90, None],   "size": [1, 2], "sprite_set": "decomposing/"},
    ],
    "phase_interactions": {
        "seedling":    ["idle", "walk_through", "pick", "burn_ignite", "freeze_cast"],
        "sapling":     ["idle", "wind", "chop", "burn_ignite", "freeze_cast"],
        "juvenile":    ["idle", "wind", "chop", "burn_ignite", "freeze_cast", "rain"],
        "mature":      ["idle", "wind", "chop", "burn_ignite", "freeze_cast", "lightning_strike",
                        "climb", "rain", "seasonal_change", "fruit", "bloom"],
        "old_growth":  ["idle", "wind", "chop", "burn_ignite", "freeze_cast", "lightning_strike",
                        "climb", "rain", "seasonal_change", "fungal_growth"],
        "dying":       ["idle", "wilt", "collapse", "burn_ignite", "fungal_growth"],
        "dead":        ["idle", "collapse", "burn_ignite", "chop", "fungal_growth"],
        "decomposing": ["idle", "fungal_growth", "insect_swarm", "decompose"],
    },
}

BUSH_LIFECYCLE = {
    "phases": [
        {"id": "seedling",  "duration_days": [15, 30],   "size": [1, 1], "sprite_set": "seedling/"},
        {"id": "growing",   "duration_days": [30, 90],   "size": [1, 1], "sprite_set": "growing/"},
        {"id": "mature",    "duration_days": [180, None],  "size": [1, 1], "sprite_set": "mature/"},
        {"id": "flowering", "duration_days": [30, 60],   "size": [1, 1], "sprite_set": "flowering/"},
        {"id": "dying",     "duration_days": [30, 60],   "size": [1, 1], "sprite_set": "dying/"},
        {"id": "dead",      "duration_days": [30, 90],   "size": [1, 1], "sprite_set": "dead/"},
    ],
    "phase_interactions": {
        "seedling":  ["idle", "walk_through", "pick", "burn_ignite"],
        "growing":   ["idle", "wind", "walk_through", "burn_ignite", "freeze_cast"],
        "mature":    ["idle", "wind", "walk_through", "chop", "burn_ignite", "freeze_cast",
                      "rain", "seasonal_change", "bloom"],
        "flowering": ["idle", "wind", "walk_through", "pick", "burn_ignite", "bloom"],
        "dying":     ["idle", "wilt", "burn_ignite"],
        "dead":      ["idle", "burn_ignite", "decompose"],
    },
}

GRASS_LIFECYCLE = {
    "phases": [
        {"id": "sprout",  "duration_days": [5, 15],    "size": [1, 1], "sprite_set": "sprout/"},
        {"id": "growing", "duration_days": [10, 30],   "size": [1, 1], "sprite_set": "growing/"},
        {"id": "mature",  "duration_days": [60, None],   "size": [1, 1], "sprite_set": "mature/"},
        {"id": "dry",     "duration_days": [30, 60],   "size": [1, 1], "sprite_set": "dry/"},
        {"id": "dead",    "duration_days": [15, 30],   "size": [1, 1], "sprite_set": "dead/"},
    ],
    "phase_interactions": {
        "sprout":  ["idle", "walk_through", "burn_ignite"],
        "growing": ["idle", "wind", "walk_through", "run_through", "burn_ignite"],
        "mature":  ["idle", "wind", "walk_through", "run_through", "chop", "burn_ignite",
                    "freeze_cast", "rain", "seasonal_change"],
        "dry":     ["idle", "wind", "walk_through", "burn_ignite"],
        "dead":    ["idle", "walk_through", "decompose"],
    },
}

FLOWER_LIFECYCLE = {
    "phases": [
        {"id": "bud",       "duration_days": [10, 20],  "size": [1, 1], "sprite_set": "bud/"},
        {"id": "blooming",  "duration_days": [30, 60],  "size": [1, 1], "sprite_set": "blooming/"},
        {"id": "wilting",   "duration_days": [15, 30],  "size": [1, 1], "sprite_set": "wilting/"},
        {"id": "seed_head", "duration_days": [10, 20],  "size": [1, 1], "sprite_set": "seed_head/"},
    ],
    "phase_interactions": {
        "bud":       ["idle", "walk_through", "pick", "rain"],
        "blooming":  ["idle", "wind", "walk_through", "pick", "burn_ignite", "bloom",
                      "rain", "insect_swarm"],
        "wilting":   ["idle", "wind", "walk_through", "wilt"],
        "seed_head": ["idle", "wind", "walk_through", "pick"],
    },
}

ROCK_DURABILITY = {
    "hp": 100,
    "resistances": {"blunt": 0.5, "sharp": 0.8, "fire": 0.95, "frost": 0.7},
    "stages": [
        {"id": "intact",    "hp_range": [75, 100], "sprite_set": "intact/"},
        {"id": "cracked",   "hp_range": [40, 75],  "sprite_set": "cracked/"},
        {"id": "fractured", "hp_range": [10, 40],  "sprite_set": "fractured/"},
        {"id": "shattered", "hp_range": [0, 10],   "sprite_set": "shattered/"},
    ],
    "break_products": [
        {"object_id": "rock_chunk", "count": [2, 4], "on_stage": "shattered"},
        {"object_id": "pebble",     "count": [5, 12], "on_stage": "shattered"},
        {"object_id": "stone_dust", "count": 1,      "on_stage": "shattered"},
    ],
}

TREE_VARIANCE = {
    "branching_seed": True,
    "leaf_density": [0.6, 1.0],
    "lean_angle": [-5, 5],
    "color_shift": [-10, 10],
    "scale_variance": [0.85, 1.15],
}

SMALL_VARIANCE = {
    "lean_angle": [-3, 3],
    "color_shift": [-8, 8],
    "scale_variance": [0.8, 1.2],
}

ROCK_VARIANCE = {
    "lean_angle": [-2, 2],
    "color_shift": [-5, 5],
    "scale_variance": [0.7, 1.3],
}


def tree(obj_id: str, category: str, size: list = None, **overrides) -> dict:
    """Create a tree-type animate object."""
    obj = {
        "id": obj_id,
        "category": category,
        "ontology": "animate",
        "size": size or [2, 3],
        "blocking": True,
        "anchor": "bottom_center",
        "pixel_size": 32,
        "interactions": [],
        "lifecycle": TREE_LIFECYCLE,
        "variance": TREE_VARIANCE,
        "break_products": {
            "on_chop": [
                {"object_id": f"{obj_id}_stump", "count": 1},
                {"object_id": "log", "count": [1, 2]},
                {"object_id": "branch", "count": [2, 4]},
            ],
            "on_burn": [
                {"object_id": "charred_trunk", "count": 1},
                {"object_id": "ash_pile", "count": [1, 3]},
            ],
        },
    }
    obj.update(overrides)
    return obj


def bush(obj_id: str, category: str, **overrides) -> dict:
    """Create a bush-type animate object."""
    obj = {
        "id": obj_id,
        "category": category,
        "ontology": "animate",
        "size": [1, 1],
        "blocking": False,
        "anchor": "bottom_center",
        "pixel_size": 32,
        "interactions": [],
        "lifecycle": BUSH_LIFECYCLE,
        "variance": SMALL_VARIANCE,
        "break_products": {
            "on_chop": [{"object_id": "twig", "count": [2, 4]}],
            "on_burn": [{"object_id": "ash_pile", "count": 1}],
        },
    }
    obj.update(overrides)
    return obj


def grass(obj_id: str, category: str, **overrides) -> dict:
    """Create a grass-type animate object."""
    obj = {
        "id": obj_id,
        "category": category,
        "ontology": "animate",
        "size": [1, 1],
        "blocking": False,
        "anchor": "bottom_center",
        "pixel_size": 32,
        "interactions": [],
        "lifecycle": GRASS_LIFECYCLE,
        "variance": SMALL_VARIANCE,
        "break_products": {},
    }
    obj.update(overrides)
    return obj


def flower(obj_id: str, category: str, **overrides) -> dict:
    """Create a flower-type animate object."""
    obj = {
        "id": obj_id,
        "category": category,
        "ontology": "animate",
        "size": [1, 1],
        "blocking": False,
        "anchor": "bottom_center",
        "pixel_size": 32,
        "interactions": [],
        "lifecycle": FLOWER_LIFECYCLE,
        "variance": SMALL_VARIANCE,
        "break_products": {},
    }
    obj.update(overrides)
    return obj


def rock(obj_id: str, category: str, size: list = None, blocking: bool = True, **overrides) -> dict:
    """Create a rock-type inanimate object."""
    obj = {
        "id": obj_id,
        "category": category,
        "ontology": "inanimate",
        "size": size or [1, 1],
        "blocking": blocking,
        "anchor": "bottom_center",
        "pixel_size": 32,
        "interactions": ["idle", "mine", "erosion", "freeze_cast"],
        "durability": ROCK_DURABILITY,
        "variance": ROCK_VARIANCE,
    }
    obj.update(overrides)
    return obj


def ground_cover(obj_id: str, category: str, **overrides) -> dict:
    """Create a ground cover inanimate object."""
    obj = {
        "id": obj_id,
        "category": category,
        "ontology": "inanimate",
        "size": [1, 1],
        "blocking": False,
        "anchor": "center",
        "pixel_size": 32,
        "interactions": ["idle", "walk_through", "run_through", "dig", "wind"],
        "durability": {
            "hp": 20,
            "resistances": {"blunt": 0.2, "sharp": 0.3, "fire": 0.1, "frost": 0.4},
            "stages": [
                {"id": "intact", "hp_range": [10, 20], "sprite_set": "intact/"},
                {"id": "disturbed", "hp_range": [0, 10], "sprite_set": "disturbed/"},
            ],
            "break_products": [],
        },
        "variance": SMALL_VARIANCE,
    }
    obj.update(overrides)
    return obj


def water_feature(obj_id: str, category: str, **overrides) -> dict:
    """Create a water feature inanimate object."""
    obj = {
        "id": obj_id,
        "category": category,
        "ontology": "inanimate",
        "size": [1, 1],
        "blocking": False,
        "anchor": "center",
        "pixel_size": 32,
        "interactions": ["idle", "swim_past", "wind", "rain"],
        "durability": None,
        "variance": {"color_shift": [-5, 5], "scale_variance": [0.9, 1.1]},
    }
    obj.update(overrides)
    return obj


def structure_natural(obj_id: str, category: str, size: list = None,
                      blocking: bool = True, **overrides) -> dict:
    """Create a natural structure inanimate object."""
    obj = {
        "id": obj_id,
        "category": category,
        "ontology": "inanimate",
        "size": size or [1, 1],
        "blocking": blocking,
        "anchor": "bottom_center",
        "pixel_size": 32,
        "interactions": ["idle", "chop", "burn_ignite", "erosion"],
        "durability": {
            "hp": 60,
            "resistances": {"blunt": 0.4, "sharp": 0.3, "fire": 0.2, "frost": 0.6},
            "stages": [
                {"id": "intact",  "hp_range": [30, 60], "sprite_set": "intact/"},
                {"id": "damaged", "hp_range": [0, 30],  "sprite_set": "damaged/"},
            ],
            "break_products": [
                {"object_id": "wood_scrap", "count": [2, 4], "on_stage": "damaged"},
            ],
        },
        "variance": SMALL_VARIANCE,
    }
    obj.update(overrides)
    return obj


# ============================================================
# FULL OBJECT CATALOG — every terrain object in the game
# ============================================================

ALL_OBJECTS: list[dict[str, Any]] = [
    # ---- vegetation/tree/deciduous ----
    tree("oak_tree",      "vegetation/tree/deciduous"),
    tree("birch_tree",    "vegetation/tree/deciduous"),
    tree("maple_tree",    "vegetation/tree/deciduous"),
    tree("elm_tree",      "vegetation/tree/deciduous"),
    tree("ash_tree",      "vegetation/tree/deciduous"),
    tree("beech_tree",    "vegetation/tree/deciduous"),
    tree("poplar_tree",   "vegetation/tree/deciduous"),
    tree("willow_tree",   "vegetation/tree/willow", size=[2, 4]),
    tree("weeping_willow","vegetation/tree/willow", size=[3, 4]),

    # ---- vegetation/tree/conifer ----
    tree("pine_tree",     "vegetation/tree/conifer"),
    tree("spruce_tree",   "vegetation/tree/conifer"),
    tree("fir_tree",      "vegetation/tree/conifer"),
    tree("cedar_tree",    "vegetation/tree/conifer"),
    tree("juniper_tree",  "vegetation/tree/conifer", size=[1, 2]),

    # ---- vegetation/tree/tropical ----
    tree("palm_tree",     "vegetation/tree/palm", size=[1, 3]),
    tree("coconut_palm",  "vegetation/tree/palm", size=[1, 3]),
    tree("banana_tree",   "vegetation/tree/tropical", size=[1, 2]),
    tree("mangrove_tree", "vegetation/tree/tropical", size=[2, 2]),
    tree("jungle_tree",   "vegetation/tree/tropical", size=[2, 4]),
    tree("kapok_tree",    "vegetation/tree/tropical", size=[3, 5]),

    # ---- vegetation/tree/dead ----
    tree("dead_tree",     "vegetation/tree/dead", size=[1, 3]),
    tree("charred_tree",  "vegetation/tree/dead", size=[1, 3]),
    tree("hollow_tree",   "vegetation/tree/dead", size=[2, 3]),

    # ---- vegetation/bush ----
    bush("flowering_bush",  "vegetation/bush/flowering"),
    bush("rose_bush",       "vegetation/bush/flowering"),
    bush("berry_bush",      "vegetation/bush/berry"),
    bush("blueberry_bush",  "vegetation/bush/berry"),
    bush("thorny_bush",     "vegetation/bush/thorny"),
    bush("bramble",         "vegetation/bush/thorny"),
    bush("hedge_bush",      "vegetation/bush/flowering"),
    bush("dry_bush",        "vegetation/bush/thorny"),
    bush("desert_shrub",    "vegetation/shrub"),
    bush("scrub_brush",     "vegetation/shrub"),
    bush("tundra_shrub",    "vegetation/shrub"),

    # ---- vegetation/grass ----
    grass("tall_grass",      "vegetation/grass/tall"),
    grass("meadow_grass",    "vegetation/grass/tall"),
    grass("prairie_grass",   "vegetation/grass/tall"),
    grass("short_grass",     "vegetation/grass/short"),
    grass("lawn_grass",      "vegetation/grass/short"),
    grass("dry_grass",       "vegetation/grass/short"),
    grass("frozen_grass",    "vegetation/grass/short"),
    grass("reed",            "vegetation/grass/reed"),
    grass("cattail",         "vegetation/grass/reed"),
    grass("bulrush",         "vegetation/grass/reed"),
    grass("sea_grass",       "vegetation/grass/aquatic"),
    grass("river_weed",      "vegetation/grass/aquatic"),
    grass("kelp",            "vegetation/grass/aquatic"),
    grass("pampas_grass",    "vegetation/grass/tall"),

    # ---- vegetation/flower ----
    flower("wildflower",     "vegetation/flower/wildflower"),
    flower("daisy",          "vegetation/flower/wildflower"),
    flower("poppy",          "vegetation/flower/wildflower"),
    flower("lavender",       "vegetation/flower/wildflower"),
    flower("sunflower",      "vegetation/flower/wildflower"),
    flower("dandelion",      "vegetation/flower/wildflower"),
    flower("orchid",         "vegetation/flower/tropical"),
    flower("hibiscus",       "vegetation/flower/tropical"),
    flower("lotus",          "vegetation/flower/tropical"),
    flower("glowing_mushroom","vegetation/flower/mushroom"),
    flower("toadstool",      "vegetation/flower/mushroom"),
    flower("puffball",       "vegetation/flower/mushroom"),
    flower("bracket_fungus", "vegetation/flower/mushroom"),
    flower("morel",          "vegetation/flower/mushroom"),
    flower("succulent",      "vegetation/flower/wildflower"),
    flower("cactus_flower",  "vegetation/flower/wildflower"),
    flower("arctic_poppy",   "vegetation/flower/wildflower"),
    flower("arcane_flower",  "vegetation/flower/wildflower"),

    # ---- vegetation/vine ----
    bush("climbing_vine",   "vegetation/vine"),
    bush("hanging_vine",    "vegetation/vine"),
    bush("ivy",             "vegetation/vine"),
    bush("ground_vine",     "vegetation/vine"),
    bush("ethereal_vine",   "vegetation/vine"),

    # ---- vegetation/moss & lichen ----
    grass("rock_moss",      "vegetation/moss"),
    grass("tree_moss",      "vegetation/moss"),
    grass("ground_moss",    "vegetation/moss"),
    grass("hanging_moss",   "vegetation/moss"),
    grass("lichen_patch",   "vegetation/lichen"),
    grass("hardy_moss",     "vegetation/moss"),

    # ---- vegetation/algae ----
    grass("freshwater_algae","vegetation/algae"),
    grass("saltwater_algae", "vegetation/algae"),
    grass("algae_film",      "vegetation/algae"),

    # ---- vegetation/fern ----
    bush("forest_fern",     "vegetation/fern"),
    bush("tropical_fern",   "vegetation/fern"),
    bush("giant_fern",      "vegetation/fern"),
    bush("curled_fiddlehead","vegetation/fern"),

    # ---- vegetation/crop ----
    grass("wheat",          "vegetation/crop/wheat"),
    grass("barley",         "vegetation/crop/wheat"),
    grass("corn",           "vegetation/crop/vegetable"),
    grass("potato_plant",   "vegetation/crop/vegetable"),
    grass("carrot_plant",   "vegetation/crop/vegetable"),
    grass("tomato_plant",   "vegetation/crop/vegetable"),
    tree("apple_tree",      "vegetation/crop/fruit_tree", size=[2, 2]),
    tree("cherry_tree",     "vegetation/crop/fruit_tree", size=[2, 2]),

    # ---- mineral/rock ----
    rock("granite_boulder",  "mineral/rock/boulder", size=[2, 2]),
    rock("sandstone_boulder","mineral/rock/boulder", size=[2, 2]),
    rock("mossy_boulder",    "mineral/rock/boulder", size=[2, 2]),
    rock("basalt_boulder",   "mineral/rock/boulder", size=[2, 2]),
    rock("limestone_block",  "mineral/rock/boulder", size=[1, 1]),
    rock("flat_rock",        "mineral/rock/boulder", size=[1, 1], blocking=False),
    rock("pebble",           "mineral/rock/pebble", size=[1, 1], blocking=False),
    rock("river_stone",      "mineral/rock/pebble", size=[1, 1], blocking=False),
    rock("gravel_pile",      "mineral/rock/pebble", size=[1, 1], blocking=False),
    rock("crystal_cluster",  "mineral/rock/crystal", size=[1, 2]),
    rock("amethyst_geode",   "mineral/rock/crystal", size=[1, 1]),
    rock("quartz_formation", "mineral/rock/crystal", size=[1, 2]),
    rock("mystic_crystal",   "mineral/rock/crystal", size=[1, 2]),
    rock("volcanic_rock",    "mineral/rock/volcanic", size=[1, 1]),
    rock("obsidian_shard",   "mineral/rock/volcanic", size=[1, 1]),
    rock("pumice_stone",     "mineral/rock/volcanic", size=[1, 1], blocking=False),
    rock("lava_rock",        "mineral/rock/volcanic", size=[1, 1]),
    rock("sandstone_slab",   "mineral/rock/sandstone", size=[1, 1], blocking=False),
    rock("slate_slab",       "mineral/rock/sandstone", size=[1, 1], blocking=False),
    rock("scree",            "mineral/rock/pebble", size=[1, 1], blocking=False),

    # ---- mineral/ore ----
    rock("iron_ore",    "mineral/ore/iron"),
    rock("gold_vein",   "mineral/ore/gold"),
    rock("gem_deposit", "mineral/ore/gem"),
    rock("coal_seam",   "mineral/ore/coal"),

    # ---- mineral/cliff_face ----
    rock("cliff_face",      "mineral/cliff_face", size=[2, 3]),
    rock("rock_overhang",   "mineral/cliff_face", size=[2, 2]),

    # ---- water_feature ----
    water_feature("ocean_wave",      "water_feature/wave"),
    water_feature("lake_ripple",     "water_feature/wave"),
    water_feature("river_current",   "water_feature/wave"),
    water_feature("shore_foam",      "water_feature/foam"),
    water_feature("rapid_foam",      "water_feature/foam"),
    water_feature("whirlpool",       "water_feature/whirlpool"),
    water_feature("waterfall",       "water_feature/waterfall", size=[2, 3]),
    water_feature("trickle",         "water_feature/waterfall", size=[1, 2]),
    water_feature("footstep_splash", "water_feature/splash"),
    water_feature("impact_splash",   "water_feature/splash"),
    water_feature("rain_puddle",     "water_feature/puddle"),
    water_feature("standing_water",  "water_feature/puddle"),
    water_feature("sheet_ice",       "water_feature/ice", size=[1, 1]),
    water_feature("icicle",          "water_feature/ice", size=[1, 2]),
    water_feature("frost_pattern",   "water_feature/ice"),
    water_feature("tidal_pool",      "water_feature/puddle"),

    # ---- ground_cover ----
    ground_cover("autumn_leaves",    "ground_cover/leaf_litter"),
    ground_cover("dry_leaves",       "ground_cover/leaf_litter"),
    ground_cover("wet_leaves",       "ground_cover/leaf_litter"),
    ground_cover("pine_needle_bed",  "ground_cover/pine_needles"),
    ground_cover("wind_sand_drift",  "ground_cover/sand_drift"),
    ground_cover("dune_ripple",      "ground_cover/sand_drift"),
    ground_cover("fresh_snow",       "ground_cover/snow_drift"),
    ground_cover("packed_snow",      "ground_cover/snow_drift"),
    ground_cover("melting_snow",     "ground_cover/snow_drift"),
    ground_cover("wet_mud",          "ground_cover/mud_patch"),
    ground_cover("drying_mud",       "ground_cover/mud_patch"),
    ground_cover("cracked_earth",    "ground_cover/mud_patch"),
    ground_cover("ice_patch",        "ground_cover/ice_sheet"),
    ground_cover("permafrost_crack", "ground_cover/ice_sheet"),
    ground_cover("fresh_ash",        "ground_cover/ash_layer"),
    ground_cover("old_ash",          "ground_cover/ash_layer"),
    ground_cover("gravel_patch",     "ground_cover/gravel"),
    ground_cover("peat_bog",         "ground_cover/peat"),
    ground_cover("stone_dust",       "ground_cover/gravel"),
    ground_cover("sulfur_deposit",   "ground_cover/ash_layer"),

    # ---- structure_natural ----
    structure_natural("fallen_log",      "structure_natural/log", size=[2, 1]),
    structure_natural("hollow_log",      "structure_natural/log", size=[2, 1]),
    structure_natural("mossy_log",       "structure_natural/log", size=[2, 1]),
    structure_natural("driftwood",       "structure_natural/log", size=[1, 1], blocking=False),
    structure_natural("bird_nest",       "structure_natural/nest", size=[1, 1], blocking=False),
    structure_natural("ant_mound",       "structure_natural/nest", size=[1, 1]),
    structure_natural("termite_mound",   "structure_natural/nest", size=[1, 2]),
    structure_natural("burrow_entrance", "structure_natural/nest", size=[1, 1], blocking=False),
    structure_natural("cave_entrance",   "structure_natural/den", size=[2, 2]),
    structure_natural("bear_den",        "structure_natural/den", size=[2, 2]),
    structure_natural("branching_coral", "structure_natural/coral", size=[1, 1]),
    structure_natural("brain_coral",     "structure_natural/coral", size=[1, 1]),
    structure_natural("fan_coral",       "structure_natural/coral", size=[1, 2]),
    structure_natural("conch_shell",     "structure_natural/shell", size=[1, 1], blocking=False),
    structure_natural("clam_shell",      "structure_natural/shell", size=[1, 1], blocking=False),
    structure_natural("shell_scatter",   "structure_natural/shell", size=[1, 1], blocking=False),
    structure_natural("bone_pile",       "structure_natural/bone", size=[1, 1], blocking=False),
    structure_natural("skull",           "structure_natural/bone", size=[1, 1], blocking=False),
    structure_natural("rib_cage",        "structure_natural/bone", size=[1, 1], blocking=False),
    structure_natural("spider_web",      "structure_natural/web", size=[1, 1], blocking=False),
    structure_natural("cocoon",          "structure_natural/web", size=[1, 1], blocking=False),
    structure_natural("beehive",         "structure_natural/hive", size=[1, 1]),
    structure_natural("wasp_nest",       "structure_natural/hive", size=[1, 1]),
    structure_natural("eagle_nest",      "structure_natural/nest", size=[1, 1]),
    structure_natural("crab_burrow",     "structure_natural/nest", size=[1, 1], blocking=False),

    # ---- break products (referenced by other objects, need definitions) ----
    structure_natural("log",          "structure_natural/log", size=[1, 1]),
    structure_natural("branch",       "structure_natural/log", size=[1, 1], blocking=False),
    structure_natural("twig",         "structure_natural/log", size=[1, 1], blocking=False),
    structure_natural("wood_scrap",   "structure_natural/log", size=[1, 1], blocking=False),
    ground_cover("leaf_pile",         "ground_cover/leaf_litter"),
    ground_cover("ash_pile",          "ground_cover/ash_layer"),
    ground_cover("charred_trunk",     "ground_cover/ash_layer"),
    rock("rock_chunk",               "mineral/rock/pebble", size=[1, 1], blocking=False),

    # ---- special/mystic objects ----
    rock("runic_stone",       "mineral/rock/crystal", size=[1, 1]),
    water_feature("mist_pool","water_feature/puddle"),
    flower("spirit_wisp",     "vegetation/flower/wildflower"),

    # ---- stump products (referenced by trees) ----
    structure_natural("oak_tree_stump",     "structure_natural/log", size=[1, 1]),
    structure_natural("birch_tree_stump",   "structure_natural/log", size=[1, 1]),
    structure_natural("maple_tree_stump",   "structure_natural/log", size=[1, 1]),
    structure_natural("pine_tree_stump",    "structure_natural/log", size=[1, 1]),
    structure_natural("spruce_tree_stump",  "structure_natural/log", size=[1, 1]),
    structure_natural("palm_tree_stump",    "structure_natural/log", size=[1, 1]),
]


def main():
    count = 0
    for obj in ALL_OBJECTS:
        # Build path from category
        cat_path = obj["category"].replace("/", os.sep)
        obj_dir = OUT_DIR / cat_path
        obj_dir.mkdir(parents=True, exist_ok=True)
        filepath = obj_dir / f"{obj['id']}.json"
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=2)
        count += 1
    print(f"Generated {count} object definitions in {OUT_DIR}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the generator**

```bash
cd C:/Users/daves/OneDrive/Documents/freedommmo
python tools/terrain_objects/generate_objects.py
```

Expected: `Generated 180+ object definitions in data/terrain_objects/objects`

- [ ] **Step 3: Verify — count files and spot check**

```bash
find data/terrain_objects/objects -name "*.json" | wc -l
cat data/terrain_objects/objects/vegetation/tree/deciduous/oak_tree.json | python -m json.tool | head -20
```

Expected: 180+ files, valid JSON with lifecycle phases and break_products.

- [ ] **Step 4: Commit**

```bash
git add tools/terrain_objects/generate_objects.py data/terrain_objects/objects/
git commit -m "feat(terrain-objects): object definitions generator — 180+ objects with lifecycle/durability"
```

---

## Task 5: Biome Data Generator

**Files:**
- Create: `tools/terrain_objects/generate_biome_data.py`
- Output: `data/terrain_objects/affinities/*.json` (18 files)
- Output: `data/terrain_objects/transitions/*.json` (~50 files)

- [ ] **Step 1: Write the generator script**

Create `tools/terrain_objects/generate_biome_data.py`:

```python
#!/usr/bin/env python3
"""Generate biome affinity and transition JSON files."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
AFF_DIR = ROOT / "data" / "terrain_objects" / "affinities"
TRANS_DIR = ROOT / "data" / "terrain_objects" / "transitions"

# Each entry: (object_id, density, cluster_mode, elev_range, moist_range, slope_max,
#              distance_rules, lifecycle_dist or None, variant_count)

TREE_DIST = {"seedling": 0.05, "sapling": 0.10, "juvenile": 0.15,
             "mature": 0.50, "old_growth": 0.15, "dying": 0.05}
BUSH_DIST = {"seedling": 0.05, "growing": 0.15, "mature": 0.55,
             "flowering": 0.15, "dying": 0.10}
GRASS_DIST = {"sprout": 0.05, "growing": 0.15, "mature": 0.65, "dry": 0.10, "dead": 0.05}
FLOWER_DIST = {"bud": 0.15, "blooming": 0.50, "wilting": 0.20, "seed_head": 0.15}


def pool(obj_id, density, cluster="scatter", elev=None, moist=None,
         slope=0.5, dist_rules=None, lifecycle=None, variants=3):
    entry = {"object_id": obj_id, "density": density, "cluster_mode": cluster}
    if elev:
        entry["elevation_range"] = elev
    if moist:
        entry["moisture_range"] = moist
    entry["slope_max"] = slope
    if dist_rules:
        entry["distance_rules"] = dist_rules
    if lifecycle:
        entry["lifecycle_distribution"] = lifecycle
    entry["variant_count"] = variants
    return entry


BIOME_AFFINITIES = {
    "ocean": {
        "biome_id": "ocean",
        "object_pools": [
            pool("ocean_wave", 0.8, "perlin", variants=4),
            pool("shore_foam", 0.4, "edge_follow", variants=3),
            pool("kelp", 0.15, "perlin", lifecycle=GRASS_DIST),
            pool("saltwater_algae", 0.10, "scatter", lifecycle=GRASS_DIST),
            pool("branching_coral", 0.05, "scatter", elev=[0.0, 0.2]),
            pool("brain_coral", 0.03, "scatter", elev=[0.0, 0.2]),
            pool("fan_coral", 0.02, "scatter", elev=[0.0, 0.15]),
            pool("shell_scatter", 0.05, "scatter"),
            pool("whirlpool", 0.01, "scatter"),
        ],
        "ambient": {"wind_baseline": 0.4, "moisture_baseline": 1.0, "light_filter": None},
    },
    "beach": {
        "biome_id": "beach",
        "object_pools": [
            pool("wind_sand_drift", 0.30, "perlin"),
            pool("dune_ripple", 0.20, "perlin"),
            pool("conch_shell", 0.08, "scatter"),
            pool("clam_shell", 0.06, "scatter"),
            pool("shell_scatter", 0.10, "scatter"),
            pool("driftwood", 0.05, "scatter"),
            pool("crab_burrow", 0.04, "scatter", dist_rules={"max_water": 8}),
            pool("sea_grass", 0.08, "water_follow", dist_rules={"max_water": 3}, lifecycle=GRASS_DIST),
            pool("coconut_palm", 0.03, "scatter", elev=[0.05, 0.3], lifecycle=TREE_DIST),
            pool("tidal_pool", 0.04, "scatter", dist_rules={"max_water": 4}),
        ],
        "ambient": {"wind_baseline": 0.35, "moisture_baseline": 0.6, "light_filter": None},
    },
    "grassland": {
        "biome_id": "grassland",
        "object_pools": [
            pool("tall_grass", 0.45, "perlin", elev=[0.0, 0.5], moist=[0.3, 0.8], lifecycle=GRASS_DIST, variants=5),
            pool("short_grass", 0.35, "perlin", elev=[0.0, 0.6], lifecycle=GRASS_DIST, variants=5),
            pool("meadow_grass", 0.20, "perlin", moist=[0.4, 0.9], lifecycle=GRASS_DIST, variants=4),
            pool("wildflower", 0.15, "scatter", moist=[0.4, 0.9], lifecycle=FLOWER_DIST, variants=6),
            pool("daisy", 0.10, "scatter", lifecycle=FLOWER_DIST, variants=4),
            pool("poppy", 0.05, "scatter", lifecycle=FLOWER_DIST, variants=3),
            pool("dandelion", 0.08, "scatter", lifecycle=FLOWER_DIST),
            pool("flowering_bush", 0.06, "scatter", lifecycle=BUSH_DIST, variants=4),
            pool("berry_bush", 0.03, "scatter", lifecycle=BUSH_DIST),
            pool("flat_rock", 0.04, "scatter", variants=4),
            pool("pebble", 0.06, "scatter", variants=5),
            pool("ant_mound", 0.02, "scatter"),
            pool("bird_nest", 0.01, "scatter"),
            pool("oak_tree", 0.02, "scatter", lifecycle=TREE_DIST),
            pool("birch_tree", 0.01, "scatter", lifecycle=TREE_DIST),
        ],
        "ambient": {"wind_baseline": 0.3, "moisture_baseline": 0.5, "light_filter": None},
    },
    "forest": {
        "biome_id": "forest",
        "object_pools": [
            pool("oak_tree", 0.25, "perlin", lifecycle=TREE_DIST, variants=5),
            pool("birch_tree", 0.15, "perlin", lifecycle=TREE_DIST, variants=4),
            pool("maple_tree", 0.10, "perlin", lifecycle=TREE_DIST, variants=4),
            pool("elm_tree", 0.08, "scatter", lifecycle=TREE_DIST),
            pool("beech_tree", 0.06, "scatter", lifecycle=TREE_DIST),
            pool("flowering_bush", 0.12, "scatter", lifecycle=BUSH_DIST, variants=4),
            pool("berry_bush", 0.06, "scatter", lifecycle=BUSH_DIST),
            pool("forest_fern", 0.15, "scatter", lifecycle=BUSH_DIST, variants=4),
            pool("ground_moss", 0.20, "perlin", lifecycle=GRASS_DIST),
            pool("tree_moss", 0.10, "scatter", lifecycle=GRASS_DIST),
            pool("toadstool", 0.06, "scatter", lifecycle=FLOWER_DIST),
            pool("morel", 0.03, "scatter", lifecycle=FLOWER_DIST),
            pool("fallen_log", 0.05, "scatter", variants=3),
            pool("hollow_log", 0.02, "scatter"),
            pool("mossy_boulder", 0.04, "scatter", variants=3),
            pool("autumn_leaves", 0.15, "perlin"),
            pool("bird_nest", 0.03, "scatter"),
            pool("spider_web", 0.02, "scatter"),
            pool("climbing_vine", 0.04, "scatter", lifecycle=BUSH_DIST),
            pool("wildflower", 0.05, "scatter", lifecycle=FLOWER_DIST),
        ],
        "ambient": {"wind_baseline": 0.15, "moisture_baseline": 0.6, "light_filter": "green_canopy"},
    },
    "dense_forest": {
        "biome_id": "dense_forest",
        "object_pools": [
            pool("oak_tree", 0.30, "perlin", lifecycle=TREE_DIST, variants=5),
            pool("beech_tree", 0.20, "perlin", lifecycle=TREE_DIST, variants=4),
            pool("elm_tree", 0.10, "perlin", lifecycle=TREE_DIST),
            pool("hollow_tree", 0.04, "scatter", lifecycle=TREE_DIST),
            pool("giant_fern", 0.15, "scatter", lifecycle=BUSH_DIST, variants=4),
            pool("forest_fern", 0.20, "scatter", lifecycle=BUSH_DIST),
            pool("hanging_vine", 0.10, "scatter", lifecycle=BUSH_DIST),
            pool("climbing_vine", 0.08, "scatter", lifecycle=BUSH_DIST),
            pool("ground_moss", 0.30, "perlin", lifecycle=GRASS_DIST),
            pool("hanging_moss", 0.12, "scatter", lifecycle=GRASS_DIST),
            pool("tree_moss", 0.15, "scatter", lifecycle=GRASS_DIST),
            pool("bracket_fungus", 0.08, "scatter", lifecycle=FLOWER_DIST),
            pool("toadstool", 0.10, "scatter", lifecycle=FLOWER_DIST),
            pool("glowing_mushroom", 0.03, "scatter", lifecycle=FLOWER_DIST),
            pool("fallen_log", 0.08, "scatter", variants=3),
            pool("mossy_log", 0.05, "scatter"),
            pool("hollow_log", 0.04, "scatter"),
            pool("spider_web", 0.06, "scatter"),
            pool("cocoon", 0.02, "scatter"),
            pool("mossy_boulder", 0.03, "scatter"),
        ],
        "ambient": {"wind_baseline": 0.05, "moisture_baseline": 0.8, "light_filter": "deep_green_canopy"},
    },
    "desert": {
        "biome_id": "desert",
        "object_pools": [
            pool("wind_sand_drift", 0.35, "perlin", variants=4),
            pool("dune_ripple", 0.25, "perlin", variants=3),
            pool("desert_shrub", 0.05, "scatter", lifecycle=BUSH_DIST),
            pool("dry_bush", 0.04, "scatter", lifecycle=BUSH_DIST),
            pool("dry_grass", 0.06, "scatter", lifecycle=GRASS_DIST),
            pool("cactus_flower", 0.02, "scatter", lifecycle=FLOWER_DIST),
            pool("succulent", 0.03, "scatter", lifecycle=FLOWER_DIST),
            pool("sandstone_boulder", 0.03, "scatter", variants=3),
            pool("sandstone_slab", 0.04, "scatter"),
            pool("flat_rock", 0.03, "scatter"),
            pool("skull", 0.01, "scatter"),
            pool("bone_pile", 0.01, "scatter"),
            pool("dead_tree", 0.02, "scatter", lifecycle=TREE_DIST),
        ],
        "ambient": {"wind_baseline": 0.4, "moisture_baseline": 0.05, "light_filter": "heat_haze"},
    },
    "savanna": {
        "biome_id": "savanna",
        "object_pools": [
            pool("tall_grass", 0.35, "perlin", lifecycle=GRASS_DIST, variants=5),
            pool("dry_grass", 0.25, "perlin", lifecycle=GRASS_DIST, variants=4),
            pool("pampas_grass", 0.10, "scatter", lifecycle=GRASS_DIST),
            pool("dry_bush", 0.06, "scatter", lifecycle=BUSH_DIST),
            pool("thorny_bush", 0.04, "scatter", lifecycle=BUSH_DIST),
            pool("flat_rock", 0.05, "scatter", variants=3),
            pool("granite_boulder", 0.02, "scatter"),
            pool("termite_mound", 0.03, "scatter"),
            pool("ant_mound", 0.02, "scatter"),
            pool("bone_pile", 0.01, "scatter"),
            pool("dead_tree", 0.03, "scatter", lifecycle=TREE_DIST),
            pool("poplar_tree", 0.02, "scatter", lifecycle=TREE_DIST),
        ],
        "ambient": {"wind_baseline": 0.3, "moisture_baseline": 0.2, "light_filter": None},
    },
    "steppe": {
        "biome_id": "steppe",
        "object_pools": [
            pool("short_grass", 0.30, "perlin", lifecycle=GRASS_DIST, variants=4),
            pool("dry_grass", 0.25, "perlin", lifecycle=GRASS_DIST, variants=4),
            pool("cracked_earth", 0.15, "perlin"),
            pool("flat_rock", 0.08, "scatter", variants=4),
            pool("slate_slab", 0.05, "scatter"),
            pool("pebble", 0.10, "scatter", variants=5),
            pool("scrub_brush", 0.04, "scatter", lifecycle=BUSH_DIST),
            pool("gravel_patch", 0.08, "scatter"),
            pool("tundra_shrub", 0.03, "scatter", lifecycle=BUSH_DIST),
        ],
        "ambient": {"wind_baseline": 0.45, "moisture_baseline": 0.15, "light_filter": None},
    },
    "tundra": {
        "biome_id": "tundra",
        "object_pools": [
            pool("frozen_grass", 0.20, "perlin", lifecycle=GRASS_DIST, variants=4),
            pool("hardy_moss", 0.15, "perlin", lifecycle=GRASS_DIST),
            pool("lichen_patch", 0.12, "scatter", lifecycle=GRASS_DIST),
            pool("tundra_shrub", 0.05, "scatter", lifecycle=BUSH_DIST),
            pool("ice_patch", 0.10, "perlin"),
            pool("permafrost_crack", 0.08, "scatter"),
            pool("packed_snow", 0.15, "perlin"),
            pool("fresh_snow", 0.10, "scatter"),
            pool("flat_rock", 0.06, "scatter", variants=3),
            pool("pebble", 0.08, "scatter"),
            pool("arctic_poppy", 0.03, "scatter", lifecycle=FLOWER_DIST),
            pool("frozen_grass", 0.05, "scatter", lifecycle=GRASS_DIST),
        ],
        "ambient": {"wind_baseline": 0.5, "moisture_baseline": 0.3, "light_filter": "blue_cold"},
    },
    "taiga": {
        "biome_id": "taiga",
        "object_pools": [
            pool("pine_tree", 0.30, "perlin", lifecycle=TREE_DIST, variants=5),
            pool("spruce_tree", 0.25, "perlin", lifecycle=TREE_DIST, variants=5),
            pool("fir_tree", 0.10, "perlin", lifecycle=TREE_DIST),
            pool("cedar_tree", 0.05, "scatter", lifecycle=TREE_DIST),
            pool("juniper_tree", 0.04, "scatter", lifecycle=TREE_DIST),
            pool("pine_needle_bed", 0.25, "perlin", variants=3),
            pool("ground_moss", 0.12, "perlin", lifecycle=GRASS_DIST),
            pool("hardy_moss", 0.08, "scatter", lifecycle=GRASS_DIST),
            pool("packed_snow", 0.10, "perlin"),
            pool("fresh_snow", 0.05, "scatter"),
            pool("fallen_log", 0.04, "scatter"),
            pool("bear_den", 0.01, "scatter"),
            pool("mossy_boulder", 0.03, "scatter"),
        ],
        "ambient": {"wind_baseline": 0.2, "moisture_baseline": 0.5, "light_filter": "pine_filter"},
    },
    "mountains": {
        "biome_id": "mountains",
        "object_pools": [
            pool("granite_boulder", 0.15, "perlin", variants=4),
            pool("basalt_boulder", 0.08, "scatter", variants=3),
            pool("cliff_face", 0.05, "scatter", elev=[0.6, 1.0]),
            pool("rock_overhang", 0.03, "scatter", elev=[0.5, 0.9]),
            pool("scree", 0.15, "perlin", slope=0.8),
            pool("pebble", 0.10, "scatter", variants=5),
            pool("gravel_patch", 0.08, "scatter"),
            pool("hardy_moss", 0.04, "scatter", lifecycle=GRASS_DIST),
            pool("lichen_patch", 0.06, "scatter", lifecycle=GRASS_DIST),
            pool("wildflower", 0.03, "scatter", lifecycle=FLOWER_DIST),
            pool("eagle_nest", 0.01, "scatter", elev=[0.7, 1.0]),
            pool("cave_entrance", 0.01, "scatter", elev=[0.4, 0.8]),
            pool("iron_ore", 0.02, "scatter", elev=[0.4, 0.9]),
            pool("gold_vein", 0.005, "scatter", elev=[0.5, 1.0]),
            pool("gem_deposit", 0.003, "scatter", elev=[0.6, 1.0]),
            pool("fresh_snow", 0.10, "perlin", elev=[0.8, 1.0]),
            pool("packed_snow", 0.08, "perlin", elev=[0.7, 1.0]),
        ],
        "ambient": {"wind_baseline": 0.6, "moisture_baseline": 0.3, "light_filter": None},
    },
    "swamp": {
        "biome_id": "swamp",
        "object_pools": [
            pool("reed", 0.20, "perlin", lifecycle=GRASS_DIST, variants=4),
            pool("cattail", 0.15, "water_follow", lifecycle=GRASS_DIST, variants=3),
            pool("bulrush", 0.08, "water_follow", lifecycle=GRASS_DIST),
            pool("hanging_moss", 0.20, "perlin", lifecycle=GRASS_DIST),
            pool("algae_film", 0.15, "perlin", lifecycle=GRASS_DIST),
            pool("freshwater_algae", 0.10, "water_follow", lifecycle=GRASS_DIST),
            pool("willow_tree", 0.08, "scatter", lifecycle=TREE_DIST, variants=3),
            pool("mangrove_tree", 0.05, "water_follow", lifecycle=TREE_DIST),
            pool("dead_tree", 0.06, "scatter", lifecycle=TREE_DIST),
            pool("toadstool", 0.10, "scatter", lifecycle=FLOWER_DIST, variants=4),
            pool("glowing_mushroom", 0.04, "scatter", lifecycle=FLOWER_DIST),
            pool("puffball", 0.03, "scatter", lifecycle=FLOWER_DIST),
            pool("wet_mud", 0.15, "perlin"),
            pool("peat_bog", 0.10, "perlin"),
            pool("standing_water", 0.12, "perlin"),
            pool("fallen_log", 0.05, "scatter"),
            pool("mossy_log", 0.04, "scatter"),
        ],
        "ambient": {"wind_baseline": 0.1, "moisture_baseline": 0.9, "light_filter": "murky_green"},
    },
    "tropical_forest": {
        "biome_id": "tropical_forest",
        "object_pools": [
            pool("jungle_tree", 0.25, "perlin", lifecycle=TREE_DIST, variants=5),
            pool("kapok_tree", 0.08, "scatter", lifecycle=TREE_DIST),
            pool("palm_tree", 0.10, "scatter", lifecycle=TREE_DIST, variants=4),
            pool("banana_tree", 0.06, "scatter", lifecycle=TREE_DIST),
            pool("tropical_fern", 0.15, "scatter", lifecycle=BUSH_DIST, variants=4),
            pool("giant_fern", 0.08, "scatter", lifecycle=BUSH_DIST),
            pool("hanging_vine", 0.15, "scatter", lifecycle=BUSH_DIST),
            pool("climbing_vine", 0.10, "scatter", lifecycle=BUSH_DIST),
            pool("orchid", 0.06, "scatter", lifecycle=FLOWER_DIST),
            pool("hibiscus", 0.05, "scatter", lifecycle=FLOWER_DIST),
            pool("lotus", 0.03, "water_follow", lifecycle=FLOWER_DIST),
            pool("ground_moss", 0.15, "perlin", lifecycle=GRASS_DIST),
            pool("tree_moss", 0.10, "scatter", lifecycle=GRASS_DIST),
            pool("wet_leaves", 0.10, "perlin"),
            pool("cocoon", 0.03, "scatter"),
            pool("bird_nest", 0.04, "scatter"),
        ],
        "ambient": {"wind_baseline": 0.1, "moisture_baseline": 0.9, "light_filter": "tropical_canopy"},
    },
    "volcanic": {
        "biome_id": "volcanic",
        "object_pools": [
            pool("volcanic_rock", 0.20, "perlin", variants=4),
            pool("lava_rock", 0.15, "perlin", variants=3),
            pool("obsidian_shard", 0.08, "scatter", variants=3),
            pool("pumice_stone", 0.06, "scatter"),
            pool("fresh_ash", 0.20, "perlin"),
            pool("old_ash", 0.10, "perlin"),
            pool("sulfur_deposit", 0.05, "scatter"),
            pool("charred_tree", 0.04, "scatter", lifecycle=TREE_DIST),
            pool("cracked_earth", 0.10, "perlin"),
            pool("basalt_boulder", 0.06, "scatter", variants=3),
            pool("coal_seam", 0.02, "scatter"),
        ],
        "ambient": {"wind_baseline": 0.2, "moisture_baseline": 0.1, "light_filter": "ember_glow"},
    },
    "arctic": {
        "biome_id": "arctic",
        "object_pools": [
            pool("sheet_ice", 0.25, "perlin", variants=3),
            pool("fresh_snow", 0.30, "perlin", variants=4),
            pool("packed_snow", 0.20, "perlin", variants=3),
            pool("melting_snow", 0.05, "scatter"),
            pool("frost_pattern", 0.10, "perlin"),
            pool("icicle", 0.05, "scatter"),
            pool("ice_patch", 0.12, "perlin"),
            pool("crystal_cluster", 0.02, "scatter"),
            pool("amethyst_geode", 0.01, "scatter"),
        ],
        "ambient": {"wind_baseline": 0.7, "moisture_baseline": 0.2, "light_filter": "arctic_blue"},
    },
    "lake": {
        "biome_id": "lake",
        "object_pools": [
            pool("lake_ripple", 0.60, "perlin", variants=4),
            pool("reed", 0.10, "edge_follow", lifecycle=GRASS_DIST, variants=3),
            pool("cattail", 0.06, "edge_follow", lifecycle=GRASS_DIST),
            pool("river_stone", 0.08, "scatter", variants=4),
            pool("pebble", 0.10, "scatter", variants=5),
            pool("freshwater_algae", 0.05, "scatter", lifecycle=GRASS_DIST),
            pool("lotus", 0.03, "scatter", lifecycle=FLOWER_DIST),
            pool("standing_water", 0.10, "perlin"),
            pool("fallen_log", 0.02, "scatter"),
        ],
        "ambient": {"wind_baseline": 0.2, "moisture_baseline": 0.95, "light_filter": None},
    },
    "river": {
        "biome_id": "river",
        "object_pools": [
            pool("river_current", 0.70, "perlin", variants=4),
            pool("river_stone", 0.10, "scatter", variants=4),
            pool("river_weed", 0.08, "scatter", lifecycle=GRASS_DIST),
            pool("reed", 0.06, "edge_follow", lifecycle=GRASS_DIST),
            pool("rapid_foam", 0.05, "scatter", variants=3),
            pool("driftwood", 0.03, "scatter"),
            pool("pebble", 0.08, "scatter", variants=5),
        ],
        "ambient": {"wind_baseline": 0.15, "moisture_baseline": 1.0, "light_filter": None},
    },
    "mystic": {
        "biome_id": "mystic",
        "object_pools": [
            pool("mystic_crystal", 0.15, "perlin", variants=4),
            pool("crystal_cluster", 0.10, "scatter", variants=3),
            pool("quartz_formation", 0.05, "scatter"),
            pool("runic_stone", 0.04, "scatter"),
            pool("glowing_mushroom", 0.12, "scatter", lifecycle=FLOWER_DIST, variants=5),
            pool("spirit_wisp", 0.08, "scatter", lifecycle=FLOWER_DIST),
            pool("arcane_flower", 0.06, "scatter", lifecycle=FLOWER_DIST),
            pool("ethereal_vine", 0.08, "scatter", lifecycle=BUSH_DIST),
            pool("ground_moss", 0.10, "perlin", lifecycle=GRASS_DIST),
            pool("mist_pool", 0.05, "scatter"),
        ],
        "ambient": {"wind_baseline": 0.1, "moisture_baseline": 0.5, "light_filter": "mystic_glow"},
    },
}


# Biome transitions — valid neighbor pairs with edge objects and blend rules
TRANSITIONS = [
    # Water boundaries
    {"biome_a": "beach", "biome_b": "ocean", "blend_width": 3,
     "edge_objects": [
         {"object_id": "shore_foam", "density": 0.8},
         {"object_id": "tidal_pool", "density": 0.1},
         {"object_id": "sea_grass", "density": 0.15},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "hard_cutoff"}},

    {"biome_a": "beach", "biome_b": "grassland", "blend_width": 4,
     "edge_objects": [
         {"object_id": "dry_grass", "density": 0.2},
         {"object_id": "wind_sand_drift", "density": 0.15},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "beach", "biome_b": "tropical_forest", "blend_width": 3,
     "edge_objects": [
         {"object_id": "coconut_palm", "density": 0.15},
         {"object_id": "sea_grass", "density": 0.1},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "grassland", "biome_b": "forest", "blend_width": 4,
     "edge_objects": [
         {"object_id": "birch_tree", "density": 0.08},
         {"object_id": "flowering_bush", "density": 0.12},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "grassland", "biome_b": "savanna", "blend_width": 5,
     "edge_objects": [
         {"object_id": "dry_grass", "density": 0.2},
         {"object_id": "thorny_bush", "density": 0.05},
     ],
     "gradient": {"biome_a_objects": "noise_blend", "biome_b_objects": "noise_blend"}},

    {"biome_a": "grassland", "biome_b": "steppe", "blend_width": 5,
     "edge_objects": [
         {"object_id": "short_grass", "density": 0.15},
         {"object_id": "flat_rock", "density": 0.05},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "forest", "biome_b": "dense_forest", "blend_width": 3,
     "edge_objects": [
         {"object_id": "giant_fern", "density": 0.1},
         {"object_id": "hanging_vine", "density": 0.08},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "forest", "biome_b": "swamp", "blend_width": 4,
     "edge_objects": [
         {"object_id": "dead_tree", "density": 0.08},
         {"object_id": "wet_mud", "density": 0.15},
         {"object_id": "algae_film", "density": 0.1},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "forest", "biome_b": "mountains", "blend_width": 4,
     "edge_objects": [
         {"object_id": "scree", "density": 0.1},
         {"object_id": "hardy_moss", "density": 0.08},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "forest", "biome_b": "taiga", "blend_width": 4,
     "edge_objects": [
         {"object_id": "pine_tree", "density": 0.08},
         {"object_id": "pine_needle_bed", "density": 0.1},
     ],
     "gradient": {"biome_a_objects": "noise_blend", "biome_b_objects": "noise_blend"}},

    {"biome_a": "savanna", "biome_b": "desert", "blend_width": 5,
     "edge_objects": [
         {"object_id": "dry_bush", "density": 0.06},
         {"object_id": "cracked_earth", "density": 0.1},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "steppe", "biome_b": "desert", "blend_width": 4,
     "edge_objects": [
         {"object_id": "cracked_earth", "density": 0.12},
         {"object_id": "wind_sand_drift", "density": 0.08},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "steppe", "biome_b": "tundra", "blend_width": 4,
     "edge_objects": [
         {"object_id": "frozen_grass", "density": 0.1},
         {"object_id": "ice_patch", "density": 0.05},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "tundra", "biome_b": "arctic", "blend_width": 3,
     "edge_objects": [
         {"object_id": "packed_snow", "density": 0.15},
         {"object_id": "frost_pattern", "density": 0.1},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "tundra", "biome_b": "taiga", "blend_width": 4,
     "edge_objects": [
         {"object_id": "juniper_tree", "density": 0.05},
         {"object_id": "hardy_moss", "density": 0.1},
     ],
     "gradient": {"biome_a_objects": "noise_blend", "biome_b_objects": "noise_blend"}},

    {"biome_a": "taiga", "biome_b": "mountains", "blend_width": 3,
     "edge_objects": [
         {"object_id": "scree", "density": 0.1},
         {"object_id": "lichen_patch", "density": 0.08},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "mountains", "biome_b": "arctic", "blend_width": 3,
     "edge_objects": [
         {"object_id": "fresh_snow", "density": 0.2},
         {"object_id": "icicle", "density": 0.05},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "mountains", "biome_b": "volcanic", "blend_width": 3,
     "edge_objects": [
         {"object_id": "basalt_boulder", "density": 0.08},
         {"object_id": "sulfur_deposit", "density": 0.05},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "swamp", "biome_b": "tropical_forest", "blend_width": 4,
     "edge_objects": [
         {"object_id": "mangrove_tree", "density": 0.08},
         {"object_id": "hanging_moss", "density": 0.12},
     ],
     "gradient": {"biome_a_objects": "noise_blend", "biome_b_objects": "noise_blend"}},

    {"biome_a": "grassland", "biome_b": "lake", "blend_width": 3,
     "edge_objects": [
         {"object_id": "reed", "density": 0.15},
         {"object_id": "pebble", "density": 0.1},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "hard_cutoff"}},

    {"biome_a": "forest", "biome_b": "lake", "blend_width": 3,
     "edge_objects": [
         {"object_id": "reed", "density": 0.1},
         {"object_id": "mossy_boulder", "density": 0.05},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "hard_cutoff"}},

    {"biome_a": "grassland", "biome_b": "river", "blend_width": 2,
     "edge_objects": [
         {"object_id": "reed", "density": 0.1},
         {"object_id": "river_stone", "density": 0.08},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "hard_cutoff"}},

    {"biome_a": "forest", "biome_b": "river", "blend_width": 2,
     "edge_objects": [
         {"object_id": "mossy_boulder", "density": 0.05},
         {"object_id": "fallen_log", "density": 0.03},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "hard_cutoff"}},

    {"biome_a": "grassland", "biome_b": "mystic", "blend_width": 4,
     "edge_objects": [
         {"object_id": "glowing_mushroom", "density": 0.05},
         {"object_id": "arcane_flower", "density": 0.03},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "noise_blend"}},

    {"biome_a": "forest", "biome_b": "mystic", "blend_width": 4,
     "edge_objects": [
         {"object_id": "glowing_mushroom", "density": 0.08},
         {"object_id": "ethereal_vine", "density": 0.06},
         {"object_id": "mist_pool", "density": 0.03},
     ],
     "gradient": {"biome_a_objects": "noise_blend", "biome_b_objects": "noise_blend"}},

    {"biome_a": "dense_forest", "biome_b": "swamp", "blend_width": 4,
     "edge_objects": [
         {"object_id": "wet_mud", "density": 0.12},
         {"object_id": "hanging_moss", "density": 0.15},
         {"object_id": "dead_tree", "density": 0.05},
     ],
     "gradient": {"biome_a_objects": "noise_blend", "biome_b_objects": "noise_blend"}},

    {"biome_a": "desert", "biome_b": "volcanic", "blend_width": 3,
     "edge_objects": [
         {"object_id": "lava_rock", "density": 0.08},
         {"object_id": "fresh_ash", "density": 0.1},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "tropical_forest", "biome_b": "ocean", "blend_width": 2,
     "edge_objects": [
         {"object_id": "mangrove_tree", "density": 0.1},
         {"object_id": "shore_foam", "density": 0.4},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "hard_cutoff"}},

    {"biome_a": "desert", "biome_b": "mountains", "blend_width": 3,
     "edge_objects": [
         {"object_id": "sandstone_boulder", "density": 0.08},
         {"object_id": "scree", "density": 0.1},
     ],
     "gradient": {"biome_a_objects": "linear_fadeout", "biome_b_objects": "linear_fadein"}},

    {"biome_a": "lake", "biome_b": "river", "blend_width": 2,
     "edge_objects": [
         {"object_id": "river_stone", "density": 0.08},
         {"object_id": "rapid_foam", "density": 0.05},
     ],
     "gradient": {"biome_a_objects": "noise_blend", "biome_b_objects": "noise_blend"}},
]


def main():
    AFF_DIR.mkdir(parents=True, exist_ok=True)
    TRANS_DIR.mkdir(parents=True, exist_ok=True)

    aff_count = 0
    for biome_id, data in BIOME_AFFINITIES.items():
        filepath = AFF_DIR / f"{biome_id}.json"
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        aff_count += 1

    trans_count = 0
    for t in TRANSITIONS:
        name = f"{t['biome_a']}_{t['biome_b']}"
        filepath = TRANS_DIR / f"{name}.json"
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(t, f, indent=2)
        trans_count += 1

    print(f"Generated {aff_count} affinity files in {AFF_DIR}")
    print(f"Generated {trans_count} transition files in {TRANS_DIR}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the generator**

```bash
python tools/terrain_objects/generate_biome_data.py
```

Expected: `Generated 18 affinity files` + `Generated 30 transition files`

- [ ] **Step 3: Verify — spot check grassland affinity**

```bash
python -c "import json; d=json.load(open('data/terrain_objects/affinities/grassland.json')); print(len(d['object_pools']), 'pools')"
```

Expected: `15 pools`

- [ ] **Step 4: Commit**

```bash
git add tools/terrain_objects/generate_biome_data.py data/terrain_objects/affinities/ data/terrain_objects/transitions/
git commit -m "feat(terrain-objects): biome affinity + transition generators — 18 biomes, 30 transitions"
```

---

## Task 6: Data Validation Script

**Files:**
- Create: `tools/terrain_objects/validate_data.py`

- [ ] **Step 1: Write the validation script**

Create `tools/terrain_objects/validate_data.py`:

```python
#!/usr/bin/env python3
"""Validate all terrain object data files for schema compliance and referential integrity."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT / "data" / "terrain_objects"

errors: list[str] = []
warnings: list[str] = []


def load_all_json(subdir: str) -> dict[str, dict]:
    """Load all JSON files under a subdirectory, keyed by relative path."""
    results = {}
    base = DATA_DIR / subdir
    if not base.exists():
        errors.append(f"Directory not found: {base}")
        return results
    for f in base.rglob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            key = str(f.relative_to(base))
            results[key] = data
        except json.JSONDecodeError as e:
            errors.append(f"Invalid JSON in {f}: {e}")
    return results


def validate_objects(objects: dict, interaction_ids: set[str]):
    """Validate object definitions."""
    object_ids = set()
    for path, obj in objects.items():
        oid = obj.get("id")
        if not oid:
            errors.append(f"{path}: missing 'id'")
            continue
        if oid in object_ids:
            errors.append(f"{path}: duplicate object id '{oid}'")
        object_ids.add(oid)

        ontology = obj.get("ontology")
        if ontology not in ("animate", "inanimate"):
            errors.append(f"{path}: invalid ontology '{ontology}'")

        if ontology == "animate":
            lc = obj.get("lifecycle")
            if not lc:
                errors.append(f"{path}: animate object missing lifecycle")
            else:
                phases = {p["id"] for p in lc.get("phases", [])}
                pi = lc.get("phase_interactions", {})
                for phase, ints in pi.items():
                    if phase not in phases:
                        errors.append(f"{path}: phase_interactions references unknown phase '{phase}'")
                    for i in ints:
                        if i not in interaction_ids:
                            warnings.append(f"{path}: phase '{phase}' references unknown interaction '{i}'")

        if ontology == "inanimate" and obj.get("interactions"):
            for i in obj["interactions"]:
                if i not in interaction_ids:
                    warnings.append(f"{path}: references unknown interaction '{i}'")

    return object_ids


def validate_affinities(affinities: dict, object_ids: set[str]):
    """Validate biome affinity files."""
    for path, aff in affinities.items():
        biome = aff.get("biome_id")
        if not biome:
            errors.append(f"{path}: missing biome_id")
        for pool in aff.get("object_pools", []):
            oid = pool.get("object_id")
            if oid not in object_ids:
                warnings.append(f"{path}: references unknown object '{oid}'")
            density = pool.get("density", 0)
            if not 0 <= density <= 1:
                errors.append(f"{path}: object '{oid}' has invalid density {density}")


def validate_transitions(transitions: dict, biome_ids: set[str], object_ids: set[str]):
    """Validate biome transition files."""
    for path, t in transitions.items():
        for key in ("biome_a", "biome_b"):
            biome = t.get(key)
            if biome and biome not in biome_ids:
                warnings.append(f"{path}: references unknown biome '{biome}'")
        for eo in t.get("edge_objects", []):
            oid = eo.get("object_id")
            if oid not in object_ids:
                warnings.append(f"{path}: edge_object references unknown object '{oid}'")


def main():
    print("Loading data files...")
    interactions = load_all_json("interactions")
    objects = load_all_json("objects")
    affinities = load_all_json("affinities")
    transitions = load_all_json("transitions")

    print(f"  {len(interactions)} interactions, {len(objects)} objects, "
          f"{len(affinities)} affinities, {len(transitions)} transitions")

    # Collect IDs
    interaction_ids = {v["id"] for v in interactions.values() if "id" in v}
    print(f"  {len(interaction_ids)} unique interaction IDs")

    # Validate
    print("\nValidating objects...")
    object_ids = validate_objects(objects, interaction_ids)
    print(f"  {len(object_ids)} unique object IDs")

    print("Validating affinities...")
    biome_ids = {v["biome_id"] for v in affinities.values() if "biome_id" in v}
    validate_affinities(affinities, object_ids)

    print("Validating transitions...")
    validate_transitions(transitions, biome_ids, object_ids)

    # Report
    print(f"\n{'='*60}")
    if errors:
        print(f"ERRORS ({len(errors)}):")
        for e in errors:
            print(f"  [ERROR] {e}")
    if warnings:
        print(f"WARNINGS ({len(warnings)}):")
        for w in warnings:
            print(f"  [WARN]  {w}")
    if not errors and not warnings:
        print("ALL CHECKS PASSED")

    print(f"{'='*60}")
    print(f"Summary: {len(errors)} errors, {len(warnings)} warnings")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run validation**

```bash
python tools/terrain_objects/validate_data.py
```

Expected: 0 errors, possibly some warnings for edge objects not yet defined as standalone objects. Fix any errors found.

- [ ] **Step 3: Fix any referential integrity issues**

If warnings show missing object references (e.g., `sea_grass` referenced in beach affinity but defined as a grass with different id), update the generators and re-run until clean.

- [ ] **Step 4: Commit**

```bash
git add tools/terrain_objects/validate_data.py
git commit -m "feat(terrain-objects): data validation script — schema + referential integrity checks"
```

---

## Task 7: ObjectInstance Data Class

**Files:**
- Create: `scripts/core/terrain_objects/object_instance.gd`

- [ ] **Step 1: Write ObjectInstance**

Create `scripts/core/terrain_objects/object_instance.gd`:

```gdscript
class_name ObjectInstance
extends RefCounted

## Data class for a placed terrain object in the world.
## Holds both deterministic baseline data and mutable runtime state.

# --- Identity (deterministic from world_seed + position) ---
var object_id: String
var instance_seed: int
var position: Vector2i  # world tile coordinates
var variant: int
var category: String

# --- Lifecycle/durability state ---
var ontology: String  # "animate" or "inanimate"
var lifecycle_phase: String  # current phase id (animate only)
var phase_progress: float  # 0-1 progress through current phase
var current_hp: int  # durability HP (inanimate) or lifecycle health (animate)
var durability_stage: String  # current stage id (inanimate only)

# --- Individuality (derived from instance_seed) ---
var ind_scale: float
var ind_lean_angle: float
var ind_color_shift: float

# --- Runtime mutable state ---
var current_state: String  # "alive", "burning", "frozen", "chopped_stump", etc.
var active_effects: Array[String]

# --- Rendering ---
var size: Vector2i  # tiles wide x tall
var blocking: bool
var anchor: String
var pixel_size: int


static func from_placement(obj_def: Dictionary, pos: Vector2i, seed_val: int,
		phase: String, var_idx: int) -> ObjectInstance:
	var inst = ObjectInstance.new()
	inst.object_id = obj_def.get("id", "")
	inst.instance_seed = seed_val
	inst.position = pos
	inst.variant = var_idx
	inst.category = obj_def.get("category", "")
	inst.ontology = obj_def.get("ontology", "inanimate")
	inst.lifecycle_phase = phase
	inst.phase_progress = 0.0
	inst.current_state = "alive"
	inst.active_effects = []

	# Size may vary by lifecycle phase
	var size_arr = obj_def.get("size", [1, 1])
	if inst.ontology == "animate":
		var lifecycle = obj_def.get("lifecycle", {})
		var phases = lifecycle.get("phases", [])
		for p in phases:
			if p.get("id", "") == phase:
				size_arr = p.get("size", size_arr)
				break
	inst.size = Vector2i(size_arr[0], size_arr[1])
	inst.blocking = obj_def.get("blocking", false)
	inst.anchor = obj_def.get("anchor", "bottom_center")
	inst.pixel_size = obj_def.get("pixel_size", 32)

	# Durability
	if inst.ontology == "inanimate":
		var dur = obj_def.get("durability")
		if dur != null and dur is Dictionary:
			inst.current_hp = dur.get("hp", 100)
			var stages = dur.get("stages", [])
			if stages.size() > 0:
				inst.durability_stage = stages[0].get("id", "intact")
		else:
			inst.current_hp = 100
			inst.durability_stage = "intact"
	else:
		inst.current_hp = 100
		inst.durability_stage = ""

	# Individuality from seed
	var rng = RandomNumberGenerator.new()
	rng.seed = seed_val
	var variance = obj_def.get("variance", {})
	var scale_range = variance.get("scale_variance", [0.9, 1.1])
	inst.ind_scale = rng.randf_range(scale_range[0], scale_range[1])
	var lean_range = variance.get("lean_angle", [-3, 3])
	inst.ind_lean_angle = rng.randf_range(lean_range[0], lean_range[1])
	var color_range = variance.get("color_shift", [-5, 5])
	inst.ind_color_shift = rng.randf_range(color_range[0], color_range[1])

	return inst


func to_delta() -> Dictionary:
	return {
		"position": [position.x, position.y],
		"object_id": object_id,
		"current_state": current_state,
		"current_hp": current_hp,
		"lifecycle_phase": lifecycle_phase,
		"phase_progress": phase_progress,
		"durability_stage": durability_stage,
		"active_effects": active_effects,
	}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/terrain_objects/object_instance.gd
git commit -m "feat(terrain-objects): ObjectInstance data class"
```

---

## Task 8: ObjectCatalog + InteractionRegistry + BiomeAffinity Loaders

**Files:**
- Create: `scripts/core/terrain_objects/object_catalog.gd`
- Create: `scripts/core/terrain_objects/interaction_registry.gd`
- Create: `scripts/core/terrain_objects/biome_affinity.gd`

- [ ] **Step 1: Write ObjectCatalog**

Create `scripts/core/terrain_objects/object_catalog.gd`:

```gdscript
class_name ObjectCatalog
extends RefCounted

## Loads and indexes all object definitions from data/terrain_objects/objects/.
## Provides lookup by id and category prefix.

var _objects: Dictionary = {}  # id -> Dictionary
var _by_category: Dictionary = {}  # category_prefix -> [id, ...]

const DATA_PATH = "res://data/terrain_objects/objects"


func _init():
	_load_all()


func _load_all() -> void:
	_scan_dir(DATA_PATH)
	print("[ObjectCatalog] Loaded %d objects across %d categories" % [_objects.size(), _by_category.size()])


func _scan_dir(path: String) -> void:
	var dir = DirAccess.open(path)
	if dir == null:
		push_warning("[ObjectCatalog] Cannot open: %s" % path)
		return
	dir.list_dir_begin()
	var file_name = dir.get_next()
	while file_name != "":
		var full_path = path + "/" + file_name
		if dir.current_is_dir() and not file_name.begins_with("."):
			_scan_dir(full_path)
		elif file_name.ends_with(".json"):
			_load_file(full_path)
		file_name = dir.get_next()
	dir.list_dir_end()


func _load_file(path: String) -> void:
	var file = FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_warning("[ObjectCatalog] Cannot read: %s" % path)
		return
	var text = file.get_as_text()
	file.close()
	var json = JSON.new()
	var err = json.parse(text)
	if err != OK:
		push_warning("[ObjectCatalog] JSON parse error in %s: %s" % [path, json.get_error_message()])
		return
	var data = json.get_data()
	var obj_id = data.get("id", "")
	if obj_id == "":
		push_warning("[ObjectCatalog] No id in %s" % path)
		return
	_objects[obj_id] = data
	# Index by category
	var cat = data.get("category", "")
	if cat != "":
		# Index at each level: "vegetation", "vegetation/tree", "vegetation/tree/deciduous"
		var parts = cat.split("/")
		var prefix = ""
		for p in parts:
			prefix = p if prefix == "" else prefix + "/" + p
			if not _by_category.has(prefix):
				_by_category[prefix] = []
			_by_category[prefix].append(obj_id)


func get_object(id: String) -> Dictionary:
	return _objects.get(id, {})


func get_by_category(prefix: String) -> Array:
	return _by_category.get(prefix, [])


func has_object(id: String) -> bool:
	return _objects.has(id)


func get_all_ids() -> Array:
	return _objects.keys()


func get_interactions_for(id: String, phase: String = "") -> Array:
	var obj = _objects.get(id, {})
	if obj.is_empty():
		return []
	if obj.get("ontology", "") == "animate" and phase != "":
		var lifecycle = obj.get("lifecycle", {})
		var pi = lifecycle.get("phase_interactions", {})
		return pi.get(phase, [])
	return obj.get("interactions", [])
```

- [ ] **Step 2: Write InteractionRegistry**

Create `scripts/core/terrain_objects/interaction_registry.gd`:

```gdscript
class_name InteractionRegistry
extends RefCounted

## Loads and indexes all interaction definitions from data/terrain_objects/interactions/.

var _interactions: Dictionary = {}  # id -> Dictionary
var _by_category: Dictionary = {}  # category -> [id, ...]

const DATA_PATH = "res://data/terrain_objects/interactions"


func _init():
	_load_all()


func _load_all() -> void:
	_scan_dir(DATA_PATH)
	print("[InteractionRegistry] Loaded %d interactions across %d categories" % [
		_interactions.size(), _by_category.size()])


func _scan_dir(path: String) -> void:
	var dir = DirAccess.open(path)
	if dir == null:
		push_warning("[InteractionRegistry] Cannot open: %s" % path)
		return
	dir.list_dir_begin()
	var file_name = dir.get_next()
	while file_name != "":
		var full_path = path + "/" + file_name
		if dir.current_is_dir() and not file_name.begins_with("."):
			_scan_dir(full_path)
		elif file_name.ends_with(".json"):
			_load_file(full_path)
		file_name = dir.get_next()
	dir.list_dir_end()


func _load_file(path: String) -> void:
	var file = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return
	var text = file.get_as_text()
	file.close()
	var json = JSON.new()
	if json.parse(text) != OK:
		return
	var data = json.get_data()
	var int_id = data.get("id", "")
	if int_id == "":
		return
	_interactions[int_id] = data
	var cat = data.get("category", "")
	if not _by_category.has(cat):
		_by_category[cat] = []
	_by_category[cat].append(int_id)


func get_interaction(id: String) -> Dictionary:
	return _interactions.get(id, {})


func get_by_category(category: String) -> Array:
	return _by_category.get(category, [])


func get_animation_spec(id: String) -> Dictionary:
	var interaction = _interactions.get(id, {})
	return interaction.get("animation", {})


func get_effects(id: String) -> Dictionary:
	var interaction = _interactions.get(id, {})
	return interaction.get("effects", {})
```

- [ ] **Step 3: Write BiomeAffinity**

Create `scripts/core/terrain_objects/biome_affinity.gd`:

```gdscript
class_name BiomeAffinityLoader
extends RefCounted

## Loads biome affinity and transition data.

var _affinities: Dictionary = {}  # biome_id -> Dictionary
var _transitions: Dictionary = {}  # "biomeA_biomeB" -> Dictionary

const AFF_PATH = "res://data/terrain_objects/affinities"
const TRANS_PATH = "res://data/terrain_objects/transitions"


func _init():
	_load_affinities()
	_load_transitions()


func _load_affinities() -> void:
	var dir = DirAccess.open(AFF_PATH)
	if dir == null:
		push_warning("[BiomeAffinity] Cannot open: %s" % AFF_PATH)
		return
	dir.list_dir_begin()
	var file_name = dir.get_next()
	while file_name != "":
		if file_name.ends_with(".json"):
			var path = AFF_PATH + "/" + file_name
			var data = _load_json(path)
			if not data.is_empty():
				var biome_id = data.get("biome_id", "")
				if biome_id != "":
					_affinities[biome_id] = data
		file_name = dir.get_next()
	dir.list_dir_end()
	print("[BiomeAffinity] Loaded %d biome affinities" % _affinities.size())


func _load_transitions() -> void:
	var dir = DirAccess.open(TRANS_PATH)
	if dir == null:
		push_warning("[BiomeAffinity] Cannot open: %s" % TRANS_PATH)
		return
	dir.list_dir_begin()
	var file_name = dir.get_next()
	while file_name != "":
		if file_name.ends_with(".json"):
			var path = TRANS_PATH + "/" + file_name
			var data = _load_json(path)
			if not data.is_empty():
				var key = "%s_%s" % [data.get("biome_a", ""), data.get("biome_b", "")]
				_transitions[key] = data
		file_name = dir.get_next()
	dir.list_dir_end()
	print("[BiomeAffinity] Loaded %d biome transitions" % _transitions.size())


func _load_json(path: String) -> Dictionary:
	var file = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {}
	var text = file.get_as_text()
	file.close()
	var json = JSON.new()
	if json.parse(text) != OK:
		return {}
	return json.get_data()


func get_affinity(biome_id: String) -> Dictionary:
	return _affinities.get(biome_id, {})


func get_object_pools(biome_id: String) -> Array:
	var aff = _affinities.get(biome_id, {})
	return aff.get("object_pools", [])


func get_transition(biome_a: String, biome_b: String) -> Dictionary:
	# Check both orderings
	var key1 = "%s_%s" % [biome_a, biome_b]
	var key2 = "%s_%s" % [biome_b, biome_a]
	if _transitions.has(key1):
		return _transitions[key1]
	if _transitions.has(key2):
		return _transitions[key2]
	return {}


func get_ambient(biome_id: String) -> Dictionary:
	var aff = _affinities.get(biome_id, {})
	return aff.get("ambient", {})
```

- [ ] **Step 4: Commit**

```bash
git add scripts/core/terrain_objects/object_catalog.gd scripts/core/terrain_objects/interaction_registry.gd scripts/core/terrain_objects/biome_affinity.gd
git commit -m "feat(terrain-objects): data loaders — ObjectCatalog, InteractionRegistry, BiomeAffinity"
```

---

## Task 9: Placement Engine

**Files:**
- Create: `scripts/core/terrain_objects/placement_engine.gd`

- [ ] **Step 1: Write PlacementEngine**

Create `scripts/core/terrain_objects/placement_engine.gd`:

```gdscript
class_name PlacementEngine
extends RefCounted

## Deterministic placement pipeline: ChunkData + BiomeAffinity → ObjectInstance[].
## 7-step process: biome pass → affinity lookup → eligibility → density sampling →
## transition blending → instance generation → collision registration.

var _catalog: ObjectCatalog
var _affinity: BiomeAffinityLoader
var _noise: FastNoiseLite
var _world_seed: int

const CHUNK_SIZE = 64  # ChunkData.SIZE


func _init(catalog: ObjectCatalog, affinity: BiomeAffinityLoader, world_seed: int):
	_catalog = catalog
	_affinity = affinity
	_world_seed = world_seed
	_noise = FastNoiseLite.new()
	_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise.frequency = 0.05


func place_chunk(chunk_data, chunk_x: int, chunk_y: int) -> Array[ObjectInstance]:
	var instances: Array[ObjectInstance] = []

	for cy in range(CHUNK_SIZE):
		for cx in range(CHUNK_SIZE):
			var idx = cy * CHUNK_SIZE + cx
			var world_x = chunk_x * CHUNK_SIZE + cx
			var world_y = chunk_y * CHUNK_SIZE + cy

			# Step 1: Biome pass
			var biome_id = _get_biome_name(chunk_data, idx)
			if biome_id == "":
				continue

			# Step 2: Affinity lookup
			var pools = _affinity.get_object_pools(biome_id)
			if pools.is_empty():
				continue

			# Step 3-4: Eligibility + density sampling
			for pool in pools:
				var obj_id = pool.get("object_id", "")
				var obj_def = _catalog.get_object(obj_id)
				if obj_def.is_empty():
					continue

				if not _check_eligibility(chunk_data, idx, pool):
					continue

				var density = _sample_density(pool, chunk_data, idx, world_x, world_y, obj_id)
				if density <= 0.0:
					continue

				# Step 5: Transition blending (adjust density near biome borders)
				density = _apply_transition_blending(chunk_data, cx, cy, idx, biome_id, density)

				# Placement check
				var place_rng = _make_rng(world_x, world_y, obj_id.hash())
				if place_rng.randf() > density:
					continue

				# Step 6: Instance generation
				var inst_seed = _instance_seed(world_x, world_y, obj_id)
				var phase = _select_phase(obj_def, pool, inst_seed)
				var var_count = pool.get("variant_count", 1)
				var var_idx = (inst_seed % var_count) + 1

				var inst = ObjectInstance.from_placement(
					obj_def, Vector2i(world_x, world_y), inst_seed, phase, var_idx)
				instances.append(inst)

	return instances


func _get_biome_name(chunk_data, idx: int) -> String:
	# BiomeLayer.biome_name() equivalent
	var biome_id = chunk_data.biome_id[idx]
	var biome_names = [
		"ocean", "beach", "grassland", "forest", "dense_forest",
		"desert", "savanna", "steppe", "tundra", "taiga",
		"mountains", "swamp", "tropical_forest", "volcanic",
		"arctic", "lake", "river", "mystic"
	]
	if biome_id >= 0 and biome_id < biome_names.size():
		return biome_names[biome_id]
	return ""


func _check_eligibility(chunk_data, idx: int, pool: Dictionary) -> bool:
	# Elevation check
	var elev_range = pool.get("elevation_range")
	if elev_range != null and elev_range is Array:
		var elev = chunk_data.elevation[idx]
		if elev < elev_range[0] or elev > elev_range[1]:
			return false

	# Moisture check
	var moist_range = pool.get("moisture_range")
	if moist_range != null and moist_range is Array:
		var precip = chunk_data.precipitation[idx]
		if precip < moist_range[0] or precip > moist_range[1]:
			return false

	# Slope check
	var slope_max = pool.get("slope_max", 1.0)
	var slope = chunk_data.slope[idx]
	if slope > slope_max:
		return false

	# Distance rules
	var rules = pool.get("distance_rules")
	if rules != null and rules is Dictionary:
		var water_dist = chunk_data.water_distance[idx]
		var min_w = rules.get("min_water")
		if min_w != null and water_dist < min_w:
			return false
		var max_w = rules.get("max_water")
		if max_w != null and water_dist > max_w:
			return false

	return true


func _sample_density(pool: Dictionary, chunk_data, idx: int,
		wx: int, wy: int, obj_id: String) -> float:
	var base_density = pool.get("density", 0.0)
	var veg_density = chunk_data.vegetation_density[idx] / 255.0

	# Cluster mode
	var cluster_mode = pool.get("cluster_mode", "scatter")
	var cluster_val = 1.0
	if cluster_mode == "perlin":
		var scale = pool.get("cluster_scale", 0.3)
		_noise.frequency = scale
		_noise.seed = _world_seed + obj_id.hash()
		cluster_val = (_noise.get_noise_2d(wx, wy) + 1.0) * 0.5  # 0-1
	elif cluster_mode == "scatter":
		cluster_val = 0.5 + _make_rng(wx, wy, obj_id.hash() + 999).randf() * 0.5

	return base_density * veg_density * cluster_val


func _apply_transition_blending(chunk_data, cx: int, cy: int, idx: int,
		biome_id: String, density: float) -> float:
	# Check if neighbors have different biome
	var neighbors_same = true
	for dy in range(-1, 2):
		for dx in range(-1, 2):
			if dx == 0 and dy == 0:
				continue
			var nx = cx + dx
			var ny = cy + dy
			if nx < 0 or nx >= CHUNK_SIZE or ny < 0 or ny >= CHUNK_SIZE:
				continue
			var n_idx = ny * CHUNK_SIZE + nx
			var n_biome = _get_biome_name(chunk_data, n_idx)
			if n_biome != biome_id:
				neighbors_same = false
				break
		if not neighbors_same:
			break

	if not neighbors_same:
		# Reduce density at biome borders (simple fade)
		density *= 0.5

	return density


func _select_phase(obj_def: Dictionary, pool: Dictionary, seed_val: int) -> String:
	if obj_def.get("ontology", "") != "animate":
		return ""
	var dist = pool.get("lifecycle_distribution", {})
	if dist.is_empty():
		var lifecycle = obj_def.get("lifecycle", {})
		var phases = lifecycle.get("phases", [])
		if phases.size() > 0:
			return phases[phases.size() / 2].get("id", "mature")
		return "mature"

	# Weighted random selection
	var rng = RandomNumberGenerator.new()
	rng.seed = seed_val + 7777
	var roll = rng.randf()
	var cumulative = 0.0
	for phase_id in dist:
		cumulative += dist[phase_id]
		if roll <= cumulative:
			return phase_id
	# Fallback to last
	var keys = dist.keys()
	return keys[keys.size() - 1] if keys.size() > 0 else "mature"


func _instance_seed(wx: int, wy: int, obj_id: String) -> int:
	# Deterministic seed from world position + object type
	return hash(Vector3i(wx, wy, _world_seed)) ^ obj_id.hash()


func _make_rng(wx: int, wy: int, extra: int) -> RandomNumberGenerator:
	var rng = RandomNumberGenerator.new()
	rng.seed = hash(Vector3i(wx, wy, _world_seed)) ^ extra
	return rng
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/terrain_objects/placement_engine.gd
git commit -m "feat(terrain-objects): PlacementEngine — 7-step deterministic placement pipeline"
```

---

## Task 10: Delta Persistence

**Files:**
- Create: `scripts/core/terrain_objects/delta_persistence.gd`

- [ ] **Step 1: Write DeltaPersistence**

Create `scripts/core/terrain_objects/delta_persistence.gd`:

```gdscript
class_name DeltaPersistence
extends RefCounted

## Manages sparse time-decaying deltas for terrain object mutations.
## Baseline (deterministic) + Deltas (sparse) = actual world state.

var _deltas: Dictionary = {}  # "x_y" -> Dictionary (delta data)
var _save_dir: String = "user://world_state/deltas/"


func _init():
	DirAccess.make_dir_recursive_absolute(_save_dir)


func record_delta(pos: Vector2i, object_id: String, mutation: String,
		new_state: String, game_time: float, decay_type: String = "regrow",
		recovery_time: float = 720.0, stages: Array = []) -> void:
	var key = "%d_%d" % [pos.x, pos.y]
	_deltas[key] = {
		"position": [pos.x, pos.y],
		"object_id": object_id,
		"mutation": mutation,
		"new_state": new_state,
		"timestamp": game_time,
		"decay": {
			"type": decay_type,
			"recovery_time": recovery_time,
			"stages": stages,
		},
	}


func get_delta(pos: Vector2i) -> Dictionary:
	var key = "%d_%d" % [pos.x, pos.y]
	return _deltas.get(key, {})


func has_delta(pos: Vector2i) -> bool:
	var key = "%d_%d" % [pos.x, pos.y]
	return _deltas.has(key)


func resolve_delta(pos: Vector2i, current_game_time: float) -> Dictionary:
	## Returns the current state of a delta after time decay.
	## Returns {} if delta has fully recovered (baseline reasserts).
	var delta = get_delta(pos)
	if delta.is_empty():
		return {}

	var timestamp = delta.get("timestamp", 0.0)
	var decay = delta.get("decay", {})
	var recovery_time = decay.get("recovery_time", 720.0)
	var elapsed = current_game_time - timestamp

	# Fully recovered — baseline reasserts
	if recovery_time > 0 and elapsed >= recovery_time:
		remove_delta(pos)
		return {}

	# Permanent delta
	var decay_type = decay.get("type", "regrow")
	if decay_type == "permanent":
		return delta

	# Compute progress through recovery stages
	var progress = elapsed / max(recovery_time, 0.001)
	var stages = decay.get("stages", [])
	var current_stage_state = delta.get("new_state", "")

	for i in range(stages.size() - 1, -1, -1):
		var stage = stages[i]
		var at = stage.get("at", 0.0)
		if progress >= at:
			var stage_state = stage.get("state")
			if stage_state == null:
				# null state means delta removed — baseline reasserts
				remove_delta(pos)
				return {}
			current_stage_state = stage_state
			break

	var resolved = delta.duplicate(true)
	resolved["new_state"] = current_stage_state
	resolved["_progress"] = progress
	return resolved


func remove_delta(pos: Vector2i) -> void:
	var key = "%d_%d" % [pos.x, pos.y]
	_deltas.erase(key)


func prune_expired(current_game_time: float) -> int:
	## Remove all fully recovered deltas. Returns count of pruned.
	var to_remove: Array[String] = []
	for key in _deltas:
		var delta = _deltas[key]
		var decay = delta.get("decay", {})
		var recovery = decay.get("recovery_time", 720.0)
		var decay_type = decay.get("type", "regrow")
		if decay_type == "permanent":
			continue
		var elapsed = current_game_time - delta.get("timestamp", 0.0)
		if recovery > 0 and elapsed >= recovery:
			to_remove.append(key)

	for key in to_remove:
		_deltas.erase(key)
	return to_remove.size()


func save_chunk(chunk_x: int, chunk_y: int) -> void:
	## Save deltas for a chunk region to disk.
	var chunk_deltas: Dictionary = {}
	var prefix_x_min = chunk_x * 64
	var prefix_x_max = prefix_x_min + 64
	var prefix_y_min = chunk_y * 64
	var prefix_y_max = prefix_y_min + 64

	for key in _deltas:
		var delta = _deltas[key]
		var pos = delta.get("position", [0, 0])
		if pos[0] >= prefix_x_min and pos[0] < prefix_x_max \
				and pos[1] >= prefix_y_min and pos[1] < prefix_y_max:
			chunk_deltas[key] = delta

	if chunk_deltas.is_empty():
		return

	var path = _save_dir + "chunk_%d_%d.json" % [chunk_x, chunk_y]
	var file = FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_warning("[DeltaPersistence] Cannot write: %s" % path)
		return
	file.store_string(JSON.stringify(chunk_deltas, "\t"))
	file.close()


func load_chunk(chunk_x: int, chunk_y: int) -> void:
	## Load deltas for a chunk region from disk.
	var path = _save_dir + "chunk_%d_%d.json" % [chunk_x, chunk_y]
	if not FileAccess.file_exists(path):
		return
	var file = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return
	var text = file.get_as_text()
	file.close()
	var json = JSON.new()
	if json.parse(text) != OK:
		return
	var data = json.get_data()
	if data is Dictionary:
		for key in data:
			_deltas[key] = data[key]
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/terrain_objects/delta_persistence.gd
git commit -m "feat(terrain-objects): DeltaPersistence — time-decaying world mutation log"
```

---

## Task 11: Animation Resolver

**Files:**
- Create: `scripts/core/terrain_objects/animation_resolver.gd`

- [ ] **Step 1: Write AnimationResolver**

Create `scripts/core/terrain_objects/animation_resolver.gd`:

```gdscript
class_name AnimationResolver
extends RefCounted

## Resolves which animation to play for a terrain object based on priority stack:
## 1. Active effect (burning, being chopped) → one-shot/loop
## 2. State reactive (just cracked, wilted) → transition then fallthrough
## 3. Environmental (wind, rain) → blend with ambient
## 4. Ambient (idle) → default loop

var _registry: InteractionRegistry
var _catalog: ObjectCatalog


func _init(registry: InteractionRegistry, catalog: ObjectCatalog):
	_registry = registry
	_catalog = catalog


func resolve(instance: ObjectInstance, weather: Dictionary = {},
		time_of_day: float = 0.5) -> Array[Dictionary]:
	## Returns array of animation layers to composite.
	## Each layer: { interaction_id, blend_mode, intensity, sprite_path_hint }
	var layers: Array[Dictionary] = []
	var available = _get_available_interactions(instance)

	# Priority 1: Active effects
	for effect in instance.active_effects:
		if effect in available:
			var spec = _registry.get_animation_spec(effect)
			if not spec.is_empty():
				layers.append({
					"interaction_id": effect,
					"blend_mode": spec.get("blend_mode", "replace"),
					"intensity": 1.0,
					"loop": spec.get("loop", false),
					"frames": spec.get("frames", [4, 8]),
					"duration_ms": spec.get("duration_ms", [400, 800]),
				})
				if spec.get("blend_mode", "replace") == "replace":
					return layers  # Replace mode = nothing else renders

	# Priority 2: State reactive — check if state recently changed
	var state_interactions = _get_state_reactive(instance, available)
	for si in state_interactions:
		var spec = _registry.get_animation_spec(si)
		if not spec.is_empty():
			layers.append({
				"interaction_id": si,
				"blend_mode": spec.get("blend_mode", "replace"),
				"intensity": 1.0,
				"loop": false,
				"frames": spec.get("frames", [4, 8]),
				"duration_ms": spec.get("duration_ms", [1000, 2000]),
			})
			if spec.get("blend_mode", "replace") == "replace":
				return layers

	# Priority 3: Environmental (wind, rain)
	var wind_speed = weather.get("wind_speed", 0.0)
	if wind_speed > 0.1 and "wind" in available:
		var spec = _registry.get_animation_spec("wind")
		if not spec.is_empty():
			layers.append({
				"interaction_id": "wind",
				"blend_mode": spec.get("blend_mode", "replace"),
				"intensity": clampf(wind_speed, 0.0, 1.0),
				"loop": true,
				"frames": spec.get("frames", [6, 10]),
				"duration_ms": spec.get("duration_ms", [600, 1200]),
			})

	var precip = weather.get("precipitation", 0.0)
	if precip > 0.1 and "rain" in available:
		var spec = _registry.get_animation_spec("rain")
		if not spec.is_empty():
			layers.append({
				"interaction_id": "rain",
				"blend_mode": spec.get("blend_mode", "overlay"),
				"intensity": clampf(precip, 0.0, 1.0),
				"loop": true,
				"frames": spec.get("frames", [4, 8]),
				"duration_ms": spec.get("duration_ms", [400, 800]),
			})

	# Priority 4: Ambient idle (always present if nothing else is replace)
	var has_replace = false
	for layer in layers:
		if layer.get("blend_mode", "") == "replace":
			has_replace = true
			break

	if not has_replace and "idle" in available:
		var spec = _registry.get_animation_spec("idle")
		if not spec.is_empty():
			layers.insert(0, {
				"interaction_id": "idle",
				"blend_mode": "replace",
				"intensity": 1.0,
				"loop": true,
				"frames": spec.get("frames", [4, 8]),
				"duration_ms": spec.get("duration_ms", [800, 1600]),
			})

	# Cap at base + 2 overlays
	if layers.size() > 3:
		layers.resize(3)

	return layers


func _get_available_interactions(instance: ObjectInstance) -> Array:
	return _catalog.get_interactions_for(instance.object_id, instance.lifecycle_phase)


func _get_state_reactive(instance: ObjectInstance, available: Array) -> Array:
	var reactive: Array = []
	# Map current_state to reactive animations
	var state_map = {
		"burning": "burn_ignite",
		"frozen": "freeze_cast",
		"chopped_stump": "chop",
		"dying": "wilt",
		"blooming": "bloom",
		"fruiting": "fruit",
		"cracked": "crack",
		"collapsing": "collapse",
		"decomposing": "decompose",
	}
	var mapped = state_map.get(instance.current_state, "")
	if mapped != "" and mapped in available:
		reactive.append(mapped)
	return reactive
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/terrain_objects/animation_resolver.gd
git commit -m "feat(terrain-objects): AnimationResolver — priority stack + compositing"
```

---

## Task 12: Renderer Integration

**Files:**
- Modify: `scripts/autoload/WorldManager.gd`
- Modify: `scripts/core/world_compiler/deferred_renderer.gd`

- [ ] **Step 1: Register new systems in WorldManager**

Read WorldManager.gd `_init_systems()` method. After the existing system initializations (around line 180), add:

```gdscript
# Terrain Object System
var object_catalog = ObjectCatalog.new()
var interaction_registry = InteractionRegistry.new()
var biome_affinity_loader = BiomeAffinityLoader.new()
var placement_engine = PlacementEngine.new(object_catalog, biome_affinity_loader, ServerConfig.get_world_seed())
var delta_persistence = DeltaPersistence.new()
var animation_resolver = AnimationResolver.new(interaction_registry, object_catalog)
```

Also add these as member variables at the top of the class so other systems can access them.

- [ ] **Step 2: Replace DeferredRenderer object placement**

In `scripts/core/world_compiler/deferred_renderer.gd`, modify `render_chunk()` or `render_objects_only()` to call PlacementEngine instead of the hardcoded `_render_object_sprites()` and `_render_detail_decorations()`.

Add a reference to PlacementEngine and replace the calls:

```gdscript
# At top of class, add:
var _placement_engine: PlacementEngine
var _object_catalog: ObjectCatalog

func set_placement_engine(engine: PlacementEngine, catalog: ObjectCatalog) -> void:
	_placement_engine = engine
	_object_catalog = catalog
```

Replace `_render_object_sprites()` call with:

```gdscript
func _render_placed_objects(chunk: ChunkData, ox: int, oy: int, chunk_x: int, chunk_y: int) -> void:
	if _placement_engine == null:
		# Fallback to old method if engine not set
		_render_object_sprites(chunk, ox, oy, CHUNK_SIZE)
		return

	var instances = _placement_engine.place_chunk(chunk, chunk_x, chunk_y)
	var obj_count = 0
	var max_objects = 400

	for inst in instances:
		if obj_count >= max_objects:
			break

		# Get sprite for this object (use existing _object_images or catalog)
		var tex = _find_object_texture(inst)
		if tex == null:
			continue

		var sprite = Sprite2D.new()
		sprite.texture = tex
		sprite.position = Vector2(
			(inst.position.x - ox) * _world_scale + _world_scale * 0.5,
			(inst.position.y - oy) * _world_scale + _world_scale * 0.5)
		sprite.scale = Vector2(inst.ind_scale, inst.ind_scale)
		sprite.rotation_degrees = inst.ind_lean_angle
		sprite.z_index = 4  # Object layer
		sprite.modulate.h = inst.ind_color_shift / 360.0  # Won't work directly — use shader or skip for now
		add_child(sprite)
		obj_count += 1

	print("[DeferredRenderer] Placed %d terrain objects" % obj_count)


func _find_object_texture(inst: ObjectInstance) -> Texture2D:
	# Try catalog path first
	var base_path = "res://assets/catalog/terrain_objects/%s/%s/" % [
		inst.category.replace("/", "/"), inst.object_id]
	var phase_path = base_path + "lifecycle/%s/base.png" % inst.lifecycle_phase
	if ResourceLoader.exists(phase_path):
		return load(phase_path)
	var variant_path = base_path + "variants/v%d/base.png" % inst.variant
	if ResourceLoader.exists(variant_path):
		return load(variant_path)

	# Fallback to existing object images
	if _object_images.has(inst.object_id):
		var entry = _object_images[inst.object_id]
		return entry.get("texture")
	return null
```

- [ ] **Step 3: Commit**

```bash
git add scripts/autoload/WorldManager.gd scripts/core/world_compiler/deferred_renderer.gd
git commit -m "feat(terrain-objects): integrate PlacementEngine into DeferredRenderer + WorldManager"
```

---

## Task 13: Generation Queue Builder

**Files:**
- Create: `tools/terrain_objects/build_generation_queue.py`

- [ ] **Step 1: Write the queue builder**

Create `tools/terrain_objects/build_generation_queue.py`:

```python
#!/usr/bin/env python3
"""Walk the object x interaction x lifecycle matrix and build the PixelLab generation queue."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OBJ_DIR = ROOT / "data" / "terrain_objects" / "objects"
INT_DIR = ROOT / "data" / "terrain_objects" / "interactions"
ASSETS_DIR = ROOT / "assets" / "catalog" / "terrain_objects"
OUT = ROOT / "data" / "terrain_objects" / "generation" / "queue.json"


def load_all(directory: Path) -> list[dict]:
    results = []
    for f in directory.rglob("*.json"):
        results.append(json.loads(f.read_text(encoding="utf-8")))
    return results


def main():
    objects = load_all(OBJ_DIR)
    interactions = {i["id"]: i for i in load_all(INT_DIR)}

    queue = []
    total_base = 0
    total_anim = 0

    for obj in objects:
        obj_id = obj["id"]
        category = obj["category"]
        ontology = obj.get("ontology", "inanimate")

        if ontology == "animate":
            lifecycle = obj.get("lifecycle", {})
            phase_interactions = lifecycle.get("phase_interactions", {})
            phases = lifecycle.get("phases", [])

            for phase_def in phases:
                phase = phase_def["id"]
                # Base sprite for this phase
                asset_path = ASSETS_DIR / category / obj_id / "lifecycle" / phase / "base.png"
                if not asset_path.exists():
                    queue.append({
                        "object_id": obj_id,
                        "phase": phase,
                        "asset_type": "base_sprite",
                        "interaction": None,
                        "status": "pending",
                        "pixellab_job_id": None,
                        "output_path": str(asset_path.relative_to(ROOT)),
                    })
                    total_base += 1

                # Animations for this phase
                for int_id in phase_interactions.get(phase, []):
                    anim_path = ASSETS_DIR / category / obj_id / "animations" / phase / f"{int_id}.png"
                    if not anim_path.exists():
                        queue.append({
                            "object_id": obj_id,
                            "phase": phase,
                            "asset_type": "animation",
                            "interaction": int_id,
                            "status": "pending",
                            "pixellab_job_id": None,
                            "output_path": str(anim_path.relative_to(ROOT)),
                        })
                        total_anim += 1

        else:  # inanimate
            durability = obj.get("durability")
            stages = []
            if durability and isinstance(durability, dict):
                stages = [s["id"] for s in durability.get("stages", [])]
            if not stages:
                stages = ["default"]

            for stage in stages:
                asset_path = ASSETS_DIR / category / obj_id / stage / "base.png"
                if not asset_path.exists():
                    queue.append({
                        "object_id": obj_id,
                        "phase": stage,
                        "asset_type": "base_sprite",
                        "interaction": None,
                        "status": "pending",
                        "pixellab_job_id": None,
                        "output_path": str(asset_path.relative_to(ROOT)),
                    })
                    total_base += 1

                for int_id in obj.get("interactions", []):
                    anim_path = ASSETS_DIR / category / obj_id / "animations" / stage / f"{int_id}.png"
                    if not anim_path.exists():
                        queue.append({
                            "object_id": obj_id,
                            "phase": stage,
                            "asset_type": "animation",
                            "interaction": int_id,
                            "status": "pending",
                            "pixellab_job_id": None,
                            "output_path": str(anim_path.relative_to(ROOT)),
                        })
                        total_anim += 1

    result = {
        "total_queued": len(queue),
        "total_base_sprites": total_base,
        "total_animations": total_anim,
        "total_completed": 0,
        "queue": queue,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Queue built: {total_base} base sprites + {total_anim} animations = {len(queue)} total")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the queue builder**

```bash
python tools/terrain_objects/build_generation_queue.py
```

Expected output showing thousands of queued items.

- [ ] **Step 3: Commit**

```bash
git add tools/terrain_objects/build_generation_queue.py data/terrain_objects/generation/queue.json
git commit -m "feat(terrain-objects): generation queue builder — walks object x interaction x phase matrix"
```

---

## Task 14: PixelLab Generation Runner

**Files:**
- Create: `tools/terrain_objects/run_pixellab_generation.py`
- Create: `data/terrain_objects/generation/prompts/vegetation_tree.txt`
- Create: `data/terrain_objects/generation/prompts/vegetation_grass.txt`
- Create: `data/terrain_objects/generation/prompts/mineral_rock.txt`
- Create: `data/terrain_objects/generation/prompts/water_feature.txt`
- Create: `data/terrain_objects/generation/prompts/ground_cover.txt`
- Create: `data/terrain_objects/generation/prompts/structure_natural.txt`
- Create: `data/terrain_objects/generation/prompts/animation.txt`

This task creates the PixelLab generation runner. It reads the queue, generates prompts, calls PixelLab MCP tools, saves assets, and updates the queue. This is run interactively in Claude Code sessions using PixelLab MCP.

- [ ] **Step 1: Write prompt templates**

Create `data/terrain_objects/generation/prompts/vegetation_tree.txt`:
```
Top-down pixel art {phase} {species} tree, {variant_desc}, 32x32 pixels, transparent background, 2D RPG style, consistent with pixel art tileset aesthetic. Phase details: {phase_desc}.
```

Create `data/terrain_objects/generation/prompts/vegetation_grass.txt`:
```
Top-down pixel art {phase} {species} grass patch, {variant_desc}, 32x32 pixels, transparent background, 2D RPG tileset style. Phase: {phase_desc}.
```

Create `data/terrain_objects/generation/prompts/mineral_rock.txt`:
```
Top-down pixel art {stage} {species} rock, {variant_desc}, 32x32 pixels, transparent background, 2D RPG style. Damage stage: {stage_desc}.
```

Create `data/terrain_objects/generation/prompts/water_feature.txt`:
```
Top-down pixel art {species} water effect, 32x32 pixels, transparent background, 2D RPG style. Semi-transparent water with visible depth.
```

Create `data/terrain_objects/generation/prompts/ground_cover.txt`:
```
Top-down pixel art {species} ground cover, 32x32 pixels, transparent background, 2D RPG tileset style, seamless edges.
```

Create `data/terrain_objects/generation/prompts/structure_natural.txt`:
```
Top-down pixel art {species} natural structure, {variant_desc}, 32x32 pixels, transparent background, 2D RPG style.
```

Create `data/terrain_objects/generation/prompts/animation.txt`:
```
Animate: {object_description} performing {interaction_description}, {frame_count} frames, top-down view, transparent background, consistent with base sprite, 2D RPG pixel art style.
```

- [ ] **Step 2: Write the generation runner**

Create `tools/terrain_objects/run_pixellab_generation.py`:

```python
#!/usr/bin/env python3
"""PixelLab generation runner. Reads queue, generates assets via MCP, updates queue.

This script is meant to be used as a reference for Claude Code sessions
that call PixelLab MCP tools. It manages the queue state.

Usage:
  python run_pixellab_generation.py status     # Show queue status
  python run_pixellab_generation.py mark-done OBJECT_ID PHASE INTERACTION  # Mark item complete
  python run_pixellab_generation.py next [N]   # Show next N items to generate
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
QUEUE_PATH = ROOT / "data" / "terrain_objects" / "generation" / "queue.json"
PROMPTS_DIR = ROOT / "data" / "terrain_objects" / "generation" / "prompts"


def load_queue() -> dict:
    return json.loads(QUEUE_PATH.read_text(encoding="utf-8"))


def save_queue(data: dict):
    QUEUE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def status():
    q = load_queue()
    pending = sum(1 for i in q["queue"] if i["status"] == "pending")
    completed = sum(1 for i in q["queue"] if i["status"] == "completed")
    failed = sum(1 for i in q["queue"] if i["status"] == "failed")
    print(f"Total:     {q['total_queued']}")
    print(f"Base:      {q['total_base_sprites']}")
    print(f"Animation: {q['total_animations']}")
    print(f"Pending:   {pending}")
    print(f"Completed: {completed}")
    print(f"Failed:    {failed}")

    # Breakdown by object category
    cats: dict[str, int] = {}
    for item in q["queue"]:
        if item["status"] == "pending":
            obj_id = item["object_id"]
            cat = obj_id.split("_")[0]  # rough grouping
            cats[cat] = cats.get(cat, 0) + 1
    print("\nPending by prefix:")
    for cat, count in sorted(cats.items(), key=lambda x: -x[1])[:15]:
        print(f"  {cat}: {count}")


def next_items(n: int = 10):
    q = load_queue()
    pending = [i for i in q["queue"] if i["status"] == "pending"]
    for item in pending[:n]:
        asset_type = item["asset_type"]
        interaction = item.get("interaction") or "-"
        print(f"  {item['object_id']} | {item['phase']} | {asset_type} | {interaction}")
        print(f"    → {item['output_path']}")


def mark_done(object_id: str, phase: str, interaction: str):
    q = load_queue()
    found = False
    for item in q["queue"]:
        if (item["object_id"] == object_id and item["phase"] == phase
                and (item.get("interaction") or "") == interaction):
            item["status"] = "completed"
            q["total_completed"] = sum(1 for i in q["queue"] if i["status"] == "completed")
            found = True
            break
    if found:
        save_queue(q)
        print(f"Marked complete: {object_id}/{phase}/{interaction}")
    else:
        print(f"Not found: {object_id}/{phase}/{interaction}")


def main():
    if len(sys.argv) < 2:
        print("Usage: run_pixellab_generation.py [status|next|mark-done]")
        return

    cmd = sys.argv[1]
    if cmd == "status":
        status()
    elif cmd == "next":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        next_items(n)
    elif cmd == "mark-done":
        if len(sys.argv) < 5:
            print("Usage: mark-done OBJECT_ID PHASE INTERACTION")
            return
        mark_done(sys.argv[2], sys.argv[3], sys.argv[4] if sys.argv[4] != "-" else "")
    else:
        print(f"Unknown command: {cmd}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Commit**

```bash
git add tools/terrain_objects/run_pixellab_generation.py data/terrain_objects/generation/prompts/
git commit -m "feat(terrain-objects): PixelLab generation runner + prompt templates"
```

---

## Task 15: Test Character Sprite

**Files:**
- Modify: rendering code that displays the player

- [ ] **Step 1: Check existing character assets**

```bash
ls assets/characters/
```

Pick an existing character (hero_knight or villager_female) and wire it into the player rendering. The current player is a red `ColorRect`.

- [ ] **Step 2: Update player rendering to use sprite**

Find where the player is rendered (likely in `GrainWorldDemo.gd` or a related script). Replace the red cube with a `Sprite2D` loading from `assets/characters/`. Match the existing 8-directional animation pattern from `SpriteAnimation`.

- [ ] **Step 3: Verify visually**

Run the scene with F6. Confirm the player is now a pixel art character instead of a red cube.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: replace red cube player sprite with character asset"
```

---

## Task 16: End-to-End Verification

- [ ] **Step 1: Run all data generators**

```bash
python tools/terrain_objects/generate_interactions.py
python tools/terrain_objects/generate_objects.py
python tools/terrain_objects/generate_biome_data.py
```

- [ ] **Step 2: Run validation**

```bash
python tools/terrain_objects/validate_data.py
```

Expected: 0 errors.

- [ ] **Step 3: Build generation queue**

```bash
python tools/terrain_objects/build_generation_queue.py
```

Note the total count for reference.

- [ ] **Step 4: Run the game scene**

Press F6 in Godot. Verify:
- ObjectCatalog prints loaded object count
- InteractionRegistry prints loaded interaction count
- BiomeAffinity prints loaded affinity count
- Objects appear on terrain (using existing sprites as fallback if PixelLab assets not yet generated)
- No GDScript errors in output log

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(terrain-objects): end-to-end terrain object system verified"
```

---

## Summary

| Task | Description | Files |
|------|------------|-------|
| 1 | Directory structure + JSON schemas | 4 schema files |
| 2 | README + EXTENSION_POINTS docs | 2 docs |
| 3 | Interaction definitions generator | 1 script → ~35 JSONs |
| 4 | Object definitions generator | 1 script → ~180 JSONs |
| 5 | Biome data generator | 1 script → 18 affinity + 30 transition JSONs |
| 6 | Data validation script | 1 script |
| 7 | ObjectInstance data class | 1 GDScript |
| 8 | Data loaders (catalog, registry, affinity) | 3 GDScripts |
| 9 | Placement engine | 1 GDScript |
| 10 | Delta persistence | 1 GDScript |
| 11 | Animation resolver | 1 GDScript |
| 12 | Renderer integration | 2 modified GDScripts |
| 13 | Generation queue builder | 1 Python script |
| 14 | PixelLab generation runner + prompts | 1 script + 7 templates |
| 15 | Test character sprite | 1 modified script |
| 16 | End-to-end verification | Run + verify |
