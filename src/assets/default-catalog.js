import { AssetCatalog } from './asset-catalog.js';
import { DIRECTIONS_8, DIRECTION_OMNI, defaultPhysics, defaultRender, idleAnimation, rectCollision, circleCollision, stateAnimation, staticAnimation } from './asset-metadata.js';

const terrain = {
  domain: 'terrain',
  tileSize: [32, 32],
  assets: [
    terrainAsset('grassland_ground', ['grassland', 'savanna', 'steppe', 'mystic'], ['base', 'micro_grass', 'flowers', 'dirt_scars', 'wet_overlay', 'mystic_overlay', 'shadow_mask'], {
      states: ['default', 'wet', 'dry', 'frozen', 'fae_bloom', 'enchanted'],
      animations: { ambient: idleAnimation({ frames: 8, fps: 3, directions: DIRECTION_OMNI, layers: ['micro_grass', 'flowers', 'mystic_overlay'] }) }
    }),
    terrainAsset('forest_floor', ['forest', 'dense_forest', 'taiga', 'tropical_forest'], ['base', 'leaf_litter', 'roots', 'moss', 'fungi', 'shadow_mask']),
    terrainAsset('sand_ground', ['beach', 'desert'], ['base', 'grain', 'ripple', 'pebbles', 'shells', 'shadow_mask']),
    terrainAsset('stone_ground', ['hills', 'mountains', 'volcanic', 'tundra', 'arctic'], ['base', 'strata', 'cracks', 'pebbles', 'snow_overlay', 'shadow_mask']),
    terrainAsset('water_surface', ['deep_ocean', 'ocean', 'shallow_water', 'river', 'lake', 'swamp', 'stream'], ['base', 'flow', 'sparkle', 'foam', 'depth_shadow', 'moon_reflection'], {
      animations: {
        calm: stateAnimation(8, 6, true, DIRECTION_OMNI, ['flow', 'sparkle']),
        wind: stateAnimation(12, 10, true, DIRECTIONS_8, ['flow', 'foam', 'sparkle']),
        frozen: staticAnimation({ frames: 4, fps: 1, layers: ['base', 'depth_shadow'] })
      },
      physics: defaultPhysics({ body: 'fluid', material: 'water', blocksMovement: true }),
      collision: [rectCollision(0, 0, 32, 32, 'water')],
      render: defaultRender({ drawLayer: 'terrain', sort: 'fixed', castsShadow: false, receivesLight: true, heightClass: 'flat' })
    }),
    terrainAsset('cliff_wall', ['hills', 'mountains', 'volcanic', 'tundra', 'arctic', 'forest'], ['wall_base', 'strata', 'ledge', 'cracks', 'moss', 'shadow_mask', 'overhang_shadow'], {
      physics: defaultPhysics({ body: 'static', material: 'stone', mass: 999, blocksMovement: true, climbable: true }),
      collision: [rectCollision(0, 10, 32, 22, 'cliff')],
      render: defaultRender({ drawLayer: 'object', sort: 'elevationThenY', castsShadow: true, receivesLight: true, occluder: true, heightClass: 'cliff' })
    })
  ]
};

const vegetation = {
  domain: 'vegetation',
  assets: [
    objectAsset('broadleaf_tree', 'vegetation.tree', ['forest', 'dense_forest', 'grassland', 'hills', 'mystic'], [1, 2], ['shadow', 'trunk', 'branches', 'canopy', 'fruit', 'vine', 'season_overlay', 'damage_overlay', 'snow_overlay', 'mystic_overlay', 'lighting_mask'], {
      states: ['sapling', 'mature', 'ancient', 'spring', 'summer', 'autumn', 'winter', 'cut', 'burnt', 'charred', 'dead', 'wet', 'waterlogged', 'frozen', 'frosted', 'enchanted', 'glowing', 'wind'],
      animations: treeAnimations(['trunk', 'branches', 'canopy', 'fruit', 'vine', 'season_overlay', 'damage_overlay']),
      physics: defaultPhysics({ body: 'static', material: 'wood', mass: 80, blocksMovement: true, blocksProjectiles: true, climbable: true }),
      collision: [circleCollision(16, 27, 8, 'trunk'), rectCollision(4, 4, 24, 22, 'canopy_soft')],
      render: defaultRender({ drawLayer: 'canopy', sort: 'elevationThenY', castsShadow: true, receivesLight: true, occluder: true, heightClass: 'canopy' })
    }),
    objectAsset('conifer_tree', 'vegetation.tree', ['taiga', 'tundra', 'mountains', 'forest'], [1, 2], ['shadow', 'trunk', 'needle_body', 'snow_overlay', 'damage_overlay', 'lighting_mask'], {
      states: ['sapling', 'mature', 'ancient', 'snow', 'cut', 'burnt', 'dead', 'wet', 'wind'],
      animations: treeAnimations(['trunk', 'needle_body', 'snow_overlay', 'damage_overlay']),
      physics: defaultPhysics({ body: 'static', material: 'wood', mass: 70, blocksMovement: true, blocksProjectiles: true, climbable: true }),
      collision: [circleCollision(16, 28, 7, 'trunk'), rectCollision(6, 2, 20, 28, 'canopy_soft')],
      render: defaultRender({ drawLayer: 'canopy', sort: 'elevationThenY', castsShadow: true, receivesLight: true, occluder: true, heightClass: 'canopy' })
    }),
    objectAsset('underbrush_cluster', 'vegetation.underbrush', ['grassland', 'forest', 'dense_forest', 'tropical_forest', 'swamp', 'savanna', 'steppe'], [1, 1], ['shadow', 'stems', 'leaves', 'flowers', 'seed_heads', 'wet_overlay', 'lighting_mask'], {
      states: ['spring', 'summer', 'autumn', 'winter', 'trampled', 'cut', 'wet', 'dry', 'wind'],
      animations: {
        idle: idleAnimation({ frames: 4, fps: 2, directions: DIRECTION_OMNI, layers: ['stems', 'leaves', 'flowers'] }),
        wind: stateAnimation(8, 8, true, DIRECTIONS_8, ['stems', 'leaves', 'flowers'])
      },
      physics: defaultPhysics({ body: 'static', material: 'foliage', mass: 2, blocksMovement: false }),
      collision: [rectCollision(5, 20, 22, 9, 'soft')],
      render: defaultRender({ drawLayer: 'object', sort: 'y', castsShadow: true, receivesLight: true, occluder: false, heightClass: 'knee' })
    })
  ]
};

const geology = {
  domain: 'geology',
  assets: [
    objectAsset('boulder_cluster', 'geology.rock', ['hills', 'mountains', 'volcanic', 'tundra', 'arctic', 'desert', 'grassland'], [1, 1], ['shadow', 'base', 'strata', 'cracks', 'moss', 'lichen', 'snow_overlay', 'lighting_mask'], {
      states: ['bare', 'mossy', 'snow', 'wet', 'cracked', 'ore_vein'],
      animations: { idle: staticAnimation({ frames: 4, fps: 1, directions: DIRECTION_OMNI, layers: ['base', 'strata', 'cracks'] }) },
      physics: defaultPhysics({ body: 'static', material: 'stone', mass: 120, blocksMovement: true, blocksProjectiles: true, climbable: false }),
      collision: [circleCollision(16, 23, 10, 'solid')],
      render: defaultRender({ drawLayer: 'object', sort: 'elevationThenY', castsShadow: true, receivesLight: true, occluder: true, heightClass: 'knee' })
    }),
    objectAsset('cave_mouth', 'geology.cave', ['hills', 'mountains', 'volcanic', 'forest', 'tundra'], [2, 2], ['shadow', 'opening', 'rim', 'stalactites', 'loose_rocks', 'moss', 'subsurface_glow', 'lighting_mask'], {
      states: ['open', 'hidden', 'collapsed', 'wet', 'snow', 'occupied', 'lit'],
      animations: {
        open: stateAnimation(6, 3, true, DIRECTION_OMNI, ['opening', 'subsurface_glow']),
        collapsed: staticAnimation({ frames: 3, fps: 1, layers: ['rim', 'loose_rocks'] })
      },
      physics: defaultPhysics({ body: 'portal', material: 'stone', mass: 999, blocksMovement: false }),
      collision: [rectCollision(6, 30, 52, 18, 'portal'), rectCollision(0, 12, 64, 20, 'rock_rim')],
      render: defaultRender({ drawLayer: 'object', sort: 'elevationThenY', castsShadow: true, receivesLight: true, occluder: true, heightClass: 'cliff' })
    }),
    objectAsset('dry_riverbed', 'geology.pathway', ['grassland', 'savanna', 'steppe', 'desert', 'hills', 'forest'], [1, 1], ['base', 'silt', 'pebbles', 'roots', 'cracked_mud', 'shadow_mask'], {
      states: ['dry', 'muddy', 'flash_flood', 'overgrown', 'snow'],
      animations: { dry: staticAnimation({ frames: 8, fps: 1, directions: DIRECTIONS_8, layers: ['base', 'silt', 'pebbles'] }) },
      physics: defaultPhysics({ body: 'decal', material: 'silt', mass: 0, blocksMovement: false }),
      collision: [],
      render: defaultRender({ drawLayer: 'decal', sort: 'fixed', castsShadow: false, receivesLight: true, occluder: false, heightClass: 'flat' })
    })
  ]
};

function terrainAsset(id, biomes, layers, overrides = {}) {
  return {
    id,
    category: id === 'water_surface' ? 'terrain.water' : id === 'cliff_wall' ? 'terrain.elevation' : 'terrain.ground',
    biomes,
    sizeTiles: [1, 1],
    layers,
    states: overrides.states ?? ['default', 'wet', 'dry', 'snow', 'night', 'dawn', 'dusk'],
    directions: overrides.directions ?? DIRECTION_OMNI,
    animations: overrides.animations ?? { idle: staticAnimation({ frames: 8, fps: 1, directions: DIRECTION_OMNI, layers }) },
    variants: { base: 64, detail: 128, palette: 24 },
    anchors: { tile: [16, 16], shadow: [16, 28] },
    physics: overrides.physics ?? defaultPhysics({ body: 'static', material: 'ground', blocksMovement: false }),
    collision: overrides.collision ?? [],
    render: overrides.render ?? defaultRender({ drawLayer: 'terrain', sort: 'fixed', castsShadow: false, receivesLight: true, heightClass: 'flat' }),
    generation: { promptFamily: 'terrain-ground', priority: 1 }
  };
}

function objectAsset(id, category, biomes, sizeTiles, layers, overrides = {}) {
  return {
    id,
    category,
    biomes,
    sizeTiles,
    layers,
    states: overrides.states ?? ['default'],
    directions: overrides.directions ?? DIRECTIONS_8,
    animations: overrides.animations ?? { idle: idleAnimation({ layers }) },
    variants: { base: 64, detail: 96, palette: 24, silhouette: 32 },
    anchors: overrides.anchors ?? { root: [16, 28], shadow: [16, 30] },
    physics: overrides.physics ?? defaultPhysics(),
    collision: overrides.collision ?? [],
    render: overrides.render ?? defaultRender(),
    generation: { promptFamily: category, priority: 2 }
  };
}

function treeAnimations(layers) {
  return {
    idle: idleAnimation({ frames: 6, fps: 2, directions: DIRECTION_OMNI, layers }),
    wind: stateAnimation(12, 8, true, DIRECTIONS_8, layers, [{ frame: 4, event: 'leaf_rustle' }]),
    chop: stateAnimation(6, 10, false, DIRECTIONS_8, ['trunk', 'branches', 'damage_overlay'], [{ frame: 3, event: 'wood_hit' }]),
    fall: stateAnimation(10, 12, false, DIRECTIONS_8, layers, [{ frame: 8, event: 'impact' }]),
    burn: stateAnimation(16, 8, true, DIRECTION_OMNI, [...layers, 'damage_overlay'], [{ frame: 2, event: 'ember' }])
  };
}

export const defaultAssetCatalog = new AssetCatalog([terrain, vegetation, geology]);
