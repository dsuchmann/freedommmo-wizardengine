# 20-Player Online Vertical Slice MVP

## Scope Definition

Build a **single contiguous area (512m × 512m)** supporting **20 concurrent players** with core MMORPG systems and authoritative server architecture.

---

## Core Features

### 1. Authoritative Server Architecture

**Implementation:**
- Fish-Networking with dedicated server
- Client-side prediction for movement
- Server reconciliation with rollback
- Tick rate: 30Hz server, 60fps client

**Technical Requirements:**
```csharp
// Server authority example
[ServerRpc]
public void ServerProcessMovement(MovementInput input, float timestamp)
{
    // Validate input on server
    if (ValidateMovement(input, timestamp))
    {
        ApplyMovement(input);
        BroadcastPosition();
    }
    else
    {
        // Send correction to client
        SendPositionCorrection();
    }
}
```

### 2. Player Character System

**Features:**
- Single player class with core combat abilities
- Movement: WASD movement, dash/dodge mechanic
- Combat: Light attack, heavy attack, block
- Stats: Health, Stamina, basic damage scaling

**Movement System:**
- Server-authoritative position
- Client prediction with lag compensation
- Smooth interpolation for other players
- Anti-cheat validation (speed, teleport detection)

### 3. Combat System

**Core Combat Loop:**
- **Light Attack:** Fast, low damage, combos up to 3 hits
- **Heavy Attack:** Slow, high damage, can be charged
- **Dodge:** I-frames (0.5s), stamina cost, distance-based
- **Block:** Reduces damage by 50%, stamina cost per hit

**Hit Detection:**
- Server-side collision detection
- Timestamp-based lag compensation
- Visual feedback with damage numbers
- Status effects: Stun (0.5s), Knockback

```csharp
public class CombatSystem : NetworkBehaviour
{
    [ServerRpc]
    public void ProcessAttack(AttackData attack, float timestamp)
    {
        var targets = GetTargetsInRange(attack.position, attack.range);
        foreach (var target in targets)
        {
            if (CanHit(target, timestamp))
            {
                ApplyDamage(target, attack.damage);
                TriggerHitEffects(target, attack.type);
            }
        }
    }
}
```

### 4. Enemy AI System

**Single Enemy Archetype: "Forest Goblin"**
- Health: 50 HP
- Behavior: Aggressive melee with simple AI state machine
- AI States: Idle → Chase → Attack → Retreat → Death
- Spawn density: 1 per 64m² area (≈125 total enemies)

**AI Behavior Tree:**
```
Root
├── Sequence
│   ├── HasTarget?
│   ├── InRange?
│   └── Attack
└── Selector
    ├── FindNearestPlayer
    └── Patrol
```

### 5. Loot & Inventory System

**Loot Drops:**
- Basic items: Health potions, copper coins
- Equipment: Simple weapons (+damage), armor (+defense)
- Drop rates: 80% coins, 15% potions, 5% equipment

**Inventory Features:**
- 20-slot grid-based inventory
- Server-side validation for all transactions
- Drag & drop UI with immediate visual feedback
- Equipment slots: Weapon, Armor, Accessory

### 6. Persistence System

**Save Data:**
- Player position and rotation
- Inventory contents and equipped items
- Character stats (health, experience)
- Session time and last login

**Architecture:**
- PostgreSQL database with Entity Framework
- Save on disconnect, periodic autosave (5 minutes)
- Character restoration on reconnect
- Rollback protection for corrupted saves

```sql
-- Core player table
CREATE TABLE Players (
    Id UUID PRIMARY KEY,
    Username VARCHAR(50) NOT NULL,
    PositionX FLOAT NOT NULL,
    PositionY FLOAT NOT NULL,
    PositionZ FLOAT NOT NULL,
    Health INT NOT NULL,
    Level INT DEFAULT 1,
    Experience INT DEFAULT 0,
    LastSaved TIMESTAMP DEFAULT NOW()
);
```

### 7. Interest Management & Networking

**Area of Interest (AOI):**
- Radius: 128m per player (covers ~50% of total area)
- Entity updates based on distance priority
- Culling: Entities beyond AOI not sent to clients

**Network Optimization:**
- Full updates for entities within 64m
- Reduced updates (10Hz) for entities 64-128m
- Position-only updates beyond 128m
- Delta compression for bandwidth efficiency

### 8. Basic UI System

**Core Interface:**
- **Health Bar:** Visual feedback with smooth animations
- **Stamina Bar:** Real-time updates during combat
- **Mini-Map:** Shows player position and nearby entities
- **Chat System:** Text communication between players
- **Inventory Panel:** Grid-based with drag & drop

**UI Requirements:**
- Responsive at 60fps with smooth animations
- Clear visual hierarchy and readable fonts
- Accessibility: Colorblind-friendly, scalable UI

---

## Acceptance Criteria

### Performance Requirements

**Latency & Responsiveness:**
- [ ] Client-to-server RTT: <100ms average, <200ms 95th percentile
- [ ] Movement prediction: <200ms rubber-band corrections
- [ ] Combat feedback: <100ms from input to visual confirmation
- [ ] UI responsiveness: <16ms frame time, 60fps stable

**Server Performance:**
- [ ] 20 concurrent players with stable 30Hz tick rate
- [ ] 50+ active NPCs without frame drops
- [ ] Memory usage: <2GB RAM, <50% CPU on standard VPS
- [ ] Network bandwidth: <100KB/s per player

**Stability Requirements:**
- [ ] 4+ hour play sessions without crashes
- [ ] Disconnect/reconnect: Player state restored within 10 seconds
- [ ] Server restart: All players gracefully handled with save
- [ ] Memory leaks: <10MB growth per hour of operation

### Gameplay Requirements

**Combat System:**
- [ ] Hit detection: 99%+ accuracy with lag compensation
- [ ] Dodge mechanics: Reliable i-frames, no hit-through bugs
- [ ] Damage calculations: Consistent server-side validation
- [ ] Visual feedback: Clear damage numbers, hit effects

**Multiplayer Experience:**
- [ ] Player movement: Smooth for all 20 players simultaneously
- [ ] Combat interactions: Players can fight each other and NPCs
- [ ] Loot sharing: No duplication bugs, fair distribution
- [ ] Chat system: Messages delivered reliably to all players

**Persistence & Data:**
- [ ] Save/load: 100% data integrity across sessions
- [ ] Inventory: No item loss or duplication exploits
- [ ] Character progression: Experience and stats persist
- [ ] World state: NPCs respawn correctly after kills

---

## Test Plans

### Unit Tests

**Core Systems (TDD Approach):**
```csharp
[Test]
public void MovementPrediction_WithLatency_CorrectlyReconciles()
{
    // Test client prediction with 100ms latency
    var client = CreateTestClient(latencyMs: 100);
    var server = CreateTestServer();
    
    client.SendMovementInput(Vector3.forward);
    server.ProcessMovement();
    
    Assert.That(client.Position, Is.EqualTo(server.Position).Within(0.1f));
}

[Test]
public void CombatSystem_LagCompensation_HitsRegisteredCorrectly()
{
    // Test hit detection with timestamp validation
    var attacker = CreatePlayer(position: Vector3.zero);
    var target = CreatePlayer(position: Vector3.forward);
    
    var attackData = new AttackData 
    { 
        timestamp = Time.time - 0.1f, // 100ms ago
        position = target.position
    };
    
    bool hitRegistered = CombatSystem.ProcessAttack(attacker, attackData);
    Assert.That(hitRegistered, Is.True);
}
```

### Integration Tests

**Client-Server Communication:**
- [ ] Player authentication and session management
- [ ] Movement synchronization across multiple clients
- [ ] Combat system with hit detection and damage
- [ ] Inventory operations (pickup, drop, equip)
- [ ] Chat message delivery and persistence

### Load Testing

**Headless Bot Framework:**
```python
# tools/load_testing/bot_client.py
class LoadTestBot:
    def __init__(self, bot_id: int):
        self.bot_id = bot_id
        self.client = UnityHeadlessClient()
    
    async def simulate_player_behavior(self):
        """Simulate realistic player actions."""
        await self.move_randomly()
        await self.attack_nearby_enemies()
        await self.pickup_loot()
        await self.chat_occasionally()
```

**Test Scenarios:**
- [ ] 20 bots joining simultaneously
- [ ] All bots moving continuously for 1 hour
- [ ] Combat stress test: All bots attacking same target
- [ ] Disconnect/reconnect: 50% bots cycling every 5 minutes

### Manual Testing Checklist

**Core Gameplay Flow:**
- [ ] Create character and enter world
- [ ] Move around and test movement responsiveness
- [ ] Find and attack enemies, verify combat feels good
- [ ] Pick up loot and manage inventory
- [ ] Test chat system with other players
- [ ] Disconnect and reconnect, verify state restoration

**Edge Cases:**
- [ ] Network interruption during combat
- [ ] Server restart while players connected
- [ ] Inventory full when picking up items
- [ ] Multiple players attacking same enemy
- [ ] Rapid movement inputs (spam testing)

---

## Deliverables

### 1. Client Project (Unity)

**Structure:**
```
Client/
├── Assets/
│   ├── Scripts/
│   │   ├── Network/         # Fish-Net integration
│   │   ├── Player/          # Player controller
│   │   ├── Combat/          # Combat system
│   │   ├── UI/              # User interface
│   │   └── World/           # World management
│   ├── Prefabs/
│   │   ├── Player.prefab
│   │   ├── Enemy.prefab
│   │   └── UI/
│   ├── Scenes/
│   │   ├── MainMenu.scene
│   │   ├── GameWorld.scene
│   │   └── TestScenes/
│   └── Sprites/             # Pixel art assets
├── Packages/                # Fish-Net, etc.
└── ProjectSettings/
```

### 2. Server Project (.NET 8)

**Structure:**
```
Server/
├── src/
│   ├── Core/               # Game logic
│   ├── Network/            # Fish-Net server
│   ├── Database/           # Entity Framework
│   └── AI/                 # Enemy behavior
├── Server.csproj
├── appsettings.json
└── Dockerfile
```

### 3. Load Testing Framework

**Components:**
- Headless Unity client builds for bot simulation
- Python scripts for test orchestration
- Metrics collection (RTT, bandwidth, tick rate)
- Automated test reports with performance graphs

### 4. Metrics & Monitoring

**Key Metrics:**
- Server tick rate and frame time
- Network RTT and packet loss per client
- Memory usage and garbage collection
- Database query performance
- Player count and session duration

**Logging:**
```csharp
// Example structured logging
logger.LogInformation("Player {PlayerId} dealt {Damage} damage to {TargetId}", 
    playerId, damage, targetId);
```

### 5. Local Development Guide

**"How to Run Locally" (One Page):**

1. **Prerequisites:** Unity 2023.2 LTS, .NET 8 SDK, PostgreSQL
2. **Setup Database:** `docker run -p 5432:5432 postgres`
3. **Start Server:** `dotnet run --project Server`
4. **Build Client:** Open Unity project, Build Settings → Build
5. **Run Clients:** Launch multiple client instances
6. **Connect:** All clients connect to `localhost:7777`

**Development Workflow:**
- Code changes → Automatic build → Hot reload (where possible)
- Database migrations with Entity Framework
- Asset pipeline: Python tools → Unity import → Build

---

## Success Metrics Summary

**Technical Goals:**
- 20 players at 60fps with <100ms latency
- 4+ hour stability without crashes
- <2GB RAM usage on server

**Gameplay Goals:**  
- Responsive combat with reliable hit detection
- Seamless multiplayer interactions
- Persistent character progression

**Development Goals:**
- 2-week delivery timeline met
- Comprehensive test coverage
- Production-ready deployment pipeline

---

**Next Document:** Seamless world streaming architecture design.
