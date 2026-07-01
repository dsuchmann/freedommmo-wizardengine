# tree-upscale — AI-detailed native-pixel-art tree upscaler

Upscales every **static** tree sprite in the large-flora corpus (base variants
`v0NN.png` + lifecycle states under `_states/`) from 192/256px to a **384px
NATIVE pixel-art** sprite that has AI-synthesized bark/leaf detail but stays
**crisp · 1-bit-alpha · palette-locked**.

Two halves, by design:

- **Detail-add (GPU, AI)** — a local ComfyUI graph (SDXL + Pixel Art XL LoRA +
  ControlNet-Tile, img2img `denoise≈0.40`) invents new bark/foliage detail while
  ControlNet-Tile locks the composition to the source. It is *deliberately*
  blurry/soft/off-palette — making it crisp is **not** the model's job.
- **Crispness (CPU, deterministic)** — a 4-step ImageMagick re-pixelation tail
  recovers a hard native pixel grid, kills the alpha halo, and remaps every
  pixel back onto a shared biome-true palette. Byte-for-byte reproducible; this
  is where the "pixel art" actually comes from.

```
                              ┌──────────── the ONE manual step ────────────┐
                              │  start a local ComfyUI on :8188 with         │
                              │  SDXL base + pixel-art-xl LoRA +             │
                              │  controlnet-tile-sdxl + RealESRGAN-anime-6B  │
                              └──────────────────┬──────────────────────────┘
                                                 │
  source 192/256px ──► [E] comfy-batch.py ──► ComfyUI (SDXL img2img) ──► soft RGB ~1024px
   (disk-first,            per sprite:            detail-add               (blurry, off-palette,
    base + _states)        upload→template→POST   ControlNet-Tile           soft alpha — by design)
                           →poll→fetch                                            │
                                                                                  ▼
                                          [B] repixelate.mjs (magick tail, deterministic)
                                            1. -filter point -resize 384   nearest → native px grid
                                            2. SrcIn de-halo               kill soft-edge dark fringe
                                            3. -channel A -threshold 50%   collapse alpha → 1-bit
                                            4. -remap palettes/<biome>.png snap to locked palette
                                                                                  │
                                                                                  ▼
                                          [D] qa-upscale.mjs (pure-JS gate, @napi-rs/canvas)
                                            alpha 1-bit? · in-palette? · still blocky? · silhouette kept?
                                                                                  │
                                                  ┌──── PASS ────┐        ┌─ FAIL ─┐
                                                  ▼                       ▼
                                   write v0NN@384.png next to     re-roll seed (≤3),
                                   source; record in _state.json   else log + skip
```

Palettes consumed by step 4/QA are manufactured up front by **[C] extract-palette.mjs**
from the real tree art (one shared palette per biome + a `_global`).

## Components

| file | role |
|------|------|
| `comfy-graph.json` | **[E-graph]** ComfyUI API-format img2img graph. 5 `__TOKENS__` (`__INPUT_IMAGE__`, `__POSITIVE__`, `__DENOISE__`, `__TILE_STRENGTH__`, `__SEED__`) the harness substitutes. RGB-only: source alpha is NOT carried through the model — the tail re-applies it. |
| `comfy-batch.py` | **[E]** resumable batch harness. Disk-first corpus walk, per-type+biome+state prompts, ComfyUI POST/poll/fetch, then shells the tail + QA, seed-re-rolls on QA fail, writes `v0NN@384.png`. The ONLY piece that needs a live GPU. |
| `repixelate.mjs` | **[B]** the deterministic crispness tail. Pure pass-through to the 4 proven `magick` steps; never touches pixels itself. |
| `extract-palette.mjs` | **[C]** builds `palettes/<biome>.png` (+`_global.png`) by unioning every static tree's colors and median-cutting to N. Emits **8-bit** palettes (see gotcha). |
| `qa-upscale.mjs` | **[D]** pure-JS QA gate (`@napi-rs/canvas`, no GPU/shell). Rejects soft/off-palette/shape-drifted upscales. Exit 0 = PASS. |
| `validate-repixelate.mjs` | standalone self-check of the tail's 3 contract guarantees on a real asset. |
| `*.test.mjs` | `node --test` coverage for `extract-palette` + `qa-upscale`. |
| `palettes/` | generated per-biome remap palettes (16 biomes + `_global`). |

## How to run each piece

```bash
# [C] generate the palettes (once, or whenever the tree corpus changes)
node scripts/tree-upscale/extract-palette.mjs --biome all --colors 48
#   → scripts/tree-upscale/palettes/<biome>.png  (+ _global.png), each 8-bit, 48 colors + 1 transparent slot

# [B] re-pixelate one AI-upscaled sprite (deterministic; no GPU)
node scripts/tree-upscale/repixelate.mjs \
  --in up.png --out final_384.png --res 384 \
  --palette scripts/tree-upscale/palettes/dense_forest.png

# [D] QA one final against its source
node scripts/tree-upscale/qa-upscale.mjs \
  --final final_384.png \
  --source assets/pixelab/landscape_v2/micro/large_flora/dense_forest/ancient_oak/v000.png \
  --palette scripts/tree-upscale/palettes/dense_forest.png
#   exit 0 = PASS; prints JSON {pass, checks, reasons}

# [E] the batch (needs ComfyUI running — see "The one manual step")
python scripts/tree-upscale/comfy-batch.py --dry-run            # enumerate + template ONE, NO HTTP
python scripts/tree-upscale/comfy-batch.py --status             # progress against disk
python scripts/tree-upscale/comfy-batch.py                      # full corpus
python scripts/tree-upscale/comfy-batch.py --biome forest --type oak   # filtered

# tests + self-validation (no GPU)
node --test scripts/tree-upscale/extract-palette.test.mjs scripts/tree-upscale/qa-upscale.test.mjs
node scripts/tree-upscale/validate-repixelate.mjs
```

## The one manual step

Everything above runs offline **except** the detail-add. Before `comfy-batch.py`
(without `--dry-run`) you must, by hand, start a **local ComfyUI** at
`http://127.0.0.1:8188` (override with `COMFY_HOST`) with these models installed:

- `sd_xl_base_1.0.safetensors` (checkpoint)
- `pixel-art-xl.safetensors` (LoRA)
- `controlnet-tile-sdxl-1.0.safetensors` (ControlNet)
- `RealESRGAN_x4plus_anime_6B.pth` (ESRGAN upscale model — BSD-3, commercial-OK)

That GPU step is the only thing this repo's environment can't do; the harness,
the tail, the palettes, the QA gate, and the dry-run are all fully offline.

## Output layout

Outputs land **next to** their source with an `@384` suffix, so the 384 corpus
is `find ... -name 'v*@384.png'`-discoverable and never collides with the source:

```
<biome>/<type>/v0NN.png                 → <biome>/<type>/v0NN@384.png
<biome>/<type>/_states/<state>/v0NN.png → <biome>/<type>/_states/<state>/v0NN@384.png
```

The intermediate soft AI upscale is staged in a temp dir and discarded — only the
crisp final is kept. `_comfy_batch_state.json` is a resumable cache/log; the
authority for "is this done" is the `@384` file existing on disk.

## Gotcha: palettes MUST be 8-bit

This is a **Q16** ImageMagick build, so a palette PNG written without `-depth 8`
is 16-bit/channel. The tail's `magick -remap` then **rounds** 16→8
(`4597/257 → 18`) while the QA gate's `@napi-rs/canvas` decoder **floors** the
same sample (`4597>>8 → 17`). That one-LSB disagreement makes the QA palette set
miss the exact darks the tail snapped to, so a byte-correct sprite spuriously
fails QA on its darkest pixels. `extract-palette.mjs` therefore emits palettes at
`-depth 8` so the remap and the QA reader see identical bytes. Don't remove it.
```

