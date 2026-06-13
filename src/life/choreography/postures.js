// src/life/choreography/postures.js — Named postures (joint snapshots) and
// the transition graph between them. pathBetween(from, to) returns the
// sequence of transition program IDs to chain before playing a choreography
// that requires a specific starting posture.

/** Named postures: joint angles that define each body state. */
export const POSTURES = {
  stand:      {},
  sit:        { thigh_l: -90, thigh_r: -90, shin_l: 90, shin_r: 90 },
  kneel:      { thigh_l: -90, thigh_r: -90, shin_l: 130, shin_r: 130 },
  crouch:     { thigh_l: -70, thigh_r: -70, shin_l: 100, shin_r: 100, spine: -15 },
  lie_back:   { thigh_l: -90, thigh_r: -90, spine: -30 },
  lie_belly:  { thigh_l: 10, thigh_r: 10, spine: 30 },
  crawl:      { thigh_l: -80, thigh_r: -80, shin_l: 90, shin_r: 90, spine: -20, arm_u_l: -60, arm_u_r: 60 },
  handstand:  { spine: -30, arm_u_l: -170, arm_u_r: 170, thigh_l: 20, thigh_r: 20 },
  headstand:  { spine: -30, head: -60, thigh_l: 20, thigh_r: 20 },
  tiptoe:     { foot_l: -25, foot_r: -25 },
  plank:      { thigh_l: -90, thigh_r: -90, spine: -30, arm_u_l: -90, arm_u_r: 90 },
  pushup_down:{ thigh_l: -90, thigh_r: -90, spine: -30, arm_u_l: -120, arm_u_r: 120, arm_f_l: -90, arm_f_r: 90 },
  flex:       { arm_u_l: -140, arm_u_r: 140, arm_f_l: -120, arm_f_r: 120 },
  pray:       { arm_u_l: -40, arm_u_r: 40, arm_f_l: -90, arm_f_r: 90, head: -15 },
};

/** Transition edges: from → to → transition program id.
 *  Each transition is a choreography JSON in src/life/choreography/ that
 *  animates from one posture to another. Missing edges = no direct transition. */
const EDGES = {
  stand:     { sit: 'sit_down', kneel: 'kneel', crouch: 'crouch', lie_back: 'lie_down_back', lie_belly: 'lie_down_belly', crawl: 'crawl', tiptoe: 'tiptoe', flex: 'flex', pray: 'pray' },
  sit:       { stand: 'sit_down' },     // sit_down plays in reverse conceptually; for now same id
  kneel:     { stand: 'kneel' },
  crouch:    { stand: 'crouch' },
  lie_back:  { stand: 'lie_down_back' },
  lie_belly: { stand: 'lie_down_belly' },
  crawl:     { stand: 'crawl' },
  tiptoe:    { stand: 'tiptoe' },
  flex:      { stand: 'flex' },
  pray:      { stand: 'pray' },
  handstand: { stand: 'handstand' },
  headstand: { stand: 'headstand' },
  plank:     { stand: 'plank' },
};

/** BFS shortest path from posture `from` to posture `to`.
 *  Returns array of { posture, transitionId } steps, or null if unreachable. */
export function pathBetween(from, to) {
  if (from === to) return [];
  const visited = new Set([from]);
  const queue = [[from, []]];
  while (queue.length) {
    const [cur, path] = queue.shift();
    const neighbors = EDGES[cur];
    if (!neighbors) continue;
    for (const [next, transId] of Object.entries(neighbors)) {
      if (visited.has(next)) continue;
      const newPath = [...path, { posture: next, transitionId: transId }];
      if (next === to) return newPath;
      visited.add(next);
      queue.push([next, newPath]);
    }
  }
  return null; // unreachable
}

/** Get joint snapshot for a named posture. */
export function postureJoints(name) {
  return POSTURES[name] ?? {};
}
