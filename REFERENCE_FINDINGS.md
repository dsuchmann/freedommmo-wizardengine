# Reference Findings

This file records facts extracted from the specs and Godot reference code/assets.

## Spec findings

- FreedomMMO is simulation-first: visuals are projections of simulation state.
- Deterministic seed + coordinate world generation is central.
- World scale target from specs: 6,400 × 6,400 chunks; each chunk 64 × 64 tiles; original tile size 32px.
- Only a local chunk window should be loaded/rendered.
- Tile data should be modeled as composable layer stacks.
- Chunk compiler converts simulation state into render-ready projection data.
- Biome, terrain, object, structure, lighting, and agent systems should be data-driven.
- Horizontal playable coverage is preferred over deep isolated vertical systems.

## Godot reference findings

Pending staged review.

## Asset findings

Pending staged review.
