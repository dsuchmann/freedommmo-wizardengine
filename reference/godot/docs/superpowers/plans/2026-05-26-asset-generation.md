# Asset Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate all missing terrain tilesets via PixelLab — 9 missing L1 bases, L2-L5 overlays for all 18 biomes, and key transition tilesets. Quality-check everything before downloading.

**Architecture:** PixelLab's `create_topdown_tileset` is async (~100s per job). Kick off batches of 3-5 generations, poll for completion, quality-check previews, download approved tilesets via `tools/download_tileset.py`. Use `base_tile_id` chaining for transitions.

**Tech Stack:** PixelLab MCP API, Python download tool

**Spec:** `docs/superpowers/specs/2026-05-26-biome-asset-manifest-spec.md`

**Dependency:** Plan 1 (Asset Pipeline Infrastructure) must be complete — directory structure and download tool must exist.

**PixelLab generation parameters (defaults for all):**
- `tile_size: {"width": 32, "height": 32}`
- `view: "high top-down"`
- `detail: "highly detailed"`
- `shading: "detailed shading"`

---

### Task 1: Generate Missing L1 Bases — Batch 1 (Beach, Arctic, Taiga)

These biomes have NO existing PixelLab tileset. Generate fresh.

- [ ] **Step 1: Kick off 3 generations**

```
create_topdown_tileset:
  lower: "golden sandy beach with fine grain texture and scattered tiny shell fragments"
  upper: "golden sandy beach with slightly different sand grain pattern and wave-washed smooth areas"
  detail: "highly detailed", shading: "detailed shading"

create_topdown_tileset:
  lower: "white-blue glacial ice surface with deep pressure cracks and blue crystal shadows"
  upper: "white-blue glacial ice with different crack pattern and frozen bubble formations"
  detail: "highly detailed", shading: "detailed shading"

create_topdown_tileset:
  lower: "dark boreal forest floor covered in brown pine needles with snow patches"
  upper: "dark boreal forest floor with different pine needle pattern and small frozen puddle"
  detail: "highly detailed", shading: "detailed shading"
```

- [ ] **Step 2: Poll for completion (all 3)**

Use `get_topdown_tileset` for each ID. Wait until status = "completed".

- [ ] **Step 3: Quality check previews**

For each completed tileset:
- Does it look like the intended biome?
- Rich detail, not flat/uniform?
- Wang tiles connect seamlessly?
If any fail, regenerate with adjusted prompts.

- [ ] **Step 4: Download approved tilesets**

```bash
python tools/download_tileset.py <beach_id> beach L1_base
python tools/download_tileset.py <arctic_id> arctic L1_base
python tools/download_tileset.py <taiga_id> taiga L1_base
```

- [ ] **Step 5: Commit**

```bash
git add assets/catalog/terrain_v2/beach/ assets/catalog/terrain_v2/arctic/ assets/catalog/terrain_v2/taiga/
git commit -m "feat: generate + download beach, arctic, taiga L1 base tilesets

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Generate Missing L1 Bases — Batch 2 (Savanna, Steppe, Tropical, Dense Forest)

- [ ] **Step 1: Kick off 4 generations**

```
Savanna:
  lower: "dry golden savanna grass on reddish-brown African earth with natural variation"
  upper: "dry golden savanna grass with slightly different pattern and exposed red clay patches"

Steppe:
  lower: "short windswept grass on grey-brown rocky soil, sparse vegetation, exposed stone"
  upper: "short windswept grass with different wind pattern and more exposed grey bedrock"

Tropical Forest:
  lower: "rich dark tropical soil with large colorful fallen leaves and vine remnants"
  upper: "rich dark tropical soil with different leaf pattern and small puddle reflections"

Dense Forest:
  lower: "very dark forest floor with thick decomposing leaf carpet and rich humus soil"
  upper: "very dark forest floor with heavy green moss coverage and bracket fungus"
```

- [ ] **Step 2: Poll, quality check, download**

Same process as Task 1. Download each approved tileset:

```bash
python tools/download_tileset.py <savanna_id> savanna L1_base
python tools/download_tileset.py <steppe_id> steppe L1_base
python tools/download_tileset.py <tropical_id> tropical_forest L1_base
python tools/download_tileset.py <dense_forest_id> dense_forest L1_base
```

- [ ] **Step 3: Commit**

```bash
git add assets/catalog/terrain_v2/savanna/ assets/catalog/terrain_v2/steppe/ assets/catalog/terrain_v2/tropical_forest/ assets/catalog/terrain_v2/dense_forest/
git commit -m "feat: generate + download savanna, steppe, tropical, dense_forest L1 bases

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Generate Missing L1 Bases — Batch 3 (Lake, River)

- [ ] **Step 1: Kick off 2 generations**

```
Lake:
  lower: "clear calm lake water with subtle blue-green depth coloring and gentle ripples"
  upper: "clear calm lake water with slightly different ripple pattern and light reflection spots"

River:
  lower: "flowing river water with visible directional current lines and small white rapids"
  upper: "flowing river water with different current pattern and submerged rock shadows"
```

- [ ] **Step 2: Poll, quality check, download**

```bash
python tools/download_tileset.py <lake_id> lake L1_base
python tools/download_tileset.py <river_id> river L1_base
```

- [ ] **Step 3: Commit**

```bash
git add assets/catalog/terrain_v2/lake/ assets/catalog/terrain_v2/river/
git commit -m "feat: generate + download lake, river L1 base tilesets

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Generate L2-L5 Overlays — Grassland (Template Biome)

Grassland is the template — it uses all 5 layers. Generate L2-L5 overlays with transparent backgrounds.

**Important:** For overlay layers, the prompt must explicitly request transparent background. The lower and upper descriptions should describe the overlay content only, NOT the ground beneath.

- [ ] **Step 1: Generate L2 detail overlay**

```
create_topdown_tileset:
  lower: "small bare dirt patches and thin root lines on fully transparent background, pixel art, top-down"
  upper: "slightly different bare dirt patches and root pattern on fully transparent background, pixel art"
  detail: "highly detailed", shading: "detailed shading"
```

- [ ] **Step 2: Generate L3 vegetation overlay**

```
create_topdown_tileset:
  lower: "tall green grass blades with small wildflowers on fully transparent background, pixel art, top-down"
  upper: "different tall grass blade pattern with clovers on fully transparent background, pixel art"
  detail: "highly detailed", shading: "detailed shading"
```

- [ ] **Step 3: Generate L4 scatter overlay**

```
create_topdown_tileset:
  lower: "scattered small pebbles and fallen flower petals on fully transparent background, pixel art, top-down"
  upper: "different pebble arrangement with small twigs on fully transparent background, pixel art"
  detail: "highly detailed", shading: "detailed shading"
```

- [ ] **Step 4: Generate L5 atmospheric overlay**

```
create_topdown_tileset:
  lower: "floating pollen particles and dandelion seeds on fully transparent background, sparse, pixel art"
  upper: "different pollen particle pattern on fully transparent background, very sparse, pixel art"
  detail: "medium detail", shading: "basic shading"
```

- [ ] **Step 5: Poll all 4, quality check, download**

Check each for:
- Transparent background (NOT colored ground showing through)
- Appropriate density (L5 should be very sparse)
- Visual coherence with grassland L1

```bash
python tools/download_tileset.py <L2_id> grassland L2_detail
python tools/download_tileset.py <L3_id> grassland L3_vegetation
python tools/download_tileset.py <L4_id> grassland L4_scatter
python tools/download_tileset.py <L5_id> grassland L5_atmospheric
```

- [ ] **Step 6: Commit**

```bash
git add assets/catalog/terrain_v2/grassland/
git commit -m "feat: grassland complete — L1-L5 all layers generated and downloaded

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Generate L2-L5 Overlays — Forest

- [ ] **Step 1: Generate all 4 overlay layers**

```
L2 (detail):
  lower: "exposed tree root networks and green moss patches on fully transparent background, pixel art"
  upper: "different root pattern with small mushroom clusters on transparent background, pixel art"

L3 (vegetation):
  lower: "small green ferns and forest undergrowth plants on fully transparent background, pixel art"
  upper: "different fern arrangement with tiny saplings on transparent background, pixel art"

L4 (scatter):
  lower: "scattered fallen acorns, small twigs, and pinecones on fully transparent background, pixel art"
  upper: "different arrangement of fallen leaves and bark pieces on transparent background, pixel art"

L5 (atmospheric):
  lower: "dappled golden light spots and floating dust particles on transparent background, pixel art"
  upper: "different light spot pattern with fewer particles on transparent background, pixel art"
```

- [ ] **Step 2: Poll, quality check, download all 4**

```bash
python tools/download_tileset.py <id> forest L2_detail
python tools/download_tileset.py <id> forest L3_vegetation
python tools/download_tileset.py <id> forest L4_scatter
python tools/download_tileset.py <id> forest L5_atmospheric
```

- [ ] **Step 3: Commit**

```bash
git add assets/catalog/terrain_v2/forest/
git commit -m "feat: forest complete — L2-L5 overlay layers generated

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Generate L2-L5 Overlays — Desert, Mountains, Volcanic

Same pattern. Generate 4 overlays per biome using prompts from the biome asset manifest spec.

- [ ] **Step 1: Kick off all 12 generations (4 per biome × 3 biomes)**

Use the exact prompts from `docs/superpowers/specs/2026-05-26-biome-asset-manifest-spec.md` for each biome's L2-L5.

- [ ] **Step 2: Poll, quality check, download**

- [ ] **Step 3: Commit per biome**

---

### Task 7: Generate L2-L5 Overlays — Remaining Biomes

Generate overlays for: ocean, beach, swamp, tundra, taiga, savanna, steppe, tropical_forest, dense_forest, arctic, lake, river, mystic.

This is 13 biomes. Not all use all layers (ocean only uses L5, river only uses L2+L5). Refer to the biome asset manifest spec for which layers each biome needs.

- [ ] **Step 1: Kick off generations in batches of 5**

Use prompts from the biome asset manifest spec.

- [ ] **Step 2: Poll, quality check, download each batch**

- [ ] **Step 3: Commit per batch**

---

### Task 8: Generate Key Transition Tilesets

Transitions are L1-only Wang tilesets showing the blend between two biomes. Use `base_tile_id` chaining from the downloaded L1 manifests.

Priority transitions (from biome adjacency graph):
1. Ocean ↔ Beach
2. Beach ↔ Grassland
3. Grassland ↔ Forest
4. Grassland ↔ Desert
5. Grassland ↔ Steppe
6. Forest ↔ Dense Forest
7. Desert ↔ Savanna
8. Savanna ↔ Tropical Forest
9. Steppe ↔ Mountains
10. Mountains ↔ Arctic
11. Tundra ↔ Taiga

- [ ] **Step 1: Read base_tile_ids from each biome's L1 manifest**

For each transition, the lower biome's `upper` base_tile_id becomes the `lower_base_tile_id`, and the upper biome's `lower` base_tile_id becomes the `upper_base_tile_id`.

- [ ] **Step 2: Generate transitions in batches of 4**

```
create_topdown_tileset:
  lower_description: "deep blue ocean water"
  upper_description: "golden sandy beach"
  lower_base_tile_id: <ocean_upper_id>
  upper_base_tile_id: <beach_lower_id>
  transition_description: "foamy wave washing onto wet sand"
  transition_size: 0.5
```

- [ ] **Step 3: Poll, quality check, download into `{biome}/transitions/` directories**

```bash
python tools/download_tileset.py <id> ocean transitions/ocean_to_beach
```

- [ ] **Step 4: Commit all transitions**

```bash
git add assets/catalog/terrain_v2/*/transitions/
git commit -m "feat: generate key biome transition tilesets (11 pairs)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Final Manifest Update and Quality Audit

- [ ] **Step 1: Update master manifest**

Set `quality_status` for each biome based on what was generated:
- `"complete"` — all layers generated and quality-approved
- `"L1_only"` — base layer done, overlays pending
- `"pending"` — not yet generated

- [ ] **Step 2: Print summary**

Count total tiles generated, total biomes complete, any gaps.

- [ ] **Step 3: Commit**

```bash
git add assets/catalog/terrain_v2/_manifest.json
git commit -m "docs: final manifest update — asset generation audit complete

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
