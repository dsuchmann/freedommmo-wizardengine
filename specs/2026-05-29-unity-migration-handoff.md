# FreedomMMO — Unity Migration Handoff

## Decision

Migrating from Godot 4.4 (GDScript) to Unity 6 (C#). Reason: agentic AI workflow requires reliable MCP control over the engine. Unity's MCP ecosystem is more mature, C# has better LLM support, and the rendering pipeline (2D Tilemap + Rule Tiles) natively solves problems we fought manually in Godot (Wang autotiling, sorting layers, sprite composition).

All game design specs transfer unchanged. They describe systems, not engine code.

---

## Part 1: What Dave Needs To Do (Setup)

### Step 1: Create New Unity Project

1. Open **Unity Hub**
2. Click **New Project**
3. Select **Unity 6** (latest LTS — 6000.x)
4. Template: **2D (URP)** — Universal Render Pipeline for 2D
5. Project name: `FreedomMMO`
6. Location: `C:\Users\daves\OneDrive\Documents\FreedomMMO-Unity\`
7. Click **Create Project**
8. Wait for it to open (first launch takes a few minutes)

### Step 2: Install CoplayDev/unity-mcp

In Unity, open **Window > Package Manager**, then:

1. Click **+** (top left) > **Add package from git URL**
2. Enter: `https://github.com/CoplayDev/unity-mcp.git`
3. Click **Add**
4. Wait for installation
5. The MCP bridge starts automatically when Unity runs

### Step 3: Configure Claude Code MCP Connection

Add to your `.mcp.json` in the new project directory:

```json
{
  "mcpServers": {
    "unity": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-relay", "--endpoint", "npipe:////./pipe/UnityMCP"]
    }
  }
}
```

Or follow the latest guide at: https://docs.coplay.dev/coplay-mcp/claude-code-guide

### Step 4: Install Required Unity Packages

In Package Manager, also install:
- **2D Tilemap** (built-in, should be there already)
- **2D Tilemap Extras** (Rule Tiles, Animated Tiles) — from git: `com.unity.2d.tilemap.extras`
- **2D Pixel Perfect** — for crisp pixel art rendering
- **2D Light** (URP 2D Lighting) — for dynamic day/night
- **TextMeshPro** — for UI text (usually auto-installed)
- **Cinemachine** — for camera follow

### Step 5: Configure Pixel Art Settings

In **Edit > Project Settings > Quality**:
- Default Filter Mode: **Point (no filter)**
- Compression: **None** for sprites

In **Edit > Project Settings > Graphics** (URP):
- Anti-aliasing: **None**

### Step 6: Import PixelLab Sprites

Copy the entire sprite catalog from Godot:
```
FROM: C:\Users\daves\OneDrive\Documents\freedommmo\assets\catalog\terrain_objects\
TO:   C:\Users\daves\OneDrive\Documents\FreedomMMO-Unity\Assets\Sprites\TerrainObjects\
```

These are 6,000+ PNGs that transfer directly. Unity will auto-import them.

### Step 7: Git Init + Push

```bash
cd C:\Users\daves\OneDrive\Documents\FreedomMMO-Unity
git init
git remote add origin https://github.com/dsuchmann/freedommmo-unity.git
```

(Create the repo on GitHub first)

### Step 8: Verify MCP Connection

Once Unity is open and the project is loaded, restart Claude Code. I should be able to call Unity MCP tools to verify the connection. We'll test with a simple scene creation.

---

## Part 2: What Transfers From Godot

### Specs & Design Docs (ALL transfer — engine-agnostic)

These live in `freedommmo/docs/superpowers/specs/` and describe game SYSTEMS:

| Spec | What It Covers | Priority |
|------|---------------|----------|
| `2026-05-24-master-architecture-design.md` | 7-layer system architecture | CRITICAL |
| `2026-05-28-terrain-object-system-design.md` | Object placement, categories, elevation | CRITICAL |
| `2026-05-29-biome-layer-stack-design.md` | Visual layering rule — Layer 0 never alone | CRITICAL |
| `2026-05-24-vertical-slice-design.md` | Village vertical slice target | CRITICAL |
| `2026-05-26-world-biome-system-design.md` | 18-biome system | HIGH |
| `2026-05-24-world-compiler-design.md` | 13-layer deterministic worldgen | HIGH |
| `2026-05-27-elevation-hypergraph-terrain-design.md` | Elevation system | HIGH |
| `2026-05-25-tileset-framework-design.md` | 7-layer rendering | HIGH |
| `2026-05-26-dynamic-lighting-spec.md` | Day/night cycle | MEDIUM |
| `2026-05-26-subterranean-design.md` | Cave/underground | LATER |

### Freedom/ Prototype Docs (CRITICAL game design)

| Doc | What It Covers |
|-----|---------------|
| `Freedom/docs/TIME_SYSTEM_ARCHITECTURE.md` | **THE core game loop** — time as primary resource |
| `Freedom/docs/CAUSAL_TRACKING.md` | Event recording, NPC knowledge, gossip |
| `Freedom/docs/SCI_FI_FANTASY_SYSTEMS.md` | Grain-based crafting & magic |
| `Freedom/DATA_SCHEMAS.md` | Complete data models for all systems |

### Art Assets (6,000+ PNGs — direct transfer)

```
assets/catalog/terrain_objects/
├── ground_cover/     — dirt, leaves, snow, sand, gravel (2,000+)
├── vegetation/       — grass, trees, flowers, ferns, moss (1,500+)
├── mineral/          — rocks, boulders, crystals, ore (500+)
├── structure_natural/ — logs, nests, caves, bones (200+)
├── water_feature/    — coral, kelp, algae (200+)
└── _uncategorized/   — needs sorting (1,500+)
```

All 32x32 or 64x64 pixel art PNGs with transparency. Import into Unity as Sprites with:
- Pixels Per Unit: 32
- Filter Mode: Point
- Compression: None

### Biome Layer Definitions (JSON — direct transfer)

```
data/terrain_objects/biome_layers/*.json  — 18 biome definitions
data/terrain_objects/catalog.json         — 268 object definitions
data/terrain_objects/affinities/*.json    — biome-object relationships
```

These JSON files define what objects go where. The Unity placement system reads them the same way.

### Memory Files (Design decisions — transfer to new CLAUDE.md)

Key decisions that must carry forward:
- Layered character rendering (nude base + equipment overlays)
- NPC goal hypergraphs (predictive, never hardcode)
- Everything composable (no monolithic sprites)
- Everything animated (no static assets)
- Time as primary resource
- NL command architecture for player instructions

---

## Part 3: Unity Architecture

### Rendering (2D Tilemap)

```
Sorting Layer 0: Terrain Base      — Tilemap with Rule Tiles (biome transitions)
Sorting Layer 1: Ground Detail     — Tilemap or sprites (dirt, leaves, pine needles)
Sorting Layer 2: Ground Objects    — Sprites (pebbles, twigs, small debris)
Sorting Layer 3: Flora             — Sprites (grass, moss, ferns)
Sorting Layer 4: Accent            — Sprites (flowers, mushrooms)
Sorting Layer 5: Large Objects     — Sprites (trees, boulders, structures)
Sorting Layer 6: Characters        — Sprites (player, NPCs)
Sorting Layer 7: Overhead          — Tilemap (roofs, canopy — alpha fade when player enters)
Sorting Layer 8: UI/Effects        — Particles, lighting overlays
```

Unity Sorting Layers handle z-ordering NATIVELY. No manual z_index math.

### Layer 1 Solution (What We Fought In Godot)

Unity's **Rule Tiles** solve this directly:
- Define a Rule Tile for "forest_floor" with 64 variants
- Set neighbor rules for auto-tiling (Wang-style transitions)
- Paint it on a Tilemap layer — it seamlessly tiles itself
- Different Rule Tiles per biome/elevation
- NO individual sprite-per-tile placement needed

This is the exact thing we couldn't achieve in Godot with individual sprites.

### World Streaming

```csharp
// Chunk-based streaming — same concept as Godot but using Unity native
public class ChunkStreamer : MonoBehaviour {
    // Load/unload chunks around player
    // Each chunk = Tilemap section + object instances
    // Background thread generates terrain data
    // Main thread instantiates GameObjects
}
```

### Simulation Layer (Separate from Rendering)

```csharp
// Runs NPC AI, economy, time system — no rendering overhead
public class SimulationEngine : MonoBehaviour {
    // 10K+ NPCs tracked as pure data (no GameObjects)
    // Only visible NPCs get instantiated as GameObjects
    // Ticks on background thread at configurable rate
    // Systems: TimeSystem, PopulationSim, EconomySystem,
    //          FactionSystem, MoralitySystem, QuestGenerator
}
```

### Project Structure

```
Assets/
├── Scripts/
│   ├── Core/           — Data models, systems, simulation
│   ├── World/          — Terrain gen, biomes, streaming
│   ├── Rendering/      — Tilemap setup, object placement, lighting
│   ├── Entities/       — Player, NPCs, entity lifecycle
│   ├── Combat/         — Combat system, status effects
│   ├── Social/         — Dialogue (LLM), relationships, factions
│   ├── Economy/        — Items, crafting, trade
│   ├── Narrative/      — Quests, events, causal tracking
│   └── UI/             — All UI panels
├── Sprites/
│   ├── TerrainObjects/ — 6,000+ from PixelLab
│   ├── Tilesets/       — Rule Tiles for biome transitions
│   └── Characters/     — Layered character sprites
├── Tilemaps/           — Tilemap palettes and brushes
├── Data/               — JSON configs (biomes, catalog, affinities)
├── Prefabs/            — Reusable object prefabs
└── Scenes/
    ├── MainMenu.unity
    ├── GameWorld.unity  — The main playable scene
    └── Test/            — Test scenes for individual systems
```

---

## Part 4: Build Order (First Session)

### Phase 0: Setup & Verify (Dave does this)
1. Create Unity project (2D URP template)
2. Install CoplayDev/unity-mcp package
3. Configure MCP in Claude Code
4. Copy sprites from Godot project
5. Git init + push
6. Verify MCP connection works

### Phase 1: Terrain Foundation (Claude builds this)
1. Create base Tilemap with biome Rule Tiles
2. Implement chunk-based terrain generation (Perlin noise)
3. Wire up biome classification (temperature/moisture/elevation)
4. Wang-style auto-tiling transitions between biomes
5. Elevation rendering with proper z-ordering

### Phase 2: Object Layer Stack (Claude builds this)
1. Port PlacementEngine logic to C#
2. Layer 1: Rule Tiles for ground textures (per biome, per elevation)
3. Layers 2-3: Sprite placement with noise clustering
4. Layers 4-5: Accent and large object placement
5. Visual verification at each layer

### Phase 3: Player & Camera
1. Player controller (top-down movement)
2. Pixel-perfect camera with Cinemachine
3. Collision with terrain/objects
4. Basic input system

### Phase 4: Core Systems
1. Time System (the game loop foundation)
2. Entity data model
3. NPC spawning and basic AI
4. Day/night cycle with 2D lighting

### Phase 5: Vertical Slice
1. One village with structures, NPCs, paths
2. Dialogue (LLM integration)
3. Combat
4. Crafting
5. The full gameplay loop in one area

---

## Part 5: What NOT To Bring Forward

- GDScript code (rewrite in C#, don't port line-by-line)
- Custom pixel rendering (Godot's Image-based painting — use Tilemaps instead)
- Manual z-index math (Unity Sorting Layers handle this)
- DevBox workflow (start fresh, use GitHub Actions for CI)
- The GDExtension C++ code (Unity has its own native plugin system if needed)

---

## Part 6: PixelLab Integration

PixelLab works with any engine — it generates PNGs. The MCP connection stays the same:

```json
{
  "mcpServers": {
    "pixellab": {
      "command": "npx",
      "args": ["-y", "@pixellab-ai/mcp"],
      "env": { "PIXELLAB_API_KEY": "..." }
    }
  }
}
```

The 5,400+ completed objects on PixelLab are still there. We download them into the Unity project's `Assets/Sprites/` folder instead of Godot's `assets/catalog/`.

For Rule Tiles (Layer 1 ground textures), we may need to generate **tileset strips** via PixelLab's `create_topdown_tileset` rather than individual objects. This gives us seamless auto-tiling that Unity Rule Tiles can use directly.

---

## Summary

| What | Status |
|------|--------|
| Game design specs | Transfer as-is (111 docs) |
| Art assets | Transfer as-is (6,000+ PNGs) |
| Biome data (JSON) | Transfer as-is |
| GDScript code | Rewrite in C# (better anyway) |
| MCP control | CoplayDev/unity-mcp (86 tools) |
| Rendering | Unity 2D Tilemap + Rule Tiles |
| Layer 1 problem | Solved natively by Rule Tiles |
| Simulation scale | Separate C# layer, no ECS needed |
| First milestone | Playable village with all systems |
