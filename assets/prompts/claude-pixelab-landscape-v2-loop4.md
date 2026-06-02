# Claude Kickoff Prompt — PixelLab Landscape V2 Session 5: Wang Transition Blitz + Multi-Biome Expansion

You are Claude working inside the FreedomMMO / WizardGenie project. This is a CONTINUATION of sessions 1-4. Session 4 achieved two major milestones:
1. **Swamp biome minimums met** — all 7 medium/object families at 50+/30+ variants
2. **Wang transition blitz started** — went from 5 to 31 of 53 needed transition tilesets

Your job: **finish the remaining 22 Wang transitions, then begin expanding to other biomes.**

---

## 0. FIRST: Read These Files Before Doing Anything

```txt
assets/pixelab/landscape_v2/PROGRESS.md          ← Full state, counts, transition gap list
assets/pixelab/landscape_v2/prompts/pending_jobs.json  ← Any pending jobs
```

Read `PROGRESS.md` first — it has the complete 53-pair transition list with status markers.

---

## 1. Immediate Actions

### 1a. Check Pending Wang Tilesets

Session 4 had 6 Wang tilesets in-flight (batch 5) when context was cleared. Their IDs:

```
87379f10 — river → forest
37b3cb21 — river → hills
2c6b2755 — shallow_water → beach
ae1c5c8d — beach → desert
0b45f1bd — grassland → savanna
bdda3c47 — grassland → mystic
```

Check each with `get_topdown_tileset(id)`. Download completed ones. These are chainable tilesets that auto-delete after 8 hours, so act fast.

### 1b. Verify Disk Counts

```bash
BASE="assets/pixelab/landscape_v2"
echo "Wang transitions: $(find "$BASE/transitions" -type d -name wang -exec sh -c 'ls "$1"/*wang* 2>/dev/null | wc -l' _ {} \; | awk '$1>0{c++}END{print c}')"
echo "Total PNGs: $(find "$BASE" -name "*.png" | wc -l)"
```

---

## 2. Per-Biome Progress (as of Session 4 end)

| Biome | Base | Overlays | Micro | Medium | Objects | Transitions | Overall |
|-------|------|----------|-------|--------|---------|-------------|---------|
| **Swamp** | 100% | 100% | 100% | 35% | 40% | 100% | **~70%** |
| Grassland | 0% | 0% | 0% | 0% | 0% | 67% | **~8%** |
| Forest | 0% | 0% | 0% | 0% | 0% | 80% | **~8%** |
| Beach | 0% | 0% | 0% | 0% | 0% | 67% | **~5%** |
| Ocean | 0% | 0% | 0% | 0% | 0% | 50% | **~5%** |
| River | 0% | 0% | 0% | 0% | 0% | 60% | **~5%** |
| Lake | 0% | 0% | 0% | 0% | 0% | 80% | **~5%** |
| Shallow Water | 0% | 0% | 0% | 0% | 0% | 60% | **~5%** |
| Deep Ocean | 0% | 0% | 0% | 0% | 0% | 50% | **~3%** |
| Steppe | 0% | 0% | 0% | 0% | 0% | 50% | **~5%** |
| Desert | 0% | 0% | 0% | 0% | 0% | 40% | **~4%** |
| Savanna | 0% | 0% | 0% | 0% | 0% | 33% | **~3%** |
| Dense Forest | 0% | 0% | 0% | 0% | 0% | 50% | **~3%** |
| Tropical Forest | 0% | 0% | 0% | 0% | 0% | 50% | **~3%** |
| Taiga | 0% | 0% | 0% | 0% | 0% | 50% | **~3%** |
| Tundra | 0% | 0% | 0% | 0% | 0% | 40% | **~3%** |
| Mountains | 0% | 0% | 0% | 0% | 0% | 50% | **~3%** |
| Hills | 0% | 0% | 0% | 0% | 0% | 40% | **~3%** |
| Arctic | 0% | 0% | 0% | 0% | 0% | 0% | **0%** |
| Volcanic | 0% | 0% | 0% | 0% | 0% | 0% | **0%** |
| Mystic | 0% | 0% | 0% | 0% | 0% | 0% | **0%** |

**Overall: ~5% complete across all 21 biomes**

---

## 3. What Each Biome Needs (Full Layer Stack)

Per the biome-asset-manifest-spec and landscape-recipe.js, each biome requires:

### Layer Stack (5 layers per biome):
| Layer | Content | Tool | Count |
|-------|---------|------|-------|
| L1 Base | Opaque 32x32 Wang tileset | `create_topdown_tileset` | 16 tiles |
| L2 Detail | Surface texture overlays | `create_tiles_pro` | 16 tiles |
| L3 Vegetation | Growing things (transparent) | `create_tiles_pro` | 16 tiles |
| L4 Scatter | Small objects (transparent) | `create_tiles_pro` | 16 tiles |
| L5 Atmospheric | Particles/effects (transparent) | `create_tiles_pro` | 16 tiles |

### Per-Biome Object Families (8 families × ~50-256 variants each):
| Family | Content | Tool | Min Count |
|--------|---------|------|-----------|
| Trees | Biome-appropriate trees | `create_map_object` | 50+ |
| Shrubs | Bushes, undergrowth | `create_map_object` | 50+ |
| Flowers | Ground flowers, small plants | `create_map_object` | 30+ |
| Ground Cover | Moss, lichen, leaf piles | `create_map_object` | 50+ |
| Stones | Rocks, boulders | `create_map_object` | 30+ |
| Interactive | Forageable/harvestable nodes | `create_map_object` | 30+ |
| Canopy | Tree canopy overlays | `create_map_object` | 30+ |
| Ambient | Insects, small animals | `create_map_object` | 20+ |

### Transitions:
- Wang tilesets for every adjacent biome pair (see PROGRESS.md for the 53-pair list)

---

## 4. Priority Order for Session 5

### Phase A: Finish Wang Transitions (22 remaining)
Continue generating the remaining 22 transition pairs. Fire 6 at a time using `create_topdown_tileset`. Each takes ~100-350s.

**Remaining transitions (from PROGRESS.md):**
```
Still need:
- forest ↔ hills
- forest ↔ mystic
- dense_forest ↔ tropical_forest
- dense_forest ↔ mystic
- tropical_forest ↔ mystic
- taiga ↔ hills
- taiga ↔ mountains
- desert ↔ hills
- desert ↔ volcanic
- desert ↔ steppe (may already have as steppe_to_desert)
- savanna ↔ steppe
- savanna ↔ hills
- steppe ↔ hills
- tundra ↔ steppe
- tundra ↔ hills
- tundra ↔ mountains
- hills ↔ volcanic
- mountains ↔ volcanic
- (check batch 5 pending: river↔forest, river↔hills, shallow_water↔beach, beach↔desert, grassland↔savanna, grassland↔mystic)
```

### Phase B: Grassland Biome (next after swamp)
After transitions, start the grassland biome layer stack:
1. L1 Base Wang tileset — may already exist in PixelLab library (check `list_topdown_tilesets`)
2. L2-L5 overlay tiles using `create_tiles_pro`
3. Medium/object sprites using `create_map_object` loop (same 6-at-a-time pattern as swamp)

Grassland families:
- **Medium**: tall_grass, wildflowers, small_rocks, ground_herbs
- **Objects**: oak_tree, berry_bush, flower_patch, stone_formation, harvest_herb, harvest_berry

### Phase C: Forest Biome
Same layer stack process for forest.

---

## 5. Wang Tileset Generation Parameters

All Wang tilesets use these standard params:
```
tile_size: {"width": 32, "height": 32}
view: "high top-down"
outline: "lineless"
detail: "medium detail"
transition_size: 0.5
```

**CRITICAL: Use base tile IDs for chaining!** Existing IDs from our chain:
```
Swamp wet mud:     a267b749-1927-4d39-b73d-06a39301013d
Lush green grass:  c9ce4900-726d-4b56-bb5c-9aa2fc3d191a
Dark forest floor: 997894f5-3f3c-4d50-839e-2e32fa166a71
```

When creating new tilesets, use `lower_base_tile_id` or `upper_base_tile_id` to chain with these known tiles. Record new base tile IDs in PROGRESS.md for future chaining.

### Download + Slice Process
1. `get_topdown_tileset(id)` → get download URL
2. `curl -sL {url}/image -o tileset_spritesheet.png`
3. `magick tileset_spritesheet.png -crop 32x32+{X}+{Y} +repage wang_{N}.png` (4x4 grid)

---

## 6. Rate Limits

- `create_topdown_tileset`: Fire up to 6 concurrently. Each takes 100-350s.
- `create_map_object`: Max 6 concurrent. Each takes 30-90s.
- `create_tiles_pro`: Can run alongside map_objects. Each takes 15-30s for 16 tiles.
- Tilesets are separate from map_objects — you CAN fire both types simultaneously.

---

## 7. File Naming & Paths

```
Wang transitions: assets/pixelab/landscape_v2/transitions/{name}/wang/{name}__wang_{N}__v000.png
Base Wang:        assets/pixelab/landscape_v2/base/{family}/wang/{family}__wang_{N}__v000.png
Surface overlays: assets/pixelab/landscape_v2/surface_overlays/{family}/decals/{family}__overlay__v{NNN}.png
Micro decals:     assets/pixelab/landscape_v2/micro/{family}/decals/{family}__micro__v{NNN}.png
Medium sprites:   assets/pixelab/landscape_v2/medium/{family}/sprites/{family}__medium__v{NNN}.png
Object sprites:   assets/pixelab/landscape_v2/objects/{family}/sprites/{family}__object__v{NNN}.png
```

---

## 8. Progress Tracking

After every batch of transitions or every 10 sprite cycles, print status:
```
Wang: XX/53 | Swamp: XX% | Grassland: XX% | Forest: XX%
TOTAL PNGs: XXXX | Budget: ~XXXX remaining
```

Update PROGRESS.md every ~20 minutes or before context clear.

---

## 9. Generation Budget

- Sessions 1-3: ~1,800 generations used
- Session 4: ~400 generations used (sprites + tilesets)
- Remaining: ~3,800 of ~10,000
- Wang tilesets cost ~20-40 gens each
- Map objects cost ~1 gen each
- tiles_pro costs ~20-40 gens per batch of 16

22 remaining Wang tilesets × 30 gens = ~660 gens for full transition coverage.
This leaves ~3,100 gens for biome expansion.

---

## 10. Key Lessons Learned (Sessions 1-4)

1. Wang tilesets MUST be 32x32 — never 16x16
2. Wang tilesets take 100-350s — be patient, don't re-poll too early
3. Max 6 concurrent map_objects — more causes 429 rate limit
4. tiles_pro and topdown_tileset are separate rate buckets — fire both simultaneously
5. Use ImageMagick (`magick`) to slice 128x128 spritesheets into 16 individual 32x32 Wang tiles
6. Always use base_tile_id chaining for visual consistency across transitions
7. Backblaze URLs work with curl but NOT Python urllib (403)
8. Swamp "done enough" thresholds: 50+ medium, 30+ objects per family
9. Session prompt marked transitions "DONE" with only 5 — always verify disk state
10. The full game needs 53 unique transition pairs (from biome-graph.js adjacency rules)

---

## 11. Do Not

- Generate Wang tiles with `create_tiles_pro` — use `create_topdown_tileset`
- Overwrite existing files — always use next variant number
- Fire >6 concurrent map_objects (429 rate limit)
- Rely on conversation context for state — persist to files
- Skip base_tile_id chaining — produces inconsistent art
- Mark transitions "done" without verifying all 53 pairs
- Generate assets for swamp layers that are already over target

---

## 12. Context Survival

If context is cleared:
1. Read `PROGRESS.md` — full state with 53-pair transition checklist
2. Count PNGs on disk — verify
3. Check for pending PixelLab jobs
4. Resume Wang transition generation OR biome expansion
5. All state is in files, nothing critical in conversation
