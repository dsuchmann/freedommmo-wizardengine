# Biome Layer Stack Design

**Date:** 2026-05-29
**Status:** Draft
**Scope:** Extends terrain-object-system-design (2026-05-28) with ordered layer placement, 100% tile coverage, and massive variant generation
**Prerequisite:** 2026-05-28-terrain-object-system-design.md (approved)

## Problem Statement

The current placement engine treats all objects as a flat probability pool. Each tile has a random chance of getting any object from the biome's affinity list. This produces sporadic, incoherent placement — scattered sprites on a visible green grid. The base terrain tile (layer 0) is the dominant visual on most tiles.

The target is CrossCode-quality environments where every tile is densely layered with multiple overlapping objects that compose into a believable landscape.

## Core Concept: Ordered Layer Stacks

Each biome defines an **ordered stack of layers**. The placement engine iterates layers bottom-to-top. Lower layers guarantee 100% tile coverage. Upper layers are progressively sparser.

Every layer except layer 0 is composed of **objects with alpha channels** (not tiles). They stack visually — you see through each layer to the layers beneath. This creates depth that flat tiles cannot achieve.

### Universal Rule

**Layer 0 must NEVER be the only visible thing on any tile.** If a player can see the raw base terrain tile without at least one object layer on top, the placement has failed.

## Layer Stack Schema

Each biome gets a layer definition file at `data/terrain_objects/biome_layers/{biome_id}.json`:

```json
{
  "biome_id": "grassland",
  "layers": [
    {
      "layer": 1,
      "name": "ground_texture",
      "coverage": 1.0,
      "description": "Dirt and soil showing through grass",
      "objects": [
        { "object_id": "dirt_patch", "weight": 0.6, "variant_count": 64 },
        { "object_id": "dry_soil", "weight": 0.3, "variant_count": 32 },
        { "object_id": "dark_earth", "weight": 0.1, "variant_count": 16 }
      ],
      "z_offset": 0,
      "scale_range": [0.8, 1.0]
    },
    {
      "layer": 2,
      "name": "small_debris",
      "coverage": 1.0,
      "description": "Pebbles, stones, dry leaves, twigs on the dirt",
      "objects": [
        { "object_id": "pebble", "weight": 0.3, "variant_count": 64 },
        { "object_id": "dry_leaf", "weight": 0.25, "variant_count": 32 },
        { "object_id": "twig", "weight": 0.2, "variant_count": 16 },
        { "object_id": "small_stone", "weight": 0.15, "variant_count": 32 },
        { "object_id": "seed_pod", "weight": 0.1, "variant_count": 16 }
      ],
      "z_offset": 1,
      "scale_range": [0.1, 0.25]
    },
    {
      "layer": 3,
      "name": "ground_flora",
      "coverage": 1.0,
      "description": "Grass covering the ground — many variants intermixed",
      "objects": [
        { "object_id": "short_grass", "weight": 0.35, "variant_count": 64 },
        { "object_id": "tall_grass", "weight": 0.25, "variant_count": 64 },
        { "object_id": "meadow_grass", "weight": 0.2, "variant_count": 32 },
        { "object_id": "clover_patch", "weight": 0.1, "variant_count": 16 },
        { "object_id": "grass_tuft", "weight": 0.1, "variant_count": 32 }
      ],
      "z_offset": 2,
      "scale_range": [0.4, 0.9]
    },
    {
      "layer": 4,
      "name": "accent_flora",
      "coverage": 0.15,
      "description": "Sporadic flowers and small plants",
      "objects": [
        { "object_id": "wildflower", "weight": 0.3, "variant_count": 32 },
        { "object_id": "daisy", "weight": 0.2, "variant_count": 16 },
        { "object_id": "dandelion", "weight": 0.2, "variant_count": 16 },
        { "object_id": "poppy", "weight": 0.15, "variant_count": 16 },
        { "object_id": "butterfly_bush", "weight": 0.15, "variant_count": 8 }
      ],
      "z_offset": 3,
      "scale_range": [0.25, 0.45]
    },
    {
      "layer": 5,
      "name": "large_objects",
      "coverage": 0.02,
      "cluster_mode": "grouped",
      "cluster_size": [3, 8],
      "cluster_spacing": [15, 40],
      "description": "Trees and boulders — standalone and clustered",
      "objects": [
        { "object_id": "oak_tree", "weight": 0.35, "variant_count": 16 },
        { "object_id": "birch_tree", "weight": 0.25, "variant_count": 16 },
        { "object_id": "flowering_bush", "weight": 0.2, "variant_count": 8 },
        { "object_id": "mossy_boulder", "weight": 0.1, "variant_count": 8 },
        { "object_id": "fallen_log", "weight": 0.1, "variant_count": 8 }
      ],
      "z_offset": 4,
      "scale_range": [0.9, 1.1]
    }
  ]
}
```

### Schema Fields

- **coverage**: 0.0-1.0. Fraction of tiles that get an object from this layer. 1.0 = every tile.
- **objects**: Weighted list of object types. Weight determines selection probability within the layer.
- **variant_count**: Target number of visual variants for this object. Drives PixelLab generation.
- **z_offset**: Relative z-ordering between layers. Higher = renders on top.
- **scale_range**: Display scale range for objects in this layer.
- **cluster_mode**: For sparse layers. "scattered" = random, "grouped" = natural clusters.
- **cluster_size**: Number of objects per cluster [min, max].
- **cluster_spacing**: Tiles between cluster centers [min, max].

## Biome Layer Definitions

### Grassland (5 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Dirt patches, dry soil, dark earth |
| 2 | 100% | Pebbles, dry leaves, twigs, stones, seed pods |
| 3 | 100% | Short grass, tall grass, meadow grass, clover, grass tufts (64 variants each) |
| 4 | 15% | Wildflowers, daisies, dandelions, poppies |
| 5 | 2% | Oak trees, birch trees, bushes, boulders (clustered) |

### Forest (5 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Forest floor dirt, leaf litter, root-covered soil |
| 2 | 100% | Fallen leaves, bark chips, acorns, twigs, pine cones |
| 3 | 100% | Ferns, ground moss, forest grass, ivy ground cover |
| 4 | 20% | Mushrooms, toadstools, wildflowers, spider webs |
| 5 | 4% | Deciduous trees (clustered dense), fallen logs, mossy boulders |

### Taiga (5 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Pine needle bed, frozen soil, bark debris |
| 2 | 100% | Pine cones, small twigs, frozen leaves, ice crystals |
| 3 | 100% | Hardy moss, lichen, frozen grass |
| 4 | 10% | Snow patches (at elevation), mushrooms, bear scat |
| 5 | 3% | Conifer trees (dense clustered), mossy boulders, fallen logs |

### Desert (4 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Cracked earth, sand ripples, sun-bleached soil |
| 2 | 100% | Small rocks, bone fragments, dried seed husks |
| 3 | 30% | Dry grass tufts, desert scrub, dead twigs |
| 4 | 1% | Cacti, desert shrubs, bleached logs (very sparse) |

### Tundra (4 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Permafrost, frozen gravel, packed earth |
| 2 | 100% | Ice shards, frozen pebbles, frost crystals |
| 3 | 40% | Frozen grass, hardy moss, lichen |
| 4 | 1% | Dead shrubs, ice formations (very sparse) |

### Volcanic (4 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Ash layer, charred earth, cooled lava |
| 2 | 100% | Obsidian shards, pumice stones, sulfur crystals |
| 3 | 15% | Charred grass, sulfur vents, ember patches |
| 4 | 1% | Charred trees, lava rock formations (sparse) |

### Swamp (5 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Wet mud, peat, saturated soil |
| 2 | 100% | Wet leaves, algae patches, debris |
| 3 | 100% | Reeds, cattails, moss, water grass |
| 4 | 20% | Mushrooms, lily pads, frog perches |
| 5 | 3% | Mangrove trees, cypress, dead trees (clustered) |

### Tropical Forest (5 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Jungle floor, rich dark soil, decomposing leaves |
| 2 | 100% | Fallen fruit, large leaves, vine debris |
| 3 | 100% | Giant ferns, tropical grass, ground orchids |
| 4 | 25% | Tropical flowers, mushrooms, hanging vines |
| 5 | 5% | Palm trees, kapok trees, jungle trees (very dense clustered) |

### Mountains (4 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Rocky gravel, mountain soil, scree |
| 2 | 100% | Loose stones, slate chips, gravel patches |
| 3 | 25% | Mountain flowers, hardy moss, lichen |
| 4 | 2% | Boulders, cliff faces, cave entrances (sparse) |

### Arctic (4 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Packed snow, ice sheet, frozen ground |
| 2 | 100% | Ice crystals, frost patterns, frozen pebbles |
| 3 | 15% | Frozen grass, lichen, snow drifts |
| 4 | 0.5% | Ice formations, frozen boulders (very sparse) |

### Beach (4 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Beach sand, wet sand, shell fragments |
| 2 | 100% | Scattered shells, seaweed bits, tiny stones |
| 3 | 20% | Sea grass, dune grass, driftwood bits |
| 4 | 1% | Large driftwood, rock formations (sparse) |

### Savanna (4 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Dry earth, sun-cracked soil |
| 2 | 100% | Dry leaves, small stones, seed pods |
| 3 | 60% | Dry grass, savanna grass (golden/brown) |
| 4 | 1% | Acacia-style trees (standalone, widely spaced) |

### Steppe (4 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Cracked earth, dry gravel |
| 2 | 100% | Flat stones, dried plant matter |
| 3 | 50% | Short dry grass, hardy shrubs |
| 4 | 1% | Wind-sculpted rocks, tumbleweeds (sparse) |

### Mystic (5 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Glowing soil, ethereal ground texture |
| 2 | 100% | Crystal fragments, glowing particles, magical debris |
| 3 | 100% | Ethereal moss, glowing grass, arcane ground cover |
| 4 | 20% | Arcane flowers, spirit wisps, runic stones |
| 5 | 2% | Crystal formations, enchanted trees (sparse) |

### Dense Forest (5 layers)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Thick leaf litter, root-covered ground, dark soil |
| 2 | 100% | Decomposing leaves, bark, fungi |
| 3 | 100% | Giant ferns, thick moss, ground ivy |
| 4 | 30% | Mushroom clusters, spider webs, bracket fungi |
| 5 | 6% | Old-growth trees (very dense clustered), hollow logs |

### Lake (3 layers — water biome)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Underwater texture (algae, sediment) |
| 2 | 40% | Lily pads, floating debris, reeds |
| 3 | 5% | Submerged logs, fishing spots |

### River (3 layers — water biome)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Riverbed stones, underwater sand |
| 2 | 30% | Reeds, river weed, bank debris |
| 3 | 3% | Driftwood, boulders in current |

### Ocean (2 layers — water biome)
| Layer | Coverage | Content |
|-------|----------|---------|
| 1 | 100% | Underwater texture (deep blue, coral hints) |
| 2 | 10% | Coral, kelp, sea objects |

## Placement Engine Changes

### Current Architecture (replace)

The current placement engine (`scripts/core/terrain_objects/placement_engine.gd`) iterates all object pools for the biome and probabilistically places each one. This produces flat, sporadic placement.

### New Architecture

```
For each chunk (64×64 tiles):
  1. Determine biome_id for each tile
  2. Load biome_layers/{biome_id}.json
  3. For each layer (bottom to top):
     a. For each tile in the chunk:
        - Roll against layer.coverage
        - If coverage hit (or coverage == 1.0):
          - Select object from layer.objects using weighted random
          - Select variant (1..variant_count, seeded deterministically)
          - Apply sub-tile jitter for natural placement
          - Create ObjectInstance at this layer's z_offset
        - For cluster_mode layers:
          - First pass: place cluster centers using Poisson disk
          - Second pass: fill each cluster with objects
  4. Return all instances across all layers
```

### Performance Considerations

With 100% coverage on 3+ layers across 64×64 = 4096 tiles:
- Layer 1: 4,096 objects
- Layer 2: 4,096 objects
- Layer 3: 4,096 objects
- Layer 4: ~600 objects (15%)
- Layer 5: ~80 objects (2%)
- **Total: ~13,000 objects per chunk**

With 7×7 = 49 chunks loaded, that's ~637,000 objects. Obviously can't render all as Sprite2D.

**Solution: LOD tiers**
- **Near chunks (radius 0-1)**: Render all layers as Sprite2D
- **Mid chunks (radius 2)**: Render layers 3-5 only (skip ground texture and debris)
- **Far chunks (radius 3+)**: Render layer 5 only (trees/large objects)

Additionally, layers 1-2 (ground texture, debris) could use a pre-rendered approach: bake them into a single image per chunk at startup, render as one ImageTexture. This reduces thousands of sprites to one image for the base layers.

### Variant Scale Requirements

Each object type needs deep variant pools to prevent visible repetition:

| Layer Type | Minimum Variants | Animation Sets |
|-----------|-----------------|----------------|
| Ground texture (L1) | 64 | idle (subtle texture shift) |
| Small debris (L2) | 64 | none (static) |
| Ground flora (L3) | 64 per type | idle_sway, wind, trample, seasonal |
| Accent flora (L4) | 32 per type | idle_sway, wind, bloom, wilt, pick |
| Large objects (L5) | 16 per type | idle_sway, wind, chop, burn, seasonal |

**Generation target:** ~3,000 base variants + ~15,000 animation frames = ~18,000 individual sprite assets for full coverage.

## Generation Pipeline

### Priority Order

1. **Layer 3 (ground flora)** — most visually impactful, covers every tile
2. **Layer 1 (ground texture)** — foundation layer
3. **Layer 5 (large objects)** — trees and landmarks
4. **Layer 2 (small debris)** — fills visual gaps
5. **Layer 4 (accent flora)** — color and interest

### PixelLab Batch Strategy

For each object type needing 64 variants at 32px:
- `create_1_direction_object(size=32)` produces 64 candidates per batch
- Select all → 64 completed objects
- Download all → 64 variant PNGs
- 1 PixelLab batch = 1 object type fully covered

For 64px objects (trees):
- `create_1_direction_object(size=64)` produces 16 candidates
- Need 4 batches per tree type for 64 variants (or accept 16)

### Animation Generation

After base variants, generate animations:
- `animate_object()` for each completed object
- Priority: idle_sway first (ambient), then wind, then interactions
- Each animation = 4-8 frames at 32px

## Migration Path

1. Create biome_layers JSON files for all 18 biomes
2. Refactor PlacementEngine to read layer stacks instead of flat affinity pools
3. Generate missing variants (most types have 3-10, need 64)
4. Implement LOD tiers for performance
5. Add pre-rendered chunk baking for layers 1-2
6. Begin animation generation pipeline

The existing affinity files (`data/terrain_objects/affinities/*.json`) remain as reference but are superseded by the layer stack definitions for placement purposes. The object catalog (`data/terrain_objects/objects/`) and existing sprites remain unchanged.

## Success Criteria

1. No tile shows bare layer 0
2. Each biome is visually distinct and internally consistent
3. Ground flora has 64+ variants with no visible repetition pattern
4. Trees appear in natural clusters, not uniform distribution
5. Screenshot at 4.5x zoom looks like a CrossCode environment, not a tech demo
6. 60 FPS maintained with LOD culling
