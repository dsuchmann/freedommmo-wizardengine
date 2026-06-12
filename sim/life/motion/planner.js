// sim/life/motion/planner.js — intent phrase → action list (spec §3 Action Planner).
// CANONICAL_INTENTS is the one-time-authored registry (feedback_motion_one_time_authoring):
// each entry was authored ONCE (by an LLM or a human, offline) and replays forever.
// Unknown phrases return null — honest absence; runtime NEVER generates plans.
export const CANONICAL_INTENTS = {
  'pick the berry and eat it': ctx => [
    { verb: 'move_to', x: ctx.bush.x, y: ctx.bush.y },
    { verb: 'pick_up', target: ctx.bush.id, x: ctx.bush.x, y: ctx.bush.y },
    { verb: 'use', mode: 'eat', item: '$last' },
  ],
};

/** Returns an action list or null (unknown phrase). */
export function plan(phrase, ctx) {
  const entry = CANONICAL_INTENTS[phrase];
  return entry ? entry(ctx) : null;
}
