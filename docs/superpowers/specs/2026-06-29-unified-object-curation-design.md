# Unified Object Loading + Curation — Design

**Date:** 2026-06-29
**Status:** Approved (direction), pending spec review

## Problem

Curation done in Field Studio has **no effect in the running game**. Three root causes:

1. **Branch split.** The curation toolchain (`scripts/lib/field-curation.mjs`, `apply-field-picks.mjs`,
   `gen-field-manifest.mjs`, and the omit-aware version of `gen-mf-catalog.mjs`) lives only on the
   `worktree-field-curation` branch. The branch the game runs on (`building-facade-blocks`) has an **older
   `gen-mf-catalog.mjs` with no curation logic**, so regenerating catalogs never applies omits.
2. **Two F6 renderers running at once.** `large-object-renderer.js` places from `large_objects/` (141 species,
   static; curation was just wired here), AND `field2-animator.js → decoration-claims.f6Placements` places from
   `large_flora/` (40 species, with states/anims/@384) using `variant = rand % count` — **no cull at all**. The
   two corpora overlap by only 8 species, so they double-place trees, and the large-flora path ignores curation.
3. **Field-specific variant handling.** Some fields cull via a hardcoded `SS_VARIANT_EXCLUDE`, some not at all;
   there is no single curation mechanism.

## Goals

- **One engine** loads objects across **all decoration fields** — F2 (small_flora), F4 (medium_flora),
  F5 (medium_objects), F6 (large_flora **+** large_objects folded in) — plus **building dressing** props.
- **One field-agnostic curation layer** driven by Field Studio: export a pick "package" per field → apply → cull.
- **Denylist model** (user decision): an unreviewed variant **shows by default**; you curate OUT the bad ones.
- **Base-level curation only**; states + animations **cascade automatically** from the base.
- **Additions** (regenerated / newly-generated sprites) need no special step: under the denylist they appear in
  the catalog automatically on regeneration; reviewing them just means exporting a new pick package that omits the
  bad newcomers — the **same** apply path as any other exclusion.

## Non-goals

- No per-state or per-anim curation UI (curation is per base variant; states/anims follow).
- No physical re-foldering of assets in the core phases (deferred to optional Phase 4).
- Not changing how sprites are *generated* — only which ones *load/place*.

## Architecture

### A. Curation layer (universal — every field, every engine)
- **Durable omit-set sidecar per field**: `assets/pixelab/landscape_v2/micro/<dir>/_<field>_curation.json`
  (already the established pattern: `_f6_curation.json`, `_large_objects_curation.json`; dressing uses
  `assets/pixelab/buildings/dressing/_dressing_curation.json`). Shape: `{ field, omits: { "biome/species":
  [variantIndices] }, history: [...] }`.
- **Shared reader/merger** `scripts/lib/field-curation.mjs`: `loadCuration(field)`, `omitSetMap(curation)` →
  `Map("biome/species" → Set(omittedIndices))`, and a `mergePicks(curation, picksExport)` used by apply.
- **Denylist semantics:** allowed = (variants present on disk) − (omitted). A species whose variants are ALL
  omitted is dropped entirely.

### B. Catalog generation (one generator, all fields, with cascade)
- `scripts/gen-mf-catalog.mjs` (extended to the omit-aware version) is the single generator. For each field it
  scans the disk corpus, subtracts the field's omit-set, and emits an **allowed-variant LIST per species**
  (not a raw count) into the field's catalog module (`mf-catalog.js`, `mo-catalog.js`, `lg-catalog.js`, and the
  F6 fold described below).
- **Cascade is automatic.** Catalog entries store states/anims keyed by base variant index
  (`obj.states[state] = [indices]`, `obj.anims = [indices]`). Filtering the allowed base indices through these
  arrays drops the states/anims of any omitted base — no separate cascade logic.
- **Determinism note:** changing a species' variant pool re-maps the placement RNG, so the world repopulates
  with allowed variants on reload (expected; identical to the large_objects cull already shipped).

### C. F6 fold (large_objects → F6) via source metadata
- The F6 catalog is generated from **both** `large_flora/` and `large_objects/` (union). The 8 overlapping
  species prefer `large_flora` (it has states/anims/@384).
- The two folders have **different on-disk layouts** (`large_flora/<sp>/v###.png` with `_states/` + `anim/`;
  `large_objects/<sp>/lg__<biome>__<sp>__v###.png`, base-only). Rather than migrate ~10k files, each catalog
  species carries a **`source`** descriptor `{ dir, filePattern, hasStates, hasAnims }`. `f6SpriteUrl` /
  `f6AnimUrlBase` build URLs from `source`. large_objects species render **static** (no anims) until Phase 4.

### D. Engines (consumers of the allowed lists)
- **decoration-claims.js** — `f2Placements`/`f4Placements`/`f5Placements`/`f6Placements` pick from the catalog's
  **allowed list** (`allowed[floor(rand*allowed.length)]`) instead of `rand % count`. Selection of an omitted
  variant becomes **structurally impossible**.
- **field2-animator.js** — unchanged drawing path; reads `source` for URL building; keeps @384 + anims.
- **`large-object-renderer.js` is RETIRED** — its `drawLargeObjects` call is removed from `canvas-renderer.js`;
  large_objects now renders through the F6 path. (`scripts/gen-lg-objects-catalog.mjs` + `lg-objects-catalog.js`
  built during the interim fix are superseded by the unified catalog.)
- **Building dressing** (`d3-props.js` / `building-occluder.js`) — reads the `dressing` omit-set via the same
  shared lib to cull props; no second curation mechanism.

### E. Field Studio (universal QC front-end)
- `tools/field-studio.html` already enumerates all fields from `field-sources.json` (f2/f4/f5/f6/large_objects/
  dressing). Export `field-picks.<field>.json`.
- **Apply (one command, any field):** `node scripts/apply-field-picks.mjs <field-picks.json>` → merges the
  package into that field's omit-set sidecar → regenerates the affected catalog(s). Same path for every field.

## Data flow

```
Field Studio  →  field-picks.<field>.json  →  apply-field-picks.mjs
   →  _<field>_curation.json (omit-set, denylist)
   →  gen-mf-catalog.mjs (allowed lists + state/anim cascade, F6 union+source)
   →  <field> catalog modules (mf/mo/lg-catalog.js …)
   →  decoration-claims placements pick allowed-only  /  dressing engine culls props
   →  game renders only kept variants (reload)
```

## Phasing (all fields in scope; F6 first)

- **Phase 0 — Unblock.** Bring the curation toolchain onto the game branch: `lib/field-curation.mjs`,
  `apply-field-picks.mjs`, `gen-field-manifest.mjs`, and the omit-aware `gen-mf-catalog.mjs`. Verify versions
  against the `worktree-field-curation` source. Pure unit test for the generator (allowed = disk − omit; cascade).
- **Phase 1 — F6 (fixes the hills symptom).** Fold `large_objects` into F6 via `source` metadata; F6 catalog
  culls the f6 **and** large_objects omit-sets; wire `f6Placements` to allowed lists; **retire**
  `large-object-renderer.js`. In-game verify in hills (excluded trees/objects gone, no double-placement).
- **Phase 2 — F4 / F5 / F2.** Same cull in `mf`/`mo`/small-flora catalogs + those placement functions; migrate
  the hardcoded `SS_VARIANT_EXCLUDE` into real omit-sets so there is one source of truth.
- **Phase 3 — Dressing.** Wire the `dressing` omit-set into `d3-props.js`/`building-occluder.js` prop selection.
- **Phase 4 (optional).** Physically normalize `large_objects` → `large_flora` layout and generate states/anims
  for those species so they animate + upscale like the rest. Removes the `source` special-casing.

## Testing

- **Generator unit test (pure):** allowed list = disk variants − omit-set; an omitted index never appears in the
  emitted variants, states, or anims; a fully-omitted species is absent. (Already proven for large_objects:
  124 species, 0 failures.)
- **Placement invariant:** for each field, the placement function can only return an allowed variant
  (structural — picks an index *into* the allowed array).
- **In-game per field:** walk the biome with day-night frozen at noon; confirm excluded sprites are gone and no
  double-placement.

## Risks

- **Branch reconciliation:** the toolchain must be taken from `worktree-field-curation`; the main branch's stale
  `gen-mf-catalog.mjs` must be replaced, not merged blindly. Diff before adopting.
- **World churn on reload:** culling changes the RNG variant mapping, so existing placements shift. Acceptable and
  expected (matches the shipped large_objects behavior).
- **Source-metadata complexity:** F6 carrying two on-disk layouts is the one non-uniform spot; Phase 4 removes it.
