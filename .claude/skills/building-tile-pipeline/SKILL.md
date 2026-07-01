---
name: building-tile-pipeline
description: Use when generating or expanding ANY PixelLab building asset for ANY biome — wall bases, tile states, door/window animations, ROOF surface textures, and gable tiles. Encodes the deterministic per-material pipeline, the tiles-not-objects rule for roofs/gables, and points at the manifest/tracker that computes what to do next — so generation is driven by disk state, never memory.
---

# Building Tile-Corpus Asset Pipeline (EXTERIOR)

Generate the full **exterior** building art for one biome at a time: per-material wall pieces + the gable, and
per-roofSlug roof slabs. Interiors are a **separate skill** (floors / interior walls / furniture / stairs) —
they derive from these exterior bases, so run the exterior first. See
`docs/superpowers/specs/2026-06-22-interior-tile-corpus-manifest.md`.

**Corpus layout (disk is the source of truth):**
```
assets/pixelab/buildings/
  tiles/<biome>/<material>/  ground_{plain,window,door,left_corner,right_corner}__v0.png   ← wall OBJECTS
                            upper_{plain,window,left_corner,right_corner}__v0.png           ← wall OBJECTS (derived)
                            gable__v0.png  (+ gable__v1.png)                                 ← TILE (create_tiles_pro)
                            anim/{door,window}/frame_NNN.png                                 ← OBJECT animations
  tiles/<biome>/_pixellab_ids.json        ← { materials: {<mat>: {...ids, gable}}, roofs: {<slug>: {v000..,fascia}} }
  roof/<biome>/<roofSlug>/   roof_top__v000..v003.png  (+ roof_fascia.png, optional)         ← TILES (create_tiles_pro)
```

## ⚠ OBJECTS vs TILES — get this right FIRST (the #1 mistake)
- **OBJECTS** — `create_1_direction_object` (the wall **base**) + `create_object_state` (window / door / corner-end
  states off that base). These are the 9 wall tiles. Walls, windows, doors, ends = OBJECTS. ✅
- **TILES** — `create_tiles_pro` with `outline_mode: "segmentation"`. These are **roof surface textures + the gable
  ONLY**. NOT `create_1_direction_object`, NOT a Wang tileset (`create_topdown_tileset`).
Roofs and gables are **NEVER** objects. About to `create_1_direction_object` (or run the old
`bulk_generate_buildings.py --phase roof`) for a roof or gable? STOP — use `create_tiles_pro`.

## Rule −1 — AUTONOMY CONTRACT (run a biome to DONE without check-ins)
When asked to build/onboard/"fire off" a biome, drive it **end-to-end without pausing for approval**. Do NOT ask
"keep going or pause?", "which roof do you want?", or "is this good?" — decide and proceed. The loop is mechanical;
the tracker says what's next; the multi-agent review (Part D §3) is the quality gate that decides regenerate-vs-accept.
- **Gate every PixelLab object yourself:** `de-magenta` → `solidify` → read hole% → **auto re-roll if >25% holes**
  (bad random roll) or if the base reads as a grid/dropped-wall; never ship a flagged tile. Use **`pl-await.mjs`**
  (`node scripts/pl-await.mjs <objectId> <out.png> [--anim <animId>] [--frames N]`) to poll-until-ready + download +
  de-magenta + solidify + print hole% in ONE command — no manual poll loops.
- **Curate autonomously:** place sensible DEFAULTS (per-type roof variants into each slug folder, gable = the plain
  face tile, a biome-wide roof pool if the biome wants variety) so the game renders immediately. The studio is
  OPTIONAL human refinement, never a blocker. The review validates the defaults and regenerates the bad ones.
- **The review IS the approval.** Run the Part D §3 multi-agent review, ACT on its synthesis (regenerate / patch /
  prompt-change), re-review until clean — all without asking. Only THEN surface a single final report.
- **Only stop for a genuine blocker:** out of credits, a prompt repeatedly `status: failed` by content-policy after
  you've simplified it, or a design fork the user explicitly owns. Everything else: just do it.
- **Prefer the background `build-biome` workflow** for a fresh biome — it runs this whole loop autonomously and
  notifies on completion, so it's true fire-and-forget. Author/extend it at `.claude/workflows/build-biome.*`.

## Rule 0 — the tracker decides, not memory. Run it every cycle.
```
node scripts/build-asset-manifest.mjs           # cross-biome master view → manifest/building-asset-manifest.json
node scripts/desert-pilot-status.mjs <biome> <m1,m2,...>   # per-biome: prints MISSING / BROKEN + exact next actions
```
The per-biome tracker prints three live dimensions — **walls (v0)**, **roofs (v000–v003 per slug)**, and **v1
variants (optional)** — plus QA results, then the exact NEXT ACTIONS. Do what it says, re-run. **"Done" = on disk
AND qa-clean** — a queued PixelLab job is NOT done until its PNGs are downloaded, post-processed, and pass QA.

## What "DONE" means for a biome (the full corpus)
| Dimension | Count | Method | Lives at |
|---|---|---|---|
| Wall objects | 9 / material | `create_1_direction_object` + `create_object_state` (+ derive) | `tiles/<biome>/<material>/*__v0.png` |
| Gable | 1 / material | **`create_tiles_pro`** (segmentation) | `tiles/<biome>/<material>/gable__v0.png` |
| Wall anims | 2 / material | door = **`door-swing-anim.mjs`** (CODE-synth, no v3); window = `animate_object` (shutters) or **`glow-pulse-anim.mjs`** (fixed) | `tiles/<biome>/<material>/anim/{door,window}/` |
| Roof slab | 4 variants / roofSlug | **`create_tiles_pro`** (segmentation) | `roof/<biome>/<roofSlug>/roof_top__v000..v003.png` |
| Roof fascia | 0–1 / roofSlug *(optional)* | `create_tiles_pro` | `roof/<biome>/<roofSlug>/roof_fascia.png` |
| v1 tile variant | *optional richness* | same as its v0 | `*__v1.png` |

Roof slugs come from the biome's `roofs` array in `building-materials.json` and are **independent of wall material**
(buildings pick a roofSlug by position-hash rendezvous). Generate ~16 candidates, then CURATE them into a
**biome-wide pool** (Part C½) that applies to all roofSlugs; the renderer rotates up to `NV` per building
(`NV` = pool size, e.g. desert = 8) for town variety. Fascia is optional (grassland has it; desert's flat parapet roofs skip it →
procedural fascia). v0 is the only **required** tile; v1 is extra variety.

---

## Part A — Onboard a NEW biome (preflight, once per biome)
1. **Author materials + roofs** — add the biome to `assets/pixelab/buildings/manifest/building-materials.json`:
   `walls: [{slug,name,palette,prompt}, …]` (3–4 wall materials) and `roofs: [{slug,name,palette,prompt}, …]`
   (4 roof materials). Slugs become disk dir names and must match `roofSlug`/`wallSlug`.
2. **Author prompt tokens** — write the per-biome token doc (copy the structure of
   `docs/superpowers/specs/2026-06-23-desert-tile-corpus-manifest.md`): biome tokens `{FOUNDATION} {DOOR} {WINDOW}
   {WALLPLATE}` + per-material `{MATERIAL_FACE} {MATERIAL_EDGE} {MATERIAL_PHRASE}`. Inherit the always-keep refined
   clauses (see Hard rules). The gable reuses each material's `{MATERIAL_FACE}`.
3. **Make the dirs** — `tiles/<biome>/` and `roof/<biome>/` (per-material + per-roofSlug subdirs are created as PNGs land).
4. **Seed the ID ledger** — create `tiles/<biome>/_pixellab_ids.json`:
   ```json
   { "base_project": "<pixellab project uuid>",
     "materials": { "<material>": { "base": "", "ground_window": "", "ground_door": "", "ground_left_corner": "", "gable": "" } },
     "roofs":     { "<roofSlug>": { "v000": "", "v001": "", "v002": "", "v003": "", "fascia": "" } } }
   ```
5. **Mark tokens authored** — add the biome to `TOKENS_AUTHORED` in `scripts/build-asset-manifest.mjs`.
6. **Baseline** — run the two trackers; everything reads `pending`. That's your work list.

---

## Part B — Per wall MATERIAL pipeline (9 objects + gable + 2 anims)
Run this for each wall material. Fire every unblocked job at once; the only serial edge is states need their base first.

1. **Base** — `create_1_direction_object` (size 256, view `sidescroller`): the 4×4 wall in three zones
   {`{WALLPLATE}` cap / `{MATERIAL_FACE}` / `{FOUNDATION}` footing}. GATE: must read as ONE continuous wall —
   regen if it returns a grid / separate framed panels.
2. **Ground states** — `create_object_state` of THAT base ×3: door, window (surgical prompt + a `seed`),
   left_corner. Always a state of the base — never fresh, never reconstructed.
3. **Derive (no PixelLab)** — `derive-upper.mjs` crops the footing → uppers; `flip-h.mjs` → right corners.
4. **Animate.**
   - **DOOR — CODE-SYNTH, never v3 (2026-06-24, user-flagged in-game).** `animate_object` is RETIRED for doors: it
     bakes stray bright **sparkles/asterisks**, horizontal **scanline streaks**, and **wall-melt** into the OPENING
     frames (the closed frame_0 looks fine, so it slips qa; the glitch only shows mid-swing as the player nears).
     Instead synthesize a clean swing in code: `node scripts/door-swing-anim.mjs <…/<material>>` — it locates the door
     by diffing `ground_door` vs `ground_plain` (robust across materials), keeps the wall/eave/footing/frame perfectly
     static, foreshortens the leaf toward its hinge into a plain dark interior, and writes frames already sized to the
     static tile (frame_000 == the shut door). NO normalize/fit/freeze needed, zero artifacts, and it saves a PixelLab
     job. (Same precedent as the window glow-pulse below.)
   - **WINDOW.** If the window has MOVING parts (shutters / swinging lattice), `animate_object` it (v3). If it has NO
     moving parts (e.g. fixed leaded glass), do NOT use v3 — with nothing to move it invents motion by breathing/
     scaling the whole wall (qa-frames HF_SPIKE / SETTLE-FAIL). Instead make a deterministic **code glow-pulse**:
     `node scripts/glow-pulse-anim.mjs <…/<material>/ground_window__v0.png> <…/<material>/anim/window> [amp cx cy rad]`
     — pulses a soft cool glow over the STATIC window tile, masked to the silhouette; frame_000 == the static tile,
     passes qa-frames, reusable for every material in the biome (mystic uses this for all 4). (NOTE: `animate_object`
     can mangle SHUTTER windows too the same way it did doors — if a shutter anim shows sparkles/streaks/melt, fall
     back to a code glow-pulse or a code shutter-close synth rather than re-rolling v3.)
5. **Gable (TILE — the only `create_tiles_pro` in this part)** — one tileset per material, keyed on the WALL
   material (the wall carried up into the south roof→wall triangle). Params + prompt template:
   `docs/superpowers/specs/2026-06-24-gable-tile-workflow.md`.
   ```
   create_tiles_pro({ description: "1).{MATERIAL_FACE} 2).{MATERIAL_FACE}+tie-beam 3).{MATERIAL_FACE} weathered 4).{MATERIAL_FACE}+vent",
     tile_type: "square_topdown", tile_view: "top-down", outline_mode: "segmentation", tile_size: 64, seed: <fixed per material> })
   ```
6. **Download-on-render + record + post-process** — the instant `get_object`/`get_tiles_pro` is `completed`, pull
   the PNGs (PixelLab EXPIRES them), write the object id into `tiles/<biome>/_pixellab_ids.json`, then post-process:
   **`de-magenta.mjs` EVERY object tile + anim frame FIRST** (PixelLab randomly bakes stray magenta key-pixels
   ≈RGB 246,4,252 + a pink halo into objects; zero their alpha BEFORE solidify or solidify's dilation SPREADS them
   into pink smears across the tile — seen on moonstone), then
   `solidify` every tile (force opacity — a holey wall/gable shows grass/sky through), corner-fin, `normalize-anim-frames`,
   then **`fit-anim-frames.mjs <materialDir> <door|window>`** on EVERY door/window anim (MANDATORY — see step 7 FIT),
   then **`freeze-anim-band.mjs <materialDir> <door|window> [0.18]`** (MANDATORY — v3 MELTS the static top eave/
   wallplate band during a swing even though only the leaf moves; this composites the clean band straight from the
   static tile back over every frame. The wall's top is always the static eave, so it's safe to always run).
7. **QA-gate** — `qa-tiles.mjs` + `qa-frames.mjs`. A flag → retry (new seed) or refine the prompt; never ship it.
   - The gable is auto-excluded from the TINY check (it's a 64px tile beside ~225px wall objects) but still gets
     HOLE/EMPTY — a holey gable is a real fail.
   - A `qa-frames` **SETTLE-FAIL on the final frame** (PixelLab's corrupt last-frame glitch) is deterministically
     fixed by `settle-final-frame.mjs` — run that, don't re-roll. qa-frames does NOT flag a final frame identical to
     its predecessor as FROZEN.
   - **FIT — anim frames MUST match the static tile size/framing (the #1 anim bug).** The renderer (`drawAperture`)
     maps the WHOLE anim frame into a fixed door/window box, while the static `ground_<kind>__v0.png` is
     solidify-CROPPED to fill its image edge-to-edge. So a raw 256² anim frame (wall inset in a transparent margin)
     renders the aperture **smaller + lower than the closed static tile — it visibly RESIZES when the animation
     triggers.** `qa-frames` now flags this as **FIT-FAIL** (frame dims ≠ static, or content doesn't fill the frame).
     AUTO-FIX (deterministic, idempotent): `node scripts/fit-anim-frames.mjs <materialDir> <kind>` — crops every
     frame to frame_000's wall bbox (one fixed rect so the wall stays put while the leaf swings), fills holes (so the
     swinging aperture is never see-through), and resizes to the static tile's exact dims. Run it for door AND window
     on every material; it's already folded into step 6. (Mystic's code glow-pulse windows are born static-sized → pass.)
     A `SIZE_DRIFT` flag (frames inconsistent with EACH OTHER) is a different bug → `normalize-anim-frames.mjs` first.
   - **PROPORTION — `node scripts/qa-proportions.mjs <biome>` (the "tiny door / gigantic foundation" catcher, 2026-06-24,
     user-flagged).** A renderer can't fix a tileset whose footing eats the wall and whose door floats above it (taiga
     pitch_sealed_timber: a stubby door sitting on a ~35%-tall cobble band). HARD-gate on `doorH` (door must be near
     full wall height) + door reaches the GROUND; a FAIL → **re-roll the BASE with a LOW {FOUNDATION}** (a thin footing
     course ~12–18% of the tile, never half the wall) **and regenerate the door state** with "the door cuts THROUGH the
     footing down to the ground, no footing course remains below the door". `foundation%` is a printed HINT only — it
     false-fires on heavily-textured walls (logs/brick/reed read as a tall band), so NEVER auto-regen on it alone; let
     the vision review (Part D §3) confirm a real oversized footing.
   - **EDGE + STATE-DIM — `node scripts/fix-tile-edges.mjs <materialDir>` (MANDATORY post-process, step 6) + `node
     scripts/qa-edges.mjs <biome>` (gate). User-flagged in-game 2026-06-25 (hills black building-edges + windows not
     lining up).** PixelLab bakes a near-black OPAQUE outline on tile edges (NOT transparency — the pixels are solid
     black; tested: a "no black outline" prompt clause only cut it 96%→38% and added ragged transparency, so the model
     can't be fully prompted out of it). On a building's L/R edge (corners) and pale walls it reads as a black line that
     breaks the wall illusion; at a base·flip join it makes a dark seam. AND solidify crops each state to its own bbox so
     a window/door state can be a different SIZE than ground_plain → apertures don't line up. `fix-tile-edges`
     **de-outlines** the L/R edges (per row, extends the wall texture over the contiguous near-black run — preserves dims
     AND the shaped edge, NEVER truncates; user requirement) and **scales every state to ground_plain's dims** (a few-px
     scale, imperceptible — also gives the door-synth matched dims). Run it AFTER derive/flip, BEFORE the door synth.
     `qa-edges` then FAILs if a corner's outer edge is STILL >40% near-black (a too-dark quoin/post wider than the
     de-outline cap, e.g. a near-black dressed-stone quoin or dark-oak corner post) → that's a generation problem, not an
     outline: RE-ROLL that material's corner state (+ base if needed) with {MATERIAL_EDGE} as a MID-tone edge ("a cool
     MID grey-stone quoin / mid-brown post, NEVER near-black, no black rim"), then re-derive/flip + re-run fix-tile-edges.

---

## Part C — Per roofSlug pipeline (roof slab TILES)
Run this for each of the biome's 4 roofSlugs (from `building-materials.json` `roofs`). Roofs are **TILES**, independent
of wall material, so this is its own loop — do NOT pin a roof to a material.

1. **Roof slab** — `create_tiles_pro` per roofSlug, 4 variants for town variety (seed-driven so they're reproducible
   and distinct):
   ```
   create_tiles_pro({ description: "<the roofSlug's `prompt` from building-materials.json — seamless top-down roof>",
     tile_type: "square_topdown", tile_view: "top-down", outline_mode: "segmentation", tile_size: 64, seed: <fixed per slug+variant> })
   ```
2. **Fascia (optional)** — a thin eave/rake trim board, only if the roof has a 3D overhang (grassland-style). Flat
   parapet roofs (desert) skip it — the renderer falls back to a procedural fascia colour. Don't force it.
3. **Download + solidify** — pull `get_tiles_pro` the instant `completed`; `solidify` (a holey roof shows grass/sky
   through); write to `roof/<biome>/<roofSlug>/roof_top__v000.png` … `__v003.png` (+ `roof_fascia.png` if generated).
4. **Record IDs** — store roofSlug → `{v000,v001,v002,v003,fascia}` in `tiles/<biome>/_pixellab_ids.json` under `roofs`.

No renderer change is needed: `roofTexFor` → `roofAssetDir(biome, roofSlug)` auto-loads + warps the slab, the roof
layer is ON by default, and it rotates the 4 variants per building. Roof overhang/flatness is governed by
`tools/roof/roof-rules.js` per biome.

---

## Part C½ — Curate the roof + gable candidate pools (the studio)
`create_tiles_pro` returns ~16 candidate variants per call — NEVER ship them raw; curate in context first.
1. **Preview** — `localhost:8123/tools/building-studio.html`. It renders **real varied footprints** (cottage…manor
   via `realFootprint`) with the **real `drawRoofForBuilding` engine** (true pitch / height / direction), each
   candidate texture warped onto the roofs. Pick the wall material; click a candidate to cycle
   **✓ in-pool → ✗ excluded → neutral**. (`tools/tile-picker.html` is the simpler raw grid.)
2. **Roofs = ONE biome-wide pool.** The curated good set applies to **all roofSlugs uniformly** — you do NOT curate
   each slug separately. This maximises combination + per-town variety. The renderer rotates up to `NV` variants per
   building; bump `NV` in `roofTexFor` (`building-occluder.js`) to the pool size (desert = 8).
3. **Gables = per wall-material.** A gable is the wall carried up, so its pool is per material (curate adobe's gable
   from the adobe candidates, etc.) — not biome-wide.
4. **Apply** — Copy the studio's picks JSON → `node scripts/apply-tile-picks.mjs <picks.json>`. It places the IN-POOL
   variants (forced opacity, no crop) at their `targetPattern` paths as v0, v1, …; **excluded candidates are never
   placed**. For the biome-wide roof pool, list the same pool under every roofSlug so it fans across all of them.

---

## Part D — Wire + verify (end of biome)
1. Re-run **both trackers** — every material DONE (walls + gable + anims), every roofSlug 4/4, QA clean.
2. **Wire the renderer + registry** —
   (a) Add the biome to `TILE_MATERIALS` in `src/render/building-tiles.js` (world-gen `wallSlug` → tile FOLDER name;
       an identity map if the manifest slugs already equal the folder names) + a `BIOME_FALLBACK[biome]` entry.
   (b) The runtime registry `sim/world/buildings/building-material-registry.js` is auto-generated from
       `building-materials.json` — BUT its generator (`_assemble_building_materials.py`) is **STALE**: it omits
       hand-added code (`doorwayHole`/`DOORWAY_HOLES`, `windowOverlayFile`, the `south_base` `rbVariant` branch),
       so regenerating the whole file BREAKS the renderer. Do NOT regenerate — **surgically edit only that biome's
       data block** (walls + roofs, slug/name/palette) in the registry to match the manifest. Then `node --check` it.
   (c) If you change a biome's vocabulary, world-gen now assigns the NEW `wallSlug`/`roofSlug` — make sure tile/roof
       folders match those new slugs.
3. **Adversarial multi-agent ASSET REVIEW (MANDATORY — catches what a single pass + the mechanical gates miss).**
   The automated gates (`qa-tiles` holes, `qa-frames` anim, `qa-proportions` door/footing, `qa-edges` black-edge/dim, and
   **`qa-render.mjs`** = the IN-GAME render-QA: own headless browser → drives the live game @ :8123, per biome×material
   shoots the wall base weathering ON/OFF, diffs the base strip for over-weathering / in-context holes → contact sheets +
   PASS/FAIL, needs the dev server up) catch asset AND render defects — but NOT every aesthetic one — a blown-out/flat wall, a
   pale eave-cap clashing on a coloured wall, a material that misses the biome aesthetic, or a v3-melted eave the HF
   check averaged out. The user has been explicit: **fan out review sub-agents against an opinionated rubric before
   declaring a biome done** (a single self-review keeps missing things).
   (a) **Contact sheets** — per material: the 10 states + gable AND a mirror-tiled wall-with-door row (so seams +
       blown-out + door-in-context show); a door/window anim sheet; plus any real in-game screenshots.
   (b) **One reviewer per LENS** (parallel) — **artifacts** (holes/melt/stray sparkles-asterisks/scanline streaks/
       baked-in text/dropped wall), **value-contrast** (blown-out/flat vs muddy; enough tactile detail at BUILDING
       scale), **material-consistency** (every state == its base wall + clean aperture; trims consistent; the smooth/
       coursed/cut/woven spread coheres), **proportion/scale** (the DOOR is near-full wall height and cuts to the
       GROUND — not a tiny door floating above a tall footing; the FOUNDATION is a modest course, not a giant band that
       makes the building read stubby; trust `qa-proportions` FAILs — this is the #1 thing the user catches in-game),
       **grid-read** (the wall reads as ONE solid masonry/timber/woven surface, NOT a flat regular grid of identical
       panels or window-like cells), **tiling-seams**, **anim-stability** (only the leaf moves — no resize/melt/wobble
       of eave/sides/footing; no sparkles in the swing), **aesthetic-vs-spec** (the biome token doc's intended look).
       Each reads the sheets + screenshots + the biome
       manifest and returns structured findings (material, asset, severity, fix∈{regenerate,patch-code,prompt-change,
       accept}, detail). A synthesizer dedupes → a RANKED fix list + concrete improved prompts. Reference run: the
       `mystic-asset-review` Workflow (6 lenses + synth) — author the equivalent for each biome.
   (c) **ACT on the synthesis**, then re-review until clean. This is the step that turns "it generated" into "it's good".
4. **Smoke-test in game** — spawn buildings of this biome; verify: walls read as continuous walls, doors/windows
   animate, roofs read as roofs (not soil) with visible variety, and the south gable reads as the wall material
   carried up (textured, no see-through). The gable→wall skin is `drawSkirt`'s `toWall` branch in
   `tools/roof/roof-renderer.js` (opaque base coat first, then the gable texture).

---

## Hard rules
- Roofs + gables = **TILES** (`create_tiles_pro`, segmentation). Walls/windows/doors/ends = **OBJECTS**. Never cross these.
- Every wall state is a `create_object_state` of the base. Fix a bad state by retry/refine, never fresh-gen or compositing.
- A base must read as a solid continuous wall, never a grid of window-like panels.
- **Solidify everything** (walls, gables, roofs). PixelLab tiles carry random transparent holes; any hole that
  reaches the game shows terrain straight through. This is non-negotiable.
- IDs live in `tiles/<biome>/_pixellab_ids.json` (`materials` + `roofs` keys), never in memory or a chat summary.
- Disk is authoritative. The tracker's material list is DISK-FIRST — existing tile-corpus dirs ARE the canonical
  material slugs (they can differ from the older `building-materials.json` plan, e.g. desert `adobe`).
- Fire EVERY unblocked job at once. Serial edges only: states need their base; gable/roof are independent.

## Material VALUE + PixelLab opacity — the hard-won rules (mystic moonstone/wardweave, 2026-06-24)
- **NEVER push a wall toward near-white / pale / "stark white".** PixelLab ALPHA-MATTES light walls — it renders the
  pale faces transparent, so `solidify` fills them by dilation and the wall comes back as DARK MUD (moonstone: 57%
  holes pure-white, 90% holes "pale-grey" → unusable). The lightest a wall can reliably render is a **mid pale-grey
  matched to a material that already renders clean** (starlit_marble renders at 2% holes; moonstone only worked when
  its faces were spec'd as "cool white-and-pale-grey, the SAME tone as polished white marble"). Get value from DARK
  joints/coursing/shadow, not from a bright body. If the user wants "stark white", deliver the lightest renderable
  pale-grey + explain pure white is technically impossible here.
- **PixelLab opacity is partly RANDOM** (2–91% holes on identical prompts). A base that solidifies at >~25% holes is
  a BAD ROLL — re-roll (it's not always the prompt). Check the `solidify` hole% as the gate.
- **Woven / lattice / grille materials render with transparent GAPS** (the "woven" member). Don't prompt an "open
  lattice/screen/grille" — frame it as a **SOLID wall with the pattern INLAID FLUSH on its surface, no openings, no
  gaps, the daub shows solid between the chains** (wardweave v1/v2 "open lattice" = 46–51% holes + reads see-through;
  v3 "solid daub + rune-chain inlaid flush" reads as a solid warded wall). Also lift a too-dark daub to MID grey so
  the dark pattern reads on it instead of looking see-through.
- **Content-policy false-positives:** an over-stuffed prompt with heavy ALL-CAPS negations can fail with "blocked by
  content policy" (moonstone v6). Keep prompts CLEANER and model them on a proven-working sibling prompt; a failed
  job is `status: failed` (not slow) — check `get_object`, don't just keep polling.
- **Shared pale trim ({WALLPLATE}/{FOUNDATION}) clashes on COLOURED walls.** The pale-moonstone eave reads as a warm
  cream bar on a violet/dark wall. Fix per-tile with `cool-tint-band.mjs <tile> <out> [0.16] [0.55]` (cools the top
  eave band, value-preserving), then re-run `freeze-anim-band` so the anims pick up the tinted eave. Better long-term:
  author the biome's trim tokens in a cool/neutral tone from the start so it works on every material.

## Per-biome RENDERER calibration (do this when onboarding/wiring a biome)
- **Roof overhang** (`tools/roof/roof-rules.js` `BIOME_PROFILES[biome].overhang = [lo,hi]`): PITCHED-roof biomes need
  `≥[1,1]` so every building gets an eave (gives the roof shape). Only genuinely FLAT/parapet biomes (desert,
  volcanic) get `[0,0]`. A `[0,1]` on a pitched biome yields no-overhang half the time (mystic bug → `[1,1]`).
- **Roof pool size** `NV` in `roofTexFor` (`building-occluder.js`): bump per biome to the curated pool size
  (`{desert:8, mystic:48}`) so the renderer rotates all curated variants.
- **Doors never clip** is handled globally in `drawAperture` (shifts a near-edge door inward to keep its full span
  inside the run; all biomes) — no per-biome work, but verify it after wiring.

## Prompt token framework (fill per biome; reuse the refined templates)
Canonical templates: `docs/superpowers/specs/2026-06-22-tile-corpus-manifest.md` (+ the
`2026-06-23-desert-tile-corpus-manifest.md` override). Gable: `2026-06-24-gable-tile-workflow.md`.
- Biome tokens: `{FOUNDATION}` `{DOOR}` `{WINDOW}` `{WALLPLATE}`
- Material tokens: `{MATERIAL_FACE}` `{MATERIAL_EDGE}` `{MATERIAL_PHRASE}`
- **Always-keep refined clauses (hard-won, every biome inherits them):** base "ONE single continuous wall, NOT a
  grid / tileset / separate panels"; window "cut ONLY the small window, do NOT repaint the wall, it stays fully
  opaque" + a seed; door "carve the door INTO the wall — the wall stays a COMPLETE fully-opaque rectangle filling
  the whole tile (eave cap to ground, edge to edge), only the opening shows the door; reaches the ground, replaces
  the footing at its location" (pale/near-white materials get alpha-matted: a weak door prompt drops the wall
  above/beside the arch → the tile crops short → solidify smears DARK fill into the gap. Force the full wall.);
  corner "clean finished wall
  END, flat orthographic, flush to the parapet — NOT a 3D corner"; gable "every pixel SOLID OPAQUE, reads as the
  WALL carried up, NO shingles / NO window glass"; global "render NO text"; animation "plain flat dark interior,
  settle on a calm final frame, no stray triangles".

## Master manifest + props
`assets/pixelab/buildings/manifest/building-asset-manifest.json` tracks, per biome: materials × {tiles (incl. gable),
anims} with v0 status + v1 status + ids, AND a `roofs` map (roofSlug × 4 variants + fascia + ids). The summary carries
`building_assets` (wall corpus), `roof_assets`, and `v1_variants`. Disk-first — tile-corpus material names supersede
the older `building-materials.json` plan slugs.

Props (building dressing D0–D7) are a sibling pipeline tracked via
`docs/superpowers/specs/2026-06-23-dressing-manifest.json` — not part of this skill.
