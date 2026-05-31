# Freedom MMORPG - Engine & MMO Architecture Plan

## Executive Summary

This document outlines the transition from Python-based gameplay to a production-ready game engine architecture for Freedom MMORPG, a Zelda-like action-adventure targeting massive shared worlds.

**Key Decisions:**
- **Engine:** Unity 2023.2 LTS with C#
- **Networking:** Fish-Networking for authoritative server architecture
- **Target:** 20-player MVP in 2 weeks, scaling to 100s+ CCU
- **Python Role:** Tools and data pipelines only

## 1. Engine Choice & Rationale

### Unity 2023.2 LTS + C#

**Chosen for:**
- **Mature Networking Ecosystem:** Fish-Networking, Mirror, Netcode for GameObjects
- **Asset Pipeline:** Robust 2D sprite handling, animation systems, tilemap tools
- **Performance:** IL2CPP compilation for production builds
- **Ecosystem:** Extensive third-party assets, documentation, community
- **Deployment:** Build targets for Windows, Linux servers, WebGL clients
- **Team Velocity:** Industry-standard toolchain with excellent debugging

**Alternatives Considered:**
- **Godot 4:** Excellent for indie development but smaller networking ecosystem
- **Custom Engine:** Rejected - violates "no custom engine" constraint

## 2. Networking Architecture

### Authoritative Server Model

```
[Client] <---> [Game Server] <---> [Database]
    |              |                    |
    |         [Interest Mgmt]      [Session Store]
    |              |                    |
[Prediction]  [Reconciliation]    [Persistence]
```

**Core Components:**

#### Fish-Networking Stack
- **Server Authority:** All gameplay state managed server-side
- **Client Prediction:** Movement, animation, UI responsiveness
- **Lag Compensation:** Server-side hit detection with timestamp validation
- **Delta Compression:** Bandwidth optimization for entity updates

#### Interest Management
- **Spatial Partitioning:** 128m x 128m cells
- **AOI (Area of Interest):** 256m radius per client
- **Entity Culling:** Update frequency based on distance/importance
- **Network LOD:** Full updates nearby, reduced updates for distant entities

#### Entity Component System
```csharp
// Core components
public struct Transform : INetworkBehaviour
public struct Health : INetworkBehaviour  
public struct Inventory : INetworkBehaviour
public struct Movement : INetworkBehaviour
```

## 3. World Streaming Plan

### Seamless Zone Architecture

```
Cell Grid (128m x 128m each):
┌─────┬─────┬─────┐
│ A1  │ A2  │ A3  │
├─────┼─────┼─────┤
│ B1  │ B2  │ B3  │  <- Player in B2, interested in all 9 cells
├─────┼─────┼─────┤
│ C1  │ C2  │ C3  │
└─────┴─────┴─────┘
```

#### Cell Management
- **Server Assignment:** Each cell owned by a game server instance
- **Handoffs:** Seamless player transfer between cell boundaries
- **Ghost Entities:** Cross-border entity visibility for smooth transitions
- **Load Balancing:** Dynamic cell reassignment based on population

#### Streaming Pipeline
1. **Client Position Update** → Server determines AOI cells
2. **Subscribe/Unsubscribe** → Interest management updates
3. **Entity Streaming** → Add/remove entities from client view
4. **Asset Preloading** → Anticipate next cells for seamless transition

## 4. Data Model

### Schema Architecture (JSON + Protobuf)

```json
// items.json
{
  "version": "1.0.0",
  "items": {
    "sword_001": {
      "id": "sword_001",
      "name": "Iron Sword",
      "type": "weapon",
      "stats": {"damage": 25, "speed": 1.2},
      "sprite": "weapons/iron_sword.png"
    }
  }
}

// world_cells.json
{
  "version": "1.0.0", 
  "cells": {
    "forest_a1": {
      "id": "forest_a1",
      "bounds": {"x": 0, "y": 0, "width": 128, "height": 128},
      "spawners": ["goblin_camp_001"],
      "terrain": "forest_tileset"
    }
  }
}
```

### Versioned Data Pipeline
- **Schema Validation:** Python tools validate refs, balance, constraints
- **Hot Reload:** Runtime data updates without server restart
- **Backward Compatibility:** Version migration system for live updates

## 5. Services Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Client    │    │   Gateway   │    │ Game Server │
│             │◄──►│   Service   │◄──►│   Cluster   │
└─────────────┘    └─────────────┘    └─────────────┘
                           │                   │
                           ▼                   ▼
                   ┌─────────────┐    ┌─────────────┐
                   │    Auth     │    │ Persistence │
                   │   Service   │    │   Service   │
                   └─────────────┘    └─────────────┘
```

### Core Services

#### Authentication Service
- JWT tokens with refresh mechanism
- Player session management
- Anti-cheat integration hooks

#### Matchmaking/Routing
- Cell assignment based on load and geography
- Session persistence across disconnects
- Queue management for popular areas

#### Persistence Service  
- PostgreSQL for structured data (players, inventory)
- Redis for session state and caching
- Backup/restore procedures

#### Telemetry Service
- Performance metrics (tick time, RTT, bandwidth)
- Gameplay analytics (combat, economy, progression)
- Error tracking and alerting

## 6. MVP Scope - 20 Player Shared Area

### Core Features (2 Week Delivery)

**Week 1 - Foundation:**
- Unity project setup with Fish-Networking
- Basic authoritative server with client prediction
- Single area (512m x 512m) with collision
- Player movement with server reconciliation
- Basic combat (light attack, health, damage)

**Week 2 - Gameplay:**
- Enemy AI with server-side behavior
- Loot drops and pickup system
- Inventory with persistence
- Basic UI (health, stamina, chat)
- Load testing framework

### Acceptance Criteria
- **Performance:** 20 concurrent players at 60fps client, 30Hz server
- **Latency:** <100ms RTT with <200ms correction rubber-banding
- **Stability:** 4+ hour sessions without memory leaks
- **Persistence:** Disconnect/reconnect restores full player state

### Test Plan
- **Unit Tests:** Core math (movement prediction, hit detection)
- **Integration Tests:** Client-server communication, persistence
- **Load Tests:** Headless bot clients, stress testing
- **Manual Tests:** Combat feel, UI responsiveness, edge cases

## 7. Migration from Python Repository

### File Structure Transformation

```
Current Python Repo → New Monorepo Structure

freedom/                    → /server/src/
├── graphics/              → /tools/asset_pipeline/
├── core/                  → /server/core/ (game logic)
├── world/                 → /data/world_definitions/
└── items/                 → /data/item_definitions/

examples/                   → /tools/prototypes/
generated_sprites/          → /assets/sprites/
requirements.txt           → /tools/requirements.txt
```

### Migration Strategy

**Keep as Tools (Python):**
- `freedom/graphics/` → Asset pipeline and sprite processing
- `generate_*.py` → Content generation scripts
- Image processing and validation utilities

**Convert to Server (C#):**
- `freedom/core/` → Game logic and simulation
- `freedom/world/` → World management systems
- `freedom/items/` → Item and inventory systems

**Extract as Data (JSON):**
- Hard-coded game values → `/data/` configuration files
- Sprite metadata → Asset bundle definitions
- Game balance constants → Tuning parameters

### Migration Checklist (2 weeks)

**Week 1:**
- [ ] Unity project setup with Fish-Networking integration
- [ ] Extract core game data to JSON schemas  
- [ ] Convert movement and combat math to C#
- [ ] Set up basic client-server communication
- [ ] Migrate sprite assets to Unity asset pipeline

**Week 2:**
- [ ] Implement authoritative movement with prediction
- [ ] Port combat system with server validation
- [ ] Set up persistence layer (PostgreSQL + Entity Framework)
- [ ] Create Python tools for asset import/validation
- [ ] Load testing framework with headless clients

### Risk Mitigation
- **Rollback Plan:** Keep Python version functional until Unity version reaches feature parity
- **Incremental Migration:** Port systems one at a time with side-by-side testing
- **Asset Pipeline:** Automated conversion tools to avoid manual re-export

## 8. Development Guidelines

### Code Standards
- **C# Style:** Microsoft naming conventions, XML documentation
- **Architecture:** Small, composable systems over monoliths
- **Testing:** Unit tests for all game math and serialization
- **Performance:** Budget 16ms client frame time, 33ms server tick

### Deployment Strategy
- **Local Development:** Docker Compose for full stack
- **CI/CD:** Automated builds and testing on commit
- **Production:** Single VM deployment initially, K8s for scaling

### Success Metrics
- **Technical:** Sub-100ms latency, 99% uptime, predictable performance
- **Gameplay:** Responsive combat, seamless multiplayer, persistent progression
- **Development:** <4 hour builds, automated testing, 1-day feature cycles

---

**Next Steps:** Engine & networking stack decision document with detailed tradeoff analysis.
