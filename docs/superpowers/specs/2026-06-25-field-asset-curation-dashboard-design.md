# Field Asset Curation — Dashboard + Omit→Eval Loop (Phase A) — Design

**Date:** 2026-06-25
**Status:** design — Phase A is buildable now (no PixelLab); Phase B is a forward pointer
**Related:** `building-tile-pipeline` + `building-dressing` skills (templates), `tools/building-studio.html` +
`scripts/apply-tile-picks.mjs` (curation precedent), `2026-06-06-decoration-field-system-design.md`,
`2026-06-12-f6-trees-alpha-trim-design.md`.

## Problem

The decoration-field sprite corpora — **F6 (large_flora) most of all**, plus issues in F2–F5 — carry a lot of
unfinished / low-quality PixelLab output. Two concrete problems, measured against disk on 2026-06-25:

1. **Quality.** ~1,300 base tree sprites across **40 species / 16 biomes** contain bad variants. Variant counts are
   wildly uneven (forest/grassland oaks have 64; `swamp/bald_cypress` has 4; savanna/taiga/tropical ≈16; most 23–24).
2. **Coverage.** `wind_sway` animations exist for only **~13 of 40 species** (the forest/dense_forest/grassland/
   tropical_forest families); **27 species have none**. Lifecycle states (`seedling/wilting/dead/burned/frozen/
   enchanted`) were generated **off variant 0 only** and are unverified.

We need: (a) a way for the human to **cull bad sprites fast**, (b) for the machine to **learn the cull rubric** from
those decisions and then **self-select at scale**, and (c) for generation/regen/anim/state work to run **against the
curated keep-set** — all packaged as a reusable skill the way buildings are.

## Decisions (locked with user, 2026-06-25)

- **Omit-based, not keep-based.** Default = keep. User clicks the bad ones. The rubric is inferred from omits.
- **Hard-omit defects:** wrong perspective; landscape painted around the subject so it reads as a tile; cropped /
  cut-off; wildly wrong scale.
- **Context-dependent (flag, never auto-omit):** halo artifacts — can be correct in specific biomes.
- **Ignore:** duplication, species identity.
- **Omit semantics = CULL + queue-for-regen.** An omitted variant leaves the in-game pool **and** lands on a regen
  worklist so the species pool stays full. Non-destructive and reversible.
- **Build the fuller tool first** (reason tags + freeform notes + outlier hints + keyboard nav + resume), F6 first,
  all fields eventually.
- **Optional freeform notes on add OR remove.** Any decision (keep or omit) can carry a freeform "why" in addition to
  (or instead of) a one-key reason tag. Notes are the richest training signal for the eval.

## Phase decomposition

- **Phase A (this doc — no PixelLab):** the dashboard + apply step + the omit→eval loop. Produces the curated
  keep-set, the cull history (reasons + notes), the regen worklist, and the learned rubric.
- **Phase B (separate spec, after the first F6 cull):** the **`decoration-field-pipeline`** skill — regen of culled
  variants + the missing anims/states, gated by the keep-set, templated on `building-tile-pipeline`. Pool-size /
  backfill policy is decided *after* the first cull, when survivor counts are known.

---

## Phase A architecture

Five components; the fifth (auto-QA) is built only **after** the first human cull gives it training data.

### 1. `scripts/gen-field-manifest.mjs` — the scanner (disk is the source of truth)

Walks a field's disk root once and emits `tools/field-manifest.<field>.json`. Per **field → biome → species →
variant**, it records the file path plus cheap **factual** metadata computed in-process (no judgment):

- content-bbox `[x,y,w,h]` and aspect (reuses the alpha-trim logic already in `gen-mf-catalog.mjs`),
- `% opaque fill` of the bbox,
- `scaleVsMedian` — bbox area ÷ the species' median bbox area (the **scale-outlier** signal),
- `magentaCount` — count of PixelLab key-pixels ≈RGB(246,4,252) + halo (the **halo** signal, informational).

These are **hints**, never verdicts. The field is pluggable: each field declares its disk root + variant layout in a
small `FIELD_ROOTS` table. F6 = `assets/pixelab/landscape_v2/micro/large_flora/<biome>/<species>/vNNN.png`. F2–F5 plug
in their own roots when we reach them (their on-disk shapes differ — F2/F3 are hand-curated registries, F4/F5 are the
auto-gen catalogs).

### 2. `tools/field-studio.html` — the dashboard (same family as `building-studio.html`, served at `:8123`)

- **Layout:** Field tabs across the top (F6 active first) → collapsible **Biome** sections → **Species** rows →
  responsive grid of variant thumbnails (`v000…vNNN`), `image-rendering:pixelated`.
- **Interaction:** every thumb is **KEEP** by default. Click → toggles **OMIT** (red overlay, dimmed). A bare click
  stays instant. **Keyboard nav:** arrow keys move a cursor, space toggles omit, so 1,300 thumbs is fast.
- **Reason tag (optional, one key):** `1`–`6` tag the focused thumb with `perspective / painted / cropped / scale /
  halo / other`. Defaults to unspecified.
- **Freeform note (optional):** `n` (or a click on a note glyph) opens a small inline textarea on the focused thumb;
  attachable to **any** decision — keep or omit — and persisted with it.
- **Outlier hints (toggle):** borders thumbs whose *factual* metadata is a statistical outlier within their species
  (catches scale-weird + cropped fast). Hints only; the user still decides.
- **Resume:** every change autosaves to `localStorage` keyed by field; an **Import** button reloads a prior
  `field-picks.json`; refresh never loses work.
- **Export:** a button copies / downloads `field-picks.<field>.json` (schema below).

### 3. `scripts/apply-field-picks.mjs` — applies an export (mirrors `apply-tile-picks.mjs`)

1. **Merge** the export into the durable sidecar `…/large_flora/_<field>_curation.json` (schema below): the omit-set
   keyed by `biome/species`, each culled variant carrying its original index + reason + note + a `regen` worklist
   entry. **No PNG is moved or deleted** — the sidecar is the single source of truth for "what's omitted."
2. **Re-run** `gen-mf-catalog.mjs` (now sidecar-aware) → `LG_CATALOG` regenerates with the omitted variants excluded
   via `vmap` (below).

### 3a. Catalog integration via `vmap` (the corrected mechanism)

The F6 render path uses the variant index **directly as the filename number** — `f6SpriteUrl` builds
`…/v{pad3(variant)}.png`, and `trims[variant]` / `states[st].indexOf(variant)` / `anims.indexOf(variant)` all key off
that same number — so variants must be contiguous `v000…v{N-1}`. Deleting/moving a *middle* variant's file would 404
and desync states/anims. (This **corrects** the draft's "quarantine + zero-renderer-change" idea — impossible given
this coupling.)

Fix — **decouple pool-position from disk-filename with a `vmap`**, a small change owned by this workstream:
- `gen-mf-catalog.mjs` emits, per species, `vmap` = the surviving filename numbers in order (omitted excluded) and
  `variants = vmap.length`; `trims`/`sil` stay positional, aligned to `vmap`.
- `f6Placements` picks a pool **position** `pos ∈ [0, variants)`, resolves `realV = vmap[pos]`, then uses `trims[pos]`/
  `sil[pos]` + `states[st].indexOf(realV)` + `anims.indexOf(realV)`, storing `variant: realV` (so `f6SpriteUrl` /
  `f6AnimUrlBase` are **unchanged**).
- `src/dev/field-registry.js` F6 preview maps position→`realV` the same way.

No files are renamed; variant identity is stable across rounds; regen just lands a new `vNNN.png` on disk (absent from
the omit-set) and the next rescan includes it automatically. Back-compat: a species with no omits gets
`vmap = [0..N-1]`, i.e. `pos === realV`, identical to today.

### 4. The curation sidecar `_<field>_curation.json` — durable record + regen worklist

The single source of truth for "what the human decided and why." It is the omit-set the sidecar-aware
`gen-mf-catalog.mjs` reads to build `vmap`, and it feeds both the eval-learning step and Phase B regeneration.

### 5. `scripts/qa-field.mjs` — auto-QA from the learned rubric (built AFTER the first cull)

Scores every **un-curated** sprite against the learned rubric (deterministic signals + a vision sub-agent for the
judgment calls) and **pre-marks likely-omits** in the dashboard for the next biome/field, so each round the human only
confirms / corrects. This is the mechanism that makes self-selection real.

### Data model

```jsonc
// tools/field-manifest.f6.json  (generated; factual only)
{ "field": "f6",
  "biomes": { "forest": { "oak": [ { "v":0, "file":"…/forest/oak/v000.png",
                                     "bbox":[x,y,w,h], "fill":0.62, "scaleVsMedian":1.03, "magenta":0 }, … ] } } }

// field-picks.f6.json  (dashboard export; decisions only — keep is implicit)
{ "field": "f6", "savedAt": "<iso>",
  "decisions": { "forest/oak": { "omit":[3,17,40],
                                 "tags": { "3":"perspective", "17":"painted", "40":"scale" },
                                 "notes": { "3":"camera looks top-down, others are 3/4",
                                            "12":"keep — best canopy of the set" } } } }   // note on a KEEP too

// _f6_curation.json  (durable sidecar; written by apply-field-picks)
{ "field":"f6", "rounds":[ { "appliedAt":"<iso>",
    "culled":[ { "biome":"forest","species":"oak","v":3,"reason":"perspective","note":"…","regen":true } ] } ],
  "regenWorklist":[ { "biome":"forest","species":"oak","replaces":3,"reason":"perspective" } ] }
```

### The omit→eval loop (the "self-select" payoff)

1. Human curates F6 in the dashboard → `field-picks.f6.json` (omits + tags + notes).
2. I open the omitted sprites + their tags/notes + a sample of kept ones, and write a **rubric** into the Phase B
   skill: per defect, the visual signature + any cheap deterministic proxy (e.g. scale → `scaleVsMedian` threshold;
   cropped → bbox touches frame edge with high fill).
3. I build `qa-field.mjs` from that rubric; it pre-marks the next round; the human only confirms/corrects.
4. Repeat across biomes/fields; the rubric sharpens until the human is spot-checking, not labeling.

### Honest-absence / no-mock compliance

The dashboard never fabricates assets — it curates what exists on disk and records intent. Culled sprites stay on
disk but are excluded from the in-game pool via the omit-set (reversible), not faked. Replacements are real PixelLab
generations under the Phase B skill. The in-game pool only ever shrinks to real survivors or grows with real regen —
no cardboard placeholder trees.

---

## Phase B — `decoration-field-pipeline` skill (forward pointer; separate spec after first cull)

Sibling to `building-tile-pipeline` / `building-dressing`, same bones:

- **Disk-as-truth tracker:** `_f6_state.json` (existing) + the curation sidecar decide what's next — never memory.
- **The OBJECTS-vs-TILES analog for flora:** base **variant** (the tree), lifecycle **state** (`create_object_state`
  off a canonical variant), **wind_sway anim** (`animate_object`). Per-species canonical states/anims + runtime noise
  (per `feedback_motion_one_time_authoring`), not per-variant — 64 anims/species is absurd.
- **Autonomy contract** (Rule −1 analog): gate every PixelLab object (de-magenta → solidify → hole% → re-roll >25%),
  curate sensible defaults, the adversarial review is the approval, only stop for a genuine blocker.
- **QA gates:** mechanical (solidify/hole%, anim-frame fit) + an **adversarial multi-agent asset review** against the
  flora rubric (perspective / painted-tile / crop / scale / halo lenses) before declaring a species done.
- **Per-species prompt-token framework:** rich prompts tracked per species in `f6_trees.json`; regen of a culled
  variant reuses the species prompt with a fresh seed (+ a targeted clause when the cull reason implies one, e.g.
  "strict 3/4 top-down perspective, isolated specimen on transparent background, NO ground/landscape painted in").
- **Drives:** regen the worklist, the 27 missing anim species, and verify/replace the variant-0-only states — all
  gated by the curated keep-set.

## Testability

- `gen-field-manifest.mjs` + `apply-field-picks.mjs` run headless (node) → verifiable on disk.
- The dashboard renders real PNGs; a curation round produces a real `field-picks.json`; apply records the omit-set +
  rescans → the catalog (via `vmap`) reflects survivors; the running game renders only the survivors. Reversible by
  clearing the omit entry.

## Out of scope for Phase A

PixelLab generation of any kind; states/anims review modes (added after they're generated); F2–F5 disk-root adapters
(wired when we reach those fields). The dashboard is built field-pluggable so these slot in without a rewrite.
