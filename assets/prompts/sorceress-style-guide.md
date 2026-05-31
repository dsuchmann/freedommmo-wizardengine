# Sorceress Style Guide — FreedomMMO

## Visual target

FreedomMMO should exceed the richness of CrossCode, classic Zelda, and Octopath-style 2D worlds by combining readable pixel-art forms with massive procedural variety.

## Camera/style

- Top-down / three-quarter RPG readability.
- Pixel-art compatible with 32×32 terrain tiles.
- Objects may exceed one tile but must anchor cleanly to tile coordinates.
- Transparent-background layer sheets are preferred.
- No baked lighting unless the layer is explicitly a lighting/shadow mask.

## Layer rule

Generate separable layers, not monolithic finished objects, whenever possible:

1. shadow
2. base/body
3. structural detail
4. foliage/material overlay
5. seasonal overlay
6. damage/state overlay
7. lighting mask

## Variation rule

Each asset family must support combinatorial variation:

- silhouette variants
- material variants
- palette variants
- state overlays
- seasonal overlays
- damage/depletion overlays
- wet/snow/burnt versions

## Output rule

Prefer sprite sheets with regular cells:

- terrain: 32×32 cells
- single-tile object: 32×32 or 32×48 cells
- two-tile object: 64×64 or 64×96 cells
- transparent background
- no UI framing
- no text
- no watermark

## Animation rule

Every sprite/object family must be generated with animation coverage appropriate to its type:

- 8-way directions: `S`, `SE`, `E`, `NE`, `N`, `NW`, `W`, `SW`
- idle/ambient animation frames
- interaction/action animation frames where relevant
- state-change frames: wet, snow, burnt, damaged, cut, dead, opened, collapsed, lit, occupied, depleted
- separate layer sheets for animated parts when possible

Static-looking world objects are not exempt: trees need wind/chop/fall/burn frames; rocks need cracked/wet/snow/ore states; cave mouths need open/collapsed/lit/occupied states; water needs flow/foam/sparkle frames.

## Physics/collision rule

Pixels do not define physics. Each generated asset family must be paired with manifest metadata for:

- collision shape(s)
- body type
- material
- movement blocking
- projectile blocking
- climbability
- portal/interaction volumes

## Render rule

Every asset must declare:

- draw layer
- y/elevation sort behavior
- blend mode
- shadow casting
- light receiving
- light/LOS occlusion
- height class

## Consistency rule

All generated sheets for a family must share:

- same perspective
- same anchor point
- same scale
- same palette family
- same outline/shading conventions
