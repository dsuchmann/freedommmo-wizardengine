# Terrain Object System Design

**Date:** 2026-05-28
**Status:** Approved
**Scope:** Object taxonomy, interaction framework, biome placement, animation system, generation pipeline

## Overview

Every biome in FreedomMMO is composed of atomic, layered, animated objects — not flat textures. This spec defines the three-axis relational model that governs what objects exist, what can happen to them, where they appear, and how they're generated at scale.

The three axes:
1. **Object Catalog** — what exists (animate/inanimate, lifecycle phases, durability stages)
2. **Interaction Schema** — what can happen to it (trigger conditions, effects, animation specs)
3. **Biome Affinity Matrix** — where it appears (density, clustering, elevation/moisture rules, transitions)

These are supported by:
- **Placement Engine** — deterministic seeded placement + sparse time-decaying deltas
- **Animation Framework** — priority-based resolution, compositing, blend modes
- **Generation Pipeline** — systematic PixelLab orchestration across the full matrix
- **File Organization** — directory structure with extension point documentation for future agents

Target scale: ~200+ base object types, ~30 interaction types, ~6 lifecycle phases average = **4,000-6,000 unique animation sets**. Thousands of individual assets, each with dozens to hundreds of animations.

---

## 1. Object Catalog

### 1.1 Ontological Classification

Every object belongs to one of two fundamental categories:

- **Animate** — living things with lifecycle phases (seedling → mature → dead → decomposing). Each phase is a visually distinct sprite set with its own applicable interactions.
- **Inanimate** — non-living things with durability models (intact → cracked → shattered). Destruction produces child objects that themselves exist in the catalog.

### 1.2 Animate Object Schema

```json
{
  "id": "oak_tree",
  "category": "vegetation/tree/deciduous",
  "ontology": "animate",
  
  "lifecycle": {
    "phases": [
      { "id": "seedling",    "duration_days": [30, 60],    "size": [1,1], "sprite_set": "seedling/" },
      { "id": "sapling",     "duration_days": [60, 120],   "size": [1,2], "sprite_set": "sapling/" },
      { "id": "juvenile",    "duration_days": [120, 360],  "size": [1,2], "sprite_set": "juvenile/" },
      { "id": "mature",      "duration_days": [360, null],  "size": [2,3], "sprite_set": "mature/" },
      { "id": "old_growth",  "duration_days": [720, null],  "size": [2,4], "sprite_set": "old_growth/" },
      { "id": "dying",       "duration_days": [30, 90],    "size": [2,4], "sprite_set": "dying/" },
      { "id": "dead",        "duration_days": [60, 180],   "size": [2,3], "sprite_set": "dead/" },
      { "id": "decomposing", "duration_days": [90, null],   "size": [1,2], "sprite_set": "decomposing/" }
    ],
    "phase_interactions": {
      "seedling":  ["idle_sway", "trample", "pick", "burn", "freeze"],
      "sapling":   ["idle_sway", "wind_sway", "burn", "freeze", "chop"],
      "juvenile":  ["idle_sway", "wind_sway", "chop", "burn", "freeze", "rain_drip"],
      "mature":    ["idle_sway", "wind_sway", "chop", "burn", "freeze", "lightning",
                    "climb", "rain_drip", "bird_nest", "seasonal_change", "fruit"],
      "old_growth":["idle_sway", "wind_sway", "chop", "burn", "freeze", "lightning",
                    "climb", "rain_drip", "bird_nest", "seasonal_change", "fungal_growth"],
      "dying":     ["idle", "wilt", "collapse", "burn", "fungal_growth"],
      "dead":      ["idle", "collapse", "burn", "chop", "fungal_growth"],
      "decomposing":["idle", "fungal_growth", "insect_swarm"]
    }
  },
  
  "variance": {
    "branching_seed": true,
    "leaf_density": [0.6, 1.0],
    "lean_angle": [-5, 5],
    "color_shift": [-10, 10],
    "scale_variance": [0.85, 1.15]
  },

  "break_products": {
    "on_chop": [
      { "object_id": "oak_stump", "count": 1 },
      { "object_id": "oak_log", "count": [1, 2] },
      { "object_id": "branch", "count": [2, 4] },
      { "object_id": "leaf_pile", "count": [1, 2] }
    ],
    "on_burn": [
      { "object_id": "charred_trunk", "count": 1 },
      { "object_id": "ash_pile", "count": [1, 3] }
    ]
  }
}
```

### 1.3 Inanimate Object Schema

```json
{
  "id": "granite_boulder",
  "category": "mineral/rock/boulder",
  "ontology": "inanimate",
  
  "durability": {
    "hp": 100,
    "resistances": { "blunt": 0.5, "sharp": 0.8, "fire": 0.95, "frost": 0.7 },
    "stages": [
      { "id": "intact",    "hp_range": [75, 100], "sprite_set": "intact/" },
      { "id": "cracked",   "hp_range": [40, 75],  "sprite_set": "cracked/" },
      { "id": "fractured", "hp_range": [10, 40],  "sprite_set": "fractured/" },
      { "id": "shattered", "hp_range": [0, 10],   "sprite_set": "shattered/" }
    ],
    "break_products": [
      { "object_id": "rock_chunk", "count": [2, 4], "on_stage": "shattered" },
      { "object_id": "pebble", "count": [5, 12], "on_stage": "shattered" },
      { "object_id": "stone_dust", "count": 1, "on_stage": "shattered" }
    ]
  },
  
  "interactions": ["idle", "strike", "explode", "freeze_crack", "moss_growth", "weather_erosion"]
}
```

### 1.4 Object Production Graph

Every transformation produces objects that themselves exist in the catalog:

```
oak_tree (mature) --[chop]--> oak_stump + oak_log + branch ×3 + leaf_pile
oak_log --[chop]--> plank ×4 + wood_chip
oak_tree (mature) --[burn]--> charred_trunk + ash_pile
oak_tree (mature) --[lifecycle]--> dying --> dead --> fallen_log + mushroom_cluster

granite_boulder --[strike ×4]--> cracked --> fractured --> shattered
shattered --[break_products]--> rock_chunk ×3 + pebble ×8 + stone_dust
rock_chunk --[strike]--> pebble ×4 + stone_dust
```

Nothing disappears — it becomes something else. The catalog is a closed graph of transformations.

### 1.5 Category Taxonomy

```
vegetation/
  tree/       deciduous, conifer, tropical, dead, palm, willow
  bush/       flowering, thorny, berry
  shrub/      low, medium
  hedge/
  grass/      tall, short, reed, aquatic, ornamental
  flower/     wildflower, tropical, mushroom, succulent
  vine/       climbing, hanging, ground_cover
  moss/       rock_moss, tree_moss, ground_moss
  lichen/
  algae/      freshwater, saltwater
  crop/       wheat, vegetable, fruit_tree
  fern/       forest_fern, tropical_fern

mineral/
  rock/       boulder, pebble, crystal, volcanic, sandstone, slate
  cliff_face/
  stalactite/
  ore/        iron, gold, gem, coal

water_feature/
  wave/       ocean_wave, lake_ripple, river_current
  foam/       shore_foam, rapid_foam
  whirlpool/
  waterfall/  cascade, trickle
  splash/     footstep_splash, impact_splash
  puddle/     rain_puddle, standing_water
  ice/        sheet_ice, icicle, frost_pattern

ground_cover/
  leaf_litter/  autumn, dry, wet
  pine_needles/
  sand_drift/   wind_drift, dune_ripple
  snow_drift/   fresh, packed, melting
  mud_patch/    wet, drying, cracked
  ice_sheet/
  ash_layer/    fresh, old
  gravel/
  peat/

structure_natural/
  log/        fallen, hollow, mossy
  nest/       bird, insect, burrow
  den/        cave_entrance, hollow_tree
  coral/      branching, brain, fan
  shell/      conch, clam, scattered
  bone/       skull, rib, scattered
  web/        spider_web, cocoon
  hive/       bee, wasp
```

### 1.6 Individuality & Future Identity System

**Current scope:** Visual variance only. Each ObjectInstance gets an `instance_seed` that drives:
- Scale variance (0.85–1.15×)
- Lean angle (-5° to +5°)
- Color/hue shift (-10° to +10°)
- Branching seed (for trees — fractal variation)
- Leaf/foliage density variation

**Extension point for future agents:** The `variance` block on animate objects is the hook for identity. When the identity system is built:
- Add `identity_id` to ObjectInstance linking to EntitySystem
- Extend variance with `growth_history` (this tree grew near water = taller), `damage_scars` (struck by lightning = scar texture), `relationship_to_neighbors` (crowded forest = thinner canopy)
- ObjectInstance becomes a persistent entity tracked across sessions
- See `data/terrain_objects/schema/EXTENSION_POINTS.md`

---

## 2. Interaction Schema

### 2.1 Interaction Categories

```
traversal/          — entity movement through/past the object
  walk_through        entity enters tile, requires: non_blocking
  run_through         entity sprinting, requires: non_blocking
  swim_past           entity in water, adjacent to object
  fly_over            flying entity above
  land_on             entity descends onto tile
  push_aside          entity walk + object is pushable

player_action/      — deliberate actions by entities (players and NPCs)
  chop                tool=axe, target: vegetation
  mine                tool=pickaxe, target: mineral
  dig                 tool=shovel, target: ground_cover
  pick                hand, target: size=[1,1] + pickable
  burn_ignite         tool=torch OR spell=fire, target: flammable
  freeze_cast         spell=frost
  plant               hand+seed, target: empty_soil
  water               tool=bucket, target: vegetation
  climb               hand, target: climbable + size >= [1,2]

environmental/      — world forces acting on objects
  wind                weather.wind_speed > threshold, intensity scales with speed
  rain                weather.precipitation > 0
  lightning           weather.lightning_strike at tile
  flood               water_level rises into tile
  drought             soil_moisture < threshold over time
  fire_spread         adjacent tile burning + flammable
  erosion             continuous water/wind exposure over time

biome_blending/     — transitions between biome boundaries
  edge_fade           tile is biome boundary, contextual sprites
  submersion          water encroaching on land tile
  overgrowth          vegetation biome advancing into barren

ambient/            — always-on default animations
  idle                always, default loop
  idle_variant        random interval, occasional variation
  day_shift           time_of_day crosses dawn threshold
  night_shift         time_of_day crosses dusk threshold
  seasonal_change     season transition (spring/summer/autumn/winter)

state_reactive/     — animations triggered by state changes
  crack               durability drops below stage threshold
  wilt                lifecycle enters dying phase
  bloom               lifecycle enters mature + spring season
  fruit               lifecycle=mature + season=summer/fall
  regrow              post-chop timer expires, new growth appears
  collapse            durability=0 OR lifecycle=dead + time elapsed
  decompose           dead state + time elapsed
  fungal_growth       dead/decomposing + moisture > threshold
  insect_swarm        decomposing + temperature > threshold
```

### 2.2 Interaction Definition Schema

```json
{
  "id": "chop",
  "category": "player_action",
  
  "trigger": {
    "type": "entity_action",
    "requires_tool": "axe",
    "requires_target": {
      "ontology": "animate",
      "category_prefix": "vegetation",
      "min_phase": "sapling"
    }
  },
  
  "effects": {
    "damage": { "amount": 25, "type": "sharp" },
    "state_transition": null,
    "spawn_products": { "on_destroy": true },
    "particle": "wood_chips",
    "sound": "chop_wood"
  },
  
  "animation": {
    "frames": [4, 8],
    "duration_ms": [300, 600],
    "loop": false,
    "directional": false,
    "intensity_variable": false
  }
}
```

### 2.3 The Multiplication Constraint

The interaction schema constrains the combinatorial space. Not every object supports every interaction — a rock doesn't need `seasonal_change`, grass doesn't need `mine`. Each object's lifecycle phases explicitly list applicable interactions, making the generation matrix tractable.

Estimated valid combinations: ~4,000-6,000 unique animation sets across all objects × phases × interactions.

---

## 3. Biome Affinity Matrix

### 3.1 Biome Affinity Schema

Each of the 18 biomes gets an affinity file defining which objects compose it:

```json
{
  "biome_id": "grassland",
  
  "object_pools": [
    {
      "object_id": "tall_grass",
      "density": 0.45,
      "cluster_mode": "perlin",
      "cluster_scale": 0.3,
      "elevation_range": [0.0, 0.5],
      "moisture_range": [0.3, 0.8],
      "slope_max": 0.3,
      "distance_rules": {
        "min_water": 3,
        "max_water": null,
        "min_road": 2
      },
      "lifecycle_distribution": {
        "seedling": 0.05, "sapling": 0.10, "juvenile": 0.15,
        "mature": 0.50, "old_growth": 0.15, "dying": 0.05
      },
      "variant_count": 5
    },
    {
      "object_id": "wildflower",
      "density": 0.25,
      "cluster_mode": "scatter",
      "elevation_range": [0.0, 0.4],
      "moisture_range": [0.4, 0.9],
      "slope_max": 0.2,
      "distance_rules": { "min_water": 0 },
      "lifecycle_distribution": {
        "bud": 0.15, "blooming": 0.50, "wilting": 0.20, "seed_head": 0.15
      },
      "variant_count": 8
    }
  ],
  
  "ambient": {
    "wind_baseline": 0.3,
    "moisture_baseline": 0.5,
    "light_filter": null
  }
}
```

Each biome will have 15-40 object pool entries covering its full composition.

### 3.2 The 18 Biomes and Their Primary Object Compositions

| Biome | Primary Objects |
|-------|----------------|
| Ocean | ocean_wave, foam, seaweed, coral, fish_shadow, jellyfish, floating_debris |
| Beach | sand_drift, shell, driftwood, sea_grass, tidal_pool, crab_burrow, foam_line |
| Grassland | tall_grass, short_grass, wildflower, scattered_rock, butterfly_bush, ant_mound |
| Forest | deciduous_tree, bush, fern, fallen_log, mushroom, moss_patch, bird_nest |
| Dense Forest | old_growth_tree, thick_vine, giant_fern, hollow_log, mushroom_cluster, spider_web, moss_carpet |
| Desert | cactus, sand_drift, dune_ripple, dry_bush, bleached_bone, scorpion_burrow, heat_shimmer |
| Savanna | acacia_tree, tall_dry_grass, termite_mound, scattered_boulder, dry_bush, watering_hole_edge |
| Steppe | short_dry_grass, cracked_earth, flat_rock, tumbleweed, hardy_shrub, wind_erosion_pattern |
| Tundra | frozen_grass, ice_patch, snow_drift, lichen_rock, frozen_puddle, hardy_moss, permafrost_crack |
| Taiga | conifer_tree, pine_needles, snow_laden_branch, frozen_stream_edge, bear_den, pine_cone_scatter |
| Mountains | cliff_rock, boulder, mountain_flower, scree, cave_entrance, eagle_nest, snow_cap |
| Swamp | cypress_tree, lily_pad, cattail, bubbling_mud, hanging_moss, frog_log, algae_film |
| Tropical Forest | palm_tree, tropical_flower, hanging_vine, parrot_perch, coconut, giant_leaf, orchid |
| Volcanic | volcanic_rock, lava_crack, obsidian_shard, sulfur_vent, charred_tree, ash_layer, ember_glow |
| Arctic | ice_sheet, snow_drift, frozen_crystal, ice_stalactite, penguin_tracks, aurora_glow, frost_pattern |
| Lake | lake_ripple, lily_pad, reed, fishing_spot, submerged_log, dragonfly_perch, pebble_shore |
| River | river_current, riverbed_stone, reed, bank_erosion, fish_jump, driftwood, rapids_foam |
| Mystic | crystal_formation, glowing_mushroom, spirit_wisp, runic_stone, ethereal_vine, mist_pool, arcane_flower |

### 3.3 Biome Transition Table

Transitions define what happens at biome boundaries:

```json
{
  "biome_a": "grassland",
  "biome_b": "forest",
  "blend_width": 4,
  
  "edge_objects": [
    { "object_id": "sparse_sapling", "density": 0.2 },
    { "object_id": "forest_edge_shrub", "density": 0.3 }
  ],
  
  "gradient": {
    "biome_a_objects": "linear_fadeout",
    "biome_b_objects": "linear_fadein"
  }
}
```

```json
{
  "biome_a": "beach",
  "biome_b": "ocean",
  "blend_width": 3,
  
  "edge_objects": [
    { "object_id": "foam_line", "density": 0.8 },
    { "object_id": "wet_sand_patch", "density": 0.5 },
    { "object_id": "tidal_pool", "density": 0.1 }
  ],
  
  "gradient": {
    "biome_a_objects": "linear_fadeout",
    "biome_b_objects": "hard_cutoff"
  }
}
```

With 18 biomes, there are 153 possible pairs. Not all are geographically valid neighbors. Estimated ~40-50 transition definitions needed.

### 3.4 Biome × Biome Interaction Effects

Beyond transitions, biome context modifies how objects behave:

| Object Context | Effect |
|---------------|--------|
| Grass in tundra | Frozen texture, brittle break animation, no sway |
| Grass in river zone | Aquatic variant, flows with current, algae overlay |
| Grass in volcanic area | Charred edges, smoldering, sparse |
| Rock in swamp | Moss-covered variant, slippery, algae growth |
| Tree in arctic | Snow-laden branches, ice crystal overlay, slower growth |
| Flower in mystic | Glowing petals, particle aura, otherworldly color |

These cross-biome modifications are expressed as variant selectors in the affinity matrix — a "grass" object in the tundra affinity file references "frozen_grass" (a separate object) rather than runtime-modifying "tall_grass."

---

## 4. Placement Engine

### 4.1 Two-Layer State Model

**Layer 1: Deterministic Baseline** — Given `world_seed + chunk_position`, the placement engine always produces the exact same arrangement of objects. Same seed = same forest, same rocks, same flowers. This is pure math (Perlin noise with fixed seeds). Never stored — regenerated on load.

**Layer 2: Delta Log** — Every mutation (player chops tree, NPC digs hole, lightning strikes) is recorded as a sparse delta against the baseline. Deltas decay over time — the world heals itself.

### 4.2 Placement Pipeline

```
For each chunk (32×32 cells):

1. BIOME PASS
   Read biome_id per cell from world compiler ChunkData.

2. AFFINITY LOOKUP
   Load BiomeAffinity for each biome present in chunk.

3. ELIGIBILITY FILTER
   For each cell × each object_pool in its biome affinity:
   - elevation in range?
   - moisture in range?
   - slope below max?
   - distance rules satisfied? (water_distance, road proximity from ChunkData)
   → produces eligible_pools[cell] = list of candidates with weights

4. DENSITY SAMPLING
   For each eligible pool:
   - sample noise field (cluster_mode determines noise type)
   - noise seeded by world_seed + object_id hash (consistent per object type)
   - multiply by pool.density × cell.vegetation_density / 255
   - threshold check → place or skip

5. TRANSITION BLENDING
   For cells near biome boundaries:
   - detect boundary via neighbor biome mismatch
   - compute blend_t = distance_into_transition / blend_width
   - fade biome_a pool densities by (1 - blend_t)
   - fade biome_b pool densities by blend_t
   - inject edge_objects from BiomeTransition definition

6. INSTANCE GENERATION
   For each placed object:
   - select lifecycle phase from lifecycle_distribution (weighted random, seeded)
   - select visual variant (1..variant_count, seeded)
   - apply individuality variance (scale, lean, color shift from instance_seed)
   - instance_seed = hash(world_seed, chunk_x, chunk_y, cell_x, cell_y, object_id)
   → produces ObjectInstance record

7. COLLISION REGISTRATION
   Blocking objects register in pathfinding grid.
```

### 4.3 ObjectInstance Record

```json
{
  "object_id": "oak_tree",
  "instance_seed": 48271933,
  "position": [1423, 872],
  "variant": 2,
  "lifecycle_phase": "mature",
  "phase_progress": 0.6,
  
  "scale": 1.07,
  "lean_angle": -2.3,
  "color_shift": 4,
  
  "current_hp": 100,
  "current_state": "alive",
  "active_effects": []
}
```

### 4.4 Delta Log with Entropy Decay

```json
{
  "position": [1423, 872],
  "object_id": "oak_tree",
  "mutation": "chopped",
  "new_state": "stump",
  "timestamp": 10045,
  
  "decay": {
    "type": "regrow",
    "recovery_time": 720,
    "stages": [
      { "at": 0.0,  "state": "stump" },
      { "at": 0.3,  "state": "sprouting_stump" },
      { "at": 0.6,  "state": "sapling" },
      { "at": 1.0,  "state": null }
    ]
  }
}
```

**Decay types:**
- `regrow` — living things grow back (trees, grass, flowers). Full lifecycle restarts.
- `fill` — holes/pits fill in over time. Rain accelerates.
- `erode` — exposed structures weather away. Abandoned walls crumble.
- `permanent` — suppressed while a structure occupies the tile. Settlements prevent regrowth. If structure is removed, decay type reverts to `regrow`.

**On chunk load:**
1. Regenerate deterministic baseline (same objects, always)
2. Load delta log for this chunk from persistent storage
3. For each delta: elapsed = current_game_time - timestamp
4. If elapsed >= recovery_time → discard delta, baseline reasserts
5. If elapsed < recovery_time → compute progress, apply appropriate stage state

**Storage cost:** Proportional to how much the player has changed the world. A virgin world = zero delta data. A heavily explored world accumulates deltas, but entropy continuously prunes them.

### 4.5 Interaction-Specific Delta Examples

| Action | Delta | Decay |
|--------|-------|-------|
| Walk through grass | trample, recovery_time: 0.1 days | Springs back in game-hours |
| Chop mature oak | stump, recovery: 720 days, stages through regrowth | Full tree returns in ~2 game-years |
| Dig pit | hole, recovery: 180 days, fill type, rain accelerates | Pit slowly fills |
| Burn forest | charred_trunk + ash, recovery: 360 days | Scorched earth → pioneer species → forest |
| Build settlement | permanent delta suppresses regrowth | Lifts when structure removed |
| Lightning strike | charred tree, recovery: 120 days | Scar heals, new growth |
| Mine boulder | shattered → break_products, no recovery | Rock chunks persist as new objects |

---

## 5. Animation Framework

### 5.1 Animation Resolution Priority

When the renderer displays an object, it resolves animation through a priority stack:

```
1. ACTIVE EFFECT     — object is burning/frozen/being chopped right now
                       → play one-shot or looping effect animation
                       
2. STATE REACTIVE    — object recently changed state (cracked, wilted, bloomed)
                       → play transition animation, then fall through to ambient
                       
3. ENVIRONMENTAL     — wind/rain/weather active
                       → blend environmental animation with ambient
                       → intensity scales with weather system values
                       
4. AMBIENT           — default idle loop
                       → select variant based on time_of_day + season
```

### 5.2 Animation Compositing

Multiple animation layers can stack simultaneously:

- **replace** — takes over the object's visual entirely (burning, collapse)
- **overlay** — transparent layer on top of current animation (rain drip on swaying tree, moss on rock)
- **additive** — color/light effect blended additively (glow, frost shimmer, firefly)

Max stack: base animation + up to 2 overlays + particle effects.

Example composite: mature oak in wind during rain at night =
- Base: `idle` loop (trunk)
- Blend: `wind_sway` at intensity 0.6 (branches)
- Overlay: `rain_drip` (water particles on canopy)
- Ambient: `night_shift` (darker palette)

### 5.3 Animation Asset Structure

```
assets/catalog/terrain_objects/vegetation/tree/deciduous/oak_tree/
  manifest.json

  variants/
    v1/base.png
    v2/base.png
    v3/base.png

  lifecycle/
    seedling/base.png
    sapling/base.png
    mature/base.png
    dying/base.png
    dead/base.png
    decomposing/base.png

  animations/
    mature/
      idle.json + idle.png
      wind_sway.json + wind_sway.png
      chop_hit.json + chop_hit.png
      burn.json + burn.png
      rain_drip.json + rain_drip.png
      seasonal_spring.png
      seasonal_autumn.png
      seasonal_winter.png
    seedling/
      idle.json + idle.png
      trample.json + trample.png
    dead/
      idle.json + idle.png
      collapse.json + collapse.png
      fungal_growth.json + fungal_growth.png
```

### 5.4 Animation Metadata (.json sidecar)

```json
{
  "id": "wind_sway",
  "interaction_id": "wind",
  "frames": 8,
  "duration_ms": 800,
  "loop": true,
  "directional": false,
  "intensity_variable": true,
  "intensity_range": [0.0, 1.0],
  "blend_mode": "replace",
  "can_composite_with": ["rain_drip", "idle"],
  "pixel_size": 32,
  "anchor": "bottom_center"
}
```

### 5.5 PixelLab vs Godot Responsibilities

- **PixelLab generates:** Individual sprite sheets per animation per lifecycle phase per object. Raw frame sequences as static assets.
- **Godot handles at runtime:** Compositing multiple animation layers, scaling intensity with weather, blending lifecycle transitions, applying individuality variance (color shift, scale, lean), particle effects, z-ordering.

---

## 6. Generation Pipeline

### 6.1 Pipeline Architecture

The generation orchestrator systematically walks the object × interaction × lifecycle matrix and queues PixelLab jobs:

```
1. OBJECT DEFINITION PASS
   For each biome affinity file:
     For each object_pool entry:
       → Object exists in catalog? If not: queue base sprite generation.
       → For each lifecycle phase (animate) or durability stage (inanimate):
         → Phase sprite exists? If not: queue.

2. VARIANT PASS
   For each object with variant_count > 1:
     → All variants exist? If not: queue (same prompt, different seed).

3. ANIMATION PASS
   For each object:
     For each lifecycle phase:
       For each interaction in phase_interactions:
         → Animation spritesheet exists? If not: queue.
         → Build PixelLab prompt from object category + interaction spec + phase context.

4. TRANSITION OBJECT PASS
   For each BiomeTransition:
     For each edge_object: same generation logic.

5. MANIFEST UPDATE
   After each batch: update manifest.json, write .json sidecars, commit.
```

### 6.2 Generation State Tracker

```json
{
  "total_queued": 0,
  "total_completed": 0,
  
  "queue": [
    {
      "object_id": "oak_tree",
      "phase": "mature",
      "asset_type": "animation",
      "interaction": "idle",
      "status": "pending",
      "pixellab_job_id": null,
      "output_path": null
    }
  ]
}
```

Stored at `data/terrain_objects/generation/queue.json`. The pipeline resumes across sessions — check status of pending/generating items, pick up where it left off.

### 6.3 PixelLab Prompt Templates

Stored at `data/terrain_objects/generation/prompts/` per category:

```
vegetation_tree.txt:
  "Top-down pixel art {phase} {species} tree, {variant_desc},
   32x32px, transparent background, suitable for 2D RPG,
   consistent art style with existing tileset"

animation template:
  "Animate: {object_description} performing {interaction_description},
   {frame_count} frames, top-down view, transparent background,
   consistent with base sprite style"
```

### 6.4 Generation Scale

Generate the full matrix — no phasing. All ~200+ base objects × all lifecycle phases × all applicable interactions. Queue ordering optimizes for PixelLab batch efficiency (all variants of one object before moving to next).

### 6.5 Test Character Sprite

Replace the current red cube player sprite with an actual character. Either wire up an existing asset from `assets/characters/` (hero_knight, villager_female) or generate a fresh layered base body via PixelLab. This enables visual testing of all terrain object interactions from a player perspective.

---

## 7. File Organization

### 7.1 Data Directory Structure

```
data/terrain_objects/
  schema/
    README.md                    # "START HERE" for future agents
    object_schema.json           # JSON schema for object definitions
    interaction_schema.json      # JSON schema for interactions
    affinity_schema.json         # JSON schema for biome affinities
    transition_schema.json       # JSON schema for biome transitions
    EXTENSION_POINTS.md          # hooks for identity, weather, seasons, buildings

  objects/                       # Object Catalog
    vegetation/tree/deciduous/oak_tree.json
    vegetation/tree/conifer/pine_tree.json
    vegetation/grass/tall_grass.json
    mineral/rock/boulder/granite_boulder.json
    water_feature/wave/ocean_wave.json
    ground_cover/leaf_litter/autumn_leaves.json
    structure_natural/log/fallen_log.json
    ... (~200+ files)

  interactions/                  # Interaction Schema
    traversal/walk_through.json
    player_action/chop.json
    environmental/wind.json
    ambient/idle.json
    state_reactive/bloom.json
    biome_blending/edge_fade.json
    ... (~30 files)

  affinities/                    # Biome Affinity Matrix
    ocean.json
    beach.json
    grassland.json
    forest.json
    ... (18 files)

  transitions/                   # Biome Transition Table
    grassland_forest.json
    beach_ocean.json
    ... (~40-50 files)

  generation/
    queue.json                   # generation state tracker
    log.json                     # completed generation history
    prompts/                     # PixelLab prompt templates
      vegetation_tree.txt
      vegetation_grass.txt
      mineral_rock.txt
      water_feature.txt
```

### 7.2 Asset Directory Structure

```
assets/catalog/terrain_objects/
  vegetation/
    tree/deciduous/oak_tree/
      manifest.json
      variants/v1/base.png, v2/base.png, v3/base.png
      lifecycle/seedling/base.png, mature/base.png, dead/base.png
      animations/mature/idle.png+json, wind_sway.png+json, chop_hit.png+json
    tree/conifer/pine_tree/
      ...
    grass/tall_grass/
      ...
  mineral/
    rock/boulder/granite_boulder/
      ...
  water_feature/
    wave/ocean_wave/
      ...
  ground_cover/
    ...
```

### 7.3 Extension Points Documentation

`data/terrain_objects/schema/EXTENSION_POINTS.md` documents hooks for future systems:

**Identity System:** Add `identity_id` to ObjectInstance, extend variance with growth_history/damage_scars. Hook: object_schema.json → variance block.

**Weather Integration:** Environmental interactions read weather.wind_speed, weather.precipitation, etc. Hook: interactions/environmental/*.json → trigger.weather_field. Delta recovery_time modified by weather.

**Seasonal System:** Lifecycle phases can be season-locked (bloom only in spring). Hook: object lifecycle.phases can have season_locked flag. Animation sets include seasonal overlays.

**Building Integration:** Inanimate durability + break_products extends to walls/floors/doors. Settlement footprint = permanent delta suppressing regrowth. Hook: same object schema, category "structure/".

**NPC Interaction:** Same interaction triggers apply to NPC entity_actions. NPC goal graph references object_ids as targets. Hook: interactions/player_action/ applicable to all entities.

### 7.4 README.md (Start Here)

`data/terrain_objects/schema/README.md` — single-file overview for future agents:
- What the system is (three-axis relational model)
- The three axes and where their data lives
- Key concepts (animate/inanimate, lifecycle/durability, deterministic baseline + deltas)
- File flow: schema → data → PixelLab → assets → placement engine → renderer
- Extension points reference

---

## 8. Integration with Existing Systems

### 8.1 World Compiler

The existing WorldCompiler (14-layer pipeline) already produces per-cell data that the placement engine consumes:
- `biome_id`, `elevation`, `vegetation_density`, `vegetation_species`
- `slope`, `fertility`, `precipitation`
- `water_distance`, `ocean_distance` (BFS computed)
- `road_cells`, `pois`, `structures`

No changes needed to the world compiler. The placement engine reads its output.

### 8.2 DeferredRenderer

Currently renders objects via hardcoded biome→sprite mapping in `_render_object_sprites()` and `_render_detail_decorations()`. This will be replaced by the affinity-driven placement engine. The z-layer structure (L6 objects, L7 details) remains.

### 8.3 MapObjectRenderer

Currently scans `assets/catalog/objects/` directories and applies biome-tag matching via filename parsing. Will be superseded by the structured manifest system. Existing assets in `assets/catalog/objects/` can be migrated into the new `assets/catalog/terrain_objects/` structure.

### 8.4 Delta Persistence

Chunk deltas stored as JSON files per chunk region:
```
data/world_state/deltas/chunk_{x}_{y}.json
```
Loaded on chunk stream-in, pruned of expired entries, saved on chunk stream-out or periodic autosave.
