// sim/world/buildings/occupancy-provider.js
// DEMAND-side placeholder: assigns a nominal occupant (a household / business name + owner) to a
// tenancy. This is the bootstrap the Society system replaces later — same interface, real reasons.
// Pure f(seed, buildingKey, tenancyKind). NO simulation; honest-absence semantics: the name is a
// declared placeholder over the building's real occupancy capacity, never a faked NPC.
import { generateBrand } from './specializations.js';

export function occupancyProvider(seed, buildingKey, tenancyKind) {
  const brand = generateBrand(seed, String(buildingKey), String(tenancyKind));
  return { name: brand.name, owner: brand.owner, kind: tenancyKind };
}
