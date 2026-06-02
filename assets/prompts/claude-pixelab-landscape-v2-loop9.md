# Claude Kickoff Prompt — PixelLab Landscape V2 Session 10: Object Deepening + Medium Sprites

You are Claude working inside the FreedomMMO / WizardGenie project. This is a CONTINUATION of sessions 1-9.

## 0. FIRST: Read This File Before Doing Anything

```
assets/pixelab/landscape_v2/PROGRESS.md
```

## 1. Current State (as of session 9 end)

- **4,487 PNGs on disk** across all asset categories
- **22 biomes fully covered**: base wang(16) + tiles(16) + overlays(48-64) + objects(5-48)
- **53/53 Wang transitions on disk** — ALL DONE
- **Generations remaining: ~2,272 of 10,000**

### Asset Inventory Summary

| Category | PNGs | Coverage |
|----------|------|----------|
| Base (wang+tiles) | 726 | 22/22 biomes ✓ |
| Surface overlays | 1,464 | 22/22 biomes ✓ |
| Objects | 456 | 22/22 biomes (5-48 per biome) |
| Transitions | 919 | 53/53 pairs ✓ |
| Medium sprites | 242 | swamp ONLY |
| Micro decals | 680 | swamp ONLY |

### Object Counts (lowest → highest)
```
deep_ocean: 5    | shallow_water: 5  | river: 5     | lake: 6
ocean: 6         | arctic: 8         | dense_forest: 8 | tropical: 8
volcanic: 10     | mystic: 11        | mountains: 12   | taiga: 12
tundra: 18       | steppe: 19        | beach: 30       | desert: 30
hills: 30        | savanna: 30       | grassland: 41   | forest: 48
```

### 7 Objects Still Pending Download (generated in session 9)
These were generated but context was cleared before download. They auto-delete after 8 hours from ~13:42 UTC on 2026-06-02. If still available, download them:
- `6474a32f` → river_interactive/river_wooden_bridge__object__v003.png
- `9337f10b` → shallow_water_interactive/shallow_anchor__object__v001.png
- `77279450` → arctic_wildlife/arctic_polar_bear__object__v002.png
- `5ac0e922` → dense_forest_flowers/dense_forest_giant_mushroom__object__v001.png
- `6c029d14` → tropical_tree/tropical_coconut_palm__object__v002.png
- `15fff5f9` → volcanic_wildlife/volcanic_fire_elemental__object__v000.png
- `eef3469a` → dense_forest_wildlife/dense_forest_badger__object__v000.png

---

## 2. Session 10 Priorities

### Priority A: Download Pending Objects (if still alive)
Try `get_map_object(id)` for each of the 7 IDs above. If completed, download. If expired, skip.

### Priority B: Object Deepening (~60 gens per batch of 6)
Push weakest biomes toward 15+ objects each. Target order:
1. deep_ocean (5→15): +10 objects needed
2. shallow_water (5→15): +10
3. river (5→15): +10
4. lake (6→15): +9
5. ocean (6→15): +9
6. arctic (8→15): +7
7. dense_forest (8→15): +7
8. tropical (8→15): +7

Object types per biome to diversify:
- **Water**: wildlife (fish, crabs, turtles), flora (seaweed, coral, kelp), interactive (fishing spots, treasure, wrecks), rocks (underwater formations)
- **Land**: trees, rocks, wildlife, flowers, interactive nodes, ground cover, shrubs

### Priority C: Medium Sprites (if budget allows)
Swamp has 4 medium families (reeds, cattails, root_cluster, moss_clump) at 50+ each.
Other biomes need equivalent medium-size decoration sprites. Use `create_tiles_pro` with 16 variations per family.
Target: 2-3 medium families per biome, stored in `medium/{biome}_{family}/sprites/`

### Priority D: Overlay Parity (low priority)
Session 5 biomes (grassland, forest, beach, desert, hills, savanna, tundra) have 48 overlays (3 layers).
Session 6+ biomes have 64 (4 layers). Could add L5 atmospheric layer to equalize.

---

## 3. Generation Pattern

### For Objects (6 at a time, ~30-90s each):
```
create_map_object(description, width, height, view="high top-down", outline="lineless", detail="medium detail")
```
Download with: `curl -sL {download_url} -o objects/{biome}_{family}/sprites/{name}__object__v{NNN}.png`

### For Medium Sprites (tiles_pro, 16 per batch):
```
create_tiles_pro(description="1). variant_a 2). variant_b ... 16). variant_p",
                 tile_type="square_topdown", tile_size=32, tile_view="high top-down")
```
Download with: `curl -sL {backblaze_url}/tile_{i}.png -o medium/{biome}_{family}/sprites/{name}__medium__v{NNN}.png`

---

## 4. File Naming & Paths

```
Objects:    assets/pixelab/landscape_v2/objects/{biome}_{family}/sprites/{name}__object__v{NNN}.png
Medium:     assets/pixelab/landscape_v2/medium/{biome}_{family}/sprites/{name}__medium__v{NNN}.png
Base wang:  assets/pixelab/landscape_v2/base/{biome}/wang/{biome}__wang_{N}__v000.png
Base tiles: assets/pixelab/landscape_v2/base/{biome}/tiles/{biome}__tile__v{NNN}.png
Overlays:   assets/pixelab/landscape_v2/surface_overlays/{biome}_{layer}/decals/{name}__overlay__v{NNN}.png
```

---

## 5. Rate Limits & Budget

- `create_map_object`: Max 6 concurrent, ~30-90s each, ~1 gen each
- `create_tiles_pro`: Separate rate bucket from objects, ~15-30s, ~20-40 gens each
- **Budget: ~2,272 gens remaining**
- Each object = ~1 gen, each tiles_pro = ~30 gens
- 60 objects = ~60 gens, 4 tiles_pro batches = ~120 gens

---

## 6. Key Rules

1. Wang tilesets MUST be 32x32 — NEVER 16x16
2. Max 6 concurrent map_objects — more causes 429 rate limit
3. tiles_pro and map_objects are SEPARATE rate buckets — fire both simultaneously
4. Backblaze URLs work with curl but NOT Python urllib (403)
5. Always persist state to PROGRESS.md — context will be cleared
6. Never overwrite existing files — use next variant number
7. Diversify object types within each biome (trees, rocks, flowers, wildlife, interactive, etc.)

---

## 7. Do Not

- Generate Wang tilesets — ALL 53 ARE DONE
- Generate base wang or plain tiles — ALL 22 BIOMES ARE DONE
- Overwrite existing files — always use next variant number
- Fire >6 concurrent map_objects (429 rate limit)
- Use 16x16 for anything — always 32x32
