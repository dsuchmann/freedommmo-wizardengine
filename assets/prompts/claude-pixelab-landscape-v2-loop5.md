# Claude Kickoff Prompt — PixelLab Landscape V2 Session 6: Remaining Biomes + Variant Deepening

You are Claude working inside the FreedomMMO / WizardGenie project. This is a CONTINUATION of sessions 1-5. Session 5 was extremely productive:
1. **All 53 Wang transitions completed** — every biome pair has a 32x32 Wang tileset on disk
2. **8 biomes now have first-pass coverage** (overlay tiles + initial object families)
3. **2,960 PNGs on disk** — up from 1,889 at session start

Your job: **expand to remaining biomes and deepen existing ones.**

---

## 0. FIRST: Read These Files Before Doing Anything

```txt
assets/pixelab/landscape_v2/PROGRESS.md          ← Full state, biome inventories, base tile IDs
```

Read `PROGRESS.md` first — it has the complete biome inventory, session 6 priorities, and all base tile IDs.

---

## 1. Current State (as of session 5 end)

| Biome | Tiles | Objects | Status |
|-------|-------|---------|--------|
| **Swamp** | 66 base + overlays | ~232 medium + 112 objects | MINIMUMS MET |
| **Grassland** | 64 overlays | 46 objects (8 families) | FIRST PASS ✓ |
| **Forest** | 64 overlays | 48 objects (9 families) | FIRST PASS ✓ |
| **Beach** | 64 overlays | 30 objects (10 families) | FIRST PASS ✓ |
| **Desert** | 64 overlays | 30 objects (9 families) | FIRST PASS ✓ |
| **Hills** | 64 overlays | 30 objects (7 families) | FIRST PASS ✓ |
| **Savanna** | 64 overlays | 30 objects (8 families) | FIRST PASS ✓ |
| **Tundra** | 64 overlays | 18 objects (6 families) | FIRST PASS ✓ |
| Steppe | 0 | 0 | NOT STARTED |
| Mountains | 0 | 0 | NOT STARTED |
| Volcanic | 0 | 0 | NOT STARTED |
| Mystic | 0 | 0 | NOT STARTED |
| Taiga | 0 | 0 | NOT STARTED |
| Arctic/Snow | 0 | 0 | NOT STARTED |
| Dense Forest | 0 | 0 | NOT STARTED |
| Tropical Forest | 0 | 0 | NOT STARTED |
| Ocean | 0 | 0 | NOT STARTED |
| Lake | 0 | 0 | NOT STARTED |
| River | 0 | 0 | NOT STARTED |
| Shallow Water | 0 | 0 | NOT STARTED |
| Deep Ocean | 0 | 0 | NOT STARTED |

**Wang transitions: 54/53 — ALL DONE. No more needed.**
**Total PNGs: 2,960**
**Generation budget remaining: ~1,530 of ~4,400**

---

## 2. Session 6 Priority Order

### Phase A: New Biome First-Passes (high value, broad coverage)
Each biome first-pass costs ~120 gens (4 tiles_pro × ~30 + 30 objects × ~1):
1. **Steppe** — base tile ID: `5dc10585-3e16-4b0f-982b-30fde69d11f9`
2. **Mountains** — base tile ID: `4157436e-8eb7-4cae-b747-f38f0f9def27`
3. **Volcanic** — base tile ID: `abfe8223-2ffa-45b2-89ca-63308625acc5`
4. **Mystic** — base tile ID: `b5d6431c-1397-43f8-8594-7d2b8fb09885`
5. **Taiga** — base tile ID: `098c093b-1d5f-4f91-9dfc-cacc9f4cffff`
6. **Arctic/Snow** — (needs new base tile generation)

### Phase B: Water Biomes (special — may need different approach)
Water biomes (ocean, lake, river, shallow water, deep ocean) are surface tiles, not ground-based. They may need animated tiles or different overlay strategies.

### Phase C: Variant Deepening
Push existing biome object counts toward 30+ per family:
- Tundra needs most work (18 objects, 6 families → need ~12 more)
- All biomes need push from ~3-7 per family to 30+ per family eventually

---

## 3. Per-Biome Generation Pattern (proven in session 5)

For each new biome:

### Step 1: Fire 4 tiles_pro batches simultaneously (L2-L5)
```
L2 Surface Detail — 16 tiles (ground texture variations)
L3 Vegetation — 16 tiles (biome-appropriate plants)
L4 Scatter — 16 tiles (small creatures, debris, tracks)
L5 Atmospheric — 16 tiles (weather, light, particles)
```
Params: `tile_type: "square_topdown"`, `tile_size: 32`, `tile_view: "high top-down"`

### Step 2: Fire 6 map objects simultaneously (batch 1)
Mix of: trees, rocks, shrubs, flowers, ground_cover, wildlife, interactive nodes
Params: `view: "high top-down"`, `outline: "lineless"`, `detail: "medium detail"`

### Step 3: Download tiles (16 per batch from backblaze URLs)
```bash
for i in $(seq 0 15); do
  curl -sL "$BUCKET/tile_${i}.png" -o "$DIR/{name}__overlay__v$(printf '%03d' $i).png"
done
```

### Step 4: Download objects and fire more batches
Repeat 6-at-a-time object batches until ~30 per biome.

### Step 5: Update PROGRESS.md
Track everything in the progress file.

---

## 4. File Naming & Paths

```
Surface overlays: assets/pixelab/landscape_v2/surface_overlays/{biome}_{layer}/decals/{name}__overlay__v{NNN}.png
Micro decals:     assets/pixelab/landscape_v2/micro/{biome}_scatter/decals/{name}__micro__v{NNN}.png
Object sprites:   assets/pixelab/landscape_v2/objects/{biome}_{family}/sprites/{name}__object__v{NNN}.png
Medium sprites:   assets/pixelab/landscape_v2/medium/{biome}_{family}/sprites/{name}__medium__v{NNN}.png
```

---

## 5. Rate Limits & Concurrency

- `create_tiles_pro`: Fire all 4 L2-L5 batches simultaneously. Each ~15-30s.
- `create_map_object`: Max 6 concurrent. Each ~30-90s.
- tiles_pro and map_objects are SEPARATE rate buckets — fire both simultaneously.
- Backblaze tile URLs use curl (NOT Python urllib — gets 403).

---

## 6. Known Base Tile IDs (for any future Wang chaining)

| Tile ID | Terrain |
|---------|---------|
| `a267b749-1927-4d39-b73d-06a39301013d` | wet brown swamp mud |
| `c9ce4900-726d-4b56-bb5c-9aa2fc3d191a` | lush green grass |
| `997894f5-3f3c-4d50-839e-2e32fa166a71` | dark forest floor |
| `e6bf01fc-1a4e-40c5-b242-e3bdef4e01e3` | flowing river water |
| `dc51d808-a3d4-4025-997e-75af468bcac9` | rocky hills |
| `5e7c32d0-e2e3-4308-adff-fa61e783e032` | shallow water (sandy) |
| `0a7ad061-3ecc-4716-9864-2ef4078e59df` | dry sandy beach |
| `71ed06d0-8c84-453c-a5a4-5c59e4522e54` | arid desert sand |
| `14b79358-c430-43a4-a043-c20fb0e5b904` | savanna grass |
| `b5d6431c-1397-43f8-8594-7d2b8fb09885` | mystic purple ground |
| `86422408-70e9-4721-862f-5643d5c3de8e` | dense forest floor |
| `9979a10a-e26f-4fd0-8fc3-3599ae8dcf47` | tropical forest floor |
| `098c093b-1d5f-4f91-9dfc-cacc9f4cffff` | taiga floor (pine/frost) |
| `4157436e-8eb7-4cae-b747-f38f0f9def27` | grey mountain rock (snow) |
| `abfe8223-2ffa-45b2-89ca-63308625acc5` | dark volcanic rock (lava) |
| `5dc10585-3e16-4b0f-982b-30fde69d11f9` | steppe ground (dry brown) |
| `acd82da8-9067-46fa-bdbe-4f50bae1eac6` | frozen tundra ground |

---

## 7. Generation Budget

- Sessions 1-4: ~2,000 generations
- Session 5: ~2,870 generations
- **Total used: ~4,870 of ~10,000**
- **Remaining: ~5,130** (plenty for 6+ more biome first-passes + deepening)

Each biome first-pass (64 tiles + 30 objects): ~150 gens
6 remaining land biomes × 150 = ~900 gens
This leaves ~4,230 for water biomes + variant deepening.

---

## 8. Key Lessons Learned (Sessions 1-5)

1. Wang tilesets MUST be 32x32 — never 16x16
2. tiles_pro and map_objects are separate rate buckets — fire both simultaneously
3. Max 6 concurrent map_objects — more causes 429 rate limit
4. Backblaze URLs work with curl but NOT Python urllib (403)
5. Each biome first-pass takes ~5-8 loop ticks at 3-minute intervals
6. A 3-minute loop is optimal — objects take 30-90s, tiles_pro 15-30s
7. Always persist state to PROGRESS.md — context will be cleared
8. Diversify object types within each biome (trees, rocks, flowers, wildlife, etc.)
9. ~30 objects per biome is a good first-pass target
10. Budget each biome at ~150 gens for first-pass coverage

---

## 9. Do Not

- Generate Wang tilesets — ALL 53 ARE DONE
- Generate Wang tiles with `create_tiles_pro` — Wang is done
- Overwrite existing files — always use next variant number
- Fire >6 concurrent map_objects (429 rate limit)
- Rely on conversation context for state — persist to PROGRESS.md
- Generate assets for biomes that are already at first-pass level unless deepening
- Use 16x16 for anything — always 32x32

---

## 10. Context Survival

If context is cleared:
1. Read `PROGRESS.md` — full state with biome inventories
2. Count PNGs on disk — verify
3. Resume biome expansion from next unstarted biome
4. All state is in files, nothing critical in conversation

---

## 11. Loop Setup

Set up a 3-minute loop (`/loop 3m`) with this prompt to drive unattended generation.
The loop should:
1. Check in-flight tiles_pro and map_objects
2. Download completed ones
3. Fire new batches for the current biome
4. When current biome hits 30 objects, move to the next
5. Print status every tick
6. Update PROGRESS.md every 3-4 ticks
