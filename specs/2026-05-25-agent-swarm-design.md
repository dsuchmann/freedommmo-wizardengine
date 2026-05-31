# Agent Swarm Architecture — Parallel Build + Verify Loop

## Overview
27 agents operating continuously in a build→verify→fix cycle. Never stopping. The benchmark is CrossCode/Octopath Traveler/Legend of Zelda quality. If the game doesn't match or exceed those, work continues.

## Agent Roster

### Tier 1: Research (5 agents, dissolve after findings delivered)
- R1: Codebase Explorer — map renderer, world compiler, 14 layers, ChunkData
- R2: Specs Researcher — read all 8 spec docs, extract decisions
- R3: PixelLab MCP Scout — catalog tools, rate limits, batch patterns
- R4: Godot MCP Scout — TileMapLayer, BetterTerrain, screenshots, play_scene
- R5: Agentic Patterns — web search multi-agent orchestration best practices

### Tier 2: Builders (2 persistent workstreams)
- P1: PixelLab Pipeline — download 764 objects, animate all, write manifests
- M1: TileMapLayer Migration — execute 6-task plan, replace custom renderer

### Tier 3: Technical Verifiers (10 agents, persistent loop)
- V1: Terrain (z=-2) — biome tiles, organic shapes, autotile transitions
- V2: Water (z=0) — rivers/lakes render correctly, animated
- V3: Paths (z=2) — roads/trails visible, transitions work
- V4: Buildings (z=3) — spatial wall/floor/door tiles, enterable
- V5: Objects (z=4-5) — visible, biome-appropriate, wind sway
- V6: Roofs (z=6) — alpha-fade on player entry
- V7: Layer Composition — all 7 stack, no z-fighting
- V8: Collision/Physics — water blocks, walls block, doors passable
- V9: Asset Pipeline — downloads complete, animations exist, manifests valid
- V10: NPC Spatial — spawn at buildings, pathfind, don't float in water

### Tier 4: Experiential Verifiers (10 agents, persistent loop)
- V11: Assembly — coherent scene, no seams, no floating elements
- V12: Biome — each biome looks distinct, feels right
- V13: Aesthetics — CrossCode quality, 4-8px/tile, harmonious palettes
- V14: Coherency — logical placement (no trees in ocean, paths to doors)
- V15: Utility — player can DO things, systems produce visible results
- V16: Convenience — UI readable, controls responsive, clear feedback
- V17: Community — NPCs form believable villages with purpose
- V18: Exploration — world worth exploring, variety, landmarks, journeys
- V19: Discovery — hidden areas, rare resources, environmental storytelling
- V20: Surprise — emergent moments, weather mood, NPC reactions

## Orchestration Model: Continuous Parallel Mesh

All tiers launch simultaneously. Research feeds builders. Builders commit. Verifiers screenshot after each commit, produce work items, feed them back to builders. Loop never stops.

## Verification Protocol

1. Screenshot via Godot MCP (get_game_screenshot or get_editor_screenshot)
2. Analyze against benchmark (CrossCode/Octopath/Zelda)
3. Gap found? → Create work item:
   - LAYER, STATUS (BLOCKED/IMPORTANT/MINOR), GAP description
   - EVIDENCE (screenshot), FIX (specific action), FILES (exact paths)
   - SEVERITY determines block behavior
4. No gap? → Mark verified with evidence
5. Re-verify after every builder commit
6. Periodic re-verify every 5 minutes regardless

## Block Rules
- CRITICAL: Layer blocked, builder cannot mark done
- IMPORTANT: Queued as follow-up work item for builder
- MINOR: Logged, doesn't block

## Success Criteria
The game must visually match or exceed CrossCode, Octopath Traveler, and Legend of Zelda: A Link to the Past in:
- Pixel art density and quality
- Terrain transitions and biome variety
- Object placement and environmental storytelling
- Animation and life in the world
- Layer composition and visual depth

If it doesn't, agents keep iterating. There is no "done."
