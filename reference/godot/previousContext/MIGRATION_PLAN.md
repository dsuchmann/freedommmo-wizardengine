# Migration Plan: Python → Unity Engine Architecture

## Current Repository Analysis

### Python Module Inventory

| Module | Type | Lines | Status | Migration Strategy |
|--------|------|-------|--------|-------------------|
| **Core Systems** | | | | |
| `freedom/core/types.py` | Data Models | 747 | Convert | → C# structs/classes |
| `freedom/core/config.py` | Configuration | ~100 | Extract | → JSON configs |
| `freedom/core/time_system.py` | Game Logic | ~200 | Convert | → C# server logic |
| `freedom/core/morality_system.py` | Game Logic | ~300 | Convert | → C# server logic |
| **World Systems** | | | | |
| `freedom/world/generator.py` | World Gen | 269+ | Keep | → Python tool |
| `freedom/world/location_system.py` | Game Logic | ~400 | Convert | → C# server logic |
| `freedom/world/cultural_system.py` | Game Logic | ~300 | Convert | → C# server logic |
| **Item & Equipment** | | | | |
| `freedom/items/item_system.py` | Game Logic | 906+ | Convert | → C# server logic |
| `freedom/items/crafting_system.py` | Game Logic | ~500 | Convert | → C# server logic |
| `freedom/items/object_system.py` | Game Logic | ~400 | Convert | → C# server logic |
| **Graphics & Assets** | | | | |
| `freedom/graphics/pixellab_*.py` | Asset Pipeline | ~1000 | Keep | → Python tools |
| `freedom/graphics/sprite_*.py` | Asset Pipeline | ~600 | Keep | → Python tools |
| `freedom/graphics/image_generator.py` | Asset Pipeline | ~300 | Keep | → Python tools |
| **AI & Story** | | | | |
| `freedom/story/llm_story_engine.py` | Game Logic | ~400 | Convert | → C# server service |
| `freedom/npc/ai_engine.py` | Game Logic | ~500 | Convert | → C# server logic |
| **Client & Server** | | | | |
| `freedom/client/game_client.py` | Legacy Client | ~200 | Discard | Unity replaces |
| `freedom/server/world_server.py` | Legacy Server | ~300 | Discard | Fish-Net replaces |

---

## New Monorepo Structure

```
FreedomMMORPG/
├── client/                     # Unity Project
│   ├── Assets/
│   │   ├── Scripts/
│   │   │   ├── Core/           # Core game systems
│   │   │   ├── Network/        # Fish-Net networking
│   │   │   ├── UI/             # User interface
│   │   │   └── World/          # World representation
│   │   ├── Prefabs/            # Unity prefabs
│   │   ├── Sprites/            # Generated sprites
│   │   └── Scenes/             # Game scenes
│   ├── Packages/               # Fish-Net, dependencies
│   └── ProjectSettings/        # Unity project config
├── server/                     # Authoritative Server
│   ├── src/
│   │   ├── Core/               # Core game logic
│   │   │   ├── Types.cs        # Data models
│   │   │   ├── TimeSystem.cs   # Game time
│   │   │   └── Config.cs       # Configuration
│   │   ├── World/              # World management
│   │   │   ├── LocationSystem.cs
│   │   │   ├── ChunkManager.cs
│   │   │   └── CulturalSystem.cs
│   │   ├── Items/              # Item & equipment
│   │   │   ├── ItemSystem.cs
│   │   │   ├── CraftingSystem.cs
│   │   │   └── Equipment.cs
│   │   ├── AI/                 # NPC behavior
│   │   │   ├── AIEngine.cs
│   │   │   └── BehaviorTrees.cs
│   │   ├── Story/              # Narrative systems
│   │   │   ├── StoryEngine.cs
│   │   │   └── QuestSystem.cs
│   │   └── Network/            # Server networking
│   │       ├── ServerManager.cs
│   │       └── PlayerSession.cs
│   ├── Server.csproj           # .NET project
│   └── appsettings.json        # Server configuration
├── tools/                      # Python Tools Only
│   ├── asset_pipeline/         # Sprite & asset generation
│   │   ├── pixellab_generator.py
│   │   ├── sprite_processor.py
│   │   └── atlas_builder.py
│   ├── content_validation/     # Data validation
│   │   ├── schema_validator.py
│   │   ├── balance_checker.py
│   │   └── reference_checker.py
│   ├── world_generation/       # Procedural generation
│   │   ├── world_generator.py  # From freedom/world/generator.py
│   │   ├── biome_generator.py
│   │   └── export_world_data.py
│   ├── load_testing/           # Performance testing
│   │   ├── bot_client.py
│   │   ├── stress_test.py
│   │   └── metrics_collector.py
│   └── requirements.txt        # Python dependencies
├── data/                       # JSON Game Data
│   ├── items/
│   │   ├── weapons.json
│   │   ├── armor.json
│   │   └── consumables.json
│   ├── world/
│   │   ├── biomes.json
│   │   ├── locations.json
│   │   └── spawn_tables.json
│   ├── npcs/
│   │   ├── ai_behaviors.json
│   │   └── dialogue_trees.json
│   └── schemas/                # JSON schemas for validation
│       ├── item_schema.json
│       ├── world_schema.json
│       └── npc_schema.json
├── assets/                     # Generated Assets
│   ├── sprites/                # From mcp_pixellab_assets/
│   ├── animations/             # Animation data
│   └── audio/                  # Sound effects
├── infra/                      # Infrastructure
│   ├── docker/
│   │   ├── Dockerfile.server
│   │   ├── Dockerfile.client
│   │   └── docker-compose.yml
│   ├── scripts/
│   │   ├── build.sh
│   │   ├── deploy.sh
│   │   └── test.sh
│   └── k8s/                    # Future Kubernetes configs
├── docs/                       # Documentation
│   ├── ARCHITECTURE.md
│   ├── API.md
│   └── DEPLOYMENT.md
├── .github/                    # CI/CD
│   └── workflows/
│       ├── build.yml
│       └── test.yml
└── README.md                   # Project overview
```

---

## Module-by-Module Migration Plan

### Keep as Python Tools

**`freedom/graphics/` → `tools/asset_pipeline/`**
- **Reason:** Asset generation is ideal for Python's image processing libraries
- **Migration:** Move to tools/, add CLI interfaces, containerize for build pipeline
- **Timeline:** Week 1

**`freedom/world/generator.py` → `tools/world_generation/`**
- **Reason:** Procedural generation benefits from Python's scientific libraries (numpy, opensimplex)
- **Migration:** Extract to standalone tool that outputs JSON world data
- **Timeline:** Week 1

### Convert to C# Server Logic

**`freedom/core/` → `server/src/Core/`**
```csharp
// Example: Convert Python types to C# structs
// From: freedom/core/types.py
public struct Position
{
    public float X { get; set; }
    public float Y { get; set; }
    public float Z { get; set; }
    
    public float DistanceTo(Position other)
    {
        return Mathf.Sqrt(
            Mathf.Pow(X - other.X, 2) + 
            Mathf.Pow(Y - other.Y, 2) + 
            Mathf.Pow(Z - other.Z, 2)
        );
    }
}
```

**`freedom/items/` → `server/src/Items/`**
- Convert item system, crafting logic, equipment management
- Maintain server authority for all item operations
- Timeline: Week 2

**`freedom/world/location_system.py` → `server/src/World/`**
- Convert world management, but not generation (stays in Python tools)
- Timeline: Week 2

### Extract as JSON Data

**Configuration → `data/`**
```json
// Example: Extract hardcoded values to JSON
// From: Python constants in various files
{
  "version": "1.0.0",
  "combat": {
    "base_damage_multiplier": 1.0,
    "critical_hit_chance": 0.15,
    "dodge_iframe_duration": 0.5
  },
  "economy": {
    "base_trade_tax": 0.05,
    "vendor_markup": 1.2
  }
}
```

### Discard/Replace

**`freedom/client/game_client.py`** → Unity client replaces entirely
**`freedom/server/world_server.py`** → Fish-Net server replaces

---

## 2-Week Migration Checklist

### Week 1: Foundation & Tools

**Day 1-2: Repository Setup**
- [ ] Create new monorepo structure
- [ ] Set up Unity 2023.2 LTS project with Fish-Networking
- [ ] Create .NET 8 server project with Entity Framework
- [ ] Configure CI/CD pipeline (GitHub Actions)

**Day 3-4: Python Tools Migration**
- [ ] Move `freedom/graphics/` → `tools/asset_pipeline/`
- [ ] Add CLI interfaces to all asset tools
- [ ] Move `freedom/world/generator.py` → `tools/world_generation/`
- [ ] Create `tools/content_validation/` for data validation

**Day 5-7: Data Extraction**
- [ ] Extract all hardcoded values to JSON configurations
- [ ] Create JSON schemas for validation
- [ ] Write Python script to export existing game data
- [ ] Set up data validation pipeline

### Week 2: Core System Conversion

**Day 8-10: Core Systems**
- [ ] Convert `freedom/core/types.py` to C# data models
- [ ] Implement time system in C# server
- [ ] Port configuration system to appsettings.json
- [ ] Set up Entity Framework with PostgreSQL

**Day 11-12: Game Logic**
- [ ] Convert item system to C# with server authority
- [ ] Implement basic equipment management
- [ ] Port morality system for NPC behavior
- [ ] Create basic world management systems

**Day 13-14: Integration & Testing**
- [ ] Integrate Unity client with Fish-Net server
- [ ] Implement basic player movement and synchronization
- [ ] Set up load testing with headless bot clients
- [ ] Write migration validation tests

---

## Data Extraction Script

Create `tools/extract_game_data.py` to extract domain data:

```python
#!/usr/bin/env python3
"""Extract game data from Python modules to JSON format."""

import json
import inspect
from pathlib import Path
from freedom.core.types import BiomeType, EquipmentSlot
from freedom.items.item_system import ItemType

def extract_enums():
    """Extract enum definitions to JSON."""
    data = {
        "biomes": [e.value for e in BiomeType],
        "equipment_slots": [e.value for e in EquipmentSlot],
        "item_types": [e.value for e in ItemType]
    }
    return data

def extract_constants():
    """Extract game constants from various modules."""
    # Scan modules for UPPERCASE constants
    constants = {}
    # Implementation here
    return constants

def main():
    """Extract all game data to data/ directory."""
    output_dir = Path("data")
    output_dir.mkdir(exist_ok=True)
    
    # Extract different data types
    enums_data = extract_enums()
    constants_data = extract_constants()
    
    # Write to JSON files
    with open(output_dir / "enums.json", "w") as f:
        json.dump(enums_data, f, indent=2)
    
    with open(output_dir / "constants.json", "w") as f:
        json.dump(constants_data, f, indent=2)
    
    print("✅ Game data extracted successfully")

if __name__ == "__main__":
    main()
```

---

## Risk Mitigation

### Technical Risks

**Risk:** Performance degradation in C# compared to Python
- **Mitigation:** Profile early, use Unity Profiler, benchmark critical paths
- **Rollback:** Keep Python version functional until C# matches performance

**Risk:** Networking complexity with Fish-Net
- **Mitigation:** Start with simple movement, add features incrementally
- **Rollback:** Mirror Networking as backup (similar API)

**Risk:** Data loss during migration
- **Mitigation:** Version control everything, automated backups, validation scripts
- **Rollback:** Git history preserves all Python source

### Project Risks

**Risk:** Timeline overrun due to learning curve
- **Mitigation:** Prototype core systems first, focus on MVP features only
- **Fallback:** Extend timeline, reduce initial scope

**Risk:** Asset pipeline breaks during migration
- **Mitigation:** Keep existing Python tools functional, test thoroughly
- **Rollback:** Containerize current asset generation for stability

### Success Criteria

**Week 1:** 
- ✅ New repo structure with working build pipeline
- ✅ Python tools generating assets in new format
- ✅ JSON data extracted and validated

**Week 2:**
- ✅ Unity client connecting to C# server
- ✅ Basic player movement synchronized
- ✅ Core game data loading from JSON
- ✅ Load testing framework operational

---

**Next Document:** 20-player MVP scope with detailed acceptance criteria.
