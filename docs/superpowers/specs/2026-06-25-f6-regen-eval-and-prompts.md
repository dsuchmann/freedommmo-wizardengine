# F6 Tree Regeneration — Eval Rubric + Improved Prompts (derived from the 2026-06-25 human cull)

Source: vision analysis of omitted-vs-kept across 10 biomes (workflow f6-eval-prompt-derivation). The cull omitted 372/1320 variants; this spec captures WHY and how to regenerate cleanly.

The current template confirms the root cause: the existing prompt literally says `"top-down high fantasy pixel art"` and `"large tree sprite seen from above"` — actively instructing the top-down failure mode, with no isolation/no-scenery clauses. Now I have everything I need to synthesize the spec.

# F6 Tree Regeneration Spec

Derived from per-biome curation failure analyses across 11 biomes (~120 omitted variants examined) and the current registry at `scripts/asset-corpus/registry/f6_trees.json`. The existing `prompt_template` is itself a root cause: it says `"top-down ... seen from above with visible trunk and full canopy"` (contradictory and pro-overhead) and carries **zero** isolation/no-scenery clauses. All three fixes below replace that line.

---

## 1. EVAL RUBRIC (for a future `scripts/qa-field.mjs`)

Inputs available per variant: `{ fill, bbox:[x,y,w,h], area, scaleVsMedian, magenta }` over a 192×192 frame. Define helpers a script can compute:
- `right = x + w`, `bottom = y + h`
- `aspect = w / h`
- `fullFrame = (x <= 4 && y <= 4 && right >= 188 && bottom >= 188)`
- `marginOk = (x >= 4 && right <= 188 && y >= 4 && bottom <= 188)`

| Failure mode | Visual signature | Best deterministic proxy + threshold | Catchability | One-line vision check |
|---|---|---|---|---|
| **square_tile** | Art fills 192×192 edge-to-edge as an opaque rectangular swatch / full-bleed scene / contact-sheet, with little-to-no transparent margin; reads as a terrain texture, not an alpha cut-out object. | **DETERMINISTIC (high precision).** Flag if `fullFrame && fill >= 0.85`. Cleanly fired on cherry/v002 (0.876), pine/v012 (0.951), lava_palm/v018 (0.975), saguaro/v006 (full-frame), and every full-frame arctic/tundra snowfield; **zero** kept variants reach it (kept ceilings ~0.74–0.82 with inset bbox). Add a **multi-subject sheet** sub-rule: `fullFrame && fill < 0.45` → contact sheet of several small trees (driftwood/v018 = 0.369). Never use `fullFrame` alone — it also catches legitimately tall edge-reaching trees, so it MUST be ANDed with `fill`. | **Catchable.** This is the one mode a script can gate on with high precision (low recall is fine — vision sweeps the rest). | "Does the art bleed to all four frame edges with no transparent margin, or pack multiple trees into one tile?" |
| **baked_landscape** | The biome is painted INTO the tile: a ground band / mound / oval pedestal disc / dune / snowfield / lava field under and around the trunk, often studded with rocks, debris, flowers, shells, or props (a cottage, a stream). The tree may be fine; the scenery is the disqualifier. | **PARTIAL — positive-only signals, low recall.** (a) **Full-width base band:** `x <= 4 && right >= 188 && bottom >= 188` → painted ground floor spans the whole tile (hills 11/11 omits, zero false positives; lava `w >= 185`; charred_trunk/lava_palm full-width). (b) **Base-heavier-than-canopy:** when available, `bottomRowWidth / midTrunkWidth > 1` (ground fans wider than the trunk) flags the pedestal disc. **Plain `fill` does NOT discriminate** (omit ~0.58–0.70 overlaps keep ~0.53–0.60). The dominant sub-case — a tolerated-size base **mound that stays inboard** (no edge touch, normal bbox) — is invisible to all current fields. | **Mostly vision.** Loud full-frame/full-width cases catch deterministically; the common inboard ground-disc needs vision (or a future base-row non-tree-color pixel scan). | "Is there any painted ground, soil, sand, snow, water, rock, props, or scenery — beyond a tiny root nub directly under the trunk — instead of clean transparency?" |
| **top_down_angle** | Canopy seen from directly overhead ("high-noon"): a round/radial disc, snowflake, mandala, or starburst of foliage/branches with **no visible trunk** and **no vertical silhouette/height**. The sprite reads as a floor decal, not a standing tree. | **VISION-ONLY for the general case** — no reliable metadata tell. Overhead and side-profile trees overlap on `fill`, `bbox`, `area`, `scaleVsMedian` and `magenta` (the magenta field is uniformly 0; it keys pure-magenta error fills, not pink flowers). Two **weak, biome-local** hints, usable only as review-rank nudges, never gates: **savanna acacia** `fill >= 0.69` + near-square `aspect` 0.98–1.08 (kept side-views top out at 0.633); **tundra krummholz_pine** within-species outlier `fill >= 0.85 && scaleVsMedian >= 1.25`. Baobab/conifer/crystal/palm overhead = no proxy at all. | **Needs a vision pass.** This is the single biggest reason a deterministic-only QA gate is insufficient — it is the dominant failure in savanna, taiga, tundra, grassland. | "Do you see a trunk rising from the bottom and a side silhouette with height — or is it a flat radial/round canopy viewed from straight above?" |
| *(other)* | Undersized runt floating in a big empty frame; near-duplicate of a kept variant; forked/multi-trunk specimen. | Runt: `scaleVsMedian <= 0.6`. Multi-trunk / near-dup: **vision-only** (needs connected-component or embedding similarity). | Runt = weak deterministic; dup/fork = vision. | "One single well-sized tree, or a runt / a duplicate / multiple trunks?" |

**Recommended `qa-field.mjs` shape:** (1) deterministic pre-filter auto-rejects `square_tile` (incl. multi-subject sheets) and `runt`, and surfaces `baked_landscape` candidates via the full-width-base band; (2) **everything that survives goes to a vision pass**, because `top_down_angle` and inboard ground-discs are not separable by metadata. Do NOT ship a metadata-only gate — it would pass the dominant overhead failure untouched.

---

## 2. IMPROVED PIXELLAB PROMPTS (F6 tree regeneration)

Prompts are kept clean and positively-phrased with a single grouped negation clause — over-stuffed ALL-CAPS negation walls can trip PixelLab's content filter. The template replaces the registry's current `prompt_template` line wholesale.

### Base template

```
high fantasy pixel art of a single {desc}, Final Fantasy aesthetic,
hyper-detailed, rich saturated colors, detailed shading,
one isolated specimen tree on a fully transparent background.
Three-quarter side view (camera about 30 degrees above the horizon)
so the trunk rises from the bottom-center and the tree's full height
and side silhouette are clearly visible from base to crown.
Render only the tree itself with clear transparent margin on all four sides.
No ground, soil, grass, sand, snow, rocks, water, flowers, props, or scenery;
not a top-down overhead view; not a flat round or radial canopy disc;
not a square texture tile; not multiple trees.
```

Placeholders: `{desc}` from the archetype (unchanged species descriptions); optionally append a per-biome `{tuning}` sentence below.

Key deltas from the current registry template:
- `"top-down ... seen from above"` → **`three-quarter side view ... trunk and full height visible`** (defeats top_down_angle).
- add **`single ... isolated specimen ... transparent ... margin on all four sides`** (defeats square_tile).
- add the **grouped no-scenery clause** (defeats baked_landscape).
- drop `"large tree sprite"` framing that encouraged frame-filling.

### Per-biome / species tuning notes

Append the matching sentence to the base template; emphasize the biome's dominant failure.

- **hills (oak, hawthorn)** — dominant *baked_landscape*. Add: *"The 'hills' setting is context only and must not appear — no rolling hillside, grass field, path, cottage, stream, or wildflowers; render hawthorn blossoms/berries on the tree only, never on the ground. Fill the canopy normally, do not undersize to a small floating runt."*
- **beach (palm_tree, driftwood_tree)** — dominant *baked_landscape*. Add: *"No sand, beach, shoreline, ocean, surf, waves, dunes, shells, or starfish. For palm_tree, show the entire curving trunk from root flare to crown in profile (tall, leaning), never the flat radial fan of fronds from above. Exactly one tree — no 2×2 grids."*
- **desert (saguaro_cactus, date_palm, joshua_tree)** — dominant *baked_landscape* (+ worst square_tile). Add: *"Desert floor transparent right up to the trunk — no sand mound, oval base patch, or circular pedestal disc, no pebbles, dead twigs, or surrounding plants. Saguaro: standing ribbed column with arms in profile, never crown-discs seen from above. One subject, no multi-trunk groves, no contact sheets."*
- **savanna (acacia, baobab)** — dominant *top_down_angle*. Add: *"Never a top-down view or a symmetric radial 'tree-of-life' mandala. Acacia: slim often-leaning trunk under a wide flat-topped umbrella crown — sky/transparency must show under the umbrella between trunk and canopy. Baobab: massive swollen bottle-trunk wider than its sparse crown, trunk at least as tall as the canopy."*
- **taiga (spruce, pine, larch, birch)** — dominant *top_down_angle*. Add: *"Conifers: classic upright triangular Christmas-tree cone with a visible trunk and root flare at the bottom, never a round or snowflake canopy disc with the trunk as a central dot. Birch: white papery trunk visible rising through the foliage."*
- **arctic (ice_pine, frozen_birch)** — dominant *baked_landscape*. Add: *"No snow drifts, ice blocks, ice-crystal rubble, snowfield, or ground/shadow disc. Frost, rime, snow load, and icicles belong ON the branches and trunk, not as a scene around it. ice_pine is an upright conifer with a clear vertical trunk and pointed top, never a flat radial snowflake from above."*
- **tundra (krummholz_pine, dwarf_willow)** — dominant *top_down_angle* (prostrate species). Add: *"No snow disc, ice patch, rock slab, stones, lichen, or flowers. Even for the prostrate krummholz mat / wind-pinned dwarf species, show the low gnarled trunk and branch structure in profile from the side, leaning with the wind — never a top-down mat or wheel of branches."*
- **volcanic (charred_trunk, lava_palm)** — dominant *baked_landscape* (+ heavy square_tile). Add: *"No basalt field, cracked terrain, lava flows/pools, embers, sky, or horizon. The molten theme lives only ON the tree — glowing cracks in the bark, charred branches, embers on the trunk — at most a small tight scorched pad under the base no wider than the trunk. One trunk and one crown, no forked double-palms."*
- **mystic (glowing_ancient, crystal_tree)** — dominant *baked_landscape* (+ crystal *top_down_angle*). Add: *"No glade, mist, background haze, ground shadow ring, sparkle motes, or circular/oval scene disc behind the tree — empty transparent pixels right up to the trunk, branches, and roots. crystal_tree: an upright crystalline tree with a visible twisting trunk and a crown of crystal blossoms, never a top-down kaleidoscopic burst or snowflake."*
- **grassland (oak, apple, cherry, willow)** — dominant *top_down_angle*. Add: *"Single trunk rising from bottom-center with visible roots, canopy stacked above for clear height — never a circular canopy with the trunk as a star-burst of spokes at the center. Critical for apple and cherry: keep their trunks tall and visible so the round blossom canopy does not collapse into a top-down pom-pom."*
- **forest / dense_forest / tropical_forest / swamp / mountains** (not separately audited — apply base template only): oak, birch, beech, apple, ancient_oak, yew, hollow_elm, pine, kapok, banana_palm, mangrove, willow, bald_cypress. The base template's side-view + isolation + no-scenery clauses cover them; banana_palm/kapok/mangrove especially benefit from the explicit "trunk + full height in profile" wording.

---

## 3. PER-SPECIES REGEN ANNOTATIONS

| Biome / species | Dominant failure observed | Single prompt emphasis to add |
|---|---|---|
| hills / field_oak | baked_landscape | "No hillside, grass field, path, or props — clean transparency under the trunk." |
| hills / hawthorn | baked_landscape | "Blossoms/berries on the tree only; no cottage, stream, or wildflowers in the tile." |
| beach / palm_tree | baked_landscape (+ top_down) | "Full curving trunk in side profile; no sand wedge or ocean; never the overhead frond-fan." |
| beach / driftwood_tree | baked_landscape (+ square_tile/sheet) | "One isolated gnarled stump; no painted beach; never a 2×2 grid." |
| desert / saguaro_cactus | baked_landscape / square_tile | "Standing ribbed column in profile; no sand disc; one specimen, no contact sheet." |
| desert / date_palm | baked_landscape | "Transparent right up to the bole; no sand mound or pedestal." |
| desert / joshua_tree | baked_landscape (+ full-frame) | "Gnarled trunk in profile on transparency; no dune vista, leave margins." |
| savanna / acacia | top_down_angle | "Flat-topped umbrella on a slim leaning trunk; sky visible under the canopy." |
| savanna / baobab | top_down_angle | "Swollen bottle-trunk in side profile, taller than its crown; not a radial mandala." |
| taiga / spruce | top_down_angle (+ dedup) | "Upright triangular cone with trunk + root flare; not a round disc from above." |
| taiga / pine | top_down_angle (+ one square_tile) | "Conical conifer in profile; never a snowflake; never a full-frame texture swatch." |
| taiga / larch | top_down_angle | "Upright feathery conifer with visible trunk; no overhead wheel; no corner soil." |
| taiga / birch | (kept good) | "White trunk visible rising through the crown; side profile." |
| arctic / ice_pine | baked_landscape (+ top_down) | "Upright conifer, trunk + pointed top; frost ON branches; no snowfield or radial snowflake." |
| arctic / frozen_birch | baked_landscape / square_tile | "Rimed branches on the tree; no ice-crystal bed or edge-to-edge snowfield; keep margins." |
| tundra / krummholz_pine | top_down_angle | "Low gnarled bonsai-like pine leaning in profile; not an overhead wheel; thin/no base." |
| tundra / dwarf_willow | top_down_angle (+ baked) | "Show the low trunk + branches in side profile, never a flat top-down mat; no rock/snow disc." |
| volcanic / charred_trunk | baked_landscape / square_tile | "Charred tree in profile, embers on the bark; no lava field; tight scorched pad only." |
| volcanic / lava_palm | baked_landscape / square_tile | "One palm in profile; no lava-pool terrain tile; single trunk, no forked double-palm." |
| mystic / glowing_ancient | baked_landscape | "Braided trunk + roots, taller than wide; no glowing glade disc or shadow ring behind it." |
| mystic / crystal_tree | top_down_angle | "Upright crystalline tree with a twisting trunk; never a top-down kaleidoscopic snowflake." |
| grassland / oak | top_down_angle (+ baked) | "Trunk + roots at bottom-center, canopy stacked above; no spoke-burst, no soil mound." |
| grassland / apple | top_down_angle | "Keep the trunk tall and visible so the round canopy isn't a top-down pom-pom." |
| grassland / cherry | top_down_angle / square_tile | "Blossom canopy above a visible trunk; never a full-bleed blossom tile." |
| grassland / willow | (kept; high-angle tolerated) | "Drooping branches from a visible trunk; keep a side-profile read, not a flat overhead drape." |

---

**Source files:** registry to patch = `C:/Users/daves/AppData/Roaming/wizardgenie/projects/default/.claude/worktrees/field-curation/scripts/asset-corpus/registry/f6_trees.json` (replace the `prompt_template` value on line 11 with the Section 2 base template; species `desc` strings and `states` are unchanged). Future QA gate = `scripts/qa-field.mjs` (Section 1): deterministic `square_tile`/`runt` reject + `baked_landscape` full-width-base surface, then a mandatory vision pass for `top_down_angle` and inboard ground-discs.