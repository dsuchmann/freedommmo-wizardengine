# Upscale Studio — generalized @384 pipeline + per-object QA dashboard

Extends the F6 tree upscaler to **every decoration object field**, with a per-object **upscale / blend / direct** decision dashboard previewed at true in-game draw scale. Design: `docs/superpowers/specs/2026-06-30-asset-upscale-studio-design.md`. Config: `scripts/tree-upscale/fields.json` (fields: `small_flora`, `medium_flora`, `medium_objects`, `large_flora` (=F6, already done), `large_objects`).

`<repo>` below = `C:\Users\daves\AppData\Roaming\wizardgenie\projects\default`.

## The loop (per field, grassland pilot)

**1. Sample-upscale a field** — fills the dashboard's upscale/blend columns. Needs ComfyUI running (README "the one manual step"). `--sample 3` = first 3 variants/object, cheap. F6 is already done.
```
python scripts/tree-upscale/comfy-batch.py --field medium_flora --biome grassland --sample 3
#   also: small_flora, medium_objects, large_objects
```

**2. Build the preview manifest** the dashboard reads:
```
FIELD_ASSET_ROOT=<repo> node scripts/tree-upscale/gen-upscale-preview-manifest.mjs grassland
#   -> tools/upscale-preview.grassland.json
```

**3. QA in the dashboard** — serve the repo, open the studio:
```
npx http-server -p 8131 -c-1 .      # then open:
http://localhost:8131/tools/upscale-studio.html
```
Per object: compare **ORIGINAL / UPSCALE / BLEND** at game draw-scale (toggle game/2×/native, play anims), set **Upscale | Blend | Direct** (+ a live blend %), optional per-variant override. **Export** → `upscale-decisions.<field>.json`.

**4. Apply your decisions:**
```
FIELD_ASSET_ROOT=<repo> node scripts/tree-upscale/apply-upscale-decisions.mjs --decisions <upscale-decisions.medium_flora.json>
```
- **upscale** → prints the exact `comfy-batch.py --field … --type …` bulk command for any object still missing `@384` (run it to produce the full variant/anim/state set).
- **blend** → runs `apply-mix` at your pct (in-place, backed up to `tools/_premix/`, revertible via `apply-mix.mjs --revert`).
- **direct** → quarantines the `@384` to `tools/_premix/_direct_quarantine/` (never deleted) so the game uses the PixelLab original.
Then it regenerates `assets/.../micro/<field>/_upscaled.json`. The game's `upscaleUrl` seam (`src/world/upscale-manifest.js`) swaps `@384` in per chosen object across **all** fields.

## Reference
- `comfy-batch.py` flags: `--field <name>` (default `large_flora` = unchanged F6 behavior), `--sample N`, `--decisions <json>`, `--biome`, `--type`, `--dry-run`, `--status`.
- Verify the wiring offline anytime (no GPU): `node scripts/tree-upscale/verify-upscale-wiring.mjs` (15 assertions; proves the F6 manifest stays byte-identical).
- Per-field **draw sizes** (dashboard "game" view) in `fields.json` `draw_px` are **provisional** (seeded from PixelLab gen sizes) — tune if a field reads off-scale.

## Out of scope (deferred)
- **Building tiles** — different corpus (`buildings/tiles/`), opaque, need a tiling-seam QA (preview 3×3) and a separate building-render game seam. Revisit after this loop is proven.
- **Other biomes** — identical machinery; just run the loop per biome.
- **Scatter/ground-cover fields** — tiling textures, not this object pipeline.
