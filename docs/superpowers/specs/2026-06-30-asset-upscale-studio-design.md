# Asset Upscale Studio — generalize the @384 pipeline + per-asset QA/blend dashboard (2026-06-30)

**Goal:** Extend the F6-only AI-detail upscale pipeline to every decoration *object* field, and add a localhost QA dashboard where you decide, per object, whether to **upscale** (AI @384), **blend** (mix AI + original), or use the PixelLab art **direct** — previewing all three at true in-game draw scale before committing GPU time.

**Architecture (one line):** dashboard + per-object decision store → sample-upscale (2–3/object) → QA/decide per object → apply (bulk only the winners, blend at the chosen pct) → per-field upscale manifests → the game's `upscaleUrl` seam draws your pick at draw scale.

**Pilot scope:** the **grassland** biome, its **5 object fields** (≈16 objects). Scatter/ground-cover fields are out of scope. Other biomes are pure data re-runs of the same machinery, later.

---

## 1. Current state (what exists vs what's F6-only)

The pipeline (`scripts/tree-upscale/`) already has every *mechanism*, but all of it is hardcoded to F6 large-flora:

- **GPU detail-add** (`comfy-batch.py` + `comfy-graph.json`): disk-first walk of `large_flora/`, per-tree+biome+state prompts, ComfyUI (SDXL + Pixel-Art-XL LoRA + ControlNet-Tile, img2img `denoise≈0.40`) → soft RGB.
- **Deterministic tail** (`repixelate.mjs`): nearest-resize → de-halo → 1-bit alpha → palette snap. **Asset-agnostic already.**
- **QA gate** (`qa-upscale.mjs`): alpha/palette/blockiness/silhouette checks. Asset-agnostic.
- **Blend** (`apply-mix.mjs`): one **global** `--pct` (default 40 = original's share) → `60% AI-upscale + 40% nearest-resized original`, palette re-snap, alpha re-apply. In-place overwrite of `@384`, backed up to `tools/_premix/`, ledger `tools/_premix/_applied.json`, revertible.
- **Manifest + game seam** (`gen-upscale-manifest.mjs` → `large_flora/_upscaled.json`; renderer `upscaleUrl`): the renderer swaps `@384` in per-sprite **only for `micro/large_flora/` paths listed in the manifest**. So @384 IS wired into the game — for F6 only.
- **Pilot dashboard** (`blend-preview.mjs` → `tools/blend-preview.html`): animated 4-up (original / upscale / blend·detail / blend·mix) with a 1×/2×/3× scale control — but hardcoded to `dense_forest/ancient_oak`, and it compares *recipes*, not per-asset *decisions*.

**Confirmed:** `@384` exists nowhere but `large_flora` (0 under small_flora/medium_flora/medium_objects/large_objects). Every non-F6 field still draws raw 192/256px PixelLab art.

## 2. Grassland inventory (the pilot's 16 objects)

| Field | Objects | ~base/obj | Sub-kinds | @384 today |
|---|---|---|---|---|
| F2 `small_flora` | dandelion_stem, tall_grass_blade, wild_herb | 64 | anim | no |
| F4 `medium_flora` | cornflower, daisy_cluster, wild_lavender | 60 | anim + states | no |
| F5 `medium_objects` | fence_post, field_boulder, hay_bale | 64 | states only | no |
| F6 `large_flora` | apple, cherry, oak, willow | 64–73 | anim + states | **yes** |
| `large_objects` | apple_tree, cherry_blossom, meadow_oak | 64–256 | — | no |

Root: `assets/pixelab/landscape_v2/micro/<field>/grassland/<object>/`. Filename conventions differ per field (`sf__` / `mf__` / `mo__` / `lg__` / `v###`).

## 3. Decision model

- **Granularity: per object** (per field/biome/object). The dashboard previews 2–3 representative variants; the decision applies to the whole object. A **per-variant override** handles the rare oddball.
- **Three modes:**
  - **upscale** — the AI `@384` (raw, after the deterministic tail). F6's current behavior.
  - **blend** — mixed `@384` at the object's own `blendPct` (generalized `apply-mix`, no longer one global knob).
  - **direct** — the raw PixelLab original, **no `@384`** ("the PixelLab art already reads best; leave it alone"). Skips the GPU entirely.
- **Store:** `assets/pixelab/landscape_v2/micro/<field>/_upscale_decisions.json`, schema:
  ```json
  { "field": "medium_flora",
    "decisions": {
      "grassland/cornflower": { "mode": "blend", "blendPct": 40 },
      "grassland/fence_post":  { "mode": "direct" },
      "grassland/daisy_cluster": { "mode": "upscale",
        "overrides": { "v007": { "mode": "direct" } } }
    } }
  ```
  Mirrors the curation sidecar pattern (`_*_curation.json`). `blendPct` = the original's share (matches `apply-mix --pct`).

## 4. Components

### 4.1 Generalized pipeline (`comfy-batch.py`)
Parameterize the four tree-specific spots behind a **field-config table** (one row per field):
- `root` (corpus dir), `file_re` (variant filename pattern), `draw_px` (in-game draw size, for the dashboard), `sub_kinds` (base / states / anim present).
- **Prompt vocabulary** per field: a base template + per-object overrides. F6's *"detailed bark and foliage texture"* is wrong for F5 hard surfaces, so:
  - F2/F4 flora → leaf/petal/stem texture language.
  - F5 objects → material language ("weathered wood grain / mossy stone / dry straw, crisp pixel shading").
  - `large_objects` → **reuse the per-object-class bodies from the `decoration-field-pipeline` skill** (tree/rock/arch/etc.).
  - Per-field **denoise** override (the graph already exposes `__DENOISE__`): lower for hard surfaces so the model adds texture without hallucinating geometry.
- **Palette:** no new per-field palette files — use the existing **per-source 64-color quantize** (already in `apply-mix`/`source_palette`) so any asset's colors are honored.
- **Ready-gate removed for static fields:** F6's `complete_f6_types` gate existed because F6 was generating live; the other four corpora are complete on disk, so the walk is just "process what's there." The **sample pass** = "first 2–3 variants per object."
- New flags: `--field <name>` (select the config row), `--sample N` (cap variants/object for the dashboard pass), `--decisions <json>` (bulk pass: only process objects whose mode is upscale/blend).

### 4.2 Dashboard (`tools/upscale-studio.html`, field-studio mold)
Interactive (not a generated static page). Reads an **upscale-preview manifest** (per-field: objects, sampled variant URLs for original + `@384`, draw size, anim frame lists) emitted by a `gen-upscale-preview-manifest.mjs`.

Layout:
```
Field: [F2][F4][F5][F6][large_objects]   ✔ 7/16 decided   [Export decisions]
 grassland / medium_flora / cornflower   variant ◀ v003 ▶ (3 sampled)  ▶anim speed▮▮▯  view:(•game)(2×)(native)
   ┌ ORIGINAL ┐  ┌ UPSCALE ┐  ┌ BLEND ┐    Decision: ( )Upscale (•)Blend ( )Direct
   │ [sprite] │  │[sprite] │  │[sprite]│   Blend: original ▮▮▮▮▯▯▯▯ upscale  40%
   │192 native│  │ 384 AI  │  │384 mix │   ☐ override just this variant
   └──────────┘  └─────────┘  └────────┘
```
- The three version panels render at the object's **true in-game draw size** (from the field catalog / `decoration-claims`), with a view toggle (game / 2× / native-384) and anim play+speed where the object animates.
- **Blend slider = fast in-browser approximation** (canvas composite of upscale + nearest-original at the pct); the *exact* palette-snapped blend is produced only at apply time. (Alternative considered: pre-bake fixed blend levels — rejected for slider feel.)
- F6 panels populate immediately (already upscaled); the other four show "sample pending" until the sample pass runs.
- **Export** → `upscale-decisions.json` (the §3 schema), exactly like field-studio exports curation picks.

### 4.3 Apply (`apply-upscale-decisions.mjs`)
Reads `upscale-decisions.json`; per object:
- **upscale** → ensure AI `@384` exists for all variants (bulk `comfy-batch --field --type`); keep raw.
- **blend** → ensure `@384`, then generalized `apply-mix --pct <blendPct>` scoped to that object (per-object pct from the store; backup + ledger as today).
- **direct** → drop any sample `@384`, exclude from the manifest.
- Then regenerate the **per-field** manifest.

### 4.4 Manifests + game seam
- Generalize `gen-upscale-manifest.mjs` to emit a manifest per field: `micro/<field>/_upscaled.json` (sorted key list of variants with a usable `@384`; direct objects absent).
- Generalize `upscaleUrl`: for any sprite URL under `micro/<field>/`, consult that field's manifest; swap `@384` if the key is listed. Same zero-cost Set lookup; load each field's manifest once. Upscale/blend objects draw `@384`; direct objects draw the original.

## 5. Data flow
`sample-upscale (per field)` → `gen-upscale-preview-manifest` → **dashboard QA/decide** → `upscale-decisions.json` → `apply-upscale-decisions` (bulk winners + per-object blend) → `gen-upscale-manifest` (per field) → game `upscaleUrl` draws the chosen version at draw scale.

## 6. Cost & phasing
- **Sample pass is cheap:** ~16 objects × 2–3 variants ≈ a few hundred sprites (~1–2h GPU); fills the dashboard. F6 rows already exist.
- **Bulk cost scales with decisions, not corpus:** only upscale/blend objects get their full variant+anim+state sets; direct objects (likely the F5 hard-surfaces) are skipped.
- **Shares the GPU finishing F6** — the non-F6 sample pass runs after/alongside the F6 tail; field configs are additive and don't disturb the F6 run.
- **Phasing:** grassland proves the loop end-to-end (16 objects); other 15 biomes are the same config with different objects (bigger GPU bill, same per-object gating).

## 7. Testing
- **Pipeline:** `--dry-run --field <f>` enumerates + templates one sprite per field with the right prompt (no HTTP). Reuse `validate-repixelate.mjs` / `qa-upscale` for the tail on a non-tree sample.
- **Decision store:** unit-test the schema round-trip (export → apply reads modes/overrides correctly; per-variant override beats per-object).
- **Manifest + seam:** unit-test that `upscaleUrl` swaps `@384` for a listed key under each field and leaves direct/unlisted keys untouched.
- **Dashboard:** Playwright smoke — loads the preview manifest, renders 3 panels per object at draw scale, anim toggles, blend slider updates the composite, export produces valid JSON.
- **Apply round-trip:** apply a 3-object fixture (one per mode) → assert @384 present/blended/absent + manifest membership; `--revert` restores.

## 8. Decisions locked
- Granularity **per object**, sample-previewed, with per-variant override.
- "In-game" = **sprite at true draw scale** (not engine GL render).
- Scope = **5 grassland object fields**; scatter/ground-cover excluded.
- Three modes: **upscale / blend / direct**; `direct` skips the GPU and the manifest.
- Blend preview = **live in-browser approximation**; exact palette-snapped blend at apply time.
- Reuse: curation-sidecar pattern (store), field-studio shell (dashboard), per-source palette, existing tail/QA/apply-mix machinery, `decoration-field-pipeline` prompt bodies for `large_objects`.

## 9. Honest-absence / no-mock
- No faked "upscaled" art: `direct` means the real PixelLab original renders, unchanged — an honest absence of upscaling, not a degraded stand-in.
- The dashboard previews real sampled outputs, never mockups; "sample pending" is shown until the real sample exists.
- Everything still renders through the GL pipeline; the seam only changes *which PNG* a sprite loads, not the render path.

## 10. Open / deferred
- **Building tiles:** considered as a sibling track (different corpus under `assets/pixelab/buildings/tiles/`, opaque tiles, a NEW tiling-seam QA need — preview tiles laid 3×3 to catch seam breaks — and a separate building-render game seam, not `upscaleUrl`). **Explicitly deferred (user 2026-06-30)**; revisit after the landscape-field loop is proven. Shares the dashboard shell + decision model when it returns.
- **Per-field draw size source:** confirm the exact catalog/`decoration-claims` field the renderer uses for each field's world draw size (dashboard input). Implementation detail, not a blocker.
- **Other biomes:** out of scope for the pilot; same machinery, later.
- **Scatter/ground-cover fields:** excluded; if ever wanted, they need a tiling-texture approach, not this object pipeline.
- **GPU contention with the live F6 run:** sequence the sample pass after/alongside F6; not a code change.
