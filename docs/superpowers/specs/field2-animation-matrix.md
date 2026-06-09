# Field 2 Animation & State Matrix

**Date:** 2026-06-07
**Status:** In progress — scope defined, execution beginning

## Scale

- 44 object types across 16 biomes
- 64 variants per type = 2,816 individual base objects
- Each object needs animations + states + state animations

## Per-Object Requirements

### Base Animations (on every variant)
| Animation | Description | Frames | Priority |
|-----------|-------------|--------|----------|
| wind_sway | Swaying gently in wind | 8 | P0 — needed for launch |
| player_walk | Bends aside as player walks through, springs back | 8 | P0 |
| player_run | More aggressive bend from running, faster snap | 8 | P1 |
| destroy | Object is cut/pulled/crushed, disappears | 8 | P1 |

### State Changes (each is a new static sprite)
| State | Description | Priority |
|-------|-------------|----------|
| seedling | Tiny sprout just emerging | P0 |
| wilting | Browning, losing vitality | P0 |
| dead | Dried out husk, brown/grey | P0 |
| burning | Actively on fire, flames | P0 |
| scorched | After fire, blackened remains | P1 |
| frozen | Covered in ice crystals | P0 |
| enchanted | Glowing with magical energy | P1 |

### State Animations (animations ON each state)
| State | Needs wind_sway? | Needs player_walk? | Needs unique anim? |
|-------|-----------------|--------------------|--------------------|
| seedling | Yes (tiny sway) | Yes (crushable) | No |
| wilting | Yes (weak sway) | Yes | No |
| dead | No (stiff) | Yes (crumbles) | No |
| burning | No | No | Yes: fire_flicker |
| scorched | No | No | Yes: smoke_wisps |
| frozen | No | No | Yes: ice_shimmer |
| enchanted | Yes (magical sway) | Yes | Yes: glow_pulse |

### State Chains
```
LIFECYCLE:    seedling → normal → wilting → dead → (timer) → seedling
FIRE:         normal → burning (anim) → scorched → dead → seedling  
ICE:          normal → frozen → (thaw timer) → normal
MAGIC:        normal → enchanted → (fade timer) → normal
DESTRUCTION:  normal → destroy (anim) → dead → (timer) → seedling
```

## Generation Plan

### Phase 1: Select all 64 variants for all 44 types (NEEDED)
Currently only 1 variant per type is a completed object. Need to call select_object_frames with all 64 indices for each of the 44 review objects.

Result: 2,816 completed objects

### Phase 2: Wind sway on representative variants (4 per type)
44 types × 4 variants = 176 animate_object calls
Each produces 9 frames = 1,584 animation frames

### Phase 3: Player walk-through on representative variants (4 per type)  
44 types × 4 variants = 176 animate_object calls
Description: "bending aside as if walked through, then springing back"
1,584 animation frames

### Phase 4: State sprites for all types (1 representative per type per state)
44 types × 7 states = 308 create_object_state calls
308 state sprites

### Phase 5: Fire animation on burning states
44 burning state objects × animate_object("flames flickering, fire burning")
396 animation frames

### Phase 6: Ice shimmer on frozen states
44 frozen state objects × animate_object("ice crystals shimmering and glinting")
396 animation frames

### Phase 7: Enchanted glow on enchanted states
44 enchanted state objects × animate_object("magical energy pulsing and glowing")  
396 animation frames

### Phase 8: Destruction animation on base objects (4 per type)
44 types × 4 variants = 176 animate_object calls
Description: "being cut down and falling apart, disappearing"
1,584 animation frames

## Total Job Count
| Phase | Jobs | Frames/Sprites |
|-------|------|----------------|
| 1. Select variants | 44 select calls | 2,816 objects |
| 2. Wind sway (4/type) | 176 | 1,584 frames |
| 3. Player walk (4/type) | 176 | 1,584 frames |
| 4. State sprites | 308 | 308 sprites |
| 5. Fire animation | 44 | 396 frames |
| 6. Ice shimmer | 44 | 396 frames |
| 7. Enchanted glow | 44 | 396 frames |
| 8. Destroy animation | 176 | 1,584 frames |
| **TOTAL** | **1,012 jobs** | **8,668 files** |

At 20 concurrent, ~8 min per batch = ~51 batches = ~7 hours

## Progress Tracker

### Phase 1: Select all variants
- [ ] 44 types need full 64-frame selection

### Phase 2: Wind sway (done for 1 variant per type, need 3 more)
- [x] 41/44 types have 1 variant animated
- [ ] Need 3 more variants per type (132 jobs remaining)

### Phase 3: Player walk-through  
- [ ] 0/44 types started

### Phase 4: State sprites (done for 1 variant per type)
- [x] 41/44 types have states: disturbed, seedling, wilting, dead, frozen, burning, enchanted
- [ ] States only exist for 1 variant — may need more

### Phase 5-7: State animations
- [ ] 0/44 burning animated
- [ ] 0/44 frozen animated  
- [ ] 0/44 enchanted animated

### Phase 8: Destroy animation
- [ ] 0/44 types started

## What's Actually Complete Right Now
- 44 base object types generated across 16 biomes
- ~3,029 base sprite PNGs on disk
- 41 wind sway animations (1 variant each, 9 frames each = 369 frames) — QUEUED, partially downloaded
- 41 × 7 state changes = 287 state objects created — NOT downloaded
- 0 state animations
- 0 player interaction animations
- 0 destroy animations
