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

// Single-family dwelling types: the WHOLE building is ONE household, regardless of how many
// rooms/units the floor partition produced (a longhouse is one extended family, not 14 flats).
// Multi-family types (apartment, manor, villa) keep per-unit households.
const SINGLE_FAMILY = new Set(['hut', 'cottage', 'house', 'longhouse']);

function kindForPrimary(category) {
  if (category === 'religious') return 'religious';
  if (category === 'civic' || category === 'military') return 'institution';
  if (category === 'craft') return 'workshop';
  return 'shop';
}
function unitTiles(units) { let n = 0; for (const u of units) n += u.tiles.length; return n; }

// Derive the building's tenancies from its floor stack + per-floor units. Pure.
export function buildingTenancies(buildingNode) {
  const ctx = buildingNode.ancestorContext || {};
  const category = ctx.category || 'residential';
  const [minF, maxF] = buildingNode.payload.floorRange;
  const primaryBuilding = PRIMARY_CATEGORIES.has(category);
  const singleFamily = SINGLE_FAMILY.has(ctx.typeId);
  const tenancies = [];
  const primaryFloors = [], primaryUnitIds = []; let primaryUnits = [];
  const famFloors = [], famUnitIds = []; let famUnits = [];

  for (let fi = minF; fi <= maxF; fi++) {
    const layout = resolveFloorLayout(buildingNode, fi);
    const isResidentialFloor = layout.use === 'residential';
    if (primaryBuilding && !isResidentialFloor) {
      primaryFloors.push(fi);
      for (const u of layout.units) { primaryUnitIds.push(u.id); primaryUnits.push(u); }
    } else if (singleFamily) {
      // one household across the whole dwelling (all its floors + units)
      famFloors.push(fi);
      for (const u of layout.units) { famUnitIds.push(u.id); famUnits.push(u); }
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
  if (famFloors.length) {
    tenancies.push({
      id: `${buildingNode.id}/t/h`,
      kind: 'household', floors: famFloors.slice(), unitIds: famUnitIds.slice(),
      minTiles: unitTiles(famUnits), slots: { home: 1, work: 0 },
    });
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
