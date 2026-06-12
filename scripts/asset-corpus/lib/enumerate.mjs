// Pure count math over one registry object. No I/O.

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
  const tilesets = reg.materials.length * reg.biomes.length;
  return {
    id: reg.id, status: reg.status, plan: reg.consuming_plan,
    instances: tilesets, tilesets,
    baseSprites: 0, stateSprites: 0, animJobs: 0,
    totalSprites: tilesets * 25 * (reg.variants ?? 1), // wang_100 = 25 tiles/set
  };
}
