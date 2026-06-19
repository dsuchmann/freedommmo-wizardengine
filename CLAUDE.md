# Freedom — Project Rules

This JS project IS the game (Godot/Python/Unity/GameMaker abandoned). Target: real shippable game, Steam someday via Electron/Tauri.

## The System Atlas is the authority
The world is a hypergraph of systems organized in strata S1–S7 (Simulation Kernel → World Substrate → Matter → Life → Society → Story → Shapers). Before designing or building any simulation system, read the current atlas spec in `docs/superpowers/specs/` (2026-06-11 or later, "system-atlas"). New systems must declare their place in the atlas and their edges to other systems.

## The no-mock rule (non-negotiable)
A system may be ABSENT but never FAKE. Never build a compromised/shortcut version of a system to reach a demo faster — no cardboard towns, no scripted-but-pretending-to-be-simulated NPCs, no hardcoded recipes. Each system's spec declares its "honest absence" semantics: what the world looks like when that system doesn't exist yet.

## Everything in the world renders through the GL pipeline (non-negotiable)
All content drawn INTO the world — terrain, buildings, walls, roofs, sprites, occlusion, weather, effects — MUST go through the GL chunk-render/present pipeline so it inherits the SAME lighting, day-night, fog, CRT post-process, biome texturing, linear filtering, and depth sorting as everything else. NEVER "fix" a render/draw-order problem with a separate main-thread 2D overlay that re-draws world content on top of the GL canvas: a 2D top-pass gets NONE of that (no GL lighting, no CRT, no day-night, nearest- vs linear-filtering, no shared depth sort) and produces exactly the mismatched seams that read as broken. If something must occlude or composite WITH world content (e.g. a building drawing over the player, a roof fading around the character), it belongs in the GL sprite batch / chunk bake, depth-sorted — not a 2D overlay. 2D `ctx` overlays are ONLY for true HUD/UI that sits OUTSIDE the world (debug HUD, tuners, menus). When in doubt: route it through GL. (The diegetic interior top-pass is a known pre-existing exception — a deliberately dimmed separate view — and is tech debt to migrate into GL, not a precedent to copy.)

## Locked architectural decisions (2026-06-11)
1. **Scale**: design for ~1M entities from day one (simulation LOD tiers: attention bubble full-sim → procedural → statistical aggregates).
2. **Topology**: single-player now, MMO-shaped — simulation runs as a separate local process speaking a client/server protocol; the canvas renderer is a client.
3. **Cognition**: LLM minds via deterministic context-assembly. The hypergraph (relationships, embedded memories, goals, personality) compiles tight prompts for small/fast/cheap models. Intelligence lives in the simulation; the LLM renders mind the way the canvas renders terrain. Minds are private — information moves between entities only through conversation/observation, never telepathically.
4. **Driver**: the Time Metabolism (time as finite life-resource) is the pinnacle goal function, currently being re-derived from first principles (old TIME_SYSTEM_ARCHITECTURE.md is reference, not canon).
5. **Recipes are discovered, never predefined**: minimal interaction rules → emergent combinations → discovered recipes become canonical and teachable.
6. **Buildings are spatial structures, never sprites**: nested blueprints (settlement → building → wall-piece) quantized into generatable sprite pieces.
7. **Object permanence is one system**: claims + deterministic baseline + delta log in the kernel. Large objects claim first, smaller fields fill remaining space, destruction writes a delta. Nothing pops in/out.

## Continuous testability
Every implementation pass must end with something experienceable in the running game or a headless probe (paths lead somewhere real, NPCs remember conversations, refusals are recorded as choices).

## Reference docs (design archaeology — engine code is dead, designs live)
- Old master architecture (14 layers): `C:\Users\daves\OneDrive\Documents\freedommmo\docs\superpowers\specs\2026-05-24-master-architecture-design.md`
- World compiler (roads/settlements/farms/POIs/narrative): same dir, `2026-05-24-world-compiler-design.md`
- Terrain object 3-axis model: `2026-05-28-terrain-object-system-design.md`
- Time system + causal tracking: `C:\Users\daves\OneDrive\Documents\Freedom\docs\TIME_SYSTEM_ARCHITECTURE.md`, `CAUSAL_TRACKING.md`
- Grains/items/crafting/morality/gods: `C:\Users\daves\OneDrive\Documents\Freedom\docs\SCI_FI_FANTASY_SYSTEMS.md`
- MMO topology reference: `C:\Users\daves\OneDrive\Documents\Freedom\WORLD_STREAMING.md`, `ARCHITECTURE_PLAN.md`

## Existing landscape pipeline (S2, built — don't break it)
Wang tiles (32x32 only), decoration fields F0–F7, PixelLab asset pipeline, chunked canvas renderer with web workers. See memory and `docs/superpowers/specs/` in this repo.
