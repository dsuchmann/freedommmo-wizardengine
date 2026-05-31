# Engine & Networking Stack Decision

## TL;DR Recommendation

**Unity 2023.2 LTS + Fish-Networking** for authoritative multiplayer with seamless scaling to 1,000+ CCU.

---

## Comparison Matrix

| Criterion | Unity + Fusion | Unity + Fish-Net | Unity + Netcode | Godot + ENet | Godot + Nakama |
|-----------|---------------|------------------|-----------------|--------------|----------------|
| **Determinism** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Lag Compensation** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| **Server Authority** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Interest Management** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| **Asset Ecosystem** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **Deployment Complexity** | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **Cost** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Tooling** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **Learning Curve** | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Path to 1000+ CCU** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |

**Rating Scale:** ⭐ (Poor) to ⭐⭐⭐⭐⭐ (Excellent)

---

## Detailed Analysis

### Unity + Fish-Networking (RECOMMENDED)

**Strengths:**
- **Production Proven:** Used by commercial MMORPGs with 500+ CCU
- **Authoritative by Design:** Server-first architecture prevents cheating
- **Excellent Documentation:** Comprehensive guides and active community
- **Performance:** Optimized for action games with frequent updates
- **Flexibility:** Custom server logic without Unity dependencies
- **Cost:** Free, open-source with commercial-friendly license

**Weaknesses:**
- **Complexity:** Requires understanding client prediction concepts
- **Setup Time:** More initial configuration than simpler solutions

**Technical Details:**
```csharp
// Example Fish-Net server authority
[ServerRpc]
public void ProcessAttack(AttackData data)
{
    if (ValidateAttack(data))
    {
        ApplyDamage(data.target, data.damage);
        BroadcastAttackResult(data);
    }
}
```

### Unity + Photon Fusion

**Strengths:**
- **Tick-Based Simulation:** Perfect for competitive action games
- **Advanced Lag Compensation:** Industry-leading prediction/rollback
- **Proven at Scale:** Powers major battle royales and shooters

**Weaknesses:**
- **Cost:** $99/month for 100 CCU, expensive for indie development
- **Vendor Lock-in:** Tied to Photon's infrastructure
- **Complexity:** Steep learning curve for deterministic simulation

### Unity + Netcode for GameObjects

**Strengths:**
- **First-Party:** Officially supported by Unity
- **Modern Architecture:** Component-based networking
- **Good Documentation:** Unity's official tutorials and samples

**Weaknesses:**
- **Maturity:** Newer solution, fewer production deployments
- **Performance:** Not optimized for high-frequency action games
- **Scaling:** Limited interest management capabilities

### Godot 4 + Built-in ENet

**Strengths:**
- **Simplicity:** Easy to get started with basic multiplayer
- **Free Engine:** No licensing costs
- **Lightweight:** Smaller builds and memory footprint

**Weaknesses:**
- **Limited Networking:** Basic client-server, no advanced features
- **Asset Ecosystem:** Smaller marketplace compared to Unity
- **Scaling:** Manual implementation of interest management
- **Community:** Smaller networking-focused community

### Godot 4 + Nakama

**Strengths:**
- **Backend Services:** Auth, matchmaking, social features included
- **Scalability:** Proven for large-scale multiplayer
- **Real-time Features:** Chat, presence, notifications built-in

**Weaknesses:**
- **Cost:** Tiered pricing based on active users
- **Integration Complexity:** Requires understanding Nakama's architecture
- **Godot Ecosystem:** Fewer third-party assets than Unity

---

## Decision: Unity + Fish-Networking

### Rationale

1. **Development Velocity:** Unity's mature ecosystem accelerates development
2. **Network Architecture:** Fish-Net provides authoritative server without vendor lock-in
3. **Scaling Path:** Clear migration to dedicated servers and interest management
4. **Community:** Large developer community with networking expertise
5. **Asset Pipeline:** Robust 2D tools for sprite management and tilemaps

### 10-Step Bootstrap Plan

#### Phase 1: Foundation (Days 1-3)
1. **Install Unity 2023.2 LTS** with 2D features and Linux build support
2. **Import Fish-Networking** via Package Manager and configure basic project settings
3. **Create Basic Scene** with player capsule, ground plane, and camera setup

#### Phase 2: Networking Core (Days 4-7)
4. **Setup Server/Client Build** configurations with headless server support
5. **Implement Player Movement** with client prediction and server reconciliation
6. **Add Basic Combat** with server-authoritative hit detection
7. **Test Local Multiplayer** with 4 clients connecting to local server

#### Phase 3: Game Features (Days 8-12)
8. **Implement Inventory System** with server-side validation and persistence
9. **Add Enemy AI** with server-controlled behavior and combat
10. **Create Load Testing** framework with headless bot clients

### Success Metrics
- **Day 7:** 4 players moving smoothly with <50ms prediction corrections
- **Day 10:** Combat system with hit detection and health management
- **Day 14:** 20 concurrent players with stable server performance

### Risk Mitigation
- **Backup Plan:** Mirror Networking as Fish-Net alternative (similar API)
- **Performance:** Profile early and often with Unity Profiler
- **Knowledge Gap:** Dedicated Fish-Net Discord and documentation study

---

**Next Document:** Migration plan from current Python repository to new engine structure.
