// PROBE L2a: body substrate — rig, body plans, and composition cohere end to
// end on a real kernel, deterministically, without storing anything or
// touching the wire. Honest absences exercised: humanoids remain UNRENDERED
// (no sprites, no renderer); rig is data (no motion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { YEAR } from '../time/metabolism.js';
import { RACES } from '../life/identity.js';
import { loadRig, comOf } from '../../src/life/rig.js';
import { PARTS, PART_BONE, bodyPlanOf, composeLayers } from '../life/body.js';
import { serializeEntity } from '../server/protocol.js';
import { FIELD_SHEETS } from '../../src/world/asset-state-taxonomy.js';
import { equip } from '../items/equipment.js';

function world(seed) {
  const k = new Kernel({ seed, phi: 4, bounds: { x0: 0, y0: 0, w: 10, h: 10 } });
  const out = { k, folk: {} };
  k.graph.boot(() => {
    let x = 2;
    for (const r of RACES) {
      out.folk[r] = k.addLiving({ species: r, x: (x += 2), y: 4, R: 80000, body: 14000, tick: 0, age: 30 * YEAR });
    }
  });
  return out;
}

test('PROBE L2a step 1: every race gets a coherent plan; every part maps to a live rig bone', () => {
  const rig = loadRig('humanoid');
  const { k, folk } = world(7);
  for (const r of RACES) {
    const plan = bodyPlanOf(k, folk[r]);
    assert.equal(plan.race, r);
    for (const p of PARTS) {
      assert.ok(rig.bones[PART_BONE[p]], `${r}.${p} → rig bone ${PART_BONE[p]}`);
      assert.ok(plan.parts[p].scale > 0);
    }
  }
  const com = comOf(rig);
  assert.ok(com.mass > 0 && com.y > 0, 'rig COM physical');
});

test('PROBE L2a step 2: equipped layers compose deterministically across directions', () => {
  const { k, folk } = world(7);
  const h = folk.human;
  // Inventory item shape matches equipment.js fixture: top-level id + archetype.
  // attrs.archetype is also set so composeLayers can read item.attrs?.archetype.
  // DEVIATION: probe spec used { id, attrs: { archetype } }; real equip reads
  // item.archetype for the ledger (line 52). We set both fields so both
  // equip() and composeLayers() work correctly without any hand-built maps.
  h.attrs.inventory = [{ id: 9001, kind: 'matter', archetype: 'tunic', attrs: { archetype: 'tunic' }, E: 1, tick: 0 }];
  const ok = equip(k, h.id, 9001, 'chest', k.tick);
  assert.equal(ok, true, 'real M5 equip succeeded');
  const plan = bodyPlanOf(k, h);
  for (const d of ['n', 's', 'e', 'w']) {
    const a = composeLayers(plan, h.attrs.equipment, d);
    const b = composeLayers(plan, h.attrs.equipment, d);
    assert.deepEqual(a, b, d);
    assert.equal(a.length, 15, `${d}: 14 parts + 1 worn`);
    const torso = a.find(l => l.part === 'torso');
    const tunic = a.find(l => l.slot === 'chest');
    assert.ok(tunic.z > torso.z, `${d}: tunic over torso`);
  }
});

test('PROBE L2a step 3: nothing stored, nothing on the wire, taxonomy absence intact', () => {
  const { k, folk } = world(7);
  const before = JSON.stringify(folk.elf.attrs);
  bodyPlanOf(k, folk.elf);
  composeLayers(bodyPlanOf(k, folk.elf), {}, 's');
  assert.equal(JSON.stringify(folk.elf.attrs), before, 'derivation mutated nothing');
  const e = serializeEntity(folk.elf, k.tick, k.seed);
  assert.equal(e.bodyPlan, undefined, 'body plan not serialized');
  assert.equal(e.parts, undefined);
  for (const r of RACES) assert.ok(FIELD_SHEETS._meta.UNRENDERED.includes(r),
    `${r} still UNRENDERED (honest absence until L2b)`);
});

test('PROBE L2a step 4: two identical seeds → bit-identical plans; different seed differs', () => {
  const a = world(7), b = world(7), c = world(11);
  for (const r of RACES) {
    assert.deepEqual(bodyPlanOf(a.k, a.folk[r]), bodyPlanOf(b.k, b.folk[r]), r);
  }
  const diff = RACES.some(r =>
    JSON.stringify(bodyPlanOf(a.k, a.folk[r])) !== JSON.stringify(bodyPlanOf(c.k, c.folk[r])));
  assert.ok(diff, 'a different world seed varies at least one body plan');
});
