# Upscale Studio — generalized @384 pipeline + per-object QA dashboard

Extends the F6 tree upscaler to **every decoration object field**, with a per-object **upscale / blend / direct** decision dashboard previewed at true in-game draw scale. Design: `docs/superpowers/specs/2026-06-30-asset-upscale-studio-design.md`. Config: `scripts/tree-upscale/fields.json` (fields: `small_flora`, `medium_flora`, `medium_objects`, `large_flora` (=F6, already done), `large_objects`).

`<repo>` below = `C:\Users\daves\AppData\Roaming\wizardgenie\projects\default`.

## The loop — just run the server and click (no CLI)

The dashboard now has a built-in backend that runs every step for you. One command, then point-and-click:

```
node scripts/tree-upscale/upscale-server.mjs        # serves the repo + the API; default port 8131
#   open:  http://localhost:8131/tools/upscale-studio.html
```

This replaces `npx http-server` and the four manual commands below. In the dashboard's control bar, per field tab:

1. **▶ Sample-upscale this field** — set **sample N** (first N variants/object, cheap), click. Runs `comfy-batch.py --field <field> --biome grassland --sample N` server-side and streams its live output into the **log / status** panel. Needs ComfyUI running locally (the one manual prerequisite). Only one sample job runs at a time. On success it **auto-refreshes the preview** so the UPSCALE/BLEND panels populate with no extra step.
2. QA each object: compare **ORIGINAL / UPSCALE / BLEND** at game draw-scale (toggle game/2×/native, play anims), set **Upscale | Blend | Direct** (+ a live blend %), optional per-variant override.
3. **↻ Refresh preview** — rebuilds `tools/upscale-preview.grassland.json` from disk and reloads the dashboard (use after an out-of-band generation).
4. **✓ Apply decisions** — applies this field's in-memory decisions on disk (runs `apply-upscale-decisions.mjs`), then refreshes. **upscale** keeps the raw `@384` (and prints the bulk `comfy-batch.py` command for any object still missing one); **blend** runs `apply-mix` at your pct (backed up to `_premix/`, revertible); **direct** quarantines the `@384` (never deleted) so the game uses the PixelLab original. The game's `upscaleUrl` seam (`src/world/upscale-manifest.js`) then swaps `@384` in per chosen object across **all** fields.

The **⬇ Export decisions** button still works too (downloads `upscale-decisions.<field>.json` for offline/manual apply). If you open the page under a plain static server (no API), the control bar greys out and the dashboard degrades to export-only.

## Appendix — the raw CLI (what the buttons run)

You never need these if you use the server, but for reference / scripting:

**1. Sample-upscale a field** (`--sample 3` = first 3 variants/object). F6 (`large_flora`) is already done.
```
python scripts/tree-upscale/comfy-batch.py --field medium_flora --biome grassland --sample 3
#   also: small_flora, medium_objects, large_objects
```

**2. Build the preview manifest** the dashboard reads:
```
FIELD_ASSET_ROOT=<repo> node scripts/tree-upscale/gen-upscale-preview-manifest.mjs grassland
#   -> tools/upscale-preview.grassland.json
```

**3. Serve + QA in the dashboard:**
```
npx http-server -p 8131 -c-1 .      # then open:
http://localhost:8131/tools/upscale-studio.html
```
**Export** → `upscale-decisions.<field>.json`.

**4. Apply your decisions** (note: apply reads `FIELD_ASSET_ROOT` as the *micro base dir*, not the repo root — omit it in the main checkout so it defaults to `<repo>/assets/.../micro`):
```
node scripts/tree-upscale/apply-upscale-decisions.mjs --decisions <upscale-decisions.medium_flora.json>
```
Then it regenerates `assets/.../micro/<field>/_upscaled.json`.

## Reference
- `comfy-batch.py` flags: `--field <name>` (default `large_flora` = unchanged F6 behavior), `--sample N`, `--decisions <json>`, `--biome`, `--type`, `--dry-run`, `--status`.
- Verify the wiring offline anytime (no GPU): `node scripts/tree-upscale/verify-upscale-wiring.mjs` (15 assertions; proves the F6 manifest stays byte-identical).
- Per-field **draw sizes** (dashboard "game" view) in `fields.json` `draw_px` are **provisional** (seeded from PixelLab gen sizes) — tune if a field reads off-scale.

## Out of scope (deferred)
- **Building tiles** — different corpus (`buildings/tiles/`), opaque, need a tiling-seam QA (preview 3×3) and a separate building-render game seam. Revisit after this loop is proven.
- **Other biomes** — identical machinery; just run the loop per biome.
- **Scatter/ground-cover fields** — tiling textures, not this object pipeline.
