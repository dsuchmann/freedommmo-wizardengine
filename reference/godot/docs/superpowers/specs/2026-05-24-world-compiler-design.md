# World Compiler Architecture — Layered Emergent World Generation

**Date**: 2026-05-24
**Status**: Active
**Priority**: #1 — replaces current scatter-placement worldgen
**Based on**: Deep research report + Freedom design docs + freedommmo specs

## Problem Statement

The current world generation produces visual chaos and freezes Godot:

1. **Scatter placement**: Objects placed randomly on flat terrain with no spatial logic
2. **Buildings as sprites**: Single PNGs dropped on terrain — no interiors, no walls, no doors
3. **Node explosion**: ~250-350 Sprite2D nodes created synchronously on one frame → freeze
4. **No spatial coherence**: NPCs float randomly, roads don't exist, nothing connects to anything
5. **No determinism**: Different runs produce different chaos — no seed-based regression

## Solution: Layered World Compiler

Replace scatter-placement with a **deterministic compilation pipeline** where each layer consumes the output of previous layers. Every world feature has a reason to be where it is. Same seed = same world. Every layer has debug views and validation.

## Core Rules

1. **Claude may author generators, schemas, importers, validators, tests, and debug scenes. Claude may NOT directly place final world content from prose.** All content emerges from deterministic maps, feature lists, and entity graphs.
2. **Buildings are spatial structures, not sprites.** Walls are impassable tiles. Doors are passable gaps. Interiors exist on the world grid. Roofs fade when entered. No loading screens.
3. **Every placed feature stores reason codes.** A settlement exists because of water access + fertile land + road junction, not because of `randi_range()`.
4. **Same seed + same compiler version = identical world.** Hash-verified determinism.
5. **Each layer has typed inputs, typed outputs, debug views, and validation tests.**

## Pipeline Dependency Order

```
Seed
 ├─→ L1: Elevation (continental noise + ridges)
 │    └─→ L2: Ocean Mask (sea threshold + coastlines)
 │         ├─→ L3: Drainage Preprocessing (Priority-Flood pit handling)
 │         │    └─→ L4: Rivers & Lakes (D8 flow + accumulation)
 │         └─→ L5: Climate (temperature + precipitation)
 │              └─→ L6: Biomes (Whittaker lookup)
 │                   ├─→ L7: Soil & Fertility
 │                   │    └─→ L8: Vegetation (density + species)
 │                   └─→ L9: Coastal Materials (beaches, dunes, cliffs)
 │
 ├─→ L10: Roads & Paths (A* least-cost on terrain cost map)
 ├─→ L11: Settlements & Ports (scored suitability + reason codes)
 │    └─→ L12: Farms & Industry (resource + transport logic)
 │
 ├─→ L13: POIs (explainable triggers: waterfalls, crossroads, ruins)
 └─→ L14: Event Log & Narrative Interpreter
```

## Layer Specifications

### L1: Elevation

**Inputs**: World seed, chunk coordinates
**Outputs**: Float32 elevation grid, mountain mask, slope grid
**Algorithm**: Hash-derived sub-seeds → multiple FastNoiseLite channels:
- Low-frequency simplex + domain warp for continents
- Ridged fractal for mountain spines
- Cellular breakup for regions
**Validation**: Border seams stable across chunk reload; no one-cell spikes; mountain mask coherent at multi-chunk scale
**Debug view**: Elevation heatmap (smooth continental massing, ridges, valleys)
**Failure mode**: "Noise confetti" — when octave weights are wrong, mountains become pepper noise

### L2: Ocean Mask

**Inputs**: Elevation grid, sea-level parameter
**Outputs**: Binary ocean/land mask, coastline class map
**Algorithm**: Apply sea threshold. Coastline classes (cliff, beach, marsh) derived from slope at coast edge.
**Validation**: Coastline continuous; all ocean connected to world edge unless explicit inland sea
**Debug view**: Clean coastlines, valid inland seas only by rule
**Failure mode**: Pepper-noise lakes when threshold is at noise floor

### L3: Drainage Preprocessing

**Inputs**: Elevation grid, ocean mask
**Outputs**: Hydrologically corrected elevation, basin IDs
**Algorithm**: Priority-Flood (Barnes et al.) — guarantees drainage after preprocessing. Every land cell drains to outlet or explicit terminal basin.
**Validation**: No unflagged inland pits; every cell has drainage path
**Debug view**: Basin ID coloring (large coherent drainage basins)
**Failure mode**: Fragmented micro-basins everywhere

### L4: Rivers & Lakes

**Inputs**: Corrected elevation, basin IDs, ocean mask
**Outputs**: River polylines with order (Strahler), lake polygons, outlets
**Algorithm**: D8 flow direction (steepest downslope neighbor). Rivers start above configurable accumulation threshold. Lakes form in closed depressions or terminal basins.
**Validation**: River elevation decreases monotonically to outlet; lakes have explicit outlet or terminal status; every river mouth classified
**Debug view**: River order visualization (thickening channels downstream)
**Failure mode**: Rivers originating from tiny flat cells; rivers flowing uphill

### L5: Climate

**Inputs**: Latitude, elevation, ocean distance, mountain barriers, water bodies
**Outputs**: Temperature grid, precipitation grid, seasonality scalars
**Algorithm**: Latitude baseline → elevation penalty → moisture from coasts/water → rain-shadow reduction leeward of mountains
**Validation**: No frozen equatorial lowlands unless altitude; no rainforest precipitation in deep rain shadows
**Debug view**: Temperature and rainfall with legible latitude/elevation patterns
**Failure mode**: Hot alpine peaks, wet rain-shadow deserts

### L6: Biomes

**Inputs**: Temperature, precipitation, soil/water modifiers
**Outputs**: Biome ID grid, ecotone mask
**Algorithm**: Whittaker-style lookup table. Merge with ecotones where gradients are shallow. Data-driven, not nested if/else.
**Validation**: Transition zones visible; assignment explainable from local climate
**Debug view**: Biome map with coherent patches and visible transitions
**Failure mode**: Checkerboard biome flicker from sharp thresholds

**Supported biomes**: grassland, forest, dense_forest, desert, mountains, tundra, swamp, savanna, taiga, tropical_forest, steppe, volcanic, beach, ocean, river, lake, arctic

### L7: Soil & Fertility

**Inputs**: Elevation, slope, water proximity, floodplain deposition, biome
**Outputs**: Soil class grid, fertility grid (0-255)
**Algorithm**: Parent material from terrain class. Boost floodplains and river terraces. Suppress on steep rock, dunes, alpine.
**Validation**: Fertility peaks in valleys/floodplains near stable water, not on steep mountain faces
**Debug view**: Fertility heatmap
**Failure mode**: Fertile cliff walls, barren floodplains

### L8: Vegetation

**Inputs**: Biome, fertility, slope, water distance, disturbance events
**Outputs**: Vegetation density grid, species class map, foliage feature list
**Algorithm**: Separate potential vegetation (what could grow) from actual vegetation (what does grow after disturbance). Settlements and events reduce/reshape later.
**Validation**: Forest density tracks fertile wet bands; scrub dominates dry coasts
**Debug view**: Vegetation density with forest/scrub/barren bands
**Failure mode**: Dense jungle on dunes, alpine scree with forests

### L9: Coastal Materials

**Inputs**: Elevation, ocean mask, slope, wind/dryness heuristics, vegetation
**Outputs**: Coast material grid (beach, cliff, marsh, dune), dune mask
**Algorithm**: Beaches require coast adjacency + low slope. Dunes require coast + dryness + sparse vegetation.
**Validation**: No sand on cliff coasts; dune fields never overwrite dense forest
**Debug view**: Coast material classification
**Failure mode**: Beaches on cliffs, dunes in forests

### L10: Roads & Paths

**Inputs**: Terrain cost map, rivers, slope, vegetation, settlement locations
**Outputs**: Trail graph, road graph, bridges/fords list
**Algorithm**: AStarGrid2D for chunk-local least-cost routes. Penalize steep slopes, marsh, dense forest, river crossings without bridges.
**Validation**: All graph edges have cost provenance; no road crosses impassable cells without crossing feature
**Debug view**: Road cost map + road graph overlay
**Failure mode**: Straight roads through swamps and cliffs

### L11: Settlements & Ports

**Inputs**: Suitability maps (water, fertility, defensibility, trade centrality, climate), road network, coastline
**Outputs**: Settlement entities with reason codes, port entities, building footprints
**Algorithm**: Score cells by multiple criteria. Place settlements at local maxima. Ports require coast + navigable water + trade rationale. Size determined by resource capacity.

**Building compilation** (critical — buildings are spatial structures, not sprites):
1. Select building template by type + biome + settlement tier
2. Stamp wall tiles on world grid (impassable, walkability = -1)
3. Stamp floor tiles inside footprint (wood/stone, walkability = 1.0)
4. Place door gap in wall (walkability = 0.8)
5. Place interior features by building type rules (forge, bed, table, chest)
6. Add roof canopy at high z-index (alpha-fades when player enters)
7. Assign NPC slots (blacksmith → forge tile, sleeps → bed tile)

**Validation**: Every settlement has reason codes + reachable transport to exchange node
**Debug view**: Settlement suitability heatmap + placed settlements with reason codes
**Failure mode**: Settlements on bad terrain without rationale

### L12: Farms & Industry

**Inputs**: Settlements, fertility, resource deposits, transport graph
**Outputs**: Field polygons, extraction sites, workshops, throughput edges
**Algorithm**: Farms expand outward from settlements into fertile accessible land. Industry anchors to resources and transport. All outputs are entities with production inputs/outputs.
**Validation**: Each farm/industry node has owner, input requirements, transport rationale
**Debug view**: Farm polygons + industry nodes + throughput connections
**Failure mode**: Farms on mountains, mines with no transport path

### L13: POIs

**Inputs**: Terrain anomalies, transport intersections, ruins logic, faction state
**Outputs**: POI entities with trigger records, local compound bounds
**Algorithm**: Spawn from explainable triggers: waterfalls, river crossings, mineral cues, trade junctions, isolated plateaus, abandoned settlements.
**Validation**: No POI appears without a trigger record
**Debug view**: POI markers with trigger type labels
**Failure mode**: Random POIs with no spatial logic

### L14: Event Log & Narrative Interpreter

**Inputs**: World ticks, entity state diffs, settlement/POI/economy events
**Outputs**: Append-only event log, narrative artifacts (rumors, quests, chronicles)
**Algorithm**: Log state changes as first-class data objects with causes, actors, location, effects. Interpreter reads events → generates narrative artifacts with provenance back to event IDs. Interpreter NEVER places facts directly.
**Validation**: Every rumor/quest references event IDs and entity IDs; no free-floating narrative
**Debug view**: Event density heatmap + provenance links
**Failure mode**: Narrative artifacts with no source events

## Building Architecture (Seamless Entry, No Loading Screens)

### Building Template Schema
```json
{
  "template_id": "forge",
  "category": "workshop",
  "footprint": { "width": 4, "height": 5 },
  "walls": {
    "material": "stone",
    "pattern": "perimeter",
    "doors": [{ "side": "south", "offset": 1, "width": 1 }],
    "windows": [{ "side": "east", "offset": 2 }]
  },
  "floor": { "material": "stone_slab" },
  "roof": { "material": "thatch", "style": "peaked" },
  "interior_features": [
    { "type": "forge_station", "pos": [1, 1], "provides": ["smelting", "smithing"] },
    { "type": "anvil", "pos": [2, 1], "provides": ["metalworking"] },
    { "type": "workbench", "pos": [1, 2], "provides": ["crafting"] },
    { "type": "storage_chest", "pos": [3, 3], "provides": ["storage"] },
    { "type": "bed", "pos": [1, 4], "provides": ["rest"] }
  ],
  "requires": {
    "settlement_tier_min": "village",
    "population_min": 10,
    "nearby": ["ore_deposit", "trade_route"]
  },
  "npc_slots": [
    { "role": "blacksmith", "workplace": "forge_station", "sleep": "bed" }
  ]
}
```

### Rendering Layers (Z-Order)
| Z | Layer | Content | Visibility |
|---|-------|---------|------------|
| -1 | Terrain | Grass, dirt, stone tiles | Always |
| 0 | Floor | Interior wood/stone planks | Always |
| 1 | Ground objects | Barrels, flowers, rugs | Always |
| 2 | Walls | Rendered as tile sprites, block movement | Always |
| 3 | Entities | Player, NPCs, doors — y-sorted | Always |
| 4 | Tall objects | Tree canopy, tall furniture | Always |
| 5 | Roof canopy | Fades when player enters building | Alpha-fades |
| 6 | Weather/particles | Rain, snow, lighting overlays | Always |

### Roof Fade Logic
When player's world position is inside a building footprint:
- Lerp roof alpha from 1.0 → 0.0 over 0.3 seconds
- Interior becomes visible
- Interior lighting activates (warmer PointLight2D)
- NPCs inside become visible and interactable

When player exits:
- Lerp roof alpha from 0.0 → 1.0 over 0.3 seconds

## Chunk System

### Chunk Size
256x256 cells per chunk. Each cell = one world tile at 32px.

### Chunk Schema
```json
{
  "chunk_id": "cx_004_cy_-003",
  "world_seed": "world-2026-alpha",
  "compiler_version": "0.1.0",
  "origin_cell": [1024, -768],
  "size_cells": [256, 256],
  "layer_seeds": {
    "elevation": "h_elev_a91d",
    "hydrology": "h_hydro_0b74",
    "climate": "h_clim_4ea1",
    "civil": "h_civil_078c"
  },
  "grids": {
    "elevation": { "encoding": "float32", "range": [-1.0, 1.0] },
    "ocean_mask": { "encoding": "bitset" },
    "flow_dir_d8": { "encoding": "uint8" },
    "temperature": { "encoding": "float32" },
    "precipitation": { "encoding": "float32" },
    "biome_id": { "encoding": "uint16" },
    "fertility": { "encoding": "uint8" },
    "vegetation_density": { "encoding": "uint8" },
    "walkability": { "encoding": "float32" },
    "settlement_suitability": { "encoding": "uint16" }
  },
  "features": {
    "rivers": [],
    "lakes": [],
    "roads": [],
    "coast_segments": []
  },
  "entities": [],
  "metrics": {
    "hydrology_ok": true,
    "connectivity_ok": true,
    "deterministic_hash": "sha256:..."
  }
}
```

### Deferred Rendering
Chunks render across multiple frames to prevent freezes:
1. Frame 1: Generate grid data (pure computation, no nodes)
2. Frame 2: Render terrain TileMapLayer
3. Frame 3: Render floor tiles and walls
4. Frame 4: Render nature objects (trees, rocks)
5. Frame 5: Render decorations and ground details
6. Frame 6: Spawn NPC markers
7. Frame 7+: Spawn interior features as player approaches

Use `await get_tree().process_frame` between each phase. Never create >50 nodes per frame.

## Integration with Existing Systems

### What Gets Replaced
| Current | Replaced By | Reason |
|---------|-------------|--------|
| terrain_generator.gd scatter | L1-L6 pipeline | Random noise → layered compilation |
| village_generator.gd hardcoded offsets | L11 scored placement | Fixed offsets → suitability scoring |
| feature_placement.gd random scatter | L8 vegetation + L13 POIs | Random → rule-based |
| map_object_renderer.gd building sprites | L11 spatial structures | Sprite images → tile-based buildings with interiors |
| tile_renderer.gd pixel rendering | tilemap_renderer.gd (kept) | Pixel grid → 32px PixelLab tiles |

### What Gets Kept
| Current | Status | Changes |
|---------|--------|---------|
| structure_system.gd | Keep | Add interior features, walkability stamping |
| pathfinding.gd | Keep | Add structure costs, improve heuristic |
| tilemap_renderer.gd | Keep | Read from compiler grid output instead of raw grain stacks |
| composable_renderer.gd | Refactor | Move anatomy to asset gen, keep layer composition |
| All 42 WorldManager systems | Keep | Wire to compiler output instead of scatter data |

### Grain Stack Integration
The L0-L2 grain model (already designed in `docs/superpowers/plans/2026-05-24-L0-grain-data-model.md`) provides the atomic data model. The world compiler layers populate grain stacks:
- L1 (elevation) → bedrock, stone, gravel grain stacks
- L4 (rivers) → water grain on top of riverbed
- L6 (biomes) → surface grain templates (grass, sand, snow, etc.)
- L7 (soil) → soil grain layers between bedrock and surface
- L8 (vegetation) → organic grain markers for trees, moss, etc.
- L11 (buildings) → structure grain types for walls, floors, doors

### Time System Integration
From the Freedom design docs:
- Entities spawned by L11 (settlements) get time pools calculated from age/life stage
- Time consumption rates: Fetus 0.1x → Elderly 2.0x with death scaling at 70+
- Time transfer efficiencies: Consumption 30%, Sharing 95%, Trading 85%, Inheritance 90%
- Group time generation multipliers: Family 2.0x, Village 1.5x, Guild 1.2x

### Causal Tracking Integration
- L14 event log feeds into existing CausalTracker system
- Every settlement placement, road creation, NPC assignment recorded as causal event
- NPC decisions at compiled locations feed back into narrative interpreter
- Player actions modify compiled world state (dig, build, destroy)

## Debug Toggles (All Required Before Implementation)

| Toggle | What It Shows |
|--------|---------------|
| F1: Elevation | Heatmap of elevation values |
| F2: Ocean/Land | Binary mask with coastline classes |
| F3: Drainage | Basin IDs as distinct colors |
| F4: Flow | D8 arrows showing water flow direction |
| F5: Rivers/Lakes | River polylines with Strahler order, lake polygons |
| F6: Temperature | Latitude/altitude temperature gradient |
| F7: Precipitation | Rainfall with rain-shadow effects |
| F8: Biomes | Biome zones with ecotone transitions |
| F9: Fertility | Soil quality heatmap |
| F10: Vegetation | Density map with species classes |
| F11: Roads | Cost map + road graph overlay |
| F12: Settlements | Suitability heatmap + placed settlements with reason codes |
| F13: Walkability | Passable/impassable overlay with costs |
| F14: Events | Event density + provenance links |

## Validation Rules

| Check | Condition | Failure = |
|-------|-----------|-----------|
| Determinism | Same seed + version = identical hash | Regression |
| Chunk seams | Border cells match neighbor within epsilon | Visual tearing |
| Hydrology | Every land cell drains to ocean or terminal basin | Orphan water |
| Rivers | Elevation decreases monotonically to outlet | Uphill rivers |
| Climate | No frozen equatorial lowlands without altitude cause | Incoherent climate |
| Biomes | No checkerboard flicker between neighbors | Threshold noise |
| Settlement | Every settlement has reason codes + transport path | Random placement |
| Buildings | Every building has walls, door, interior, roof | Sprite decorations |
| NPCs | Every NPC has home, workplace, daily schedule | Floating entities |
| Narrative | Every quest/rumor references event IDs | Hardcoded lore |

## PixelLab Asset Pipeline

PixelLab generates **primitives only**, not compositions:
1. **Terrain tiles** (32x32 seamless) via `create_tiles_pro()` — per biome
2. **Wall tiles** (32x32) — stone, wood, thatch, brick per biome
3. **Floor tiles** (32x32) — wood plank, stone slab, carpet, dirt per building type
4. **Roof tiles** (32x32) — thatch, shingle, slate per biome
5. **Interior features** via `create_map_object()` — forge, anvil, bed, table, chest
6. **Nature objects** via `create_map_object()` — trees, rocks, bushes per biome
7. **Characters** via `create_character()` — layered body + equipment overlays

All assets stored with manifests in `assets/generated/` with prompt, biome, tile size, and import target recorded.

## Milestones

### M0: Spec Pack (this document + schemas)
- Compiler charter, layer contracts, debug toggle list, validation rules
- No code — just specs and schemas
- **Acceptance**: All layers have typed I/O and at least one validation rule

### M1: Engine Scaffolding
- WorldCompiler class, ChunkData resource, seed hashing utility
- Empty debug scene with toggle hotkeys
- Test harness for deterministic regression
- **Acceptance**: Same seed produces identical stub outputs; resources save/reload

### M2: Terrain + Hydrology (L1-L4)
- Elevation, ocean mask, drainage, rivers, lakes
- Debug views: elevation heatmap, ocean mask, flow arrows, river visualization
- **Acceptance**: Rivers flow downhill; no unflagged pits; chunk seams stable

### M3: Climate + Ecology (L5-L9)
- Temperature, precipitation, biomes, soil, vegetation, coastal materials
- Debug views: temperature, rainfall, biome map, fertility, vegetation density
- **Acceptance**: No frozen equatorial lowlands; forests track wet fertile bands

### M4: Transport + Settlement (L10-L12)
- Roads, settlements with scored placement, building compilation (spatial structures with interiors)
- Debug views: road cost map, settlement suitability, walkability grid
- **Acceptance**: Every settlement has reason codes; buildings have walls/doors/interiors; roads follow valleys

### M5: POIs + Narrative (L13-L14)
- POI spawning from triggers, event log, narrative interpreter
- Debug views: POI triggers, event density, provenance links
- **Acceptance**: No POI without trigger; no narrative without event source

### M6: Art + CI Hardening
- PixelLab manifests for all tile types, screenshot regression, GdUnit4 tests
- **Acceptance**: PR can regenerate seed corpus, publish screenshots, fail on regression

## Non-Goals

- Multiplayer networking (handled separately by existing NetworkManager)
- Player authentication (existing AuthManager)
- Combat mechanics (existing CombatSystem — just needs to read compiled world)
- Dialogue/LLM integration (existing DialogueEngine — just needs NPC locations)
- UI panels (existing 16 UI scripts — just need compiled data sources)

## File Structure

```
scripts/core/world_compiler/
  world_compiler.gd          # Main pipeline orchestrator
  chunk_data.gd              # ChunkData Resource class
  layer_base.gd              # Base class for all layers
  layers/
    elevation.gd             # L1
    ocean_mask.gd            # L2
    drainage.gd              # L3
    rivers_lakes.gd          # L4
    climate.gd               # L5
    biomes.gd                # L6
    soil_fertility.gd        # L7
    vegetation.gd            # L8
    coastal_materials.gd     # L9
    roads.gd                 # L10
    settlements.gd           # L11
    farms_industry.gd        # L12
    pois.gd                  # L13
    event_log.gd             # L14
  building_compiler.gd       # Compiles building templates → world tiles
  debug/
    debug_overlay.gd         # F1-F14 toggle system
    layer_visualizer.gd      # Renders grid data as colored overlays
  validation/
    chunk_validator.gd       # Runs all validation checks
    determinism_checker.gd   # Hash comparison for regression
data/
  building_templates/        # JSON building definitions
  biome_tables/              # Whittaker lookup, grain stack templates
  schemas/                   # JSON Schema definitions for all data
```
