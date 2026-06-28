---
name: decoration-field-pipeline
description: Use for generating, curating, and evaluating decoration-field sprites — large flora (F6) and large_objects landscape specimens (trees, palms, rocks, arches, pillars, vents). Carries the defect taxonomy (the EVAL rules), per-object-class generation prompts, deterministic QA gates, and the contact-sheet curation workflow. INVOKE before any large_objects / decoration-field generation, curation, or eval work.
---

# Decoration Field Pipeline

The decoration fields (F2 small flora → F6 large flora → `large_objects` landscape specimens) are isolated sprites the world scatters onto the Wang-tiled terrain. Each one renders THROUGH the GL chunk pipeline (lighting/CRT/day-night/depth) and is placed by `decoration-claims.js` over a transparent base. This skill is how you generate them so they don't get culled, and how you curate the ones that already exist.

It was written from a full forensic audit of the `large_objects` corpus (2026-06-27): **3,538 of ~7,900 variants were culled** across 75 species. Every removed image was inspected via contact-sheet montage. The defect modes below are what the human curator was actually removing — they ARE the eval.

## The one rule everything reduces to

> **A decoration sprite is ONE isolated specimen, on a FULLY TRANSPARENT background, seen 3/4 side-on, whole-in-frame, in natural colors.**

Nine of every ten culls are a violation of one clause of that sentence: a baked ground, a baked scene, a wrong camera, a clipped edge, a wrong identity, or a wrong palette. Generation prompts and QA gates below enforce each clause.

## Defect taxonomy (the eval codes)

Apply these when judging a candidate or curating a corpus. The first six cause the overwhelming majority of culls.

| Code | Meaning | Tells |
|------|---------|-------|
| **GROUND** | ground baked under the base | dirt/grass/sand/snow disc, mound, **platform/dais**, **water-plate**, soil patch, drop-shadow slab fused to the roots. Opaque where it should be transparent. *The #1 mode — dominant in 11 of 17 biomes (hills 85%, steppe 82%, tundra 80%, swamp 58%, mountains 55%, savanna 55%, grassland 50%, beach 78%).* |
| **IDENTITY** | contents ≠ the species | the slug says "oak" but it's armor; "driftwood" → sea-sculptures; "aether pillar" → a marble column; "rock_spire" → a castle. Corpus pollution. |
| **FRAG** | the slug itself is broken | slug is a truncated prompt (`..._tree_in`, `..._with_white`, `..._over_water`, `..._encased_in`, `transparent_background`, `fantasy_game`) OR an inherently scene-bound subject (cave/den entrance, cliff face, overhang — a hole in terrain, not an object). |
| **SCENE** | an environment baked in | horizon, sky, ocean/surf, oasis-island, waterfall, framed rug/tapestry, a whole landscape instead of one specimen. *Tropical palms 50%, beach palms 85%.* |
| **SQUARE / BLANK-KEY** | no usable alpha | opaque plate to the cell edges, OR a solid magenta `#FF00FF` plate with no subject = a **failed/empty render** (distinct from art). *Whole species: grassland/cherry_blossom, savanna/baobab v016–v031, tropical/banyan v016–v031.* |
| **PERSP** | wrong camera | top-down canopy as a flat disc, overhead, isometric, or a flat frontal-trunk elevation. *Desert palms 25–40% top-down star-canopies.* |
| **STYLE** | off-render | washed-out/ghosted/low-contrast, muddy/dark/soft (non-crisp), **palette-clash** (neon/cyan/purple **enchanted-recolor**, **frost/ice tint** in a warm biome, frost-fleck speckle). *Taiga 83%, dense_forest 50%.* |
| **CROP** | clipped by the canvas | crown or base cut at an edge; "tall"/"wide" species overflow the frame. |
| **MULTI** | more than one object | a cluster/grove, or props (rocks, huts, figures, bones) added at the base. |
| **SCALE** | wrong size | tiny-in-frame, or canvas-filling/overflowing, vs siblings. |
| **BLOB** | malformed | unreadable blob, melted geometry, near-black silhouette. |
| HALO *(context)* | key residue / glow | magenta fringe, white matte halo. A cleanup flag — NOT a cull reason by itself, and **intended** for self-luminous subjects (mystic energy, magma vents). |
| DUP *(context)* | near-duplicate | ignore for judgment (the user explicitly does not cull on duplication or species identity overlap). |

### Named sub-modes worth their own gate
- **MAGENTA-BLANK / EMPTY-RENDER** — ≥X% pure `#FF00FF`, no opaque subject. A *generation failure*, not a design defect. Gate it out before curation ever sees it.
- **WATER-PLATE** (GROUND) — flat blue/teal sheet under the roots; the dominant swamp/tropical failure.
- **ORNAMENTAL-PLATFORM / DAIS** (GROUND) — a carved tiered-stone ring as the base; a soil-color test misses it (hills rowan v046/v095/v158/v159).
- **ORANGE-DISC** (GROUND) — high-chroma clay disc that clashes with terrain even if alpha-trimmed (steppe v064).
- **DIORAMA / STAGED-VIGNETTE** (SCENE) — glowing mushrooms + treasure, or skulls/bones, arranged around the base (mountains mountain_ash v028; hills caves).
- **ARTIFACT / SCULPTURE** (IDENTITY) — man-made objects (anchors, masks, compass roses, columns, castles) generated into a natural-flora field. Driven by "artistic"/"sculpture"/"pillar" in the slug.
- **LOLLIPOP** (IDENTITY+CROP) — thick bare trunk + small clipped canopy clump; reads as a mushroom, not a layered conifer (taiga).
- **UPROOTED ROOT-BALL / TRUNK-CAVE** — the base becomes terrain (splayed root mass) or a scene (hollow cave in the trunk).

## Generation prompts

Compose every prompt from the **four universal clauses** + an **object-class body** + **negatives**. Use PixelLab `create_map_object` with `view: "side"` (a near-eye-level 3/4 side profile; `high top-down` re-bakes ground and was a primary cause of GROUND/PERSP — see [[project_tree_upscale_pipeline]] and the F6 regen notes).

**Universal clauses (append to EVERY prompt):**
1. *Isolation* — "a single isolated specimen on a fully transparent background; the base/roots terminate cleanly into transparent pixels — NO ground disc, soil/grass/sand/snow patch, mound, platform, dais, water plate or reflection, cast-shadow slab, horizon, sky, or any scenery."
2. *Camera* — "strict 3/4 side-on view at eye level; the full silhouette from base to top is visible; NOT top-down, NOT overhead, NOT a flat canopy disc, NOT isometric, NOT a flat frontal elevation."
3. *Framing* — "the whole specimen fits inside the frame with margin on all sides; not clipped at any edge, not overflowing, not tiny-in-frame." (Drop "tall"/"wide" adjectives — they cause overflow.)
4. *Palette/identity* — "natural colors, high-contrast readable pixel art; NO glowing gems/crystals, NO neon or cyan/purple/blue magical recolor, NO frost/ice tint, NO faces/skulls/creatures, NO man-made sculpture or architecture, no muddy low-contrast shading or speckle noise."

**Universal negative prompt:** `ground, grass, dirt, soil, sand, snow, water, pond, ocean, beach, horizon, sky, scenery, shadow disc, platform, pedestal, dais, frame, border, panel, multiple, cluster, top-down, overhead, isometric, blurry, low-contrast, glowing, neon crystal, gem, frost, ice, face, skull, creature, sculpture, statue, building, castle, magenta background`

**Object-class bodies:**
- **Broadleaf tree** — "a single {species} tree with a {trunk/bark detail} trunk and a full {color} {summer/autumn} canopy."
- **Conifer** — "a single {species}, tall narrow conical evergreen, layered drooping branches reaching near the slender trunk." (Counters the taiga LOLLIPOP/STYLE: add "crisp hard-edged needle clusters, readable at 64px.")
- **Palm** — "a single {species} palm, slender {curved/leaning} trunk, arching fronds." (Leaning is correct identity — don't forbid it; forbid the baked water/beach.)
- **Rock / arch / spire** — "a single natural weathered {sandstone/granite} {arch:single curved span / spire:tapering needle}, legs/base ending in transparency; not a built gateway, not a triangular A-frame, no crystals/bones/moss encrustation."
- **Self-luminous (mystic pillar / magma vent)** — "a column of glowing magical {aether energy / molten lava}, self-illuminated light/plasma core; NOT a stone/marble/wooden column, no barber-pole stripe, no caged orb." Here a soft glow halo is INTENDED (don't gate HALO); still forbid a SQUARE opaque background plate. For a **magma vent** specifically: "a small ground-level basalt spatter-cone or fissure, knee-to-head high — NOT a whole volcano mountain (SCALE), NOT a top-down crater ring (PERSP), a SOLID emitter not a smoke/explosion particle VFX."

## Slug hygiene + field-fit (kills FRAG by construction)

- A species slug must be a **clean object noun** (`oak`, `coconut_palm`, `sandstone_arch`). Reject slugs that are truncated prompt fragments (trailing `_in`/`_with`/`_over`/`_wrapped`/`_encased`, or leaked fragments like `transparent_background`, `fantasy_game`, `…ruggedide`). Move all descriptors into the prompt body.
- **Scene-bound subjects do not belong in a transparent-sprite field.** Cave/den entrances, cliff faces, rocky overhangs, ledges, "landscape" — these are holes-in-terrain or terrain features and are FRAG+SQUARE+SCENE by construction. Route them to a terrain / POI / wall-tile pipeline, never `large_objects`.
- **Field-fit:** `large_objects` is for discrete free-standing natural specimens. Man-made columns/statues/architecture (mystic "aether pillar" → marble columns) are a taxonomy mismatch even when well-rendered.
- **DROPPED (2026-06-28):** 8 large_objects species were dropped wholesale as scene-bound — recorded in `scripts/asset-corpus/large_objects_dropped.json` (the two `transparent_background` + `fantasy_game` pollution-slug buckets, 3 cave/den entrances, 1 cliff face, 1 overhang/ledge). `node scripts/apply-dropped-species.mjs large_objects` marks them in the sidecar's `droppedSpecies`. Free-standing rock objects (`sandstone_arch`, `rock_spire`, `magma_vent`) are KEPT — those are real specimens, fixable by the rock/vent prompts above.

## Deterministic QA gate (WIRED — runs in gen-field-manifest)

`gen-field-manifest.mjs` computes a per-variant `qa.flags` for EVERY field (F2–F6, large_objects) — pixel-only checks that catch the mechanical failures so human curation only sees real art decisions:
- **BROKEN / BLANK** — undecodable stub, OR opaque < 1% / magenta-key > 50% (empty or failed render). The ONLY auto-rejectable class.
- **SQUARE** — fill ≥ 0.95 AND bbox ≈ the whole canvas (opaque plate to the edges).
- **CROP** — opaque bbox touches the **TOP** edge (crown clipped). NOT the bottom — a grounded specimen's base belongs at the bottom edge, so bottom-touch is normal.
- **GROUND** — a wide, near-solid opaque band at the very bottom, ≥1.6× wider than the body above it (baked ground disc). Deliberately conservative/high-precision; the real GROUND fix is the generation prompt, not post-hoc detection.
- **SCALE** — `area / species-median` < 0.4 or > 2.5.
- HALO is intentionally NOT gated (self-luminous subjects need a glow).

Then `node scripts/qa-gate.mjs <field>` reports the flag counts + the failed-render list; `--apply` UNIONs the failed renders (BROKEN+BLANK) into the omit-set — the only auto-safe reject, and never the PNGs. For gitignored fields set `FIELD_ASSET_ROOT=<main checkout>` (gen-field-manifest, qa-gate, curate all honor it). **Validated on large_objects (2026-06-28):** the gate independently re-found the human's 112 failed renders (16 each in cherry_blossom, baobab, thorny_acacia, banyan, jungle_tree, magma_vent, crystal_ice_tower) at `+0` new — no false-positives, none missed.

## Curation workflow (already built)

When a human marks omits in `tools/field-studio.html`, they export `field-picks.<field>.json`. To turn that into a durable manifest AND audit *why*:
1. `node scripts/curate-large-objects.mjs <picks.json>` → writes the omit sidecar `_<field>_curation.json` next to the assets + `tools/large-objects-curation-manifest.json` (kept-vs-removed per species) + `tools/large-objects-removed-files.json`. (For F4/F5/F6 use `scripts/apply-field-picks.mjs`, which also rebuilds the vmap catalog; `large_objects` has no vmap consumer yet, so it only records the sidecar.)
2. `node scripts/lo-montage.mjs` → composites the removed variants into labeled **contact-sheet montages** over a checkerboard (transparency, baked-ground, and magenta-blank all read at a glance). ~3,500 sprites → ~140 montages.
3. Fan out **one analysis agent per biome** (Glob `<biome>__*.png`) with the defect taxonomy above; each returns per-species primary defect + mode fractions + exemplars. Synthesize into eval rules + prompt fixes (this is how this skill was written).

The omit sidecar is non-destructive (catalog-exclude / future renderer-cull, never deletes PNGs). See [[project_field_wiring_state]] and [[project_building_tile_corpus]] for the sibling building pipeline.

## Status

- **`large_objects` curated 2026-06-27:** 3,538 removed / 4,363 kept, 75 species. Sidecar + manifest written.
- **QA gate WIRED + 8 scene-bound species DROPPED (2026-06-28).** The full corpus is 12,845 variants across ~135 species (the cull touched 75); the gate flagged BROKEN=112, CROP=1621 (top-edge), GROUND=251, SCALE=88, SQUARE=9.
- **Regeneration deferred** — the corpus is older and registry-less; when we regen, build a clean registry (like `f6_trees.json`) using the prompts above, honor `large_objects_dropped.json`, and segregate by object-class so wearables/architecture never land in a flora slug. Run the QA gate before curation each burst.
