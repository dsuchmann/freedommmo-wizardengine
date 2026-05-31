# Runtime Compositor Spec — Cel-Animation Tile Rendering

**Date:** 2026-05-26
**Status:** Draft
**Scope:** How Godot stacks, animates, and state-transitions the layered tile system at runtime.

## Architecture Overview

Each visible tile on screen is a stack of up to 5 transparent layers composited via z-ordered rendering. A TileStateManager tracks the current state of every tile and tells the compositor which frame set to use.

```
Player walks through grass:
  L5: [atmospheric - pollen drifting]        z=4
  L4: [scatter - pebbles]                    z=3
  L3: [vegetation - grass DISTURBED frame]   z=2  ← state-driven swap
  L2: [detail - root pattern]                z=1
  L1: [base - dirt ground]                   z=0
```

## Tile State Machine

Each tile position (world x, y) has a state. States are driven by game events.

### State Categories

States map to biome visual languages — the biomes themselves are the vocabulary for states:

| State | Visual Source | Trigger Examples |
|-------|-------------|-----------------|
| **pristine** | Native biome | Default |
| **disturbed** | Native biome (variant frames) | Player/NPC walks through |
| **trampled** | Native biome (worn variant) | Heavy foot traffic, paths form |
| **dug** | Exposed earth/subterrain | Dig action, mining |
| **burning** | Volcanic visual language | Fire spell, torch, wildfire spread |
| **burned/scorched** | Volcanic + desert (ash, char) | After fire extinguishes |
| **frozen** | Tundra/arctic visual language | Ice spell, winter event, altitude |
| **wet** | Ocean/swamp visual language | Rain, flooding, water spell |
| **cursed/corrupted** | Mystic visual language (dark variant) | Dark magic, undead presence |
| **enchanted** | Mystic visual language (light variant) | Blessing, magical ward |
| **decaying/undead** | Swamp visual language (rot, ooze) | Necromancy, blight |
| **growing/fertile** | Forest/grassland lush variant | Growth spell, spring, fertilize |
| **dry/drought** | Desert visual language | Heat, no rain, curse |

**Key insight:** Biome L2-L5 assets double as state overlays for other biomes. A "frozen" grassland tile uses tundra's L2 (frost patterns) overlaid on grassland's L1 (base ground). A "burning" forest tile uses volcanic's L3 (embers/cracks) overlaid on forest's L1.

This means generating biome assets also generates state assets. Efficiency multiplier.

### State Transitions

```gdscript
# State machine per tile
enum TileState {
    PRISTINE, DISTURBED, TRAMPLED, DUG,
    BURNING, BURNED, FROZEN, WET,
    CURSED, ENCHANTED, DECAYING, GROWING, DRY
}

# Each state has: entry_frames, loop_frames, exit_frames, duration (-1 = persistent)
# Transitions: PRISTINE → DISTURBED (3s) → RECOVERING → PRISTINE
#              PRISTINE → BURNING (5s) → BURNED (persistent)
#              PRISTINE → FROZEN (persistent until thaw event)
```

### State Layer Mapping

When a tile enters a non-pristine state, the compositor replaces specific sub-layers:

| State | L1 (Base) | L2 (Detail) | L3 (Vegetation) | L4 (Scatter) | L5 (Atmospheric) |
|-------|-----------|-------------|-----------------|--------------|-------------------|
| pristine | Native | Native | Native | Native | Native |
| disturbed | Native | Native | Native (sway frame) | Native (shifted) | Native |
| burning | Native (darken) | Volcanic L2 | Volcanic L3 (flames) | Remove | Volcanic L5 (smoke) |
| frozen | Native | Tundra L2 (frost) | Tundra L3 (ice coat) | Arctic L4 (ice shards) | Arctic L5 (snow) |
| cursed | Native (desaturate) | Mystic L2 (dark) | Mystic L3 (dark crystal) | Mystic L4 | Mystic L5 (dark particles) |
| wet | Native | Ocean L2 (puddles) | Native (droop frame) | Native | Swamp L5 (mist) |
| decaying | Native (darken+green) | Swamp L2 (rot) | Swamp L3 (dead vines) | Swamp L4 (bones) | Swamp L5 (miasma) |
| growing | Native | Forest L2 (moss) | Forest L3 (sprouts) | Native | Grassland L5 (pollen) |
| dry | Desert L1 (cracked) | Desert L2 (cracks) | Remove | Desert L4 (dust) | Desert L5 (heat haze) |

## Compositor Node Architecture

```
ChunkRenderer (Node2D, per chunk)
  ├─ L1_Base (Sprite2D, z=0)
  ├─ L2_Detail (Sprite2D, z=1)
  ├─ L3_Vegetation (Sprite2D, z=2)
  ├─ L4_Scatter (Sprite2D, z=3)
  └─ L5_Atmospheric (Sprite2D, z=4)
```

For Phase 1, each layer is a single Image composited from 64x64 Wang tiles (same as current chunk image approach). The chunk streamer builds 5 images per chunk instead of 1.

For state changes, only the affected layer images need to be rebuilt for the affected tiles — not the entire chunk.

## Animation System

### Frame-Swap Animation (Event-Driven)

Each layer can have multiple frames. Frames are swapped based on events, not timers:

```gdscript
# Player proximity triggers vegetation sway
func _on_player_moved(player_pos: Vector2):
    var tile_pos = world_to_tile(player_pos)
    for nearby_tile in get_tiles_in_radius(tile_pos, 2):
        var dist = tile_pos.distance_to(nearby_tile)
        var sway_frame = compute_sway_frame(dist, player_velocity)
        set_tile_state(nearby_tile, TileState.DISTURBED, {"frame": sway_frame})
```

### Ambient Animation (Timer-Based, Low Priority)

Some layers have slow ambient cycles — water ripples, lava glow pulse, mystic shimmer. These use timers but at low frequency (2-4 FPS) to keep the pixel art feel:

```gdscript
# Ambient water ripple — cycles through 4 frames every 2 seconds
func _tick_ambient():
    if biome in [OCEAN, LAKE, RIVER, SWAMP]:
        L1_frame = (L1_frame + 1) % 4  # Slow cycle
```

## Performance Budget

- **Max 5 Sprite2D per chunk** (one per layer)
- **Image rebuilds**: Only when tile states change, not every frame
- **Ambient animation**: Batched — all water tiles in a chunk swap frame simultaneously
- **State tracking**: PackedByteArray per chunk (64x64 = 4096 bytes, one byte per tile)
- **Memory**: 5 Images per chunk × 49 loaded chunks = 245 Images. At 2048x2048 RGBA8 = ~4MB each = ~1GB. May need to skip L5 atmospheric for distant chunks.

## Integration with Existing Systems

### ChunkStreamer Changes
- After compile_chunk + modifier override, build 5 layer images instead of 1
- L1 uses the existing Wang tile rendering logic (same code, same tilesets)
- L2-L5 are new overlays composited on top
- Pass all 5 images to a new `display_chunk_layers()` method

### TileStateManager (New System)
- Registered in WorldManager as a system
- Tracks state per tile via Dictionary[Vector2i, TileState]
- Receives events: player_moved, dig_action, fire_event, weather_change
- Emits tile_state_changed(tile_pos, old_state, new_state)
- Compositor listens and rebuilds affected layer images

### Day/Night Integration
- L5 atmospheric layer tint responds to day/night cycle
- Existing shader handles L1 normal map + directional shading
- L2-L5 get simpler tinting via CanvasModulate (same as current non-terrain elements)
