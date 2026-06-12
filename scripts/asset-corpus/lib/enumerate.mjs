// Pure count math over one registry object. No I/O.

const WANG_TILESET_TILES = 25; // a wang_100 tileset is 25 tiles

export function enumerateRegistry(reg) {
  if (reg.category === 'object') return enumerateObject(reg);
  if (reg.category === 'matrix') return enumerateMatrix(reg);
  if (reg.category === 'wang') return enumerateWang(reg);
  throw new Error(`${reg.id}: unknown category ${reg.category}`);
}

function instancesOf(reg) {
  // one instance per (archetype, biome) pair — F4 disk convention <biome>/<archetype>/
  return reg.archetypes.flatMap((a) => a.biomes.map((b) => ({ ...a, biome: b })));
}

function enumerateObject(reg) {
  const inst = instancesOf(reg);
  const stateNames = Object.keys(reg.states ?? {});
  const fruitNames = Object.keys(reg.fruit_states ?? {});
  const stateJobs = inst.length * stateNames.length
    + inst.filter((i) => i.fruit).length * fruitNames.length;
  const animStates = reg.anim?.states?.length ?? 0;
  // animJobs counts animation API jobs (one job animates one instance), NOT output sprite frames.
  return {
    id: reg.id, status: reg.status, plan: reg.consuming_plan,
    instances: inst.length,
    baseSprites: inst.length * reg.variants,
    stateSprites: stateJobs * reg.variants,
    animJobs: inst.length * animStates,
    totalSprites: inst.length * reg.variants + stateJobs * reg.variants,
  };
}

function enumerateMatrix(reg) {
  const instances = Object.values(reg.axes).reduce((p, n) => p * n, 1);
  return {
    id: reg.id, status: reg.status, plan: reg.consuming_plan,
    instances, baseSprites: instances * reg.variants, stateSprites: 0,
    animJobs: 0, totalSprites: instances * reg.variants,
  };
}

function enumerateWang(reg) {
  // tilesets is an intentional wang-only semantic alias of instances; object/matrix results omit it.
  const tilesets = reg.materials.length * reg.biomes.length;
  return {
    id: reg.id, status: reg.status, plan: reg.consuming_plan,
    instances: tilesets, tilesets,
    baseSprites: 0, stateSprites: 0, animJobs: 0,
    totalSprites: tilesets * WANG_TILESET_TILES * (reg.variants ?? 1),
  };
}

// Resolves a derived registry's archetypes from its derive_from source.
// POLICY: derived registries never inherit the fruit axis (fruit forced false) —
// per the asset-state taxonomy, F7 canopy overlays carry no yield states; the
// trunk (F6) owns budding/fruiting/harvested. If a future deriver needs fruit
// inheritance, make this opt-in via a registry flag rather than changing the default.
export function resolveDerived(reg, registryById) {
  if (!reg.derive_from) return reg;
  const src = registryById[reg.derive_from];
  if (!src) throw new Error(`${reg.id}: derive_from ${reg.derive_from} not found`);
  const exclude = new Set(reg.derive_exclude ?? []);
  return {
    ...reg,
    archetypes: src.archetypes
      .filter((a) => !exclude.has(a.name))
      .map((a) => ({ name: a.name, desc: a.desc, biomes: a.biomes, fruit: false })),
  };
}
