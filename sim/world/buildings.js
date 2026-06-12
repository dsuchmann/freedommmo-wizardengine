// sim/world/buildings.js — P4: runtime building construction (locked decision 6).
// A group pays pooled time (R) through the nurture channel to stamp a blueprint
// onto a deeded plot, or into a district of its own settlement: one 'building'
// node holding the stamp grid (walls/doors/floors + walkable flags), interior
// features as provenanced matter nodes (M2 pattern), NPC slots resolved to tiles
// (Agency's landing pad — data only, no NPCs until Pass 4 Life).
// Walls are impassable claims: move() refuses non-walkable stamps; planRoute
// avoids them via opts.blocked (routing stays pure — callers derive the wall set
// with wallTiles()). Footprint tiles get 'claimed' suppression deltas (roads
// 'paved' precedent) so baseline flora never materializes under a building,
// across reboots. Condition decays daily; an unmaintained building falls — its
// E returns to ambient ('decayed'), suppression heals (flora regrows), and the
// interior features REMAIN in place as loose ruins (takeable matter).
// This is the RUNTIME path; sim/world/construct.js compileBlueprint stays the
// BOOT path (mints E inside graph.boot — reusing it here would conjure time).
// HONEST ABSENCES: labor-only construction (empty grain yields — material-
// consuming construction is declared backlog, roads precedent); no sprite
// binding / roof-canopy fade (X1 asset lane).
// TODO(save/load): runtime building nodes are not rehydrated on load — claimed
// deltas persist but can then never heal (same backlog as roads/paths/
// settlements/crossings).
import { expandBlueprint, BLUEPRINT_TEMPLATES } from './blueprints.js';
import { FEATURE_E } from './construct.js';
import { tilePlacements } from './baseline.js';
import { tileCost } from './routing.js';
import { transfer, DAY } from '../time/metabolism.js';

export const BUILD_E_PER_STAMP = 20;        // tu of group R per wall/door/floor stamp
export const BUILDING_CONDITION_MAX = 100;  // bounded state (hp precedent)
export const BUILDING_DECAY_PER_DAY = 1;    // unmaintained building lasts 100 days
export const MAINTAIN_COST = 10;            // tu to restore full condition
const DECAY_INTERVAL = DAY;

function inRect(x, y, r) { return x >= r.x0 && x < r.x0 + r.w && y >= r.y0 && y < r.y0 + r.h; }
function rectsOverlap(a, b) {
  return a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w && a.y0 < b.y0 + b.h && b.y0 < a.y0 + a.h;
}

/** The building stamp covering tile (x,y), or undefined.
 *  O(buildings × stamps) — index when settlements scale (roadAt backlog twin). */
export function buildingStampAt(kernel, x, y) {
  for (const n of kernel.graph.nodes.values()) {
    if (n.type !== 'building' || !inRect(x, y, n.attrs.footprint)) continue;
    const st = n.attrs.stamps.find(s => s.x === x && s.y === y);
    if (st) return st;
  }
  return undefined;
}

/** Set of 'x,y' keys for every non-walkable stamp (walls). For planRoute opts.blocked. */
export function wallTiles(kernel) {
  const out = new Set();
  for (const n of kernel.graph.nodes.values()) {
    if (n.type !== 'building') continue;
    for (const st of n.attrs.stamps) if (!st.walkable) out.add(`${st.x},${st.y}`);
  }
  return out;
}

/** Group `groupId` constructs leaf template `templateId` at `placement`:
 *  { plotId } — on a plot the group owns (footprint must fit the plot rect), or
 *  { settlementId, x, y } — at an explicit origin fully inside one district of a
 *  settlement the group founded (workshops land in the craft district).
 *  Refuses (null, side-effect-free) on: missing/non-group actor; unknown or
 *  compound template; unowned plot / footprint larger than plot; origin outside
 *  every district; footprint overlapping an existing building; any water tile;
 *  any materialized placement node in the footprint (site must be CLEARED first —
 *  take/chop are the clearing verbs); group.R < cost.
 *  Cost = stamps × BUILD_E_PER_STAMP + Σ FEATURE_E. Paid via nurture (0.95). */
export function constructBuilding(kernel, groupId, placement, templateId, tick) {
  const group = kernel.graph.nodes.get(groupId);
  if (!group || group.type !== 'group') return null;
  const template = BLUEPRINT_TEMPLATES[templateId];
  if (!template || template.children) return null;     // leaf templates only
  const { width: w, height: h } = template.footprint;
  let ox, oy;
  if (placement.plotId != null) {
    const plot = kernel.graph.nodes.get(placement.plotId);
    if (!plot || plot.type !== 'plot' || plot.attrs.owner !== groupId) return null;
    const r = plot.attrs.rect;
    if (w > r.w || h > r.h) return null;
    ox = r.x0; oy = r.y0;
  } else if (placement.settlementId != null) {
    const s = kernel.graph.nodes.get(placement.settlementId);
    if (!s || s.type !== 'settlement' || s.attrs.founderGroup !== groupId) return null;
    ox = placement.x; oy = placement.y;
    const fits = s.attrs.districts.some(d =>
      ox >= d.rect.x0 && oy >= d.rect.y0 &&
      ox + w <= d.rect.x0 + d.rect.w && oy + h <= d.rect.y0 + d.rect.h);
    if (!fits) return null;
  } else return null;
  const fp = { x0: ox, y0: oy, w, h };
  for (const n of kernel.graph.nodes.values()) {
    if (n.type === 'building' && rectsOverlap(fp, n.attrs.footprint)) return null;
  }
  for (let yy = oy; yy < oy + h; yy++)
    for (let xx = ox; xx < ox + w; xx++)
      if (tileCost(xx, yy) === Infinity) return null;
  for (const n of kernel.graph.nodes.values()) {
    if (n.attrs?.placement && inRect(n.x, n.y, fp)) return null;  // site not cleared
  }
  const { leaves } = expandBlueprint(templateId, ox, oy);
  const leaf = leaves[0];
  const stampCost = leaf.stamps.length * BUILD_E_PER_STAMP;
  const featureCost = leaf.features.reduce(
    (s, f) => s + (FEATURE_E[f.type] ?? FEATURE_E.default), 0);
  const cost = stampCost + featureCost;
  if (group.R < cost) return null;
  const evId = kernel.ledger.emit({
    tick, type: 'building_constructed', actor: groupId, targets: [],
    attrs: { template: templateId, x0: ox, y0: oy, cost,
             plot: placement.plotId ?? null, settlement: placement.settlementId ?? null },
  });
  group.R -= cost;
  // NPC slots resolved to tiles (Agency's landing pad — data only until Pass 4 Life).
  const featXY = new Map(leaf.features.map(f => [f.type, { x: f.x, y: f.y }]));
  const npcSlots = leaf.npcSlots.map(sl => ({
    role: sl.role,
    workTile: sl.workplace ? (featXY.get(sl.workplace) ?? null) : null,
    sleepTile: sl.sleep ? (featXY.get(sl.sleep) ?? null) : null,
  }));
  const building = kernel.graph.createNode({
    type: 'building', tick, x: ox, y: oy, causeEventId: evId,
    attrs: { template: leaf.template, footprint: fp, stamps: leaf.stamps, npcSlots,
             E: transfer(stampCost, 'nurture', kernel.ledger),
             condition: BUILDING_CONDITION_MAX, suppressDeltaIds: [], noFlux: true },
  });
  kernel.ledger.events[evId - 1].targets.push(building.id);
  for (const f of leaf.features) {
    const e = FEATURE_E[f.type] ?? FEATURE_E.default;
    const feat = kernel.graph.createNode({
      type: 'matter', tick, x: f.x, y: f.y, causeEventId: evId,
      attrs: { archetype: f.type, E: transfer(e, 'nurture', kernel.ledger),
               provides: f.provides, building: building.id, noFlux: true },
    });
    kernel.ledger.events[evId - 1].targets.push(feat.id);
  }
  for (let yy = oy; yy < oy + h; yy++) for (let xx = ox; xx < ox + w; xx++) {
    for (const p of tilePlacements(xx, yy)) {
      const id = kernel.deltas.push({
        tick, x: xx, y: yy, target: `placement:${p.key}`, kind: 'claimed',
        attrs: { building: building.id },
      });
      building.attrs.suppressDeltaIds.push(id);
    }
  }
  kernel.scheduler.schedule(tick + DECAY_INTERVAL, building.id, 'building_decay', -1);
  return building;
}

/** Group pays MAINTAIN_COST to restore a building to full condition. */
export function maintainBuilding(kernel, groupId, buildingId, tick) {
  const group = kernel.graph.nodes.get(groupId);
  const b = kernel.graph.nodes.get(buildingId);
  if (!group || group.type !== 'group' || !b || b.type !== 'building') return false;
  if (b.attrs.condition == null) return false;          // boot buildings don't decay
  if (group.R < MAINTAIN_COST) return false;
  kernel.ledger.emit({
    tick, type: 'building_maintained', actor: groupId, targets: [buildingId],
    attrs: { cost: MAINTAIN_COST },
  });
  group.R -= MAINTAIN_COST;
  b.attrs.E += transfer(MAINTAIN_COST, 'nurture', kernel.ledger);
  b.attrs.condition = BUILDING_CONDITION_MAX;
  return true;
}

/** Daily decay. Condition 0 → E returns to ambient, suppression heals, features
 *  become orphaned ruins (building: null), node removed. */
function onBuildingDecay(kernel, node, ev) {
  if (!node) return;
  node.attrs.condition = Math.max(0, node.attrs.condition - BUILDING_DECAY_PER_DAY);
  if (node.attrs.condition > 0) {
    kernel.scheduler.schedule(ev.tick + DECAY_INTERVAL, node.id, 'building_decay', -1);
    return;
  }
  kernel.ledger.count('decayed', node.attrs.E);          // decay_gone precedent
  node.attrs.E = 0;
  for (const id of node.attrs.suppressDeltaIds) kernel.deltas.remove(id);
  node.attrs.suppressDeltaIds = [];
  for (const n of kernel.graph.nodes.values()) {
    if (n.attrs?.building === node.id) n.attrs.building = null;   // ruins remain
  }
  kernel.ledger.emit({
    tick: ev.tick, type: 'building_gone', targets: [node.id],
    attrs: { x: node.x, y: node.y, template: node.attrs.template },
  });
  kernel.graph.removeNode(node.id);
}

export function registerBuildings(kernel) {
  kernel.on('building_decay', onBuildingDecay);
}
