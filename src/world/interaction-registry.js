// Interaction registry (Plan B): sparse map archetype(+state) -> semantic verb
// ids. Traversal verbs are NEVER stored here — they auto-fill from collision
// volume geometry (an object with finite solidH advertises jump-over; a topZ
// advertises stand-on). Everything else starts ABSENT: an altar with no
// registered use verbs is just geometry until the sim lane gives it meaning.
// Keys: 'name' or 'name@state'. Values: arrays of verb ids from the taxonomy.

export var REGISTRY = {};

export function traversalVerbs(volume) {
  if (!volume) return [];
  var ids = [];
  if (Number.isFinite(volume.solidH) && volume.solidH > 0) ids.push('traversal.jump-over');
  if (volume.topZ != null) ids.push('traversal.stand-on');
  if (volume.rampW > 0) ids.push('traversal.walk-up');
  if (volume.overheadZ != null) ids.push('traversal.shelter-under');
  return ids;
}

export function verbsFor(name, state, volume) {
  var sem = (state && REGISTRY[name + '@' + state]) || REGISTRY[name] || [];
  return traversalVerbs(volume).concat(sem);
}
