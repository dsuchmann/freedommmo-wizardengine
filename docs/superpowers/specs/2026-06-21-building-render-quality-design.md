# Building Render Quality — Design Spec

**Date:** 2026-06-21
**Branch:** `motion-eval-system` (trunk; one shared tree)
**Status:** design approved (4 gating decisions locked); per-lane plans to follow.

> This is the authoritative delegation document for a 5-lane, multi-agent pass that fixes the
> building façade / door / window / corner / roof / interior render bugs visible in-game. Each lane
> has an exact file-ownership glob and a per-lane fix list with `file:line` anchors. Lanes were
> partitioned so 4–6 agents can work the ONE shared tree with near-trivial reconciliation.

---

## Goal

Make in-world buildings read as believable structures instead of stretched, obviously-tiled,
see-through, square-block façades — and fix the cross-building / roof-over-door draw order — **without
ever leaving the GL pipeline** (no 2D `ctx` top-pass for world content) and **without faking any
system** (no-mock rule).

## Architecture correction (READ THIS FIRST)

The wall/roof **bake was deleted** from `worker-chunk-renderer.js` (see `:1324-1326` — "Building walls
+ roofs are NOT baked here"). The single **live** wall+roof draw engine is now:

- **`src/render/building-occluder.js` → `drawWalls()` (@113) + `drawBuildingTextured()` (@300)** —
  composites every wall/corner/door/window piece (and calls `roof.drawRoofForBuilding`) onto an
  **offscreen 2D canvas**, which `gl-compositor` blits into the **scene FBO**. Because it goes through
  the FBO it still inherits GL lighting / CRT / day-night / depth — so fixing it here is GL-legal.
- Consumed by `building-layer.js` (Y-split behind/front bitmaps), `building-depth.js` (silhouette→depth),
  and `door-leaves.js` (decoupled swung door leaves).

**Implication:** the building-render hot file is `building-occluder.js`, **not** the agent-protected
`worker-chunk-renderer.js`. This pass does not edit `worker-chunk-renderer.js` at all.

## Locked decisions (gating answers, 2026-06-21)

1. **Draw order → FIX DEPTH NOW.** Resurrect the GPU per-building depth pass (geometry-z into the scene
   FBO, `depthFunc(LESS)`) that was specified then rejected on 2026-06-20. This fixes BOTH the
   cross-building overlap (behind-building door over front-building roof) AND roof-over-door, per-pixel.
   **Coordinated change** — touches `gl-compositor.js` (protected; reuse its existing
   `writeBuildingDepth`/geometry-z/spotlight-discard machinery — coordinate, do not rewrite).
2. **Asset family → 32px TILEABLE STRIPS.** Re-crop the pilot wall corpus to 32px-multiple, horizontally
   seamless tiles (left col == right col) + a few run-bond variants; **retire the `isPilot` 4-bay-facade
   hack** in `building-occluder.js`. Root fix for "repeats every 4 tiles / obviously tiled."
3. **Windows → OVERLAY OBJECTS.** Windows become transparent-surround overlay objects drawn OVER an
   unmodified wall tile (only window pixels override → fixes the tone/pattern seam) AND gain an
   open/close state via a **procedural transform** (shutter/sash), mirroring the decoupled `door-leaves.js`.
   **No mass-generated window animation** (figure-hallucination risk — cf. door anim `frame_004.png` which
   contains a hallucinated person; that is exactly why doors use a transform, not generated frames).
4. **Roofs → FULLER OVERHANG.** Real eave overhang + soffit shadow + ridge/hip/valley dressing + wired
   `roof_fascia.png` trim. Accept re-calibration of the player-occlusion north-band, building-shadow north
   bands, and the roof north-gap clamp; guard the north overhang against poking into the neighbour.

## Honest-absence / hard constraints (every lane)

- **GL-only:** all world content composites onto the building-occluder offscreen → scene FBO, or the
  per-building depth quad. **Never** a separate 2D `ctx` top-pass. (CLAUDE.md non-negotiable.)
- **No-mock:** systems may be absent but never faked. Capacity/shapes are real.
- **Buildings are spatial structures** quantized into 32px sprite PIECES — never whole-building sprites.
- **32px tilesets.** Wall pieces are 32px-multiple.

---

## Work-stream / file-ownership map

Five lanes. Each lane **only writes** its owned glob. Cross-lane needs go through COORDINATION as a
small by-name patch.

### Lane A — ASSET (pixel-art / PixelLab corpus) · writes ZERO `.js`
**Owns:** `assets/pixelab/buildings/**` (walls, roof, doors, windows, floors PNGs).
**Fixes (pure-asset; land first):**
1. Re-author `walls/grassland/wattle_daub/interior_base__normal.png` and `south_base__normal.png` so the
   daub infill panels are **OPAQUE plaster** (currently 38.9% transparent interior → literal see-through).
2. Fix `walls/grassland/wattle_daub/south_corner_east__normal.png` — it's a duplicate of `south_base`
   (no east post). Author a true mirrored east pilaster.
3. **Re-crop the pilot corpus to 32px-multiple tileable strips** (decision #2): `south_base` 32×128
   horizontally seamless (left col == right col); `north_back` 32×64; `edge_ew` a real 32×128 side-face
   cap (current stone_brick `edge_ew.png` is a featureless 32×32 gray fill); corners as a TRUE mirrored
   pair; `interior_base` 32×128 OPAQUE infill. Add 2–4 **run-bond variants** of `south_base` (shift the
   x=13 mortar joint per tile to break the repeat).
4. Window-as-object assets (decision #3): a plain-panel wall base + a SEPARATE transparent-surround
   window object with **closed + open/shutter states** (model on the existing, currently-orphaned
   `assets/pixelab/buildings/windows/window_{arch,shutters,balcony}.png` 64×64). `shuttered` is the
   natural open/close candidate.
5. Door-leaf fit: recut `doors/{plank,arched,ledged}__norm.png` so the leaf bbox matches the
   `south_doorway` cut-out hole; supply per-shape **doorway-hole metadata** (x0,y0,w,h as fractions of
   the 128 facade) to COORDINATION for the registry.
6. Close the 8px corner see-through on stone_brick `south_corner_{west,east}.png` (fallback only).
7. Confirm per-material `roof/{biome}/{slug}/roof_fascia.png` is eave-trim quality for ROOF to wire.

**Process:** Pilot **grassland (cob/fieldstone) FIRST**, validate in-game tileability + zero internal
alpha in the solid region + window open/close, THEN the 21-biome × 4-material burst. Any filename-scheme
change is a **request to COORDINATION** (who edits `building-material-registry.js`); ASSET never edits the
registry switch. Stage only the specific PNGs authored — never `git add` the whole `assets/` tree.

### Lane B — BUILDING-RENDER (the wall/door/window/edge/corner draw engine)
**Owns:** `src/render/building-occluder.js`, `building-layer.js`, `building-depth.js`, `door-leaves.js`,
`window-overlay.js` (NEW), `building-shadow.js`, `wall-draw.js`.
**Fixes:**
1. **Vertical stretch** (`building-occluder.js:144-155`): crop `(0,8,W,112)` strips 16 transparent rows
   then fills the full 4-tile dest → ~14% anisotropy. Either crop full `(0,0,W,128)` or scale dest height
   to `round(wH*112/128)` isotropically with a matching y-offset. Re-verify `wallYOffset` + roof lift +
   north-gap clamp after.
2. **Tile seams** (`:122-123,145,148,151,154`): replace fixed dest width `t+wp` / `2t+wp` with
   boundary-derived integer extents: `dx=round(wx*tilePx-camX); dw=round((wx+1)*tilePx-camX)-dx`. Kills
   the round/pad double-paint.
3. **Retire the `isPilot` 4-bay branch** (`:81-95,128-155`) once ASSET ships 32px-multiple tiles — use
   true per-32px draws (matches `wall-draw.js`). Apply run-bond variant selection per tile.
4. **E/W square-block** (`:176-204`): draw a FULL-HEIGHT stacked E/W wall facade (`wH = t*wallHeight`)
   instead of the ~0.4-tile rotated trim strip; **fix the pilot `edge_ew` source rect** — sample the x=0
   quoin column `[0,0,16,128]`, not the facade-middle `[16,0,32,128]` (`:178-182`). Revisit
   `wall-config.js` `ewTileHeight`/`ewXOffset` (those thin-strip values produced the block look) — via
   COORDINATION (serialized constants).
5. **Corner see-through back-fill** (`:228-229,170-171`): draw `south_base` under the corner tile so the
   transparent buttress shoulder doesn't reveal terrain.
6. **Door-leaf fit** (`door-leaves.js:58-62`): add a per-piece doorway-hole rect (from ASSET metadata) and
   draw + swing the leaf into that sub-rect instead of the full `2t × 4t`.
7. **Window-as-object** (decision #3): in `facadeWide`/drawWalls, draw a transparent-surround window
   overlay OVER an already-drawn `south_base` tile (keeps base tone); create **NEW `src/render/window-overlay.js`**
   mirroring `door-leaves.js` exactly (offscreen bitmap → `glc.drawSceneOverlayBitmap`, NEVER a 2D top-pass)
   for the open/close transform. Ensure per-building `windowShape`/`doorShape` are actually assigned
   (`:87-88`) so the 6 generated shapes are used, not all defaulting to arched/plank.
8. Keep within-building roof-over-door correct (it already is); the GLOBAL depth fix is COORDINATION's.

### Lane C — ROOF (procedural roof engine)
**Owns:** `tools/roof/*.js` (`roof-ingame`, `roof-renderer`, `roof-geometry`, `roof-styles`,
`roof-materials`, `roof-features`, `roof-rules`), `src/render/roof-overlay.js`.
**Fixes:**
1. **Tiled/banded surface** (`roof-renderer.js:106-120`): `drawTexturedTile` uses a fixed `0,0,32,32`
   crop of a **64×64** swatch with a per-facet tile-local UV → courses restart every tile. Replace with a
   **CONTINUOUS slope-space UV** (u along ridge, v eave→ridge) sampling the FULL `tex.width/height`, so
   courses flow unbroken eave-to-ridge (or bake each face once to an offscreen then affine it). Validate
   in `tools/roof-ingame-preview.html` (watch for diagonal smearing if the face-axis derivation is off).
2. **Constant-per-ring shade** on hip roofs (`roof-styles.js:23-30`, terraced `distEdge*pitch`): derive
   shade from `cornerH`-smoothed normals + an along-run gradient so equal-distance rings stop reading as
   color terraces.
3. **Re-enable structural dressing the generator already has but ships disabled** (decision #4):
   `roof-ingame.js:100` `noAccents:false` (ridge/hip/valley strokes — `roof-renderer.js:254-272`); gate
   `surfaceOnly` (`:23`,`:141`) so the lightweight ridge-cap / finial / dormer / chimney passes
   (`roof-features.js:77-181`) run in-game (they read building ROLES already classified at
   `roof-geometry.js:226-242`).
4. **Wire the existing `roof_fascia.png`** in `roofTexFor`/`drawSkirt` (`roof-renderer.js:236-238`) instead
   of the flat procedural `fasciaColor`.
5. **Real eave overhang** (decision #4): re-introduce a small E/W/S overhang ring (re-examine
   `overhangDroop=0` / `normalizeEaveToZero` at `roof-ingame.js:84-117`); **bridge the skirt on N/E/W**
   gable/rake ends (`roof-renderer.js:226` is `d==='s'` only) so roofs terminate as gable/rake boards, not
   flat cuts. Keep `noNorthOverhang` / clamp north against `northGapTiles` so it doesn't poke the neighbour.
6. Optional cosmetic that can ship regardless of the depth pass: small negative south-eave droop so the
   modeled overhang visibly caps the door's top.

**API:** `drawRoofForBuilding(...)` signature `{stories, northGapTiles, imageCache, roofTexture}` is
**frozen by COORDINATION**; ROOF owns internals only. The single shared touch — wiring fascia in
`roofTexFor` (in `building-occluder.js`) — RENDER lands on ROOF's behalf via a small patch.

### Lane D — INTERIOR-MODEL (footprint/facade/bounds + interior render)
**Owns:** `src/render/{interior-gl,interior-renderer,active-interior,floor-view}.js` + sim model files
`sim/world/buildings/{footprints,building-floors,blueprint-node,floor-layout,layout}.js`.
**Fix — interior 1 tile short on W/E:** the exterior draws `south_corner_west` at `sx-t` and
`south_corner_east` at `sx+t` (one tile OUTSIDE the footprint), but `interior-gl.js` hugs the footprint
exactly → interior reads one tile narrower on each side. **Footprint data is identical on both sides** —
this is purely the exterior corner-extension render offset the interior doesn't mirror.
- User prefers the WIDER exterior shape → **do NOT touch the generated footprint or exterior corner
  placement** (they feed claims, the `9` click-set, shadows, the roof clamp, floor-partition, and the
  5,040-task asset matrix).
- Extend the INTERIOR side-wall pilasters + back-wall end-caps + floor blit outward by the SAME one-tile
  corner extension (`interior-gl.js` E/W pilaster loop `:148-165`, floor + N wall `:107-141`), driven off
  the **visual facade-extension band** (NOT `layout.bounds`/`units`, which stop at the footprint).
- **Keep player collision on the TRUE footprint** (`active-interior.js` `isWalkableLocal`/`isInFootprint`)
  so the extra visual tile stays non-walkable.
- Depends on RENDER's final corner/E/W geometry (so interior mirrors the right screen columns).

### Lane E — COORDINATION (integrator + serialized hot files + depth pass)
**Owns the SERIALIZED hot files** (only this lane writes them; other lanes file by-name patches):
`sim/world/buildings/resolved-buildings.js`, `building-material-registry.js`,
`src/render/building-renderer.js` (shared sprite loader), `src/render/wall-config.js`,
`src/render/canvas-renderer.js` (the `~450-598` draw-order block), `building-tile-query.js`,
`sim/world/buildings/terrain-suitability.js`, and the `worker-chunk-renderer.js` terrain-bake side.
**Responsibilities:**
1. Fix the **`img.src`-before-`img.onload`** latent bug in `building-renderer.js:45-49` ONCE.
2. **Freeze** `wall-config.js` geometry constants (`wallHeight=4`, offsets, `ewTileHeight`, `ewXOffset`)
   and the `drawRoofForBuilding` signature; land any constant change atomically with its
   occluder/shadow/interior consumers in one commit.
3. Apply ASSET/RENDER filename-scheme requests to `building-material-registry.js` (`wallPieceFile` switch
   `@1025`, `wallAssetDir`/`roofAssetDir` `@1014`, `BUILDING_MATERIALS` pool `@1005`) atomically with the
   asset rename + the three importers (`building-occluder.js:21`, `door-leaves.js:11`,
   `resolved-buildings.js:13`). Add `south_window__{shape}__open` + window-overlay + doorway-hole cases.
4. Wire the NEW window-overlay bitmap blit into `canvas-renderer.js` next to the door-leaf blit (RENDER
   hands COORDINATION the builder function; COORDINATION owns the single blit line + pass order).
5. **The depth pass (decision #1):** replace the flat Y-split behind/front bitmaps in `building-layer.js`
   with a per-building textured quad written to the scene FBO carrying a geometry-z depth from the south
   baseline (`b.y+bb.h`), `DEPTH_TEST` + `depthFunc(LESS)` + `depthMask(true)`. Fold the swung door leaf
   (and the window overlay) into that SAME depth-tested pass at the feature tile's depth. Drop the
   behind-before/front-after split-blit + trailing door-leaf blit (`canvas-renderer.js:455-463,582-597`).
   **Coordinate with the `gl-compositor.js` owner** — reuse its `writeBuildingDepth`/geometry-z/spotlight-
   discard; do not rewrite it. Re-verify player-vs-building ordering + the spotlight see-through still work,
   and that the door-leaf/window/roof passes share the EXACT baseline-depth mapping
   (`building-depth.js tileDepth / DEPTH_SCALE`) as the sprite vertex shader, or seams reappear at the
   player split.
6. Run the **pre-commit ownership-glob guard** (below).

---

## Git discipline (the answer to "4–6 agents without painful reconciliation")

**ONE shared working tree, all lanes on `motion-eval-system`. Do NOT spin up a worktree per agent** — the
existing worktrees already share a single object store + index, so more worktrees do not isolate the
index; they multiply the surface for the confirmed "`git add -A` swept another session's staged files"
bug. True isolation needs separate clones → painful binary-PNG re-sync. Not worth it.

Discipline instead:
1. **Stage by name only.** Never `git add -A` / `git add .` / `git commit -a`. Each lane stages exactly
   its owned paths.
2. **Pre-commit ownership guard** (COORDINATION-owned): runs `git diff --cached --name-only` and ABORTS if
   any staged path falls outside the committing lane's ownership glob.
3. `git status --porcelain` → assert only-my-paths before every commit.
4. Commit frequently and small.
5. If a lane needs an isolated experiment, use a fresh branch in the SAME default tree, not a new worktree.
6. Keep the other worktrees (`f2-pool`, `f5-wiring`, `perf-opt`) out of this work entirely.

## Conflict hotspots (all SERIALIZED through COORDINATION)

| File | Colliding interest | Mitigation |
|---|---|---|
| `resolved-buildings.js` | ASSET (`stampMaterials@33`) + INTERIOR (`relocate@80`/`northClaim@237`) | COORDINATION-only writer; both file by-name patches |
| `building-material-registry.js` | ASSET (table rows) + RENDER (filename switch) | atomic rename+switch+3 importers in one commit |
| `building-occluder.js` | RENDER (writer) + ROOF (call-site) + INTERIOR (reads geometry) | sole writer RENDER; frozen roof call signature; INTERIOR mirrors never edits |
| `wall-config.js` | RENDER (E/W consts) + INTERIOR + SHADOW | COORDINATION-only; const change ships with consumers |
| `canvas-renderer.js:450-598` | RENDER + INTERIOR + ROOF (via occluder) | COORDINATION wires passes; no lane reorders unilaterally |
| `building-renderer.js` | shared sprite loader (3 importers) | COORDINATION fixes loader once; nobody forks it |

## Sequencing & merge order

1. **ASSET pure-asset fixes** (opaque daub, east-corner dup, run-bond, 8px corner seam, fascia confirm) —
   no code; lands first so see-through/corner bugs resolve and RENDER calibrates against correct pixels.
2. **COORDINATION foundation:** `building-renderer.js` loader fix + freeze `wall-config.js` constants +
   freeze `drawRoofForBuilding` signature.
3. **BUILDING-RENDER:** stretch (isotropic crop) + seam (boundary-extent) + corner back-fill. Local, low-risk.
4. **ROOF:** continuous slope-UV + full-64 sampling + re-enabled accents + fascia wiring + N/E/W skirt +
   overhang. Runs **parallel to step 3** (only shares the frozen call signature).
5. **ASSET 32px re-crop** (pilot) → **BUILDING-RENDER** retires the `isPilot` 4-bay branch + E/W full-height
   facade + `edge_ew` quoin re-sample + door-leaf doorway-hole fit + NEW `window-overlay.js`.
6. **COORDINATION:** wire the window-overlay blit + registry window-open/doorway-hole cases (atomic with
   step 5 RENDER builder).
7. **INTERIOR-MODEL:** `interior-gl.js` W/E +1-tile facade-extension to match exterior (depends on RENDER
   corner/E/W geometry being final).
8. **COORDINATION + gl-compositor owner:** the per-building GPU depth pass (decision #1). Lands as a
   coordinated change; re-verify spotlight see-through + player ordering. Independent of the cosmetic lanes
   (all of which ship value without it).

**Hard ordering constraints:** ASSET-before-RENDER for any pixel-consuming fix; FACADE/BOUNDS-before-
INTERIOR; LOADER/CONSTANTS-before-everything; ROOF is the most independent lane; the depth pass is
gated on coordination with the compositor owner but blocks none of the cosmetic work.

## Verification (every lane)

- **Tests:** `node --test` for any model/pure logic (footprints, tenancy, material registry). Keep the
  building suite green.
- **In-game harness:** serve the game from the NODE server `:8123` (`HOST=localhost:8123`), NOT python
  `:8000` (python single-threads → chunk worker starves sprite `<img>` loads). Hard-reload / incognito
  (workers cache). Use raw CDP `Page.captureScreenshot` (Playwright `page.screenshot` hangs on the rAF
  game). Spawn at a building via `?x=&y=`; press `9` for the building overlay; click a building for the
  occupancy panel.
- **Roof:** validate in `tools/roof-ingame-preview.html` before shipping the slope-UV change.
- **Asset gate:** a validation that rejects any wall-surface piece with internal alpha holes in the solid
  region (would have caught the transparent daub) + asserts left/right columns match for seamless tiling.
