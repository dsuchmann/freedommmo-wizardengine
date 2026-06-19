// sim/world/buildings/facade.js — per-FLOOR exterior façade band for the multi-story wall
// stacker (the "5-story looks 5-story" feature). Each ABOVE-ground story gets a band: its
// window style (from the floor's use) + whether it carries the ground entrance. Pure; derived
// from the building payload's stackPlan + aboveGroundFloors. Consumed by the exterior wall
// bake — see docs/superpowers/2026-06-18-exterior-facade-stacking-contract.md.

const WINDOW_BY_USE = {
  shopfront: 'shop', commercial: 'shop', market: 'shop', craft: 'shop', shop: 'shop',
  lobby: 'grand', hall: 'grand',
  gallery: 'arched', religious: 'arched',
  residential: 'residential', apartment: 'residential', mixed: 'residential',
  storage: 'slit',
  crypt: 'none',
};

/** Window style for a floor use (drives which wall window sprite the stacker uses per story). */
export function windowStyle(use) { return WINDOW_BY_USE[use] || 'plain'; }

/**
 * Per ABOVE-ground story façade bands, bottom→top (story 0 = ground, carries the door).
 * Basements (index < 0) are below grade and excluded — they don't appear on the exterior.
 * @param {{ aboveGroundFloors:number, stackPlan:[{index,use}] }} payload  building node payload
 * @returns {Array<{ index:number, use:string, window:string, door:boolean }>}
 */
export function facadeBands(payload) {
  const bands = [];
  const n = Math.max(0, payload.aboveGroundFloors | 0);
  for (let i = 0; i < n; i++) {
    const use = (payload.stackPlan.find(s => s.index === i) || {}).use || 'residential';
    bands.push({ index: i, use, window: windowStyle(use), door: i === 0 });
  }
  return bands;
}

export { WINDOW_BY_USE };
