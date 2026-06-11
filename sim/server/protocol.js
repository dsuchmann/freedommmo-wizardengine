// sim/server/protocol.js
// Spec §3.2. JSON now; binary framing later if profiling demands.
// Validation lives HERE because client messages are untrusted input.
import { stageAt, DAY } from '../time/metabolism.js';

const VERBS = new Set(['pick', 'chop']);
const ADMIN_OPS = new Set(['pause', 'resume', 'save', 'ff']);

export function parseClientMsg(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return null; }
  if (m == null || typeof m !== 'object') return null;
  switch (m.type) {
    case 'hello': {
      const v = m.viewport;
      if (!v || ![v.x, v.y, v.w, v.h].every(Number.isFinite)) return null;
      return { type: 'hello', viewport: { x: v.x, y: v.y, w: v.w, h: v.h } };
    }
    case 'intent':
      if (!VERBS.has(m.verb) || !Number.isInteger(m.target)) return null;
      return { type: 'intent', verb: m.verb, target: m.target };
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
  if (node.type === 'corpse') {
    return { id: node.id, type: 'corpse', species: node.attrs.of, x: node.x, y: node.y, body: node.attrs.E, stage: 'corpse' };
  }
  const species = node.attrs.species;
  const stage = species ? stageAt(species, tick - node.attrs.birthTick)[0] : node.type;
  return { id: node.id, type: node.type, species, x: node.x, y: node.y, body: node.attrs.body, stage };
}

export const snapshotMsg = (tick, playerId, entities, deltas) =>
  ({ type: 'snapshot', tick, playerId, entities, deltas });
export const tickDeltaMsg = (tick, upserts, removed, player) =>
  ({ type: 'tick-delta', tick, upserts, removed, player });
export const eventsMsg = (tick, events) => ({ type: 'events', tick, events });
export const timeMsg = tick => ({ type: 'time', tick, day: Math.floor(tick / DAY) });
