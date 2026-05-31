# FreedomMMO Migration Brief — Godot Specs → Wizard Genie

## Source specs read

Imported specs folder contains 26 design/spec files plus `.gitkeep`. The combined source was read from `specs_combined.tmp.txt` and covers architecture, vertical slice, visual slice, world compiler, agent swarm, color algebra tiles, layer architecture, overmap streaming, tile/object systems, tileset framework, visual quality, asset pipeline, biome manifests, dynamic lighting, performance, runtime compositor, subterranean systems, world biomes, elevation/cliffs, hypergraph terrain, terrain shading, PixelLab audit, terrain objects, biome layer stack, Unity migration handoff, and terrain cleanup.

## Game identity

**FreedomMMO** is a simulation-first 2D MMORPG/world simulation. The central rule is that visuals are projections of simulation state, not authored tile decorations. A tile is a stack of composable layers/materials/properties. Time is the primary resource. NPCs are complete lifecycle entities rather than simple enemies.

## Core design principles

- Deterministic world generation from a single seed.
- World represented as simulation data/hypergraph/layer stacks; tilemap is a rendering projection.
- Terrain, biomes, objects, structures, lighting, and entities derive from composable data layers.
- Large world streamed by chunks; only nearby chunks are active/rendered.
- Visual quality comes from coherent tilesets, transitions, layered objects, lighting, and runtime compositing.
- Performance is achieved through chunk caching, baking, LOD, atlas use, and avoiding per-object rendering when possible.

## Important world scale targets from specs

- Overmap: 6,400 × 6,400 chunks.
- Chunk: 64 × 64 tiles.
- Tile: 32px in original Godot design.
- Loaded region target: roughly 5×5 to 7×7 chunks depending on system.
- Determinism: seed + coordinates must produce identical terrain.

## Major systems to rebuild/adapt

### 1. Deterministic world generation

Generate terrain from seed, coordinates, and layered noise. Include climate, elevation, biome, moisture, temperature, rivers/coasts, and local terrain features.

### 2. Layer-stack tile model

Represent each tile as stacked properties/layers rather than a single sprite:

- Base material/terrain.
- Biome layer.
- Elevation/slope/cliff data.
- Surface/debris/detail layers.
- Objects and structures.
- Lighting/visibility overlays.

### 3. Chunk compiler

Compile simulation data into render-ready chunk grids. This is the central adapter between deterministic world state and visual rendering.

### 4. Overmap streaming

Maintain a camera/player-centered loaded chunk set. Generate, cache, unload, and reuse chunks deterministically.

### 5. Terrain rendering

Wizard Genie version should begin with canvas/WebGL tile rendering using generated colors and simple atlas-style sprites, then graduate to richer PixelLab-like tiles, Wang transitions, object overlays, and lighting.

### 6. Biome system

Support ocean, beach, grassland, forest, deep forest, dry grass/savanna, desert, hills, rock/mountains, snow, tundra/arctic, wetlands, subterranean zones, and transition bands.

### 7. Tileset/transition framework

Original specs emphasize Wang/autotile transitions for material boundaries such as ocean↔beach, beach↔grass, grass↔forest, grass↔dry grass, dry grass↔rock, rock↔snow, forest↔deep forest, tundra↔snow, ice↔snow, and biome/climate transitions.

### 8. Terrain object system

Objects are biome-aware and layer-aware: grass tufts, shrubs, trees, rocks, logs, flowers, foam, wet sand, tidal pools, cliffs, ruins, structures, etc. Object density should be deterministic and LOD-aware.

### 9. Runtime compositor / visual projection

Visual tile output is built from layers, masks, transitions, overlays, lighting, and objects. The renderer should never be the source of truth.

### 10. Dynamic lighting

Day/night, ambient lighting, local light sources, visibility, and tone/color shifts should be added after core terrain and movement work.

### 11. Agent/NPC simulation

Agents have lifecycles, needs, time budgets, decisions, and interactions with world resources. This should come after a playable terrain/navigation slice.

### 12. Subterranean/elevation/cliffs

Specs include underground spaces, elevation hypergraph terrain, cliff rendering, terrain shading, and cleanup work. These are later-phase systems unless required for the first playable slice.

## Recommended Wizard Genie implementation path

### Phase 1 — First playable terrain slice

Deliver an explorable deterministic world with:

- `index.html` entry point.
- Canvas or Three.js orthographic 2D renderer.
- Seeded noise/random functions.
- Chunk generation around player.
- 64×64 logical chunks internally, but render only visible tiles.
- Player movement with WASD/arrow keys.
- Basic biome coloring: ocean, beach, grass, forest, hills, mountain, snow.
- Chunk coordinate/debug overlay.

### Phase 2 — Layer-stack compiler

Add explicit tile records and chunk compiler:

- Elevation, moisture, temperature.
- Biome classification.
- Terrain material.
- Walkability/cost.
- Object spawn candidates.
- Render projection separated from source state.

### Phase 3 — Objects and transitions

Add deterministic object placement and visual transitions:

- Trees, rocks, shrubs, flowers, driftwood/foam near coasts.
- Simple autotile/edge blending or neighbor-aware tile variants.
- LOD for far chunks.

### Phase 4 — Simulation hooks

Add early systems for:

- Time/day cycle.
- NPC agent placeholders.
- Resource nodes.
- Interaction/persistence stubs.

### Phase 5 — Visual polish

Add:

- Lighting/tinting.
- Better terrain shading.
- Cliff/elevation indications.
- Asset atlas or procedural sprites.
- UI panels and minimap/overmap.

## Immediate next build target

Create a first playable vertical slice in Wizard Genie: a deterministic, scrolling, top-down 2D world renderer with chunk streaming, biome generation, player movement, and debug UI. This preserves the core architecture while avoiding premature porting of Godot-specific scripts.

## Godot-specific concepts to translate

- GDScript systems → JavaScript modules/classes.
- Godot TileMap/ImageTexture rendering → Canvas/WebGL/Three.js renderer.
- Godot resources/manifests → JSON/JS data objects.
- GDExtension optimization plans → later JS performance passes using caching, typed arrays, offscreen canvases, and batching.
- Sprite2D object spam → baked chunk layers and LOD.

## Risks and constraints

- Full MMO scope is large; first implementation must be a vertical slice.
- Original specs rely on large asset catalogs; initial version should use procedural/color/primitive art until assets are available.
- Browser performance requires careful chunk culling and caching.
- Simulation must remain authoritative over visuals to honor the design.
