# Maximal Landscape Taxonomy

This document defines the target landscape construction model for FreedomMMO. A landscape is not a colored tile. It is a layered simulation projection: geology, soil, water, vegetation, objects, canopy, atmosphere, living detail, and interaction states all stacked and composited.

## 1. Landscape Stack

Every world tile is assembled from horizontal layers. Each layer can be empty, sparse, dense, animated, interactive, collidable, occluding, seasonal, damaged, or magically transformed.

### L0 Bedrock / Geological Foundation

Purpose: define mass, slope, cliffs, mountain forms, cave potential, stone color, ore veins, and collision hardness.

Asset families:

- bedrock base textures
- stratified rock bands
- exposed stone plates
- cracked stone seams
- boulder embedded forms
- scree fields
- gravel beds
- ore veins
- basalt plates
- granite slabs
- limestone shelves
- sandstone ledges
- shale flakes
- obsidian glass
- pumice chunks
- glacial scoured stone
- rune-etched mystic stone

Animations:

- heat shimmer on volcanic stone
- wet glisten shimmer
- mystic rune pulse
- falling pebble trickle on cliffs
- dust drift on dry rock

States:

- dry
- wet
- mossy
- icy
- snow-dusted
- ash-dusted
- cracked
- fractured
- rune-etched
- glowing
- ore-exposed
- collapsed

Interactions:

- fire: heat cracks, ember seams
- water: slick, mossy, erosion stains
- ice/cold: frost, ice crusts
- mystic: runes, levitating fragments, glow veins
- impact: cracks, rubble
- mining: ore exposed, debris

### L1 Soil / Sediment

Purpose: define what the player walks on beneath vegetation and debris.

Asset families:

- dry dirt
- damp dirt
- dark loam
- clay mud
- cracked mud
- swamp muck
- peat
- silt
- riverbank sediment
- floodplain alluvium
- beach sand
- desert sand
- dune sand
- ash soil
- tundra permafrost soil
- snow-packed earth
- leaf-mixed humus
- root-threaded soil
- fungal soil
- aether moss soil

Animations:

- mud squish impression frames
- dust puff frames
- water seep shimmer
- aether mote pulsing
- wind-blown sand creep

States:

- dry
- damp
- wet
- waterlogged
- muddy
- cracked
- frozen
- snow-covered
- scorched
- ashen
- poisoned
- enchanted
- trampled
- dug

Interactions:

- footsteps: prints, compression, sound type
- rain/water: mud, puddles, darker color
- fire: scorched, ash overlay
- cold: frozen crust
- mystic: glowing root filaments
- digging: exposed subsoil

### L2 Ground Cover / Low Vegetation

Purpose: fill walkable surfaces with grass, moss, lichen, small plants, sprouts, needles, and low leaves.

Asset families:

- short grass
- tall grass
- lush grass
- dry grass
- yellow savanna grass
- steppe grass tufts
- moss mats
- leaf litter
- pine needles
- reeds
- cattails
- marsh grass
- tundra lichen
- alpine cushion plants
- dune scrub
- cactus sprouts
- fungal mats
- aether moss
- glowing grass
- clover patches
- fern starts

Animations:

- wind sway loop
- player brush displacement
- rain flattening
- frost sparkle
- mystic pulse
- insect disturbance rustle

States:

- healthy
- dry
- wet
- waterlogged
- frosted
- frozen
- burnt
- trampled
- cut
- blooming
- seeded
- enchanted
- poisoned
- ash-dusted

Interactions:

- player movement bends blades
- sprinting flattens grass briefly
- fire burns and propagates
- water makes lush or waterlogged
- ice freezes blades
- mystic produces fae bloom
- insects animate local rustle

### L3 Flowers / Herbs / Detail Plants

Purpose: create diversity and local identity.

Asset families:

- wildflower clusters
- single blossoms
- herb sprigs
- medicinal herbs
- poison flowers
- desert blooms
- swamp fungus flowers
- alpine flowers
- tundra blooms
- mystic fae flowers
- glowing pollen plants
- seed heads
- mushrooms
- shelf fungi
- small ferns

Animations:

- blossom idle sway
- pollen puff
- glow pulse
- petal fall
- insect landing

States:

- bud
- blooming
- seeded
- wilted
- wet
- frozen
- burnt
- enchanted
- harvested

Interactions:

- gatherable
- trampling
- pollination/insect attraction
- fire destruction
- mystic bloom transformation

### L4 Stones / Debris / Surface Objects

Purpose: non-tall detail objects that affect readability, collision, gathering, and biome identity.

Asset families:

- pebbles
- stones
- boulder chips
- gravel scatter
- shells
- driftwood
- fallen leaves
- twigs
- branches
- roots exposed
- bones
- ash flakes
- volcanic cinders
- ice shards
- snow clumps
- pinecones
- seed pods
- fruit drops
- insect mounds
- anthills
- termite mounds

Animations:

- wind tumble for leaves
- water bob for driftwood
- insect activity on mounds
- ember glow for cinders
- mystic hover for enchanted fragments

States:

- dry
- wet
- mossy
- frozen
- scorched
- buried
- uncovered
- enchanted

Interactions:

- kickable small debris
- harvestable shells/wood
- collision for larger stones
- hiding insects/items

### L5 Shrubs / Bushes / Hedges

Purpose: medium vegetation with partial collision, concealment, resource harvesting, and movement resistance.

Asset families:

- small shrub
- round bush
- bramble bush
- berry bush
- thorn bush
- desert scrub
- sagebrush
- swamp bush
- mangrove shrub
- hedge segment straight
- hedge corner
- hedge endcap
- hedge gate opening
- mystic glow shrub
- flowering bush
- frozen shrub
- burnt shrub

Animations:

- idle sway
- rustle on contact
- berry sparkle/growth
- thorn reaction
- burn animation
- freeze shimmer
- mystic pulse

States:

- young
- mature
- flowering
- fruiting
- harvested
- cut
- trampled
- burning
- burnt
- frozen
- waterlogged
- enchanted
- poisoned

Interactions:

- slows movement
- hides small entities/items
- harvest berries/herbs
- can be cut/burned/frozen/enchanted
- hedges block movement/projectiles depending density

### L6 Vines / Creepers / Roots

Purpose: vertical/horizontal connection layer; climbable, decorative, occluding, and interactive.

Asset families:

- ground vines
- hanging vines
- tree vines
- cliff vines
- root tendrils
- swamp creepers
- thorn creepers
- flowering vines
- ivy wall patches
- jungle lianas
- mystic glowing vines
- frozen vines
- burnt vines

Animations:

- sway
- crawl/growth loop
- grasp/retract
- magic pulse
- burning propagation

States:

- growing
- mature
- climbable
- cut
- burning
- burnt
- frozen
- waterlogged
- enchanted
- thorned

Interactions:

- climbable on cliffs/trees
- movement slowing on ground
- burnable wood/leaf material
- waterlogged and heavy
- frozen brittle
- mystic animated/active

### L7 Trees / Trunks / Branches

Purpose: major vertical objects, canopy sources, shadows, occlusion, collision, harvesting, habitats.

Asset families:

- broadleaf tree
- ancient tree
- sapling
- dead tree
- burnt tree
- fallen log
- hollow log
- conifer
- snow conifer
- tropical tree
- palm
- mangrove
- swamp cypress
- savanna acacia
- desert cactus tree
- mystic tree
- fruit tree
- flowering tree
- giant root tree

Sub-layers:

- shadow
- root base
- trunk
- bark details
- branches
- canopy mass back
- canopy mass front
- fruit/flowers
- vines
- snow overlay
- wet overlay
- burn overlay
- mystic overlay
- lighting mask

Animations:

- canopy sway
- leaf flutter
- branch sway
- fruit drop
- pollen fall
- burning
- smoke
- freeze shimmer
- enchanted pulse
- chop damage
- fall animation

States:

- sapling
- young
- mature
- ancient
- flowering
- fruiting
- autumn
- winter bare
- wet
- waterlogged
- burning
- burnt
- charred
- dead
- frozen
- enchanted
- diseased
- chopped
- fallen

Interactions:

- collision trunk
- soft collision canopy
- blocks projectiles depending density
- casts shadows
- occludes entities
- climbable depending species
- harvest wood/fruit/leaves/resin
- burn/freeze/waterlog/enchant
- habitat for insects/birds

### L8 Canopy / Overhead Layer

Purpose: large-scale occlusion, shadow, depth, and biome identity.

Asset families:

- canopy patches
- canopy edges
- canopy holes
- dense canopy tiles
- jungle canopy
- conifer canopy
- autumn canopy
- snow canopy
- swamp canopy
- mystic glowing canopy
- hanging moss canopy
- overhanging branches

Animations:

- slow canopy sway
- dappled light movement
- leaf fall
- rain drip
- snow fall from branches
- glow pulse

States:

- sparse
- medium
- dense
- seasonal color
- wet
- snow-covered
- burning
- burnt
- enchanted

Interactions:

- casts shadow
- reduces visibility
- affects lighting and temperature
- hides entities under canopy
- drops leaves/fruit/water/snow

### L9 Insects / Small Life

Purpose: living detail and ecological response layer.

Asset families:

- fireflies
- butterflies
- moths
- bees
- dragonflies
- ants
- beetles
- flies
- mosquitoes
- crickets
- glow bugs
- desert scarabs
- snow gnats
- cave bugs
- mystic sprites

Animations:

- idle crawl
- fly loop
- swarm loop
- scatter on player approach
- gather around flowers/light
- hide in grass

States:

- idle
- active
- fleeing
- swarming
- attracted
- sleeping
- enchanted
- poisoned

Interactions:

- flee from movement
- gather near flowers/water/light
- indicate biome health
- can be caught/harvested
- react to fire/smoke/cold/mystic

### L10 Terrain Forms / Elevation Geometry

Purpose: large visible structural forms beyond flat tiles.

Asset families:

- low slope
- high slope
- hill shoulder
- ridge crest
- valley floor
- cliff face
- cliff top edge
- cliff bottom edge
- overhang underside
- cave mouth
- natural bridge
- ravine edge
- plateau edge
- mountain slope
- mountain peak
- scree slope
- dune ridge
- dune slipface
- canyon wall
- riverbank cut
- waterfall edge
- snow cornice
- lava shelf
- mystic floating ledge

Animations:

- falling dust
- pebble trickle
- waterfall flow
- sand drift
- snow drift
- lava glow
- mystic levitation

States:

- stable
- cracked
- wet
- icy
- snow-covered
- eroded
- collapsed
- climbable
- overhanging
- bridged

Interactions:

- climb
- jump up/down
- glide down
- slide on steep slopes
- collision and occlusion
- line-of-sight blocking
- pathfinding cost

### L11 Water / Wetlands / Shoreline

Purpose: water bodies, moisture transitions, banks, mud, foam, and reflections.

Asset families:

- deep ocean
- ocean waves
- shallow water
- river flow
- lake still water
- swamp water
- puddles
- wet mud
- shoreline foam
- beach wetline
- riverbank reeds
- waterfall
- rapids
- ice sheets
- broken ice
- mystic shimmering water

Animations:

- wave loop
- flow loop
- foam loop
- ripple impact
- reflection shimmer
- ice crack shimmer
- mystic shimmer

States:

- calm
- windy
- flowing
- foamy
- muddy
- frozen
- thawing
- poisoned
- enchanted
- steaming

Interactions:

- blocks/permits movement depending depth
- swim/wade future
- waterlogs objects
- extinguishes fire
- freezes under cold
- reflects light
- forms mud/puddles nearby

### L12 Desert / Dunes / Drylands

Purpose: non-green biome identity with wind-shaped surfaces.

Asset families:

- sand base
- ripple sand
- dune crest
- dune shadow side
- dune slipface
- cracked dry pan
- salt flat
- desert scrub
- cactus
- bleached bones
- mirage shimmer
- wind dust
- sandstone rocks

Animations:

- wind sand drift
- dust devil
- heat shimmer
- cactus flower bloom

States:

- dry
- windblown
- scorched
- wet rare bloom
- mystic star sand
- ash-mixed

Interactions:

- slower uphill dune movement
- sliding on slipface
- footprints
- sand burial/uncovering
- heat effects

### L13 Mountains / Cliffs / Overhangs

Purpose: verticality, navigation, views, caves, and dramatic silhouettes.

Asset families:

- cliff wall tiles
- cliff cap tiles
- cliff foot tiles
- ledge tiles
- overhang shadow
- cave entrance
- ridge rocks
- mountain snow line
- alpine grass patches
- scree fields
- exposed strata
- climbing handholds
- rope/vine climb patches
- natural bridge
- ravine wall

Animations:

- dust fall
- snow gust
- waterfall/ice fall
- falling pebbles
- mystic floating stones

States:

- dry
- wet
- icy
- snow-covered
- cracked
- unstable
- climbable
- blocked
- collapsed
- enchanted

Interactions:

- climbable handholds/vines
- jump ledges
- glide from height
- fall damage later
- occlusion and shadows
- cave/subterranean transition

## 2. Biome-Specific Landscape Assemblies

Each biome selects a recipe from the same layer stack.

- deep_ocean: deep water, foam, kelp hints, wave glints, no soil, occasional rocks
- ocean: waves, foam, seaweed, driftwood near shore
- shallow_water: sand/silt below, reeds, ripples, shells
- beach: wet sand, dry sand, shells, driftwood, dunes, beach grass
- river: flow, river stones, reeds, muddy banks, foam
- lake: still water, reeds, lily pads, soft banks
- grassland: dirt/loam, grass, flowers, insects, shrubs, scattered trees
- forest: humus, moss, roots, leaf litter, underbrush, trees, canopy
- dense_forest: dark humus, thick roots, vines, fungi, dense trees, heavy canopy
- tropical_forest: wet humus, lianas, broad leaves, flowers, insects, jungle canopy
- taiga: needle duff, moss, conifers, snow patches, lichen
- savanna: dry grass, acacia, dust, termite mounds, sparse shrubs
- steppe: short grass, wind grass, stones, sparse flowers
- desert: sand, dunes, cracked pan, cactus, bones, heat shimmer
- swamp: mud, standing water, reeds, roots, moss, insects, cypress/mangrove
- tundra: frozen soil, lichen, snow clumps, low shrubs, ice rocks
- arctic: ice, snow, glacial stones, sparse life, wind snow
- hills: stony grass, shrubs, exposed stone, small cliffs, trees in pockets
- mountains: rock, scree, snowline, cliffs, ledges, caves, sparse alpine plants
- volcanic: basalt, ash, ember cracks, cinders, lava hints, heat shimmer
- mystic: aether moss, glowing grass, crystals, floating motes, enchanted trees

## 3. Required Transitions

Transitions are generated for every valid biome graph edge.

- terrain color/material blends
- ground cover blends
- vegetation density blends
- object mix blends
- shoreline/wetline blends
- snowline blends
- cliff cap/face/foot blends
- dune-to-rock blends
- forest-to-grass canopy thinning
- swamp-to-water mud/reed blends
- mystic enchantment bleed overlays

Transition asset types:

- edge N/E/S/W
- corner NE/NW/SE/SW
- diagonal feather
- sparse noise mask
- dense noise mask
- path/worn interruption
- elevation-aware transition
- waterline transition

## 4. Interaction State Cross Product

Every material family gets reactions to every element family. These are separate overlay sheets and can stack.

Materials:

- wood
- leaf
- grass
- flower
- soil
- mud
- sand
- stone
- crystal
- water
- ice
- metal
- cloth
- bone
- fungus

Elements:

- fire
- water
- ice
- cold
- mystic
- rot
- poison
- ash
- salt
- wind
- sun
- lightning
- impact
- cut
- trample
- dig

States examples:

- burning
- burnt
- charred
- smoking
- waterlogged
- dripping
- muddy
- frozen
- frosted
- shattered
- enchanted
- glowing
- rune-etched
- rotting
- poisoned
- ash-dusted
- salt-crusted
- windblown
- sunbaked
- cracked
- cut
- trampled
- dug

## 5. Animation Requirements

Every asset class must declare animation clips even if subtle.

Terrain:

- ambient idle
- wet shimmer
- wind overlay
- state pulse

Grass/foliage:

- idle sway
- contact bend
- recovery
- burn
- freeze
- enchant pulse

Trees/bushes/vines:

- idle sway
- contact rustle
- damage
- burning
- frozen shimmer
- enchanted pulse
- harvest/cut

Water:

- calm
- flow
- wave
- foam
- ripple
- frozen shimmer

Cliffs/mountains:

- dust trickle
- pebble fall
- snow gust
- lava glow
- mystic float

Insects:

- idle
- crawl/fly
- swarm
- flee
- attracted

## 6. Generation Scale

The target is tens or hundreds of thousands of frames, not a small demo set.

Approximate first complete pass:

- 21 biomes × 64 base tiles = 1,344 terrain base tiles
- 21 biomes × 8 micro rows × 8 frames = 1,344 micro overlays
- 21 biomes × 8 nature rows × 8 frames = 1,344 nature object frames
- 21 biomes × 8 building rows × 8 variants = 1,344 building material frames
- 15 materials × 16 elements × 8 frames = 1,920 reaction overlays
- 30 valid biome transitions × 8 transition masks × 8 variants = 1,920 transition frames
- 100 object archetypes × 16 states × 8 frames = 12,800 object-state frames
- 20 character body parts × 8 directions × 18 animations × 8 frames = 23,040 character component frames per body family

Expanded production target:

- multiple species per biome
- seasonal variants
- rare variants
- damage tiers
- wet/dry/frozen/burnt/mystic state overlays
- equipment layers
- NPC archetypes

This pushes into 100,000+ generated frames.
