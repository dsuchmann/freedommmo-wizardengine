# PixelLab Biome Base Pipeline

This is the repeatable process for making every biome base look as good as the current swamp pass: strong biome identity, PixelLab texture detail, no single repeated stamp, and correct transitions/overlays.

## 1. Asset family per biome

Each biome/base material should define an art family with the same shape as the swamp families:

```js
{
  family: 'grassland/meadow',
  baseTiles: [v000 ... v015],      // 16+ full base tile variants
  wangTiles: [mask0 ... mask15],   // optional internal edge Wang tiles
  transitions: {
    beach: 'grassland_to_beach',
    forest: 'grassland_to_forest',
    hills: 'grassland_to_hills'
  },
  overlays: ['flowers', 'ground_cover', 'stones'],
  objects: ['bushes', 'trees', 'rocks']
}
```

Swamp currently has only:

- `swamp/wet_mud` → `assets/pixelab/landscape_v2/base/swamp_wet_mud/...`
- `swamp/mud_pool` → `assets/pixelab/landscape_v2/base/swamp_mud_pool/...`

Other biomes need equivalent base folders or mapped fallback families before they can use the same technique.

## 2. Foundation pass

Do **not** draw a PixelLab tile fully opaque as the ground. That creates wallpaper/repetition.

Every biome should first paint a procedural foundation color derived from:

- biome palette / target RGB,
- elevation/slope,
- moisture/fertility/vegetation,
- broad low-frequency noise only.

This pass should be smooth and mostly continuous. It owns the base color; PixelLab owns texture detail.

## 3. Prepared PixelLab texture donors

For each base variant:

1. Load the PNG.
2. Normalize its average color toward the biome target RGB.
3. Convert it into a semi-transparent texture/detail donor.
4. Feather or suppress hard generator borders.
5. Keep local strokes/value detail visible.

Current swamp code does this in `preparedPixelBaseCanvas(src, baseFamily, 'texture')`.

## 4. Blended variant donor pass

The important rule learned from swamp: **never draw one full centered 32×32 tile repeatedly.**

Instead, for every world tile:

1. Pick a primary variant from the family (`v000–v015`) using blue-noise-ish per-tile selection.
2. Pick a secondary variant that is guaranteed to differ.
3. Sometimes pick a tertiary variant.
4. Draw each donor as a cropped/rotated/flipped source window.
5. Bias crops away from the source center when generator motifs repeat there.
6. Blend with modest alpha over the procedural foundation.

This keeps the nice blend while preventing the repeated center-motif problem.

Recommended starting weights:

- primary donor: `0.22–0.34`
- secondary donor: `0.14–0.26`
- tertiary donor: `0.06–0.12`
- transition donor: `0.03–0.08`

Tune per biome. Dense grass/forest can tolerate stronger texture; sand/snow need lower alpha and smoother foundation.

## 5. Transition pass

Transitions should be split into two responsibilities:

1. **Procedural transition gradient/mask** decides the shape and soft blend at biome boundaries.
2. **PixelLab transition PNGs** are used only as low-alpha texture donors, not as chunky full-tile stamps.

This avoids square chunks, triangular artifacts, and hard stair-stepped outlines.

For every biome pair, add a transition family mapping where PixelLab assets exist, for example:

- `grassland_to_forest`
- `grassland_to_hills`
- `ocean_to_beach`
- `steppe_to_desert`
- `tundra_to_taiga`

If a transition set is missing, use the procedural gradient only and log/debug the missing family.

## 6. Overlays and objects

After base texture is stable, add biome-specific detail in layers:

1. **Surface overlays**: flowers, leaves, moss, snow patches, pebbles, dry grass.
2. **Micro detail**: tiny flecks/blades/soil dots.
3. **Medium objects**: tufts, bushes, rocks, reeds.
4. **Large objects/features**: trees, boulders, ruins, water edges.

Important: overlays should also use seeded variant selection and should avoid obvious grid alignment. Do not add broad striped fields over PixelLab bases unless they are intentionally biome-scale.

## 7. Debug labels

Every painted tile should expose debug fields like swamp does:

- `pixelLabBaseFamily`
- `pixelLabBaseSrc`
- `pixelLabBaseVariantSrc`
- `pixelLabBaseMask`
- `pixelLabTransitionBiome`
- `pixelLabTransitionMask`
- `pixelLabTransitionImageMask`

This is critical for QA: when a tile looks wrong, the HUD should say which family/variant/transition was used.

## 8. Rollout order

Recommended order to expand beyond swamp:

1. Beach/desert/sand bases — important because swamp borders them visibly.
2. Grassland/savanna/steppe — broad world coverage.
3. Forest/dense_forest/tropical_forest/taiga — add canopy/object layering after base stability.
4. Tundra/arctic/snow/mountains — lower alpha, smoother foundation, careful snow transitions.
5. Water families — shallow/deep/ocean/river/lake with shoreline-specific transitions.
6. Special biomes — volcanic, mystic, void.

## 9. Acceptance checklist per biome

A biome base is ready when:

- no full-tile repeated motif is visible at normal zoom,
- neighboring tiles vary across the available variant set,
- texture detail is visible but not wallpapered,
- tile boundaries are not obvious,
- transitions do not create black boxes, hard squares, or triangular chunks,
- overlays/objects match the biome and do not form rows/bands,
- debug HUD reports the correct family and variants.

## 10. Implementation target

The current swamp implementation in `src/render/tile-painter.js` is the template. Generalize it by replacing swamp-specific constants with a shared biome-art registry:

- `PIXEL_BASE_TILE_VARIANTS` → all biome families
- `PIXEL_BASE_WANG_VARIANTS` → all families with Wang interiors
- `PIXEL_BASE_TARGET_RGB` → all families
- `PIXEL_TRANSITION_TARGET_RGB` → all transition targets
- `PIXEL_*_TRANSITION_WANG` → generalized transition registry

Once the registry exists, `paintPixelLabBase()` can become `paintPixelBiomeBase()` and apply this process to every biome with assets.

## 11. Swamp-first reference implementation decision

Yes: build swamp all the way up first, because swamp is the only biome that currently has complete base assets in `assets/pixelab/landscape_v2/base/`. Swamp should become the reference implementation before the framework is extracted for all other biomes.

Swamp-first is the right order because:

- the required base variants already exist,
- the hard problems are visible there: repeated motifs, mud/sand transitions, water edges, foliage overlays,
- once solved, the code path can be generalized with confidence,
- later biomes can copy a proven pattern instead of each becoming a separate experiment.

### Swamp completion checklist

1. **Base texture**
   - Keep the current procedural mud foundation.
   - Keep blended PixelLab donor variants.
   - Ensure adjacent tiles visibly use varied `v000–v015` donors.
   - Avoid centered full-tile motif stamps.
   - Preserve the good blended look without obvious tile borders.

2. **Internal swamp variety**
   - Distinguish wet mud vs mud pool areas.
   - Use moisture/elevation to bias wet/dry/mossy patches.
   - Add subtle puddle/mud sheen where moisture is high.
   - Keep variation broad enough to avoid checkerboard.

3. **Swamp transitions**
   - Finish swamp↔beach/desert boundary.
   - Finish swamp↔grass/forest boundaries.
   - Finish swamp↔river/lake/shallow water boundaries.
   - PixelLab transition PNGs should remain low-alpha texture donors unless a set proves seamless.

4. **Surface overlays**
   - Add moss flecks, reeds, mud cracks, wet glints, leaf litter, and sparse swamp grass.
   - Use seeded placement and variant selection.
   - Avoid horizontal rows/bands.

5. **Objects/features**
   - Add reeds near water/mud pools.
   - Add dead branches/logs/stumps.
   - Add swamp shrubs/roots.
   - Add rare larger props after the base remains stable.

6. **QA views**
   - Test at normal play zoom and topology/overmap-adjacent locations.
   - Check pure swamp interiors, swamp/sand edges, swamp/grass edges, and swamp/water edges.
   - HUD should always report family, variant donors, masks, and transition family.

7. **Extraction point**
   - Only after swamp passes QA, extract constants and helper functions into a shared PixelLab biome registry/painter.
   - Then add the next biome family using the same checklist.
