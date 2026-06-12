// sim/test/probe-motion.test.js — Probe M (motion-DSL spec §10).
// "pick the berry and eat it": planner-driven execution must be ledger-identical
// to hand-written real verbs. Headless; no renderer, no LLM.
//
// DEVIATIONS from plan's literal probe code (fixture adaptations):
// 1. Kernel ctor: plan used { seed, phi:4, bounds }; probe 6 uses { seed, bounds } with phi
//    defaulting to 4 — kept default (omitted explicit phi) to mirror probe 6 exactly.
// 2. World helper uses graph.boot + addLiving for a CONTROLLED fixture (known coords) rather
//    than spawnMeadow (random positions) — locomotion identity test requires known positions;
//    plan shape already specified this controlled approach, so matches plan spec intent.
// 3. createPlayer called OUTSIDE boot at tick=0, matching probe 6 style.
// 4. Conservation check: plan shape used s.drift (stocks() returns a number, not an object);
//    adapted to probe 6's actual pattern: start=stocks(0) before actions, end=stocks(t) after,
//    relative tolerance vs scale=max(|captured|,1). stocks(0) called at tick=0 only.
// 5. World A uses harvest()+eat() (not pick()) — produces ledger types 'harvest'/'eat' matching
//    World B executor's attach→harvest + emit:consume→eat path. Plan spec explicitly listed
//    harvest/eat as the hand-written ground-truth verbs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, move, harvest, eat } from '../world/actions.js';
import { plan } from '../life/motion/planner.js';
import { performAction, solveProgramTrack } from '../life/motion/executor.js';
import { loadProgram } from '../life/motion/program.js';
import { loadRig } from '../../src/life/rig.js';

const SEED = 77;
const BOUNDS = { x0: 0, y0: 0, w: 20, h: 20 };

// Controlled fixture: bush at (6,4), player at (3,4), Chebyshev distance = 3 → 2 steps to adjacent.
function world() {
  const k = new Kernel({ seed: SEED, bounds: BOUNDS });
  let bush;
  k.graph.boot(() => {
    bush = k.addLiving({ species: 'berry_bush', x: 6, y: 4, R: 5000, body: 900, tick: 0 });
  });
  const player = createPlayer(k, 0, { x: 3, y: 4 });
  return { k, player, bush };
}

const eventTypes = k => k.ledger.events.map(e => e.type);
const snapshot = (k, ids) => ids.map(id => {
  const n = k.graph.nodes.get(id);
  return n ? { R: n.R, body: n.attrs.body ?? null, x: n.x, y: n.y } : null;
});

test('probe M: planner path is ledger-identical to hand-written verbs', () => {
  // ---- World A: hand-written ground truth (harvest + eat real verbs)
  const A = world();
  // Capture start stocks at tick=0 before any actions (probe 6 pattern)
  const startA = A.k.stocks(0);
  const startFlowA = A.k.ledger.totals.captured - A.k.ledger.totals.burned
    - A.k.ledger.totals.decayed - A.k.ledger.totals.transferLoss;

  let t = 1;
  // Greedy Chebyshev step loop matching executor's locomote adapter exactly:
  // stop when Math.max(|dx|,|dy|) <= 1 (same guard as performAction)
  while (Math.max(Math.abs(A.bush.x - A.player.x), Math.abs(A.bush.y - A.player.y)) > 1) {
    const dx = Math.sign(A.bush.x - A.player.x), dy = Math.sign(A.bush.y - A.player.y);
    assert.ok(move(A.k, A.player.id, dx, dy, t), `World A move step at t=${t}`);
    t += 1;
  }
  const itemA = harvest(A.k, A.player.id, A.bush.id, t); t += 1;
  assert.ok(itemA, 'World A: harvest produced item');
  const gainedA = eat(A.k, A.player.id, itemA.id, t); t += 1;
  assert.ok(gainedA > 0, 'World A: eat gained R');

  const endA = A.k.stocks(t);
  const endFlowA = A.k.ledger.totals.captured - A.k.ledger.totals.burned
    - A.k.ledger.totals.decayed - A.k.ledger.totals.transferLoss;

  // ---- World B: planner-driven
  const B = world();
  // Capture start stocks at tick=0 before any actions
  const startB = B.k.stocks(0);
  const startFlowB = B.k.ledger.totals.captured - B.k.ledger.totals.burned
    - B.k.ledger.totals.decayed - B.k.ledger.totals.transferLoss;

  const actions = plan('pick the berry and eat it', { bush: { id: B.bush.id, x: B.bush.x, y: B.bush.y } });
  assert.ok(actions, 'canonical intent resolves');
  let tick = 1, last = null;
  for (const action of actions) {
    const r = performAction(B.k, B.player.id, action, tick, last);
    assert.ok(r.ok, `${action.verb}: ${r.verdict}`);
    if (r.items.length) last = r.items[r.items.length - 1];
    tick = r.tick;
  }

  const endB = B.k.stocks(tick);
  const endFlowB = B.k.ledger.totals.captured - B.k.ledger.totals.burned
    - B.k.ledger.totals.decayed - B.k.ledger.totals.transferLoss;

  // ---- Assert world-consequence identity
  const typesA = eventTypes(A.k);
  const typesB = eventTypes(B.k);
  assert.deepEqual(typesB, typesA,
    `ledger event-type sequences differ:\n  A: ${JSON.stringify(typesA)}\n  B: ${JSON.stringify(typesB)}`);
  assert.deepEqual(snapshot(B.k, [B.player.id, B.bush.id]),
                   snapshot(A.k, [A.player.id, A.bush.id]), 'node deltas bit-identical');

  // ---- Conservation in both worlds (probe 6 relative-tolerance pattern)
  const scaleA = Math.max(Math.abs(A.k.ledger.totals.captured), 1);
  const driftA = Math.abs((endA - startA) - (endFlowA - startFlowA));
  assert.ok(driftA / scaleA < 1e-9,
    `World A conservation: Δstocks=${endA - startA} Δflows=${endFlowA - startFlowA} relErr=${driftA / scaleA}`);

  const scaleB = Math.max(Math.abs(B.k.ledger.totals.captured), 1);
  const driftB = Math.abs((endB - startB) - (endFlowB - startFlowB));
  assert.ok(driftB / scaleB < 1e-9,
    `World B conservation: Δstocks=${endB - startB} Δflows=${endFlowB - startFlowB} relErr=${driftB / scaleB}`);
});

test('probe M: tracks are bit-identical; variant noise never touches world deltas', () => {
  const rig = loadRig('humanoid');
  const p = loadProgram('wave');
  const t1 = solveProgramTrack(rig, p, { seed: SEED, entityId: 5, startTick: 10 });
  const t2 = solveProgramTrack(rig, p, { seed: SEED, entityId: 5, startTick: 10 });
  assert.deepEqual(t1, t2, 'replay is bit-identical');
  const t3 = solveProgramTrack(rig, p, { seed: SEED, entityId: 6, startTick: 10 });
  assert.notDeepEqual(t1.frames, t3.frames, 'different entities move differently');
  assert.deepEqual(t1.intents, t3.intents, 'variant noise NEVER changes world-facing intents');
  assert.deepEqual(t1.events.map(e => e.event), t3.events.map(e => e.event));
});
