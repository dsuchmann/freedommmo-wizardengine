# Object Generation Prompt Templates

## Tree layer sheet

Generate a transparent pixel-art layer sheet for FreedomMMO.

- Asset family: `{asset_id}`
- Layer: `{layer}`
- Cell size: `{cell_size}`
- Variants: `{variant_count}`
- Style: lush handcrafted fantasy RPG pixel art, top-down three-quarter perspective, readable silhouette, high variation
- Constraints: generate only the requested layer; no background; preserve anchor point; no baked lighting except shadow/lighting layers

## Rock/cave layer sheet

Generate a transparent pixel-art geology layer sheet for FreedomMMO.

- Asset family: `{asset_id}`
- Layer: `{layer}`
- Cell size: `{cell_size}`
- Variants: `{variant_count}`
- Style: detailed stone, strata, cracks, moss/snow/wet variants, readable in a 2D open-world RPG
- Constraints: no background; preserve anchor point; cave openings must be visibly enterable when assembled

## State overlay sheet

Generate a transparent pixel-art state overlay sheet for FreedomMMO.

- Asset family: `{asset_id}`
- State: `{state}`
- Layer: `{layer}`
- Cell size: `{cell_size}`
- Variants: `{variant_count}`
- Style: overlay-only, usable over base sprites, coherent with high-fantasy wilderness pixel art
- Constraints: transparent background; do not duplicate the full object body
