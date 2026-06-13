// sim/story/narrator.js — P4 Task 1: causal chain walker + context assembler.
// Walks the ledger's causal chain from any node back to its root cause,
// then assembles a mechanical narrative context. No LLM, no invention.
// When the mind system exists, narrate() will compile a prompt and call the LLM.
import { CHRONICLE_EVENTS } from '../chronicle/chronicle.js';

/** Infer domain string from event type. Chronicle events use the CHRONICLE_EVENTS
 *  map; others are classified by prefix/name. */
export function inferDomain(type) {
  // Chronicle ledger events are prefixed 'chronicle_<originalType>'
  if (type.startsWith('chronicle_')) {
    const inner = type.slice('chronicle_'.length);
    return CHRONICLE_EVENTS.get(inner) ?? 'history';
  }
  if (type === 'settlement_founded' || type === 'genesis_group_founded') return 'society';
  if (type === 'ruins_placed') return 'society';
  if (type === 'plot_assigned') return 'economy';
  if (type === 'road_built' || type === 'road_funded') return 'infrastructure';
  if (type === 'birth' || type === 'death' || type === 'death_check') return 'ecology';
  if (type === 'harvest' || type === 'pick' || type === 'chop') return 'economy';
  if (type === 'combine' || type === 'recipe_discovered') return 'craft';
  if (type === 'strike') return 'conflict';
  return 'world';
}

/** One-line mechanical description of an event. No LLM, no invention. */
export function summarizeEvent(ev) {
  const loc = ev.attrs?.x != null ? ` at (${ev.attrs.x},${ev.attrs.y})` : '';
  const mc = ev.attrs?.macroCell ? ` in region ${ev.attrs.macroCell}` : '';
  const age = ev.attrs?.age != null ? `, age ${ev.attrs.age}` : '';
  switch (ev.type) {
    case 'settlement_founded': return `Settlement founded${loc} (score ${ev.attrs?.score?.toFixed?.(2) ?? '?'})`;
    case 'genesis_group_founded': return `Genesis group formed${loc}${mc}`;
    case 'ruins_placed': return `Ruins placed${loc}${mc}`;
    case 'plot_assigned': return `Plot assigned from ${ev.attrs?.from ?? '?'} to ${ev.attrs?.to ?? '?'}`;
    case 'road_built': return `Road built${loc}`;
    case 'road_funded': return `Road funded${loc}`;
    default:
      if (ev.type.startsWith('chronicle_')) {
        const inner = ev.type.slice('chronicle_'.length);
        return `Chronicle: ${inner.replace(/_/g, ' ')}${mc}${age}`;
      }
      return `${ev.type}${loc}${mc}`;
  }
}

/** Build a multi-sentence mechanical summary from node + events. */
export function buildSummary(node, events) {
  if (events.length === 0) {
    return `${node.type} #${node.id} at (${node.x},${node.y}) has no recorded causal history.`;
  }
  const parts = [];
  const state = node.attrs?.state;
  if (state === 'ruined') {
    parts.push(`${node.type} #${node.id} at (${node.x},${node.y}) is in ruins.`);
  } else {
    parts.push(`${node.type} #${node.id} at (${node.x},${node.y}).`);
  }
  // Group chronicle events
  const chronicleEvs = events.filter(e => e.type.startsWith('chronicle_'));
  const directEvs = events.filter(e => !e.type.startsWith('chronicle_'));
  if (chronicleEvs.length > 0) {
    const types = chronicleEvs.map(e => e.type.slice('chronicle_'.length).replace(/_/g, ' '));
    parts.push(`History: ${types.join(' -> ')} (${chronicleEvs.length} chronicle events).`);
  }
  if (directEvs.length > 0) {
    parts.push(`Founded via ${directEvs.map(e => `${e.type} [#${e.id}]`).join(', ')}.`);
  }
  return parts.join(' ');
}

/** Walk the causal chain from a node back to the root event.
 *  Returns events ordered root-first (oldest). Empty for boot-scope nodes. */
export function traceHistory(kernel, nodeId, maxDepth = 20) {
  const node = kernel.graph.nodes.get(nodeId);
  if (!node) return [];
  if (node.createdByEvent == null) return []; // boot-scope
  const chain = [];
  let eventId = node.createdByEvent;
  const visited = new Set();
  while (eventId != null && chain.length < maxDepth) {
    if (visited.has(eventId)) break;
    visited.add(eventId);
    const ev = kernel.ledger.events[eventId - 1];
    if (!ev || ev.id !== eventId) break; // safety: ID mismatch means sparse ledger
    chain.push(ev);
    eventId = ev.causeEventId;
  }
  chain.reverse(); // root-first
  return chain;
}

/** Assemble structured narrative context for a node.
 *  Returns { node, events, summary } or null if node doesn't exist. */
export function assembleContext(kernel, nodeId) {
  const node = kernel.graph.nodes.get(nodeId);
  if (!node) return null;

  // Direct causal chain
  const chain = traceHistory(kernel, nodeId);

  // Also include chronicle events referenced in attrs.chronicle
  const chronicleEventIds = node.attrs?.chronicle ?? [];
  const chronicleEvents = [];
  for (const cid of chronicleEventIds) {
    // chronicleId is the deterministic hash from regionChronicle, not ledger ID.
    // Find ledger events that reference this chronicleId.
    const found = kernel.ledger.events.find(e => e.attrs?.chronicleId === cid);
    if (found && !chain.some(c => c.id === found.id)) {
      chronicleEvents.push(found);
    }
  }
  // Sort chronicle events by ledger ID (emission order = chronological)
  chronicleEvents.sort((a, b) => a.id - b.id);

  const allEvents = [...chronicleEvents, ...chain];

  const events = allEvents.map(ev => ({
    eventId: ev.id,
    type: ev.type,
    domain: ev.attrs?.domain ?? inferDomain(ev.type),
    age: ev.attrs?.age ?? undefined,
    chronicleId: ev.attrs?.chronicleId ?? undefined,
    summary: summarizeEvent(ev),
  }));

  const summary = buildSummary(node, allEvents);

  return {
    node: { id: node.id, type: node.type, x: node.x, y: node.y, attrs: node.attrs },
    events,
    summary,
  };
}

/** Honest-absence wrapper. Today: mechanical context assembly.
 *  When the mind system exists, this will compile a prompt and call the LLM. */
export function narrate(kernel, nodeId) {
  return assembleContext(kernel, nodeId);
}
