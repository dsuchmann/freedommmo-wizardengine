// Dev debug overlay: draws live sim state (worn paths, road segments, deltas,
// event ticker) as translucent shapes. READ-ONLY over window._simClient.
// Toggle: key 9. Pure collector below is node-testable (no DOM at module top).
// Wire reality 2026-06-12: settlement geometry (territory/districts/plots) is
// NOT serialized to clients; only stripped events arrive. Extend
// collectDebugDrawables when the sim lane puts those on the wire — never fake.

const EVENT_CAP = 50;

export function collectDebugDrawables(sim) {
  const out = { paths: [], roads: [], deltas: [], tick: sim?.tick ?? -1 };
  if (!sim?.entities) return out;
  for (const e of sim.entities.values()) {
    if (e.type === 'path') out.paths.push({ x: e.x, y: e.y, wear: e.wear ?? 0 });
    else if (e.type === 'matter' && e.archetype === 'road_segment') out.roads.push({ x: e.x, y: e.y });
  }
  for (const d of sim.deltas ?? []) {
    if (d.x != null && d.y != null) out.deltas.push({ x: d.x, y: d.y, kind: d.kind });
  }
  return out;
}

export function accumulateEvents(seen, batch) {
  const have = new Set(seen.map(e => e.id));
  for (const e of batch ?? []) if (!have.has(e.id)) seen.push(e);
  if (seen.length > EVENT_CAP) seen.splice(0, seen.length - EVENT_CAP);
  return seen;
}
