# Codebase Map
_Generated: 2026-05-31 17:25:57_

## Stats
- **Files:** 500 | **Directories:** 115 | **Total Lines:** 55,069
- **Detected:** Three.js, React
- **File types:** .json:426, .md:48, .cmake:11, .txt:8, .lib:2, .gdextension:1, .uid:1, .dll:1, .exp:1, .example:1

## File Tree
```
├── reference/
│   └── godot/
│       ├── bin/
│       │   ├── freedommmo.gdextension (13L)
│       │   ├── freedommmo.gdextension.uid (2L)
│       │   ├── libfreedommmo.windows.template_debug.x86_64.dll
│       │   ├── libfreedommmo.windows.template_debug.x86_64.exp (2L)
│       │   └── libfreedommmo.windows.template_debug.x86_64.lib (10L)
│       ├── config/
│       │   └── server_config.json (10L)
│       ├── data/
│       │   ├── biomes/
│       │   │   └── table.json (20L)
│       │   ├── building_templates/
│       │   │   ├── forge.json (23L)
│       │   │   ├── house.json (21L)
│       │   │   ├── market_stall.json (19L)
│       │   │   ├── tavern.json (24L)
│       │   │   ├── watchtower.json (19L)
│       │   │   └── well.json (14L)
│       │   ├── grains/
│       │   │   └── physical_grains.json (42L)
│       │   ├── terrain_objects/
│       │   │   ├── affinities/
│       │   │   │   ├── arctic.json (114L)
│       │   │   │   ├── beach.json (151L)
│       │   │   │   ├── dense_forest.json (265L)
│       │   │   │   ├── desert.json (167L)
│       │   │   │   ├── forest.json (274L)
│       │   │   │   ├── grassland.json (215L)
│       │   │   │   ├── lake.json (116L)
│       │   │   │   ├── mountains.json (244L)
│       │   │   │   ├── mystic.json (137L)
│       │   │   │   ├── ocean.json (125L)
│       │   │   │   ├── river.json (92L)
│       │   │   │   ├── savanna.json (160L)
│       │   │   │   ├── steppe.json (121L)
│       │   │   │   ├── swamp.json (227L)
│       │   │   │   ├── taiga.json (191L)
│       │   │   │   ├── tropical_forest.json (224L)
│       │   │   │   ├── tundra.json (147L)
│       │   │   │   └── volcanic.json (136L)
│       │   │   ├── biome_layers/
│       │   │   │   ├── arctic.json (225L)
│       │   │   │   ├── beach.json (113L)
│       │   │   │   ├── dense_forest.json (459L)
│       │   │   │   ├── desert.json (362L)
│       │   │   │   ├── forest.json (479L)
│       │   │   │   ├── grassland.json (470L)
│       │   │   │   ├── lake.json (76L)
│       │   │   │   ├── mountains.json (382L)
│       │   │   │   ├── mystic.json (150L)
│       │   │   │   ├── ocean.json (54L)
│       │   │   │   ├── river.json (76L)
│       │   │   │   ├── savanna.json (118L)
│       │   │   │   ├── steppe.json (113L)
│       │   │   │   ├── swamp.json (159L)
│       │   │   │   ├── taiga.json (464L)
│       │   │   │   ├── tropical_forest.json (169L)
│       │   │   │   ├── tundra.json (352L)
│       │   │   │   └── volcanic.json (245L)
│       │   │   ├── generation/
│       │   │   │   ├── prompts/
│       │   │   │   │   ├── animation.txt (2L)
│       │   │   │   │   ├── ground_cover.txt (2L)
│       │   │   │   │   ├── mineral_rock.txt (2L)
│       │   │   │   │   ├── structure_natural.txt (2L)
│       │   │   │   │   ├── vegetation_grass.txt (2L)
│       │   │   │   │   ├── vegetation_tree.txt (2L)
│       │   │   │   │   └── water_feature.txt (2L)
│       │   │   │   ├── audit_tracker.md (100L)
│       │   │   │   ├── generation_queue.json (82L)
│       │   │   │   ├── log.txt
│       │   │   │   ├── pixellab_manifest_v2.json
│       │   │   │   ├── pixellab_manifest.json
│       │   │   │   └── queue.json
│       │   │   ├── interactions/
│       │   │   │   ├── ambient/
│       │   │   │   │   ├── day_shift.json (20L)
│       │   │   │   │   ├── idle_variant.json (20L)
│       │   │   │   │   ├── idle.json (20L)
│       │   │   │   │   ├── night_shift.json (20L)
│       │   │   │   │   └── seasonal_change.json (24L)
│       │   │   │   ├── biome_blending/
│       │   │   │   │   ├── edge_fade.json (20L)
│       │   │   │   │   ├── overgrowth.json (24L)
│       │   │   │   │   └── submersion.json (26L)
│       │   │   │   ├── environmental/
│       │   │   │   │   ├── erosion.json (33L)
│       │   │   │   │   ├── fire_spread.json (35L)
│       │   │   │   │   ├── flood.json (28L)
│       │   │   │   │   ├── lightning_strike.json (34L)
│       │   │   │   │   ├── rain.json (31L)
│       │   │   │   │   └── wind.json (27L)
│       │   │   │   ├── player_action/
│       │   │   │   │   ├── burn_ignite.json (34L)
│       │   │   │   │   ├── chop.json (35L)
│       │   │   │   │   ├── climb.json (29L)
│       │   │   │   │   ├── dig.json (35L)
│       │   │   │   │   ├── freeze_cast.json (33L)
│       │   │   │   │   ├── mine.json (34L)
│       │   │   │   │   ├── pick.json (31L)
│       │   │   │   │   ├── plant.json (30L)
│       │   │   │   │   └── water_plant.json (30L)
│       │   │   │   ├── state_reactive/
│       │   │   │   │   ├── bloom.json (25L)
│       │   │   │   │   ├── collapse.json (33L)
│       │   │   │   │   ├── crack.json (25L)
│       │   │   │   │   ├── decompose.json (24L)
│       │   │   │   │   ├── fruit.json (23L)
│       │   │   │   │   ├── fungal_growth.json (24L)
│       │   │   │   │   ├── insect_swarm.json (32L)
│       │   │   │   │   ├── regrow.json (25L)
│       │   │   │   │   └── wilt.json (24L)
│       │   │   │   └── traversal/
│       │   │   │       ├── fly_over.json (21L)
│       │   │   │       ├── land_on.json (28L)
│       │   │   │       ├── push_aside.json (28L)
│       │   │   │       ├── run_through.json (28L)
│       │   │   │       ├── swim_past.json (28L)
│       │   │   │       └── walk_through.json (28L)
│       │   │   ├── objects/
│       │   │   │   ├── ground_cover/
│       │   │   │   │   ├── ash_layer/
│       │   │   │   │   │   ├── ash_pile.json (70L)
│       │   │   │   │   │   ├── fresh_ash.json (70L)
│       │   │   │   │   │   ├── old_ash.json (70L)
│       │   │   │   │   │   └── sulfur_deposit.json (70L)
│       │   │   │   │   ├── gravel/
│       │   │   │   │   │   ├── dune_ripple.json (70L)
│       │   │   │   │   │   ├── frozen_gravel.json (30L)
│       │   │   │   │   │   ├── gravel_patch.json (70L)
│       │   │   │   │   │   ├── mountain_gravel.json (30L)
│       │   │   │   │   │   ├── stone_dust.json (70L)
│       │   │   │   │   │   └── wind_sand_drift.json (70L)
│       │   │   │   │   ├── ice_sheet/
│       │   │   │   │   │   ├── frozen_ground.json (30L)
│       │   │   │   │   │   ├── ice_patch.json (70L)
│       │   │   │   │   │   ├── permafrost_crack.json (70L)
│       │   │   │   │   │   └── permafrost.json (30L)
│       │   │   │   │   ├── leaf_litter/
│       │   │   │   │   │   ├── acorn.json (30L)
│       │   │   │   │   │   ├── autumn_leaves.json (70L)
│       │   │   │   │   │   ├── bark_chip.json (30L)
│       │   │   │   │   │   ├── bark_debris.json (30L)
│       │   │   │   │   │   ├── dead_twig.json (30L)
│       │   │   │   │   │   ├── decomposing_leaves.json (30L)
│       │   │   │   │   │   ├── dried_plant.json (30L)
│       │   │   │   │   │   ├── dried_seed.json (30L)
│       │   │   │   │   │   ├── dry_leaf.json (30L)
│       │   │   │   │   │   ├── dry_leaves.json (70L)
│       │   │   │   │   │   ├── fallen_fruit.json (30L)
│       │   │   │   │   │   ├── forest_floor.json (37L)
│       │   │   │   │   │   ├── frozen_leaf.json (30L)
│       │   │   │   │   │   ├── jungle_floor.json (30L)
│       │   │   │   │   │   ├── large_leaf.json (30L)
│       │   │   │   │   │   ├── leaf_litter.json (30L)
│       │   │   │   │   │   ├── leaf_pile.json (70L)
│       │   │   │   │   │   ├── pine_cone.json (30L)
│       │   │   │   │   │   ├── pine_needle_bed.json (45L)
│       │   │   │   │   │   ├── seed_pod.json (30L)
│       │   │   │   │   │   ├── vine_debris.json (30L)
│       │   │   │   │   │   └── wet_leaves.json (70L)
│       │   │   │   │   ├── mud/
│       │   │   │   │   │   ├── swamp_debris.json (30L)
│       │   │   │   │   │   └── swamp_mud.json (37L)
│       │   │   │   │   ├── mud_patch/
│       │   │   │   │   │   ├── cracked_earth.json (70L)
│       │   │   │   │   │   ├── drying_mud.json (70L)
│       │   │   │   │   │   └── wet_mud.json (70L)
│       │   │   │   │   ├── mystic/
│       │   │   │   │   │   ├── ethereal_soil.json (30L)
│       │   │   │   │   │   ├── glowing_earth.json (30L)
│       │   │   │   │   │   ├── glowing_particle.json (30L)
│       │   │   │   │   │   └── mystic_ground.json (30L)
│       │   │   │   │   ├── peat/
│       │   │   │   │   │   └── peat_bog.json (70L)
│       │   │   │   │   ├── pine_needles/
│       │   │   │   │   ├── sand_drift/
│       │   │   │   │   │   ├── beach_sand.json (37L)
│       │   │   │   │   │   ├── desert_sand.json (37L)
│       │   │   │   │   │   ├── shell_fragment.json (30L)
│       │   │   │   │   │   └── wet_sand.json (30L)
│       │   │   │   │   ├── snow_drift/
│       │   │   │   │   │   ├── fresh_snow.json (70L)
│       │   │   │   │   │   ├── melting_snow.json (70L)
│       │   │   │   │   │   └── packed_snow.json (45L)
│       │   │   │   │   ├── soil/
│       │   │   │   │   │   ├── dark_earth.json (30L)
│       │   │   │   │   │   ├── dirt_patch.json (30L)
│       │   │   │   │   │   ├── dry_soil.json (30L)
│       │   │   │   │   │   ├── frozen_soil.json (30L)
│       │   │   │   │   │   ├── mountain_soil.json (30L)
│       │   │   │   │   │   ├── packed_earth.json (30L)
│       │   │   │   │   │   ├── rich_dark_soil.json (30L)
│       │   │   │   │   │   ├── root_soil.json (30L)
│       │   │   │   │   │   ├── sun_bleached_soil.json (30L)
│       │   │   │   │   │   └── wet_soil.json (30L)
│       │   │   │   │   └── volcanic/
│       │   │   │   │       ├── ash_layer.json (30L)
│       │   │   │   │       ├── charred_earth.json (30L)
│       │   │   │   │       ├── cooled_lava.json (30L)
│       │   │   │   │       └── ember_patch.json (30L)
│       │   │   │   ├── mineral/
│       │   │   │   │   ├── cliff_face/
│       │   │   │   │   │   ├── cliff_face.json (108L)
│       │   │   │   │   │   └── rock_overhang.json (108L)
│       │   │   │   │   ├── crystal/
│       │   │   │   │   │   ├── crystal_fragment.json (30L)
│       │   │   │   │   │   ├── frost_crystal.json (30L)
│       │   │   │   │   │   ├── gem_deposit.json (30L)
│       │   │   │   │   │   ├── ice_crystal.json (30L)
│       │   │   │   │   │   ├── ice_formation.json (30L)
│       │   │   │   │   │   ├── ice_shard.json (30L)
│       │   │   │   │   │   ├── quartz_formation.json (30L)
│       │   │   │   │   │   └── quartz.json (50L)
│       │   │   │   │   ├── ore/
│       │   │   │   │   │   ├── coal/
│       │   │   │   │   │   ├── gem/
│       │   │   │   │   │   ├── gold/
│       │   │   │   │   │   ├── iron/
│       │   │   │   │   │   ├── coal_seam.json (112L)
│       │   │   │   │   │   ├── gem_deposit.json (112L)
│       │   │   │   │   │   ├── gold_vein.json (112L)
│       │   │   │   │   │   ├── iron_ore.json (112L)
│       │   │   │   │   │   ├── sulfur_deposit.json (30L)
│       │   │   │   │   │   └── sulfur_vent.json (30L)
│       │   │   │   │   └── rock/
│       │   │   │   │       ├── boulder/
│       │   │   │   │       ├── crystal/
│       │   │   │   │       │   └── runic_stone.json (114L)
│       │   │   │   │       ├── pebble/
│       │   │   │   │       ├── sandstone/
│       │   │   │   │       ├── volcanic/
│       │   │   │   │       ├── amethyst_geode.json (108L)
│       │   │   │   │       ├── basalt_boulder.json (108L)
│       │   │   │   │       ├── cliff_face.json (33L)
│       │   │   │   │       ├── crystal_cluster.json (108L)
│       │   │   │   │       ├── flat_rock.json (108L)
│       │   │   │   │       ├── frozen_boulder.json (30L)
│       │   │   │   │       ├── frozen_pebble.json (30L)
│       │   │   │   │       ├── granite_boulder.json (108L)
│       │   │   │   │       ├── gravel_pile.json (108L)
│       │   │   │   │       ├── lava_rock.json (108L)
│       │   │   │   │       ├── limestone_block.json (108L)
│       │   │   │   │       ├── loose_stone.json (30L)
│       │   │   │   │       ├── mossy_boulder.json (108L)
│       │   │   │   │       ├── mystic_crystal.json (108L)
│       │   │   │   │       ├── obsidian_shard.json (108L)
│       │   │   │   │       ├── pebble.json (108L)
│       │   │   │   │       ├── pumice_stone.json (108L)
│       │   │   │   │       ├── quartz_formation.json (108L)
│       │   │   │   │       ├── river_stone.json (108L)
│       │   │   │   │       ├── rock_chunk.json (98L)
│       │   │   │   │       ├── rock_overhang.json (33L)
│       │   │   │   │       ├── sandstone_boulder.json (108L)
│       │   │   │   │       ├── sandstone_slab.json (108L)
│       │   │   │   │       ├── sandstone.json (50L)
│       │   │   │   │       ├── scree.json (108L)
│       │   │   │   │       ├── slate_chip.json (30L)
│       │   │   │   │       ├── slate_slab.json (108L)
│       │   │   │   │       ├── slate.json (50L)
│       │   │   │   │       ├── small_stone.json (30L)
│       │   │   │   │       └── volcanic_rock.json (108L)
│       │   │   │   ├── structure_natural/
│       │   │   │   │   ├── bone/
│       │   │   │   │   │   ├── bone_fragment.json (30L)
│       │   │   │   │   │   ├── bone_pile.json (86L)
│       │   │   │   │   │   ├── rib_cage.json (86L)
│       │   │   │   │   │   └── skull.json (86L)
│       │   │   │   │   ├── burrow/
│       │   │   │   │   │   └── crab_burrow.json (30L)
│       │   │   │   │   ├── cave/
│       │   │   │   │   │   └── cave_entrance.json (33L)
│       │   │   │   │   ├── coral/
│       │   │   │   │   │   ├── brain_coral.json (87L)
│       │   │   │   │   │   ├── branching_coral.json (87L)
│       │   │   │   │   │   └── fan_coral.json (87L)
│       │   │   │   │   ├── den/
│       │   │   │   │   │   ├── ant_mound.json (86L)
│       │   │   │   │   │   ├── bear_den.json (86L)
│       │   │   │   │   │   ├── burrow_entrance.json (86L)
│       │   │   │   │   │   ├── cave_entrance.json (86L)
│       │   │   │   │   │   ├── crab_burrow.json (86L)
│       │   │   │   │   │   └── termite_mound.json (86L)
│       │   │   │   │   ├── hive/
│       │   │   │   │   │   ├── beehive.json (86L)
│       │   │   │   │   │   └── wasp_nest.json (86L)
│       │   │   │   │   ├── insect/
│       │   │   │   │   │   └── termite_mound.json (30L)
│       │   │   │   │   ├── log/
│       │   │   │   │   │   ├── birch_tree_stump.json (79L)
│       │   │   │   │   │   ├── branch.json (79L)
│       │   │   │   │   │   ├── charred_trunk.json (92L)
│       │   │   │   │   │   ├── driftwood.json (86L)
│       │   │   │   │   │   ├── fallen_log.json (86L)
│       │   │   │   │   │   ├── hollow_log.json (86L)
│       │   │   │   │   │   ├── log.json (79L)
│       │   │   │   │   │   ├── maple_tree_stump.json (79L)
│       │   │   │   │   │   ├── mossy_log.json (86L)
│       │   │   │   │   │   ├── oak_tree_stump.json (79L)
│       │   │   │   │   │   ├── palm_tree_stump.json (79L)
│       │   │   │   │   │   ├── pine_tree_stump.json (79L)
│       │   │   │   │   │   ├── spruce_tree_stump.json (79L)
│       │   │   │   │   │   ├── twig.json (28L)
│       │   │   │   │   │   └── wood_scrap.json (28L)
│       │   │   │   │   ├── mystic/
│       │   │   │   │   │   └── runic_stone.json (30L)
│       │   │   │   │   ├── nest/
│       │   │   │   │   │   ├── bird_nest.json (86L)
│       │   │   │   │   │   └── eagle_nest.json (86L)
│       │   │   │   │   ├── shell/
│       │   │   │   │   │   ├── clam_shell.json (86L)
│       │   │   │   │   │   ├── conch_shell.json (86L)
│       │   │   │   │   │   └── shell_scatter.json (86L)
│       │   │   │   │   └── web/
│       │   │   │   │       ├── cocoon.json (86L)
│       │   │   │   │       └── spider_web.json (86L)
│       │   │   │   ├── vegetation/
│       │   │   │   │   ├── algae/
│       │   │   │   │   │   ├── algae_film.json (70L)
│       │   │   │   │   │   ├── freshwater_algae.json (70L)
│       │   │   │   │   │   └── saltwater_algae.json (70L)
│       │   │   │   │   ├── bush/
│       │   │   │   │   │   ├── berry/
│       │   │   │   │   │   ├── flowering/
│       │   │   │   │   │   ├── thorny/
│       │   │   │   │   │   ├── berry_bush.json (164L)
│       │   │   │   │   │   ├── blueberry_bush.json (164L)
│       │   │   │   │   │   ├── bramble.json (164L)
│       │   │   │   │   │   ├── dead_shrub.json (30L)
│       │   │   │   │   │   ├── desert_shrub.json (164L)
│       │   │   │   │   │   ├── dry_bush.json (164L)
│       │   │   │   │   │   ├── flowering_bush.json (164L)
│       │   │   │   │   │   ├── green_bush.json (40L)
│       │   │   │   │   │   ├── hedge_bush.json (164L)
│       │   │   │   │   │   ├── rose_bush.json (164L)
│       │   │   │   │   │   ├── scrub_brush.json (164L)
│       │   │   │   │   │   ├── thorny_bush.json (164L)
│       │   │   │   │   │   └── tundra_shrub.json (164L)
│       │   │   │   │   ├── cactus/
│       │   │   │   │   │   └── cactus.json (40L)
│       │   │   │   │   ├── crop/
│       │   │   │   │   │   ├── apple_tree.json (241L)
│       │   │   │   │   │   ├── barley.json (140L)
│       │   │   │   │   │   ├── carrot_plant.json (140L)
│       │   │   │   │   │   ├── cherry_tree.json (241L)
│       │   │   │   │   │   ├── corn.json (140L)
│       │   │   │   │   │   ├── potato_plant.json (140L)
│       │   │   │   │   │   ├── tomato_plant.json (140L)
│       │   │   │   │   │   └── wheat.json (140L)
│       │   │   │   │   ├── fern/
│       │   │   │   │   │   ├── curled_fiddlehead.json (140L)
│       │   │   │   │   │   ├── forest_fern.json (140L)
│       │   │   │   │   │   ├── giant_fern.json (140L)
│       │   │   │   │   │   └── tropical_fern.json (140L)
│       │   │   │   │   ├── flower/
│       │   │   │   │   │   ├── mushroom/
│       │   │   │   │   │   │   ├── bracket_fungus.json (30L)
│       │   │   │   │   │   │   └── morel.json (30L)
│       │   │   │   │   │   ├── mystic/
│       │   │   │   │   │   │   ├── arcane_flower.json (30L)
│       │   │   │   │   │   │   └── spirit_wisp.json (30L)
│       │   │   │   │   │   ├── tropical/
│       │   │   │   │   │   ├── wildflower/
│       │   │   │   │   │   ├── arcane_flower.json (120L)
│       │   │   │   │   │   ├── arctic_poppy.json (120L)
│       │   │   │   │   │   ├── bracket_fungus.json (120L)
│       │   │   │   │   │   ├── cactus_flower.json (120L)
│       │   │   │   │   │   ├── daisy.json (120L)
│       │   │   │   │   │   ├── dandelion.json (120L)
│       │   │   │   │   │   ├── glowing_mushroom.json (120L)
│       │   │   │   │   │   ├── hibiscus.json (120L)
│       │   │   │   │   │   ├── lavender.json (120L)
│       │   │   │   │   │   ├── lotus.json (120L)
│       │   │   │   │   │   ├── morel.json (120L)
│       │   │   │   │   │   ├── orchid.json (120L)
│       │   │   │   │   │   ├── poppy.json (120L)
│       │   │   │   │   │   ├── puffball.json (120L)
│       │   │   │   │   │   ├── spirit_wisp.json (120L)
│       │   │   │   │   │   ├── succulent.json (120L)
│       │   │   │   │   │   ├── sunflower.json (120L)
│       │   │   │   │   │   ├── toadstool.json (120L)
│       │   │   │   │   │   └── wildflower.json (120L)
│       │   │   │   │   ├── grass/
│       │   │   │   │   │   ├── aquatic/
│       │   │   │   │   │   ├── reed/
│       │   │   │   │   │   ├── short/
│       │   │   │   │   │   ├── tall/
│       │   │   │   │   │   ├── bulrush.json (140L)
│       │   │   │   │   │   ├── cattail.json (140L)
│       │   │   │   │   │   ├── charred_grass.json (30L)
│       │   │   │   │   │   ├── clover_patch.json (30L)
│       │   │   │   │   │   ├── dry_grass.json (140L)
│       │   │   │   │   │   ├── frozen_grass.json (140L)
│       │   │   │   │   │   ├── grass_tuft.json (40L)
│       │   │   │   │   │   ├── kelp.json (140L)
│       │   │   │   │   │   ├── lawn_grass.json (140L)
│       │   │   │   │   │   ├── meadow_grass.json (140L)
│       │   │   │   │   │   ├── pampas_grass.json (140L)
│       │   │   │   │   │   ├── prairie_grass.json (140L)
│       │   │   │   │   │   ├── reed.json (140L)
│       │   │   │   │   │   ├── river_weed.json (140L)
│       │   │   │   │   │   ├── savanna_grass.json (30L)
│       │   │   │   │   │   ├── sea_grass.json (140L)
│       │   │   │   │   │   ├── short_grass.json (140L)
│       │   │   │   │   │   ├── tall_grass.json (140L)
│       │   │   │   │   │   └── tropical_grass.json (30L)
│       │   │   │   │   ├── lichen/
│       │   │   │   │   │   └── lichen_patch.json (70L)
│       │   │   │   │   ├── moss/
│       │   │   │   │   │   ├── ground_moss.json (70L)
│       │   │   │   │   │   ├── hanging_moss.json (70L)
│       │   │   │   │   │   ├── hardy_moss.json (70L)
│       │   │   │   │   │   ├── lichen.json (30L)
│       │   │   │   │   │   ├── rock_moss.json (70L)
│       │   │   │   │   │   └── tree_moss.json (70L)
│       │   │   │   │   ├── shrub/
│       │   │   │   │   ├── tree/
│       │   │   │   │   │   ├── conifer/
│       │   │   │   │   │   │   ├── cedar_tree.json (241L)
│       │   │   │   │   │   │   ├── fir_tree.json (241L)
│       │   │   │   │   │   │   ├── juniper_tree.json (241L)
│       │   │   │   │   │   │   ├── pine_tree.json (241L)
│       │   │   │   │   │   │   └── spruce_tree.json (241L)
│       │   │   │   │   │   ├── dead/
│       │   │   │   │   │   │   ├── charred_tree.json (241L)
│       │   │   │   │   │   │   ├── dead_tree.json (241L)
│       │   │   │   │   │   │   └── hollow_tree.json (241L)
│       │   │   │   │   │   ├── deciduous/
│       │   │   │   │   │   │   ├── ash_tree.json (241L)
│       │   │   │   │   │   │   ├── beech_tree.json (241L)
│       │   │   │   │   │   │   ├── birch_tree.json (241L)
│       │   │   │   │   │   │   ├── elm_tree.json (241L)
│       │   │   │   │   │   │   ├── maple_tree.json (241L)
│       │   │   │   │   │   │   ├── oak_tree.json (241L)
│       │   │   │   │   │   │   └── poplar_tree.json (241L)
│       │   │   │   │   │   ├── palm/
│       │   │   │   │   │   │   ├── coconut_palm.json (241L)
│       │   │   │   │   │   │   └── palm_tree.json (241L)
│       │   │   │   │   │   ├── tropical/
│       │   │   │   │   │   │   ├── banana_tree.json (241L)
│       │   │   │   │   │   │   ├── jungle_tree.json (241L)
│       │   │   │   │   │   │   ├── kapok_tree.json (241L)
│       │   │   │   │   │   │   ├── mangrove_tree.json (241L)
│       │   │   │   │   │   │   └── palm_tree.json (33L)
│       │   │   │   │   │   └── willow/
│       │   │   │   │   │       ├── weeping_willow.json (241L)
│       │   │   │   │   │       └── willow_tree.json (241L)
│       │   │   │   │   └── vine/
│       │   │   │   │       ├── climbing_vine.json (140L)
│       │   │   │   │       ├── ethereal_vine.json (140L)
│       │   │   │   │       ├── ground_vine.json (140L)
│       │   │   │   │       ├── hanging_vine.json (140L)
│       │   │   │   │       └── ivy.json (140L)
│       │   │   │   └── water_feature/
│       │   │   │       ├── algae/
│       │   │   │       │   ├── algae_patch.json (30L)
│       │   │   │       │   ├── algae.json (50L)
│       │   │   │       │   ├── freshwater_algae.json (30L)
│       │   │   │       │   └── seaweed_bit.json (30L)
│       │   │   │       ├── foam/
│       │   │   │       ├── ice/
│       │   │   │       ├── pool/
│       │   │   │       │   └── mist_pool.json (30L)
│       │   │   │       ├── puddle/
│       │   │   │       │   └── mist_pool.json (37L)
│       │   │   │       ├── splash/
│       │   │   │       ├── waterfall/
│       │   │   │       │   └── waterfall.json (37L)
│       │   │   │       ├── wave/
│       │   │   │       ├── whirlpool/
│       │   │   │       ├── footstep_splash.json (36L)
│       │   │   │       ├── frost_pattern.json (36L)
│       │   │   │       ├── icicle.json (36L)
│       │   │   │       ├── impact_splash.json (36L)
│       │   │   │       ├── lake_ripple.json (36L)
│       │   │   │       ├── ocean_wave.json (36L)
│       │   │   │       ├── rain_puddle.json (36L)
│       │   │   │       ├── rapid_foam.json (36L)
│       │   │   │       ├── river_current.json (36L)
│       │   │   │       ├── sheet_ice.json (36L)
│       │   │   │       ├── shore_foam.json (36L)
│       │   │   │       ├── standing_water.json (36L)
│       │   │   │       ├── tidal_pool.json (36L)
│       │   │   │       ├── trickle.json (36L)
│       │   │   │       └── whirlpool.json (36L)
│       │   │   ├── schema/
│       │   │   │   ├── affinity_schema.json (156L)
│       │   │   │   ├── EXTENSION_POINTS.md (148L)
│       │   │   │   ├── interaction_schema.json (217L)
│       │   │   │   ├── object_schema.json (259L)
│       │   │   │   ├── README.md (213L)
│       │   │   │   └── transition_schema.json (72L)
│       │   │   └── transitions/
│       │   │       ├── beach_grassland.json (27L)
│       │   │       ├── beach_ocean.json (23L)
│       │   │       ├── beach_tropical_forest.json (27L)
│       │   │       ├── dense_forest_swamp.json (27L)
│       │   │       ├── desert_mountains.json (27L)
│       │   │       ├── desert_volcanic.json (27L)
│       │   │       ├── forest_dense_forest.json (27L)
│       │   │       ├── forest_lake.json (27L)
│       │   │       ├── forest_mountains.json (27L)
│       │   │       ├── forest_mystic.json (27L)
│       │   │       ├── forest_river.json (23L)
│       │   │       ├── forest_swamp.json (27L)
│       │   │       ├── forest_taiga.json (27L)
│       │   │       ├── grassland_forest.json (27L)
│       │   │       ├── grassland_lake.json (27L)
│       │   │       ├── grassland_mystic.json (27L)
│       │   │       ├── grassland_river.json (23L)
│       │   │       ├── grassland_savanna.json (23L)
│       │   │       ├── grassland_steppe.json (27L)
│       │   │       ├── lake_river.json (23L)
│       │   │       ├── mountains_arctic.json (27L)
│       │   │       ├── mountains_volcanic.json (27L)
│       │   │       ├── savanna_desert.json (27L)
│       │   │       ├── steppe_desert.json (27L)
│       │   │       ├── steppe_tundra.json (27L)
│       │   │       ├── swamp_tropical_forest.json (27L)
│       │   │       ├── taiga_mountains.json (27L)
│       │   │       ├── tropical_forest_ocean.json (27L)
│       │   │       ├── tundra_arctic.json (27L)
│       │   │       └── tundra_taiga.json (27L)
│       │   ├── town_layouts/
│       │   │   ├── crossroads_market.json (60L)
│       │   │   ├── fishing_village.json (43L)
│       │   │   ├── forest_hamlet.json (32L)
│       │   │   ├── hilltop_fort.json (56L)
│       │   │   ├── lakeside_village.json (57L)
│       │   │   └── mountain_outpost.json (30L)
│       │   ├── worldgen/
│       │   │   ├── palette/
│       │   │   │   ├── deep_ocean.json (22L)
│       │   │   │   ├── desert.json (22L)
│       │   │   │   ├── forest.json (22L)
│       │   │   │   ├── grass.json (22L)
│       │   │   │   ├── grassland.json (22L)
│       │   │   │   ├── hills.json (22L)
│       │   │   │   ├── mountains.json (22L)
│       │   │   │   └── shallow_water.json (22L)
│       │   │   └── config.json (23L)
│       │   ├── api_keys.json (5L)
│       │   ├── api_keys.json.example (7L)
│       │   ├── biome_assets.json (23L)
│       │   ├── pixellab_tileset_catalog.json (170L)
│       │   ├── player_schema.json (63L)
│       │   ├── surface_layer_stacks.json (116L)
│       │   └── terrain_v3_transition_jobs.json (23L)
│       ├── docs/
│       │   ├── superpowers/
│       │   │   ├── plans/
│       │   │   │   ├── 2026-05-24-L0-grain-data-model.md (735L)
│       │   │   │   ├── 2026-05-24-world-compiler.md
│       │   │   │   ├── 2026-05-25-overmap-streaming.md (929L)
│       │   │   │   ├── 2026-05-25-tile-object-phase1.md (593L)
│       │   │   │   ├── 2026-05-25-tilemap-migration.md (246L)
│       │   │   │   ├── 2026-05-25-town-layout-system.md (403L)
│       │   │   │   ├── 2026-05-26-asset-generation.md (363L)
│       │   │   │   ├── 2026-05-26-asset-pipeline-infrastructure.md (345L)
│       │   │   │   ├── 2026-05-26-dynamic-lighting.md (687L)
│       │   │   │   ├── 2026-05-26-gdextension-cpp-foundation.md (1101L)
│       │   │   │   ├── 2026-05-26-runtime-compositor.md (463L)
│       │   │   │   ├── 2026-05-26-world-biome-system.md (854L)
│       │   │   │   ├── 2026-05-27-elevation-cliff-rendering.md (684L)
│       │   │   │   ├── 2026-05-27-elevation-hypergraph-terrain.md (1172L)
│       │   │   │   ├── 2026-05-27-elevation-rendering-transition.md (171L)
│       │   │   │   ├── 2026-05-27-terrain-shading.md (418L)
│       │   │   │   ├── 2026-05-28-terrain-object-system.md
│       │   │   │   └── 2026-05-31-terrain-rendering-cleanup.md (667L)
│       │   │   └── specs/
│       │   │       ├── 2026-05-24-master-architecture-design.md (268L)
│       │   │       ├── 2026-05-24-vertical-slice-design.md (140L)
│       │   │       ├── 2026-05-24-visual-vertical-slice-design.md (51L)
│       │   │       ├── 2026-05-24-world-compiler-design.md (477L)
│       │   │       ├── 2026-05-25-agent-swarm-design.md (73L)
│       │   │       ├── 2026-05-25-color-algebra-tiles-design.md (207L)
│       │   │       ├── 2026-05-25-layer-architecture-spec.md (172L)
│       │   │       ├── 2026-05-25-overmap-streaming-design.md (169L)
│       │   │       ├── 2026-05-25-tile-object-system-design.md (363L)
│       │   │       ├── 2026-05-25-tileset-framework-design.md (335L)
│       │   │       ├── 2026-05-25-visual-quality-spec.md (76L)
│       │   │       ├── 2026-05-26-asset-pipeline-spec.md (180L)
│       │   │       ├── 2026-05-26-biome-asset-manifest-spec.md (270L)
│       │   │       ├── 2026-05-26-dynamic-lighting-spec.md (191L)
│       │   │       ├── 2026-05-26-performance-infrastructure-spec.md (81L)
│       │   │       ├── 2026-05-26-runtime-compositor-spec.md (149L)
│       │   │       ├── 2026-05-26-subterranean-design.md (121L)
│       │   │       ├── 2026-05-26-world-biome-system-design.md (218L)
│       │   │       ├── 2026-05-27-elevation-cliff-rendering-design.md (197L)
│       │   │       ├── 2026-05-27-elevation-hypergraph-terrain-design.md (275L)
│       │   │       ├── 2026-05-27-terrain-shading-design.md (118L)
│       │   │       ├── 2026-05-28-pixellab-audit-plan.md (56L)
│       │   │       ├── 2026-05-28-terrain-object-system-design.md (886L)
│       │   │       ├── 2026-05-29-biome-layer-stack-design.md (379L)
│       │   │       ├── 2026-05-29-unity-migration-handoff.md (336L)
│       │   │       └── 2026-05-31-terrain-rendering-cleanup-design.md (217L)
│       │   └── deep-research-report.md (656L)
│       ├── gdextension/
│       │   ├── godot-cpp/
│       │   │   ├── bin/
│       │   │   │   └── libgodot-cpp.windows.template_debug.x86_64.lib
│       │   │   ├── cmake/
│       │   │   │   ├── android.cmake (50L)
│       │   │   │   ├── common_compiler_flags.cmake (193L)
│       │   │   │   ├── emsdkHack.cmake (41L)
│       │   │   │   ├── godotcpp.cmake (400L)
│       │   │   │   ├── GodotCPPModule.cmake (177L)
│       │   │   │   ├── ios.cmake (37L)
│       │   │   │   ├── ios.toolchain.cmake
│       │   │   │   ├── linux.cmake (40L)
│       │   │   │   ├── macos.cmake (42L)
│       │   │   │   ├── web.cmake (41L)
│       │   │   │   └── windows.cmake (119L)
```
