// Interaction taxonomy (Plan B): the enumerable space of everything a player
// could ever do with an object. Verbs are DATA — implementing one is a system.
// owner: 'client' (resolved locally, e.g. traversal physics) or 'sim'
// (needs the simulation, e.g. destroy -> permanence delta).
// preconditions: declarative hints for future systems; empty = always offered
// once the verb is registered. No verb here implies any behavior exists.

export var CATEGORIES = ['traversal', 'manipulation', 'use', 'observation', 'social'];

export var VERBS = [
  // traversal — auto-filled from collision volumes (interaction-registry.js)
  { id: 'traversal.jump-over',     category: 'traversal', owner: 'client', preconditions: ['finite-solid-height'] },
  { id: 'traversal.stand-on',      category: 'traversal', owner: 'client', preconditions: ['standable-top'] },
  { id: 'traversal.walk-up',       category: 'traversal', owner: 'client', preconditions: ['ramp'] },
  { id: 'traversal.shelter-under', category: 'traversal', owner: 'client', preconditions: ['overhead'] },
  // manipulation — sim-owned: world state changes via permanence deltas
  { id: 'manipulation.destroy', category: 'manipulation', owner: 'sim', preconditions: [] },
  { id: 'manipulation.harvest', category: 'manipulation', owner: 'sim', preconditions: [] },
  { id: 'manipulation.chop',    category: 'manipulation', owner: 'sim', preconditions: [] },
  { id: 'manipulation.mine',    category: 'manipulation', owner: 'sim', preconditions: [] },
  { id: 'manipulation.push',    category: 'manipulation', owner: 'sim', preconditions: [] },
  { id: 'manipulation.ignite',  category: 'manipulation', owner: 'sim', preconditions: [] },
  { id: 'manipulation.pick',    category: 'manipulation', owner: 'sim', preconditions: [] },
  // use — sim-owned semantic interactions
  { id: 'use.read',     category: 'use', owner: 'sim', preconditions: [] },
  { id: 'use.activate', category: 'use', owner: 'sim', preconditions: [] },
  { id: 'use.offer',    category: 'use', owner: 'sim', preconditions: [] },
  { id: 'use.enchant',  category: 'use', owner: 'sim', preconditions: [] },
  { id: 'use.summon',   category: 'use', owner: 'sim', preconditions: [] },
  { id: 'use.unlock',   category: 'use', owner: 'sim', preconditions: [] },
  { id: 'use.pray',     category: 'use', owner: 'sim', preconditions: [] },
  { id: 'use.sit',      category: 'use', owner: 'client', preconditions: ['standable-top'] },
  // observation — mostly client-presentable once content exists
  { id: 'observation.inspect', category: 'observation', owner: 'sim', preconditions: [] },
  { id: 'observation.listen',  category: 'observation', owner: 'sim', preconditions: [] },
  // social — objects as social loci (notice boards, shrines); sim-owned
  { id: 'social.post',   category: 'social', owner: 'sim', preconditions: [] },
  { id: 'social.gather', category: 'social', owner: 'sim', preconditions: [] },
];

var _byId = null;
export function verbById(id) {
  if (!_byId) { _byId = {}; for (var i = 0; i < VERBS.length; i++) _byId[VERBS[i].id] = VERBS[i]; }
  return _byId[id] || null;
}
