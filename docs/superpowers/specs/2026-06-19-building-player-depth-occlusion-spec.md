# Building↔Player Depth Occlusion (the real fix) — design spec

2026-06-19. Replaces the heuristic `building-occluder.js` (re-draw the in-front building onto the
scene FBO + clip below the feet) with **true per-object depth occlusion**, done entirely in the GL
pipeline (CLAUDE.md rule). Supersedes the overlay-blit occluder.

## Problem
Buildings (walls+roofs) are baked into the chunk bitmaps — the GL *background*, always below the
sprite batch where the player lives (`gl_Position = vec4(clip, 0.0, 1.0)` — sprite z hardcoded to
0). So the player always draws on top of every building, and the heuristic re-draw popped the
in-front building over other buildings. Root cause: player and buildings have no shared depth.

## Approach: a depth buffer on the scene FBO
Building-vs-building order is ALREADY correct in the bake (worker depth-sorts by south edge). We
only need the **player** (and ideally all sprites) to depth-test against building geometry. Add a
real depth buffer; write building depth; make sprites carry depth.

Depth convention: sort key = world tile baseline Y. Larger Y = more south = nearer camera = should
win. Map to GL depth `z ∈ [-1,1]` (or [0,1]) via `z = clamp((Yref - baselineY) / SPAN, -1, 1)` so
larger baselineY → smaller z (nearer). `Yref`/`SPAN` chosen around the camera tile so near-camera
content uses the usable depth range. The SAME mapping is used by the building-depth pass and the
sprite z-output — they must agree exactly.

## Pieces

### 1. Scene FBO depth attachment — `gl-compositor.js` `_ensureScene`
Create a depth renderbuffer (`DEPTH_COMPONENT16`), size = scene alloc, attach to `sceneFbo`
(`DEPTH_ATTACHMENT`); reallocate alongside `sceneTex`. `beginScene` clears `DEPTH_BUFFER_BIT` too
(clear depth = 1.0 = far). Chunks draw with depth-test OFF / depth-write OFF (terrain is the floor;
its order is fine as painter's), so the depth buffer starts empty except where we write building
depth.

### 2. Building-depth pass — NEW `building-depth.js` (mine) + a `gl-compositor` method
After the chunk blit, BEFORE the sprite batch: render the near-player buildings' wall+roof geometry
(reuse the worker-replica geometry from `building-occluder.js`) as a DEPTH-ONLY pass —
`colorMask(false,false,false,false)`, `depthMask(true)`, depth-test `ALWAYS` — writing
`gl_FragDepth` (or clip.z) = the surface's baseline-Y depth. No color (the baked color already in
the FBO is correct). This stamps "a building is HERE at depth D" into the depth buffer, aligned to
the baked pixels (same geometry → same screen position).
- Walls: each column's depth = its ground row Y (south wall ~ footprint south edge; north wall ~
  north edge). A wall billboard can ramp depth top→bottom so its base is nearer than its top.
- Roof: per-tile depth from the roof tile's footprint Y (the roof engine already produces a
  heightmap/tile grid; map each roof tile to a depth). This is why depth beats billboards — the
  roof gets correct per-pixel depth for free.

### 3. Sprite depth — `gl-compositor.js` SPRITE_VERT_SRC + the sprite draws  ⚠ CROSS-AGENT SEAM
- Vert: `gl_Position.z = depthFromBaseline(aPSR.y)` (currently 0). Gate behind a uniform
  `uDepthOn` (default 0 = today's behaviour) so flora ordering is unchanged unless enabled.
- Player draw (`drawPoolSprites` for the 1 player instance): enable `DEPTH_TEST` (`LEQUAL`),
  `uDepthOn=1`. The GPU now discards player pixels behind building depth → correct occlusion.
- Flora (`drawAnimSprites`): keep `uDepthOn=0` initially (painter's, unchanged). Phase 2: enable
  for flora too so flora behind buildings is occluded — needs the depth values to agree with the
  existing baseline sort to avoid z-fighting.
> This shader + sprite-draw change is in the GL/sprite subsystem another agent is live-editing
> (interior-GL migration). Coordinate: either they land the z-output/uDepthOn, or I do it in the
> worktree and we reconcile at merge. Keep it minimal + gated so it's a no-op by default.

### 4. See-through ("spotlight") — SOFT fade via a two-pass player (DECIDED 2026-06-19)
A binary depth test can't feather, so draw the PLAYER twice:
- Pass A: depth-test `LEQUAL`, full alpha → the player where it's IN FRONT of buildings (and
  correctly hidden where behind).
- Pass B: depth-test `GREATER` (so it draws ONLY where the player is behind a building = occluded),
  with a SOFT RADIAL ALPHA — the frag multiplies alpha by a smoothstep falloff from the player's
  screen centre/radius → the player is softly revealed THROUGH the building, fading at the rim. No
  doubling (Pass B's GREATER test fails wherever Pass A already drew). Matches the interior
  south-wall spotlight feel the user approved.
Needs: the player issued as TWO draws with the two depth funcs, and a player-only frag path with
`uPlayerCentre` + `uPlayerRadius` for the soft alpha. The building-depth pass then needs NO hole —
it stamps building depth everywhere; the softness lives entirely in Pass B's alpha.

### 5. Wiring — `canvas-renderer.js`
Inside `if (glScene)`, after `drawField2Animations` (sprite batch) … no — the depth pass must run
BEFORE the sprite batch. Order: chunk blit → **building-depth pass** → sprite batch (player
depth-tested) → present. Today the sprite batch is inside `drawField2Animations` (line 452), the
present at 529. The building-depth pass slots between the chunk blit (~313) and `drawField2Animations`.
Retire the `building-occluder` overlay call (the heuristic) — depth replaces it.

## Testing
Headless: scene is `#glTerrain`; capture via `toDataURL` in a rAF. Build a two-building scene
(player behind A, A behind B); confirm: player hidden behind A except the hole; A still behind B
(baked order intact); roof occludes correctly. Verify `uDepthOn=0` path is pixel-identical to today
(no flora regression). The depth buffer can't be read via toDataURL — assert via the visible result
+ a debug colour mode (write building depth to color) during bring-up.

## Rollout
Gated by `window._depthOcclusion` (default off until verified) so it can ship dark and flip on. The
heuristic `building-occluder.js` stays until depth is proven, then is deleted.

## Risks
- Cross-agent sprite-shader edit (coordinate, gate, keep minimal).
- z-fighting / flora ordering when `uDepthOn` extends to flora (phase 2).
- Soft see-through with a binary depth test (the see-through design decision).
- Hard to fully browser-verify in a worktree (loaded-area bake); rely on synthetic two-building
  captures + the gated no-op proof.

## As-built (2026-06-20) — deviations the implementation forced
Shipped to `motion-eval-system`, `window._depthOcclusion` **default-ON**. Two things changed from
the design above during bring-up; the spec text above is the original intent, this is the truth:

1. **Geometry-z, NOT `gl_FragDepth`.** §2 floated "`gl_FragDepth` (or clip.z)". `gl_FragDepth`
   writes are **silently ignored by Chrome-on-Windows (ANGLE/D3D)** — the depth pass ran but wrote
   nothing, so there was zero occlusion. Final form writes depth from the QUAD's `gl_Position.z`
   (`DEPTHWRITE_VERT_SRC` `uDepthZ`) — one flat depth per building (its south-baseline NDC z), one
   draw per near building, `depthFunc(LESS)` so the nearer building wins where silhouettes overlap.
   `building-depth.js` is `nearDepthBuildings()` + `renderBuildingSilhouette()` (per-building
   silhouette, alpha = mask), NOT the single grey-encoded `buildBuildingDepthBitmap` the design
   implied. A flat per-building depth (not the per-pixel roof ramp §2 hoped for) is enough for
   player↔building occlusion at the scales seen; per-pixel roof depth is a future refinement.

2. **See-through default = 0.45, not 0.7.** The long "still draws on top" bug was NOT a depth
   failure — depth occlusion works (proven: `_depthSeeStrength=0.02` makes the player vanish behind
   a building). The "solid player on top" was Pass B (the see-through ghost) drawn at 0.7 alpha,
   which reads as solid. Default lowered to **0.45** (`window._depthSeeStrength` overrides; the
   shader floor is `typeof see === 'number' ? see : 0.45` so an explicit 0 is honoured). At 0.45 the
   occluded player is a clear soft ghost — visible enough to navigate, not solid.

Verified working via `#glTerrain` capture (player behind a multi-storey building → soft ghost
through the wall). Follow-ups unchanged from `project_building_occlusion_gl` memory: per-frame
full-screen silhouette upload (optimise to sub-rect), flora occlusion only in the pooled path,
delete the heuristic `building-occluder.js` once battle-tested.
