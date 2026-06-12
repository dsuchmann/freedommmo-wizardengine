// sim/server/protocol.js
// Spec §3.2. JSON now; binary framing later if profiling demands.
// Validation lives HERE because client messages are untrusted input.
import { SPECIES, stageAt, DAY } from '../time/metabolism.js';
import { stageFor } from '../matter/objects.js';

const VERBS = new Set(['pick', 'chop', 'harvest', 'take', 'eat', 'strike', 'combine', 'equip', 'unequip', 'move']);
const DAMAGE_TYPES = new Set(['blunt', 'sharp', 'fire', 'frost']);
const ADMIN_OPS = new Set(['pause', 'resume', 'save', 'ff']);

export function parseClientMsg(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return null; }
  if (m == null || typeof m !== 'object') return null;
  switch (m.type) {
    case 'hello':
    case 'viewport': {
      const v = m.viewport;
      if (!v || ![v.x, v.y, v.w, v.h].every(Number.isFinite)) return null;
      return { type: m.type, viewport: { x: v.x, y: v.y, w: v.w, h: v.h } };
    }
    case 'intent': {
      if (!VERBS.has(m.verb)) return null;
      if (m.verb === 'combine') {
        if (!Array.isArray(m.items)) return null;
        if (m.items.length < 2 || m.items.length > 8) return null;
        if (!m.items.every(x => Number.isInteger(x) && x > 0)) return null;   // ids are positive
        if (new Set(m.items).size !== m.items.length) return null;
        return { type: 'intent', verb: 'combine', items: m.items.slice() };
      }
      if (m.verb === 'equip') {
        if (!Number.isInteger(m.item) || m.item <= 0) return null;
        if (typeof m.slot !== 'string' || m.slot.length > 32 || !/^[a-z_0-9]+$/.test(m.slot)) return null;
        return { type: 'intent', verb: 'equip', item: m.item, slot: m.slot };
      }
      if (m.verb === 'unequip') {
        if (typeof m.slot !== 'string' || m.slot.length > 32 || !/^[a-z_0-9]+$/.test(m.slot)) return null;
        return { type: 'intent', verb: 'unequip', slot: m.slot };
      }
      if (m.verb === 'move') {
        const okStep = v => Number.isInteger(v) && v >= -1 && v <= 1;
        if (!okStep(m.dx) || !okStep(m.dy) || (m.dx === 0 && m.dy === 0)) return null;
        return { type: 'intent', verb: 'move', dx: m.dx, dy: m.dy };
      }
      if (!Number.isFinite(m.target) || !Number.isInteger(m.target)) return null;
      if (m.verb === 'strike') {
        if (!DAMAGE_TYPES.has(m.damageType)) return null;
        if (!Number.isFinite(m.amount) || m.amount <= 0) return null;
        return { type: 'intent', verb: 'strike', target: m.target,
                 damageType: m.damageType, amount: Math.min(m.amount, 50) };
      }
      return { type: 'intent', verb: m.verb, target: m.target };
    }
    case 'query':
      if (!Number.isInteger(m.id)) return null;
      return { type: 'query', id: m.id };
    case 'admin':
      if (!ADMIN_OPS.has(m.op)) return null;
      // clamp ff range: untrusted input must not fast-forward the sim into heat death
      return { type: 'admin', op: m.op, days: Number.isFinite(m.days) ? Math.min(Math.max(m.days, 1), 365) : 1 };
    default:
      return null;
  }
}

/** Wire form of an entity: render-relevant fields only (sim stays authoritative). */
export function serializeEntity(node, tick) {
  if (node.type === 'path') {
    // suppressDeltaIds and noFlux are sim-internal (privacy rule); only wear is render-relevant.
    return { id: node.id, type: 'path', x: node.x, y: node.y, wear: node.attrs.wear };
  }
  if (node.type === 'recipe') {
    // Knowledge stays private: knownBy is NOT serialized to clients.
    return { id: node.id, type: 'recipe', signature: node.attrs.signature, form: node.attrs.form };
  }
  if (node.type === 'building') {
    // Stamps are the render truth: walls/floors/doors on the grid, never sprites (locked decision 6).
    const { template, footprint, stamps } = node.attrs;
    return { id: node.id, type: 'building', x: node.x, y: node.y, template, footprint, stamps };
  }
  if (node.type === 'corpse') {
    return { id: node.id, type: 'corpse', species: node.attrs.of, x: node.x, y: node.y, body: node.attrs.E, stage: 'corpse' };
  }
  if (node.type === 'matter') {
    const { archetype = undefined, E = undefined, placement = undefined, field = undefined, biome = undefined, variant = undefined } = node.attrs ?? {};
    return { id: node.id, type: 'matter', archetype, x: node.x, y: node.y, E, placement, field, biome, variant };
  }
  const attrs = node.attrs ?? {};
  const species = attrs.species;
  const ageTicks = tick - (attrs.birthTick ?? 0);
  const stage = species ? stageAt(species, ageTicks)[0] : node.type;
  // bufferDays for ALL living entities (taxonomy needs it)
  let bufferDays = null;
  if (species) {
    const sp = SPECIES[species];
    if (sp) {
      const burnFactor = stageAt(species, ageTicks)[3];
      const dailyBurn = sp.burn * burnFactor * DAY;
      bufferDays = (dailyBurn > 0 && Number.isFinite(dailyBurn)) ? node.R / dailyBurn : null;
    }
  }
  const base = { id: node.id, type: node.type, species, x: node.x, y: node.y, body: attrs.body, stage,
                 bufferDays, ageTicks };
  // Placement identity: only spread when attrs.placement exists (wired entities)
  if (attrs.placement != null) {
    base.placement = attrs.placement;
    base.field = attrs.field;
    base.archetype = attrs.archetype;
    base.biome = attrs.biome;
    base.variant = attrs.variant;
    const sp = SPECIES[species];
    if (sp?.senescence?.start !== undefined) {
      base.senescenceStartTicks = sp.senescence.start;
    }
  }
  return base;
}

/** Wire form of an inventory/equipment item. Grains and raw hp stay sim-side. */
export function serializeItem(item) {
  const stage = item.maxHp != null ? stageFor(item.hp, item.maxHp) : 'intact';
  return { id: item.id, kind: item.kind, archetype: item.archetype ?? null, E: item.E, stage };
}

export const snapshotMsg = (tick, playerId, entities, deltas) =>
  ({ type: 'snapshot', tick, playerId, entities, deltas });
export const tickDeltaMsg = (tick, upserts, removed, player, deltas = []) =>
  ({ type: 'tick-delta', tick, upserts, removed, player, deltas });
export const eventsMsg = (tick, events) => ({ type: 'events', tick, events });
export const timeMsg = tick => ({ type: 'time', tick, day: Math.floor(tick / DAY) });
