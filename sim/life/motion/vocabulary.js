// sim/life/motion/vocabulary.js — the action vocabulary (motion-DSL spec §6).
// 18 verbs; schemas list REQUIRED fields. Anything not expressible here is not
// an action — the planner can only emit these.
//
// NOTE: `use` requires `item`. The planner emits `item: '$last'` — the ONLY
// placeholder token in the vocabulary. The executor resolves '$last' to the
// most recently acquired item at execution time (the harvested item id is
// unknowable at plan time).
export const ACTION_SCHEMAS = {
  move_to:     ['x', 'y'],
  follow:      ['target'],
  face:        ['target'],
  gesture:     ['name'],
  look_at:     ['target'],
  pick_up:     ['target', 'x', 'y'],
  drop:        ['item'],
  use:         ['mode', 'item'],
  investigate: ['target', 'x', 'y'],
  sit:         [],
  sleep:       [],
  attack:      ['target'],
  talk:        ['target'],
  trade:       ['target'],
  emote:       ['name'],
  dance:       [],
  jump:        [],
  run:         ['x', 'y'],
  wait:        ['ticks'],
};

/** Returns [] when valid, else violation strings. */
export function validateAction(action) {
  const req = ACTION_SCHEMAS[action?.verb];
  if (!req) return [`unknown verb ${action?.verb}`];
  return req.filter(f => action[f] === undefined).map(f => `${action.verb}: missing ${f}`);
}
