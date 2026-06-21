# Building Asset Manifest — Full PixelLab Generation Matrix

**Date:** 2026-06-20
**Status:** design (approved 2026-06-20; generation pending — run together)
**Builds on:** `2026-06-14-wall-tile-system-design.md` (Phase 1 anatomy), `2026-06-13-floor-asset-manifest.md` (manifest format), `bulk_generate_f6.py` (generation harness)
**Atlas placement:** S3 Matter / S5 Society edge — buildings are spatial structures (CLAUDE.md locked decision #6: "Buildings are spatial structures, never sprites"). This manifest produces the *material skins* the structural blueprint quantizes into.

## Goal

Enumerate, in advance, the **entire matrix** of PixelLab assets needed to skin buildings across every biome — then generate it incrementally with a resumable tracker. This is the Phase-2 follow-on to the stone-brick Phase-1 vertical slice: from one material to the full world.

The manifest is **data** (what to generate); the generation **script** is the executor (how). The two are decoupled so the matrix can be reviewed and the generation mechanics tuned independently.

## Locked decisions (user, 2026-06-20)

| Axis | Decision |
|---|---|
| **Material anchoring** | **Per-biome-unique.** Each of the 21 biomes gets its own **4 wall + 4 roof** materials, authored true to that biome's climate/geology/vernacular. No shared pool. (84 wall + 84 roof = 168 materials.) |
| **Biomes** | **All 21** `SPEC_BIOME_IDS`, including the 5 water biomes (stilt/dock/pier/boathouse/lighthouse structures). |
| **Directions** | **Asymmetric-3**: `south` = full-detail face, `north` = reduced back/interior face, `E/W` = thin shared edge cap. Matches what the 3/4 top-down renderer actually consumes; literal 8-dir is unused. |
| **Doors** | **Closed + open + animation.** Each door shape: a closed sprite, an open sprite, and a baked open/close transition clip (`animate-with-text-v3`, ~9 frames). Reverse the clip to close. |
| **Windows** | 6 shapes per material, **static** (no shutter animation in v1). |
| **Interior "sandwich"** | **Per-exterior interior.** Every exterior wall material gets its own matched interior face (interior_base + archway + 2 interior doors), so stone-out/wood-in reads honestly. |
| **Wear states** | **Authored now.** `normal / weathered / damaged / mossy` on the wall *surfaces* (base, corners, north, edge, interior_base) — **not** on doors/windows (would ~double the job). |
| **Doors/windows count** | **6 doors + 6 windows per wall material** (south face only — you never see them on north/side faces in 3/4 view). |

## Biomes (canonical 21)

`SPEC_BIOME_IDS` from `src/world/biome-definitions.js`:

```
water:    deep_ocean, ocean, shallow_water, river, lake
coast:    beach
temperate:grassland, hills, steppe
forest:   forest, dense_forest, tropical_forest
cold:     taiga, tundra, arctic
arid/wet: savanna, desert, swamp
extreme:  mountains, volcanic, mystic
```

## Material vocabulary

The 168 material identities live in **`assets/pixelab/buildings/manifest/building-materials.json`** — the single source of truth, read by both the generation script (Python) and the game registry (JS). Each material:

```json
{
  "slug": "fieldstone",          // snake_case, unique within biome, no biome prefix
  "name": "Fieldstone",
  "prompt": "tileable front-elevation pixel-art exterior wall segment, rough fieldstone...",
  "palette": "cool grey granite, mossy mortar",   // runtime tint hint
  "rationale": "..."
}
```

Wall prompts describe a **tileable front-elevation** wall segment (molding cap → textured middle → foundation course) so it tiles horizontally *and* stacks vertically across floors. Roof prompts describe a **seamless top-down roof texture** that reads as a roof and is visually distinct from the biome's ground terrain. Materials within a biome are mutually distinct vernaculars (e.g. grassland walls = wattle-and-daub / fieldstone / timber-frame / cob), and a biome's 4 walls × 4 roofs mix-and-match believably.

## Wall asset classes (per material)

Targets align to the **shipped renderer** (`src/render/building-renderer.js`, the 9 loaded piece keys). All dims are 32px multiples (Wang grid). Generation is **square** (`create-1-direction-object`, `view: "sidescroller"` = front elevation) at the nearest size ≥ longest side, then cropped to target — the same square-then-crop the Phase-1 pipeline used.

| Piece key | Target | Direction role | Seeded from | Wear? |
|---|---|---|---|---|
| `south_base` | 32×128 | south (full) | base generation | ✅ ×4 |
| `south_corner_west` | 32×128 | south edge | edit of `south_base` | ✅ ×4 |
| `south_corner_east` | 32×128 | south edge | edit of `south_base` | ✅ ×4 |
| `north_back` | 32×64 | north (reduced) | edit of `south_base` | ✅ ×4 |
| `edge_ew` | 32×32 | E/W cap (mirror at runtime) | edit of `south_base` | ✅ ×4 |
| `south_window` ×6 shapes | 64×128 | south | edit of `south_base` | ❌ |
| `south_door` ×6 shapes | 64×128 | south | edit of `south_base` | ❌ (+open+anim) |
| `interior_base` | 32×128 | north interior | edit of `south_base` (interior face) | ✅ ×4 |
| `interior_archway` | 64×128 | interior | edit of `interior_base` | ❌ |
| `interior_door` ×2 shapes | 64×128 | interior | edit of `interior_base` | ❌ (+open+anim) |

**Note vs. older spec:** the shipped renderer reads *both* `south_window` and `south_door` as **64×128 (2-tile-wide)** — this manifest follows the renderer, not the 32×128 window from `2026-06-14-wall-tile-system-design.md`.

### Per-wall-material task count

| Group | Pieces × states | Calls |
|---|---|---|
| Exterior structural (wear) | (south_base + 2 corners + north_back + edge_ew) × 4 wear | 20 |
| Windows | 6 shapes × static | 6 |
| Doors | 6 shapes × (closed + open + open/close anim) | 18 |
| Interior (matched) | interior_base×4 wear + archway + 2 doors×(closed+open+anim) | 11 |
| **Per material** | | **55** |

## Roof asset classes (per material)

The procedural roof **shape/role** system (`roof-ingame.js`, `roof-materials.js`: eave/slope/ridge/hip/valley/peak/deck classification, and the cliff-face drop where the roof overhangs the top floor) **stays** — it works. This manifest only supplies the **surface texture** that gets painted onto that geometry via the soil-style per-pixel bilinear interpolation (`worker-chunk-renderer.js:307-319`), swapping the soil source for roof textures. Roofs must read as roof and be distinct from the biome ground.

| Piece key | Target | View | Seeded from |
|---|---|---|---|
| `roof_top` | 64×64 (tileable) | top-down | base generation |
| `roof_top` variant ×3 | 64×64 | top-down | edit/reseed of `roof_top` |
| `roof_fascia` | 64×64 | sidescroller (vertical drop face) | edit of `roof_top` |

**Per roof material: 5 calls.** (1 base texture + 3 interpolation variants + 1 fascia/drop.)

## The full matrix

```
WALLS:  55 calls/material × 4 materials/biome × 21 biomes = 4,620 calls
ROOFS:   5 calls/material × 4 materials/biome × 21 biomes =   420 calls
                                              GRAND TOTAL ≈ 5,040 API calls
```

(~10,000+ image *files* once each `animate-with-text-v3` clip expands to ~9 frames. API **calls** drive wall-clock; one animate call = one clip.)

**Throughput** (user's measured rate): ~10-20 generations per round, ~90 s/round ⇒ ~400-600 effective calls/hr with retries. **5,040 calls ≈ 8-9 h pure API time, ~12-16 h realistic = "a day or two."** Comfortably under the danger threshold (~50,000).

**Cost lever:** doors+windows are 24 calls/material = 2,016 calls (40% of the job). Dropping to 4+4 saves ~670 calls if ever needed.

## Naming & storage

```
assets/pixelab/buildings/
  manifest/
    building-materials.json        # 168 material identities (source of truth)
    _buildings_state.json          # resumable generation tracker
    _buildings_run.log
  walls/{biome}/{material}/
    south_base__normal.png  south_base__weathered.png  south_base__damaged.png  south_base__mossy.png
    south_corner_west__{wear}.png   south_corner_east__{wear}.png
    north_back__{wear}.png   edge_ew__{wear}.png   interior_base__{wear}.png
    interior_archway.png
    south_window__{shape}.png        # shape ∈ {arched, round, shuttered, lattice, bay, slit}
    south_door__{shape}.png          # closed sprite
    south_door__{shape}__open.png    # open sprite
    anim/door_open/{shape}/frame_000.png … frame_008.png
    interior_door__{shape}.png  interior_door__{shape}__open.png
    anim/interior_door_open/{shape}/frame_000.png …
  roof/{biome}/{material}/
    roof_top__v000.png … roof_top__v003.png   # base + 3 interp variants
    roof_fascia.png
```

This is a **superset of the renderer's existing 9-key contract** — the loader extends to resolve `{biome}/{material}/{piece}` and falls back to `stone_brick_tiles/` when a biome's assets don't yet exist (honest absence).

## Generation pipeline

`scripts/bulk_generate_buildings.py` — mirrors the proven `bulk_generate_f6.py` harness:

- **Auth:** `PIXELLAB_API_KEY` env or `.mcp.json` Bearer token; REST at `https://api.pixellab.ai/v2`.
- **Endpoints:** `create-1-direction-object` (base pieces) → `edit-images-v2` (window/door/wear/interior variants, seeded from the base PNG) → `animate-with-text-v3` (door open/close) → poll `objects/{id}` & `background-jobs/{id}`.
- **Resumable:** all progress in `_buildings_state.json` (status machine `pending → queued → done | failed | skipped`) + disk existence check — valid PNGs never redone. Survives interruption / credit top-up.
- **Concurrency:** ≤10 in flight (shares the 20-job account cap with other workers). Credits guard pauses below $3, rechecks every 10 min.
- **Validation:** PNG magic bytes + non-trivial alpha coverage (rejects blanks/full-bleed).
- **CLI:** `--status`, `--dry-run` (enumerate matrix, **no API calls**), `--biome <id>`, `--material <slug>`, `--phase base|states|doors|anims|roof`.

### Pilot gate (CLAUDE.md "composable assets need pilots")

Before the ~5,000-call burst: generate **ONE biome's full material set** (4 walls + 4 roofs, all pieces/wear/doors/anims), assemble a real building in-game, and verify it reads correctly (tileability, door walk-through proportion, roof distinctness, wear legibility). Only then unlock mass generation. Recommended pilot biome: **grassland** (classic vernacular, easiest to judge).

### Piece-spec tuning (deferred to pilot — generate together)

The exact square-gen-size + crop geometry per piece-class is the one mechanical unknown (PixelLab generates square; targets are non-square). The script carries a single clearly-marked `PIECE_SPEC` config (endpoint, view, gen_size, target_w/h, crop, seed_from, edit-prompt template) that we finalize empirically during the pilot. Candidates: square-then-crop via `create-1-direction-object`, vs. native non-square via `create_map_object` (width/height 32-400). The manifest itself is method-agnostic.

## Integration (post-generation — planned, not in this pass)

1. **Loader:** extend `building-renderer.js` `ensureFloorImages()` (and the GL interior loader) to resolve `walls/{biome}/{material}/{piece}` keyed by the building's biome + chosen material; fall back to `stone_brick_tiles/` until present.
2. **Biome→material pick:** `sim/world/buildings/building-materials.js` deterministically assigns each building one of its biome's 4 wall + 4 roof materials (seeded by building id) — the world-compiler "culture fingerprint" can later bias this.
3. **Wear:** building condition (age/damage from the chronicle) selects the wear state; honest-absence falls back to `normal` + a GL darken/desaturate transform.
4. **Doors:** open/close anim plays on player proximity / entry (ties into the diegetic walk-in).
5. **Roof:** swap the soil texture sampled by the roof interpolation for `roof/{biome}/{material}/roof_top` + variants; add the `roof_fascia` to the cliff-face drop. **Must route through GL** (CLAUDE.md non-negotiable) — this retires the main-thread procedural roof texture as tech debt.

## Honest absences

- A biome with no generated assets renders with `stone_brick` fallback (not blank).
- A missing wear state falls back to `normal` + renderer transform.
- A missing door anim falls back to a closed↔open snap.
- E/W faces stay minimal (edge cap, runtime-mirrored) — deliberate, not unfinished.
- Floors are out of scope (already exist, race-anchored Wang tilesets).
- Roof *geometry* is unchanged (procedural); only the *texture* is new.
