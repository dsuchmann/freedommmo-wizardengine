# PixelLab Asset Manifest — Pass 2+ (Plan X1)

**Date:** 2026-06-12
**Status:** living document — maintained continuously as Pass 2+ plans land. Each consuming plan updates its rows (counts firm up when the plan doc is written; this manifest carries the current best estimate and the binding quantization).
**Authority:** quantizations come from `2026-06-11-asset-state-taxonomy.md` (per-archetype requirement sheets) and the size-tuner feedback rule: **32px F2–F3, 64px F4 / fauna / body parts, 96px F5, 192px F6–F7**. Building pieces follow blueprint quantization (M4). Wang tilesets are always 32×32 (non-negotiable).
**Pipeline:** existing PixelLab MCP pipeline (`create_map_object` / `create_object_state` / `animate_object`, character tools for fauna/bodies) + per-biome size tuner per field (required for every new field/category). Generation rides asset folders under `assets/pixelab/`.

**Rules:**
1. Nothing here is generated speculatively — a row's generation burst begins when its consuming plan reaches `planned` (or its Pass 1.5 trigger fires).
2. The taxonomy sheet is authoritative for state lists; this manifest is authoritative for counts and scheduling.
3. Sprite *pieces*, never composites, wherever a system composes (buildings = wall/floor/roof pieces; bodies = part graphs). No whole-house sprites, no whole-body animation sheets.

---

## 1. F6 trees + F7 canopies (192px) — consumed by W2

First big burst (kernel `tree` species is wired and waiting).

| Asset | States per archetype | Archetypes | Est. count |
|---|---|---|---|
| F6 trunk/tree | seedling, growing, normal, wilting, dead, stump, snag, burned (+fruiting for fruit-bearers) | ~4–6 tree species per forest biome × ~6 biomes, dedup shared species → ~16–20 archetypes | 8–9 states × ~18 ≈ **150 sprites** |
| F7 canopy overlay | slaved to trunk state: full, thinning, bare, none (dead/stump emit no canopy) | one canopy set per F6 archetype with foliage | 3 states × ~14 ≈ **42 sprites** |
| F6/F7 wind-sway anim | normal + flourishing states only (taxonomy: no sway on dead/stump) | per archetype | ~32 animation jobs |

Per-biome size tuner: required before mass generation (F4-style slider).

## 2. Fauna sheets (64px) — consumed by W4, L4

| Asset | States | Species | Est. count |
|---|---|---|---|
| Grazer (first: already simulated) | juvenile, adult, elderly, corpse × 4 directions | 1 | 16 sprites |
| Fauna roster (L4) | same 4 lifecycle states × 4 directions | ~12 species across biomes (deer/boar/wolf/rabbit/goat/sheep/cow/horse/fox/bear/bird/fish classes) | ≈ **192 sprites** |

Movement rendering is the motion DSL's job (L3) — fauna sheets are *static poses per state/direction*, not walk cycles. If L3 lands first, fauna migrate to part-based rigs and this row shrinks to part sets.

## 3. Species body parts (64px) — consumed by L2 (Body Assembly)

Part graphs, per-race, per-direction. NO whole-body sprites; the rig composes.

| Asset | Parts | Variants | Est. count |
|---|---|---|---|
| Humanoid part sets | head, torso, upper/fore-arm ×2, hand ×2, thigh/shin ×2, foot ×2 (≈13 parts) × 4 directions | per race (human/elf/dwarf/orc + 2 more) × ~3 body types × age bands (child/adult/elder skins) | 13 × 4 × 6 races × 3 × 3 ≈ **~2,800 part sprites** — generated in waves, adult-human-first (~150 to unblock L2) |
| Hair/face variant layers | hair, beard, face overlays × 4 directions | ~10 per race | additive, demand-driven |

This is the largest category; the L2 plan doc owns the wave schedule. First wave = 1 race × 1 body type × adult.

## 4. Building pieces (blueprint quantization, M4) — consumed by P4

Wall/floor/door/roof *pieces* on the world grid (32px grid cells; pieces may span cells per blueprint grammar). Mined from world-compiler building templates.

| Asset | Pieces | Styles | Est. count |
|---|---|---|---|
| Wall sections | straight, corner, T, end, window-variant × 4 orientations | per material-culture style (timber, stone, wattle, brick — ~4 styles at start) | ~80 |
| Floors | interior floor tiles (wood plank, stone, dirt, rug-edge) | 4 styles | ~16 |
| Doors | closed/open/broken × orientations | 4 styles | ~24 |
| Roof canopy pieces | edge/ridge/hip/full segments (alpha-fade on entry handled in renderer) | 4 styles | ~48 |
| Interior features | forge, bed, table, chair, chest, shelf, hearth, loom, anvil, barrel (M2 objects with damage states intact/cracked/broken) | ~10 features × 3 states | ~30 |

## 5. F5 medium objects (96px) — consumed by W1

Generation pipeline already in progress (see F5 archive/regeneration). Taxonomy sheet governs: Geological/Relic get intact/cracked/destroyed; Organic (stumps/logs/hay) get decaying tail. Counts owned by the existing F5 generation effort — this manifest tracks completion, not a new burst.

## 6. Item sprites (32px inventory icons) — consumed by M5, V4

| Asset | Est. count |
|---|---|
| Raw matter icons (per F2–F7 harvest product + M2 break products: berries, wood, stone shards, fibre, hide, bone…) | ~40 |
| Crafted items (M3 discovers recipes; icons generated **on canonicalization** — a discovered recipe triggers an icon job, never pre-made) | open-ended, demand-driven |
| Equipment (M5 25-slot wearables — also need 64px worn-layer variants per body part for L2 layering) | ~50 icons + worn layers in L2 waves |

Discovered-recipe icons are the one runtime-adjacent generation path: queue jobs as recipes canonicalize, placeholder = the dominant ingredient's icon until the job lands (honest: it *is* mostly that ingredient).

## 7. Road / path / bridge objects — consumed by P1, P2

| Asset | Est. count |
|---|---|
| Worn-path: none needed — paths are flora suppression revealing F0/F1 ground (zero assets, by design) | 0 |
| Road Wang strips (dirt road, cobble) 32×32 Wang tilesets | 2 tilesets |
| Bridges/fords (wood bridge, stone bridge, ford stones) 96px objects with intact/damaged/collapsed states | ~9 |

---

## Scheduling summary

| Burst | Trigger | Rows |
|---|---|---|
| **Burst 1** | W2 trigger (next) | §1 F6/F7 |
| Burst 2 | W4 / P4 | §2 grazer, §4 building pieces |
| Burst 3 | M5 / P2 | §6 raw-matter icons, §7 roads |
| Burst 4 | L2 planned | §3 first wave (adult human parts) |
| Continuous | M3 canonicalizations, L2 waves, L4 roster | §3, §6 |

**Estimated total (excluding open-ended rows): ~3,400 sprites + ~32 animation jobs**, dominated by body parts (waved). Every burst starts with the per-biome/per-category size tuner before mass generation.
