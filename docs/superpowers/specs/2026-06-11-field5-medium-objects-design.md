# Field 5: Medium Objects — Design

**Date:** 2026-06-11
**Status:** Approved sketch (user 2026-06-11). Generation not yet started (legacy assets to be archived).
**Atlas position:** S2 World Substrate — decoration field F5 of the F0–F7 stack.

## Identity

1.5–2 tile inanimate landmarks: boulders, stumps, logs, relics. The first field rendered as a
**y-sorted sprite overlay** (not baked into the chunk bitmap). Claims cells in lower fields
(F2 small flora, F3 small scatter, F4 medium flora) via the shared claim system in
`src/world/decoration-claims.js` so nothing grows through a boulder.

## Biome × category pivot (16 land biomes × 3 categories = 48 objects)

Categories: **Geological** (rock-like), **Organic remnant** (stumps/logs/mounds/bones),
**Relic / curiosity** (man-made or magical traces).

| Biome | Geological | Organic remnant | Relic / curiosity |
|---|---|---|---|
| grassland | field_boulder | hay_bale | fence_post |
| forest | mossy_boulder | tree_stump | fallen_log |
| dense_forest | root_mound | hollow_stump | rotting_log |
| tropical_forest | jungle_rock | buttress_root | vine_log |
| taiga | snow_rock | frost_stump | ice_log |
| savanna | termite_mound | bone_pile | dry_well |
| steppe | wind_rock | stone_cairn | buried_post |
| desert | sandstone_formation | bleached_skull | clay_pot_shard |
| beach | tide_pool_rock | beached_log | anchor_relic |
| swamp | mud_mound | bog_log | rotting_dock |
| hills | granite_outcrop | stone_pile | old_milestone |
| mountains | ice_boulder | frozen_cairn | cliff_fragment |
| tundra | permafrost_mound | frozen_bones | ice_boulder |
| arctic | ice_formation | snow_drift_mound | frozen_ruin |
| volcanic | obsidian_pillar | lava_rock | basalt_column |
| mystic | crystal_cluster | rune_stone | ancient_altar |

Object list carried over from the 2026-06-07 master plan, reorganized into category columns.
Forest-family column 3 entries are wood-heavy rather than strict relics — accepted as-is.

**No fauna or living creatures in this field** (standing rule from F4: flora/object fields never
contain animals; audit base variants for prompt drift before selection).

## PixelLab generation config

| Parameter | Value |
|---|---|
| Tool | `create_1_direction_object` |
| Size | **96** (96×96 px — boulders/stumps need texture detail) |
| Candidates per call | 16 |
| Variants per object | **64** → 4 calls per object |
| Base calls | 48 objects × 4 = **192 calls → 3,072 base sprites** |
| Naming | `mo__{biome}__{object}__v{NNN}.png` |
| Asset path | `assets/pixelab/landscape_v2/micro/medium_objects/{biome}/{object}/` |
| Prompt template | `top-down high fantasy pixel art {object}, jaw-dropping beauty, hyper-detailed, rich saturated colors, Final Fantasy aesthetic, alpha-transparent background, detailed shading, medium terrain object` |
| Harness | Same as `bulk_generate_f4.py`: 20 concurrent jobs, 429 backoff, explicit User-Agent on Backblaze downloads, alpha-floor validation, auto-retry of rejected batches |

Variant indices must be contiguous from v000 (renderer assumption). Bad variants are excluded
via a contiguous tail-block VARIANT_CAP in the catalog generator, or per-index exclusion lists
at placement time (F3 pattern), never by deleting/renumbering files.

## State variants (6 inorganic states — no growth lifecycle)

Rocks and relics do not grow; F4's seedling/wilting set is replaced with weathering states:

**cracked, destroyed, mossy_overgrown, burned, frozen, enchanted**

- Generated via `edit-images-v2` batches, **9 images/batch** (96 px > 64 px rule)
- 48 objects × 6 states × 9 = **2,592 state sprites** under `_states/{state}/`
- In-game roll: hash-based pool (F3/F4 pattern) — ~80% pristine, ~20% spread across states;
  mossy_overgrown/cracked weighted heaviest (natural weathering), burned/frozen/enchanted rare

## Animations (selective idle loops — most objects static)

No blanket wind_sway. 9-frame idle loops only for objects with inherent light/energy:

| Object | Animation |
|---|---|
| mystic/crystal_cluster | glow pulse |
| mystic/rune_stone | rune shimmer |
| mystic/ancient_altar | faint aura |
| volcanic/lava_rock | ember glow |
| volcanic/obsidian_pillar | heat shimmer |
| beach/tide_pool_rock | water glint |
| arctic/ice_formation | ice sparkle |

7 objects × 64 variants = **448 animated variants** under `anim/{anim_name}/v{NNN}/frame_{NNN}.png`.
Anims auto-upgrade from static on reload (F4 pattern).

## Placement & biome interactions

- Grid 4×4 per tile; density 1–5% baseline, **tuned per biome × category at calibration**
- Pure-biome tiles only (no transition-tile support), same as F4
- Deterministic placement, fresh seed range (9800+) — F5 must never disturb F0–F4 layouts
- Footprint 8–16 px writes into the shared claim mask **before** F2–F4 fill
- Catalog: `scripts/gen-mo-catalog.mjs` → `src/world/mo-catalog.js` (auto-generated, clone of
  `gen-mf-catalog.mjs` including VARIANT_CAP)

## Rendering

Y-sorted sprite overlay within chunk (master-plan render order: F5 above baked F0–F4 bitmap,
below F6 player-sorted large objects and F7 canopy).

## Calibration (final step, after assets land and renderer is wired)

Per-biome tuner panel (key '5'), following the F4 tuner pattern
(`src/dev/f4-tuner.js`, `F4_BIOME_SCALE`), extended with a second axis:

1. **Size**: master + per-biome scale sliders → `F5_BIOME_SCALE`
2. **Density**: per-biome × per-category sliders (16 biomes × 3 categories) — density varies
   both within a biome and across categories (e.g. many boulders, rare relics) → `F5_DENSITY`

Both persisted to localStorage, click-to-teleport biome labels, copy-JSON export. When the user
sends final values, bake into defaults and commit. User signs off on sizing and density visually
against neighboring objects.

## Phases

1. **Cleanup**: archive legacy `medium_objects/` tree (3,648 PNGs: `_unsorted/`, prompt-drift
   dirs, ~58 empty scaffolded dirs from an earlier round); scaffold clean dirs
2. **Base generation**: 192 calls → contact-sheet review → boxy/fauna/corrupt audit
   (border-opacity + corner-occupancy heuristics + visual validation) → select 64/object
3. **States**: 288 edit-images-v2 batches (2,592 sprites)
4. **Animations**: 448 animate jobs (7 objects only)
5. **Renderer wiring**: claims + y-sorted overlay + catalog generator
6. **Calibration**: F5 tuner (size + density axes), bake finals, commit

## Honest absence

Until F5 ships, the world simply has no medium landmarks — lower fields render normally with
no placeholders. No system fakes F5's output.
