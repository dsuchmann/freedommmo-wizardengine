# Claude Kickoff Prompt — PixelLab Landscape V2 Session 11: Object Deepening

You are Claude working inside the FreedomMMO / WizardGenie project. This is a CONTINUATION of sessions 1-10.

## 0. FIRST: Read This File Before Doing Anything

```
assets/pixelab/landscape_v2/PROGRESS.md
```

## 1. Current State (as of session 10 end)

- **4,547 PNGs on disk**
- **22 biomes fully covered**: base wang(16) + tiles(16) + overlays(48-80) + objects(5-48)
- **53/53 Wang transitions on disk** — ALL DONE
- **Generations remaining: ~2,150 of 10,000**

### CRITICAL LESSON: tiles_pro vs map_object
- `create_tiles_pro` → **OPAQUE** ground tiles (overlays, base). Grey/colored backgrounds. NO transparency.
- `create_map_object` → **TRANSPARENT** sprites (objects, medium decorations). Has alpha channel.
- **NEVER use tiles_pro for medium sprites or decorations that overlay the ground** — they will have opaque backgrounds.

### Object Counts (lowest → highest)
```
deep_ocean: 5    | shallow_water: 6  | river: 5     | lake: 6
ocean: 6         | arctic: 8         | dense_forest: 8 | tropical: 8
volcanic: 10     | mystic: 11        | mountains: 12   | taiga: 12
tundra: 18       | steppe: 19        | beach: 30       | desert: 30
hills: 30        | savanna: 30       | grassland: 41   | forest: 48
```

### In-Flight Objects (stuck at 95% — likely dead, re-fire instead)
These have been stuck at 95% across multiple sessions. Do NOT wait for them:
- `f7ef9b37` (deep_ocean squid), `5dafcba1` (shallow stingray), `03772149` (river otter), `55f8e160` (lake heron)
- `dc71b79f` (ocean jellyfish), `f4a5248e` (arctic totem)
- Plus 6 from session 9 also stuck at 95%

---

## 2. Session 11 Priority: Object Deepening

Push weakest biomes toward 12+ objects. Fire 6 at a time, download when complete, fire next batch.

### Target Biomes (in order)
1. **deep_ocean** (5→12): +7 needed — anglerfish variants, giant clam, sunken ruins, coral cluster, deep vent, abyss portal
2. **river** (5→12): +7 — wooden bridge, otter, salmon, waterwheel, river rocks, cattails, fishing spot
3. **shallow_water** (6→12): +6 — starfish, sand dollar, sea cucumber, lobster, seagrass bed, anchor
4. **lake** (6→12): +6 — canoe, frog, fish school, water lily large, fallen branch, dock
5. **ocean** (6→12): +6 — lighthouse buoy, seagull, floating crate, kelp bed, ship wheel, message bottle
6. **arctic** (8→12): +4 — penguin, frozen chest, ice wall, snow fox den
7. **dense_forest** (8→12): +4 — owl, mushroom log, moss rock, vine bridge
8. **tropical** (8→12): +4 — macaw, bamboo, monkey, waterfall

### Object Generation Pattern
```
create_map_object(
  description="...",
  width=32-72,    # match object size
  height=32-72,
  view="high top-down",
  outline="lineless",
  detail="medium detail"
)
```
Download: `curl -sL {download_url} -o objects/{biome}_{family}/sprites/{name}__object__v{NNN}.png`

---

## 3. Secondary: Overlay Parity (tiles_pro)

Some session 5 biomes still at 48 overlays. Can push to 64 with one L5 atmospheric batch each:
- **beach, hills, savanna, tundra** — each needs 16 more atmospheric overlays

Use `create_tiles_pro` for these (opaque tiles are correct for overlays).

---

## 4. Rate Limits & Budget

- `create_map_object`: Max 6 concurrent, ~1 gen each, but SLOW (sometimes stuck at 95%)
- `create_tiles_pro`: Separate bucket, ~30 gens each, reliable completion
- **Budget: ~2,150 gens**
- 50 objects = ~50 gens, 4 tiles_pro = ~120 gens

### Strategy for 95% Stuck Objects
- If an object is at 95% for >5 minutes, abandon it and fire a fresh one
- Don't let stuck objects block progress — fire new batches

---

## 5. File Naming & Paths

```
Objects:    assets/pixelab/landscape_v2/objects/{biome}_{family}/sprites/{name}__object__v{NNN}.png
Overlays:   assets/pixelab/landscape_v2/surface_overlays/{biome}_{layer}/decals/{name}__overlay__v{NNN}.png
```

---

## 6. Do Not

- Generate Wang tilesets — ALL 53 DONE
- Generate base wang or plain tiles — ALL 22 BIOMES DONE
- Use tiles_pro for medium sprites — they produce OPAQUE tiles
- Wait indefinitely for 95%-stuck objects — fire new ones
- Overwrite existing files — always use next variant number
- Fire >6 concurrent map_objects (429 rate limit)
