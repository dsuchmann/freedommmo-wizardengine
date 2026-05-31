# Unity AI Terrain System Prompt

## 🎯 PRIMARY PROMPT

**Context**: User has Unity 2D project with Fish-Networking. Currently only sees green player square, no terrain visible. User is NOT a software engineer. Needs immediate, working solution.

**Task**: Create seamless 2D terrain system using Unity's built-in Tilemap system. User wants "hundreds of terrain tiles that touch seamlessly" forming "continuous patch of land."

**Current Assets Available**:
- `Assets/pixellab_test_tile.png` - Isometric terrain sprite (working)
- Unity 2D project with orthographic camera
- Player controller working (green square at Z = -1.0)

**Required Output**:
1. **Step-by-step instructions** to create Unity Tilemap system
2. **Working C# script** for terrain generation
3. **Proper Z-layering** (terrain behind player)
4. **Seamless tile coverage** - no gaps between tiles
5. **Large terrain area** - 50x50 tiles minimum for proper coverage

**Success Criteria**:
- User sees continuous terrain field (not scattered tiles)
- Player visible above terrain
- No gaps or white space between tiles
- Terrain covers significant area around player

**Implementation Requirements**:
```csharp
// Must use Unity Tilemap system
// Must create Tile asset from existing sprite
// Must generate large grid (50x50 minimum)
// Must ensure proper layering (terrain Z=0, player Z=-1)
// Must provide clear step-by-step setup instructions
```

**User Skill Level**: Non-technical - provide detailed steps for:
- Creating Tile assets in Unity
- Setting up Grid and Tilemap GameObjects
- Writing/attaching terrain generation script
- Configuring proper layer ordering

---

## ❌ NEGATIVE PROMPT

**DO NOT**:
- Create individual GameObject sprites (use Tilemap system)
- Provide theoretical explanations without practical steps
- Assume user knows Unity terminology without explanation
- Create scattered/random tile placement
- Use complex algorithms or advanced Unity features
- Suggest manual tile placement in editor
- Create gaps between tiles
- Use 3D terrain systems
- Overcomplicate with multiple terrain types initially
- Require external assets or packages beyond Fish-Networking

**AVOID**:
- Technical jargon without explanation
- "You should already know how to..." assumptions
- Multiple solution options (provide ONE working solution)
- Advanced optimization before basic functionality works
- Complex scripting patterns for beginners
- References to Unity features user hasn't set up
- Incomplete code snippets
- Solutions requiring deep Unity knowledge

**WRONG APPROACHES**:
- Manual sprite GameObjects instead of Tilemap
- Complex procedural generation algorithms
- Multiple terrain layers before basic terrain works
- Advanced shaders or materials
- Performance optimization before functionality
- Networking integration before local terrain works
- Asset store dependencies
- Custom tile rendering systems

---

## 🎯 SPECIFIC REQUIREMENTS

**Must Include**:
1. **Exact steps** to create Tile asset from `pixellab_test_tile.png`
2. **Complete C# script** for terrain generation
3. **GameObject setup** instructions (Grid, Tilemap, TilemapRenderer)
4. **Layer ordering** configuration
5. **Testing instructions** to verify it works

**Script Requirements**:
```csharp
// Generate 50x50 grid minimum
// Use Tilemap.SetTile() for each position
// Ensure tiles are adjacent (no spacing)
// Set proper Z-position for layering
// Include bounds checking
// Simple, readable code with comments
```

**Visual Result User Should See**:
- Continuous field of terrain tiles
- Green player square visible on top of terrain
- No gaps or white space between tiles
- Terrain extending beyond camera view
- Seamless, game-like appearance

**Delivery Format**:
1. **Step 1**: Create Tile Asset (with screenshots descriptions)
2. **Step 2**: Set up GameObjects (exact hierarchy)
3. **Step 3**: Add terrain script (complete code)
4. **Step 4**: Configure settings (specific values)
5. **Step 5**: Test and verify (what user should see)

---

## 🔧 TECHNICAL CONSTRAINTS

**Unity Version**: 2023.2 LTS (2D Template)
**Existing Setup**: 
- Orthographic camera
- Fish-Networking (don't interfere)
- Player at Z = -1.0
- Scene: MainScene

**Required Components**:
- Grid (Unity built-in)
- Tilemap (Unity built-in) 
- TilemapRenderer (Unity built-in)
- Custom terrain generation script

**Performance Target**:
- 2500+ tiles (50x50 grid)
- 60fps on standard hardware
- Immediate generation (no loading delays)

**Compatibility**:
- Must work with existing player controller
- Must not interfere with Fish-Networking
- Must be 2D isometric compatible
- Must support future expansion

---

## 💡 SUCCESS EXAMPLE

**User Should Experience**:
1. Follow clear steps in Unity Editor
2. Run scene and immediately see terrain field
3. Player moves on continuous terrain surface
4. No technical errors or missing references
5. Professional game-like appearance

**Final Result Description**:
"You should now see a large field of brown terrain tiles extending in all directions around your green player square. The tiles touch each other seamlessly with no gaps, creating a continuous landscape. Your player should be clearly visible on top of the terrain."

---

## 🚨 CRITICAL SUCCESS FACTORS

1. **Immediate visual results** - User must see terrain after following steps
2. **No technical prerequisites** - Assume user knows basic Unity navigation only
3. **Complete solution** - Nothing left to figure out
4. **Error-free implementation** - All references and components properly set up
5. **Scalable foundation** - Can be expanded later for full game world

**Priority Order**:
1. Get terrain visible (most important)
2. Ensure seamless coverage
3. Proper layering with player
4. Clean, maintainable code
5. Performance optimization
