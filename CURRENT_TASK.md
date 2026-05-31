# Current Task

## Task ID

M3-002

## Goal

Turn terrain forms into navigable world systems: climbing/step rules, cave entry/subterranean mode, bridges/overpasses, and explicit cliff traversal constraints.

## Why this matters

Terrain forms are now visible and stored in tile stacks, but they are not yet gameplay. FreedomMMO needs elevation and subterranean structure to affect movement, exploration, pathfinding, and interaction.

## Required reads before coding

- `AGENT_LOOP.md`
- `IMPLEMENTATION_CONTRACT.md`
- `specs/2026-05-27-subterranean-systems-design.md`
- `specs/2026-05-27-elevation-cliff-rendering-design.md`
- `specs/2026-05-25-tile-object-system-design.md`
- `src/world/terrain-forms.js`
- `src/world/tile-stack.js`
- `src/player.js`

## Deliverables

- Movement cost/walkability changes based on cliff/slope/bridge/cave state.
- Interaction key for cave entrances.
- Basic subterranean mode/state and renderer tint.
- HUD readout for surface/subterranean layer.
- Preserve deterministic generation.

## Acceptance criteria

- Player can identify cave entrances and enter/exit a first subterranean layer.
- Cliffs and steep slopes influence traversal.
- Bridges/overpasses are represented distinctly from ground paths.
- Logs/backlog updated.
