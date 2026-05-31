# Draw Order, Occlusion, and Interaction Reaction Pipeline

## Goal

The player is not a HUD marker. The player is a world object that participates in the same spatial rendering, occlusion, collision, reaction, and animation systems as trees, rocks, shrubs, grass, water, cliffs, doors, NPCs, and items.

## Canonical Draw Model

Every visible thing becomes a draw item:

```text
terrain base chunks
terrain micro-layers below feet
terrain features below objects
world objects sorted by y/elevation
player/NPCs sorted by y/elevation
canopy/overhead layers sorted/occluding separately
lighting, atmosphere, weather
HUD
```

## Draw Item Fields

```js
{
  kind,
  worldX,
  worldY,
  elevation,
  screenX,
  screenY,
  drawLayer,
  sortY,
  occluder,
  castsShadow,
  receivesLight,
  interactionMask,
  render()
}
```

## Layer Rules

1. Ground terrain never draws over feet except special overlays like water ripples, grass contact blades, snow puffs, and mud splashes.
2. Object bases sort by y-coordinate.
3. If player y is less than a tree trunk base y, player draws behind tree.
4. If player y is greater than tree base y, player draws in front of trunk but may still be under canopy.
5. Canopy is a separate overhead layer and can partially alpha/occlude the player.
6. Cliffs and overhangs use elevation and occlusion masks, not only y sort.
7. Interactable object highlight/effects draw above object but below UI.

## Reaction Pipeline

Player movement emits contact events:

- footstep
- sprint footstep
- jump takeoff
- landing impact
- dodge roll sweep
- brushing vegetation
- collision bump
- harvest/cut/hit
- climb grab
- water splash
- mud squelch
- snow puff

Contact events feed layers:

- grass bends away and recovers
- flowers shake and shed particles
- bushes rustle
- tree leaves shake if bumped/cut
- water ripples
- mud footprints
- sand puffs
- snow footprints
- insects scatter
- fireflies flee/return
- stones nudge if small
- vines sway

## Implementation Stages

### Stage 1 — now

- Put player into the sorted world object pass.
- Give player world y/elevation sort key.
- Keep terrain cache below player/objects.
- Add contact event bus/data model.

### Stage 2

- Add vegetation contact maps per chunk.
- Micro-layers subscribe to player contact events.
- Render grass/flower contact bend overlays dynamically above cached terrain.

### Stage 3

- Split trees into trunk/body and canopy draw items.
- Trunks sort with player.
- Canopy draws overhead with alpha when player is underneath.

### Stage 4

- Add interaction affordances: hover/nearby highlight, object verbs, harvest, push, climb, cut, inspect.

### Stage 5

- Add persistent world state reactions: cut grass, harvested bushes, broken rocks, footprints, burn/freeze/wet/mystic states.
