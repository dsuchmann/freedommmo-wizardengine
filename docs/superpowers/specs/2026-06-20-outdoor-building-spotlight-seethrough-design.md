# Outdoor Building See-Through Spotlight (two-layer bake) — design spec

**Date:** 2026-06-20
**Status:** Design — approved (soft-fade edge, depth-buffer variant) → pending spec review → plan
**Strata:** S3 Blueprints (building render) ↔ render pipeline
**Builds on:** `2026-06-19-building-player-depth-occlusion-spec.md` (the GL depth buffer + `writeBuildingDepth` + geometry-z, shipped `098d4212c`).

> **Implementation decision (2026-06-20):** during planning, the per-building **depth-buffer**
> mechanism described below proved fiddly (player must draw last, two depth/color passes, LEQUAL/LESS
> z-fighting). The implementation uses the simpler, equally-GL **Y-split** mechanism instead — author
> buildings into two bitmaps (behind / in front of the player by south baseline), blit *behind*
> before the sprite batch and *front* after, with the GPU spotlight on the front bitmap. Identical
> visual (real terrain in a soft spotlight); player-vs-building order is the Y-split (matching the
> sprite sort) instead of the depth buffer. See the plan:
> `docs/superpowers/plans/2026-06-20-outdoor-building-seethrough.md`. The sections below are retained
> as the design rationale; the Y-split is the as-built mechanism.

## Goal

When the player walks **behind** a building outdoors, open a soft circular **spotlight** in the
building around the player so you see **through** it to your character standing on the **real
terrain** — exactly like the interior see-through wall. NOT the current behaviour (a faint ghost of
the player drawn on top of an opaque roof; the roof is still visible and the player reads as a
translucent overlay).

The whole effect must stay **in the GL loader and run on the GPU** (user directive): the building
layer composites through the scene FBO before the present pass (so it inherits lighting / day-night
/ fog / CRT), and the spotlight + player-vs-building occlusion are GPU operations. No main-thread 2D
`ctx` overlay drawn on top of the GL canvas.

## Problem (why the current approach can't do this)

Walls **and** roofs are baked into the **same** chunk bitmap as the terrain
(`worker-chunk-renderer.js` `renderChunkToBitmap()` — one OffscreenCanvas, one ctx). They flatten
into one opaque image, so the terrain pixels **under** a roof are permanently overpainted and gone.
There is no separable building layer to fade and no real ground hiding beneath it. That is why the
shipped depth-occlusion work could only **ghost the player on top** — it had nothing real to reveal.

To see *through* the building to the terrain, the terrain under the building must exist as its own
layer. So buildings must leave the terrain bake and become their own render layer.

## Key facts that make this cheap and safe

- **Removing buildings from the terrain bake is almost entirely subtractive.** Walls+roofs enter the
  chunk bitmap in exactly two places: the **wall post-pass** and the **roof bake** in
  `worker-chunk-renderer.js`. (The older per-tile wall draw is dead code behind `if(false)`.) Delete
  those two; everything else in the bake is untouched.
- **Building *floors* stay baked.** Floors are ground-plane — the player walks **on** them and the
  sprite draws above — and the per-tile `_buildingFloor` flag drives F0/F1/F3 decoration suppression
  (grass must not grow through floors). Floors are not part of the see-through and must not move.
- **Nothing in the game reads baked building *pixels*.** Collision, movement, interiors
  (`active-interior.js`), and every `queryBuildingTile`/`queryBuildingWall`/`isBuildingClaimed` call
  run off the resolved footprint/wall/door **data model** (floor/wall index Maps), never
  `getImageData`. Removing walls/roofs from the bitmap breaks no gameplay — this is a render-only
  change.
- **The render-time building re-renderers already exist and are pixel-exact mirrors of the bake:**
  `building-occluder.drawBuildingTextured()` (= `drawWalls` + `roof-ingame.drawRoofForBuilding`), and
  the global south-edge sort (`building-occluder.js`, `occ.sort((a,b) => (a.y+bbh_a) - (b.y+bbh_b))`).
- **The depth buffer + geometry-z pass already ship** (`gl-compositor.writeBuildingDepth`,
  `DEPTHWRITE_VERT_SRC` with `uDepthZ`, scene FBO `DEPTH_COMPONENT16` renderbuffer). We extend, not
  invent.

## Why a single flat overlay is WRONG (rejected)

A tempting shortcut is one full-viewport building bitmap drawn at the player's depth with
`depthFunc(LESS)`. Rejected: once buildings are no longer in the terrain bake, a quad gated at the
player's depth would **discard every building behind (north of) the player** — those fail `LESS` and
there is nothing baked underneath, so they vanish. The building layer must render **all** visible
buildings with correct building-vs-building order, and resolve player-vs-building separately.

## Architecture — three pieces

### 1. Worker bake: drop walls+roofs (subtractive)
In `worker-chunk-renderer.js` `renderChunkToBitmap()`: remove the wall post-pass and the roof bake.
Keep the building floor + foundation-border composite and the `_buildingFloor` flag exactly as is.
The chunk bitmap now contains terrain + decoration + building **floors** only. Real terrain is
present everywhere a building stands. Worker output shape (`{type:'chunkPainted', …, bitmap}`,
transferable) is unchanged — no protocol change, no second texture, no extra VRAM.

> The bake runs in a web worker (CPU-in-worker is allowed — the directive is about the live per-frame
> compositing being GPU). We are *removing* work from the worker, not adding.

### 2. Building GL layer: per-building textured quads with color + depth + spotlight
A new render pass, into the scene FBO, **after** the sprite/player batch's depth groundwork and
**before** `presentScene` (the slot currently holding the fallback `drawSceneOverlayBitmap(_occ)` in
`canvas-renderer.js`).

For each **visible** building, sorted far→near by south edge `b.y + boundingBox.h` (gives correct
building-vs-building painter order, including cross-chunk straddlers — strictly better than today's
per-chunk ordering):

1. Get the building's cached **textured** bitmap (walls + procedural roof) via
   `drawBuildingTextured`. Cache it per building; re-render only when the building or zoom changes
   (reuse the macro-cell caching pattern from the earlier per-frame-building perf fix), so roofs are
   not re-tessellated every frame. Upload to a reused GL texture.
2. Draw it as a quad at the building's **baseline depth** using **geometry-z**
   (`gl_Position.z = uDepthZ`, the south-baseline NDC z — the same mapping `writeBuildingDepth` and
   the sprite shader use; `DEPTH_SCALE = 1/64`, `refY = (camY + h/2)/tilePx`). **Not `gl_FragDepth`**
   (silently ignored on Chrome/Windows ANGLE/D3D).
3. State: `enable(DEPTH_TEST)`, `depthFunc(LESS)` (nearer building wins overlaps), **`depthMask(true)`**
   (this pass writes building depth that the player tests against), premultiplied blend
   `ONE / ONE_MINUS_SRC_ALPHA`. Restore state afterward (`depthFunc(LEQUAL)`, `disable(DEPTH_TEST)`,
   `depthMask(true)`, `disable(BLEND)`, unbind VAO) exactly like `writeBuildingDepth`.

This single pass replaces BOTH the old `writeBuildingDepth` (depth-only silhouette) and the dormant
`building-occluder` color overlay: it writes building **color and depth together**, per building.

### 3. Spotlight = fragment shader (the hole)
The building fragment shader opens the hole around the player on the GPU:

```glsl
// uniforms: uTex (building texture), uPlayerPx (vec2, player screen center in FBO px),
//           uSpotInner (float), uSpotOuter (float)
float d    = distance(gl_FragCoord.xy, uPlayerPx);
float hole = smoothstep(uSpotInner, uSpotOuter, d); // 0 at player → 1 outside the radius
if (hole < HOLE_EPS) discard;                       // inner hole: no color AND no depth written
                                                    //   → player not occluded here → shows through
vec4 c = texture(uTex, vUV);
outColor = c * hole;                                // premultiplied: soft color fade at the rim
```

- **`discard` inside the inner hole** writes neither color nor depth, so the player (drawn
  depth-tested) is **not** occluded there and shows through on the real terrain.
- **Soft color fade** (`* hole`, premultiplied) gives the smooth rim from clear-at-player to
  solid-building-at-the-radius. Approved edge = **soft fade**, radius ≈ `tilePx * 2.6`, inner ≈
  `outer * 0.45`, center raised to the torso (`playerScreenY - tilePx*0.6`), matching the interior
  spotlight and `building-occluder`'s existing `SPOT`.
- **Orientation caveat:** `gl_FragCoord` origin is bottom-left in the FBO; the player screen center
  is top-left CSS px. Flip Y (`uViewport.y - playerPx.y`) if it reads inverted — **verify by
  pixel-sampling in-game** (the interior-walk-in lesson).

### Player draw
Keep the player depth-tested (`LEQUAL`) against the building depth written in piece 2 → occluded
behind buildings everywhere **except** the spotlight hole (where the building wrote no depth), where
it shows on real terrain. **Delete the old two-pass see-through ghost** (`drawPoolSprites(...,true)`,
`uSeeThrough`, `_depthSeeStrength`) — the hole-in-the-building reveals the real player directly, so
the ghost is obsolete.

## Render order (per frame, all inside the scene FBO → then present)
```
beginScene (clear color + depth=1.0)
  → draw terrain chunks         (no buildings now; real terrain under building footprints)
  → BUILDING DEPTH pre-pass     (per building, geometry-z; spotlight DISCARD around player so the
                                 hole has NO depth → player won't be occluded there)
  → sprite batch incl. PLAYER   (depth-tested LEQUAL vs building depth; no ghost pass)
  → BUILDING COLOR layer        (per building, far→near: textured color; same geometry-z + same
                                 spotlight discard/soft-fade around the player)
presentScene                    (lighting / day-night / fog / CRT applied to all of it)
```
The depth pre-pass and the color pass share the same per-building geometry-z and the same spotlight
discard, so: the player depth-tests against building depth (occluded behind buildings), but inside
the spotlight hole the depth pre-pass wrote nothing, so the player is drawn there — and the later
color pass also discards there, leaving the already-drawn player + real terrain visible. See "Open
implementation detail" for why this two-pass split (detail (a)) is preferred.

### Open implementation detail (resolve in the plan, not a design fork)
The player must depth-test against building depth, but the player is drawn before the building color.
Two equivalent orderings:
- **(a) Depth pre-pass then color pass:** keep a `writeBuildingDepth`-style depth-only pass *before*
  the sprite batch (so the player can test), then a building **color** pass *after* the sprite batch
  (with the spotlight). The depth pre-pass must apply the **same** spotlight `discard` so the hole's
  depth is absent and the player shows. Two building passes, depth shared.
- **(b) Single building pass before the player, player tested, then re-reveal:** more fragile.

Recommend **(a)**: a depth pre-pass (spotlight-discarded) + a color pass (spotlight-faded), both
per-building, sharing the geometry-z mapping. It cleanly separates "what occludes the player" (depth,
hard hole) from "what you see" (color, soft rim).

## Building-vs-building ordering
Resolved by the **global south-edge painter sort** over the full visible set (`getCachedBuildings()`),
already implemented in `building-occluder.js`. The depth buffer resolves only **player**-vs-building.
Going global removes the chunk-seam ordering artifacts the current per-chunk bake can produce for
straddling buildings.

## Performance
- Per-building textured bitmaps are **cached** and re-rendered only on change (building geometry /
  zoom), reusing the macro-cell cache pattern. Steady state = a handful of small texture draws +
  zero re-tessellation. This is the class of cost previously fixed by macro-cell caching; we apply
  the same fix preemptively.
- VRAM: no new per-chunk textures (the rejected per-chunk-layer path would have added ~144–400 MiB).
  Building textures are small per-building, bounded by the visible set.
- The chunk-upload throttle and 600-frame texture eviction are untouched (terrain layer unchanged
  except it now bakes *less*).

## Honest absence (no-mock)
If the building GL layer is absent/disabled (`window._buildingLayer === false` fallback), the world
shows terrain with building **floors** but no walls/roofs — an honest "buildings not rendered yet"
state, not a fake. Gameplay (collision/interiors/queries) is unaffected because it never read
building pixels. The shipped depth-occlusion path remains available as the previous behaviour for
A/B comparison during bring-up.

## Considerations / must-verify
- **Building shadows** (`building-shadow.js`, ground-drape pass) must keep rendering after walls
  leave the bake — confirm shadows are a separate pass and still appear (and ideally show inside the
  spotlight hole as ground content). If shadows were riding on the bake, move them to a pass before
  the building layer.
- **Floors + `_buildingFloor`** stay baked; verify F0/F1/F3 decoration suppression still holds (no
  grass through floors).
- **Geometry-z, not `gl_FragDepth`** (ANGLE) — for both the depth pre-pass and any z the color pass
  needs.
- **Spotlight center Y-orientation** — pixel-sample to confirm the hole is on the player, not
  mirrored.
- **F2–F8 flora vs buildings:** flora-behind-building occlusion is out of scope for this slice
  (flora doesn't write depth); the player is the priority. Track as a follow-up.
- **Interior path** (`_inside`) is unchanged — the building layer is the outdoor (`!_inside`) path.

## Testing / verification
Headless, scene = `#glTerrain`, capture via `toDataURL` in a rAF; teleport via `window._player.x/y`
and nudge ~8s for the worker to re-bake (the terrain bitmap changes — buildings gone). Verify:
1. Player **behind** a 1- and 2-storey building → a soft circular hole reveals the player standing on
   **terrain** (grass/ground texture, not roof) with the building solid and present-lit outside the
   hole.
2. Player **in front of** (south of) a building → building is fully solid over... nothing of the
   player; player visible; no hole artifacts.
3. Buildings **north of** the player still render (the flat-overlay bug does not occur).
4. Two overlapping buildings, player behind the far one and in front of the near one → correct
   stacking (near over far via south-sort; player over near, under far appropriately).
5. A/B `window._buildingLayer` to prove the layer; confirm floors + decoration suppression intact.

## Rollout
Gated by `window._buildingLayer` (default-on once verified). The worker bake change is behind the
same flag conceptually — when the layer is off, fall back to the shipped depth-occlusion/ghost path
(buildings still in the bake) for comparison. Retire the dormant heuristic `building-occluder`
overlay path and the see-through ghost once the layer is battle-tested.

## Files to change
- `src/render/worker-chunk-renderer.js` — remove wall post-pass + roof bake (keep floors).
- `src/render/gl-compositor.js` — new building-layer method(s): per-building textured color pass +
  spotlight fragment shader; extend/share the geometry-z depth pre-pass; remove the obsolete sprite
  see-through (`uSeeThrough`) once the ghost is gone.
- `src/render/building-occluder.js` / `building-depth.js` — promote `drawBuildingTextured` + global
  south-sort to the always-on building author; drop the CPU `destination-out` spotlight + the
  `clipBelowFeet` hack.
- `src/render/canvas-renderer.js` — re-wire the slot: terrain → sprites → building layer (depth
  pre-pass + color/spotlight) → present; remove the ghost wiring.
- `src/render/field2-animator.js` — remove the second `drawPoolSprites(...,true)` player ghost draw.

## Risks
- **Building-vs-building color is NOT solved by depth** — must author with the global south-edge
  sort; per-chunk or unsorted draw pops near/far buildings.
- **`gl_FragDepth` silently ignored on ANGLE/D3D** — use geometry-z (`gl_Position.z`) everywhere.
- **Depth/color ordering** so the spotlight `discard` reveals the already-drawn player (the depth
  pre-pass + color pass split, detail (a)).
- **State restoration** after the depth + color passes (depthFunc, depthMask, BLEND, VAO) or it
  corrupts present / the next frame.
- **Per-frame building cost** if the cache is skipped — re-tessellating all visible roofs/walls every
  frame regresses frame time. Cache is part of this slice, not a follow-up.
- **Shadows / floors regressions** — verify both survive walls leaving the bake.
- **`gl_FragCoord` Y origin** — verify the spotlight isn't vertically mirrored.
