# 🎮 Freedom MMORPG S&box Setup Guide

## 🚀 **Quick Start**

### **Step 1: Create S&box Project**
1. Open **S&box Editor** (not the game)
2. Click **"New Project"**
3. Choose **"Minimal Game"** template
4. Name: **"Freedom MMORPG"**
5. Choose location (e.g., `C:\Users\daves\Documents\FreedomSbox`)

### **Step 2: Add Freedom Components**
Copy these C# files to your S&box project's **code folder**:

- `FreedomEntity.cs` - NPC entities with AI and stats
- `FreedomWorldGenerator.cs` - World generation from your Python system
- `FreedomNPCSpawner.cs` - Spawns NPCs from JSON data
- `FreedomGameManager.cs` - Main game controller

**Where to put them:**
```
Your S&box Project/
├── code/
│   ├── FreedomEntity.cs          ← Put here
│   ├── FreedomWorldGenerator.cs  ← Put here
│   ├── FreedomNPCSpawner.cs      ← Put here
│   └── FreedomGameManager.cs     ← Put here
└── ...
```

### **Step 3: Set Up the Scene**
1. In S&box Editor, create a new scene or use the default
2. Create an empty GameObject called **"Freedom Manager"**
3. Add these components to it:
   - `FreedomGameManager`
   - `FreedomWorldGenerator` 
   - `FreedomNPCSpawner`

### **Step 4: Configure Components**
In the **FreedomGameManager** component:
- ✅ Check `Auto Start On Load`
- Set `World Generator` → drag the same GameObject
- Set `NPC Spawner` → drag the same GameObject

In the **FreedomWorldGenerator** component:
- ✅ Check `Auto Generate On Start`
- Set `Data Path` to `"sbox_data/world.json"`

In the **FreedomNPCSpawner** component:
- ✅ Check `Auto Spawn On Start`
- Set `Max NPCs` to `10`
- Set `NPC Data Path` to `"sbox_data/npcs.json"`

## 🎯 **What You'll See When It Works**

### **Immediate Results:**
- ✅ **World Generation**: Terrain tiles appear in a 5x5 grid
- ✅ **NPC Spawning**: 10 NPCs spawn with different colors/types
- ✅ **Living World**: NPCs move around randomly
- ✅ **Time System**: Day/night cycle and seasons
- ✅ **Console Output**: Detailed logs of all systems

### **Console Commands:**
Open S&box console (`~` key) and try:
```
freedom status    # Show game status
freedom restart   # Restart all systems
freedom refresh   # Reload data from Python
```

## 📊 **Data Files Created**

Your Python script created these files in `sbox_data/`:
- **`npcs.json`** - 10 NPCs with stats, personalities, dialogue
- **`world.json`** - 25 world chunks with biomes and resources
- **`config.json`** - Game settings and parameters
- **`time_system.json`** - Time, seasons, weather data

## 🔧 **Troubleshooting**

### **If NPCs don't appear:**
1. Check console for errors
2. Verify `sbox_data/npcs.json` exists
3. Make sure `FreedomNPCSpawner` has `Auto Spawn On Start` checked

### **If world doesn't generate:**
1. Check console for "Generated chunk" messages
2. Verify `sbox_data/world.json` exists
3. Make sure `FreedomWorldGenerator` has `Auto Generate On Start` checked

### **If nothing happens:**
1. Check that `FreedomGameManager` has `Auto Start On Load` checked
2. Look for "Freedom MMORPG started successfully!" in console
3. Try console command: `freedom start`

## 🎮 **Next Steps**

### **Enhance Visuals:**
- Add 3D models for NPCs (assign to `NPCPrefab` in spawner)
- Create tile prefabs for different terrain types
- Add particle effects for resources

### **Add Interaction:**
- Click on NPCs to see their dialogue
- Implement inventory and trading systems
- Add quest mechanics

### **Connect More Systems:**
- Hook up your Python AI engine for smarter NPCs
- Integrate your economy system for trading
- Add your procedural quest generation

## 🌟 **Success Indicators**

You'll know it's working when you see:
```
🚀 Starting Freedom MMORPG...
🌍 Generated chunk (-2, -2) from Freedom data
🌍 Generated chunk (-2, -1) from Freedom data
...
👤 Spawned NPC: Character_1 (human) at (10, 0, 15)
👤 Spawned NPC: Character_2 (elf) at (-5, 0, 20)
...
✅ Freedom MMORPG started successfully!
```

## 🎯 **What Makes This Special**

This isn't just another game - it's **your Freedom MMORPG systems** running in a real game engine:

- 🧠 **Your AI NPCs** with personalities and behaviors
- 🌍 **Your world generation** with biomes and resources  
- ⏰ **Your time system** with aging and lifespans
- 💰 **Your economy** ready to integrate
- 📚 **Your story engine** ready for quests

**You now have a living, breathing world powered by your Python systems!** 🚀
