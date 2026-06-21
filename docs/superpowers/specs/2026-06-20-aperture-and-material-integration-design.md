# Building Pilot v2 — Per-Tile Walls, Decoupled Apertures, Material Integration

**Date:** 2026-06-20
**Status:** design (approved in conversation; spec for review)
**Supersedes door/window lanes of:** `2026-06-20-building-asset-manifest-design.md`
**Builds on:** the manifest (`building-materials.json`, `building-material-registry.js`, `bulk_generate_buildings.py`) and the grassland pilot generation.

## Why

The grassland pilot generated correctly but surfaced three things to fix before we scale:
1. **Granularity:** wall sprites came out as 4-tile-wide *facade units* (full timber-framed wall, centered window/door), not the per-tile pieces the renderer needs to tile onto arbitrary building widths.
2. **Apertures:** baking a door/window into the tile fights the game's need for exact, game-owned geometry (walkthrough, collision, "at the door"), and animating a baked tile with `animate-with-text-v3` (a *character* animator) hallucinates figures into the opening.
3. **Integration:** the generated library isn't wired to in-game buildings yet — buildings carry no exterior wall/roof material.

This iteration fixes all three in one re-gen + one integration pass, so grassland renders right the first time, then scales.

---

## Part A — Per-tile wall granularity

**Target piece sizes** (what the renderer consumes, 32px/tile):

| Piece | Size | Tiling |
|---|---|---|
| `south_base`, corners, `north_back`, `edge_ew`, `interior_base` | **32×128** (1 tile wide, 1 wall-height tall) | horizontal: any width; vertical: one wall height (cap→surface→foundation) |
| window/door/archway pieces | **64×128** (2 tiles wide) | feature centered |
| roof textures | 64×64 | already correct |

A wall piece is **one tile wide and one full wall-height tall** (the cap and foundation are at fixed rows, so it does *not* tile vertically as 32-chunks — it stacks as whole wall heights). Horizontally it tiles to any building width.

**Generation method (tuned at the re-gen):** PixelLab `create-1-direction-object` is square-only and fills the canvas, which is what produced 4-tile facades. Two ways to get true per-tile pieces, decided empirically on the grassland re-gen:
- **(i) Native non-square via `create_map_object`** (supports width/height 32–400) — request 32×128 / 64×128 directly. Preferred if the aspect holds up.
- **(ii) 128² gen + deterministic crop** — keep square generation, then crop: base = a single seamless bay (a 32-wide tileable slice), window/door = the **center 64** (where the edit places the feature). Reliable fallback.

The renderer always receives the **target sizes**; the crop/method is generator-side and invisible downstream.

---

## Part B — The Aperture system (doors + windows decoupled)

**Principle:** separate the *geometric contract* (game-owned) from the *art* (PixelLab). An **Aperture** = an opening in the wall at a **canonical rect** + an optional **movable leaf** (separate normalized GL sprite) + **procedural open/close** + an **interaction anchor** (the tile).

| | Door | Window |
|---|---|---|
| Canonical rect | floor → 3 tiles (foot flush with floor, molding cut) | upper-middle, above head |
| Collision / threshold | **yes** — the 1 anchor tile | **no** |
| Leaf | door leaf (swings) | **shutters** (swing) |
| Interaction | walk up + press → open + pass | walk up + press → open |
| Glass/glow | — | baked glass art + reserved **night-glow** lit state |

**Asset classes:**
- **Doorway-opening piece** — *per wall material* (~1 call each). The material's wall with a recessed framed opening at the canonical rect, via **masked inpainting** (`create_map_object`: white mask = the opening rect down to the floor edge; black = freeze surrounding wall). The mask *guarantees* position and cuts the molding to the floor. Static empty dark threshold behind. Procedural dark-cut fallback.
- **Window opening pieces** — keep the **6 baked window shapes already generated** (arched/round/shuttered/lattice/bay/slit) as the glass art. (Reserved later: a night-glow lit variant.)
- **Door-leaf library** — *shared, material-agnostic* (~6 styles × ~3 finishes = ~18). Standalone transparent-bg objects, **closed leaf only**, **normalized**: alpha-bounding-box the leaf, then scale+translate so its box snaps onto the canonical rect (foot at floor, centered, head at 3 tiles). A wooden door reads fine on stone/timber/thatch.
- **Shutter-leaf** — *shared* (~a few styles), normalized; the openable part of any window.

**Open/close is procedural — no generated animations.** The game swings the leaf with a GL transform (hinged horizontal-foreshorten) through the sprite batch, depth-sorted like the player-occlusion work. This is physically incapable of hallucinating a figure. The `anim/door_open/**` frames from v1 are abandoned.

**Registration:** the game owns the canonical rect; collision, "at the aperture," and the open transform all key off it. Door threshold = the 1 anchor tile.

**Extensible (designed in, not built now):** gates = big doors; **roof apertures** (chimney/smoke-hole/skylight) = a roof-level rect; **floor apertures** (trapdoor/cellar) = vertical traversal. The abstraction allows these later without rework.

**Explicitly OUT — the "wall fixtures" lane (future):** signs, torches/lanterns/sconces, notice boards. These are registered props placed *on* the wall (matter for night-light + building legibility), **never baked into the wall material**. The wall manifest already keeps walls bare, preserving this.

---

## Part C — Material integration (assignment + render)

**Approach B — building generation stays untouched.** We stamp three fields onto each already-built building, then the renderer reads them. (Rejected Approach A — folding material into footprint/taxonomy generation — because it entangles spatial structure with art selection and breaks the biome-agnostic layout cache.)

**Assignment** — at `settlementCandidates()` in `sim/world/buildings/resolved-buildings.js` (the single chokepoint where every building is assembled with `s.biome/s.tier/s.race` in scope, already memoized on a key that includes biome):
- Add `stampMaterials(b, s)` before both `out.push()` sites (in-place + relocated): sets `b.biome = s.biome`, `b.wallSlug`, `b.roofSlug` (+ optional `b.doorShape`/`b.windowShape` render-time defaults).
- **Rendezvous (highest-random-weight) hashing** for stability under pool growth — replaces the registry's current naive `pickMaterial` modulo. For a building, score every material as `mix(seed, b.x, b.y, hash(slug), salt)` and pick the max. Adding a material later moves only ~1/N buildings to it; the rest are unchanged (gradual adoption). **Separate salts for wall vs roof** so the (wall, roof) pair ranges over all 16 grassland combos, not a correlated 4.
- Hash on the **final (relocated) x,y** so material is stable for where the building stands.
- **Fallback:** if `wallsForBiome(s.biome)` is empty (a biome with no assets yet), leave slugs undefined → renderer uses `stone_brick_tiles` (honest absence for the other 20 biomes).

**Registry change** — replace `pickMaterial(list, n)` (modulo) with `assignMaterial(pool, buildingKey, salt)` using rendezvous hashing. Pure, deterministic, no `Math.random`.

**Render** — `src/render/building-occluder.js` (the active GL path; `drawWalls` is shared by the main layer, the depth pass, and the occluder fallback, so one change covers all three):
- Replace the hardcoded `getWallImg('south_base')` lookups with a **per-`(biome,slug)` lazy image cache** keyed by `wallAssetDir(b.biome,b.wallSlug)+wallPieceFile(piece,{wear,shape})`, using the file's existing `_imageCache` lazy-Image pattern. Fall back to the stone_brick `getWallImg` when the slug is missing or its image hasn't loaded (one-frame fallback, same convention the roof texture uses).
- Source rects assume the **per-tile sizes** from Part A (32×128 / 64×128) — no special-case crop once Part A produces correct sizes.
- **Roof skin:** pass `opts.roofTexture = imageCache.get(roofAssetDir(b.biome,b.roofSlug)+roofTextureFile(0))` into `tools/roof/roof-ingame.js drawRoofForBuilding()`, replacing the biome-ground texture; fall back to ground texture when `roofSlug` absent. The procedural roof *geometry* stays; only the surface texture changes.
- Pilot defaults: `wear='normal'`, door rendered as a **closed leaf placeholder** at the door tile until the Aperture open-state lands; door/window shape chosen deterministically per building from the same hash family (coherent + varied), treated as a render-time default (no data migration when Apertures take over placement).
- **GL-safe:** the dead 2D path (`building-renderer.js drawBuildingWalls`, tuner-only) and the `if(false)` worker bake stay on stone_brick. Optional `window._buildingMaterials=false` console toggle for A/B, mirroring `window._depthOcclusion`.

**Coherence / variance / determinism:** one `wallSlug` + one `roofSlug` per building applied to every piece (coherent); `mix(seed,x,y,salt)` differs per building (varied); pure function of world seed (stable across frames/sessions/relocation).

---

## Asset matrix delta

Decoupling + procedural open removes the per-material baked doors and *all* generated animations:

| Lane | v1 | v2 |
|---|---|---|
| Per-material baked doors | 504 | 0 |
| Door open sprites + animations | ~1,000 (incl. 672 anim) | **0 generated** (procedural) |
| Doorway-opening pieces | — | ~84 (1/material) |
| Shared door leaves + shutters | — | ~30 (one-time) |
| **Full matrix** | **~5,040** | **~3,200** |

Per-tile granularity doesn't change counts (same pieces, correct size). Walls / wear / corners / interior faces / window-glass art / roofs from v1 are **kept**; only the door/window *open* lanes are reworked.

---

## Pilot loop (one clean pass)

1. Build the integration (Part C) + the registry rendezvous change, targeting per-tile pieces.
2. Re-gen grassland: per-tile walls (Part A) + doorway openings + shared leaves/shutters (Part B), one resumable run.
3. Render → verify in-game: tiling to arbitrary widths, material coherence-per-building + variance-across-buildings, roof reads distinct from ground, door foot at floor + 1-tile threshold, procedural open.
4. Scale: `forest,desert,mountains`, then all 21 — additive, rendezvous absorbs each new biome's pool.

## Open items (tuned at the re-gen, not blocking)

- Per-tile generation method: `create_map_object` native non-square vs 128²+crop (Part A).
- Door-leaf finish count + shutter styles.
- Whether to vary wear per building in the pilot (assets exist) or hold at `normal`.
- Later/deferred: night-glow window state, the wall-fixtures lane, weighted rendezvous for culture/wealth bias, roof/floor apertures.
