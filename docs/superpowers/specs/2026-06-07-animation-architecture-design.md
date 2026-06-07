# Animation Architecture Design

**Date:** 2026-06-07
**Status:** Draft
**Scope:** Universal animation system for all decoration fields (2-7). Every living object needs wind, interaction, lifecycle, and elemental state animations.

## Overview

Four animation systems work together to make every object in the world feel alive. These systems are layered — an object can simultaneously sway in wind, react to the player stepping on it, be in its "mature" life stage, and have a "frozen" elemental state. The systems compose, they don't replace each other.

```
Object render = base_sprite
  × life_cycle_stage      (which sprite variant to use)
  × elemental_state       (color/overlay modification)
  × wind_animation        (positional sway from weather)
  × player_interaction    (disturbance reaction)
```

## System 1: Wind & Weather

### Concept
A global wind vector flows across the world. All vegetation (grass, ferns, flowers, trees, bushes) sways in this direction. The wind changes slowly over time — direction rotates, intensity ebbs and flows. Near coastlines, wind aligns with wave direction. In sheltered areas (dense forest), wind is dampened.

### Data Model
```js
// Global wind state (updated once per frame in DayNightCycle or new WeatherSystem)
wind = {
  direction: 0.3,        // radians, 0 = north, rotates slowly
  intensity: 0.6,        // 0-1, calm to stormy
  gustPhase: 0.0,        // oscillates for gust pulses
  time: performance.now() / 1000
}
```

### Per-Object Wind Response
Each object type defines its wind behavior:
```js
{
  windSway: true,          // does this object respond to wind?
  swayAmplitude: 0.15,     // max rotation in radians at full wind
  swayFrequency: 1.5,      // oscillation speed (Hz)
  swayDamping: 1.0,        // 1.0 = full wind, 0.3 = sheltered
  anchorPoint: 'bottom',   // rotation pivot: 'bottom' (planted), 'center' (floating)
}
```

### Wind Direction Flow
```
WeatherSystem.update(dt)
  → wind.direction += drift * dt    (slow rotation, ~0.01 rad/s)
  → wind.intensity = noise(time)    (perlin-like fluctuation)
  → wind.gustPhase = sin(time * 2)  (rhythmic gusts)

Main thread draw loop:
  For each visible animated object:
    swayAngle = sin(time * freq + tilePhase) * amplitude * wind.intensity
    Apply rotation around anchorPoint
    Offset position slightly in wind direction
```

### Biome Damping
```js
WIND_DAMPING = {
  dense_forest: 0.25,    // very sheltered
  forest: 0.50,          // moderate shelter
  tropical_forest: 0.35, // dense canopy blocks wind
  swamp: 0.40,           // low but present
  grassland: 1.0,        // fully exposed
  steppe: 1.1,           // amplified (flat, no shelter)
  desert: 0.9,           // sand dampens slightly
  beach: 1.0,            // coastal wind
  hills: 1.1,            // exposed elevation
  mountains: 1.3,        // strong at altitude
  arctic: 1.2,           // polar winds
  tundra: 1.1,           // exposed
  volcanic: 0.8,         // heat updrafts interfere
  mystic: 0.6,           // magical calm
}
```

### PixelLab Animation Generation
For each vegetation object type, generate wind sway animation:
```
animate_object(
  object_id: "grass_blade_v000",
  animation_description: "swaying gently in wind from the east",
  mode: "v3",
  frame_count: 8,
  display_name: "wind_sway"
)
```

Generate 2-4 variants per object type (not all 64 — too expensive). The main thread selects which variant to use based on tile hash. Procedural sway (rotation + offset) supplements the frame animation for full organic feel.

### Wind + Wave Integration
Near water (shoreDist < 15), wind direction blends with wave direction:
```js
effectiveWindDir = windDir * (1 - shoreInfluence) + shoreAngle * shoreInfluence
```
This ensures grass near the beach sways toward the shore when waves are coming in.

---

## System 2: Player Interaction

### Concept
When the player walks through vegetation, objects visibly react — grass bends, flowers flatten, ferns part. The disturbance propagates outward slightly (adjacent tiles react less) and recovers over ~1 second.

### Data Model
```js
// Per-tile disturbance state (maintained on main thread)
tileDisturbance = Map<"wx,wy", {
  intensity: 0.0-1.0,     // 1.0 = just stepped on, decays to 0
  direction: radians,      // direction player was moving
  timestamp: number        // when disturbance started
}>
```

### Disturbance Propagation
```
Player moves to tile (wx, wy):
  Set disturbance(wx, wy) = { intensity: 1.0, direction: playerDir, timestamp: now }
  Set disturbance(adjacent tiles) = { intensity: 0.4, direction: playerDir, timestamp: now }

Each frame:
  For each disturbance:
    age = now - timestamp
    intensity = max(0, 1.0 - age / RECOVERY_TIME)  // RECOVERY_TIME = 1.5s
    if intensity <= 0: delete from map
```

### Render Effect
```js
if (tileDisturbance.has(tileKey)) {
  const d = tileDisturbance.get(tileKey);
  // Flatten toward ground in player's movement direction
  const flattenAngle = d.direction;
  const flattenAmount = d.intensity * 0.6; // max 0.6 radians tilt
  ctx.rotate(flattenAngle);
  ctx.scale(1.0, 1.0 - flattenAmount * 0.3); // squish vertically
}
```

### PixelLab Animation Generation
For each vegetation object, generate a "disturbed" state:
```
create_object_state(
  object_id: "grass_blade_v000",
  edit_description: "bent over and flattened as if stepped on"
)
```

The main thread interpolates between normal and disturbed sprites based on disturbance intensity.

### What Reacts vs What Doesn't
| Field | Reacts to player? | How? |
|---|---|---|
| 0 Substrate | No | Soil doesn't move |
| 1 Ground Cover | Slight | Leaves scatter, moss compresses |
| 2 Small Flora | Yes | Grass bends, ferns part |
| 3 Small Scatter | Slight | Pebbles shift, twigs crack |
| 4 Medium Flora | Yes | Flowers bend, mushrooms wobble |
| 5 Medium Objects | No | Rocks, stumps don't move |
| 6 Large Objects | No | Trees don't react to walking |
| 7 Canopy | No | Overhead, not at player level |

---

## System 3: Life Cycle

### Concept
Living objects progress through growth stages based on tile climate data. A grass blade starts as a seedling, grows to mature, then withers. The stage is determined by the tile's fertility, moisture, season, and age.

### Life Stages
```
SEEDLING → SPROUT → GROWING → MATURE → WITHERING → DEAD → (decomposed/removed)
```

Each stage is a separate sprite (generated via PixelLab `create_object_state`).

### Stage Determination
```js
function lifeStage(tile, objectType) {
  const fertility = tile.layers[6].fertility;
  const moisture = tile.climate.moisture;
  const season = lighting.season(); // 0-3 (spring, summer, autumn, winter)
  const tileAge = hash(tile.wx, tile.wy); // deterministic "age" per tile

  // Combine into a 0-1 "vitality" score
  const vitality = fertility * 0.4 + moisture * 0.3 + seasonBonus(season) * 0.3;

  if (vitality > 0.8) return 'mature';
  if (vitality > 0.6) return 'growing';
  if (vitality > 0.4) return 'sprout';
  if (vitality > 0.2) return 'seedling';
  if (vitality > 0.1) return 'withering';
  return 'dead';
}
```

### Season Interaction
```js
function seasonBonus(season) {
  // spring=0, summer=1, autumn=2, winter=3
  return [0.7, 1.0, 0.4, 0.1][season];
}
```
In winter, most vegetation shifts toward withering/dead. In summer, everything flourishes.

### PixelLab Generation
For each base object, generate 5 state variants:
```
create_object_state(object_id, edit_description: "tiny seedling just sprouting from soil")
create_object_state(object_id, edit_description: "small young sprout with first leaves")
create_object_state(object_id, edit_description: "half-grown, developing but not yet full size")
// base object = mature (already exists)
create_object_state(object_id, edit_description: "wilting and browning, losing vitality")
create_object_state(object_id, edit_description: "dead and dried out, brown/gray coloring")
```

### Rendering
```js
const stage = lifeStage(tile, objectType);
const spriteSet = objectType.stages[stage]; // different sprite pool per stage
const variant = hash(wx, wy) % spriteSet.length;
drawSprite(spriteSet[variant]);
```

### Which Objects Have Life Cycles
| Type | Has lifecycle? | Notes |
|---|---|---|
| Grass/flora | Yes | Full 6-stage cycle |
| Mushrooms/fungi | Partial | Sprout → mature → withering (no seedling) |
| Flowers | Yes | Bud → bloom → wilting → dead |
| Trees | Yes but slow | Sapling → young → mature → ancient → dead |
| Moss/lichen | Partial | Thin → thick → dormant |
| Rocks/stones | No | Geological, not alive |
| Debris/scatter | No | Already dead/inorganic |

---

## System 4: Elemental State Changes

### Concept
When biome elements interact with objects, their visual state changes. Forest fire scorches grass. Ice storms freeze flowers. Mystic energy enchants trees. These are persistent states that override the normal appearance until cleared.

### State Machine
```
NORMAL → BURNING → SCORCHED → ASH        (fire)
NORMAL → FROSTED → FROZEN → SHATTERED    (ice)
NORMAL → WATERLOGGED → DRIPPING          (water)
NORMAL → ENCHANTED → GLOWING → TRANSFORMED (mystic)
NORMAL → ROTTING → DECAYED               (rot/poison)
NORMAL → DUSTY → SAND_BURIED            (sand/wind)
```

### Elemental Exposure
Each tile has elemental exposure computed from biome elements and nearby interactions:
```js
// From biome-elements.js
BIOME_ELEMENTS = {
  forest: ['wood', 'life', 'shade'],
  volcanic: ['fire', 'ash', 'heat'],
  arctic: ['ice', 'cold', 'wind'],
  mystic: ['mystic', 'aether', 'dream'],
  swamp: ['water', 'rot', 'poison'],
}
```

When an object is in a biome with fire elements, or when a fire event occurs nearby, the object transitions to the burning state.

### Transition Rules
```js
ELEMENTAL_TRANSITIONS = {
  grass: {
    fire:   { stages: ['burning', 'scorched', 'ash'], durations: [2, 5, Infinity] },
    ice:    { stages: ['frosted', 'frozen'], durations: [3, Infinity] },
    water:  { stages: ['lush'], durations: [Infinity] },  // water makes grass lusher
    mystic: { stages: ['enchanted', 'glowing'], durations: [5, Infinity] },
  },
  wood: {
    fire:   { stages: ['burning', 'charred'], durations: [4, Infinity] },
    ice:    { stages: ['frozen', 'ice_cracked'], durations: [5, Infinity] },
    water:  { stages: ['waterlogged', 'mossy'], durations: [8, Infinity] },
  },
  // ... per material type
}
```

### PixelLab Generation
For each base object × relevant element, generate state sprites:
```
create_object_state(object_id, edit_description: "on fire, flames consuming the grass")
create_object_state(object_id, edit_description: "scorched and blackened by fire")
create_object_state(object_id, edit_description: "covered in frost and ice crystals")
create_object_state(object_id, edit_description: "glowing with magical purple energy")
```

### Material Reaction Table (from biome-elements.js)
Already defined in the codebase:
```
wood:  fire→burning, water→waterlogged, ice→frozen, mystic→enchanted
leaf:  fire→scorched, water→dripping, ice→frozen, mystic→glowing
grass: fire→burnt, water→lush, ice→frozen, mystic→fae_bloom
stone: fire→heat_cracked, water→slick, ice→iced, mystic→rune_etched
sand:  fire→glass_scorched, water→wet, ice→crusted, mystic→star_sand
```

### Rendering Priority
When an object has both a life cycle stage AND an elemental state:
```
elemental state > life cycle stage
```
A frozen mature grass blade shows the "frozen" sprite, not the "mature" sprite. But the underlying life stage is preserved — when the ice thaws, it returns to "mature."

---

## Performance Architecture

### Static vs Animated Objects
```
STATIC (baked into chunk bitmap in worker):
  - Field 0: Substrate (per-pixel blending)
  - Field 1: Ground cover luminance modulation
  - Field 1: Ground cover sprites (non-animated)
  - Field 3: Small scatter/debris (no animation needed)

ANIMATED (drawn per-frame on main thread):
  - Field 1: Water sprites (seaweed, lily pads)
  - Field 2: Small flora with wind sway
  - Field 4: Medium flora with wind + interaction
  - Field 6: Large objects (trees) with wind
  - Field 7: Canopy with wind
  - Water wave overlay
  - Shoreline foam
```

### Animation Frame Budget
At 60fps, the main thread has ~16ms per frame. Current draw time is ~0.4ms for static chunks + ~2ms for wave overlay = ~2.4ms total.

Budget for animated objects:
- Wave overlay: 2ms (current)
- Seaweed sprites: 0.5ms (~50 visible sprites)
- Field 2 wind sway: 1ms (~200 visible grass sprites)
- Field 4 flowers: 0.5ms (~30 visible flowers)
- Field 6 trees: 1ms (~20 visible trees, larger sprites)
- Player interaction: 0.2ms (only nearby tiles)
- **Total: ~5.7ms** — well within 16ms budget

### Preloading Animation Frames
```
Priority 1 (startup): Soil + ground cover sprites
Priority 2 (after first render): Wind sway frames for visible biome
Priority 3 (background): Life cycle + elemental state variants
```

### Memory Budget
Per animated object type:
- Base sprite: 64 variants × 32×32 × 4 bytes = 256KB
- Wind animation: 4 variants × 9 frames × 32×32 × 4 = 144KB
- Life stages: 5 stages × 8 variants × 32×32 × 4 = 160KB
- Elemental states: 4 elements × 2 stages × 8 variants = 256KB
- **Per type total: ~816KB**

For 48 object types across all fields: ~39MB
For visible objects only (LOD): ~5-10MB

---

## Implementation Phases

### Phase 1: Wind System (immediate)
1. Add `WindState` to `DayNightCycle` or new `WeatherSystem`
2. Expose `wind.direction`, `wind.intensity` to main thread draw loop
3. Apply procedural sway to all sprite-mode objects in Fields 1-2
4. Generate PixelLab wind sway animations for Field 2 grass objects

### Phase 2: Player Interaction (after wind works)
1. Add `tileDisturbance` map to main thread
2. Track player movement, set disturbance on walked tiles
3. Apply flatten/bend to Field 2-4 objects near player
4. Generate PixelLab "disturbed" state sprites

### Phase 3: Life Cycle (after interaction works)
1. Add season system to `DayNightCycle`
2. Compute `lifeStage()` per tile from climate data
3. Generate PixelLab life stage variants for key objects
4. Select sprite variant based on stage

### Phase 4: Elemental States (after life cycle works)
1. Add elemental exposure computation to tile data
2. Implement state machine transitions
3. Generate PixelLab elemental state sprites
4. Override rendering with elemental sprite when active

---

## PixelLab Generation Strategy

### Scale
For each of the ~200 vegetation object types across Fields 2-7:
- Wind sway: 4 variants × 9 frames = 36 sprites per type = 7,200 total
- Player disturbed: 4 variants = 800 total
- Life stages: 5 stages × 4 variants = 4,000 total
- Elemental states: ~6 states × 4 variants = 4,800 total

**Total animation sprites: ~16,800**

### Cost Management
- Use `animate_object` v3 mode (cheaper than pro)
- Generate only 4 representative variants per animation (not all 64)
- Prioritize visible/common objects first
- Background-generate rare biome objects later

### Batch Strategy
```
Round 1: Wind sway for Field 2 grass objects (16 biomes × 3 objects × 4 variants)
Round 2: Wind sway for Field 4 flowers (16 × 3 × 4)
Round 3: Player interaction states for Fields 2-4
Round 4: Life cycle stages for Fields 2, 4, 6
Round 5: Elemental states (fire, ice, mystic) for all living objects
```
