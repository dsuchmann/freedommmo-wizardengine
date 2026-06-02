# Claude Kickoff Prompt — PixelLab Landscape V2 Asset Generation + Framework Alignment

You are Claude working inside the FreedomMMO / WizardGenie project. Your job is to run a self-directed asset-planning and generation loop for the landscape system. You should be maximally careful, explicit, and systematic.

This prompt is intentionally verbose. Read it fully before taking action.

---

## 0. One-Minute Operating Loop

Run your work in repeated one-minute loops.

Each loop should do the following:

1. Inspect the relevant project files.
2. State what you learned in a concise loop note.
3. Make one concrete improvement:
   - write/extend a manifest,
   - generate/organize prompts,
   - create metadata,
   - audit existing assets,
   - propose exact missing assets,
   - or generate a batch of PixelLab-ready prompts.
4. Validate that file paths and naming conventions are consistent.
5. Append progress to a report file.
6. Continue without waiting unless blocked by missing information.

Do not spend a loop only explaining. Produce artifacts.

---

## 1. Project Goal

We are building a coherent horizontal landscape assembly framework for a tile-based MMO world.

The user thinks about a tile like a cake slice:

- bottom/base: structural terrain foundation
- middle: surface condition and physical evidence
- top: ecological dressing and objects

But this is not random vertical stacking. Every layer must be justified by tile state.

Example diagnostic tile:

```txt
biome swamp
form plains
plateau 0
material wet_mud
surface mud_pools
micro soil+ground_cover+foliage_blades
```

For that tile, the intended stack is roughly:

```txt
1. opaque wet_mud / swamp Wang base tile
2. mud_pool / wetness surface overlay with alpha
3. soil fleck alpha details
4. ground-cover / moss / algae alpha details
5. foliage blade / reed-grass alpha clusters
6. sparse medium swamp dressing such as reeds, roots, moss clumps
7. separate interactive/gameplay objects where object placement says so
```

The key design rule:

> Wang tiles are foundational base/stitching tiles. The things above them should mostly be alpha-channel decals/sprites/objects.

---

## 2. Important Architecture Decisions Already Made

### Biome transitions

Biome assignment has been moved toward continuous world-space biome fields. Avoid chunk-aligned seams and chunk-local transition hacks.

### Wang tiles

Yes, Wang tiles should be used, but as foundational terrain stitching:

- one opaque top-surface Wang base per tile stack,
- additional Wang/edge treatments only for separate structural surfaces like plateau faces, cliff faces, waterlines, road/path bases, etc.

Do not treat Wang tiles as random decorative overlays.

### Layering rule

Do not vertically stack every possible layer. Use a recipe that says which layers are allowed and at what density.

### Rendering cost

Chunk generation/rendering has been optimized. Avoid huge runtime computation or per-tile catalog scans. Asset selection should be deterministic and cheap.

---

## 3. Files You Must Read First

Read these files before doing generation planning:

```txt
docs/PIXELAB_GENERATION_BUDGET_AND_PROGRESS_LEDGER.md
docs/PIXELAB_LANDSCAPE_ASSET_GENERATION_MANIFEST.md
src/render/landscape-recipe.js
src/render/tile-painter.js
src/world/tile-stack.js
src/world/tile-micro-layers.js
src/world/biomes.js
src/world/biome-definitions.js
assets/prompts/pixelab-landscape-asset-generation-spec.md
assets/prompts/pixelab-landscape-asset-matrix.json
```

The most important file is:

```txt
docs/PIXELAB_LANDSCAPE_ASSET_GENERATION_MANIFEST.md
```

It contains the large combinatorial asset space, directory structure, prompt templates, seed scheme, and layer definitions.

---

## 4. Files You Should Create / Maintain

Create and maintain these working files, and update the budget ledger after every batch:

```txt
docs/PIXELAB_GENERATION_BUDGET_AND_PROGRESS_LEDGER.md
assets/pixelab/landscape_v2/manifest.json
assets/pixelab/landscape_v2/README.md
assets/pixelab/landscape_v2/prompts/generated_prompts.jsonl
assets/pixelab/landscape_v2/prompts/generation_report.json
assets/pixelab/landscape_v2/audit/existing_asset_audit.json
assets/pixelab/landscape_v2/audit/missing_asset_report.md
assets/pixelab/landscape_v2/audit/layer_contract_report.md
```

If directories do not exist, create them.

Do not overwrite existing `assets/catalog` files.

---

## 5. Layer Contract You Must Preserve

The landscape renderer should conceptually use this stack:

```txt
Layer 0: Tile identity / terrain data
Layer 1: Opaque base terrain / Wang tile
Layer 2: terrain form structure: cliff/step/slope/plateau marks
Layer 3: surface overlays: mud pools, wet shine, snow drift, leaf litter, etc.
Layer 4: micro alpha decals: soil, ground cover, foliage blades, flowers, debris
Layer 5: medium dressing sprites: reeds, bushes, clumps, roots, rocks
Layer 6: gameplay objects: interactive bushes, trees, stones, harvest nodes
Layer 7: runtime lighting / atmosphere
```

Do not collapse these into a random pile of sprites.

---

## 6. Swamp Example — Use This As A Calibration Test

For a tile with:

```txt
biome swamp
form plains
plateau 0
material wet_mud
surface mud_pools
micro soil+ground_cover+foliage_blades
```

Expected asset recipe:

```json
{
  "base": {
    "family": "swamp/wet_mud",
    "wang": true,
    "opaque": true
  },
  "surfaceOverlays": [
    "mud_pool",
    "wet_mud_shine",
    "algae_film"
  ],
  "micro": [
    "dark_mud_flecks",
    "moss_ground_cover",
    "reeds_grass_blades"
  ],
  "medium": [
    "reeds",
    "cattails",
    "root_cluster",
    "moss_clump"
  ],
  "objects": [
    "forage_bush_swamp",
    "swamp_tree",
    "reed_harvest_node"
  ]
}
```

Interpretation:

- wet mud Wang tile is the base Lego tile,
- mud pools/wet shine go over it with alpha,
- soil/ground cover/foliage blades are small alpha marks,
- reeds/root clusters are sparse larger dressing,
- interactive items belong to object placement, not terrain canvas.

---

## 7. Plateau / Elevation Rule

If the tile is flat/plains/plateau top:

```txt
one opaque top-surface Wang base
+ alpha dressing layers
```

If the tile has a cliff/step/plateau edge:

```txt
top-surface Wang base
+ cliff/ledge/side-face structure art
+ alpha surface/micro dressing
```

It is acceptable to use Wang-like edge systems again for different structural surfaces, e.g.:

- top terrain surface,
- cliff face,
- waterline,
- road/path base,
- plateau side.

But do not stack multiple opaque top-surface Wang tiles on the same tile.

---

## 8. Asset Generation Priorities

Prioritize assets in this order:

1. Swamp / wet mud / mud pool stack.
2. Water transitions:
   - shallow_water ↔ wet_mud
   - shallow_water ↔ beach/wet_sand
   - river ↔ swamp/wet_mud
   - river ↔ grassland/savanna
3. Grassland/savanna/steppe dry-ground stack.
4. Tundra/snow/frozen-earth stack.
5. Forest/taiga/leaf-litter stack.
6. Rock/hill/mountain/cliff stack.
7. Mystic/volcanic special stacks.

The user specifically mentioned missing water body support. Audit water carefully.

---

## 9. Existing Known Concerns

Known issues from current project state:

- Many existing Wang PNGs are effectively placeholder/transparent.
- Water biomes may lack complete Wang catalog entries.
- Some existing PixelLab/asset sheets may be too low resolution or not sliced correctly.
- Random stamping is not acceptable.
- Centered sprites on every tile are not acceptable.
- Horizontal biome continuity matters more than decorative density.

---

## 10. What To Audit

Audit whether current assets are good enough for each layer.

For each biome/material/surface family, answer:

1. Do we have a suitable opaque base tile?
2. Do we have 16 Wang masks?
3. Are the Wang masks actually opaque/contentful, or placeholder transparent?
4. Do we have surface overlays with alpha?
5. Do we have micro decals with alpha?
6. Do we have medium dressing sprites?
7. Do we have gameplay object sprites?
8. Are dimensions consistent?
9. Are sprites too centered/repetitive?
10. Are colors compatible with current palettes?

Write findings to:

```txt
assets/pixelab/landscape_v2/audit/existing_asset_audit.json
assets/pixelab/landscape_v2/audit/missing_asset_report.md
```

---

## 11. Prompt Generation Requirements

Use the templates from:

```txt
docs/PIXELAB_LANDSCAPE_ASSET_GENERATION_MANIFEST.md
```

Generate prompt rows into:

```txt
assets/pixelab/landscape_v2/prompts/generated_prompts.jsonl
```

Each row must include:

```json
{
  "id": "...",
  "path": "...",
  "seed": 123,
  "prompt": "...",
  "negativePrompt": "...",
  "dimensions": [32, 32],
  "layer": "base|surface_overlay|micro|medium|object|transition|structure",
  "family": "..."
}
```

---

## 12. Seed Discipline

Use deterministic seeds from the manifest:

```txt
base tiles:       100000000 + familyIndex * 100000 + variant
wang tiles:       200000000 + familyIndex * 100000 + mask * 1000 + variant
transitions:      300000000 + transitionIndex * 100000 + mask * 1000 + variant
surface overlays: 400000000 + familyIndex * 100000 + variant
micro:            500000000 + familyIndex * 100000 + variant
medium:           600000000 + familyIndex * 100000 + variant
objects:          700000000 + familyIndex * 100000 + variant
structure:        800000000 + familyIndex * 100000 + variant
```

---

## 13. First Concrete Task

Start with a focused swamp batch.

Create prompt/metadata scaffolding for:

```txt
base/swamp_wet_mud
base/swamp_mud_pool
surface_overlays/mud_pool
surface_overlays/wet_mud_shine
surface_overlays/algae_film
micro/dark_mud_flecks
micro/moss_ground_cover
micro/reeds_grass_blades
medium/reeds
medium/cattails
medium/root_cluster
medium/moss_clump
objects/forage_bush_swamp
objects/swamp_tree
objects/reed_harvest_node
transitions/water_shallow__to__swamp_wet_mud
transitions/water_river__to__swamp_wet_mud
transitions/forest_floor__to__swamp_ground
```

For the first loop, do not attempt the full 18,000 asset space. Build the scaffold and prompt batch for this swamp slice first.

---

## 14. Success Criteria For First Loop

At the end of your first one-minute loop, these should exist:

```txt
assets/pixelab/landscape_v2/README.md
assets/pixelab/landscape_v2/manifest.json
assets/pixelab/landscape_v2/prompts/generated_prompts.jsonl
assets/pixelab/landscape_v2/prompts/generation_report.json
assets/pixelab/landscape_v2/audit/layer_contract_report.md
```

They should be valid, readable, and directly connected to the swamp tile stack described above.

---

## 15. Do Not Do These Things

Do not:

- overwrite existing `assets/catalog` art,
- generate random decorative sprites with no layer role,
- use opaque overlays above opaque base tiles unless explicitly structural,
- center every micro decal,
- ignore water transitions,
- ignore metadata,
- ignore file naming conventions,
- produce only prose with no files,
- create a separate framework that contradicts `src/render/landscape-recipe.js`.

---

## 16. How To Talk About Results

When summarizing progress, always use this format:

```txt
Loop N Summary
- Files created/updated:
- Families covered:
- Asset prompts generated:
- Missing assets discovered:
- Risks/questions:
- Next loop action:
```

---

## 17. Current Renderer Files To Align With

The renderer currently has:

```txt
src/render/landscape-recipe.js
src/render/tile-painter.js
src/render/chunk-render-cache.js
src/render/wang-terrain-painter.js
```

Do not assume the renderer is final. But do align asset taxonomy with `landscapeRecipe(tile)` and the diagnostic panel fields.

---

## 18. Final Reminder

The goal is not simply “more assets.”

The goal is:

> a coherent, deterministic, horizontally continuous landscape construction system where PixelLab assets plug into known layers and can be reasoned about from tile diagnostics.

Start with swamp/wet mud/mud pools because it exercises base Wang tiles, surface overlays, micro ecology, medium dressing, and water transitions.
