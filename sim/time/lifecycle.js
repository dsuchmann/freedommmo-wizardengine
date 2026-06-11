import { SPECIES, materialize, transfer, stageAt, DAY } from './metabolism.js';
import { rand, randRange } from '../kernel/rng.js';

const GONE_THRESHOLD = 0.5;   // tu — corpse below this is gone

export function registerLifecycle(kernel) {
  kernel.deltas = [];

  kernel._scheduleLifecycle = (node, tick) => {
    const sp = SPECIES[node.attrs.species];
    const birth = node.attrs.birthTick;
    // Lifecycle events are unconditional appointments: ver -1 = never stale.
    for (const [, startAge] of sp.stages) {
      if (birth + startAge > tick) kernel.scheduler.schedule(birth + startAge, node.id, 'stage', -1);
    }
    if (birth + sp.senescence.start > tick) {
      kernel.scheduler.schedule(birth + sp.senescence.start, node.id, 'sen_step', -1);
    }
    const jit = 1 + (rand(kernel.seed, node.id, 101) - 0.5) * 2 * sp.seed.jitter;
    kernel.scheduler.schedule(tick + sp.seed.every * jit, node.id, 'seed', -1);
  };

  kernel.on('stage', (k, node, ev) => {
    k.reRateTileOf(node.id, ev.tick);
  });

  kernel.on('body_full', (k, node, ev) => {
    k.reRateTileOf(node.id, ev.tick);   // growth stops; surplus reroutes to R
  });

  kernel.on('sen_step', (k, node, ev) => {
    const sp = SPECIES[node.attrs.species];
    const sen = node.attrs.sen ?? { burnMul: 1, demandMul: 1, step: 0 };
    sen.step++;
    sen.burnMul *= sp.senescence.burnGrowth * randRange(k.seed, node.id, 200 + sen.step, 0.97, 1.03);
    sen.demandMul *= sp.senescence.demandDecay;
    node.attrs.sen = sen;
    k.reRateTileOf(node.id, ev.tick);
    kernel.scheduler.schedule(ev.tick + sp.senescence.stepEvery, node.id, 'sen_step', -1);
  });

  kernel.on('death_check', (k, node, ev) => {
    k.closeSegment(node, ev.tick);
    if (node.R > 1e-9) {   // rates changed since prediction; re-predict
      if (node.r < 0) k.scheduler.schedule(ev.tick + node.R / -node.r, node.id, 'death_check', node.ver);
      return;
    }
    die(k, node, ev.tick, null);
  });

  kernel.on('seed', (k, node, ev) => {
    const sp = SPECIES[node.attrs.species];
    k.closeSegment(node, ev.tick);
    const age = ev.tick - node.attrs.birthTick;
    const mature = stageAt(node.attrs.species, age)[0] === 'mature';
    if (mature && node.R >= sp.seed.minR && node.attrs.sen == null) {
      const dx = Math.floor(randRange(k.seed, node.id, ev.tick, -2, 3));
      const dy = Math.floor(randRange(k.seed, node.id, ev.tick + 1, -2, 3));
      const cx = node.x + dx, cy = node.y + dy;
      const b = k.bounds;
      const inBounds = b == null ||
        (cx >= b.x0 && cx < b.x0 + b.w && cy >= b.y0 && cy < b.y0 + b.h);
      if (inBounds) {   // seeds landing outside the world fail to establish (no spend)
        // Direct R mutation is conservation-safe ONLY because closeSegment ran above
        // at this same tick (dt=0 inside the reRateTileOf below). Keep them same-tick.
        node.R -= sp.seed.cost;
        const delivered = transfer(sp.seed.cost, 'nurture', k.ledger);
        const evId = k.ledger.emit({ tick: ev.tick, type: 'seed', actor: node.id, magnitude: sp.seed.cost });
        const child = k.addLiving({
          species: node.attrs.species, x: cx, y: cy,
          R: delivered * 0.7, body: delivered * 0.3, tick: ev.tick, causeEventId: evId,
        });
        k.ledger.events[evId - 1].targets.push(child.id);   // events array is id-ordered
        k.reRateTileOf(node.id, ev.tick);
      }
    }
    const jit = 1 + (rand(k.seed, node.id, 102 + ev.tick % 7) - 0.5) * 2 * sp.seed.jitter;
    k.scheduler.schedule(ev.tick + sp.seed.every * jit, node.id, 'seed', -1);
  });

  kernel.on('decay_gone', (k, node, ev) => {
    materialize(node, ev.tick, k.ledger);
    k.ledger.count('decayed', node.attrs.E);   // remainder returns to ambient
    node.attrs.E = 0;
    k.ledger.emit({ tick: ev.tick, type: 'decay_gone', targets: [node.id], causeEventId: node.createdByEvent });
    k.deltas.push({ tick: ev.tick, x: node.x, y: node.y, target: `corpse:${node.id}`, kind: 'gone' });
    k.graph.removeNode(node.id);
  });
}

export function die(kernel, node, tick, causeEventId) {
  kernel.closeSegment(node, tick);
  // Math.ceil in scheduler can produce a 1-tick overshoot where R goes slightly negative.
  // Correct the conservation identity by un-counting the overdraft from burn.
  if (node.R < 0) {
    kernel.ledger.count('burned', node.R);  // node.R is negative — decrements burned
    node.R = 0;
  }
  const sp = SPECIES[node.attrs.species];
  const E = Math.max(node.R, 0) + node.attrs.body;
  const deathEv = kernel.ledger.emit({
    tick, type: 'death', actor: node.id, targets: [node.id], magnitude: E, causeEventId,
  });
  kernel.flux.leave(node.id);
  const { x, y } = node;
  kernel.graph.removeNode(node.id);
  // re-rate survivors on that tile (their rationing improved)
  for (const occId of kernel.flux.occupantsOf(x, y)) {
    const occ = kernel.graph.nodes.get(occId);
    if (occ?.R != null) kernel._reRateOne(occ, tick);
  }
  if (E > GONE_THRESHOLD) {
    const halflife = sp.embodiedDecayDays * DAY;
    const corpseEv = kernel.ledger.emit({ tick, type: 'corpse', causeEventId: deathEv });
    const corpse = kernel.graph.createNode({
      type: 'corpse', tick, x, y, causeEventId: corpseEv,
      attrs: { E, decayHalflifeTicks: halflife, of: node.type },
    });
    const goneTick = tick + halflife * Math.log2(E / GONE_THRESHOLD);
    kernel.scheduler.schedule(goneTick, corpse.id, 'decay_gone', -1);
  } else {
    kernel.ledger.count('decayed', E);
  }
}
