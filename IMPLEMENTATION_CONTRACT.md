# FreedomMMO Implementation Contract

This project is not a generic terrain demo. It is a from-scratch Wizard Genie implementation of **FreedomMMO**, using the imported specs as the authority and the Godot project as reference evidence.

## Authority order

1. Imported design/spec files in `specs/` define the intended game.
2. Godot reference code in `reference/godot/` reveals proven algorithms, thresholds, data formats, and asset conventions.
3. Wizard Genie implementation choices adapt those plans to the browser/runtime without copying Godot architecture.

## Non-negotiable identity

FreedomMMO is a simulation-first 2D MMORPG/world simulation where every visual is a projection of simulation state.

The implementation must preserve these principles:

- Deterministic world from seed + coordinates.
- Chunked overmap/streaming architecture.
- Tiles are layer stacks, not single decorative sprites.
- Rendering is a projection of compiled simulation state.
- Biomes, terrain, objects, structures, lighting, and agents are data-driven systems.
- Horizontal playable coverage comes before deep vertical perfection.
- Godot code is reference-only, never the new architecture.

## First playable slice requirements

The current `index.html` + `src/main.js` slice is only the first scaffold. It must evolve into the actual architecture described by the specs.

Minimum next steps:

1. Split the monolithic prototype into modules matching the real systems:
   - seeded random/noise
   - world constants
   - overmap/chunk coordinates
   - tile layer-stack model
   - chunk compiler
   - biome classifier
   - terrain object placer
   - renderer projection
   - player/camera/input
2. Replace ad-hoc tile objects with explicit layer-stack records.
3. Pull biome/object definitions from data manifests where possible.
4. Review Godot overmap/worldgen code and align formulas/thresholds.
5. Build an implementation checklist mapping specs to modules.

## Definition of done for early rebuild

A feature is not considered FreedomMMO-aligned unless it answers:

- Which spec(s) does it implement?
- What simulation state owns the truth?
- What renderer projection displays it?
- Is it deterministic from seed + coordinates where appropriate?
- Does it preserve future room for MMO simulation, agents, structures, and persistence?

## Anti-goals

- Do not build an unrelated roguelike, survival demo, or generic procedural map.
- Do not hard-code visuals as the source of truth.
- Do not port Godot scripts line-by-line.
- Do not go deep on one subsystem while the core world loop is missing.
- Do not depend on thousands of sprites before the data/model pipeline is stable.
