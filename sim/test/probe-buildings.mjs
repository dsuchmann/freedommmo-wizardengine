// sim/test/probe-buildings.mjs — Phase A probe: ASCII footprints for first 15 types,
// verify all types generate without error.

import { BUILDING_TYPES } from '../world/buildings/taxonomy.js';
import { generateFootprint } from '../world/buildings/footprints.js';

const FEATURE_CHARS = {
  hearth: 'H', bed: 'B', table: 'T', storage: 'S', forge: 'F', anvil: 'A',
  workbench: 'W', counter: 'C', altar: 'a', throne: 'K', chair: 'c',
  bookshelf: 'b', bench: 'n', barrel: 'r', oven: 'O', kiln: 'k',
  loom: 'L', cauldron: 'u', vat: 'V', furnace: 'f', millstone: 'm',
  planter: 'P', trough: 't', hive: 'h', press: 'p', pool: 'o',
  well: 'w', fountain: 'J', statue: 'X', cell: 'l', lamp: 'i',
  reservoir: 'R', stage: 'G', target: 'g', rack: 'q', ladder: 'd',
  portcullis: 'E', bollard: 'e', waystone: 'y', crystal: 'Z',
  lava_channel: 'v', root_throne: 'z', garden_bed: 'N', gate: 'I',
  headstone: '+', candelabra: '|', shelf: 's', sawbuck: 'x',
  fur_rack: 'U', hive_frame: 'j',
};

function renderASCII(fp) {
  const { boundingBox: bb, walls, doors, floors, features } = fp;
  // Build grid
  const grid = [];
  for (let y = 0; y < bb.h; y++) {
    grid.push(new Array(bb.w).fill(' '));
  }
  // floors
  for (const f of floors) grid[f.y - bb.y0][f.x - bb.x0] = '.';
  // walls
  for (const w of walls) grid[w.y - bb.y0][w.x - bb.x0] = '#';
  // doors
  for (const d of doors) grid[d.y - bb.y0][d.x - bb.x0] = 'D';
  // features
  for (const f of features) {
    const ch = FEATURE_CHARS[f.type] ?? '?';
    grid[f.y - bb.y0][f.x - bb.x0] = ch;
  }
  return grid.map(row => row.join('')).join('\n');
}

// ── run ───────────────────────────────────────────────────────────────

const allIds = Object.keys(BUILDING_TYPES);
const first15 = allIds.slice(0, 15);
let errors = 0;

console.log('=== Phase A Probe: Building Footprints ===\n');

// Print ASCII for first 15
for (const id of first15) {
  const fp = generateFootprint(42, id);
  if (!fp) { console.error(`FAIL: ${id} returned null`); errors++; continue; }
  console.log(`--- ${fp.typeName} (${id}) [${fp.pattern}] ${fp.boundingBox.w}x${fp.boundingBox.h} ---`);
  console.log(renderASCII(fp));
  console.log(`  walls=${fp.walls.length} doors=${fp.doors.length} floors=${fp.floors.length} features=${fp.features.length}`);
  console.log();
}

// Verify ALL types generate without error
console.log(`\nVerifying all ${allIds.length} types...`);
for (const id of allIds) {
  try {
    const fp = generateFootprint(42, id);
    if (!fp) { console.error(`  FAIL: ${id} returned null`); errors++; }
  } catch (e) {
    console.error(`  ERROR: ${id} — ${e.message}`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`\n${errors} error(s)`);
  process.exit(1);
} else {
  console.log(`All ${allIds.length} types OK.`);
  process.exit(0);
}
