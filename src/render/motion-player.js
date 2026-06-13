// src/render/motion-player.js — Pass 4 L3: binds choreography programs into
// the renderer. playMotion() builds a joint track via solveProgramTrack and
// exposes currentJoints(nowMs) for the humanoid renderer to consume.
// Phase support: if program.phases exists, track = enter ++ loop×count ++
// (climax?) ++ exit; stopMotion() is graceful (finish cycle → exit → stop);
// hard stop only on movement input.
// 10 ticks/sec wall time; lerp between ticks for smooth motion.
import { solveProgramTrack } from '../../sim/life/motion/executor.js';

const TICKS_PER_SEC = 10;
const MS_PER_TICK = 1000 / TICKS_PER_SEC;

/** @typedef {{ frames: {tick:number, joints:Record<string,number>}[] }} Track */

let _rig = null;
let _active = null; // { track, startMs, totalTicks, stopping, stoppedAt }

/** Provide the rig reference (called once from the renderer when rig loads). */
export function setMotionRig(r) { _rig = r; }

/** Build track frames from a program, handling phases if present. */
function buildTrack(program, count) {
  if (!_rig) return null;
  const seed = Date.now();
  if (program.phases) {
    // Phase-aware: enter ++ loop×count ++ climax? ++ exit
    const parts = [];
    let tick = 0;
    if (program.phases.enter) {
      const t = solveProgramTrack(_rig, { ...program, root: program.phases.enter }, { seed, entityId: 0, startTick: tick });
      parts.push(...t.frames);
      tick = t.frames.length ? t.frames[t.frames.length - 1].tick : tick;
    }
    const loopStart = parts.length;
    for (let i = 0; i < count; i++) {
      const t = solveProgramTrack(_rig, { ...program, root: program.phases.loop }, { seed, entityId: 0, startTick: tick });
      parts.push(...t.frames);
      tick = t.frames.length ? t.frames[t.frames.length - 1].tick : tick;
    }
    const loopEnd = parts.length;
    if (program.phases.climax) {
      const t = solveProgramTrack(_rig, { ...program, root: program.phases.climax }, { seed, entityId: 0, startTick: tick });
      parts.push(...t.frames);
      tick = t.frames.length ? t.frames[t.frames.length - 1].tick : tick;
    }
    if (program.phases.exit) {
      const t = solveProgramTrack(_rig, { ...program, root: program.phases.exit }, { seed, entityId: 0, startTick: tick });
      parts.push(...t.frames);
      tick = t.frames.length ? t.frames[t.frames.length - 1].tick : tick;
    }
    return { frames: parts, loopStart, loopEnd };
  }
  // Phaseless: repeat whole program count times
  const frames = [];
  let tick = 0;
  for (let i = 0; i < count; i++) {
    const t = solveProgramTrack(_rig, program, { seed, entityId: 0, startTick: tick });
    frames.push(...t.frames);
    tick = t.frames.length ? t.frames[t.frames.length - 1].tick : tick;
  }
  return { frames, loopStart: -1, loopEnd: -1 };
}

/** Start playing a motion program. count = number of loop repetitions. */
export function playMotion(program, { count = 1 } = {}) {
  const track = buildTrack(program, count);
  if (!track || track.frames.length === 0) return false;
  _active = {
    track,
    startMs: performance.now(),
    totalTicks: track.frames[track.frames.length - 1].tick - (track.frames[0]?.tick ?? 0),
    stopping: false,
    stoppedAt: null,
  };
  return true;
}

/** Graceful stop: let current cycle finish, play exit, then stop.
 *  hard=true: stop immediately (movement input cancels performance). */
export function stopMotion(hard = false) {
  if (!_active) return;
  if (hard) { _active = null; return; }
  _active.stopping = true;
}

/** Is a motion currently playing? */
export function isMotionActive() { return _active !== null; }

/** Get interpolated joints at the current wall-clock time.
 *  Returns null when no motion is active or motion has ended. */
export function currentJoints(nowMs) {
  if (!_active) return null;
  const elapsed = nowMs - _active.startMs;
  const tickF = elapsed / MS_PER_TICK;
  const frames = _active.track.frames;
  const baseTick = frames[0]?.tick ?? 0;
  const rel = tickF + baseTick;

  // Past the end → auto-stop
  const lastTick = frames[frames.length - 1].tick;
  if (rel >= lastTick) {
    _active = null;
    return null;
  }

  // Graceful stop: if stopping, let it play to the end (exit frames are already baked in)
  // For phaseless programs, stopping = immediate end after current frame
  if (_active.stopping && _active.track.loopStart < 0) {
    _active = null;
    return null;
  }

  // Find surrounding frames and lerp
  let lo = 0, hi = frames.length - 1;
  for (let i = 0; i < frames.length - 1; i++) {
    if (frames[i].tick <= rel && frames[i + 1].tick > rel) {
      lo = i; hi = i + 1; break;
    }
  }
  if (frames[hi].tick <= rel) { lo = hi; }

  const a = frames[lo], b = frames[hi];
  const span = b.tick - a.tick;
  const t = span > 0 ? (rel - a.tick) / span : 0;

  const joints = {};
  const allKeys = new Set([...Object.keys(a.joints), ...Object.keys(b.joints)]);
  for (const k of allKeys) {
    const va = a.joints[k] ?? 0;
    const vb = b.joints[k] ?? 0;
    joints[k] = va + (vb - va) * t;
  }
  return joints;
}
