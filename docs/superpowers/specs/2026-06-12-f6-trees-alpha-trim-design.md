# F6 Trees + Alpha-Trim Foundation — Design

**Date:** 2026-06-12
**Lane:** third agent (asset corpus / W2). Companion to `2026-06-12-asset-corpus-w2-overlay-design.md`.
**Status:** approved by user (this conversation)

## Goal

Wire F6 large flora (192px trees, landing now from the W2 burst) into placements, the y-sorted draw pool, and the field tuner — and fix the big-sprite spacing problem by claiming space from the **alpha-channel bounding box** instead of the PNG file edge, for both F5 and F6. The trim data is deliberately shaped to be the input for the follow-up traversal/collision spec (Plan B).

## Non-goals (separate specs)

- Fine-grain traversal: blocks / jumpable / standable profiles, jump verb, stand-height — **Plan B**, brainstormed after this ships.
- Canopy fade when the player walks behind a tree — follow-up draw-pass tweak (user approved plain y-sort occlusion for now).
- F7 canopies, building pieces, fauna.
- Wind anims for F5 — user directive: F5 medium objects need **no** wind animations, only states.

## Components

### 1. Catalog generation with alpha trims

Extend `scripts/gen-mf-catalog.mjs` (which already handles F4 → mf-catalog and F5 → `src/world/mo-catalog.js`) to:

- Scan `assets/pixelab/landscape_v2/micro/large_flora/<biome>/<archetype>/` → emit `src/world/lg-catalog.js` exporting `LG_CATALOG`, same record shape as MO_CATALOG: `{ name, size, variants, states: {state: [v..]}, anims: [v..] }`.
- **New field on both LG and MO records:** `trims: [[x, y, w, h], ...]` indexed by variant — the tight bounding box of pixels with alpha > 0, computed by decoding each base-variant PNG at generation time. F4 records are unchanged (32px sprites have negligible padding).
- F6 anim detection: a variant counts as animated when `anim/wind_sway/v0XX/` holds ≥ 8 frames (the W2 registry generates 8; F5's ≥ 9 rule stays for F5).
- Regenerate `mo-catalog.js` in the same run so F5 gets trims immediately.

Honest absence: the catalog only reflects what's on disk. Biomes/archetypes the burst hasn't written yet simply don't appear; no placeholders.

### 2. Placements + claims by trim (`src/world/decoration-claims.js`)

- `f6Placements(wx, wy, tileInfo)` mirroring `f5Placements()` (lines ~567-606): one object max per tile, deterministic rand2 salts from a fresh block (9830+), state roll over the F6 state order using only states present on disk, `F6_BIOME_SCALE` export (all 16 biomes at 1.0) applied to `sizeTiles` (192px @ 1.0 = 6 tiles).
- **Claim footprints from trims:** placement `fw/fh` for both F5 and F6 derive from `trims[variant]` × scale instead of native px. The transparent margin returns to F2/F4.
- Ordering: F6 claims before F5 before F4 (existing bigger-first rule). A tile with an F6 placement yields empty F5/F4 results, same mechanism as F5-over-F4 today.
- Mask scan radius widens from ±3 to cover the 6-tile F6 reach (±6 at max tuner scale).
- Placement records carry `trim` so Plan B can read it without re-deriving.

### 3. Field-tuner registry entry (`src/dev/field-registry.js`)

One `f6` entry after the f5 entry:

- `id:'f6'`, `label:'F6 large flora'`, `path:'micro/large_flora'`, `applyKind:'live'`, `animCategories:[['wind_sway','wind']]`.
- `objectsFor(biome)` reads `LG_CATALOG[biome] || []`.
- `stateNames()` → `F6_STATE_ORDER` (taxonomy order: seedling, growing, normal, wilting, dead, stump, snag, burned, budding, fruiting, harvested); `stateDefaults(biome)` → `f6StateDefaults()` in `field-tuning.js`, defaults weighted like the approved F2 lifecycle mix (mostly normal, minority seedling/wilting/dead, zero for absent-on-disk states).
- The merged f5-field-registry work means the F6 tab, master/biome/object/variant size sliders, density, and state-weight sliders appear with no tuner-UI changes. (Standing rule: every field ships with its tuner.)

### 4. Draw pool (`src/render/field2-animator.js`)

- Call `f6Placements()` alongside the F5 call (~line 631); push onto the shared y-sorted pool with a distinct `bi` trigger-key space, `isRigid:true`, `sortYOff` at the trunk base (`uy + sizeTiles * 0.30` pattern, tuned visually), `lifeScale: sizeTiles`.
- Wind: variants listed in `anims` use their 8-frame wind_sway; others draw static. Never synthesize sway.
- Plain y-sort occlusion: the player disappears behind a tree sprite. Accepted; canopy fade later.

### 5. Verification

- Node tests: trim computation against synthetic PNGs (known alpha rects); `f6Placements` determinism (same inputs → same outputs); claims-respect-trim (cells outside the trimmed bbox of a placed F6/F5 object remain claimable by F4).
- Headless probe (F2-probe pattern, port 8741, swiftshader): teleport to a forest coordinate, assert trees render (pixel diff vs F6 density 0) and the F6 master size slider visibly changes the canvas.
- Manual: open tuner (`` ` ``), F6 tab, drag sliders per biome.

## Constraints

- Shared working tree: `git add` exact paths only; never touch `sim/`, running burst scripts, or other agents' surfaces beyond the minimal call-site lines in `field2-animator.js`.
- Catalog regen must be a strict superset for F5 consumers (trims are additive; no removals).
- W2 burst writes new variants continuously — catalog regen is rerunnable and order-stable.
