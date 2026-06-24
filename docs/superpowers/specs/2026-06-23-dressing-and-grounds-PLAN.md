# Building Dressing + Manmade Grounds — Working Plan & Progress Tracker

> Living document. 2026-06-23. Keep this updated as the source of truth for the dressing/grounds
> initiative across sessions. When you resume cold, READ THIS FIRST, then the design doc
> (`2026-06-23-building-dressing-system-design.md`) and the 8 manifest part files
> (`dressing-manifest-parts/D0.json … D7.json`).

---

## 0 · One-paragraph orientation

The base building generator makes CLEAN architecture (walls, windows, doors, roofs, floors). The
**dressing system** is a SECOND procedural pass (the "D-stack", fields D0–D7) that makes buildings feel
aged, lived-in, and role-specific WITHOUT regenerating the building. The user also wants **manmade
outdoor grounds** — paved streets, walkways, concourses, plazas, pathways, areas where the natural
landscape is pushed aside in favour of decorated/entity-made landscape. That is the **"G-stack"** — a
DECLARED SIBLING of the dressing engine, reusing the same schema/seams but attaching to district/street/
plaza claims instead of building faces. **Decision: build the building D0 pilot FIRST (cheapest proof of
the shared machinery), spec the G-stack in parallel so the seams are shared, do NOT generate paver/kerb
tilesets until the claim+placement machinery is proven on the free D0 pilot.**

---

## 1 · The two stacks (one engine, two host scales)

| Stack | Host | Grain | Status |
|---|---|---|---|
| **D-stack** (dressing, D0–D7) | a resolved BUILDING's faces / sockets / perimeter ring | per-building | manifest AUTHORED (this doc's subject) |
| **G-stack** (manmade grounds) | a DISTRICT / street / plaza CLAIM region | many-tile region | DECLARED, spec pending (brainstorm next) |

Both ask the same three "where does it go?" questions, both route through the GL pipeline, both seed
deterministically, both obey honest-absence. The G-stack is STRICTLY HARDER on every shared seam (it
overrides natural F0–F8 flora, replaces/blends ground tiles against Wang terrain, spans many tiles, needs
a new paver/kerb/concourse tile corpus). That is exactly WHY the building pilot goes first: it proves the
identical claim+surface+placement+overlay+tuner machinery on the cheapest version (D0 = zero new assets),
and the G-stack then inherits a proven engine.

---

## 2 · The dressing manifest (D0–D7) — structural reference

**Totals: 68 categories, 135 objects.** Authored grassland-first; other 20 biomes via `biomeSkins`.

| Field | Name | Mech | Plane | Provenance | Cats×Objs | method | Gating signals (★=available ⊘=honestly absent) | Needs from engine |
|---|---|---|---|---|---|---|---|---|
| **D0** | Weathering | **A** decal/coverage into bitmap | facade/roof/foundation | procedural tints | 7×10 | decal | biome★ surface★ role★ socket★ **wetness★** **exposure.sun★** age⊘ | **surfacesIndex** + dressingContext.wetness |
| **D1** | Damage | **A** decal + sprite chips | facade/roof | procedural+chips | 7×13 | decal, socket_prop | biome★ surface★ **wetness★** tier★ socket★ age⊘ maint⊘ | surfacesIndex + socketsIndex (roof/eave) |
| **D2** | Surface growth | **A** decal/spline | facade | hybrid | 6×11 | decal, spline, socket_prop | biome★ surface★ **wetness★** **shade★** role★ socket★ season★ age⊘ | surfacesIndex (mask+aperture zones) + socketsIndex |
| **D3** | Wall attachments | **B** socket-prop (flat depth) | facade | pixellab/hybrid | 9×22 | socket_prop | biome★ role★ socket★ season★ wealth⊘ maint⊘ | **socketsIndex** + façade projection |
| **D4** | Structural attach | **B** socket-prop (OWN depth+collision) | facade/roof | pixellab | 10×15 | socket_prop | biome★ role★ socket★ **wetness★** tier★ surface★ wealth⊘ | socketsIndex (incl floor≥1, roof_ridge, water_facing) + SPRITE_FLOATS pivotY. **Dep: upper-storey apertures render (balconies)** |
| **D5** | Ground landscaping | **C** perimeter scatter | ground | pixellab | 10×19 | scatter | biome★ perimeter_claim **wetness★** tier★ surface★ season★ wealth⊘ | **architectureClaimAt** ring 1–3 + path/road mask; per-tile (wx,wy) seed |
| **D6** | Ground props | **C** perimeter scatter (content/use/attach) | ground | pixellab+code | 18×33 | scatter | biome★ role★ socket★ perimeter_claim tier★ season★ wealth⊘ | architectureClaimAt ring 0/1/run + SPRITE_FLOATS pivotY + GL particle/lighting; per-tile seed |
| **D7** | Identity kit | **D** meta-composition | composition | procedural | 1×12 | composition | **role★ ONLY** (typeId/category/specialization.id + district.kind); wealth⊘ condition⊘ | **dressingContext**; selects 1 preset, biases/fires D0–D6 |

**Cheapest first:** D0/D1 (and D7) need ~zero new PixelLab. D0 weathering = pure coverage tints riding
existing wall pixels → the design-nominated pilot step 1.

### biomeApplicability restrictions (beyond grassland)
- D2 `d2_fungal_shelf` → only:[grassland,forest,dense_forest,tropical_forest,taiga,swamp,lake,river,beach,hills,mountains,mystic]
- D4 `d4_mill_mechanism` → only:[18 land biomes] (excl ocean/deep_ocean/shallow_water)
- D6 → drop:[ocean,deep_ocean] for most object cats; drop:[+shallow_water] for wells/troughs; hay_bales only:[grassland,savanna,steppe,hills,river,lake,forest]
- all others universal

### Honest-absence (NO sim source today → rule engine SKIPS, never fakes)
- **age** ⊘ — drives most D0 weathering / D1 cracks+rot / D2 maturity / D3 wear. Substituted only by available co-drivers (wetness/sun/biome climate-default).
- **wealth** ⊘ — D3/D4 ornament gating, D7 dwelling_poor/wealthy (fall back to cottage / manor-villa anchor proxy).
- **maintenance** ⊘ — D1/D5/D7 tidy-vs-wild.
- **condition=abandoned** ⊘ — D7 abandoned_ruin DECLARED but DORMANT (no chronicle decommission event).
- **AVAILABLE ★:** biome, building_role (specialization.id, 100% derived), settlement_tier, wetness (terrain-suitability), exposure.sun/shade (surface descriptor), season (where cued).

---

## 3 · The named engine seams (design §3/§7/§8) — the shared foundation

These are what BOTH stacks need. None confirmed to exist in code yet (see §6 OPEN QUESTION).

- **`surfacesIndex`** (mechanism A): extend `src/render/building-tile-query.js cachedLayout()` to emit, per
  visible surface: `{id, plane, face, floor_range, extentTiles, orientation, material,
  exposure:{sun,wet,shade}, apertures:[blocked_zones], edges, corners, allows, claims}`. Drawn via a new
  `drawWallDecals()` soft-light/multiply pass in `building-occluder.js drawWalls()`.
- **`socketsIndex`** (mechanism B): emitted alongside surfacesIndex from `cachedLayout()`; semantic anchors
  per `(face, floor, socket)` — above_door, window_jamb, window_sill, between_windows, wall_corner,
  sign_bracket, roof_edge/ridge/gable, water_facing_wall. Façade projection
  `(building,face,floor,socket)→(screenX,screenY,depth)` reuses the wall renderer's storey-stack.
  - Rigid D3 props paint into the silhouette at flat baseline depth; all D4 (own-depth) pack into the F2
    `SPRITE_FLOATS` pool with `pivotY`. Gated on `renderOn('walls')`/`renderOn('roof')` and `!_inside`.
  - **PREREQUISITE:** south face must render floor≥1 apertures for D4 balconies / upper-floor D3 (design §10).
- **`architectureClaimAt()`** (mechanism C): perimeter-ring claim predicate. New F7-style field in
  `src/dev/field-registry.js` (`applyKind:'live'`); `f7Placements()` in `decoration-claims.js` on the F4
  pattern. Seeded **per-tile (wx,wy)** (NOT per-building), tight footprint ellipses, avoid door_path/road.
  Code effects (forge smoke, prop shadows, well draw) route through GL particle/lighting passes.
- **`dressingContext`** (mechanism D): attached at resolve-time in `resolved-buildings.js` (after biome
  stamp, before `byTile`), carries ONLY available params (biome, role, wetness, exposure, tier, season).
  D7 reads it + the no-mock semantic source (`building.specialization.id` / `footprint.typeId` /
  `footprint.category` / `district.kind`), selects exactly 1 preset (first match, `dwelling_common`
  fallback), then biases/`fires` the already-instantiated D0–D6.

**Asset pipeline (when we DO generate):** `assets/pixelab/dressing/[biome]/[kit_type]/` named
`dk__BIOME__KITTYPE__vNNN.png`; post-process `solidify → alpha-trim → metadata(anchors) → gen-dk-catalog.mjs`;
manifest section in `building-materials.json`. Pilot-before-burst gate applies.

---

## 4 · Build order (DECISIONS LOCKED 2026-06-23)

1. **Static manifest browser (localhost HTML)** — reads the 8 JSON files, click through field→category→
   object→affordances/biomeSkins/coverage. Zero game integration, zero risk. "Visualize the whole manifest
   for review." DEPENDS ON NOTHING.
2. **Host-agnostic in-game OVERLAY + per-field toggle** — its FIRST honest job is to tint onto the world
   (through GL, never a 2D overlay) the placement DOMAIN the game can compute TODAY (perimeter rings, wall
   faces, sockets) per field. Where the metadata does not exist yet, the overlay shows the GAP — that is the
   key calibration signal. Designed from day 1 to also highlight district/plaza claims (for the G-stack).
3. **D0 weathering pilot, grassland, end-to-end** — surfacesIndex + coverage/mask + `drawWallDecals()` +
   F4-style per-biome coverage-scalar slider tuner (reuse `field-tuning.js`). Zero new assets. Proves the
   surface-descriptor + coverage path.
4. **D3 wall attachments (sockets)** — proves socket emission + façade projection + sprite/lit/sway.
   (First field that needs PixelLab — gate a small pilot batch, verify a real chunk, then unlock.)
5. **D2 surface growth (vine spline)** — grow-fit + spline assembly + aperture avoidance.
6. **D5/D6 ground** — F7 perimeter-scatter field + claim coexistence with flora.
7. **D7 identity** — composes the above by role.
8. **Scale horizontally** — other 20 biomes via biomeSkins, validated per biome group.

**In parallel (design only, no code, no assets):** brainstorm + spec the **G-stack** (manmade grounds)
so its claim model / flora-override / tile-corpus / reserved anchors are declared before overlay code locks
the seams. Build the overlay tool host-agnostic so G-stack inherits it.

**DO NOT:** generate paver/kerb/concourse tilesets, or fire mass PixelLab dressing jobs, until the
claim+placement machinery is proven on the free D0 pilot (pilot-before-burst discipline).

---

## 5 · Non-negotiables to honour (from CLAUDE.md + memory)

- **Everything through GL.** Overlay tints, decals, props, glow, smoke, shadows ALL go through the GL
  chunk/sprite/lighting pipeline. NEVER a 2D ctx overlay for world content. (2D ctx is ONLY for true
  HUD/UI: the toggle panel, sliders, the manifest browser.)
- **No-mock.** Dressing is presentation; its semantic params derive from the simulation. Honestly absent
  params (age/wealth/maintenance/condition) are SKIPPED, never invented.
- **Buildings are structures, not sprites.** Dressing attaches to real resolved geometry.
- **Determinism / infinite world.** Surface fields seed per-surface/socket; ground-scatter seeds per-tile
  (wx,wy). Never seed on (bx,by) alone (the regionally-constant-hash bug).
- **Wang tilesets 32×32 only** (relevant when the G-stack generates paver/kerb tiles).

---

## 6 · METADATA AUDIT — what the game CAN compute today (probe answered 2026-06-23)

The code-seams probe answered the blocking question. **Most metadata EXISTS; the three NEW things are the
surface/socket index, the dressingContext composer, and a wetness scalar.** Verbatim findings:

### EXISTS today (overlay can highlight / D-fields can read NOW)
- **Building role / identity** ✅ — `building.specialization = {id,name,desc,baseItems,specialtyItems}` (e.g.
  `id:'weaponsmith'`) computed in `sim/world/buildings/layout.js assignIdentity()`; residential → null.
  `footprint.typeId` / `footprint.category` (residential|commercial|civic|craft) / `tier` / `district` /
  `brand` / `owner` all on the resolved building. → **D7 selection works against real data today.**
- **Geometry** ✅ — `footprint.sections/doors/windows/floors/features/boundingBox` + per-frame
  `southRuns(fp)` / `footprintSet(fp)` (true stepped outline). `building-tile-query.js cachedLayout()` emits
  `floorIndex` (Map "wx,wy"→{material,tileKind}) and **`wallIndex`** (Map "wx,wy"→{sprite,edge:S/N/E/W,
  spriteW,half}) — the closest existing thing to a surface index (per-face edge tags), but legacy-sprite-keyed
  and carries NO dressing sockets.
- **Materials** ✅ — `biome, wallSlug, roofSlug, doorShape, windowShape` via `stampMaterials()`.
- **Claim predicate** ✅ — `decoration-claims.js architectureClaimAt(wx,wy)` EXISTS (pure f(wx,wy)→bool,
  worker+main, deterministic); the building predicate is `building-tile-query.js isBuildingClaimed(wx,wy)`
  (footprint + margin 2 + north band) wired via `setArchitectureClaim()`. **The perimeter-scatter engine
  (D5/D6) is a new F7-style fn here following the f4/f5 pattern — gated on architectureClaimAt being TRUE.**
- **Interior data** ✅ pre-computed `footprint.interior` I0–I6 (floor/wall features/structure/furniture/decor/
  condition) — NOT rendered yet, but present (a future D-source).

### NEW — does NOT exist yet (must be built)
- **`surfacesIndex` / `socketsIndex`** ❌ — only `wallIndex` (edge tags) exists. A per-building SURFACE map
  (faces/planes + world rects + exposure) and SOCKET map (above_door/window_sill/wall_corner/roof_edge…)
  are genuinely new. Today they're implicitly re-derived each frame inside the draw functions.
- **`dressingContext`** ❌ — no composer object exists; D7 would read `specialization.id` directly for now.
- **wetness 0–1** ❌ — `terrain-suitability.js` exposes only BINARY water predicates (isWaterTile,
  buildingTouchesWater, …). `src/world/hydrology.js` exists and COULD supply a scalar but is not integrated.
  → `min_wetness` gating is **honestly absent until wired** (matches the manifest's own note).
- **`drawWallDecals()`** ❌ — does not exist. `building-occluder.js drawApertureFrame()` + `wallTone()` are
  the paint-INTO-silhouette precedent (mechanism A); decals are the new pass added after the base façade tile.

### REUSE — exact code templates (do NOT reinvent)
- **Per-field on/off gate:** `src/render/building-render-flags.js` `BUILDING_RENDER` + `renderOn(layer)` (live
  `window._buildingRender`). Each D-field gets a sub-flag in this pattern.
- **Field tuner:** `src/dev/field-registry.js` (`FIELD_REGISTRY`, `applyKind:'live'|'repaint-bitmaps'`,
  `objectsFor/stateNames/stateDefaults`) + `src/dev/field-tuner.js` `initFieldTuner()` (backtick toggle,
  tree UI, localStorage('fieldTuning'), copy-JSON export). A D-field tuner = one registry entry + the generic
  panel. Second style: `src/render/wall-tuner.js` (`PARAM_DEFS`, `\` toggle).
- **Perimeter-scatter machinery:** `decoration-claims.js` `f4Placements/f5Placements/f5Candidate` (symmetric
  footprint-conflict resolution via `rand2(wx,wy,…)` priority + lexicographic tiebreak), `clearClaimCaches()`,
  per-tile "wx,wy,biome" cache keys, `_provisionalEpoch` guard, `claimScanRadius()`.
- **Sprite pool:** `field2-animator.js` + `gl-compositor.js` — `SPRITE_FLOATS=9`
  [pivotX,pivotY,sizeTiles,rot,alpha,u0,v0,du,dv]; `ANIM_SPRITE_FLOATS=20` with a **`rigid` flag**
  (a4.w>0.5 = no sway) — exactly the slot for mechanism-B rigid props. (`window._gpuFlora`, `_f2PoolN`.)

### GL ROUTING — the sharpest constraint for the OVERLAY
Two canvases: `canvas-renderer.js` `this.ctx` (2D HUD, ON TOP) + `this.glc` (`GLCompositor`). **EVERY existing
tile/region debug highlight is 2D-HUD-only and would VIOLATE the GL rule if copied for world geometry:**
`elevation-overlay.js drawElevationOverlay()` (per-tile ctx.fillRect — the closest precedent, but HUD),
`sim-debug-overlay.js`, deprecated `roof-overlay.js`. **To highlight world tiles/faces correctly, route the
highlight bitmap through `glc.drawSceneOverlayBitmap(bitmap)`** (blits an offscreen canvas INTO the scene FBO
after sprites, before present → inherits lighting/CRT/day-night) **or** `glc.drawBuildingColorDepth()` **or**
the sprite batch. The panel CHROME (sliders/toggles/text) MAY stay on the 2D HUD ctx like the existing tuners.
There is **no GL debug-quad/heatmap API yet** — building one is part of the overlay task.

→ **Overlay tool scope (now concrete):** highlight what the game CAN compute — perimeter claim ring
(`architectureClaimAt`), wall FACES (`wallIndex` edge tags), building role (`specialization.id`) — through
`glc.drawSceneOverlayBitmap`. FLAG the gaps: no surface/socket index (so D3/D4 socket overlays show
"metadata not generated yet"), no wetness scalar (D0 water/mud gates dormant), no dressingContext.

---

## 7 · Progress log

- **2026-06-23** — Manifest authored (68 cats / 135 objects, D0–D7) + internal-consistency fix pass
  (id casing lowercased, D2 destructible→object form, D4 chimney flicker_glow, authored D4 mill mechanism +
  7 new D6 categories, repaired all attach.holds, added concrete `fires` arrays to all 12 D7 presets,
  corrected D7 field-attribution prose). Self-verified: 8 files parse, all attach.holds + D7 fires resolve,
  no uppercase D3_/D4_ ids, no string destructibles.
- **2026-06-23** — Planning conversation: established the two-stack framing (D-stack built / G-stack
  declared sibling), locked the build order (building D0 pilot first; G-stack spec in parallel; no tilesets
  until proven), wrote this plan, launched the code-seams probe.
- **2026-06-23** — Code-seams probe RETURNED → §6 filled. Verdict: role/geometry/materials/claim-predicate
  EXIST; surfacesIndex+socketsIndex, dressingContext, and wetness-scalar are the only NEW things; every
  existing debug tile-highlight is 2D-HUD (would violate GL rule) so the overlay must route through
  `glc.drawSceneOverlayBitmap`. Reuse templates identified (building-render-flags renderOn, field-registry +
  field-tuner, decoration-claims f4/f5 + architectureClaimAt, SPRITE_FLOATS rigid flag).
- **2026-06-23** — Re-ran `scripts/merge-dressing-manifest.mjs` → assembled `2026-06-23-dressing-manifest.json`
  refreshed, VERIFY: PASS (68 cats/135 objs, 0 unresolved refs/uppercase ids/string destructibles; provenance
  77 pixellab / 32 procedural / 26 hybrid). Built **`tools/dressing-manifest-browser.html`** (step 1 of build
  order) — standalone localhost page, fetches the assembled JSON, field→category→object navigation, inspector
  shows scale/variants/states/anim + all affordance components + coverage + biomeSkins + notes, clickable
  attach.holds / D7 fires cross-jumps, and annotates application.when gating tokens GREEN (available) /
  RED (honestly absent). Verified rendering via Playwright (8 fields, 68 cats, 135 objs all load). Serve from
  project root (e.g. `npx http-server -p 8137 -c-1 .`) then open `/tools/dressing-manifest-browser.html`.
- **2026-06-23** — G-stack BRAINSTORM in progress (design-only; no code, no tiles). Decisions so far:
  (1) host-agnostic grounds engine = **pluggable claim providers → surface-override → paver/kerb resolver**;
  prove on the building-anchored provider first (claim host ready), add street (spines exist) + plaza
  (must declare in layout.js) providers later as additive providers, NO engine refactor. (2) Surface-override
  = **paint-on-top, NO Wang recompute** — claim sets a cheap tile flag (`surface.manmade='cobble'`), a
  chunk-bake **paint pass** composites the paver surface + kerb OVER the already-Wang-painted ground, before
  sprites, through GL (mirrors the D-stack mechanism-A paint-into-bitmap). (3) Edge/kerb = a **biome-AGNOSTIC
  shared ~6-piece Wang skeleton rotated to 16 masks** (the kerb tile carries NO biome — the natural biome is
  the layer underneath + a `biomeSkins` tint), so the corpus is ~6 shared edge pieces + 1 fill per path type
  (≈12 tiles total, NOT path×biome×16≈2000); informal surfaces use a free procedural FRINGE (option C, kerbed
  Wang for formal / fringe for informal). Layout probe confirmed: settlement layout + district.kind + road
  SPINES (waypoint polylines) + P2 roads sim (`buildRoad`, `'paved'` flora-suppression deltas) EXIST as
  metadata with ZERO ground visual; per-tile surface-override + settlement-level plazas + paver corpus are NEW.
- **DEFERRAL STATUS (pinned 2026-06-23):** the dressing manifest (D-stack D0–D7) is NOT deferred. It is the
  PRIMARY implementation track. The G-stack is a PARALLEL DESIGN-ONLY lane right now (spec, no code/assets).
  Build order UNCHANGED: overlay → D0 pilot → (only after proven) grounds engine on the shared seams. Any
  reorder (e.g. grounds before D0) would be a deliberate change to §4 and must be flagged + logged here.
- **2026-06-23 — D0 WEATHERING PILOT SHIPPED + VERIFIED IN-GAME (build-order step 3).** Implemented per
  `docs/superpowers/plans/2026-06-23-d0-weathering-pilot.md`. New `src/render/dressing/d0-weathering.js`
  (pure `weatheringCoverage` fbm+rand2 scalar, `grimeAlpha` bottom-weighted gravity mask, `paintWeatheredColumn`
  soft-light tonal wash + multiply ground-grime bands) — 5/5 unit tests (`test/d0-weathering.test.mjs`). Wired
  via a `weathering` sub-flag (`building-render-flags.js`) + `drawWeatheringPass()` in `building-occluder.js`
  `drawBuildingTextured()` (after walls, before roof, BOTH tile + legacy branches) → paints into the silhouette
  bitmap = GL-routed (inherits lighting/CRT/day-night, never a 2D overlay). Live tuner `window._weathering`.
  **Verified in-game:** teleported to a grassland township (seed 42, ~1046,-32 via `discoverSettlementsInMacroRange`
  + `chunkStore.streamAround` + `provider.initPreload(x,y,true)`), froze lighting at noon, A/B with the flag —
  the lower third of the stone wall darkens with grime aligned to the wall columns, top stays clean, receives
  the same lighting as the wall. Screenshots: `tools/d0-weathering-OFF.png` / `tools/d0-weathering-ON-4x.png`.
  Commits: ee761120f (module+tests), fc786bf69 (integration). **Skipped vs the field's full scope (documented
  follow-ups, not pilot):** full `surfacesIndex` (pilot rides the south-perimeter walk), the field-registry
  slider UI (pilot uses the console knob), water-stain streaks + `min_wetness` gating (needs the wetness scalar,
  honestly absent). Day-night clock is FAST — freeze `window._lighting.paused=true; .time=0.5` for any visual A/B.
- **2026-06-23 — Grounds surface catalog authored (maximal/complete, per user).** 6 classes / 76 manmade
  surface types (streets, civic/ceremonial, paths, yards, water-edge, managed-green), each tagged formality/
  edgeStyle/fill/claimSource/available/biomeSkins/affordances/assetCorpus → `docs/superpowers/specs/2026-06-23-grounds-surface-catalog.json`.
  Still DESIGN-ONLY (G-stack), no code/tiles; feeds the G-stack spec. Build order unchanged.
- **NEXT:** D-stack continues — D3 wall attachments (sockets; first PixelLab field, gate a pilot batch) OR
  optionally the host-agnostic GL overlay first. G-stack stays parallel design: finish its spec (path types +
  own design doc, then RETURN to the dressing track: (b) host-agnostic in-game GL overlay + per-field toggle,
  scoped by §6 (highlight claim-ring / wall-faces / role through `glc.drawSceneOverlayBitmap`; flag the missing
  surface/socket index + wetness), then (c) the D0 weathering pilot (`drawWallDecals` + field-registry entry +
  tuner).
