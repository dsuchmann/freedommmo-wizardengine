// sim/life/instinct.js — Pass 4 L4: instinct-weighted rule agency (atlas S4 fauna row).
// Animals = the same Life stack with a thinner mind: a fixed deterministic rule
// priority evaluated on a per-species cadence. NO LLM, NO utility scoring (L6),
// NO memory (L8) — honest absences. No new salts: decisions are nearest-target
// rules with lowest-id tie-breaks; determinism is structural.
//
// Priority per decision: flee > follow(owner) > hunt > forage > idle.
import { SPECIES, transfer } from '../time/metabolism.js';
import { die, forageBite } from '../time/lifecycle.js';
import { move } from '../world/actions.js';

const FOLLOW_RADIUS = 6;   // domestic animal keeps within this Chebyshev range of its owner

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Predator map derived from the species table: preyName -> Set(predator species). */
export const PREDATORS_OF = (() => {
  const m = {};
  for (const [name, sp] of Object.entries(SPECIES)) {
    for (const prey of sp.instinct?.hunt?.prey ?? []) (m[prey] ??= new Set()).add(name);
  }
  return m;
})();

function nearest(k, node, radius, pred) {
  return k.graph.nodesNear(node.x, node.y, radius)
    .filter(n => n.id !== node.id && pred(n))
    .sort((a, b) => {
      const da = (a.x - node.x) ** 2 + (a.y - node.y) ** 2;
      const db = (b.x - node.x) ** 2 + (b.y - node.y) ** 2;
      return da - db || a.id - b.id;
    })[0] ?? null;
}

/** One real step with flux bookkeeping: leave old tile, move(), re-enter, re-rate both tiles.
 *  Also updates the graph spatial grid so that nodesNear stays consistent after movement. */
function faunaStep(k, node, dx, dy, tick) {
  const fromX = node.x, fromY = node.y;
  // Update the graph's spatial grid: remove from old cell before move() changes x/y.
  const oldKey = k.graph._cellKey(fromX, fromY);
  k.graph.grid.get(oldKey)?.delete(node.id);
  if (!move(k, node.id, dx, dy, tick)) {
    // Refused: put back into old cell.
    const cell = k.graph.grid.get(oldKey);
    if (cell) cell.add(node.id);
    else { k.graph.grid.set(oldKey, new Set([node.id])); }
    return false;
  }
  // Insert into new cell.
  const newKey = k.graph._cellKey(node.x, node.y);
  if (!k.graph.grid.has(newKey)) k.graph.grid.set(newKey, new Set());
  k.graph.grid.get(newKey).add(node.id);
  k.flux.leave(node.id);
  k.flux.enter(node.id, node.x, node.y, node.attrs.demand ?? 0);
  for (const occId of k.flux.occupantsOf(fromX, fromY)) {     // departed tile breathes easier
    const occ = k.graph.nodes.get(occId);
    if (occ?.R != null) k._reRateOne(occ, tick);
  }
  k.reRateTileOf(node.id, tick);
  return true;
}

/** Up to `steps` greedy steps toward (tx,ty); stops when adjacent (Chebyshev<=1) or refused. */
function stepToward(k, node, tx, ty, steps, tick) {
  for (let i = 0; i < steps; i++) {
    if (Math.max(Math.abs(tx - node.x), Math.abs(ty - node.y)) <= 1) return;
    const dx = Math.sign(tx - node.x), dy = Math.sign(ty - node.y);
    if (!faunaStep(k, node, dx, dy, tick)) return;
  }
}

function ownerOf(k, node) {
  for (const eid of k.graph.byNode.get(node.id) ?? []) {
    const e = k.graph.edges.get(eid);
    if (e?.type !== 'domestic') continue;
    const m = e.members.find(([, role]) => role === 'owner');
    if (m) return k.graph.nodes.get(m[0]) ?? null;
  }
  return null;
}

export function registerInstinct(kernel) {
  kernel.on('instinct', (k, node, ev) => {
    const sp = SPECIES[node.attrs.species];
    const inst = sp.instinct;
    k.closeSegment(node, ev.tick);

    // 1) FLEE — any predator-of-me within flee.radius
    const threats = PREDATORS_OF[node.attrs.species];
    const threat = inst.flee && threats
      ? nearest(k, node, inst.flee.radius, n => threats.has(n.attrs?.species))
      : null;
    if (threat) {
      let dx = Math.sign(node.x - threat.x), dy = Math.sign(node.y - threat.y);
      if (dx === 0 && dy === 0) dx = 1;   // same tile: arbitrary deterministic direction
      for (let i = 0; i < inst.speed; i++) if (!faunaStep(k, node, dx, dy, ev.tick)) break;
    } else {
      // 2) FOLLOW — domestic animal drifts back toward its owner
      const owner = ownerOf(k, node);
      if (owner && owner.x != null && cheb(node, owner) > FOLLOW_RADIUS) {
        stepToward(k, node, owner.x, owner.y, inst.speed, ev.tick);
      } else if (inst.hunt) {
        // 3) HUNT — approach nearest prey; bite on contact (violence channel, spec §1.5)
        const preySet = new Set(inst.hunt.prey);
        const prey = nearest(k, node, inst.hunt.radius, n => preySet.has(n.attrs?.species) && n.R != null);
        if (prey) {
          stepToward(k, node, prey.x, prey.y, inst.speed, ev.tick);
          if (cheb(node, prey) <= 1) {
            k.closeSegment(prey, ev.tick);
            if (prey.R < 0) {                       // overdraft correction (graze precedent)
              k.ledger.count('burned', prey.R);
              prey.R = 0;
            }
            const bite = Math.min(inst.hunt.bite, prey.attrs.body + prey.R);
            const fromBody = Math.min(bite, prey.attrs.body);
            prey.attrs.body -= fromBody;
            prey.R -= (bite - fromBody);
            const gained = transfer(bite, 'violence', k.ledger);
            node.R += gained;
            const evId = k.ledger.emit({ tick: ev.tick, type: 'hunt', actor: node.id, targets: [prey.id], magnitude: bite });
            if (prey.attrs.body + prey.R <= 1e-9) die(k, prey, ev.tick, evId);
            else k.reRateTileOf(prey.id, ev.tick);
            k.reRateTileOf(node.id, ev.tick);
          }
        }
      } else if (inst.forage) {
        // 4) FORAGE — graze mechanics (shared helper; emits 'graze')
        forageBite(k, node, inst.forage, ev.tick);
      }
    }
    k.scheduler.schedule(ev.tick + inst.every, node.id, 'instinct', -1);
  });
}
