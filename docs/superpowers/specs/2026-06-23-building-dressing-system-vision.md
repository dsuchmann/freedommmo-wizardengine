# Building Dressing System — Vision (brainstorm input, NOT yet a design)

> Captured 2026-06-23 from a user-provided proposal, to brainstorm into an implementation design.
> The base building generator produces CLEAN architecture (walls, windows, doors, roofs, stairs, floors,
> collision). The **dressing system** is a SECOND procedural layer that makes buildings feel authored,
> aged, lived-in, region/faction/role-specific — WITHOUT regenerating the base building. Same goal extends
> to **town/city/metropolis infrastructure**: roads, pavers, pathways, edging, plazas, signage.

## Core principle
Do NOT bake dressing into the base building, and do NOT ask PixelLab for "house with vines + porch + moss".
Ask PixelLab for **kits** (clean house; vine pieces; porch pieces; awning pieces; moss overlays; landscaping
pieces). The procedural system assembles + places them → huge variation from a small asset set.

## The model: every building exposes SURFACES + SOCKETS
- **Surfaces** = areas dressing can overlay (vertical_wall, roof_plane, foundation) with a material,
  bounds, an `allows` list (vines/moss/cracks/signs/awnings), and `blocked_zones` (doors/windows).
- **Sockets** = semantic anchor points for INTENTIONAL props: `above_door`, `left_of_door`,
  `right_of_door`, `under_window`, `roof_edge`, `wall_corner`, `foundation_edge`, `ground_perimeter`.
  Each socket has a type, position/bounds, width, and an `allows` list.
- Per-building semantic params drive rules: `style`, `age`, `wealth`, `maintenance`, `wetness`,
  `building_role` (inn/blacksmith/farmhouse/shrine/abandoned/wealthy…), `biome`.

## Dressing categories
1. **Architectural attachments** (real objects, depth/collision implications): awnings, porches, columns,
   balconies, railings, shutters, signs, lantern brackets, chimneys, flower boxes, trellises. → SOCKETS.
2. **Surface dressing** (overlays, no collision): moss, vines, cracks, water stains, faded paint, dirt,
   ivy, rust, wood rot, discoloration. → SURFACES (decals / spline growth).
3. **Ground dressing** (around the building): shrubs, flower beds, rocks, barrels, crates, benches,
   fences, grass tufts, mud, stepping stones, leaves. → ground_perimeter, avoid door_path/road.
4. **Region/faction/role dressing** (identity): merchant signs, banners, guard posts, religious symbols,
   nets, smith tools, farm crates, boards, crystals, posters.

## Dressing RULES (data-driven `when` → `place`)
A rule fires when its `when` matches (biome, surface/socket type, material, min_age, min_wetness,
building_role…) and `place`s assets by a method: `attached_prop` (align_to_socket), `spline_overlay`
(grow upward, avoid doors/windows), `scatter` (density, avoid door_path/stairs/road), `decal`. Each has a
`chance`. Examples: forest+old+wet stone wall → vines; shop above_door → awning; ground_edge forest →
shrubs.

## Architecture (pipeline)
Base Building Generator → Semantic Surfaces + Sockets → Dressing Rules → Dressing Passes → Placed
Props/Decals/Splines/Landscaping → Final building in the shared world (all through the GL pipeline per
CLAUDE.md — dressing inherits lighting/day-night/CRT/depth like everything else).

## Suggested build phases
1. **Sockets** — emit the socket set from the footprint/aperture data; place simple props.
2. **Surface overlays** — moss/wear/cracks/dirt/paint decals on wall/roof/foundation surfaces.
3. **Spline vegetation** — vines/ivy/roots growing along surfaces, avoiding apertures.
4. **Ground landscaping** — shrubs/flowers/rocks/fences/barrels/benches/paths/mud around the building.
5. **Identity kits** — role/faction dressing (inn, blacksmith, farmhouse, shrine, abandoned, wealthy).

## Open questions for the brainstorm
- Where do surfaces/sockets get COMPUTED — extend the footprint/per-tile-identity data (task #56) or a
  separate dressing-descriptor pass over the resolved building?
- Rendering: dressing as additional GL sprite-batch entries (depth-sorted with the per-object building
  depth #12) vs. baked into the building silhouette? Architectural attachments (awnings/porches) likely
  need their own depth; decals ride the wall surface.
- Determinism: dressing must be seed-derived (re-derivable everywhere, MMO-shaped) — same seed → same dress.
- Scope split: this spec is BUILDING dressing; town/city infrastructure (roads, pavers, pathways, plazas,
  edging) is a sibling system — brainstorm whether they share the rule/kit/socket machinery.
- The no-mock rule: dressing is presentation; the semantic params (age/wealth/role) should derive from the
  simulation (settlement chronicle), not be faked per-building.
