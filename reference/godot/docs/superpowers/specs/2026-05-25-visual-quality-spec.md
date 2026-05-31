# Visual Quality Spec — Reference-Grade Pixel Art Rendering

## Goal
Match the visual quality of Sea of Stars, CrossCode, and modern indie pixel art RPGs. Every screen should look like a painting — no empty spaces, no visible tile grids, dense detailed environments.

## Reference Analysis
The reference games achieve their look through:
1. **32-64px tiles** at 1:1 or slight zoom — each tile has visible internal texture
2. **Dense object coverage** — forests have trees nearly touching, villages have objects everywhere
3. **Multi-layer rendering** — ground, shadows, objects, canopy overlay, lighting
4. **Seamless terrain** — no visible tile boundaries between adjacent tiles
5. **Rich decorative detail** — barrels, fences, flowers, signs, lamps fill every gap

## Current Architecture (post WORLD_SCALE=32 migration)

### What's Working
- TileMapLayer at native 32px — tiles show full detail
- 30+ PixelLab map objects (buildings, trees, decorations)
- Dynamic directory scanning — drop PNGs, they auto-load
- 5 grass tile variants reduce repetition
- Per-tile biome override from grain type
- Dynamic lighting (PointLight2D) + ambient particles

### What Needs Improvement

#### 1. Scale & Zoom (CRITICAL)
- **Current**: zoom 0.85, tiles = 27 screen px
- **Target**: zoom 1.0+, tiles = 32+ screen px
- **Fix**: Set zoom to 1.0. Generate smaller world (fewer cells loaded) for performance.

#### 2. Object Density (HIGH)
- **Current**: forest 80/cell, grassland 25/cell
- **Target**: forest 100+, grassland 40+
- **Fix**: Increase density. Accept more nodes — Godot handles thousands of Sprite2D fine.

#### 3. Terrain Seamlessness (HIGH)
- **Current**: single 32x32 tile per variant, visible edges when tiled
- **Target**: no visible tile boundaries
- **Fix**: Generate SEAMLESS tiles via PixelLab (tiles that tile without visible edges). Use multiple variants per biome (already 5 for grass). Add transition tiles between biomes.

#### 4. Object Variety (MEDIUM)
- **Current**: 30 map objects, ~4 tree types
- **Target**: 50+ map objects, 8+ tree types, 15+ decorations
- **Fix**: Keep generating map objects. Focus on trees (willow, birch, dead tree, palm, apple tree) and small decorations (pots, signs, fences, paths).

#### 5. Shadow Layer (MEDIUM)
- **Current**: drop shadows on buildings only
- **Target**: shadows under ALL objects (trees, rocks, NPCs)
- **Fix**: Add shadow child sprite to every nature object in MapObjectRenderer.

#### 6. Ground Detail Layer (MEDIUM)
- **Current**: flat terrain with variant tiles
- **Target**: grass tufts, pebbles, leaf litter scattered on ground
- **Fix**: Generate 32x32 ground detail sprites (transparent with small details) and randomly place them at z_index=0 above terrain.

## Asset Pipeline
All assets generated via PixelLab (no manual art):
- `create_map_object()` for buildings, trees, decorations (48-128px sprites)
- `create_tiles_pro()` for terrain tiles (32x32 seamless)
- `create_character()` for NPC bodies (pro mode)
- Dynamic directory scanning auto-loads everything

## Implementation Priority
1. Zoom to 1.0, reduce cell radius to 1 for performance
2. Generate 10 more tree variants, 10 more decorations
3. Add shadows to all nature objects
4. Generate seamless terrain tiles
5. Add ground detail scatter layer
6. Increase density to 100+ for forests

## Non-Negotiable Constraints
- Everything procedural/generative — no hardcoded content
- All assets from PixelLab — no manual pixel art
- Dynamic directory scanning — no hardcoded file paths
- Must maintain 30+ FPS on RTX 3090
