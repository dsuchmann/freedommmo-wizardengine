# Tree Upscale — ComfyUI Setup (Component A)

Local AI detail-add stage for the tree-upscale pipeline. The model **adds** bark/branch/leaf
detail at higher resolution; it does **not** make the sprite crisp. Crispness comes entirely from
the deterministic `magick` re-pixelation tail (component D), never the model.

- **Graph (API format):** `scripts/tree-upscale/comfy-graph.json`
- **Drives:** local ComfyUI HTTP API at `http://127.0.0.1:8188`
- **Driven by:** the harness (component E), which templates the placeholder tokens per asset.

---

## What the graph does (data flow)

```
LoadImage(__INPUT_IMAGE__)
  -> UpscaleModelLoader(RealESRGAN_x4plus_anime_6B) -> ImageUpscaleWithModel   [clean 4x structural upscale]
  -> ImageScale(~1024 longest side, lanczos)                       [SDXL native band]
  -> CheckpointLoaderSimple(sd_xl_base_1.0)
       -> LoraLoader(pixel-art-xl, 0.8/0.8)
            -> CLIPTextEncode(positive=__POSITIVE__) / CLIPTextEncode(negative)
  -> ControlNetLoader(controlnet-tile-sdxl-1.0) -> ControlNetApply(strength=__TILE_STRENGTH__)
       [tile ControlNet locks composition to the source: detail is ADDED, not invented]
  -> VAEEncode(upscaled img) -> KSampler(img2img, denoise=__DENOISE__, seed=__SEED__) -> VAEDecode
  -> SaveImage(tree_upscale/detail)
```

Node ids: `1` LoadImage, `2` UpscaleModelLoader, `3` ImageUpscaleWithModel, `4` ImageScale,
`5` CheckpointLoaderSimple, `6` LoraLoader, `7`/`8` CLIPTextEncode (pos/neg),
`9` ControlNetLoader, `10` ControlNetApply, `11` VAEEncode, `12` KSampler, `13` VAEDecode,
`14` SaveImage.

### Placeholder tokens (the harness string-replaces these per asset)

| Token | Where | Example | Notes |
|---|---|---|---|
| `__INPUT_IMAGE__` | `1.inputs.image` | `apple_v000.png` | filename already POSTed to ComfyUI `/upload/image` (lands in `ComfyUI/input/`) |
| `__POSITIVE__` | `7.inputs.text` | see below | per-asset positive prompt |
| `__DENOISE__` | `12.inputs.denoise` | `0.40` | **number, not a string** — harness must inject a JSON number |
| `__TILE_STRENGTH__` | `10.inputs.strength` | `0.6` | **number** — ControlNet-Tile strength |
| `__SEED__` | `12.inputs.seed` | `123456` | **integer** — deterministic per asset |

Canonical positive prompt:

> `top-down high fantasy giant ancient tree, detailed bark branches dense leaf clusters, pixel art, Final Fantasy aesthetic, limited palette, transparent background`

Negative (baked into the graph, node `8`):

> `blurry, smooth shading, anti-aliasing, gradient, photo, 3d render`

> **Token typing gotcha:** `__DENOISE__`, `__TILE_STRENGTH__`, `__SEED__` feed numeric inputs.
> If the harness does a naive string replace it will emit `"denoise": "0.40"` (a string) and
> ComfyUI's type validation rejects the prompt. Replace the **quoted token including its quotes**
> (`"__DENOISE__"` -> `0.40`) so the result is a bare JSON number. The string tokens
> (`__INPUT_IMAGE__`, `__POSITIVE__`) stay quoted.

---

## The alpha-as-mask decision (read this)

The source sprites are 192/256px RGBA with a **1-bit alpha** (the only "soft" pixels are the
0-value fully-transparent ones; everything visible is opaque). We deliberately **do NOT carry
the source alpha through the model**:

- SDXL + the tile ControlNet operate on **RGB**. Feeding/decoding alpha through the latent VAE is
  unreliable (the VAE has no alpha channel) and tends to bleed a halo into the transparent border.
- Instead the graph works purely on RGB, and the **re-pixelation tail (component D) re-applies the
  ORIGINAL source alpha** as a hard 1-bit mask. Because the tile ControlNet keeps the silhouette
  locked to the source, the original alpha still lines up with the detailed RGB after re-pixelation.

So the contract is:
1. Graph in → RGB source. Graph out → RGB detailed image (transparent bg requested in the prompt,
   but treated as don't-care; the tail discards it).
2. Tail: `point`-resize to 384, then **composite the original 192/256 source's alpha** (upscaled
   `point` to 384, threshold 50%) back on. This restores the exact 1-bit edge the game expects.

The proven tail (already validated, yields 384x384 / palette-locked / 1-bit alpha):

```sh
magick UP.png -filter point -resize 384x384 s1.png
magick s1.png \( +clone -alpha off \) -compose SrcIn -composite s2.png
magick s2.png -channel A -threshold 50% +channel s3.png
magick s3.png -dither None -remap palette.png final.png
```

(In production, `s1` should composite the alpha derived from the **original source** sprite, not
from the model output — the model output's alpha is don't-care. `tools/_repixel_demo/palette.png`
is the self-validation palette.)

---

## Model files — exact list + where they go

ComfyUI resolves models relative to its install root (referred to as `ComfyUI/` below). Filenames
must match the graph's `*_name` inputs **exactly**.

| Graph node | `*_name` value | Put the file in | Source |
|---|---|---|---|
| `2` UpscaleModelLoader | `RealESRGAN_x4plus_anime_6B.pth` | `ComfyUI/models/upscale_models/` | OpenModelDB "4x-realesrgan-x4plus-anime-6b" (BSD-3, commercial-OK) |
| `5` CheckpointLoaderSimple | `sd_xl_base_1.0.safetensors` | `ComfyUI/models/checkpoints/` | HF `stabilityai/stable-diffusion-xl-base-1.0` |
| `6` LoraLoader | `pixel-art-xl.safetensors` | `ComfyUI/models/loras/` | HF `nerijs/pixel-art-xl` |
| `9` ControlNetLoader | `controlnet-tile-sdxl-1.0.safetensors` | `ComfyUI/models/controlnet/` | HF `xinsir/controlnet-tile-sdxl-1.0` (rename the downloaded `diffusion_pytorch_model.safetensors`) |

Download (huggingface-cli or curl):

```sh
# from ComfyUI/ root
huggingface-cli download stabilityai/stable-diffusion-xl-base-1.0 sd_xl_base_1.0.safetensors \
  --local-dir models/checkpoints --local-dir-use-symlinks False
huggingface-cli download nerijs/pixel-art-xl pixel-art-xl.safetensors \
  --local-dir models/loras --local-dir-use-symlinks False
huggingface-cli download xinsir/controlnet-tile-sdxl-1.0 diffusion_pytorch_model.safetensors \
  --local-dir /tmp/cnt --local-dir-use-symlinks False
mv /tmp/cnt/diffusion_pytorch_model.safetensors models/controlnet/controlnet-tile-sdxl-1.0.safetensors
# RealESRGAN_x4plus_anime_6B.pth: BSD-3 / commercial-OK. Get from OpenModelDB
#   "4x-realesrgan-x4plus-anime-6b" (or the xinntao Real-ESRGAN release) → models/upscale_models/
#   (do NOT use 4x-AnimeSharp / 4x-UltraSharp — both are CC-BY-NC-SA, non-commercial)
```

> If your upscaler download has a different filename/extension, change `2.inputs.model_name` to match. ComfyUI
> loads either extension; the **filename in the graph must equal the filename on disk**.

---

## Install ComfyUI + ComfyUI-Manager

```sh
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI
python -m venv venv && . venv/bin/activate     # Windows: venv\Scripts\activate
pip install -r requirements.txt
# ComfyUI-Manager (for any missing custom nodes / model browsing):
git clone https://github.com/ltdrdata/ComfyUI-Manager.git custom_nodes/ComfyUI-Manager
```

All node types used by the graph (`LoadImage`, `UpscaleModelLoader`, `ImageUpscaleWithModel`,
`ImageScale`, `CheckpointLoaderSimple`, `LoraLoader`, `CLIPTextEncode`, `ControlNetLoader`,
`ControlNetApply`, `VAEEncode`, `KSampler`, `VAEDecode`, `SaveImage`) are **ComfyUI core** — no
custom nodes are required. ComfyUI-Manager is only for model management / future extensions.

---

## Start ComfyUI with its HTTP API

```sh
cd ComfyUI && . venv/bin/activate
python main.py --listen 127.0.0.1 --port 8188
# add --lowvram / --medvram on small GPUs; SDXL+ControlNet wants ~10GB VRAM otherwise
```

This exposes the REST + WebSocket API the harness uses:

- `POST /upload/image` — multipart upload of each source sprite into `ComfyUI/input/`.
- `POST /prompt` — body `{ "prompt": <templated graph>, "client_id": "<uuid>" }`. Returns
  `{ "prompt_id": "..." }`.
- `GET  /history/<prompt_id>` — poll until present; `outputs["14"].images[]` lists the SaveImage
  results (`{filename, subfolder, type}`).
- `GET  /view?filename=...&subfolder=...&type=output` — download the detailed RGB.
- `ws  /ws?clientId=<uuid>` — optional live progress (`executing` with `node==null` => done).

---

## How the harness (component E) drives it

Per asset, the harness:

1. **Upload** the source sprite → `POST /upload/image` (gets back the `name` to use as `__INPUT_IMAGE__`).
2. **Template** a deep clone of `comfy-graph.json`: replace the 5 tokens. Numeric tokens replace the
   **quoted** form so they become JSON numbers (see the typing gotcha above). Pick `__SEED__`
   deterministically from the asset path so re-runs are reproducible.
3. **Submit** `POST /prompt`, then poll `GET /history/<prompt_id>` until the node-14 outputs appear.
4. **Download** the detailed RGB via `/view`.
5. **Re-pixelation tail (component D)** — `point`-resize to 384, re-apply the **original source**
   alpha (1-bit), `-remap` to the locked palette. This produces the final 384x384 sprite.

Throughput notes: ComfyUI processes one `/prompt` at a time per server; the harness should submit
serially (or run multiple ComfyUI instances on different ports). Keep `__DENOISE__` ≈ 0.40 — higher
drifts the silhouette away from the source and the re-applied alpha stops matching.

---

## Validation (no GPU / model required)

The graph is validated structurally (this env has no GPU/ComfyUI):

```sh
node -e 'import fs from "node:fs"; const g=JSON.parse(fs.readFileSync("scripts/tree-upscale/comfy-graph.json","utf8")); const ids=new Set(Object.keys(g).filter(k=>/^[0-9]+$/.test(k))); for(const id of ids) for(const [k,v] of Object.entries(g[id].inputs||{})) if(Array.isArray(v)&&v.length===2&&typeof v[1]==="number"){ if(!ids.has(String(v[0]))) throw new Error(`dangling ${id}.${k} -> ${v[0]}`);} console.log("OK: parses, "+ids.size+" nodes, all refs resolve");' --input-type=module
```

Expected: `OK: parses, 14 nodes, all refs resolve`. Real-PNG validation of the tail lives with
components D/E against `assets/pixelab/landscape_v2/micro/large_flora/**` and
`tools/_repixel_demo/palette.png`.
