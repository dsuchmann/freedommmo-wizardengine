// sim/test/behavior.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRig } from '../../src/life/rig.js';
import { ACTION_SCHEMAS, validateAction } from '../life/motion/vocabulary.js';
import { compileAction } from '../life/motion/behavior.js';
import { plan, CANONICAL_INTENTS } from '../life/motion/planner.js';
import { validateProgram, loadProgram } from '../life/motion/program.js';
import { validateChoreography } from '../life/motion/validator.js';
import { solveProgramTrack, performAction } from '../life/motion/executor.js';

const rig = loadRig('humanoid');

test('vocabulary covers exactly the spec §6 verbs', () => {
  assert.deepEqual(Object.keys(ACTION_SCHEMAS).sort(), [
    'attack', 'dance', 'drop', 'emote', 'face', 'follow', 'gesture', 'investigate',
    'jump', 'look_at', 'move_to', 'pick_up', 'run', 'sit', 'sleep', 'talk',
    'trade', 'use', 'wait',
  ]);
  assert.deepEqual(validateAction({ verb: 'move_to', x: 3, y: 4 }), []);
  assert.ok(validateAction({ verb: 'move_to' }).length > 0);          // missing x,y
  assert.ok(validateAction({ verb: 'levitate' }).length > 0);         // unknown verb
});

test('compileAction: every non-null compile is a valid, validator-OK program', () => {
  const cases = [
    { verb: 'move_to', x: 3, y: 4 }, { verb: 'run', x: 3, y: 4 },
    { verb: 'follow', target: 9 }, { verb: 'face', target: 9 },
    { verb: 'look_at', target: 9 }, { verb: 'gesture', name: 'wave' },
    { verb: 'emote', name: 'nervous_glance' }, { verb: 'dance' },
    { verb: 'sit' }, { verb: 'jump' }, { verb: 'wait', ticks: 5 },
    { verb: 'drop', item: 1 }, { verb: 'investigate', target: 9, x: 3, y: 4 },
    { verb: 'pick_up', target: 9, x: 3, y: 4 },
    { verb: 'use', mode: 'eat', item: 1 },
  ];
  for (const action of cases) {
    const p = compileAction(action);
    assert.ok(p, `${action.verb} compiles`);
    assert.deepEqual(validateProgram(p), [], `${action.verb} structurally valid`);
    const ctx = { takeable: () => true, inRange: () => true };
    assert.equal(validateChoreography(rig, p, ctx).verdict, 'OK', `${action.verb} choreography OK`);
  }
});

test('honest absences compile to null', () => {
  for (const verb of ['attack', 'talk', 'trade', 'sleep']) {
    assert.equal(compileAction({ verb }), null, verb);
  }
});

test('planner: canonical intent resolves; unknown phrase is null (one-time authoring)', () => {
  const ctx = { bush: { id: 7, x: 5, y: 5 } };
  const actions = plan('pick the berry and eat it', ctx);
  assert.deepEqual(actions.map(a => a.verb), ['move_to', 'pick_up', 'use']);
  assert.equal(actions[1].target, 7);
  assert.equal(actions[2].mode, 'eat');
  for (const a of actions) assert.deepEqual(validateAction(a), []);
  assert.equal(plan('do a backflip off the roof', ctx), null);
  assert.ok(Object.keys(CANONICAL_INTENTS).includes('pick the berry and eat it'));
});

test('solveProgramTrack is pure and bit-identical across calls; variant differs per entity', () => {
  const p = loadProgram('wave');
  const a = solveProgramTrack(rig, p, { seed: 7, entityId: 42, startTick: 100 });
  const b = solveProgramTrack(rig, p, { seed: 7, entityId: 42, startTick: 100 });
  assert.deepEqual(a, b);
  const c = solveProgramTrack(rig, p, { seed: 7, entityId: 43, startTick: 100 });
  assert.notDeepEqual(a.frames, c.frames);              // variant noise per entity
  assert.ok(a.frames.length > 0);
  assert.ok(a.frames.every(f => Number.isInteger(f.tick)));
  // every frame's joints are within limits (amplitude was validated at hi-bound)
  for (const f of a.frames) {
    for (const [j, deg] of Object.entries(f.joints)) {
      const lim = rig.joints[j];
      assert.ok(deg >= lim.min - 1e-6 && deg <= lim.max + 1e-6, `${j}@${f.tick}`);
    }
  }
});

test('solveProgramTrack surfaces intents in order with ticks', () => {
  const p = compileAction({ verb: 'pick_up', target: 9, x: 3, y: 4 });
  const t = solveProgramTrack(rig, p, { seed: 7, entityId: 1, startTick: 0 });
  assert.deepEqual(t.intents.map(i => i.kind), ['locomote', 'attach']);
  assert.equal(t.intents[1].entity, 9);
});
