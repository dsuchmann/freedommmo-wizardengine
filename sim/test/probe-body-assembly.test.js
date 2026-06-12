// sim/test/probe-body-assembly.test.js — L2b: meta↔rig↔PARTS↔composeLayers consistency.
// Asset PNGs are machine-local (never committed): file-presence checks SKIP when the
// pilot directory is absent (honest absence), but meta/rig invariants always run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { loadRig } from '../../src/life/rig.js';
import { PARTS, PART_BONE, partKey, composeLayers } from '../life/body.js';

const META = JSON.parse(readFileSync(new URL('../../src/life/rigs/humanoid-parts-south.json', import.meta.url)));
const ASSET_BASE = new URL('../../assets/pixelab/body_parts/human/average/adult/', import.meta.url);

test('part meta covers exactly the 14 PARTS with valid pivots', () => {
  const rig = loadRig('humanoid');
  assert.deepEqual(Object.keys(META.parts).sort(), [...PARTS].sort());
  for (const [part, m] of Object.entries(META.parts)) {
    assert.ok(Array.isArray(m.pivot) && m.pivot.length === 2, `${part}: pivot [x,y]`);
    assert.ok(m.pivot.every(v => v >= 0 && v <= 64), `${part}: pivot inside 64px canvas`);
    assert.ok(m.ppu > 0, `${part}: ppu positive`);
    assert.ok(rig.bones[PART_BONE[part]], `${part}: maps to real rig bone`);
  }
  assert.equal(META.direction, 's');
});

test('composeLayers south order is total over PARTS and z-ascending', () => {
  const plan = {
    race: 'human', bodyType: 'average', ageBand: 'adult',
    parts: Object.fromEntries(PARTS.map(p => [p, { scale: 1 }])),
  };
  const layers = composeLayers(plan, null, 's');
  const parts = layers.filter(l => l.part);
  assert.equal(parts.length, 14);
  assert.deepEqual(parts.map(l => l.part).sort(), [...PARTS].sort());
  for (let i = 1; i < layers.length; i++) assert.ok(layers[i].z >= layers[i - 1].z);
  for (const l of parts) assert.equal(l.key, partKey('human', 'average', 'adult', l.part, 's'));
});

test('pilot sprites exist on disk for every part (skips when assets absent)', (t) => {
  if (!existsSync(ASSET_BASE)) return t.skip('pilot assets not on this machine');
  for (const part of PARTS) {
    assert.ok(existsSync(new URL(`${part}/s.png`, ASSET_BASE)), `${part}/s.png present`);
  }
});
