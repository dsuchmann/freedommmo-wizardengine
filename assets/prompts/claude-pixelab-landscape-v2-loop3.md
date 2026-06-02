# Claude Kickoff Prompt — PixelLab Landscape V2 Session 4: Swamp Sprint Finish

You are Claude working inside the FreedomMMO / WizardGenie project. This is a CONTINUATION of sessions 1-3. The swamp biome is at **60% complete** with **1,263 PNGs** on disk. Your job is to finish swamp and start prepping the next biome.

---

## 0. FIRST: Read These Files Before Doing Anything

```txt
assets/pixelab/landscape_v2/PROGRESS.md          ← Current state, counts, what's done
assets/pixelab/landscape_v2/prompts/pending_jobs.json  ← Any pending jobs from last session
```

Read `PROGRESS.md` first. It has the full inventory and remaining counts.

---

## 1. Immediate Actions

### 1a. Verify Disk Counts

Count PNGs per family on disk. The PROGRESS.md numbers may drift slightly from reality. Trust disk counts.

```bash
BASE="assets/pixelab/landscape_v2"
for f in reeds cattails root_cluster moss_clump; do
  echo "$f: $(ls "$BASE/medium/$f/sprites/" | wc -l)"
done
for f in forage_bush_swamp swamp_tree reed_harvest_node; do
  echo "$f: $(ls "$BASE/objects/$f/sprites/" | wc -l)"
done
echo "TOTAL: $(find "$BASE" -name "*.png" | wc -l)"
```

### 1b. Check Pending Jobs

Read `pending_jobs.json`. Download anything completed. Mark downloaded. Don't re-poll stuck jobs from sessions 1-2 (they're dead).

---

## 2. What's Left for Swamp (~809 assets remaining)

### DONE (don't regenerate):
- Base tiles: 66/66 ✓
- Surface overlays: 376/336 ✓ (over target)
- Transitions: 86/~80 ✓ (5 Wang sets: shallow_water, grass, forest, void, river)

### NEARLY DONE (~40 remaining):
- Micro: dark_mud_flecks 172/176, moss_ground_cover 158/176, reeds_grass_blades 158/176
- Use `create_tiles_pro` — 3 batches of 16 will finish these

### THE BIG GAP (~769 remaining):

| Family | Have | Target | Need | Tool |
|--------|------|--------|------|------|
| reeds | ~48 | 168 | ~120 | `create_map_object` |
| cattails | ~42 | 168 | ~126 | `create_map_object` |
| root_cluster | ~41 | 168 | ~127 | `create_map_object` |
| moss_clump | ~39 | 168 | ~129 | `create_map_object` |
| forage_bush_swamp | ~24 | 96 | ~72 | `create_map_object` |
| swamp_tree | ~35 | 96 | ~61 | `create_map_object` |
| reed_harvest_node | ~18 | 96 | ~78 | `create_map_object` |

---

## 3. The Loop

This is the core loop. Repeat until swamp is done or budget runs low.

### Each Cycle (~90 seconds):

1. **Fire 6 `create_map_object` calls** — one per family, rotating through:
   - reeds (32/48/64px, lineless)
   - cattails (32/48/64px, lineless)
   - root_cluster (32/48/64px, lineless)
   - moss_clump (32/48/64px, lineless)
   - swamp_tree OR forage_bush_swamp (96/64px, lineless or selective outline)
   - reed_harvest_node OR forage_bush_swamp (32px, selective outline)

2. **Wait ~75 seconds** (map objects take 30-90s)

3. **Check all 6** with `get_map_object`

4. **Download completed ones** immediately:
   ```bash
   FAMILY_COUNT=$(ls "$BASE/medium/{family}/sprites/" | wc -l)
   V=$(printf "%03d" $FAMILY_COUNT)
   curl -sL "{download_url}" -o "$BASE/{layer}/{family}/sprites/{family}__{type}__v${V}.png"
   ```

5. **Fire next 6** and repeat

### Prompt Variety

Vary descriptions each cycle to get visual diversity. Mix:
- Size variations (32/48/64/96px)
- Density variations (sparse, medium, dense, thick)
- Growth stage (young, mature, old, dead/fallen)
- Composition (single, pair, trio, cluster, group, thicket)
- Detail variations (with moss, with algae, with ferns, with puddles)

Examples by family:
- **reeds**: "sparse thin reed shoots", "dense reed thicket with seed plumes", "wide reed fan spreading outward", "tall curved reed stalks"
- **cattails**: "lone cattail with brown seed head", "cattail trio with varying heights", "dense cattail stand with many heads", "cattail pair in shallow water"
- **root_cluster**: "small root tangle", "wide exposed root platform", "thick knotted root mass with moss", "massive root system with ferns between"
- **moss_clump**: "small green moss ball", "flat moss carpet", "thick moss hummock with tiny mushrooms", "moss-covered fallen branch"
- **swamp_tree**: "gnarled cypress with hanging moss", "dead trunk with fungus", "young sapling", "massive ancient oak with split canopy"
- **forage_bush_swamp**: "berry bush with red/purple/blue berries", "mushroom cluster on wet log", "herb plant with small flowers", "cranberry bush"
- **reed_harvest_node**: "thick bundled stalks ready to cut", "dense harvestable reed patch"

### Rate Limits

- **Max 6 concurrent map_objects** — more causes 429 errors
- Wait for ALL 6 to complete before firing next batch
- Don't poll incomplete jobs repeatedly — wait the full 75s

---

## 4. Micro Decal Finishing (Do Once, Early)

Fire 3 `create_tiles_pro` batches at the start to close the micro gaps:

1. dark_mud_flecks x16 (seed 500001200) — finishes to 176+
2. moss_ground_cover x16 (seed 500101600) — gets to 174
3. reeds_grass_blades x16 (seed 500201100) — gets to 174

Use `square_topdown`, 32px, `top-down` view, `segmentation` outline_mode.

Download when complete, then mark micro as DONE.

---

## 5. File Naming & Paths

```
Medium:  assets/pixelab/landscape_v2/medium/{family}/sprites/{family}__medium__v{NNN}.png
Objects: assets/pixelab/landscape_v2/objects/{family}/sprites/{family}__object__v{NNN}.png
Micro:   assets/pixelab/landscape_v2/micro/{family}/decals/{family}__micro__v{NNN}.png
```

Always count existing files with `ls ... | wc -l` to get the next variant number. Never hardcode variant numbers.

---

## 6. Map Object Parameters

### Medium dressing (reeds, cattails, root_cluster, moss_clump):
```
view: "high top-down"
outline: "lineless"
width/height: 32, 48, or 64 (vary each cycle)
```

### Interactive objects (forage_bush_swamp):
```
view: "high top-down"
outline: "selective outline"
width/height: 64
```

### Interactive objects (reed_harvest_node):
```
view: "high top-down"
outline: "selective outline"
width/height: 32
```

### Trees (swamp_tree):
```
view: "high top-down"
outline: "lineless"
width/height: 96
```

---

## 7. Progress Tracking

After every ~10 cycles (~60 sprites), print a status line:
```
reeds: XX | cattails: XX | root: XX | moss: XX
tree: XX | bush: XX | reed_h: XX
TOTAL: XXXX | +NNN | NN%
```

Update PROGRESS.md every ~20 cycles or before context clear.

---

## 8. When to Stop Swamp

Swamp is "done enough" when all families reach **50+ variants** for medium and **30+ variants** for objects. The manifest targets (168/96) are aspirational maximums — having 50+ medium and 30+ objects per family gives enough visual variety for the renderer to avoid obvious repetition.

Once you hit those minimums, shift remaining budget to the next biome.

---

## 9. Next Biome: Forest (after swamp)

When swamp minimums are met, start forest assets. The recipe maps these families:
- Base: `forest/dense_forest`, `forest/tropical_forest`, `forest/taiga`
- Surface: `leaf_litter`, `pine_needles`, `fallen_bark`
- Micro: `small_mushrooms`, `ground_ferns`, `forest_flowers`
- Medium: `ferns`, `bushes`, `fallen_logs`, `undergrowth`
- Objects: `oak_tree`, `pine_tree`, `birch_tree`, `berry_bush`, `mushroom_node`
- Transitions: forest↔grass, forest↔swamp (already done!), forest↔rock

Use the same generation patterns but with forest descriptions.

---

## 10. Do Not

- Overwrite existing files — always use next variant number
- Generate Wang tiles with `create_tiles_pro` — use `create_topdown_tileset`
- Fire >6 concurrent map_objects (429 rate limit)
- Rely on conversation context for state — persist to files
- Re-poll dead jobs from sessions 1-2
- Generate assets for layers that are already over target (surface overlays, transitions)

---

## 11. Context Survival

If context is cleared:
1. Read `PROGRESS.md` — full state
2. Count PNGs on disk — verify
3. Resume the 6-at-a-time map_object loop
4. All state is in files, nothing critical in conversation
