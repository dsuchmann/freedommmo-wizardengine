# Asset Pipeline Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the layered catalog directory structure, download tooling, and evaluate/download existing PixelLab assets into the new structure.

**Architecture:** Reorganize `assets/catalog/terrain/` from flat biome directories to `{biome}/L{n}_{name}/` sub-layer structure. Write a Python download tool that fetches tilesets from PixelLab and catalogs them with manifests. Evaluate all existing PixelLab variants and pick the best for each biome's L1 base.

**Tech Stack:** Python 3 (download tool), PixelLab MCP API, JSON manifests

**Specs:** 
- `docs/superpowers/specs/2026-05-26-asset-pipeline-spec.md`
- `docs/superpowers/specs/2026-05-26-biome-asset-manifest-spec.md`

---

### Task 1: Create New Catalog Directory Structure

**Files:**
- Create: `assets/catalog/terrain_v2/` (new root — preserve old structure until migration complete)
- Create: `assets/catalog/terrain_v2/_manifest.json`

- [ ] **Step 1: Create biome directories with layer sub-directories**

```bash
cd "C:\Users\daves\OneDrive\Documents\freedommmo"

# All 18 biomes with their layer directories
for biome in ocean beach grassland forest dense_forest desert savanna steppe tundra taiga mountains swamp tropical_forest volcanic arctic lake river mystic; do
  mkdir -p "assets/catalog/terrain_v2/$biome/L1_base"
  mkdir -p "assets/catalog/terrain_v2/$biome/L2_detail"
  mkdir -p "assets/catalog/terrain_v2/$biome/L3_vegetation"
  mkdir -p "assets/catalog/terrain_v2/$biome/L4_scatter"
  mkdir -p "assets/catalog/terrain_v2/$biome/L5_atmospheric"
  mkdir -p "assets/catalog/terrain_v2/$biome/transitions"
done
```

- [ ] **Step 2: Create master manifest**

Write `assets/catalog/terrain_v2/_manifest.json`:

```json
{
  "version": "2.0",
  "tile_size": 32,
  "layer_model": "cel_animation",
  "layers": {
    "L1_base": {"z_index": 0, "opacity": "opaque", "description": "Base ground surface"},
    "L2_detail": {"z_index": 1, "opacity": "transparent", "description": "Surface texture overlays"},
    "L3_vegetation": {"z_index": 2, "opacity": "transparent", "description": "Growing things"},
    "L4_scatter": {"z_index": 3, "opacity": "transparent", "description": "Small loose objects"},
    "L5_atmospheric": {"z_index": 4, "opacity": "transparent", "description": "Environmental particles"}
  },
  "biomes": {
    "ocean": {"active_layers": ["L1_base", "L5_atmospheric"], "quality_status": "pending"},
    "beach": {"active_layers": ["L1_base", "L2_detail", "L4_scatter"], "quality_status": "pending"},
    "grassland": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"},
    "forest": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"},
    "dense_forest": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"},
    "desert": {"active_layers": ["L1_base", "L2_detail", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"},
    "savanna": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"},
    "steppe": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"},
    "tundra": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"},
    "taiga": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"},
    "mountains": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"},
    "swamp": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"},
    "tropical_forest": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"},
    "volcanic": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"},
    "arctic": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"},
    "lake": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L5_atmospheric"], "quality_status": "pending"},
    "river": {"active_layers": ["L1_base", "L2_detail", "L5_atmospheric"], "quality_status": "pending"},
    "mystic": {"active_layers": ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"], "quality_status": "pending"}
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add assets/catalog/terrain_v2/
git commit -m "feat: layered terrain catalog structure — 18 biomes × 5 sub-layers

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Write Download Pipeline Tool

**Files:**
- Create: `tools/download_tileset.py`

- [ ] **Step 1: Write the download script**

This script takes a PixelLab tileset ID, biome name, and layer name. It downloads all 16 Wang tiles and writes a per-layer manifest.

```python
#!/usr/bin/env python3
"""Download a PixelLab tileset into the layered terrain catalog.

Usage:
  python tools/download_tileset.py <tileset_id> <biome> <layer> [--force]

Example:
  python tools/download_tileset.py 81944792-c6db-4ba9-a526-ceb901463c59 volcanic L1_base
"""

import sys
import os
import json
import urllib.request
import urllib.error

CATALOG_ROOT = os.path.join(os.path.dirname(__file__), "..", "assets", "catalog", "terrain_v2")

def download_tileset(tileset_id: str, biome: str, layer: str, force: bool = False):
    target_dir = os.path.join(CATALOG_ROOT, biome, layer)
    manifest_path = os.path.join(target_dir, "manifest.json")
    
    if os.path.exists(manifest_path) and not force:
        print(f"Already downloaded: {biome}/{layer}. Use --force to overwrite.")
        return
    
    os.makedirs(target_dir, exist_ok=True)
    
    # Download metadata
    meta_url = f"https://api.pixellab.ai/mcp/tilesets/{tileset_id}/metadata"
    print(f"Fetching metadata: {meta_url}")
    try:
        with urllib.request.urlopen(meta_url) as resp:
            metadata = json.loads(resp.read().decode())
    except urllib.error.URLError as e:
        print(f"ERROR: Failed to fetch metadata: {e}")
        return
    
    # Download the spritesheet PNG
    png_url = f"https://api.pixellab.ai/mcp/tilesets/{tileset_id}/image"
    png_path = os.path.join(target_dir, "tileset.png")
    print(f"Downloading spritesheet: {png_url}")
    try:
        urllib.request.urlretrieve(png_url, png_path)
    except urllib.error.URLError as e:
        print(f"ERROR: Failed to download image: {e}")
        return
    
    # Split spritesheet into individual wang tiles using PIL if available
    try:
        from PIL import Image
        sheet = Image.open(png_path)
        tile_w = metadata.get("tile_size", {}).get("width", 32)
        tile_h = metadata.get("tile_size", {}).get("height", 32)
        cols = sheet.width // tile_w
        
        for i in range(16):
            row = i // cols
            col = i % cols
            tile = sheet.crop((col * tile_w, row * tile_h, (col + 1) * tile_w, (row + 1) * tile_h))
            tile.save(os.path.join(target_dir, f"wang_{i}.png"))
        print(f"Split into 16 wang tiles ({tile_w}x{tile_h})")
    except ImportError:
        print("WARNING: PIL not available. Spritesheet saved but not split into wang tiles.")
        print("Install: pip install Pillow")
    
    # Write per-layer manifest
    manifest = {
        "biome": biome,
        "layer": layer,
        "pixellab_tileset_id": tileset_id,
        "tile_size": metadata.get("tile_size", {"width": 32, "height": 32}),
        "base_tile_ids": metadata.get("base_tile_ids", {}),
        "generation_prompt": {
            "lower_description": metadata.get("lower_description", ""),
            "upper_description": metadata.get("upper_description", "")
        },
        "quality_status": "downloaded",
        "states": {
            "pristine": {"frames": 1, "downloaded": True}
        }
    }
    
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    
    print(f"Done: {biome}/{layer} ({tileset_id})")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    
    tileset_id = sys.argv[1]
    biome = sys.argv[2]
    layer = sys.argv[3]
    force = "--force" in sys.argv
    
    download_tileset(tileset_id, biome, layer, force)
```

- [ ] **Step 2: Commit**

```bash
git add tools/download_tileset.py
git commit -m "feat: PixelLab download pipeline tool — fetches + catalogs tilesets

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Evaluate and Download Pre-Approved L1 Bases

**Files:**
- Modify: `assets/catalog/terrain_v2/volcanic/L1_base/`
- Modify: `assets/catalog/terrain_v2/mystic/L1_base/`

These two tilesets were already quality-approved during the audit:
- Volcanic: `81944792-c6db-4ba9-a526-ceb901463c59` — dark grey rock + glowing lava cracks
- Mystic: `54dc133e-6c8d-491b-a543-60853b5f353c` — purple glowing crystal cave floor

- [ ] **Step 1: Download volcanic L1**

```bash
cd "C:\Users\daves\OneDrive\Documents\freedommmo"
python tools/download_tileset.py 81944792-c6db-4ba9-a526-ceb901463c59 volcanic L1_base
```

- [ ] **Step 2: Download mystic L1**

```bash
python tools/download_tileset.py 54dc133e-6c8d-491b-a543-60853b5f353c mystic L1_base
```

- [ ] **Step 3: Visually verify both downloads**

Open the downloaded `wang_0.png` files and confirm:
- Volcanic: dark grey rock with orange/red lava cracks (NOT blue-grey waves)
- Mystic: purple crystalline ground with glow

- [ ] **Step 4: Commit**

```bash
git add assets/catalog/terrain_v2/volcanic/ assets/catalog/terrain_v2/mystic/
git commit -m "feat: download pre-approved volcanic + mystic L1 base tilesets

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Evaluate Ocean Variants and Download Best

There are 3 ocean variants on PixelLab:
- `b339478e` — "deep blue ocean water with gentle waves"
- `9501a5de` — "calm blue ocean water with gentle waves and light reflections"
- `df96a6c9` — "deep blue ocean water with gentle waves and foam detail"

- [ ] **Step 1: Fetch and compare all 3**

Use `mcp__pixellab__get_topdown_tileset` for each ID. Compare the preview images. Pick the one with the best:
- Wave detail and depth variation
- Natural color range (not flat single blue)
- Tileability (seamless Wang connections)

- [ ] **Step 2: Download the best one**

```bash
python tools/download_tileset.py <best_id> ocean L1_base
```

- [ ] **Step 3: Commit**

```bash
git add assets/catalog/terrain_v2/ocean/
git commit -m "feat: download best ocean L1 base tileset from PixelLab variants

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Evaluate and Download Grassland, Desert, Forest, Mountains, Swamp, Tundra

Same process as Task 4, for each biome with multiple PixelLab variants:

| Biome | Variant IDs |
|-------|------------|
| Grassland | `3d693567`, `8134007e`, `4f4c0026`, `ac280f19` |
| Desert | `55dab894`, `54bdee29`, `ad90a767`, `e6a681c8` |
| Forest | `3a644a3c`, `0454f218`, `70815aff`, `3f7e9b46` |
| Mountains | `e9dee808`, `6e33396d`, `734a512d` |
| Swamp | `3361f1e6`, `c66c5821`, `e41cf7e8` |
| Tundra | `7ad82261`, `5a6a0efb`, `22ac5d04` |

- [ ] **Step 1: For each biome, fetch all variants with `get_topdown_tileset`**

Compare preview images. Criteria:
1. Does it look like the biome? (forest floor ≠ wooden planks)
2. Detail and richness (not flat/uniform)
3. Natural color variation
4. Wang tile seamlessness

- [ ] **Step 2: Download the best variant for each biome**

```bash
python tools/download_tileset.py <best_grassland_id> grassland L1_base
python tools/download_tileset.py <best_desert_id> desert L1_base
python tools/download_tileset.py <best_forest_id> forest L1_base
python tools/download_tileset.py <best_mountains_id> mountains L1_base
python tools/download_tileset.py <best_swamp_id> swamp L1_base
python tools/download_tileset.py <best_tundra_id> tundra L1_base
```

- [ ] **Step 3: Commit all**

```bash
git add assets/catalog/terrain_v2/grassland/ assets/catalog/terrain_v2/desert/ assets/catalog/terrain_v2/forest/ assets/catalog/terrain_v2/mountains/ assets/catalog/terrain_v2/swamp/ assets/catalog/terrain_v2/tundra/
git commit -m "feat: download best L1 base tilesets for 6 core biomes

Evaluated all PixelLab variants, picked highest quality for each.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Update Master Manifest with Downloaded Assets

**Files:**
- Modify: `assets/catalog/terrain_v2/_manifest.json`

- [ ] **Step 1: Update quality_status for downloaded biomes**

For each biome downloaded in Tasks 3-5, update the master manifest's `quality_status` from `"pending"` to `"L1_downloaded"`. Add the PixelLab tileset ID used.

- [ ] **Step 2: Commit**

```bash
git add assets/catalog/terrain_v2/_manifest.json
git commit -m "feat: update master manifest with downloaded L1 base tilesets

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
