// src/life/motion-queue.js — Cue system for chaining multiple motions.
// "Walk over, dance, then clap" → queue of [dance, clap] that plays sequentially.
// Each motion plays to completion before the next starts.

import { playMotion, isMotionActive, stopMotion } from '../render/humanoid-player-renderer.js';

let _queue = [];        // array of { program, count }
let _playing = false;
let _checkInterval = null;

/** Queue a motion to play after the current one finishes. */
export function queueMotion(program, { count = 1 } = {}) {
  _queue.push({ program, count });
  if (!_playing) _advance();
}

/** Queue multiple motions in order. */
export function queueSequence(programs) {
  for (const p of programs) {
    _queue.push({ program: p.program || p, count: p.count || 1 });
  }
  if (!_playing) _advance();
}

/** Clear the queue and stop current motion. */
export function clearQueue() {
  _queue = [];
  _playing = false;
  stopMotion(true);
  if (_checkInterval) { clearInterval(_checkInterval); _checkInterval = null; }
}

/** How many motions are queued (including currently playing). */
export function queueLength() {
  return _queue.length + (_playing ? 1 : 0);
}

function _advance() {
  if (_queue.length === 0) {
    _playing = false;
    if (_checkInterval) { clearInterval(_checkInterval); _checkInterval = null; }
    return;
  }
  const next = _queue.shift();
  _playing = true;
  playMotion(next.program, { count: next.count });

  // Poll for completion
  if (_checkInterval) clearInterval(_checkInterval);
  _checkInterval = setInterval(() => {
    if (!isMotionActive()) _advance();
  }, 100);
}
