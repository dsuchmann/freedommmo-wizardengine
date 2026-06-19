// sim/world/buildings/floor-materials.js — deterministic floor material per floor USE so
// different floors read distinctly (lobby marble, shop stone, residential wood, storage dirt,
// crypt stone). Pure, cheap (no room materialization). Consumed by the floor node payload,
// resolveFloorLayout, the interior renderer, and (eventually) the worker floor bake.

const BY_USE = {
  lobby: 'wood_plank', common: 'wood_plank', // houses/apartments enter on a homey wood floor, not white marble
  hall: 'marble', gallery: 'marble', religious: 'marble', // grand civic floors keep marble
  shopfront: 'stone_slab', commercial: 'stone_slab', shop: 'stone_slab', market: 'stone_slab', craft: 'stone_slab',
  residential: 'wood_plank', apartment: 'wood_plank', mixed: 'wood_plank',
  storage: 'packed_dirt',
  crypt: 'stone_slab',
};

/** Floor material id for a floor's use (one of the loaded floor materials). Falls back to wood_plank. */
export function floorMaterial(use) {
  return BY_USE[use] || 'wood_plank';
}

export { BY_USE };
