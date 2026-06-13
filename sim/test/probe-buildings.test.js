// sim/test/probe-buildings.test.js — P4 probe: a founder group clears a deeded plot
// with REAL verbs (take/chop), pays pooled time to raise a hut, the hut's walls
// genuinely block walking while its door admits it, a forge rises in the craft
// district, routing detours around both, the whole history conserves time, decay
// returns an abandoned hut to wilderness (flora regrows on reboot; the hearth
// remains as a ruin), and the entire run is deterministic.
//
// ADAPTATIONS FROM PLAN (logged):
//   [A1] take() returns an item node (not boolean); assert.ok(take(...)) is valid since
//        a returned node is truthy and null is falsy — plan code was already correct.
//   [A2] clearSite inner loop uses `n.attrs?.placement` (not `n.attrs.placement`) to
//        avoid TypeError on nodes without attrs — matches buildings.test.js convention.
//   [A3] forge construction: constructBuilding with settlementId checks founderGroup===groupId,
//        so g must be the founder. Confirmed settlement founded by g.id; no change needed.
//   [A4] Walker entry test: plan places walker at (fp.x0+2, fp.y0+fp.h) which is one tile
//        south of the south door (door is at fp.y0+fp.h-1 per blueprints.js doorXY south:
//        ox+offset, oy+h-1). So walker.y = fp.y0+fp.h → one step north lands on door. OK.
//   [A5] Conservation baseline taken AFTER contribute (not before) to avoid counting
//        harvest+gift losses; plan's comment says "AFTER funding" — preserved as-is.
//   [A6] The plan's clearSite returns a count (not in buildings.test.js); kept as a useful
//        diagnostic but not asserted to be >0 (some forge sub-rects may already be clear).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick, move, take, chop } from '../world/actions.js';
import { createGroup, contribute } from '../society/groups.js';
import { foundSettlement } from '../society/settlements.js';
import { materializeRect } from '../world/wire.js';
import { constructBuilding, wallTiles, BUILD_E_PER_STAMP } from '../world/buildings.js';
import { FEATURE_E } from '../world/construct.js';
import { planRoute } from '../world/routing.js';
import { DAY } from '../time/metabolism.js';

const RECT = { x0: 926, y0: 0, w: 28, h: 14 };
const SEED = 7;

/** Clear every materialized placement node in rect with real verbs: take matter, chop living.
 *  Returns count of nodes cleared in the first pass (diagnostic). */
function clearSite(k, playerId, rect) {
  let cleared = 0;
  for (const n of [...k.graph.nodes.values()]) {
    if (!n.attrs?.placement) continue;
    if (n.x < rect.x0 || n.x >= rect.x0 + rect.w || n.y < rect.y0 || n.y >= rect.y0 + rect.h) continue;
    if (n.type === 'matter') { assert.ok(take(k, playerId, n.id, 0)); cleared++; }
    else { assert.equal(chop(k, playerId, n.id, 0), true); cleared++; }
  }
  // chop leaves corpses/products on the tiles — they are NOT placements; constructBuilding
  // only refuses materialized placements, so move chopped debris out with take.
  for (const n of [...k.graph.nodes.values()]) {
    if (n.type !== 'matter' || n.attrs?.placement) continue;
    if (n.x < rect.x0 || n.x >= rect.x0 + rect.w || n.y < rect.y0 || n.y >= rect.y0 + rect.h) continue;
    take(k, playerId, n.id, 0);
  }
  return cleared;
}

function runScenario() {
  const k = new Kernel({ seed: SEED, bounds: RECT });
  let bush1, bush2;
  k.graph.boot(() => {
    bush1 = k.addLiving({ species: 'berry_bush', x: 941, y: 1,
                          R: 40000, body: 60000, tick: 0, age: 400 * DAY });
    bush2 = k.addLiving({ species: 'berry_bush', x: 942, y: 1,
                          R: 40000, body: 60000, tick: 0, age: 400 * DAY });
    const made = materializeRect(k, RECT, 0);
    assert.ok(made >= 1, 'vacuity: baseline materialized something');
  });
  const p1 = createPlayer(k, 0, { x: 941, y: 1 });
  const p2 = createPlayer(k, 0, { x: 942, y: 1 });
  const g = createGroup(k, 0, { x: 941, y: 0 });

  // ── Fund the group with real harvests (hut 610 + forge 1150 + margin; 2×1100×0.9 = 1980) ──
  const NEED = 1100;
  for (const [pid, bush] of [[p1.id, bush1], [p2.id, bush2]]) {
    const pl = k.graph.nodes.get(pid);
    while (pl.R < NEED) { if (pick(k, pid, bush.id, 0) <= 0) break; }
    assert.ok(pl.R >= NEED, `player holds ≥${NEED}`);
    assert.equal(contribute(k, pid, g.id, NEED, 0), true);
  }

  // ── Conservation baseline AFTER funding (all tick-0; stocks() destructive) ──
  const stocks0 = k.stocks(0);
  const tl0 = k.ledger.totals.transferLoss;

  // ── Found the settlement at a scored, plot-viable land site ──
  // [A7] P1 unbounded world: territories are no longer clipped to bounds, so the rect's
  // water-hugging argmax site deeds zero land plots. The argmax identity is probe-settlements'
  // claim; this probe needs a deeded plot — found at the settlements.test land site.
  const settlement = foundSettlement(k, g.id, { x: 940, y: 8 }, 0);
  assert.ok(settlement, 'settlement founded');
  const plots = [...k.graph.nodes.values()].filter(
    n => n.type === 'plot' && n.attrs.settlement === settlement.id);
  assert.ok(plots.length >= 1, 'plots deeded');

  // ── Clear the first plot with real verbs, then raise a hut on it ──
  const plot = plots[0];
  clearSite(k, p1.id, plot.attrs.rect);
  const hut = constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0);
  assert.ok(hut, 'hut constructed on the cleared plot');
  const hutCost = 20 * BUILD_E_PER_STAMP + FEATURE_E.hearth + FEATURE_E.bedroll;

  // ── Walls block walking; the door admits it (the experienceable claim) ──
  const fp = hut.attrs.footprint;
  const walker = k.graph.nodes.get(p2.id);
  walker.x = fp.x0 - 1; walker.y = fp.y0;
  assert.equal(move(k, p2.id, 1, 0, 0), false, 'wall blocks entry');
  walker.x = fp.x0 + 2; walker.y = fp.y0 + fp.h;
  assert.equal(move(k, p2.id, 0, -1, 0), true, 'door admits entry');
  assert.equal(move(k, p2.id, 0, -1, 0), true, 'standing on the hut floor');

  // ── A forge rises in the craft district (settlement placement path) ──
  const craft = settlement.attrs.districts.find(d => d.kind === 'craft');
  assert.ok(craft, 'craft district zoned');
  // Find a forge-sized clear land origin inside the craft district (programmatic).
  let forge = null;
  for (let oy = craft.rect.y0; oy + 5 <= craft.rect.y0 + craft.rect.h && !forge; oy++) {
    for (let ox = craft.rect.x0; ox + 6 <= craft.rect.x0 + craft.rect.w && !forge; ox++) {
      clearSite(k, p1.id, { x0: ox, y0: oy, w: 6, h: 5 });
      forge = constructBuilding(k, g.id, { settlementId: settlement.id, x: ox, y: oy }, 'forge', 0);
    }
  }
  assert.ok(forge, 'forge constructed in the craft district');
  const smith = forge.attrs.npcSlots.find(s => s.role === 'smith');
  assert.ok(smith?.workTile, 'smith slot resolved to the anvil tile (Agency landing pad)');

  // ── Routing detours around both buildings ──
  const blocked = wallTiles(k);
  const route = planRoute({ x: RECT.x0 + 1, y: fp.y0 + 1 },
                          { x: RECT.x0 + RECT.w - 2, y: fp.y0 + 1 }, RECT, { blocked });
  if (route) for (const t of route)
    assert.ok(!blocked.has(`${t.x},${t.y}`), 'route never crosses a wall');

  // ── Conservation checkpoint: Δstocks == −ΔtransferLoss (all tick-0 activity) ──
  const tlDelta = k.ledger.totals.transferLoss - tl0;
  const drift = (k.stocks(0) - stocks0) + tlDelta;
  assert.ok(Math.abs(drift) < 1e-6, `conservation drift ${drift}`);

  // ── Abandonment: 101 unmaintained days → the hut falls; ruins + regrowth ──
  const hutId = hut.id, forgeId = forge.id;
  k.runTo(101 * DAY);
  assert.equal(k.graph.nodes.get(hutId), undefined, 'abandoned hut is gone');
  assert.equal(k.graph.nodes.get(forgeId), undefined, 'abandoned forge is gone');
  const hearthRuin = [...k.graph.nodes.values()].find(
    n => n.attrs?.archetype === 'hearth' && n.attrs.building === null);
  assert.ok(hearthRuin, 'the hearth remains as a ruin');
  assert.equal(k.deltas.list.filter(d => d.kind === 'claimed').length, 0,
    'all claims healed — flora regrows on the next reboot');

  return {
    site: { x: 940, y: 8 },
    hut: { x0: fp.x0, y0: fp.y0, cost: hutCost },
    forge: { x0: forge.attrs.footprint.x0, y0: forge.attrs.footprint.y0 },
    events: k.ledger.events.map(e => e.type),
    deltaCount: k.deltas.list.length,
    finalGroupR: k.graph.nodes.get(g.id)?.R ?? null,
  };
}

test('PROBE: clear → fund → build → inhabit-shaped → abandon → wilderness', () => {
  runScenario();
});

test('PROBE determinism: identical history on identical seed', () => {
  const a = runScenario();
  const b = runScenario();
  assert.deepEqual(a, b);
});
