# FreedomMMO Asset Manifest Schema v1

Every renderable asset family must describe not only imagery, but also animation, state, physics, collision, draw order, shadowing, lighting, and blend behavior.

## Required asset fields

- `id` — stable asset family id.
- `category` — dotted category, e.g. `vegetation.tree`, `actor.humanoid`, `terrain.elevation`.
- `biomes` — biome affinity list.
- `sizeTiles` — footprint in simulation tiles.
- `layers` — composited visual layers in local draw order.
- `states` — valid simulation/art states.
- `directions` — supported facing directions.
- `animations` — animation clips by state/action.
- `physics` — movement/blocking/mass/material metadata.
- `collision` — one or more collision volumes.
- `render` — draw order, blend mode, shadow, lighting, occlusion metadata.
- `anchors` — root/shadow/light/origin anchors.
- `variants` — combinatorial variant counts.
- `generation` — Sorceress prompt family and priority.

## Direction conventions

Use 8-way direction ids unless an asset is truly omnidirectional:

`S`, `SE`, `E`, `NE`, `N`, `NW`, `W`, `SW`

Static assets still include directions so Sorceress can generate directional damage, wind, growth lean, openings, and interaction-facing variants.

## Animation conventions

Each clip contains:

- `frames` — frame count per direction/state.
- `fps` — playback rate.
- `loop` — whether it loops.
- `directions` — direction set.
- `layers` — layers participating in the clip.
- `events` — optional frame events such as footstep, leaf_drop, sparkle, hitbox_on.

## Collision conventions

Collision is simulation-owned, not inferred from pixels.

Shapes:

- `circle`: `{ "type": "circle", "cx": 16, "cy": 26, "r": 8 }`
- `rect`: `{ "type": "rect", "x": 6, "y": 20, "w": 20, "h": 10 }`
- `polygon`: `{ "type": "polygon", "points": [[x,y], ...] }`

## Render conventions

- `drawLayer`: broad layer such as `terrain`, `decal`, `object`, `canopy`, `entity`, `effect`, `lighting`.
- `sort`: `y`, `fixed`, or `elevationThenY`.
- `blend`: `normal`, `multiply`, `screen`, `add`, `overlay`, `alphaClip`.
- `castsShadow`: boolean.
- `receivesLight`: boolean.
- `occluder`: boolean for line-of-sight/light blocking.
- `heightClass`: `flat`, `knee`, `body`, `canopy`, `cliff`, `overhead`.
