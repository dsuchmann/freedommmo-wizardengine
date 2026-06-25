---
name: building-dressing
description: Use when adding or refining ANY building DRESSING field (the D-stack D0–D7 that decorates clean buildings — weathering, damage, growth/vines, wall attachments, structural, ground landscaping/props, identity, plus arbitrary new wall layers like murals/mosaics/banners). Encodes the proven field lifecycle, the three render mechanisms, the socket-as-contract model, the auto-measure-the-art trick, and the binding GL/no-mock/pilot-before-burst rules. SIBLING of building-tile-pipeline (which makes the walls/roofs themselves); this skill decorates them. PixelLab per-field generation is TBD until the first D3 prop lands.
---

# Building Dressing Pipeline (the D-stack)

A **second procedural layer over the clean building generator** — the building analog of landscape decoration
fields F0–F8. Organized as 8 fields **D0 weathering → D7 identity**, each a layer that composes over the walls
the `building-tile-pipeline` skill produced. This skill is for **adding/refining ONE dressing field** (or an
arbitrary new wall/ground layer you imagine). It is NOT for generating walls/roofs — that's `building-tile-pipeline`.

> Status (2026-06-25): **D0 + D3 SHIPPED.** D0 = procedural weathering (mechanism A, asset-free). D3 =
> wall-attachments (mechanism B, PixelLab) landed end-to-end across **all 12 tile-corpus biomes** (13 hero
> props × biome, identity-aware over-door emblems, procedural + generated anims). The PixelLab per-field
> GENERATION pipeline (§7) is now PROVEN and reusable — see **"Scaling a field" (§0)** for the recipe and
> field-type decision. NEXT capability: D1 Damage (a CODE field — mechanism A, no PixelLab).

## Rule -1 — autonomy contract (run the field to DONE without check-ins)
When asked to build a dressing field/biome autonomously, do NOT pause for approval between steps. Drive the
lifecycle end-to-end and do not declare a field DONE until it is COMPLETE end-to-end:
- **Variants** — generate the manifest's full count per object (5–8), keeping 4–6 candidates per generation
  pack (not 2); the renderer picks among them. Rich variation is the goal, not a pilot exception.
- **Every object placed OR explicitly dropped** — wire each object to its socket (incl. strung pieces via
  spline-tiling, brackets via composition, jamb props via their socket); if an object is redundant with the
  tile or wrong for its spot, DROP it and note why. No silent orphans.
- **Animations played** — download every anim's frames and play them (loop / trigger). No un-played anims.
- **Re-fire failures** — a failed generation (e.g. v3 anim OOM on a 128px object) gets retried (smaller frame
  count / re-queue) until it lands or is explicitly dropped.
- **States** — generate per the manifest; if a state's driver is honestly absent (age/damage have no sim
  source yet), generate the asset but leave it un-triggered and SAY so (no-mock) — don't fake the driver.
Fire generation, review each pack and KEEP the best candidates by the brief (re-roll an object ONLY if every
candidate fails), download → post-process → record ids in `_pixellab_ids.json`, wire, and verify in-game.
Make sensible defaults and note them. Pilot-before-burst still holds. STOP only for a real blocker: the cost
ceiling is hit (watch `get_balance`), a tool fails repeatedly, or a decision has no reasonable default. Report
ONCE at the end with what's testable AND what (if anything) hit the ceiling.

## §0 — Scaling a field (the recipe — read FIRST when asked to build/scale any D-field)
Every D-field is one of **two types**. Decide which BEFORE doing anything — it determines whether you touch
PixelLab at all:

**TYPE 1 — CODE field (procedural, asset-free).** D0 weathering, **D1 damage**, D7 identity-composer. The whole
field is a `src/render/dressing/<field>.js` module that paints world-locked procedural noise/decals (mechanism
A) or fires other fields (mechanism D). NO PixelLab, NO manifest-of-prompts, NO download/tracker. Clone the
shape of `d0-weathering.js`: a pure coverage/pattern function + a `drawXxxPass()` called from
`building-occluder.js`, a `renderOn('<layer>')` gate, a Dev HUD tuner, a pure unit test. A code field is ~a day;
its only "honest-absence" question is *what scalar drives it* (and if the sim source is absent, render the
absent semantics — no-mock — don't fake a driver). **D1 is this type.**

**TYPE 2 — GENERATED field (PixelLab props/decals).** D3 wall-attachments (done), D2 vines, D4 structural,
D5/D6 ground. These ride the **reusable generation pipeline** proven by D3 — DON'T reinvent it per field, drive
these field-agnostic parts:
1. **Prompt generator** `scripts/<field>-prompts.mjs` — deterministic: `BIOMES` skin profiles × `PROPS`
   templates with always-keep clauses (transparent-bg / sidescroller-view / pixel / no-text) → JSON
   `{biome:{prop:{px,tag,prompt}}}`. Pattern: `scripts/d3-prompts.mjs`.
2. **Fire + in-flight tracker** — `create_1_direction_object` per row (each = **20 generations** flat, any
   candidate count); record every returned group id IMMEDIATELY into `scripts/_<field>_jobs.json`
   (biome→prop→{group,px}) — NEVER hold ids in memory/chat (the volcanic-tracking-bug lesson). Fire in batches
   that respect the rate limit (**≤~10 concurrent jobs**, and check whether a second agent is also generating).
3. **Download** — `scripts/d3-download.mjs` is field-agnostic: reads `_<field>_jobs.json`, curls the SPREAD of
   candidate frames straight off the CDN bucket (no select/promote API needed) → `dressing/<biome>/<prop>/
   base__vN.png`, validates the PNG signature, idempotent (skips existing). Reuse it; only the jobs-file path
   varies.
4. **Believable-placement review** — `scripts/dressing-review.mjs` composites ONE candidate onto the real
   feature (door/window/wall) BEFORE bursting (see rule #9). Fix the construction PROMPT, not just placement.
5. **Re-fire failures (MANDATORY).** PixelLab stalls **~30–50%** of jobs ("Generation stalled and was
   automatically failed"). After downloading, reconcile downloaded-vs-expected, re-fire the GAP with the
   SAME corrected prompt, overwrite the failed group ids in the tracker, and re-poll. A field is NOT done
   while any prop is short its art. (Background poll: re-run the downloader every ~45s until count==target;
   128px jobs are slow.)
6. **Wire + flag + tune + test** — renderer module reads `_pixellab_ids.json` (disk-authoritative, per biome),
   picks among variants seeded, draws in the `building-occluder.js` before-roof pass at baseline depth, gated by
   `renderOn('<layer>')`, tuned via a Dev HUD tab, with a pure geometry/coverage test.

**Per-field deliverables checklist** (both types unless noted): design-manifest part + (Type-2) generation
manifest · (Type-2) prompt generator + `_jobs.json` tracker + per-biome `_pixellab_ids.json` · renderer module ·
`building-occluder.js` wire (before-roof) · `renderOn('<layer>')` flag · Dev HUD tuner · pure test · in-game
verify (day-night frozen at noon). **Cost math (Type-2):** props × biomes × 20 gens for bases, + states + anims;
budget against `get_balance` before a burst.

## The field stack
| Field | Name | Mechanism | Notes |
|---|---|---|---|
| D0 | Weathering | A · decal | **SHIPPED** — procedural grime/discolouration. Asset-free. |
| D1 | Damage | A · decal | cracks/rot/peeling — cheap once A is proven (same machinery as D0). |
| D2 | Surface growth | A · decal/spline | moss, lichen, **climbing vines**. |
| **D3** | **Wall attachments** | **B · socket prop** | signs/brackets/awnings/lanterns/planters. FIRST PixelLab field — **placement proven, generation next**. |
| D4 | Structural | B · socket prop (own depth) | balconies/porches/columns. |
| D5 | Ground landscaping | C · perimeter scatter | shrubs/hedges/beds. |
| D6 | Ground props | C · perimeter scatter | barrels/crates/benches/wells. |
| D7 | Identity kit | D · meta-composer | reads `building.specialization.id`, fires curated D0–D6. |
| +  | **New layers** | usually A or B | murals/mosaics/frescoes (flat wall art = decal A on a wall-panel surface), banners, graffiti, ivy… add freely. |

**Build order = prove distinct CAPABILITIES, not field numbers:** D0 → D3 → D2 → D5/D6 → D7. Front-load the
riskiest new machinery (D3 sockets + first sprites); fields that reuse a proven mechanism (D1, D2, murals…)
fall out cheaply afterward.

## The three render mechanisms (the substrate every field rides)
- **A — decal into the wall bitmap.** Painted into the building silhouette ctx during `drawBuildingTextured()`,
  so it inherits GL lighting/CRT for free. Precedent: `src/render/dressing/d0-weathering.js` →
  `drawWeatheringPass()` in `building-occluder.js`. World-locked procedural noise (see d0 `tileFbm` + pattern fills).
- **B — socket-anchored prop.** Rigid props paint into the silhouette at the building's flat baseline depth;
  flora-sorted props pack into the F2 `SPRITE_FLOATS`/`ANIM_SPRITE_FLOATS` pool with `pivotY` (the `rigid` flag).
  Placement via the socket index (below).
- **C — perimeter ground scatter.** A new F7-style field in `src/world/decoration-claims.js`, gated on
  `architectureClaimAt()`, seeded per-tile.

Cross-cutting infra (built ONCE, amortized across every field): GL routing (`glc.drawSceneOverlayBitmap`),
the socket+surface index, the coverage/noise machinery, the claim system, the **Dev HUD tab** pattern, the manifest.

## The field lifecycle — run this for each new field/layer
1. **DEFINE** in the manifest. `docs/superpowers/specs/2026-06-23-dressing-manifest.json` (per-field parts in
   `dressing-manifest-parts/<field>.json`; reassemble via `scripts/merge-dressing-manifest.mjs`). Declare:
   category → object → {placement plane+anchor+method, application.when gate, coverage|socket, affordances,
   scale-to-fit, biomeSkins, source: procedural|pixellab|hybrid}. Browse it: `tools/dressing-manifest-browser.html`.
2. **PROVE PLACEMENT with an in-GL overlay FIRST (de-risk before any art).** Emit the field's anchors from the
   SAME geometry the renderer draws, project with the SAME storey-stack, and highlight them via
   `drawSceneOverlayBitmap`. Precedent: `socket-index.js` (`buildSockets`/`projectSocket`) + `socket-overlay.js`
   (toggle `window._socketOverlay.enabled`, key colour in the HUD Overlays tab). Verify the dots land on the
   feature before spending PixelLab credits.
3. **PILOT one category** grassland-first (or the simplest tile-corpus biome). Generate/author a SINGLE object,
   fit it to its anchor, render it via the field's mechanism, eyeball it in-game.
4. **VERIFY in-GL** — it must route through the GL present pass (never a 2D top-pass). A/B with day-night frozen
   at noon (`window._lighting.paused=true; .time=0.5`).
5. **BURST** the rest of the field's objects only after the pilot proves the placement + render path.
6. **TUNE via a Dev HUD tab.** Register the field's controls: `registerDevTool({id,label,mount})` in
   `src/dev/dev-hud.js` (key `` ` ``). Live knobs mutate a `window._<field>` config the renderer reads each frame
   (no cache to clear — the building layer re-renders every frame). Add a "copy config" button so tuned values
   bake back into the field's `DEFAULTS`. Precedent: `weathering-tuner.js`.

## Socket = a CONTRACT, not the prop
A socket is an **anchor point + orientation** (e.g. "window sill = horizontal centre of the opening, at the
sill line; wall faces south; gravity down"). The final prop position = **socket point + the prop's own anchor
+ a per-prop fine-offset**. So:
- Define each socket KIND precisely and consistently (every prop is authored against that definition).
- Sockets are emitted in building-LOCAL terms `{kind, face, floor, runY, cxLocal, v}` and projected by the
  storey-stack (`runGroundY − (floor+v)·wH`) so they register on the rendered wall. Corners are full-height
  (one per storey); window sills stack per storey; eave rides the top storey.
- New wall layer placement is cheap because it just declares "I attach to socket/surface type X" — so grow the
  socket/surface VOCABULARY (e.g. add `wall_panel`/`between_windows` for murals) and future layers ride it free.

## Placement discipline (self-correction rules — learned from the grassland D3 pilot, 2026-06-24)
Generating a good sprite is half the job; placing it so it makes SENSE in the world is the other half. Check
EVERY field against these, in-game, and correct:
1. **Identity-aware — props that carry MEANING must match the building.** A trade emblem (tankard, bread,
   anvil, guild banner) communicates what a building IS, so place it ONLY where it's TRUE — drive the choice
   off `building.footprint.typeId` / `.category` (tavern→tankard, bakery→bread, blacksmith→anvil, civic/
   military/religious→banner). NEVER put a tankard on a farm. Buildings whose identity has no matching emblem
   get a NON-claiming prop (a generic shade awning on a shop) or NOTHING. This is the D3 slice of D7 identity;
   the no-mock rule applies to MEANING, not just art. (`overdoorFor()` in d3-props.js is the pattern.)
2. **Edge-aware — never let a prop float off the wall.** Clamp every prop to the building footprint
   (`boundingBox` / the wall run); skip it if the wall is narrower than the prop. Window/door props near a
   corner must pull inward, not hang in the air.
3. **Pair-mirrored — symmetric pairs face inward.** The LEFT member of a pair (left lantern, left shutter)
   must be flipped on X so the two mirror each other / point the right way. Tag the left socket (`mirror:true`)
   and `ctx.scale(-1,1)` it. Whenever you place a thing in pairs, consider rotation/flip.
4. **Shape- & space-aware — seat the prop ON its feature.** A prop sits where it physically belongs relative
   to the thing it attaches to and the shape of both: a flower box hangs FROM the window sill (anchor its TOP
   at the sill, body/blooms below — not floating mid-wall, not down on the foundation); a wall planter needs a
   visible bracket or a blank-wall panel; a shutter flanks the window at window height. Look at the rendered
   result and fix the anchor/size, don't guess once and move on.
5. **Tile-matched & proportioned.** Use `style_images` (above) so tile-adjacent props match the wall art, and
   size each prop to the feature it attaches to (a shutter ~ the window height). Mismatched style or scale
   reads as pasted-on.
6. **Review the pilot in-game and iterate.** After wiring a field, WALK the pilot biome and correct per the
   above before bursting other biomes — placement bugs that look fine in the abstract are obvious on a wall.
7. **Don't duplicate what the TILE already depicts.** Before adding a prop, check the wall/window tile art —
   if the window already has shutters baked in, a shutter PROP is redundant and clashes. Drop that concept and
   pick one the tile doesn't already provide. (Grassland: shutters dropped from D3 for exactly this reason.)
8. **Match the OBJECT to its placement.** A round terracotta pot reads as a GROUND/stoop pot — it does not
   belong floating on a window sill; a sill wants a rectangular window BOX. Generate/choose the form that fits
   where it goes.
9. **BELIEVABLE-PLACEMENT REVIEW — a prop is NOT done at generation; it's done when it reads right IN SITU
   (user 2026-06-25, non-negotiable gate).** A sprite that looks fine alone on a transparent bg can be
   unplaceable on the building — the classic miss: an awning whose back/side DRAPE covers the doorway, a
   "potted plant" whose whole sprite swings, a festoon strung across an opening. So BEFORE bursting a prop
   across biomes: composite ONE candidate onto the actual thing it attaches to (a door / window / wall span)
   and judge it in context — use `scripts/dressing-review.mjs <propPng> <socketV> <sizeTiles> [anchor]` (mocks
   the prop over a real grassland door+wall). If it doesn't read believably, fix the **construction PROMPT**,
   not just the placement: an awning must be a PROJECTING canopy with an EMPTY lower half (door stays open),
   NOT a tent; the prop's own MOTION must match its mount (hanging sign → pendulum sway OK; bolted awning/sill
   box → rigid, the fabric/blooms ripple via an internal generated anim, never a whole-sprite rotation). Reason
   about the aesthetic context up front — what would this object look like correctly built FOR this spot —
   then generate to that, review, and only then burst.

## Wire EVERYTHING you generate — no orphan assets (non-negotiable workflow rule)
Every asset you generate MUST be downloaded to disk AND wired into the renderer in the same campaign — bases,
variants, STATES, and ANIMATIONS. A generated-but-unplaced object or an un-played animation is wasted spend and
an invisible result. Specifically:
- **Variants**: generate the manifest's full variant count (5–8), download every `base__vN`, and the renderer
  must PICK among them per placement (seeded) — never draw only `base__v0`. "Rich variation" is the default,
  not the pilot exception.
- **Animations**: download every anim's frames (`anim/<kind>/frame_N.png`) and PLAY them — continuous loops
  (flicker/sway) cycle by time with a per-placement phase offset; triggered anims (shutter open / knocker) play
  on proximity/interact. `d3-props.js` `loopFrames()` is the loop pattern.
- **Per-object completeness**: when a prop animates AND varies, you need an anim per variant; until then, choose
  per object which matters more (motion vs variety) and note it. Track wired/unwired in `_pixellab_ids.json`.
- **Draw order**: props share the building's flat baseline depth, so intra-prop order is the bitmap paint order
  (`z`): window/sill behind → signs → door furniture → lanterns on top. Player-vs-prop is the building depth
  pass (player sorts in front when south of the baseline) — don't conflate the two.

## Auto-measure the art (don't guess anchors)
Generated tiles encode where the feature actually is — measure it, don't hardcode a fraction. The window tile is
a `create_object_state` OF the plain wall, so **diff the two** → the changed pixels ARE the opening; its dense
band's bottom-centre is the true sill. Precedent: `src/render/dressing/aperture-measure.js` (strong-diff row/col
histograms + sanity guards, because generated tiles aren't pixel-consistent — a polluted measurement falls back
to a sensible default). Generalize this for any art-derived anchor.

## Contextual animations (tracked per object, biome-invariant)
Animation is a property of the prop's PHYSICAL condition, NOT its category, and does NOT change per biome
(a sign sways everywhere; foliage sways everywhere) — only magical skins may ADD emissive. Track the anim
SET per object in the generation manifest's `A[..]` column; regenerate the frames per biome from that
biome's art via `animate_object`. The assignment:
- **wind_sway** — suspended/hanging cloth + strung pieces, AND any prop carrying living `content` (season)
  foliage (flower boxes, planters, wreaths: the blooms sway, the vessel/mount stays planted);
- **flicker_glow** — light sources: TWO parts → flame-flicker frames + a separate GL emissive light (never a 2D overlay);
- **open_close** — constrained hinge (shutters); **momentary** — one-shot (knocker); **static** — rigid mounts (no anim).
Pilot-before-burst applies to anims too: prove ONE anim's playback wiring before generating the field's full anim set.

## Binding rules (non-negotiable)
- **Everything through GL.** Every dressing pixel in the world routes through `drawSceneOverlayBitmap` / the
  silhouette bake → inherits lighting/day-night/CRT. NEVER a main-thread 2D overlay for world content. (2D DOM is
  only for true HUD/UI like the Dev HUD panel.) See [[feedback_everything_through_gl]] / CLAUDE.md.
- **No-mock.** A field may be ABSENT but never FAKE. Each field declares its honest-absence (e.g. `age`/`wetness`
  have no sim source yet → render the absent semantics, don't hardcode a fake driver).
- **Pilot-before-burst.** Prove one category in-game before generating the field's full object set.
- **Tracker, not memory.** Build a disk-authoritative field tracker before calling a field "done" (mirror the
  buildings tracker `scripts/desert-pilot-status.mjs`). Queued ≠ done until PNGs are on disk + QA-clean.

## Where things live
- **Spec:** `docs/superpowers/specs/2026-06-23-building-dressing-system-design.md` (model, mechanisms, planes, scale).
- **Living PLAN/tracker:** `docs/superpowers/specs/2026-06-23-dressing-and-grounds-PLAN.md` (build order, seams, status).
- **Resume/handoff:** `docs/superpowers/specs/2026-06-24-dressing-resume-transition.md`.
- **Manifest:** `docs/superpowers/specs/2026-06-23-dressing-manifest.json` (+ parts + `merge-dressing-manifest.mjs`);
  visual browser `tools/dressing-manifest-browser.html`.
- **Code:** `src/render/dressing/` — `d0-weathering.js` (mechanism A reference), `socket-index.js` +
  `socket-overlay.js` (B placement), `aperture-measure.js` (art measurement). Gates: `building-render-flags.js`
  (`renderOn(layer)`). Live wall path: `building-occluder.js drawBuildingTextured()`, `building-tiles.js`
  (`southRuns`, `windowTilePaths`). GL: `gl-compositor.js drawSceneOverlayBitmap`, call sites in `canvas-renderer.js`.
- **Dev HUD:** `src/dev/dev-hud.js` (`registerDevTool`, key `` ` ``), `dev-overlays-tab.js` (flags+legend), `weathering-tuner.js`.
- **Tests:** `test/d0-weathering.test.mjs`, `test/socket-index.test.mjs` (keep the pure geometry/coverage testable).

## §7 — PixelLab per-field GENERATION
**Two manifests per field:** the DESIGN manifest (`dressing-manifest-parts/<field>.json` — what each object is:
placement, states, anims, affordances, fit-to-socket `scale`, per-biome `biomeSkins`) is the WHAT; a
GENERATION manifest adds the HOW — the PixelLab op per row, the prompt token framework + per-object seed,
and the disk layout/tracker. First one authored: **`docs/superpowers/specs/2026-06-24-d3-generation-manifest.md`**
(use it as the template for every other field/layer's generation manifest).

**STYLE REFERENCE for tile-adjacent props (learned 2026-06-24):** props that sit directly ON the tile-corpus
walls — ESPECIALLY window props (shutters, sills, flower boxes) and anything framing an aperture — must match
the wall/window tile's art style and proportion, or they read as pasted-on. Pass the biome's wall or window
tile (downscaled ≤256px) as `style_images` to `create_1_direction_object` so the prop inherits the tile palette
+ linework. NOTE: with `style_images` you CANNOT also pass `size` — the largest style image sets the output
size (so downscale the reference to the size you want, e.g. 96px). Also size the prompt to the feature ("a TALL
shutter the full height of the window"), and tune the render scale to the socket. Free props (ground scatter)
don't need this; aperture-framing props do.

**OBJECT-vs-TILE rule for dressing (settled): props are OBJECTS, not tiles.** A wall attachment is a discrete
sprite → `create_1_direction_object` (base, sidescroller, size = `scale.nativePx`) + `create_object_state` per
state + `animate_object` per anim. NEVER `create_tiles_pro`/`create_topdown_tileset` (those are for the
seamless wall/roof SURFACES the building-tile-pipeline skill makes). Spline pieces (strung lights, bunting,
garland) generate ONE node object that code tiles along the socket-to-socket spline. Disk layout:
`assets/pixelab/buildings/dressing/<biome>/<object_id>/{base__v0, state__<s>__v0, anim/<a>/frame_NNN}.png`
+ `_pixellab_ids.json`.

**PROVEN by the D3 all-biomes landing (2026-06-25) — this is what actually works:**
- **Fire → tracker → download (no promote API).** `create_1_direction_object` (sidescroller, size=nativePx;
  cost 20 gens flat); record group ids into `scripts/_<field>_jobs.json` at once; pull candidate frames
  DIRECTLY off the CDN bucket via `scripts/d3-download.mjs` (SPREAD per px → `base__vN.png`, PNG-signature
  validated, idempotent). `select_object_frames`/`dismiss_review` are NOT needed — curl the candidates.
- **Re-fire failures is part of the loop, not an exception** (~30–50% stall rate) — reconcile + re-fire the gap.
- **QA gate = the believable-placement review** (`scripts/dressing-review.mjs`, rule #9) — composite onto the
  real feature; for props the in-situ read is the gate (no separate `qa-tiles`/`qa-frames` analog needed).
- **WIRING (D3 pattern, `d3-props.js`):** rigid props paint into the silhouette in `building-occluder.js`'s
  **before-roof** pass (`drawD3Props(...,'all')`) at baseline depth — drawing props OVER the roof is a
  draw-order bug (user 2026-06-25). Variants picked by a seeded `rand2(b.x,b.y,...)`; pairs share a seed via
  `pairX/pairY` so the two members match + the left mirrors. Strung pieces (lights/bunting/garland) tile ONE
  node object along the widest CLEAR wall span (terminate at door/window edges, hang mid-wall below the eave).
- **Anims, two ways:** generated (`animate_object` frames, `loopFrames()`) OR **procedural zero-gen** — a sway
  is a code transform (top-pivot pendulum for hanging signs/banners; the prop body stays rigid), a flicker is an
  additive `'lighter'` pulse. Rigid mounts (awning, sill box) get NO whole-sprite anim — only their fabric/
  blooms should ripple (internal generated anim; TODO where not yet generated). Match MOTION to MOUNT (rule #9).
- **Identity-aware over-door emblems:** `overdoorFor(b)` maps `building.footprint.typeId/category` → the right
  emblem (tavern→trade-sign, bakery→board-sign, smith/jeweler→wrought-iron, civic/military→banner, shop→awning,
  craft/commercial catch-all→sign); phase-gate identity vs ambient props so meaning never floats on the wrong
  building. This is the D3 slice of D7.
- **Disk tracker:** per-biome `assets/.../dressing/<biome>/_pixellab_ids.json` is authoritative (written by the
  downloader). Still useful to add a `scripts/dressing-status.mjs` summary (mirror `desert-pilot-status.mjs`).
**Still open:** the `light` component as GL emissive + flame particle (procedural pulse done; true GL light TODO);
internal fabric/bloom anims for rigid props; the affordance hookup (interact/destructible/content/attach).
