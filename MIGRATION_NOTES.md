# Godot → Sorceress Wizard Genie Migration Notes

## Current workspace status

This Wizard Genie project currently contains only:

- `game-config.json`
- `.gitignore`

I do **not** have direct access to arbitrary files on your local machine outside this project workspace. To read the 26–27 Claude-written Godot specs, they need to be copied or uploaded into this project directory first.

## Recommended next step

Add the Godot specs to a folder such as:

```text
specs/
```

Once they are present in the workspace, I can:

1. Read every spec.
2. Extract the game design, mechanics, systems, data models, levels, UI, art/audio requirements, and implementation priorities.
3. Build a new Wizard Genie version from scratch using web/Three.js-style files suitable for this engine.
4. Preserve the intended gameplay while adapting Godot-specific concepts to the Wizard Genie runtime.

## Migration approach

When the specs are available, I will create:

- A consolidated design brief.
- A feature checklist mapped from Godot to Wizard Genie.
- A first playable vertical slice.
- Iterative implementation passes for gameplay, UI, levels, polish, and persistence.
