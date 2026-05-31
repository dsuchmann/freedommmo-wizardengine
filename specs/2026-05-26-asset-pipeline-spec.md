# Asset Pipeline Spec — Layered Cel-Animation Terrain System

**Date:** 2026-05-26
**Status:** Draft
**Scope:** How terrain assets are generated, organized, quality-gated, and cataloged.

## Core Principle: Cel-Animation Layering

Every visible tile is composed of 5 semi-transparent layers stacked together, like animation cels. Each layer is independently swappable based on tile state (pristine, disturbed, burning, etc.). Layers composite at runtime via z-ordered Sprite2D nodes or shader blending.

Nothing is a single opaque image. Everything decomposes into atomic layers.

## The 5 Sub-Layers (per biome)

| Sub-Layer | Z | Content | Opacity | Examples |
|-----------|---|---------|---------|----------|
| **L1: Base Ground** | 0 | Opaque ground surface — the foundational terrain | 100% opaque | Dirt, sand, stone, snow, mud, lava rock, crystal |
| **L2: Ground Detail** | 1 | Surface texture patterns overlaid on base | Semi-transparent | Cracks, moss patches, puddles, root networks, frost patterns |
| **L3: Vegetation** | 2 | Growing things attached to the ground | Semi-transparent | Grass blades, flowers, mushrooms, lichen, coral, crystals |
| **L4: Scatter Objects** | 3 | Small loose items on the surface | Semi-transparent | Pebbles, shells, bones, fallen leaves, embers, ice shards |
| **L5: Atmospheric** | 4 | Environmental particle effects near ground | Semi-transparent | Dust motes, mist wisps, pollen, volcanic ash, magical sparkles |

Not every biome uses all 5 layers. Ocean might only use L1 + L5 (water + foam). Desert might use L1 + L2 + L4 (sand + ripples + rocks). But the architecture supports all 5 everywhere.

## Tile States

Each tile position tracks a state. Each state maps to different frames per layer:

| State | Trigger | Duration | Visual Effect |
|-------|---------|----------|---------------|
| **pristine** | Default | Permanent until changed | Normal appearance |
| **disturbed** | Player walks through | 3-5 seconds | L3 vegetation sways/parts, L4 scatters shift |
| **trampled** | Repeated foot traffic | 30-60 seconds | L3 flattened, L2 shows wear path |
| **dug** | Dig action | Persistent | L1 shows hole, L2-L5 removed |
| **burning** | Fire event | 5-10 seconds | L3-L5 replaced with flame frames, L1 darkens |
| **burned** | After burning completes | Persistent until regrow | L1 scorched, L2 ash, L3-L5 gone |
| **wet** | Rain/splash | 15-30 seconds | L2 shows puddles/sheen, L5 shows droplets |
| **frozen** | Cold/magic | Persistent until thaw | L2 frost overlay, L3 ice-coated, L5 ice crystals |
| **recovering** | After disturbed/trampled | Transition | Gradual return to pristine frames |

**Phase 1 generates pristine state only.** Architecture supports all states from day one.

## Wang Tileset Format

Each layer is a standard 16-tile Wang tileset (corner-based autotiling). This means:
- 16 tiles per layer per state per biome
- Each tile is 32x32 pixels
- L1 is FORMAT_RGBA8 fully opaque
- L2-L5 are FORMAT_RGBA8 with transparency (alpha channel matters)

## PixelLab Generation Rules

### Self-Tilesets (base terrain)
- Use `create_topdown_tileset` with `tile_size: {width: 32, height: 32}`
- L1: `lower_description` = base terrain, `upper_description` = same terrain variant (self-transition)
- L2-L5: Generate as separate tilesets with transparent backgrounds
  - Use very specific prompts: "scattered small pebbles and stones on transparent background, pixel art, top-down view"
  - Set `detail: "highly detailed"` and `shading: "detailed shading"`

### Transition Tilesets
- Transitions only apply to L1 (base ground)
- Use `lower_base_tile_id` / `upper_base_tile_id` to chain with existing base tiles
- L2-L5 transitions are handled by alpha blending at runtime (no dedicated transition tilesets needed)

### Quality Gates
Before accepting a generated tileset:
1. **Visual coherence**: Does it look like the biome it represents?
2. **Tileability**: Do tiles connect seamlessly at Wang boundaries?
3. **Scale consistency**: Are details appropriately sized for 32x32?
4. **Transparency correctness**: For L2-L5, is the background truly transparent (not colored)?
5. **Distinctiveness**: Does this biome look different from every other biome?

If a tileset fails any gate, regenerate. Don't compromise.

## Catalog Structure

```
assets/catalog/terrain/
  _manifest.json              # Master index of all biomes and their layers
  ocean/
    L1_base/
      manifest.json           # PixelLab tileset ID, generation params, quality status
      wang_0.png ... wang_15.png
    L2_detail/
      manifest.json
      wang_0.png ... wang_15.png
    L3_vegetation/
      ...
    L5_atmospheric/
      ...
    transitions/
      ocean_to_beach/
        manifest.json
        wang_0.png ... wang_15.png
  grassland/
    L1_base/
      ...
    L2_detail/
      ...
    ...
  volcanic/
    L1_base/
      ...
    ...
```

### Master Manifest (_manifest.json)

```json
{
  "version": "2.0",
  "tile_size": 32,
  "layer_model": "cel_animation",
  "biomes": {
    "ocean": {
      "layers": ["L1_base", "L5_atmospheric"],
      "transitions": ["ocean_to_beach"],
      "pixellab_ids": {
        "L1_base": "9501a5de-...",
        "L5_atmospheric": null
      },
      "quality_status": "approved"
    },
    "grassland": {
      "layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"],
      "transitions": ["grassland_to_desert", "grassland_to_forest", "..."],
      "pixellab_ids": { ... },
      "quality_status": "pending"
    }
  }
}
```

### Per-Layer Manifest

```json
{
  "biome": "grassland",
  "layer": "L1_base",
  "pixellab_tileset_id": "ac280f19-...",
  "base_tile_ids": {
    "lower": "abc-123",
    "upper": "def-456"
  },
  "generation_prompt": {
    "lower_description": "lush green grass with individual blade detail and natural color variation",
    "upper_description": "lush green grass with slightly different blade pattern and small daisies"
  },
  "quality_status": "approved",
  "states": {
    "pristine": { "frames": 1, "downloaded": true },
    "disturbed": { "frames": 3, "downloaded": false },
    "burning": { "frames": 4, "downloaded": false }
  }
}
```

## Reuse Policy

Existing PixelLab generations that meet quality gates are reused as L1 base layers:
- Volcanic (`81944792`) — excellent, use as L1
- Ocean variants — pick best, use as L1
- Grassland variants — pick best, use as L1
- Desert variants — pick best, use as L1

Everything else (L2-L5, missing biomes, transitions) is generated fresh with this spec's naming and organization rules.

Existing non-terrain assets (fences, windows, doors, characters, objects) are preserved in their current catalog locations. They're separate from terrain layers and will be used by the object/building systems.

## Download Pipeline

After generating on PixelLab:
1. Call `get_topdown_tileset` to verify completion and quality
2. Download all 16 wang tile PNGs into the correct `assets/catalog/terrain/{biome}/{layer}/` directory
3. Write the per-layer manifest.json
4. Update the master _manifest.json
5. Git commit with descriptive message

All downloads use a Python script (`tools/download_tileset.py`) that handles the full pipeline.
