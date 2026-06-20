// sim/world/buildings/tenancy.js
// Supply-side OCCUPANCY: a building offers TENANCIES — coherent occupiable spaces, each ownable
// by one occupant. A tenancy may span floors (a shop with storage/flat above is ONE tenancy).
// This is the durable supply interface the atlas declared (occupancySlots); the demand side
// (occupancy-provider.js now, Society later) fills it. Pure f(node).
import { resolveFloorLayout } from './floor-layout.js';

// Building categories whose ground/work/storage floors fold into ONE primary tenancy (a business
// or institution that may span floors). Purely-residential categories have no primary — every
// unit is its own household.
const PRIMARY_CATEGORIES = new Set([
  'commercial', 'market', 'craft', 'civic', 'religious', 'military', 'agricultural',
  'entertainment', 'infrastructure',
]);

function kindForPrimary(category) {
  if (category === 'religious') return 'religious';
  if (category === 'civic' || category === 'military') return 'institution';
  if (category === 'craft') return 'workshop';
  return 'shop';
}
function unitTiles(units) { let n = 0; for (const u of units) n += u.tiles.length; return n; }

// Derive the building's tenancies from its floor stack + per-floor units. Pure.
export function buildingTenancies(buildingNode) {
  const category = buildingNode.ancestorContext?.category || 'residential';
  const [minF, maxF] = buildingNode.payload.floorRange;
  const primaryBuilding = PRIMARY_CATEGORIES.has(category);
  const tenancies = [];
  const primaryFloors = [], primaryUnitIds = []; let primaryUnits = [];

  for (let fi = minF; fi <= maxF; fi++) {
    const layout = resolveFloorLayout(buildingNode, fi);
    const isResidentialFloor = layout.use === 'residential';
    if (primaryBuilding && !isResidentialFloor) {
      primaryFloors.push(fi);
      for (const u of layout.units) { primaryUnitIds.push(u.id); primaryUnits.push(u); }
    } else {
      for (const u of layout.units) {
        tenancies.push({
          id: `${buildingNode.id}/t/${tenancies.length + 1}`,
          kind: 'household', floors: [fi], unitIds: [u.id],
          minTiles: u.tiles.length, slots: { home: 1, work: 0 },
        });
      }
    }
  }
  if (primaryFloors.length) {
    tenancies.unshift({
      id: `${buildingNode.id}/t/0`,
      kind: kindForPrimary(category),
      floors: primaryFloors.slice(), unitIds: primaryUnitIds.slice(),
      minTiles: unitTiles(primaryUnits),
      slots: { home: 0, work: Math.max(1, Math.round(unitTiles(primaryUnits) / 12)) },
    });
  }
  return tenancies;
}
