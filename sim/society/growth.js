// sim/society/growth.js — P5: settlements grow and decline through scheduled,
// rule-based group decisions paid from real pooled time. One decision per
// interval, fixed priority (maintain → clear → hut → forge → expand → idle),
// every decision a provenanced growth_decision event with a reason code.
// HONEST ABSENCES: no population pressure (no NPCs until Pass 4 Life — surplus
// is the only driver); no farms (no cultivation system — declared backlog); no
// politics (fixed rules, declared); no save/load rehydration of the schedule.
// The group is a DECLARED collective laborer: clearing uses the real chop/take
// verbs with the group as actor (chop reads only the wielded tool; take stores
// into attrs.inventory, which stocks() counts) — conserving, bodies come later.
import { chop, take } from '../world/actions.js';
import { constructBuilding, maintainBuilding, MAINTAIN_COST } from '../world/buildings.js';
import { DAY } from '../time/metabolism.js';

export const GROWTH_INTERVAL_DAYS = 10;   // one decision every 10 days
export const RESERVE_FLOOR = 200;         // surplus gate for NEW construction
export const MAINTAIN_AT = 60;            // maintain when condition drops below
export const TIER_THRESHOLDS = { town: 4, city: 12 };   // labels over real counts
const FORGE_COST = 1150;   // 30 stamps × 20 + furnace 300 + anvil 250 (P4 invariant)

function inRect(x, y, r) {
  return x >= r.x0 && x < r.x0 + r.w && y >= r.y0 && y < r.y0 + r.h;
}

/** Module-private: clear every materialized placement (and loose debris) in rect
 *  with real verbs, the group acting as collective laborer. Returns count of
 *  placements cleared. Mirrors the probe-buildings clearing pattern. */
function clearLand(kernel, groupId, rect, tick) {
  let cleared = 0;
  for (const n of [...kernel.graph.nodes.values()]) {
    if (!n.attrs?.placement || !inRect(n.x, n.y, rect)) continue;
    if (n.type === 'matter') { if (take(kernel, groupId, n.id, tick)) cleared++; }
    else if (chop(kernel, groupId, n.id, tick)) cleared++;
  }
  // chop leaves corpses/products (not placements) on the tiles; salvage them too.
  for (const n of [...kernel.graph.nodes.values()]) {
    if (n.type !== 'matter' || n.attrs.placement || !inRect(n.x, n.y, rect)) continue;
    take(kernel, groupId, n.id, tick);
  }
  return cleared;
}

/** Group clears a plot it owns. Returns cleared count, or null (side-effect-free)
 *  on missing/non-group actor, missing/non-plot target, or non-owned plot. */
export function clearPlot(kernel, groupId, plotId, tick) {
  const group = kernel.graph.nodes.get(groupId);
  const plot = kernel.graph.nodes.get(plotId);
  if (!group || group.type !== 'group' || !plot || plot.type !== 'plot') return null;
  if (plot.attrs.owner !== groupId) return null;
  return clearLand(kernel, groupId, plot.attrs.rect, tick);
}

const HUT_COST = 610;   // 20 stamps × 20 + hearth 150 + bedroll 60 (P4 invariant)

function emitDecision(kernel, groupId, settlementId, tick, decision, reason, targets = []) {
  return kernel.ledger.emit({
    tick, type: 'growth_decision', actor: groupId, targets: [settlementId, ...targets],
    attrs: { decision, reason },
  });
}

function buildingsIn(kernel, territory) {
  return [...kernel.graph.nodes.values()]
    .filter(n => n.type === 'building' && inRect(n.x, n.y, territory))
    .sort((a, b) => a.id - b.id);
}

function settlementPlots(kernel, settlementId) {
  return [...kernel.graph.nodes.values()]
    .filter(n => n.type === 'plot' && n.attrs.settlement === settlementId)
    .sort((a, b) => a.id - b.id);
}

function plotIsBuilt(kernel, plot) {
  return [...kernel.graph.nodes.values()].some(n =>
    n.type === 'building' && inRect(n.x, n.y, plot.attrs.rect));
}

function plotIsDirty(kernel, plot) {
  const r = plot.attrs.rect;
  for (const n of kernel.graph.nodes.values()) {
    if (n.attrs?.placement && inRect(n.x, n.y, r)) return true;
  }
  return false;
}

/** Begin the growth loop for a settlement: one decision per interval, forever
 *  (until ghost). Returns false on non-settlement or already-enabled. */
export function enableGrowth(kernel, settlementId, tick) {
  const s = kernel.graph.nodes.get(settlementId);
  if (!s || s.type !== 'settlement' || s.attrs.growthEnabled) return false;
  s.attrs.growthEnabled = true;
  s.attrs.peakBuildings = 0;
  kernel.scheduler.schedule(tick + GROWTH_INTERVAL_DAYS * DAY, settlementId, 'settlement_growth', -1);
  return true;
}

/** One decision per interval, fixed priority. Module-private handler. */
function onSettlementGrowth(kernel, node, ev) {
  if (!node || node.type !== 'settlement') return;   // settlement gone: loop ends
  const s = node;
  const group = kernel.graph.nodes.get(s.attrs.founderGroup);
  const tick = ev.tick;
  if (group && group.type === 'group') {
    decide(kernel, s, group, tick);
    retier(kernel, s, group, tick);
  }
  if (s.attrs.tier !== 'ghost') {
    kernel.scheduler.schedule(tick + GROWTH_INTERVAL_DAYS * DAY, s.id, 'settlement_growth', -1);
  }
}

function decide(kernel, s, group, tick) {
  const standing = buildingsIn(kernel, s.attrs.territory);
  s.attrs.peakBuildings = Math.max(s.attrs.peakBuildings ?? 0, standing.length);

  // 1. MAINTAIN (survival): worst-condition building below threshold.
  const worst = standing.filter(b => (b.attrs.condition ?? 100) < MAINTAIN_AT)
                        .sort((a, b) => a.attrs.condition - b.attrs.condition)[0];
  if (worst && group.R >= MAINTAIN_COST) {
    emitDecision(kernel, group.id, s.id, tick, 'maintain',
      `condition ${worst.attrs.condition} < ${MAINTAIN_AT}`, [worst.id]);
    maintainBuilding(kernel, group.id, worst.id, tick);
    return;
  }

  const plots = settlementPlots(kernel, s.id)
    .filter(p => p.attrs.owner === group.id && !plotIsBuilt(kernel, p));

  // 2. CLEAR (free labor): first vacant dirty plot.
  const dirty = plots.find(p => plotIsDirty(kernel, p));
  if (dirty) {
    emitDecision(kernel, group.id, s.id, tick, 'clear',
      'vacant plot carries wild growth', [dirty.id]);
    clearLand(kernel, group.id, dirty.attrs.rect, tick);
    return;
  }

  // 3. BUILD HUT (surplus): first vacant cleared plot.
  const ready = plots[0];
  if (ready && group.R >= HUT_COST + RESERVE_FLOOR) {
    const evId = emitDecision(kernel, group.id, s.id, tick, 'build_hut',
      `surplus ${group.R} ≥ ${HUT_COST + RESERVE_FLOOR}`, [ready.id]);
    const b = constructBuilding(kernel, group.id, { plotId: ready.id }, 'hut', tick);
    if (b) kernel.ledger.events[evId - 1].targets.push(b.id);
    return;
  }

  // 4. BUILD FORGE (surplus): when dwellings are established, industry follows.
  const huts = standing.filter(b => b.attrs.template === 'hut');
  const forges = standing.filter(b => b.attrs.template === 'forge');
  const craft = s.attrs.districts.find(d => d.kind === 'craft');
  // Forge rule: fire when dwellings exist and industry hasn't matched them.
  // Desired ratio: 1 forge per 2 huts (floor(huts/2)), minimum 1 when huts ≥ 1.
  // ADAPTATION (seed-7 geography): residential district yields only 1 plot (water
  // covers y=0..1, so only y=4 plot is deeded), meaning max 1 hut. Plan estimated
  // "~2 plots" — actual geography has fewer land rows. We lower the threshold from
  // huts≥2 to huts≥1, and allow 1 forge when huts≥1 (ratio: max(1, floor(huts/2))).
  const forgeTarget = Math.max(1, Math.floor(huts.length / 2));
  if (!ready && craft && huts.length >= 1 && forges.length < forgeTarget
      && group.R >= FORGE_COST + RESERVE_FLOOR) {
    // Deterministic origin scan (probe-buildings pattern): clear then try, in order.
    for (let oy = craft.rect.y0; oy + 5 <= craft.rect.y0 + craft.rect.h; oy++) {
      for (let ox = craft.rect.x0; ox + 6 <= craft.rect.x0 + craft.rect.w; ox++) {
        clearLand(kernel, group.id, { x0: ox, y0: oy, w: 6, h: 5 }, tick);
        const f = constructBuilding(kernel, group.id,
          { settlementId: s.id, x: ox, y: oy }, 'forge', tick);
        if (f) {
          emitDecision(kernel, group.id, s.id, tick, 'build_forge',
            `${huts.length} huts standing, ${forges.length} forges`, [f.id]);
          return;
        }
      }
    }
  }

  // 5. IDLE: nothing affordable/possible — an honest recorded non-choice.
  emitDecision(kernel, group.id, s.id, tick, 'idle',
    ready ? `reserve ${group.R} < ${HUT_COST + RESERVE_FLOOR}` : 'no vacant plots');
}

function retier(kernel, s, group, tick) {
  const count = buildingsIn(kernel, s.attrs.territory).length;
  const want = count >= TIER_THRESHOLDS.city ? 'city'
             : count >= TIER_THRESHOLDS.town ? 'town' : 'village';
  if (want !== s.attrs.tier && s.attrs.tier !== 'ghost') {
    kernel.ledger.emit({
      tick, type: 'tier_changed', actor: group?.id ?? null, targets: [s.id],
      attrs: { from: s.attrs.tier, to: want, buildings: count },
    });
    s.attrs.tier = want;
  }
}

export function registerGrowth(kernel) {
  kernel.on('settlement_growth', onSettlementGrowth);
}
