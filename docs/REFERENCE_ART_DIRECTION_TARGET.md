# Reference Art Direction Target

The `reference/` folder now contains landscape/pixel-art quality references. These are not to be copied directly. They are used to calibrate the bar for density, polish, richness, readability, and premium modern pixel-art execution.

## How We Get There

1. **Reference Intake**
   - Maintain `reference/reference-manifest.json`.
   - Sorceress reference-analysis job: `assets/sorceress/jobs/reference_analysis.json`.
   - Output expected: `assets/generated/reference/reference_art_direction_analysis.json`.

2. **Art Direction System Prompt**
   - All jobs reference `assets/sorceress/SYSTEM_ART_DIRECTION_PROMPT.md`.
   - System prompt metadata references the reference manifest.

3. **Generation Strategy**
   - Generate high-density biome-specific base terrain.
   - Generate hundreds of biome-exclusive object variants.
   - Generate micro-layer overlays for dirt, mud, stones, grass, vines, leaves, insects, flowers, shrubs, canopy, water, cliffs, dunes, mountains.
   - Generate transition/autotile sheets so terrain does not read as repeated stamps.
   - Generate canopy/occlusion masks and contact reaction overlays.

4. **Runtime Assembly Strategy**
   - Terrain is assembled from multiple layers, not a single flat tile.
   - Scatter is patch-based and blue-noise/jittered, not coordinate-grid repeated.
   - Trees split into trunk/body/canopy layers for player occlusion.
   - Player and objects share y/elevation sorting.
   - Grass/bushes/flowers/water/mud/snow react to player contact.

5. **Quality Bar**
   - The game should look more lush and detailed than the references while remaining original.
   - No repeated diagonal artifacts.
   - No square debug noise.
   - No generic asset-pack look.
   - Every biome gets unique silhouettes, palettes, material language, and ecology.

## Agentic Tool Availability

In this current chat/tool namespace I can use code/file/browser/project tools, but I do not currently see direct callable Sorceress suite APIs. I can produce manifests/jobs and runtime import systems. If the editor exposes Sorceress controls through another panel or tool bridge, they need to be surfaced to this agent as callable tools before I can operate them directly.
