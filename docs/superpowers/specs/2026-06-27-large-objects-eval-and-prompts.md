# large_objects — curation, eval taxonomy & generation prompts (2026-06-27)

Forensic record of the `large_objects` decoration-field cull. The operational guidance (defect codes, prompt templates, QA gates, curation workflow) is the **`decoration-field-pipeline` skill** (`.claude/skills/decoration-field-pipeline/SKILL.md`); this doc is the archaeology — what was actually removed and why, biome by biome.

## Run record

- Input: `field-picks.large_objects (1).json` (human omits from `tools/field-studio.html`).
- `node scripts/curate-large-objects.mjs <picks>` → **3,538 removed / 4,363 kept across 75 species**; 0 omits failed to resolve to a real file. Wrote the non-destructive omit sidecar `assets/.../large_objects/_large_objects_curation.json` + `tools/large-objects-curation-manifest.json` + `tools/large-objects-removed-files.json`.
- `node scripts/lo-montage.mjs` → 143 labeled contact-sheet montages (removed variants over a checkerboard) in `tools/lo-montages/`.
- 17 per-biome analysis subagents read every montage and classified defects against the taxonomy. **Regeneration deferred** by the user — manifest first, strategy discussion before any PixelLab work.
- Asset/code split: large_objects assets + the sidecar live in the MAIN checkout (gitignored); the curation scripts live in this worktree.

## Cross-biome synthesis

The cull is overwhelmingly about the **isolation rule** — one specimen, transparent background, 3/4 side-on, whole-in-frame, natural colors. The dominant failure across the whole corpus is **GROUND** (a baked base disc/mound/platform/water-plate/snow-mound), followed by **IDENTITY** corpus-pollution buckets, **FRAG** scene-fragment slugs, **SCENE** baked environments, and **MAGENTA-BLANK** failed renders. Full taxonomy + the convergent prompt fixes are in the skill.

## Per-biome dominant modes (grounded in the montage audit)

| Biome | Dominant modes (approx %) | Notable exemplars / sub-modes |
|-------|---------------------------|-------------------------------|
| arctic | ICE-ENCASEMENT (SQUARE/SCENE) 42, HALO/no-alpha 14, PERSP 12, IDENTITY 10, STYLE 9, GROUND 8 | trees sealed in frost tiles/snow-globe orbs; gold-medallion IDENTITY (v054); ice_tower→castles/domes; FRAG slugs |
| beach | GROUND 78, IDENTITY 72, SCENE 17, SQUARE 12, PERSP 9 | driftwood = sea-SCULPTURES (mermaid v098, compass-rose v027, masks); palms baked into seascapes; sand-disc everywhere |
| dense_forest | STYLE 50, GROUND 12, CROP/SCALE 12, IDENTITY 8 | strangler_fig dominates: muddy + ENCHANTED-RECOLOR (cyan gem-pods v254), FACE/TREANT (v023); elm frost-fleck clash |
| desert | PERSP 25, GROUND 22, IDENTITY 10, SCENE 9 | date_palm top-down star-canopies; OASIS-ISLAND (v028), PLANTER-WELL (v031), RUG vignette (v015); arch crystal/A-frame |
| forest | IDENTITY/wearables 44, GROUND 20, CROP 18, STYLE 7 | **oak folder = mis-filed ARMOR** (helmets v123, boots, gloves v088+); MEADOW-PLATE; GHOST-FOG; FRAG slugs |
| grassland | GROUND 50, MAGENTA-BLANK 23, SCENE 17, STYLE 6 | cherry_blossom = 100% blank magenta plates (v032–47); meadow_oak baked fields; willow/winter IDENTITY |
| hills | GROUND 85, FRAG 37, IDENTITY 35, SCENE 22 | rowan on dirt/DAIS bases + waterfalls; cave/den "entrances" = holes-in-terrain w/ STAGED bones (v001) |
| mountains | GROUND 55, FRAG 32, MULTI 20, SQUARE 15, SCENE 15, PERSP 10 | cliff-pines on ROCK-PEDESTALS; cave/cliff/`fantasy_game`/`transparent_background` slugs; DIORAMA (v028); STRATA-TILE |
| mystic | IDENTITY 65, PERSP 12, BLOB 12, STYLE 11, MULTI 11 | aether "pillar" → marble/barber-pole COLUMNS, caged-orb shrines (iso PERSP); ARCHITECTURE-IN-FLORA-FIELD; goo BLOB |
| savanna | GROUND 55, MAGENTA-BLANK 22, STYLE 8, MULTI 6, PERSP 5 | acacia tan GROUND-DISC; baobab/thorny_acacia v016–31 magenta blanks; rocks/figures at base |
| shallow_water | FRAG ~100 | single truncated-slug specimen (`mangrove..._exposed_tangled` v002), CROP |
| steppe | GROUND 82, STYLE 11, SCENE 5 | ORANGE-DISC clay platforms (v064); teal/violet recolors; UPROOTED ROOT-BALL (v061), TRUNK-CAVE (v191) |
| swamp | GROUND 58, IDENTITY 14, SCENE 7, PERSP 4 | WATER-PLATE under mangroves (v053); ENCHANTED-RECOLOR crystals (v246); STONE-RUIN (v094); cypress top-down disc |
| taiga | STYLE 83, CROP 67, IDENTITY/LOLLIPOP 67, SQUARE 17 | spruce muddy/soft/dark + LOLLIPOP silhouette (v043); even the well-shaped v015 too dark; opaque dark plate |
| tropical_forest | SCENE 50, MAGENTA-BLANK 18, GROUND 12, STYLE 6, CROP 5 | coconut_palm ocean/surf scenes; banyan/jungle_tree magenta blanks; FROST/ICY-RECOLOR (v168); `_over_water` FRAG |
| tundra | GROUND 80, STYLE 15 | frost_willow on SNOW-MOUND/drift (v019); dark-navy outlier (v005); rime reads as baked white plate |
| volcanic | GROUND 40, PERSP 30, SCALE 12, STYLE/SCENE 12, IDENTITY 10 | WHOLE-MOUNTAIN cones (v017); top-down crater rings; TERRAIN-PATCH "vent"; VFX-not-object; glow is INTENDED |

## When we regenerate (deferred)

Build a clean **noun-only registry** like `scripts/asset-corpus/registry/f6_trees.json`: drop every FRAG/scene-bound slug, segregate species by object-class so wearables/architecture can never land in a flora bucket, use the skill's four universal clauses + `view:"side"` + per-class bodies + negative prompt, and run the deterministic QA gates (magenta-blank, opaque-to-edge, baked-ground band, edge-crop, scale-vs-median) BEFORE a human curates. See the skill for the exact prompts and gates.
