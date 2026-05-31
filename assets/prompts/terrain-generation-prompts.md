# Terrain Generation Prompt Templates

## Ground layer sheet

Generate a transparent pixel-art terrain layer sheet for FreedomMMO.

- Asset family: `{asset_id}`
- Layer: `{layer}`
- Biomes: `{biomes}`
- Cell size: 32×32
- Variants: `{variant_count}` cells
- Style: rich handcrafted fantasy RPG pixel art, top-down three-quarter readability, lush detail, no UI, no text
- Constraints: this layer only; no objects unless the layer name calls for them; tile edges must remain compatible with adjacent terrain

## Cliff wall sheet

Generate a transparent pixel-art cliff/elevation layer sheet for FreedomMMO.

- Asset family: `cliff_wall`
- Layer: `{layer}`
- Cell size: 32×32
- Variants: `{variant_count}`
- Style: dramatic readable strata, ledges, cracks, moss/snow variants, top-down RPG cliff projection
- Constraints: transparent background; top edge must align to terrain tile; bottom edge must read as cliff face/shadow

## Water layer sheet

Generate a transparent pixel-art water layer sheet for FreedomMMO.

- Asset family: `water_surface`
- Layer: `{layer}`
- Cell size: 32×32
- Variants: `{variant_count}`
- Style: animated-looking handcrafted water glints, foam, currents, moon reflections, top-down RPG readability
- Constraints: transparent layer where possible; no shoreline unless layer is foam; no baked UI

## Dry riverbed/pathway sheet

Generate a transparent pixel-art dry riverbed/pathway layer sheet for FreedomMMO.

- Asset family: `dry_riverbed`
- Layer: `{layer}`
- Cell size: 32×32
- Variants: `{variant_count}`
- Style: branching dried silt paths, cracked mud, pebbles, roots, organic curves, no grid-like repetition
- Constraints: forms must connect across tile edges; include straight, bend, fork, and end-cap variants
