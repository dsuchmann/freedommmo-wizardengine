# Landscape Layers From Specs

Based on the living specs, the landscape is assembled as a layered simulation projection rather than one flat tile.

1. **Regional/Overmap Layer** — province biome identity, ecotones, large elevation fields, climate, water basins.
2. **Bedrock/Foundation Layer** — geological base, mountain stone, cliff strata, canyon/overhang material, ore seams.
3. **Quantized Topology Layer** — plateau levels, cliffs, steps, ledges, ramps, bridges, cave mouths, overhangs.
4. **Smooth Topology Cue Layer** — hill/valley/ridge gradients, movement cost, camera zoom/offset, slope shading.
5. **Base Terrain Tile Layer** — biome ground tiles: grassland, forest floor, desert sand, mud/swamp, snow, volcanic, beach, water.
6. **Wang/Autotile Transition Layer** — seamless edges/corners between terrain materials, water/shore, grass/dirt, cliff/ground, sand/rock.
7. **Soil/Mud/Dirt Detail Layer** — damp dirt, loam, clay, mud, cracked dirt, footprints, paths, tilled soil.
8. **Stone/Debris Micro Layer** — pebbles, gravel, scree, shells, roots, branches, leaf litter, bones, ash, snow clumps.
9. **Ground Cover Layer** — grass tufts, moss, reeds, lichen, ferns, desert scrub, magical grass, fungal mats.
10. **Flowers/Herbs/Fungi Layer** — wildflowers, gardens, mushrooms, herbs, poison/mystic plants, seasonal blooms.
11. **Shrub/Bush/Hedge Layer** — bushes, brambles, hedges, cactus scrub, berries, thorn growth, swamp brush.
12. **Tree Trunk/Object Layer** — trunks, logs, stumps, rocks, crystals, resource nodes, low interactable objects; y/elevation sorted with player.
13. **Canopy/Overhead Layer** — tree crowns, overhanging branches, dense forest canopy, hanging moss, overhang shadows.
14. **Small Life Layer** — insects, fireflies, butterflies, birds, small critter ambient sprites.
15. **Water/Wetland Layer** — rivers, ponds, ocean, foam, ripples, shallow/deep water, waterfalls, wet mud.
16. **Settlement/Constructed Layer** — paths, fences, walls, floors, roofs, wells, lamps, gardens, market objects.
17. **Interaction/State Overlay Layer** — cut, harvested, burnt, frozen, wet, enchanted, trampled, disturbed, mined, broken.
18. **Contact Reaction Layer** — grass bend, flower shake, bush rustle, water splash, mud/sand/snow footstep particles.
19. **Lighting/Atmosphere Layer** — day/night tint, shadows, fog, depth haze, weather, magic glow.
20. **Actor Layer** — player/NPCs/entities sorted against world objects and occluded by canopy/overhangs.

The Godot/Pixellab assets should populate layers 5–16 first, then generated/Sorceress assets fill missing variants and states.
