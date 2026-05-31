# Subterranean Systems — Design Overview

> Established 2026-05-26. Living document — will be expanded as each phase is implemented.

## Core Concept

The world has multiple Z-levels sharing the same XY coordinate space. The surface is Z=0. Below it are cave networks, basements, dungeons, and underground settlements at Z=-1 and deeper. Movement between levels is seamless — walk into a cave entrance, descend stairs, fall into a pit. No loading screens.

## Z-Level Architecture

```
Z-Level  0: Surface (current — terrain, buildings, objects, NPCs)
Z-Level -1: Shallow underground (caves, basements, shallow dungeons)
Z-Level -2: Deep underground (deep caves, large dungeons)
Z-Level -3: Abyssal (deep networks, rare, dangerous)
```

Each Z-level uses the same ChunkData structure, same chunk streaming, same coordinate system. The player has a `current_z_level` property. The renderer displays whichever level the player is on.

## Implementation Phases

### Phase 1: Z-Level Infrastructure (DO FIRST — even before cave generation)
- Add `z_level: int = 0` field to ChunkData
- Add `current_z_level: int = 0` to player state
- ChunkStreamer keys chunks by `(chunk_x, chunk_y, z_level)` instead of `(chunk_x, chunk_y)`
- Renderer swaps displayed chunks when z_level changes
- Transition tiles: entrance/exit markers that trigger z_level change on player contact
- **This is a small architectural change that future-proofs everything**

### Phase 2: Cave Network Generation (Z=-1)
- New `CaveLayer` in the world compiler
- Uses inverted noise to carve tunnels and chambers from solid rock
- Terrain rules determine WHERE caves exist on the surface:
  - Steep cliff faces and mountain bases
  - Karst-like terrain (high moisture + certain elevation bands)
  - Volcanic regions (lava tubes)
- Cave properties: width (narrow tunnels to wide chambers), branching factor, depth
- Surface tiles at entrance locations get cave opening sprites
- Cave interior rendered with rock wall tiles, stalactites, floor variations
- Lighting: caves are dark by default, lit only by:
  - Ambient bioluminescence (faint, blue-green)
  - Player-carried light source
  - Natural light near entrances (fades with distance)
  - Artificial lights placed by underground settlements

### Phase 3: Underground Caverns and Settlements
- A meaningful number (~6-12) of very large open cavern spaces
- These serve as underground cities/settlements with their own culture
- Generated at locations where cave networks converge
- Features unique to underground:
  - Underground rivers and lakes (water flows down from surface)
  - Crystal formations, mineral veins, unique stone types
  - Bioluminescent flora (mushrooms, moss, cave flowers)
  - Geothermal vents (warmth, steam, hot springs)
- Settlements built within these caverns — same building system as surface but with cave aesthetics
- NPCs with underground-adapted schedules (no day/night, use artificial cycles)

### Phase 4: Multi-Level Cave Networks
- Extend caves to Z=-2 and Z=-3
- Vertical shafts connecting levels
- Cave systems that branch and reconnect across levels
- Deeper = more dangerous, rarer minerals, unique biomes
- Underground rivers that flow between levels (waterfalls into lower caves)

### Phase 5: Integrated Subterranean Features (LATER — needs other systems first)
- **Basements**: Requires building system (Layer 3). Houses/structures generate basement at Z=-1 beneath their footprint. Stairs tile transitions player down.
- **Dungeons**: Requires structure layout system. Larger than basements, specific layouts (prison, catacombs, treasure vault). Can connect to natural cave networks.
- **Pits**: Surface tile marked as fall-through. Player drops to Z=-1. Some pits are just holes (short fall), others are cave roof openings.
- **Mine shafts**: Player-created or NPC-created tunnels extending from surface into underground. Economic system integration (mining resources).
- **Underground highways**: Major tunnels connecting distant underground cities. Trade routes.

## Geology System (needed for Phase 2+)

Caves don't form randomly — they form in specific geological conditions. We need:

### Rock Types
| Type | Where | Cave Formation | Properties |
|------|-------|---------------|------------|
| Limestone | Mid-elevation, wet | Karst caves (many, branching) | Stalactites, flowstone |
| Granite | Mountains, highlands | Few caves, hard rock | Crystal veins, stable |
| Sandstone | Desert, dry lowlands | Wind-carved caves, arches | Fragile, collapse risk |
| Basalt | Volcanic regions | Lava tubes (long, straight) | Obsidian, geothermal |
| Marble | Deep underground | Large chambers | Smooth walls, echoing |
| Slate | Hillsides | Layered caves, flat ceilings | Thin passages |

Rock type is derived from biome + elevation + moisture — same pattern as surface terrain classification.

### Minerals and Formations
- Crystals (quartz, amethyst, emerald) — decoration + resources
- Metal veins (iron, copper, gold, mithril) — economy/crafting
- Fossils — lore/discovery system
- Underground water features — pools, streams, waterfalls
- Geothermal features — hot springs, steam vents, lava pools

## Visual Design

### Cave Rendering
- **Walls**: Rock tile variants per geology type (same Wang tileset system as surface terrain)
- **Floor**: Rough stone, gravel, sand, water puddles
- **Ceiling**: Implied by darkness — player sees walls and floor, darkness above
- **Lighting**: Critical — caves should feel DARK. Only light sources illuminate:
  - Player torch/lantern (PointLight2D, warm, flickering)
  - Bioluminescence (PointLight2D, blue-green, steady)
  - Entrance light (fades with distance from opening)
  - Settlement lights (torches, hearths, crystal lamps)
- **Fog of war**: Areas beyond light radius are black. Explored areas stay visible but dimmed.

### Transition Visuals
- Cave entrance on surface: dark opening in cliff face, framed by rock
- Walking in: screen gradually darkens, surface terrain fades, cave interior appears
- Walking out: reverse — cave fades, surface brightens
- No hard cut, no loading screen — smooth alpha crossfade over ~1 second

## What This Spec Does NOT Cover (Yet)
- Specific cave generation algorithms (Phase 2 spec will detail this)
- Underground NPC behavior and schedules
- Mining/resource extraction gameplay
- Underground-specific combat mechanics
- Cave-specific weather (flooding, gas pockets, cave-ins)
- Mapping/cartography system for explored caves
