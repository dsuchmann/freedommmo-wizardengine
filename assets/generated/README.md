# Generated Asset Drop Folder

Sorceress-generated PNG sheets go here. The game automatically tries to load these paths first and falls back to the procedural debug atlas only when a sheet is missing.

Expected sheets:

- `assets/generated/terrain/terrain_micro_layers_v1.png`
- `assets/generated/vegetation/vegetation_objects_v1.png`
- `assets/generated/geology/geology_objects_v1.png`

All sheets use:

- 32×32 cells
- 8 frames per row
- transparent background
- rows defined in `src/assets/generated-atlas-defs.js`

Once PNGs are placed at those paths, no code change is required.
