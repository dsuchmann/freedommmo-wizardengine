# Building Façade-Block System — Design Spec (grassland pilot)

> Status: APPROVED-BY-AUTONOMY (user delegated full autonomy 2026-06-21 night; "answer
> your own questions, build a pilot, I'll see it in the morning"). Supersedes the
> 2026-06-21 tile-based building-render-quality approach for the EXTERIOR. The tile
> approach is preserved behind a flag as the fallback.

**Goal:** Render buildings as large PixelLab-generated façade **blocks** (whole-building
sprites for the common case; modular segments for the rare large/tall case) instead of
assembling them from 32px wall/roof/door/window tiles. Buildings remain spatial entities;
the sprite is a *skin* on the same footprint, routed through the existing GL pipeline.

---

## 0. Why (de-risk result, 2026-06-22)

`create_map_object` (PixelLab) was used to generate the same grassland cottage twice:
- `high top-down` → a clean ISO cottage. Beautiful but ~45° rotated → clashes with the
  game's axis-aligned footprints/roads. **Rejected.**
- `low top-down` → a **front-three-quarter elevation** (south wall face-on, roof above,
  slight side reveal). **Matches the game's existing convention** (`roof-ingame.js`
  `makeGameView` = flat top-down ground + south wall billboarded up + roof lifted above the
  stacked wall band). **Selected as the canonical view.**

Both saved to `assets/pixelab/buildings/facade/_pilots/`. The quality is decisively better
than the tile-assembled walls the user rejected. This validates the pivot.

**Tool facts that shape the design:**
- `create_map_object` canvas max **400×400 px**; returns in ~15–30s; ~$0.01–0.02 each.
  Objects **auto-delete after 8h** → every generation must be downloaded to disk immediately.
- **No native seamless edge-to-edge across separate objects** (inpainting caps at 192²).
  PixelLab's strength is *coherent discrete objects*, not tiling. ⇒ lean on whole-building
  sprites (zero seams); segment only at natural architectural breaks.

---

## 1. Architecture: keep / replace

**KEEP unchanged (placement + footprint + interior source):**
- `sim/world/buildings/*` — `resolveBuildingsInRange`, `generateFootprint`, `stampMaterials`,
  `building-floors.js` (`floorCount`/`aboveGroundFloors`), taxonomy/layout. These decide
  *where/what/how-big/how-many-stories*. Untouched in shape.
- `building-renderer.js#getCachedBuildings()` / `building-tile-query.js#queryBuildingTile()` —
  the shared resolved-set data seam. The new renderer consumes the same `b` objects.
- The GL plumbing: `building-layer.js` (Y-split behind/front), `gl-compositor.js`
  `drawSceneOverlayBitmap` / `drawBuildingSpotlightOverlay` / `writeBuildingDepth`,
  `canvas-renderer.js` draw() wiring (lines ~455–597). **No changes** — sprite blocks
  inherit lighting/CRT/day-night/depth exactly like the old walls did.

**REPLACE (the one seam):**
- `building-occluder.js#drawBuildingTextured(ctx, b, camX, camY, tilePx, w, h)` (`:528`).
  Swap its body from `drawWalls()` + procedural roof to a new
  `drawBuildingSpriteBlock(ctx, b, …)`. Everything that calls it (`building-layer.js:60`,
  depth pass) is unchanged.
- Disable, behind a flag, the old per-tile paths for sprite-rendered buildings: `drawWalls`
  (tile walls), `door-leaves.js` (decoupled door swing — the sprite's door is baked), the
  procedural roof for whole-sprite buildings (the sprite's roof is baked).

**Flag:** `window._facadeBlocks` (default ON). `false` → fall back to the old tile path
(fully preserved). New module owns the flag check at the top of `drawBuildingTextured`.

---

## 2. Projection & sizing model

- **View:** `low top-down` (front-three-quarter elevation), axis-aligned. Every generated
  sprite is authored in this view, door facing south (toward camera).
- **World scale:** source tile = 32px (`constants.js`); on-screen `tilePx` ≈ 62 at default
  zoom (runtime arg). Wall height = **4 tiles per story** (`WALL_CONFIG.wallHeight`).
  Footprints biome-independent (only materials vary).
- **Sprite → world mapping (the contract):** a sprite has a declared **anchor**:
  - `groundFrac` — vertical fraction of the sprite where the **wall-base line** (ground
    contact, where the south wall meets the footprint's south edge) sits.
  - `wallFrac` — fraction of sprite height spanned by the **wall band** (foundation→eave),
    i.e. `stories × 4` tiles of world height. Everything above is roof; below `groundFrac`
    is foundation/shadow apron.
  Placement: draw the sprite scaled so its wall band == `stories × 4 × tilePx` and its
  horizontal extent == `footprint.boundingBox.w × tilePx`, with the wall-base line landing
  on the footprint south edge screen-Y. Roof naturally extends above the north edge.
- **Resolution:** because we *scale* a fixed 400-canvas sprite to W tiles, per-tile
  resolution = `spriteW / footprintW`. For W ≤ ~16 tiles this stays ≥ ~24px/tile (near the
  32px native) → crisp. W > 16 → segment horizontally (rare in grassland).

---

## 3. When whole-sprite vs. segmented

| Case | Condition (grassland) | Render |
|---|---|---|
| **Whole-building sprite** (primary) | W ≤ 16 tiles AND stories ≤ 2 | ONE sprite, roof baked in. Covers ~90% of grassland: huts, cottages, houses, shops, crafts, chapels, small civic, barns. |
| **Vertical floor-band stack** | stories ≥ 3 | ground band (door) + repeatable upper band(s) + roof-cap band, stacked at story pitch. Seam = a floor string-course (a natural horizontal break). |
| **Horizontal bay segments** | W > 16 tiles | left-corner + middle bays + door bay + right-corner. Seam = corner pilaster/quoin. |
| **Honest-absence fallback** | no matching sprite | old procedural wall+roof (preserved) — never a fake. |

The pilot implements **whole-sprite first** (the headline quality win), then floor-band
stacking for 3+ story civic/temple. Horizontal bays are designed but lower priority.

---

## 4. Asset library (grassland)

Generate a **library keyed by archetype × size × variant**, not one-per-typeId. The ~80
typeIds map to ~12 archetypes by (footprint size class, roof form, use). Each archetype gets
2–3 variants for visual variety (rendezvous-hash pick, mirroring `wallSlug`). Open-air
"buildings" (well, fountain, market_stall, garden, bridge, monument) are objects, not façade
blocks — they keep procedural/object rendering.

Archetypes (initial; see manifest doc for prompts + sizes):
1. `cottage_sm` — hut/cottage, 1 story, thatch/timber.
2. `house` — house/longhouse, 1–2 story.
3. `shopfront` — shop/craft/tavern/inn(low), shop window + door, 1–2 story.
4. `workshop` — blacksmith/carpenter/pottery etc., chimney/open side, 1–2 story.
5. `barn` — barn/stable/granary, big roof, 1 story.
6. `civic_hall` — town_hall/library/school, grander, 1–3 story.
7. `chapel` — chapel/shrine, small steeple, 1 story.
8. `temple` — temple/monastery, tall, 2–4 story (segmented).
9. `manor` — manor/villa, 2–3 story.
10. `apartment` — apartment/inn(tall), 3–6 story (floor-band stack).
11. `round_tower` — watchtower/silo/lighthouse, round, 3+ story.
12. `tent_market` — market_stall/trading_post light structures.

Asset layout on disk:
```
assets/pixelab/buildings/facade/grassland/<archetype>/whole__v0.png        (whole-sprite)
assets/pixelab/buildings/facade/grassland/<archetype>/whole__v1.png
assets/pixelab/buildings/facade/grassland/<archetype>/band_ground__v0.png  (segmented)
assets/pixelab/buildings/facade/grassland/<archetype>/band_upper__v0.png
assets/pixelab/buildings/facade/grassland/<archetype>/band_roof__v0.png
```
A JSON manifest (`facade-manifest.json`) records per-sprite: `archetype`, `view`,
`groundFrac`, `wallFrac`, `doorXFrac`, `widthTiles`, `stories`, `variant`, `file`. The
renderer reads this manifest; the anchors are measured once post-generation (alpha analysis)
and written in.

**Post-processing (deterministic, like the wall-body tool):**
- **Trim the ground apron:** pilots bake a grass/dirt patch. Detect the green ground apron
  vs. the building silhouette and trim it (keep a thin contact shadow). The building must sit
  on real terrain, not carry its own grass.
- **Measure anchors:** from the trimmed alpha, compute `groundFrac` (bottom of opaque wall),
  `doorXFrac` (darkest vertical notch at base / or authored center), bounding box.
- Save trimmed PNG + manifest entry.

---

## 5. Footprint ↔ sprite alignment (interior consistency)

The crux for walk-in interiors:
- The sprite is scaled to `footprint.boundingBox.w` and anchored at the south edge → the
  exterior's ground rectangle == the footprint rectangle == the interior floor rectangle.
  **Interior matches exterior by construction** (both from `sections`).
- **Door:** pick/author sprites with door at `doorXFrac` (default 0.5, centered). On
  placement, ensure `footprint.doors` sits at the sprite's door column. Where the footprint
  generator's door isn't centered, snap the rendered sprite's door column to the footprint
  door tile (the sprite is the flexible side). Interior doorway derives from `footprint.doors`
  → entry lines up.
- **Stories:** `buildingFloors(b)` drives the exterior story count (which sprite / how many
  bands) AND the interior floor count. They can't disagree.

---

## 6. Interiors + automated lifts

Reuse the existing diegetic walk-in interior system (floor tiles + interior walls from
`sections`, camera glide, spotlight see-through, roof/exterior fade on enter). Extensions:
- On enter: fade/hide the **exterior sprite** (roof + façade) instead of the old tile walls.
- **Per-floor:** each floor = same `sections` at a higher z; interior renders the current
  floor only (others dimmed/clipped), per the interior-visual-vision.
- **Automated lift:** a lift pad tile placed in a section corner. Stepping on it triggers a
  smooth vertical transition to the adjacent floor — world recedes (+bokeh/clouds for upward),
  per spec. Directional **stairs** are the alternate (movement-dir driven). Pilot ships a
  simple automated lift between floors; stairs are a follow-up.

---

## 7. Roofs

- **Whole-sprite buildings:** roof is **baked into the sprite** (see pilots — looks great,
  zero wall/roof seam). The procedural roof system is **bypassed** for these.
- **Segmented buildings:** a generated `band_roof` cap, or procedural fallback.
- The procedural roof engine (`tools/roof/*`) is **kept** as the honest-absence fallback and
  for compound/odd footprints with no matching sprite. Not deleted.

---

## 8. Depth & draw order

Reuse the per-building depth pass: derive the silhouette from the **sprite alpha** (instead
of the tile geometry) and feed `writeBuildingDepth` so cross-building overlap and
player-behind/in-front occlusion work per-pixel. The Y-split behind/front layer
(`building-layer.js`) is unchanged — sprites slot into it.

---

## 9. Honest absence & no-mock compliance

- A type with no sprite → procedural fallback (real geometry) or nothing, never a fake.
- Buildings remain spatial structures (footprint/sections/floors/doors are real and drive
  collision, interior, claims). The sprite is *rendering only* — it does not invent
  structure. This satisfies "buildings are spatial structures, never sprites" in spirit: the
  STRUCTURE is spatial; the SKIN is a sprite. (The old rule's intent was "don't fake the
  building as a flat billboard with no interior" — here the interior/structure are fully
  real; only the exterior texture is a generated image, same as a wall tile is.)

---

## 10. Build order (critical path to "looks great in the morning")

1. Lock the archetype manifest + prompts (`facade-manifest`). 
2. Generate the grassland whole-sprite set (~12 archetypes × 2 variants) + trim + measure
   anchors. (PixelLab batch.)
3. Build `building-facade.js`: manifest loader, `pickFacade(b)` (typeId→archetype, size,
   rendezvous variant), `drawBuildingSpriteBlock()` (scaled+anchored draw), flag.
4. Wire into `drawBuildingTextured` seam; disable old tile/door/roof paths for sprite
   buildings behind the flag.
5. Depth from sprite alpha.
6. Browser-verify in the seed-42 grassland settlement (exterior looks great, aligned).
7. Interior consistency: exterior-fade on enter; verify floor matches footprint.
8. Automated lift between floors; verify multi-story.
9. Commit to `building-facade-blocks`; morning handoff notes.

Exterior-looks-great (steps 1–6) is the headline deliverable; interiors+lifts (7–8) follow.
