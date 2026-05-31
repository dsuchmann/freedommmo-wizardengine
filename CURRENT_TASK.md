# Current Task

## Task ID

M2-001

## Goal

Inventory and extract the relevant Godot reference implementation facts for world generation, overmap streaming, biome/climate thresholds, chunk math, terrain object catalogs, and the asset/state variation pipeline.

## Why this matters

The Wizard Genie implementation now has playable testing hooks for overmap teleport, elevation communication, and day/night lighting. The next step is to align formulas, thresholds, and asset data structures with the Godot reference and imported specs so we converge on the actual FreedomMMO design rather than scaffold approximations.

## Required reads before coding

- `AGENT_LOOP.md`
- `IMPLEMENTATION_CONTRACT.md`
- `REFERENCE_INTAKE_PLAN.md`
- `SPEC_IMPLEMENTATION_BACKLOG.md`
- `specs/2026-05-26-asset-pipeline-spec.md`
- `specs/2026-05-26-biome-asset-manifest-spec.md`
- `specs/2026-05-25-tile-object-system-design.md`
- `reference/godot/config/server_config.json`
- Relevant files discovered under `reference/godot/scripts`, `reference/godot/data`, and `reference/godot/resources`

## Deliverables

- Build a concise source/config inventory for the Godot reference.
- Identify files related to:
  - overmap generation
  - world compiler / chunk generation
  - biome, climate, elevation, moisture, temperature
  - seed/noise utilities
  - terrain object affinities/catalogs
  - asset manifests, variation states, and catalog conventions
- Update `REFERENCE_FINDINGS.md` with extracted facts.
- If clear improvements are found, align the Wizard Genie constants/biome/object/asset data with reference values.

## Acceptance criteria

- `REFERENCE_FINDINGS.md` contains concrete Godot reference findings, not just pending placeholders.
- `SPEC_IMPLEMENTATION_BACKLOG.md` Milestone 2 items are updated where completed.
- `DONE.md` is updated.
- `CURRENT_TASK.md` is advanced to the next task.
