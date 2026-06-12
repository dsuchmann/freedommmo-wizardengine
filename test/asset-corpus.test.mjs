import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enumerateRegistry, resolveDerived } from '../scripts/asset-corpus/lib/enumerate.mjs';
import { emitBatch, emitPilotBatch } from '../scripts/asset-corpus/lib/emit.mjs';

const FIXTURE = {
  id: 'fixture_flora',
  consuming_plan: 'TEST',
  status: 'armed',
  category: 'object',
  size: 64,
  variants: 64,
  output_root: 'assets/test/fixture',
  prompt_template: 'pixel art {desc}, test style',
  archetypes: [
    { name: 'rose', desc: 'red rose bush', biomes: ['forest'], fruit: false },
    { name: 'apple', desc: 'apple tree', biomes: ['forest', 'grassland'], fruit: true },
  ],
  states: { wilting: 'wilting version', dead: 'dead version' },
  fruit_states: { fruiting: 'laden with fruit' },
  anim: { states: ['base'], action: 'swaying', frames: 8 },
};

test('object enumeration: base + states + fruit states, per biome-instance', () => {
  const r = enumerateRegistry(FIXTURE);
  // rose: 1 biome -> 1 instance; apple: 2 biomes -> 2 instances = 3 instances
  // each instance: 1 base + 2 states; apple instances add 1 fruit state
  assert.equal(r.instances, 3);
  assert.equal(r.baseSprites, 3 * 64);
  assert.equal(r.stateSprites, (3 * 2 + 2 * 1) * 64); // 8 state-jobs x 64
  assert.equal(r.animJobs, 3); // anim on base, per instance
  assert.equal(r.totalSprites, r.baseSprites + r.stateSprites);
});

test('matrix enumeration: pure product of axes', () => {
  const m = enumerateRegistry({
    id: 'fixture_matrix', consuming_plan: 'TEST', status: 'dormant',
    category: 'matrix', size: 64, variants: 64,
    axes: { parts: 13, directions: 4, races: 6, body_types: 3, age_bands: 3 },
  });
  assert.equal(m.instances, 13 * 4 * 6 * 3 * 3);
  assert.equal(m.totalSprites, 13 * 4 * 6 * 3 * 3 * 64);
});

test('wang enumeration: materials x biomes tilesets', () => {
  const w = enumerateRegistry({
    id: 'fixture_wang', consuming_plan: 'TEST', status: 'armed',
    category: 'wang', tile_size: 32, variants: 1,
    materials: [{ name: 'dirt_road', desc: 'packed dirt road' }],
    biomes: ['forest', 'desert', 'taiga'],
  });
  assert.equal(w.tilesets, 3);
  assert.equal(w.totalSprites, 3 * 25); // wang_100 set = 25 tiles
});

test('enumeration is deterministic', () => {
  assert.deepEqual(enumerateRegistry(FIXTURE), enumerateRegistry(FIXTURE));
});

function loadReg(name) {
  return JSON.parse(readFileSync(new URL(`../scripts/asset-corpus/registry/${name}.json`, import.meta.url), 'utf8'));
}

test('f6_trees enumerates the W2 burst', () => {
  const r = enumerateRegistry(loadReg('f6_trees'));
  // 18 archetypes expand to 24 (archetype,biome) instances — multi-biome
  // archetypes count once per biome (e.g. oak appears in forest AND grassland).
  assert.equal(r.instances, 24);
  assert.equal(r.baseSprites, 24 * 64);
  // 7 universal states x 24 + 3 fruit states x fruit instances (apple:2, banana_palm:1, cherry:1 = 4)
  assert.equal(r.stateSprites, (24 * 7 + 4 * 3) * 64);
  assert.equal(r.animJobs, 24);
});

test('f7 derives archetypes from f6 minus exclusions', () => {
  const f6 = loadReg('f6_trees');
  const f7 = resolveDerived(loadReg('f7_canopies'), { f6_trees: f6 });
  assert.equal(f7.archetypes.length, f6.archetypes.length - 1); // bald_cypress excluded
  assert.ok(f7.archetypes.every((a) => a.fruit === false)); // canopies carry no fruit axis
  const r = enumerateRegistry(f7);
  assert.equal(r.instances, 24 - 1); // bald_cypress was swamp-only: 1 instance dropped
});

test('emitBatch produces create/state/anim jobs for an armed object registry', () => {
  const f6 = loadReg('f6_trees');
  const batch = emitBatch(f6, {});
  assert.equal(batch.burst, 'w2-f6_trees');
  assert.equal(batch.gate, 'armed');
  const byKind = (k) => batch.jobs.filter((j) => j.kind === k);
  assert.equal(byKind('create').length, 24);
  assert.equal(byKind('state').length, 24 * 7 + 4 * 3);
  assert.equal(byKind('anim').length, 24);
  const oak = byKind('create').find((j) => j.id === 'forest/oak');
  assert.equal(oak.size, 192);
  assert.equal(oak.keep, 64);
  assert.equal(oak.calls, 16);
  assert.equal(oak.candidates, 4);
  assert.match(oak.prompt, /mighty oak tree/);
  assert.match(oak.prompt, /Final Fantasy aesthetic/);
  assert.equal(oak.out, 'assets/pixelab/landscape_v2/micro/large_flora/forest/oak');
  const st = byKind('state').find((j) => j.id === 'forest/oak/stump');
  assert.equal(st.parent, 'forest/oak');
  assert.equal(st.pool, 64);
  assert.match(st.edit, /growth rings/);
  const an = byKind('anim').find((j) => j.id === 'forest/oak/wind_sway');
  assert.equal(an.frames, 8);
});

test('emitBatch is deterministic (stable job order)', () => {
  const f6 = loadReg('f6_trees');
  assert.deepEqual(emitBatch(f6, {}), emitBatch(f6, {}));
});

test('emitBatch refuses dormant registries', () => {
  assert.throws(() => emitBatch({ ...loadReg('f6_trees'), status: 'dormant' }, {}),
    /dormant/);
});

test('roads pilot batch is the declared 1x3 subset', () => {
  const roads = loadReg('roads_wang');
  const pilot = emitPilotBatch(roads, {});
  assert.equal(pilot.burst, 'p2-roads_wang-pilot');
  assert.equal(pilot.gate, 'pilot');
  assert.equal(pilot.jobs.length, 3);
  assert.ok(pilot.jobs.every((j) => j.kind === 'wang' && j.tile_size === 32));
  assert.deepEqual(pilot.jobs.map((j) => j.id).sort(),
    ['dirt_road__desert', 'dirt_road__grassland', 'dirt_road__taiga']);
});

test('pilot_required full batch carries its gate so the runner can refuse it', () => {
  const batch = emitBatch(loadReg('roads_wang'), {});
  assert.equal(batch.gate, 'pilot_required');
  assert.equal(batch.jobs.length, 2 * 16);
});

test('biome base tile table covers all road biomes', () => {
  const tiles = loadReg('biome_base_tiles');
  for (const b of loadReg('roads_wang').biomes) {
    assert.ok(tiles[b]?.base_tile_id, `missing base tile for ${b}`);
    assert.ok(tiles[b]?.desc);
  }
});

test('matrix pilot_required registries refuse full emission but the corpus enumerates them', () => {
  const bp = loadReg('body_parts');
  assert.equal(enumerateRegistry(bp).totalSprites, 13 * 4 * 6 * 3 * 3 * 64);
  const batch = emitBatch(bp, {});
  assert.equal(batch.gate, 'pilot_required');
  assert.equal(batch.jobs.length, 0);
  assert.throws(() => emitBatch(loadReg('fauna'), {}), /dormant/);
  assert.throws(() => emitBatch(loadReg('items'), {}), /dormant/);
  assert.throws(() => emitBatch(loadReg('elevation_wang'), {}), /dormant/);
});
