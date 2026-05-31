# Godot Reference Intake Plan

The Godot project under `reference/godot/` is large and should be treated as reference material, not as code to port directly.

## Current observed top-level folders

- `bin/`
- `config/`
- `data/`
- `docs/`
- `gdextension/`
- `generated/`
- `previousContext/`
- `regions/`
- `resources/`
- `scenes/`
- `screenshots/`
- `scripts/`
- `shaders/`
- `tests/`
- `tools/`
- `user/`

## Intake strategy

Because the reference import is close to 1GB, review must be staged:

1. Build a file inventory by extension, size, and directory.
2. Prioritize readable source/config files over binary/generated assets.
3. Identify overmap/worldgen/chunk/biome/noise code first.
4. Extract algorithms, thresholds, data formats, and asset naming conventions.
5. Review asset folders by manifest/inventory rather than opening every binary file.
6. Create a Wizard Genie-native implementation plan from extracted facts.

## Priority targets

Highest priority:

- Overmap generation.
- Seed/noise utilities.
- Biome and climate classification.
- Chunk coordinate math.
- Terrain compiler/render projection.
- Asset manifests/catalogs.

Medium priority:

- Tile/object placement systems.
- Pathfinding/walkability.
- Runtime compositor.
- Lighting/shaders.
- Tests that reveal intended behavior.

Low priority initially:

- Screenshots.
- Generated output caches.
- Build binaries.
- Godot editor/user state.
- Old conversation/context dumps unless needed.

## Rule

Use Godot implementation details as evidence, but rebuild horizontally and cleanly in Wizard Genie.
