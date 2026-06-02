# Claude Kickoff Prompt — PixelLab Landscape V2 Session 2: High-Volume Generation

You are Claude working inside the FreedomMMO / WizardGenie project. This is a CONTINUATION of previous work. A prior session created scaffold files and generated the first ~61 swamp assets. Your job is to continue at high volume.

---

## 0. FIRST: Read These Files Before Doing Anything

```txt
assets/pixelab/landscape_v2/PROGRESS.md          ← Current state, what's done, what's pending
assets/pixelab/landscape_v2/prompts/pending_jobs.json  ← PixelLab jobs still waiting for download
assets/pixelab/landscape_v2/manifest.json         ← Asset manifest with seed scheme
assets/pixelab/landscape_v2/audit/missing_asset_report.md ← What's missing
docs/PIXELAB_LANDSCAPE_ASSET_GENERATION_MANIFEST.md     ← The full generation contract
src/render/landscape-recipe.js                    ← Renderer alignment
```

Read `PROGRESS.md` first. It tells you exactly what was done, what completed, what failed, and what jobs are still pending download.

---

## 1. Immediate Actions (Before Any New Generation)

### 1a. Download Pending Jobs

Read `pending_jobs.json`. For every job where `downloaded: false`:
- Check its status with the appropriate PixelLab get tool
- If completed: download immediately to the correct path
- If failed: note it and resubmit
- If still processing: leave it, check later
- Mark `downloaded: true` in the JSON after saving the file
- Map objects auto-delete after 8 hours — prioritize these

### 1b. Check Stuck Jobs

These jobs were stuck at 95% last session:
- `c360c3f7` — shallow_water → swamp tileset
- `0700877d` — forest_floor → swamp tileset
- `db2220f5` — moss_clump 48x48
- `56785be4` — swamp_tree v2 96x96

If they completed: download. If they failed: resubmit without chaining.

### 1c. Inventory Check

After all downloads, count total PNGs per layer and update PROGRESS.md.

---

## 2. Understanding the Three PixelLab Tools

### `create_topdown_tileset` — For Wang Tiles ONLY

- Generates 16-tile Wang sets with proper corner adjacency
- These tiles MUST seamlessly join with each other
- ~100-500s per set, can get stuck in server queue
- Use for: Layer 1 base Wang tiles, Layer 7 transition Wang tiles
- **DO NOT chain** with `upper_base_tile_id` / `lower_base_tile_id` unless the source tileset is already completed
- Download the spritesheet PNG + metadata JSON, then slice into 16 individual tiles using the bounding_box coordinates from metadata

### `create_tiles_pro` — For Batch Tile Variants

- Generates ~16 tiles per call in ~30s
- Number your descriptions: "1). grass tile 2). dirt tile 3). stone tile"
- Use for: Layer 1 base tile variants (non-Wang), Layer 2 structure decals, Layer 3 surface overlays, Layer 4 micro decals
- Use `square_topdown` tile_type, `top-down` view for terrain decals
- Use `segmentation` outline_mode for cleaner results
- **Limitation:** these don't have proper Wang adjacency — don't use for Wang masks
- **Limitation:** alpha quality is mixed — some tiles come out too opaque for overlay use

### `create_map_object` — For Individual Sprites

- Generates 1 transparent-background sprite per call
- ~5-7 minutes per call (slow but reliable)
- Use for: Layer 5 medium dressing, Layer 6 gameplay objects
- Always specify `view: "high top-down"`, `outline: "lineless"` for dressing, `"selective outline"` for interactive objects
- Objects auto-delete after 8 hours — download immediately when done

---

## 3. Volume Strategy

The target is ~2,072 assets for the swamp slice alone. To hit volume:

### Batch Pattern

1. Fire 6-10 `create_tiles_pro` calls in parallel (= ~96-160 tiles, ~30s)
2. Fire 15-20 `create_map_object` calls in parallel (= 15-20 sprites, ~7min)
3. Fire 2-3 `create_topdown_tileset` calls (= 32-48 Wang tiles, ~5-10min)
4. While waiting: update tracking files, download any completed jobs
5. After ~2 min: sweep-download completed tiles_pro
6. After ~7 min: sweep-download completed map_objects
7. After ~10 min: sweep-download completed tilesets, slice them
8. Repeat

### Tracking

After EVERY batch submission:
1. Append all job IDs to `pending_jobs.json`
2. Update `PROGRESS.md` with current counts
3. Never rely on conversation context for job IDs — always persist to files

### Download Script

A helper script exists at `assets/pixelab/landscape_v2/download_pending.py`. It reads `pending_jobs.json` and downloads anything that's ready. Use it or replicate its logic.

---

## 4. What Still Needs Generation (Swamp Slice)

### Already Done (from session 1)

| Layer | Family | What Exists | Count |
|-------|--------|-------------|-------|
| Base Wang | swamp_wet_mud | 16 Wang tiles + tileset | 17 |
| Base Wang | swamp_mud_pool | 16 Wang tiles + tileset | 17 |
| Surface | mud_pool | 2 decals | 2 |
| Surface | wet_mud_shine | 2 decals | 2 |
| Surface | algae_film | 4 decals | 4 |
| Micro | dark_mud_flecks | 4 decals (2 too opaque) | 4 |
| Micro | moss_ground_cover | 2 decals | 2 |
| Micro | reeds_grass_blades | 2 decals (too opaque) | 2 |
| Medium | reeds | 3 sprites (32+48+64) | 3 |
| Medium | cattails | 2 sprites (32+48) | 2 |
| Medium | root_cluster | 2 sprites (48+64) | 2 |
| Medium | moss_clump | 1 sprite (32) | 1 |
| Object | forage_bush_swamp | 1 sprite (64) | 1 |
| Object | swamp_tree | 1 sprite (96) | 1 |
| Object | reed_harvest_node | 1 sprite (32) | 1 |
| **Total on disk** | | | **~61** |

Plus ~6 tiles_pro batches (96 tiles) and ~19 map objects submitted but not yet downloaded from session 1.

### What's Still Needed (per manifest targets)

| Layer | Family | Target | Have | Need |
|-------|--------|--------|------|------|
| Base tiles | swamp_wet_mud | 32 variants | 0 (only Wang) | 32 |
| Base tiles | swamp_mud_pool | 32 variants | 0 (only Wang) | 32 |
| Base Wang | swamp_wet_mud | 16 masks | 16 | 0 ✓ |
| Base Wang | swamp_mud_pool | 16 masks | 16 | 0 ✓ |
| Surface | mud_pool | 112 (64@32 + 32@16 + 16@64) | 2 | 110 |
| Surface | wet_mud_shine | 112 | 2 | 110 |
| Surface | algae_film | 112 | 4 | 108 |
| Micro | dark_mud_flecks | 176 | 4 | 172 |
| Micro | moss_ground_cover | 176 | 2 | 174 |
| Micro | reeds_grass_blades | 176 | 2 | 174 |
| Medium | reeds | 168 (96@32 + 48@48 + 24@64) | 3 | 165 |
| Medium | cattails | 168 | 2 | 166 |
| Medium | root_cluster | 168 | 2 | 166 |
| Medium | moss_clump | 168 | 1 | 167 |
| Object | forage_bush_swamp | 96 | 1 | 95 |
| Object | swamp_tree | 96 | 1 | 95 |
| Object | reed_harvest_node | 96 | 1 | 95 |
| Transition | shallow_water↔swamp | 40 | 0 | 40 |
| Transition | river↔swamp | 40 | 0 | 40 |
| Transition | forest_floor↔swamp | 40 | 0 | 40 |
| **Total** | | **~2,072** | **~61** | **~2,011** |

### Generation Tool Mapping

| What | Tool | Calls Needed | Yield |
|------|------|-------------|-------|
| 64 base tile variants | `create_tiles_pro` x4 | ~64 tiles |
| 330 surface overlays | `create_tiles_pro` x21 | ~336 tiles |
| 520 micro decals | `create_tiles_pro` x33 | ~528 tiles |
| 667 medium sprites | `create_map_object` x667 | 667 sprites |
| 286 object sprites | `create_map_object` x286 | 286 sprites |
| 3 transition Wang sets | `create_topdown_tileset` x3 | 48 tiles |
| 24 transition overlays | `create_tiles_pro` x2 | ~32 tiles |
| **Totals** | **~1,016 API calls** | **~1,961 assets** |

At ~6,091 generations remaining, we have budget for this.

---

## 5. Seed Discipline

Use deterministic seeds from the manifest:

```
base tiles:       100000000 + familyIndex * 100000 + variant
wang tiles:       200000000 + familyIndex * 100000 + mask * 1000 + variant
transitions:      300000000 + transitionIndex * 100000 + mask * 1000 + variant
surface overlays: 400000000 + familyIndex * 100000 + variant
micro:            500000000 + familyIndex * 100000 + variant
medium:           600000000 + familyIndex * 100000 + variant
objects:          700000000 + familyIndex * 100000 + variant
structure:        800000000 + familyIndex * 100000 + variant
```

Family indices are in `manifest.json` under `familyIndex`.

---

## 6. File Naming Convention

```
{family}__{type}__v{NNN}.png
```

Examples:
```
mud_pool__overlay__v000.png
dark_mud_flecks__micro__v004.png
reeds__medium__v012.png
swamp_tree__object__v003.png
swamp_wet_mud__wang_07__v000.png
swamp_wet_mud__tile__v015.png
```

---

## 7. Download and Slicing Procedures

### For `create_tiles_pro` results:
1. Call `get_tiles_pro(tile_id)` to get storage URLs
2. Download each `tile_N.png` from the storage URLs
3. Map tile index to family using `pending_jobs.json` → `download_mapping`
4. Count existing variants in target directory to determine next variant number
5. Save as `{family}__{type}__v{NNN}.png`

### For `create_topdown_tileset` results:
1. Call `get_topdown_tileset(tileset_id)` to get download URLs
2. Download the spritesheet PNG and metadata JSON
3. Parse metadata for `tileset_data.tiles[].bounding_box`
4. Use PIL to crop each tile from the spritesheet
5. Save as `{family}__wang_{mask}__v{NNN}.png`

### For `create_map_object` results:
1. Call `get_map_object(object_id)` to get download URL
2. Download from the URL
3. Save to correct family/sprites/ directory

---

## 8. Quality Checks

After downloading, validate:
- Dimensions match expected (32x32, 48x48, 64x64, 96x96)
- Mode is RGBA
- Base/Wang tiles are opaque (0% transparent)
- Overlay/micro/medium/object tiles have substantial transparency (>15%)
- Color count is reasonable (>10 unique colors for detailed tiles)
- No corrupt/empty files

---

## 9. Progress Reporting

After every batch:

```
Loop N Summary
- Files created/updated:
- Families covered:
- Asset prompts generated:
- Missing assets discovered:
- Risks/questions:
- Next loop action:
```

Update `PROGRESS.md` and `pending_jobs.json` after EVERY action.

---

## 10. Do Not Do These Things

- Do not overwrite existing `assets/catalog` files
- Do not chain tilesets with base_tile_id unless the source is fully completed
- Do not poll the same stuck job repeatedly — note it and move on
- Do not rely on conversation context for job IDs — persist everything to files
- Do not generate random sprites without a layer role
- Do not use opaque tiles for overlay layers
- Do not generate Wang tiles with `create_tiles_pro` — use `create_topdown_tileset`
- Do not forget to download map objects within 8 hours (they auto-delete)

---

## 11. Priorities

1. Download all pending jobs from session 1
2. Retry any failed transition Wang tilesets (without chaining)
3. High-volume surface overlay generation (tiles_pro batches)
4. High-volume micro decal generation (tiles_pro batches)
5. High-volume medium dressing generation (map_object batches)
6. Object sprite variants (map_object batches)
7. Base tile variants (tiles_pro batches)
8. Update all tracking files

---

## 12. Context Survival

If context is cleared or a new session starts:
1. Read `PROGRESS.md` first — it has the full state
2. Read `pending_jobs.json` — it has all job IDs needing download
3. Count PNGs on disk to verify actual state
4. Resume from where the progress file says

All state is in files. Nothing critical is in conversation context only.
