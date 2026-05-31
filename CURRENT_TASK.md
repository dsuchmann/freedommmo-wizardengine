# Current Task

## Task ID

M2-001

## Goal

Inventory and extract the relevant Godot reference implementation facts for world generation, overmap streaming, biome/climate thresholds, chunk math, and terrain object catalogs.

## Why this matters

The Wizard Genie implementation is now modular, but its formulas are still scaffold values. The next step is to compare against the existing Godot reference so the rebuild reflects the already-enumerated FreedomMMO design and proven implementation details.

## Required reads before coding

- `AGENT_LOOP.md`
- `IMPLEMENTATION_CONTRACT.md`
- `REFERENCE_INTAKE_PLAN.md`
- `SPEC_IMPLEMENTATION_BACKLOG.md`
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
- Update `REFERENCE_FINDINGS.md` with extracted facts.
- If clear improvements are found, align the Wizard Genie constants/biome/object data with reference values.

## Acceptance criteria

- `REFERENCE_FINDINGS.md` contains concrete Godot reference findings, not just pending placeholders.
- `SPEC_IMPLEMENTATION_BACKLOG.md` Milestone 2 items are updated where completed.
- `DONE.md` is updated.
- `CURRENT_TASK.md` is advanced to the next task.
