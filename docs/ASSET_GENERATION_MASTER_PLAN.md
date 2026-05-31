# FreedomMMO Asset Generation Master Plan

This document defines how the landscape, objects, characters, buildings, items, effects, and interaction-state art will be generated programmatically with Sorceress. The target is not a small tileset. The target is a massive composable visual library: tens of thousands of base assets and, after directional/state/biome/interaction variants, potentially hundreds of thousands of generated frames.

## 1. Core principle

Every visual is a projection of simulation state. We do not generate a single sprite for an object; we generate a layered asset family with:

- biome context
- material composition
- physical footprint
- draw layer
- lighting/shadow rules
- collision/interaction volumes
- animation clips
- state overlays
- elemental/biome reaction overlays
- transition rules
- assembly anchors

A tile/object/NPC/building is assembled from multiple generated sheets, not painted as one monolithic sprite.

## 2. Landscape construction layers

Landscape tiles are horizontal stacks. A visible tile can be assembled from these layers:

1. **Bedrock / deep substrate**
   - invisible or partially exposed base geology
   - controls mining, cliffs, caves, ore, elevation resistance

2. **Soil / sediment / surface base**
   - dirt, sand, clay, ash, frozen earth, humus, silt, aether moss
   - seamless base terrain tiles per biome

3. **Moisture / deposition layer**
   - wetness, mud, salt crust, river silt, snow crust, ash dust
   - transparent overlays

4. **Ground-cover layer**
   - short grass, moss, lichen, leaf litter, needles, reeds, fungal mats, mystic aether bloom
   - crushable and reactive to footsteps

5. **Foliage blade layer**
   - animated grass, reeds, flowers, small plants
   - wind/reactive animation
   - bends away from player movement

6. **Micro-object/debris layer**
   - pebbles, shells, twigs, roots, mushrooms, crystals, bones, fallen leaves
   - small collidable/collectible variants optional

7. **Terrain-form layer**
   - cliffs, ledges, slopes, overhangs, natural bridges, dry riverbeds, cave mouths
   - controls traversal, climbing, jumping, gliding, visibility

8. **Large object layer**
   - trees, rocks, shrubs, logs, boulders, ruins, resource nodes
   - y/elevation sorted

9. **Structure layer**
   - walls, floors, roofs, doors, windows, props, settlements, bridges
   - assembled from material sheets

10. **Entity layer**
    - player, NPCs, creatures, mounts, projectiles
    - modular body/equipment assembly

11. **Effect layer**
    - fire, water splash, dust, snow puff, magic motes, poison gas, gliding wind trails

12. **Lighting/shadow layer**
    - cast shadows, contact shadows, local lights, emissive mystic overlays, day/night tint masks

## 3. Biomes

All asset families are generated across 21 biomes:

- deep_ocean
- ocean
- shallow_water
- beach
- river
- lake
- grassland
- forest
- dense_forest
- tropical_forest
- taiga
- savanna
- steppe
- desert
- swamp
- tundra
- arctic
- hills
- mountains
- volcanic
- mystic

## 4. Terrain asset categories

For each biome generate:

### 4.1 Base terrain tiles

- 64 seamless variants minimum per biome
- dry/default/wet/snow/frozen/burnt/enchanted/depleted overlays
- transition edge/corner masks
- elevation-aware highlight/shadow variants

### 4.2 Transitions between biome pairs

Only valid biome graph neighbors get transition sheets. Each pair gets:

- straight edges N/E/S/W
- inner corners
- outer corners
- noise/dither masks
- object/debris transition hints
- 8 variants per mask

### 4.3 Terrain forms

Per relevant biome/material:

- cliff wall
- cliff top lip
- ledge
- slope ramp
- climbable rock face
- cave mouth
- overhang
- natural bridge
- dry riverbed
- erosion cut
- shoreline bank
- waterfall lip

Each form gets:

- 8-direction exposed face variants where applicable
- height bands: low, medium, high, extreme
- traversal states: normal, slippery, crumbling, blocked, climbable

### 4.4 Water/shoreline

- deep water
- shallow water
- river flow
- lake stillness
- foam
- ripple
- waterfall
- shoreline edge
- wet sand/mud
- ice sheet
- broken ice
- mystic shimmering water

Animations:

- calm loop
- wind loop
- flow directional loop
- splash
- freeze/thaw
- poison/taint
- mystic shimmer

## 5. Vegetation categories

For each biome:

- canopy tree
- understory tree
- conifer/palm/mangrove/cactus/etc as appropriate
- sapling
- shrub
- grass cluster
- reeds
- flowers
- mushrooms/fungi
- vines
- roots
- fallen log
- stump
- burnt stump
- harvest/depleted state

Animations:

- idle wind
- strong wind
- chopped/hit reaction
- fall
- burn
- freeze shimmer
- water drip
- mystic enchant pulse
- growth/sprout
- harvest/deplete

States:

- seedling
- young
- mature
- ancient
- wet
- waterlogged
- frozen
- frosted
- burning
- charred
- dead
- diseased/rotting
- enchanted
- glowing
- harvested
- cut

## 6. Geology/resource categories

For each biome/material:

- small rock
- boulder
- cliff debris
- ore node
- crystal node
- gemstone node
- cave mouth
- stalagmite/stalactite where relevant
- basalt/obsidian
- ice rock
- rune stone
- fossil/bone stone

Animations/states:

- idle shine
- hit/chip
- cracked
- depleted
- wet/slick
- frozen
- heat-cracked
- glowing ore
- mystic rune pulse

## 7. Buildings and settlements

Generated by biome + settlement tier + material:

### 7.1 Tile materials

- wall stone
- wall wood
- wall clay/adobe
- thatch
- roof shingle
- roof slate
- floor wood
- floor stone
- carpet/rug
- dirt floor
- trim
- damage overlays

### 7.2 Building parts

- foundation
- wall segments
- wall corners
- roof segments
- roof corners
- doors
- windows
- stairs
- balconies
- chimneys
- signs
- fences
- gates
- bridges

States:

- intact
- damaged
- burnt
- wet
- snow covered
- overgrown
- enchanted
- abandoned
- occupied/lit

## 8. Interior props

- bed
- table
- chair
- chest
- shelf
- forge
- anvil
- loom
- cooking pot
- barrel
- crate
- rug
- altar
- bookshelf
- lamp
- workstation

States:

- closed/open
- empty/full
- lit/unlit
- broken
- burnt
- wet
- enchanted
- occupied/in use

## 9. Character modular assembly

Player/NPC bodies are not monolithic. They are assembled from layers:

1. shadow/contact
2. back hair/back equipment
3. rear arm
4. rear shoulder
5. rear hand
6. rear leg
7. rear foot
8. hips/pelvis
9. torso
10. neck
11. head
12. face
13. front leg
14. front foot
15. front arm
16. front shoulder
17. front hand
18. hair front
19. clothing torso
20. clothing legs
21. armor overlays
22. held item/weapon/tool
23. equipment effects
24. lighting mask

Directions:

- S, SE, E, NE, N, NW, W, SW

Animation clips:

- idle
- walk
- run/sprint
- jump_start
- jump_air
- land
- climb
- climb_idle
- glide_start
- glide_loop
- glide_land
- dodge_roll
- attack
- cast
- gather
- carry
- hurt
- sleep/sit

Each body part gets matching frames by direction/clip. Equipment and clothing are generated as compatible overlays with identical frame grids.

## 10. Items/equipment

- tools: axe, pickaxe, shovel, hoe, fishing rod
- weapons: sword, dagger, bow, staff, spear
- shields
- held resources
- backpacks
- helmets
- hair styles
- shirts/coats/robes
- pants/skirts
- boots/gloves
- jewelry

States:

- idle equipped
- swing/use
- charged
- broken
- enchanted
- wet/frozen/burning visual overlays

## 11. Creatures/NPCs

Categories:

- humanoid villagers
- merchants
- guards
- animals
- monsters
- spirits/fae
- aquatic creatures
- flying creatures

All use either modular humanoid assembly or creature-specific layered assemblies.

## 12. Effects

For every element:

- fire
- water
- ice
- cold
- mystic
- rot
- ash
- poison
- salt
- wind
- sun
- ore/metal

Generate:

- impact
- loop aura
- projectile
- ground decal
- object overlay
- character overlay
- environmental ambient motes

## 13. Interaction combinatorics

For every material × element pair generate state overlays:

Materials:

- wood
- leaf
- grass
- stone
- sand
- water
- metal
- cloth
- leather
- bone
- crystal
- soil

Elements:

- fire
- water
- ice
- cold
- mystic
- rot
- ash
- poison
- salt
- wind
- sun
- ore/metal

Examples:

- wood + fire = burning/charred
- wood + water = waterlogged/dripping
- wood + mystic = enchanted/rune-lit
- grass + ice = frozen/frosted
- stone + mystic = rune etched
- water + poison = tainted
- sand + fire = glass scorched

## 14. Generation scale

Initial complete run target:

- 21 biome base terrain sheets × 64 cells = 1,344 tiles
- 21 biome micro-layer sheets × 64 cells = 1,344 overlays
- ~70 valid biome transitions × 64 cells = 4,480 tiles
- 21 nature object sheets × 64 cells = 1,344 object frames
- 21 building material sheets × 64 cells = 1,344 tiles
- material reaction sheets: 12 materials × 12 elements × 8 frames = 1,152 overlays
- modular humanoid base: 24 layers × 8 directions × ~16 clips × 8 frames = 24,576 frames
- clothing/equipment overlays: easily 50,000+ frames
- effects: 12 elements × 6 effect types × 8 frames = 576 frames

Full combinatorial target exceeds 100,000 frames/assets once equipment, NPC variants, biome states, and object reaction states are included.

## 15. Execution approach

1. Generate job manifests from data tables.
2. Batch Sorceress jobs by family.
3. Save outputs in `assets/generated/` using deterministic paths.
4. Runtime atlas definitions load generated PNGs automatically.
5. Fallback only used while a generated sheet is missing.
6. Asset manifests record physics/collision/render/animation/state metadata.
7. Renderer assembles scene from layer stacks and modular body parts.
8. Validate coverage with audits:
   - all biomes have base/micro/nature/building sheets
   - all valid transitions exist
   - all material × element overlays exist
   - all character layers have matching frame grids
