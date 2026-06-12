# Unified Field Tuner (F2–FN per-object/per-variant size + density calibration)

Date: 2026-06-11
Status: Approved (user-validated via brainstorming dialogue)
Atlas position: S2 World Substrate — dev tooling over the decoration field placement systems (F2 small flora, F3 small features, F4 medium flora, later F5 medium objects). No simulation semantics; pure calibration of placement parameters that are already deterministic.

## Goal

One in-game overlay that lets the user, while standing in any biome, fine-tune the **size** and **density** of every decoration object in fields F2, F3, F4 (F5 joins when its placement lands), down to the individual variant level, with:

- Enumerated asset paths listed per object.
- Per-variant **size ranges** (each placed instance rolls deterministically within [min, max]).
- Bulk-select N objects/variants → apply a flat size.
- Collapsible UI that fits the game screen.
- Live updates (cache flush, no reload), localStorage persistence, Copy-JSON export for baking into source defaults.

This replaces the F4-only tuner (`f4-tuner.js`, key '4').

## Decisions (user-confirmed)

1. **Levels combine by multiplication**: effective size = master × biome × object × variant. Same for density (but density stops at object level — no per-variant density; variants keep their existing whitelist/exclude weights).
2. **Density sliders are multipliers** over the current tuned baselines (1.0 = today's behavior, 0 = object hidden).
3. **Persistence**: localStorage scratchpad + Copy-JSON export; Claude bakes exported values into source constants, after which localStorage resets to all-1.0.
4. **UI**: one unified panel with field tabs, not per-field panels.
5. **Architecture**: central tuning store + thin per-field hooks (approach A below).
6. **Per-object, per-category animation toggles** (added 2026-06-11, user request): some objects (tree stumps, logs) must never wind-sway, and Claude can't always guess which — the user controls it per object in the same panel. Not a blanket on/off: each generated animation **category** gets its own toggle. Current categories: `wind_sway` (consumed by the renderer) and `player_walk` (generated on disk for small_flora; renderer wiring pending — its toggle takes effect when that lands, and meanwhile gates future generation). Object node gains `anims: { wind_sway: false, player_walk: false }` — missing key = enabled. Per-object only, not per-variant (variants of one plant sway or don't together). F2 and F4 only — F3 has no animations. A disabled category falls back to the static sprite. Exported disables get baked as permanent catalog entries, and those object×category pairs stop being sent to PixelLab.

## Architecture (Approach A — chosen)

Alternatives considered: (B) extending each field's own constant tables — rejected: three divergent code paths and export formats; (C) full data-driven placement config — rejected: large refactor of working pipeline with no calibration benefit.

### `src/world/field-tuning.js` (new)

- Holds one tree:

```js
{
  f2: { master: 1, biomes: { grassland: { size: 1, density: 1, objects: {
    tall_grass: { size: 1, density: 1, variants: { 3: { sizeMin: 0.8, sizeMax: 1.2 } } }
  } } } },
  f3: { ... }, f4: { ... }
}
```

- Every node has optional `size` (scalar) or `sizeMin`/`sizeMax` (range) and `density`. Missing node ⇒ 1.0. All-defaults must produce placements byte-identical to current master.
- `tuneAnimEnabled(field, biome, obj, category) → boolean` — false only when the object node has `anims: { [category]: false }`. F2 hook: gates `animUrlBase` (wind_sway) in `buildTileDescriptor`; same gate point covers F4 blades (descriptor's `animUrlBase` for `hasAnim` placements). `player_walk` is queried by the walk-disturbance renderer when it lands.
- `resolveTuning(field, biome, obj, variantIdx, seed) → { sizeMul, densityMul }`
  - sizeMul = master × biome × object × variant. A range node contributes a deterministic roll in [min, max] hashed from the placement seed (same large-prime XOR hash style as existing placement) — stable across frames and reloads.
  - densityMul = master × biome × object.
- Loads from localStorage key `fieldTuning` on boot. `setTuning(path, values)` writes localStorage and flushes caches: `clearClaimCaches()` + `clearF2TileDescriptors()` (proven sufficient for live updates in the F4 tuner).
- Migration: existing `f4BiomeScale` localStorage values fold into the new tree on first load; old key deleted.
- Bake flow: Copy JSON exports the whole tree → baked into source baseline constants → localStorage cleared → tree back to all-1.0.

### Field hooks (one-line call sites where constants live today)

- **F2** — `field2-animator.js` `buildTileDescriptor`: densityMul scales `baseDensity` (rounded, min 0); sizeMul folds into `lifeScale` per blade. Objects = blade/sprite types from the F2 catalog; variants = existing sprite variant indices.
- **F3** — `decoration-claims.js` `f3Placements`: densityMul scales per-object placement probability (derived from `sparsity`); sizeMul folds into per-object `scale`. Enumeration from `SS_BIOME_OBJECTS`; `SS_VARIANT_EXCLUDE`d variants shown greyed-out, not tunable.
- **F4** — `f4Placements`: densityMul × `F4_TILE_CHANCE[biome]`; sizeMul × (`F4_BIOME_SCALE` × `MF_CATALOG` size).
- **F5 (later)** — registers `mo-catalog.js` as a fourth field tab; no tuner changes needed.

### UI — `src/dev/field-tuner.js` (new, replaces `f4-tuner.js`)

- Hotkey **`** (backtick) toggles the overlay. Max-height ~70vh, scrollable, collapsible sections; expand state remembered per session.
- Top bar: field tabs F2/F3/F4 · current biome (auto-detected from player position) · biome teleport dropdown (reuse BIOME_SPOTS) · master slider · biome size/density sliders · Copy JSON · Reset.
- Body: the current biome's objects as collapsible rows. Object row = checkbox · name · enumerated asset path (e.g. `micro/small_flora/grassland/clover`) · size slider (0.25–2.0) · density slider (0–3.0) · expand arrow.
- Variant rows (`v001…vNNN`): min/max dual-range size control + computed effective-size readout (so multiply-down is always visible).
- Bulk: check objects/variants → "Set selected: size [D]" applies a flat size to all checked.

## Honest absence

Without the tuner, fields render at their baked source baselines — exactly today's behavior. The tuner never fakes placement; it only scales parameters the placement systems already use.

## Testing

Headless probe (Playwright, existing harness pattern):
1. All-defaults ⇒ placements byte-identical to master (regression gate).
2. Set density 0.5 on an F2 object via `window._fieldTuning` ⇒ blade count for that object halves (±rounding).
3. Set size 2.0 on an F4 object ⇒ placed scale doubles.
4. Variant range [0.8, 1.2] ⇒ all instances within range, identical across two loads (determinism).

## Out of scope

- F5 placement itself (separate plan; F5 joins the tuner afterward).
- Changing seeds, claim ordering, or variant whitelists/excludes.
- Writing config from dev server (rejected persistence option).
