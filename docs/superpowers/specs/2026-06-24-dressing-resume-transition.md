# Building Dressing (D-stack) — Resume Transition Doc

> 2026-06-24. Written for a FRESH session (context about to be cleared) to pick up the **building dressing
> system** — the D0–D7 "fields" stack that decorates clean buildings (the analog of the landscape decoration
> fields F0–F8). Read this first, then open the PLAN doc below. The building EXTERIOR tile-corpus work is at a
> clean checkpoint on `master` (see Git state); dressing is the active track.

---

## 0. The one-line state
D0 weathering is **shipped + GL-wired + in-game-verified** (but perceptually faint — see §6). The full manifest
(68 categories / 135 objects, D0–D7) is **authored**. **NEXT = D3 wall attachments** (the first PixelLab dressing
field) — *or* optionally the host-agnostic in-game GL **overlay** first. G-stack (manmade grounds) stays a
parallel design-only track.

## 1. Canonical docs — read these (don't re-derive)
- **PRIMARY RESUME POINT** — `docs/superpowers/specs/2026-06-23-dressing-and-grounds-PLAN.md`
  (living plan/tracker: build order, progress log §7, the explicit NEXT at the bottom).
- **Design spec** — `docs/superpowers/specs/2026-06-23-building-dressing-system-design.md`
  (the D-field stack, coverage grain, affordances, placement/scale/provenance models — §2 & §3).
- **Manifest** (the work matrix) — `docs/superpowers/specs/2026-06-23-dressing-manifest.json` (359 KB).
- **Grounds surface catalog** (G-stack, design-only) — `docs/superpowers/specs/2026-06-23-grounds-surface-catalog.json`
  (6 classes, 76 manmade surface types).
- **Manifest browser** (visual) — `tools/dressing-manifest-browser.html` (open on localhost: every field /
  category / object, affordances, coverage, biomeSkins, D7 `fires`, gating tokens colour-coded GREEN=available
  / RED=honestly-absent).

## 2. The D0–D7 stack (what each field is)
| Field | Name | Mechanism | cats/objs | provenance |
|---|---|---|---|---|
| D0 | Weathering | A · procedural coverage tint into the silhouette bitmap | 7 / 10 | all procedural — **SHIPPED** |
| D1 | Damage | A · coverage + sprite chips (cracks, rot, peeling) | 7 / 13 | 9 proc / 3 px / 1 hybrid |
| D2 | Surface growth | A · decal/spline hybrid (moss patches, climbing vines) | 6 / 11 | 1 proc / 3 px / 7 hybrid |
| **D3** | **Wall attachments** | **B · socket-prop, façade plane (signs, brackets, awnings, planters)** | **9 / 22** | **15 px / 7 hybrid — FIRST PixelLab field, NEXT** |
| D4 | Structural attach | B · socket-prop w/ own depth+collision (balconies, porches, columns) | 10 / 15 | 13 px / 2 hybrid |
| D5 | Ground landscaping | C · perimeter field-scatter (shrubs, hedges, beds) | 10 / 19 | 18 px / 1 hybrid |
| D6 | Ground props | C · perimeter scatter w/ content/use/attach (barrels, crates, benches, wells) | 18 / 33 | 25 px / 8 hybrid |
| D7 | Identity kit | D · meta-composer: reads `building.specialization.id` (role), fires curated D0–D6 | 1 / 12 | all procedural |

Totals: **68 categories / 135 objects · 32 procedural / 77 PixelLab / 26 hybrid.** D3–D6 are the PixelLab-heavy
sprite fields; D0/D7 are pure code. No object carries a `generated`/`done` marker — **the manifest is a spec, not
a tracker** (a D-field tracker is itself a to-build, mirroring the building tile-corpus tracker pattern).

## 3. The two stacks
- **D-stack (building dressing)** — host = a resolved building's faces/sockets/perimeter ring; grain = per-building.
  Manifest authored; D0 shipped. **This is the active track.**
- **G-stack (manmade grounds)** — host = district/street/plaza CLAIM regions; grain = per-tile region. **DECLARED,
  design-only** (catalog authored, no code/assets). Strictly harder: must override natural F0–F8 flora, blend/replace
  ground vs the Wang terrain, and needs a NEW paver/kerb/concourse tile corpus. **Do NOT generate paver/kerb tilesets
  until claim+placement+overlay are proven on the cheap D-stack pilots** (pilot-before-burst).

## 4. Cross-cutting models (from the design spec — the machinery every field shares)
- **Coverage sub-grain (D0–D2)** — instead of discrete art, a procedural `coverage` scalar + directional `mask`
  `{direction: down/up/none, falloff: bottom/top/patchy, facing: north/south/any}` + `blend` (soft-light / multiply),
  `textureVariants` count. Scalar driven by **wetness (0–1, ★ available)** or **age (⊘ honestly-absent — no sim source
  yet)**.
- **Affordances** — `light` {color,radius,intensity,diurnal,flicker} · `interact` {open_close/toggle/use/momentary} ·
  `destructible` {breakable,broken_state,debris[]} · `content` {axis: fill/load/season, states[]} · `attach`
  {holds:[childCategoryId], slots[]} (composition — e.g. a bracket holds a lantern).
- **Local placement — x AND y axis.** Three address spaces:
  - **Ground plane** `(wx,wy)`, depth by `pivotY` (sorts with flora) → D5/D6 scatter.
  - **Façade plane** `(face, floor, socket, fine-offset)` where socket ∈ {above_door, window_jamb, **window_sill**,
    between_windows, wall_corner, sign_bracket, roof_edge, roof_ridge, roof_gable, water_facing_wall}. Projection reuses
    the wall renderer's storey-stack (`NORTH_BAND_BASE + storey·STORY`). → D3/D4 props; D0–D2 decals ride the same
    projected surface. (This is how "a flower pot sits on a 2nd-floor window ledge" is addressed.)
  - **Roof plane** — ridge/eaves/gable anchors → chimneys, roof props.
- **Scale-to-fit** — `object.scale = {nativePx, worldSizeW, worldSizeH, fit: cover/fixed}` proportions a PixelLab sprite
  to the building (e.g. vines sized to climb a wall), so generated art isn't off-scale.
- **Provenance** — `source: procedural | pixellab | hybrid` per object.

## 5. Manifest schema (so you can read/extend it cold)
Top-level object: `{ version, generated, biomePilot:"grassland", schemaRef, fields:[…] }`; nesting is
`fields[].categories[].objects[]`.
- **Category** (7 keys): `id, label, field, placement{plane,anchor,method,fitDefault}, application{when,avoid[],chanceOrDensity}, biomeApplicability, objects[]`.
- **Object** (17 keys): `id, label, source, codeEffect[], scale{…}, variants{count,drivenBy}, states[], anim[], interact, destructible, light, content, attach, coverage{scalar,mask{direction,falloff,facing},textureVariants,blend}|null, biomeSkins, notes` (+ `fires[]` on D7 only).
Authored grassland-first; other 20 biomes via the per-object `biomeSkins` override string.

## 6. D0 weathering — shipped, but the open question
**Impl:** `src/render/dressing/d0-weathering.js` — `weatheringCoverage(wx,wy,opts)` (FBM + per-column jitter, seeded
deterministic), `grimeAlpha(vFrac,coverage,opts)` (bottom-weighted quadratic falloff), `paintWeatheredColumn(ctx,rect,world,opts)`
(soft-light tonal wash + multiply grime bands). Config `WEATHERING = {enabled, strength:1.0, grimeFrac:0.45, grimeMax:0.5, toneMax:0.18, bands:6}`.
**Routing (GL, NOT a 2D overlay):** `drawWeatheringPass()` in `src/render/building-occluder.js` (gated `renderOn('weathering')`)
runs AFTER walls / BEFORE roof, painting into the silhouette canvas that is then GL-composited via `glc.drawSceneOverlayBitmap`
→ inherits the shared lighting / day-night / CRT present pass (honours the CLAUDE.md GL rule).
**Flags:** `window._buildingRender.weathering` (default **on**); live tuner `window._weathering` (`.strength .grimeFrac .grimeMax .toneMax .bands .enabled`).
**Tests:** `test/d0-weathering.test.mjs` — 5 passing.
**OPEN QUESTION (user, 2026-06-23):** the effect is **perceptually too faint** at default tuning (toneMax 0.18 soft-light is
barely visible; the user "couldn't perceive the weathering"). It is **not a bug** — a deliberately conservative prototype.
Resume options: (a) **calibrate** — raise `toneMax`/`grimeMax`, try overlay/hardlight blend; (b) **redesign toward
directional cues** — vertical water-run streaks from sills/eaves (the design defers "water-stain streaks + wetness gating"),
not just horizontal grime bands; (c) wire **wetness** as the coverage scalar (★ available) for legible per-building variation.
Decide this with the user before sinking time — they may prefer to move to D3 and revisit D0 calibration later.

## 7. NEXT — the decision point (from PLAN §7 bottom)
1. **D3 wall attachments (sockets)** — the first PixelLab dressing field. Proves the whole socket pipeline: socket
   emission on a face, façade projection `(building,face,floor,socket)→(screenX,screenY,depth)`, and sprite/lit/sway
   rendering. Pilot one category (e.g. hanging signs or wall lanterns) grassland-first, prove in-game, then burst.
2. **OR overlay-first** — build the host-agnostic in-game GL **overlay** (build-order step 2) that highlights the
   claim-ring / wall-faces / role via `glc.drawSceneOverlayBitmap`, surfacing missing surface/socket index + wetness
   gaps before generating any D3 art. Cheaper proof that placement addressing is correct.
Recommended: confirm with the user which of these (and whether to calibrate D0 first). Keep G-stack parallel/design-only.

## 8. Rules that bind this work (non-negotiable)
- **GL pipeline only** — every dressing pixel in the world routes through the GL chunk-render/present pass (like D0
  does). NEVER a separate main-thread 2D overlay for world content (CLAUDE.md).
- **No-mock** — a field may be ABSENT but never FAKE. Each field's "honest absence" is defined; `⊘` tokens (e.g. age)
  mean the driver has no sim source yet — render the absent semantics, don't hardcode a fake.
- **Pilot-before-burst** — prove one category in-game before generating the field's full object set. Same discipline
  as the building tile-corpus.
- **Tracker, not memory** — the manifest is the spec; build/extend a disk-authoritative D-field tracker before
  claiming a field "done" (mirror `scripts/desert-pilot-status.mjs`).

## 9. Git state (true, post-checkpoint 2026-06-24)
- Branch `building-facade-blocks`, pushed. **Remote `master` fast-forwarded to it** — `origin/master` == HEAD ==
  `25e8ca821`. origin = `github.com/dsuchmann/freedommmo-wizardengine`.
- Dressing commits already in history: `ee761120f` (D0 coverage+paint, tested) · `fc786bf69` (D0 GL wiring) ·
  `2980d424b` (D0 verified in-game + plan + grounds catalog) · `514bd2c92` (full manifest authored) ·
  `ec38ff5c1` (design spec) · `380164fc0` (plan + manifest browser). The PLAN, spec, manifest, and catalog are all committed.
- Building-exterior checkpoint commits (just landed): `3e79395ec` (exterior pipeline: roof/gable/v1 tracking, desert
  wired, roof pool) + `25e8ca821` (desert building tile-corpus assets).

## 10. Loose ends inherited from the building-exterior checkpoint (not dressing, but don't lose them)
- **Roof-pool tracker mismatch** — the renderer + skill now use an **8-variant** biome-wide curated roof pool
  (`building-occluder.js` `NV=8`, desert has `roof_top__v000..v007`), but `scripts/desert-pilot-status.mjs` /
  `build-asset-manifest.mjs` still count **4** (`v000..v003`). Reconcile the roof trackers to the pool model.
- **Interiors = separate sibling skill** (recommended, not yet built) — derives from the exterior bases; the exterior
  `building-tile-pipeline` skill is the canonical engine reference. See `2026-06-22-interior-tile-corpus-manifest.md`.
- The `.claude/skills/building-tile-pipeline/SKILL.md` is **git-ignored** (local only) — its end-to-end runbook +
  the user's roof-pool edit live on disk, not in the repo.
