# Elevation Cliff Rendering — Session Transition Document

> **For the next Claude session:** Read this document COMPLETELY before making any changes. The architecture is correct. The remaining bugs are specific and identified. Do NOT redesign the system.

## Current State (latest screenshot)

The terrain structure IS working — elevation zones are visible, edges have correct Wang shapes, transitions appear at correct locations. But the art style is very different from what we want (dark permafrost patterns instead of the nice green/white we had with the original tiles).

**Masking bug is FIXED** — tiles were re-downloaded raw without masking (commit `2e7e80e`). The gray→alpha masking approach was abandoned because PixelLab's void color varies per surface (gray for snow, dark blue for frozen_earth) making threshold-based masking unreliable.

## THE TASK: ADD PROPER TRANSPARENCY

The surface tiles need alpha transparency so edge tiles show through to the lower elevation level. Do NOT use threshold-based pixel masking. Instead use one of:

### Option A: PixelLab `/remove-background` API (RECOMMENDED)
`POST /v2/remove-background` takes an image and returns it with transparent background. Process each of the 16 tiles per surface (192 tiles total) through this endpoint. It uses AI to properly separate foreground from background.

```bash
curl -X POST https://api.pixellab.ai/v2/remove-background \
  -H "Authorization: Bearer de8bc1ce-8264-4c56-aa9f-03c9097ee45e" \
  -H "Content-Type: application/json" \
  -d '{"image": {"base64": "..."}, "image_size": {"width": 32, "height": 32}, "background_removal_task": "remove_simple_background", "text": "pixel art terrain surface tile"}'
```

Only process edge tiles (grid 1-14). Grid 0 (all-void) can just be set to fully transparent. Grid 15 (all-surface) stays fully opaque.

### Option B: Use original good-looking tiles + remove-background
The original tiles (git commit `3e69dc6`) looked great but had no alpha. Extract them from git, run through remove-background, get the best of both worlds.

### Surface Tileset IDs (already generated, just need transparency processing)
```
snow:           abd51b4e-60b7-4cb5-b1c5-88db11dd020d
golden_sand:    7a4205af-96e2-440f-8e2d-117c2d72d055
lush_grass:     b36d7e93-73f6-4aad-ba01-18b34855a164
dry_grass:      b3ebf4ec-847b-4607-acec-ed6ba49689bd
forest_floor:   aa48417e-30d7-48ae-9b22-9753a8e5e60a
dark_humus:     5a42c10b-a28c-482d-ad32-18fa37a9bf8b
swamp_mud:      703eb37f-adf5-40cd-a21b-5318043a4df1
grey_rock:      d0082347-c177-490a-9785-8149dd387cf4
volcanic_rock:  7554c257-7618-4b86-b7a2-6d6c445269a7
frozen_earth:   f3213083-ec76-4838-9263-c110539e9fe9
glacial_ice:    74c9aca9-19de-411c-a9de-1c6b47995d56
mystic_crystal: ec1782b7-713c-4ca8-a4a3-3b4f1a4cd983
```

DO NOT regenerate — just re-download from PixelLab (they're already generated) and re-apply the masking with the CORRECT reference pixel (grid 0, not grid 6).

## ARCHITECTURE (correct, do not change)

### Per-Elevation-Level Sprite Rendering
Each 64×64 tile chunk renders as multiple Sprite2D — one per quantized elevation level (8 levels). Higher-level sprites are positioned higher on screen by `level × pixels_per_unit`. This creates visible terrain elevation like ALTTP.

- `ElevationRenderer.render_chunk()` → `Array[{image: Image, level: float, z_order: int}]`
- `LayeredChunkRenderer` creates one Sprite2D per level entry
- Sprite position: `Vector2(chunk_x * px_size, chunk_y * px_size - level * ppu)`

### Wang Tile Index Remap (VERIFIED CORRECT)
PixelLab's new convention (verified via metadata API for tileset `8c30af01`):
- Grid index = NW×8 + NE×4 + SW×2 + SE×1
- Where NW=TL, NE=TR, SW=BL, SE=BR
- Our convention: wang = TL×1 + TR×2 + BL×4 + BR×8
- Relationship: grid = reverse_bits(wang)

```
WANG_TO_GRID = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15]
```

This is in `layered_tileset_loader.gd`. DO NOT CHANGE IT — it matches the metadata.

### Surface Selection
- Interior tiles (all neighbors at same level): wang_15 → solid fill
- Edge tiles (neighbors at lower level): transition Wang tile with correct corner bits
- Edge detection uses 8-neighbor check (N, S, E, W, NE, NW, SE, SW)
- Transition tilesets used when available (e.g., frozen_earth__snow)
- Falls back to self-surface Wang tile if no transition exists

### Tile Loading
- `LayeredTilesetLoader` reads raw PNGs via FileAccess (not Godot's load(), which strips alpha)
- Files stored as `wang_0.png` through `wang_15.png` (grid index, not our wang index)
- Remap applied in `get_tile()`: converts our wang index → grid index → file

### Elevation Quantization
- `ELEV_LEVELS = 8` → step = 0.125 elevation → 64px visual height per step
- `pixels_per_unit = 512.0`
- Quantized values used for Y-positioning, cliff walls, and surface selection

## REMAINING ISSUES AFTER THE MASKING FIX

### Issue 2: Cliff Wall Art (wrong textures)
The 84 cliff tiles in `assets/catalog/terrain_v3/cliffs/` were generated as top-down Wang patterns via `create_topdown_tileset`. They should be SIDE-VIEW wall faces (rock strata, ice layers).

**Fix options:**
- Use `create_sidescroller_tileset` which has built-in transparent backgrounds and side-view perspective
- Or use procedural cliff fills (surface-colored with horizontal strata lines — code exists in git at commit `451fdcc`)

### Issue 3: Tile Art Style
The regenerated surface tiles have different art style from the original L1 tiles. If the art looks wrong after fixing the masking, consider:
- Using `/remove-background` API endpoint on the ORIGINAL tiles (git commit `3e69dc6`)
- Iterating on PixelLab descriptions

### Issue 4: Disconnected Floating Tiles  
Small isolated tile clusters at upper level. Low priority. Filter by minimum cluster size.

## FILE MAP

```
scripts/core/world_compiler/
├── elevation_renderer.gd      ← Per-level image rendering (main renderer)
├── layered_chunk_renderer.gd   ← Multi-sprite management
├── layered_tileset_loader.gd   ← Tile loading + Wang remap
├── hypergraph_tile_resolver.gd ← Surface selection from biome+elevation
├── elevation_gradient_table.gd ← Biome gradient data
├── cliff_tile_loader.gd        ← Cliff face assets (wrong art)
└── chunk_data.gd               ← ChunkData: SIZE=64, elevation[], biome_id[]

assets/catalog/terrain_v3/
├── surfaces/          13 dirs × 16 tiles (12 with alpha masking — NEEDS RE-DOWNLOAD)
├── transitions/       19 dirs × 16 tiles (matched to new surfaces, correct)
├── cliffs/            12 dirs × 7 pieces (wrong art — top-down not side-view)
└── gradients.json     18 biome elevation gradients

scripts/CleanWorld.gd  ← Main scene, wires up chunk_streamer → layered_renderer
scripts/core/chunk_streamer.gd ← Chunk lifecycle, skip_legacy_render=true
```

## KEY GIT COMMITS
- `3e69dc6` — Best visual version with OLD tiles (good art, no alpha)
- `81ac98a` — Correct Wang remap for new PixelLab convention
- `ce35601` — Alpha surface tiles (masking bug — wrong reference pixel)
- `1b70c4c` — 19 transition tilesets (matched to new surfaces)
- `1c3d284` — Reverted failed masking experiments

## PIXELLAB API
- **MCP tools:** `create_topdown_tileset`, `get_topdown_tileset` — generation + spritesheet download
- **Direct API:** `POST /v2/create-tileset` — returns individual tiles with `corners: {NW,NE,SW,SE}` metadata
- **Remove background:** `POST /v2/remove-background` — strips bg to transparent (max 400×400)
- **API key:** `de8bc1ce-8264-4c56-aa9f-03c9097ee45e`
- **Docs:** https://api.pixellab.ai/v2/docs

## CRITICAL: TWO PIXELLAB CONVENTIONS

PixelLab has TWO DIFFERENT spritesheet layouts depending on the endpoint:
- **MCP endpoint** (`create_topdown_tileset` via MCP tools): grid_6=all-lower, grid_12=all-upper
- **Direct API** (`POST /v2/create-tileset`): grid_0=all-lower, grid_15=all-upper (binary encoding)

ALL our tiles were generated via MCP. Use the MCP convention:
```
WANG_TO_GRID = [6, 5, 2, 3, 10, 1, 4, 13, 7, 14, 11, 0, 9, 8, 15, 12]
```

This was verified by pixel-sampling corners of actual MCP-generated spritesheets.

## MASKING STATUS

Gray→alpha masking was **REMOVED**. The surface tiles are raw PNGs from PixelLab with NO post-processing. The masking approach failed because:
1. The void color varies per surface (gray for snow, dark blue for frozen_earth)
2. Threshold-based masking is unreliable across different surface colors
3. The wrong reference pixel was used (grid_6 instead of grid_0)

**Next approach for transparency:** Use PixelLab's `/remove-background` API on individual tiles, or find another way.

## STEP-BY-STEP FOR NEXT SESSION

1. Read this document AND `memory/project_session_2026_05_27.md` completely
2. **FULL TILE-BY-TILE AUDIT** — the user requested this. For at least 2 tilesets (one surface, one transition), read every wang_0..wang_15 image and verify what corners are upper/lower. Confirm the WANG_TO_GRID mapping is correct. Document findings.
3. **Verify biome at spawn** — origin (0,0) is tundra/arctic, NOT grassland. Frozen_earth is dark teal — this is correct art for "permafrost," just different from the old green. Teleport to different biomes to verify each surface renders correctly.
4. **Add transparency** — use PixelLab `/remove-background` API on edge tiles (grid 1-14, not 0 or 12). Or generate new tiles using the direct API which returns individual tiles with corner metadata.
5. Generate proper cliff wall art using `create_sidescroller_tileset`
6. Test across biomes: coast (-15, -220), inland grassland, desert, mountains
7. Filter disconnected floating tiles
