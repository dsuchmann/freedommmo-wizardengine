import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specializeBuilding } from '../world/buildings/specializations.js';
import { occupancyProvider } from '../world/buildings/occupancy-provider.js';

test('specializeBuilding returns supply only (no occupant brand/owner)', () => {
  const r = specializeBuilding(42, 'blacksmith', 'town', new Set());
  assert.ok('specialization' in r && 'inventory' in r, 'has supply fields');
  assert.ok(!('brand' in r) && !('owner' in r), 'no demand fields leaked from supply');
});

test('occupancyProvider is deterministic and swap-isolated', () => {
  const a = occupancyProvider(42, '100,200', 'weaponsmith');
  const b = occupancyProvider(42, '100,200', 'weaponsmith');
  assert.deepEqual(a, b, 'deterministic');
  assert.ok(a.name && a.owner && a.kind === 'weaponsmith', 'shape');
  const c = occupancyProvider(42, '101,200', 'weaponsmith');
  assert.notDeepEqual(a, c, 'different building key → different occupant');
});
