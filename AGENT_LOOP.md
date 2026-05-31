# Autonomous Agent Loop — FreedomMMO

## Prime directive

Build **FreedomMMO** from the imported specs. The specs in `specs/` are standing prompts and primary authority. The Godot project in `reference/godot/` is reference evidence only. Rebuild cleanly in Wizard Genie.

## Authority order

1. `IMPLEMENTATION_CONTRACT.md`
2. `CURRENT_TASK.md`
3. `SPEC_IMPLEMENTATION_BACKLOG.md`
4. Imported specs in `specs/`
5. Godot reference code/assets in `reference/godot/`
6. Existing Wizard Genie implementation files

## Loop for every "continue" turn

1. Read `IMPLEMENTATION_CONTRACT.md`.
2. Read `CURRENT_TASK.md`.
3. Read the relevant backlog section in `SPEC_IMPLEMENTATION_BACKLOG.md`.
4. Read relevant spec files and Godot reference files for the task.
5. Make a checkpoint before significant changes.
6. Implement the task completely enough to leave the project in a working state.
7. Update `DONE.md` with what changed and why.
8. Update `REFERENCE_FINDINGS.md` with useful extracted facts.
9. Update `CURRENT_TASK.md` to the next concrete task.
10. Update `BLOCKERS.md` only if truly blocked by missing information or an irreversible product decision.

## Work style

- Keep moving horizontally across the core game loop before deep vertical polish.
- Prefer small complete architectural slices over giant unfinished systems.
- Do not ask for confirmation unless blocked.
- Do not port Godot scripts line-by-line.
- Preserve deterministic seed + coordinate behavior.
- Preserve simulation-state ownership; renderer is projection only.
- Keep files modular and readable.
- Avoid dependency bloat.

## Stop conditions

Stop a work turn only when:

- The current task is complete and `CURRENT_TASK.md` has been advanced, or
- The project is blocked and `BLOCKERS.md` explains exactly what is needed.
