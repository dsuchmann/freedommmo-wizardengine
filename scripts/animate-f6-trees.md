# F6 Tree Animation Pipeline

## Status
- 9 wind_sway animations queued on PixelLab (first batch)
- Object IDs for first batch:
  - b4654ab2 (pine)
  - 659e8854 (pine) 
  - 03070f6a
  - 122adc70
  - a604b425
  - bf0b02ea
  - 052f1a59
  - 3546c486
  - c841eb18

## Challenge
- 30,212 completed objects on PixelLab, no tags on F6 trees
- 917 tree PNGs on disk across 23 types / 8 biomes
- No object ID → file mapping stored
- Need to animate all 917 variants

## Approach
1. Queue animations on objects found through list_objects (192x192 trees)
2. Download animation frames when complete
3. Match to on-disk files by comparing base PNG
4. Sort frames into anim/wind_sway/ directories per the F2/F4 convention

## To run manually
Continue queuing from PixelLab MCP: 
- list_objects(offset=N, status_filter='completed') to find more 192x192 trees
- animate_object(object_id, animation_description='canopy swaying gently in wind...', frame_count=8)
- Keep under 10 concurrent jobs
