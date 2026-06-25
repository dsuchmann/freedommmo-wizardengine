// src/render/building-render-flags.js
//
// MASTER SWITCH for the building ASSEMBLY layer — everything that composites building PIXELS into
// the world: exterior walls (tile-corpus + legacy), procedural roof, ground shadow, depth/occlusion
// see-through, and the diegetic walk-in interior. With every flag false, buildings are HONESTLY
// ABSENT in the world (the no-mock "a system may be ABSENT but never FAKE" state).
//
// This deliberately does NOT touch building GENERATION. Footprints, placement, shape, metadata,
// doors[], windows[], wallSlug, biome and floor counts all still compute; overmap/minimap metadata
// markers still draw. The buildings exist — they just don't render into the world yet.
//
// We re-enable ONE layer at a time, together, by flipping its sub-flag (and `master`). Live-toggle
// from the dev console, e.g.:  window._buildingRender.master = true; window._buildingRender.walls = true;
//
// renderOn(layer) is the single authority every pixel-producer checks at its top, so NO caller —
// known or hidden — can draw a building while the switch is off.

// LAYER-BY-LAYER REBUILD STATE: master is ON, and we turn layers back one at a time.
// Currently re-enabled: interior (diegetic walk-in + stairs/floors). Everything else stays OFF,
// so the outdoor world is still clean — buildings are invisible from outside, but stepping onto a
// building footprint takes you into the rendered interior (dim world + floor + walls + stair markers).
export const BUILDING_RENDER = {
  master: true,     // master ON — sub-flags below pick which layers actually draw
  walls: true,      // ON — exterior mirror-tiled tile-corpus walls (fieldstone pilot is round-2 complete)
  roof: true,       // ON — procedural roof, flows through the per-object depth pass (renderBuildingSilhouette)
  weathering: true, // ON — D0 dressing: procedural ground-grime + tonal weathering on south wall columns
  attachments: true,// ON — D3 dressing: wall-attachment props (pilot: candle lantern at beside_door sockets)
  shadow: true,     // ground shadows (building-shadow) — the MASK still builds, only pixels gated
  occlusion: false, // depth-occlusion A/B pass (building-depth) — player see-through
  doors: false,     // swinging door-leaf overlay (door-leaves)
  interior: true,   // ON — diegetic walk-in interior floor + walls + stairs (interior-renderer / interior-gl)
  // NOTE: the building FLOOR + foundation-border bake lives OFF-THREAD in the chunk worker
  // (worker-chunk-renderer.js), which cannot read window. It is gated there on `self._buildingFloors`
  // (unset => off). Re-enabling that layer means threading this flag through the chunk job.
  floors: false,    // mirror of the worker-side self._buildingFloors (documentation only here)
};

if (typeof window !== 'undefined') {
  window._buildingRender = window._buildingRender || BUILDING_RENDER;
}

/** True only when the master switch AND the named layer are both on. Reads the live window object so
 *  console toggles take effect without a reload. */
export function renderOn(layer) {
  const f = (typeof window !== 'undefined' && window._buildingRender) || BUILDING_RENDER;
  return !!(f.master && f[layer]);
}

/** True when the whole assembly is off — buildings should render nothing at all. */
export function buildingsRenderDisabled() {
  const f = (typeof window !== 'undefined' && window._buildingRender) || BUILDING_RENDER;
  return !f.master;
}
