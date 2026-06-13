// src/render/motion-player.js — Pass 4 L3: binds choreography programs into
// the renderer. playMotion() builds a joint track and exposes
// currentJoints(nowMs) for the humanoid renderer to consume.
// Phase support: if program.phases exists, track = enter ++ loop×count ++
// (climax?) ++ exit; stopMotion() is graceful (finish cycle → exit → stop);
// hard stop only on movement input.
// 10 ticks/sec wall time; lerp between ticks for smooth motion.
//
// BROWSER-SAFE: no sim/ imports (executor.js pulls node:fs via rig.js).
// Pure-math helpers (rng, variant, track solver) inlined from sim originals.
import { ikReach2 } from '../life/pose.js';

const TICKS_PER_SEC = 10;
const MS_PER_TICK = 1000 / TICKS_PER_SEC;

// --- Inlined from sim/kernel/rng.js (pure math, no deps) ---
function scramble(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = Math.imul(n, 9);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return n >>> 0;
}
const PRIMES = [374761393, 668265263, 1442695041, 2246822519, 3266489917];
function mix(...ids) {
  let h = 0x9e3779b9;
  for (let i = 0; i < ids.length; i++) h = scramble(h ^ Math.imul(ids[i] | 0, PRIMES[i % PRIMES.length]));
  return h;
}
function rand(seed, ...ids) { return mix(seed, ...ids) / 4294967296; }

// --- Inlined from sim/life/motion/program.js (pure math) ---
const VARIANT_TIME_SALT = 4500;
const VARIANT_AMPLITUDE_SALT = 4501;
const GAIT_PHASE_SALT = 4510;

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function hashProgram(program) {
  const s = stableStringify(program);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function variantOf(seed, entityId, program) {
  const h = hashProgram(program);
  const vt = program.variant ?? { time: [1, 1], amplitude: [1, 1] };
  const lerp = (r, t) => r[0] + (r[1] - r[0]) * t;
  return {
    timeScale: lerp(vt.time, rand(seed, entityId, VARIANT_TIME_SALT, h)),
    amplitudeScale: lerp(vt.amplitude, rand(seed, entityId, VARIANT_AMPLITUDE_SALT, h)),
  };
}

// --- Inlined from sim/life/motion/executor.js solveProgramTrack (pure track solver) ---
function solveProgramTrack(rig, program, { seed, entityId, startTick }) {
  const { timeScale, amplitudeScale } = variantOf(seed, entityId, program);
  const phase = rand(seed, entityId, GAIT_PHASE_SALT, startTick);
  const frames = [], intents = [], events = [];
  const state = {};
  let t = startTick;
  walk(program.root);
  return { frames, intents, events, phase, timeScale, amplitudeScale };

  function scaledTicks(ticks) { return Math.max(1, Math.round((ticks ?? 1) * timeScale)); }
  function glideTo(targets, ticks) {
    const n = scaledTicks(ticks);
    const from = { ...state };
    for (let i = 1; i <= n; i++) {
      const f = i / n, joints = {};
      for (const j of new Set([...Object.keys(from), ...Object.keys(targets)])) {
        const a = from[j] ?? 0;
        const b = (targets[j] !== undefined ? targets[j] * amplitudeScale : a);
        joints[j] = a + (b - a) * f;
        state[j] = joints[j];
      }
      frames.push({ tick: t + i, joints });
    }
    t += n;
  }
  function walk(node) {
    switch (node.op) {
      case 'pose': glideTo(node.joints, node.ticks); break;
      case 'ik_reach': {
        const angles = ikReach2(rig, node.effector, node.target);
        if (angles) {
          const inv = {};
          for (const [j, a] of Object.entries(angles)) inv[j] = a / amplitudeScale;
          glideTo(inv, node.ticks ?? 4);
        }
        break;
      }
      case 'wait': {
        const n = scaledTicks(node.ticks);
        for (let i = 1; i <= n; i++) frames.push({ tick: t + i, joints: { ...state } });
        t += n;
        break;
      }
      case 'locomote': {
        const gait = rig.gaits[node.gait] ?? rig.gaits.walk;
        intents.push({ tick: t, kind: 'locomote', target: node.target, gait: node.gait });
        const cyc = Math.max(2, Math.round(gait.cycleTicks * timeScale));
        for (let i = 1; i <= cyc; i++) {
          const ph = (phase + i / cyc) * 2 * Math.PI;
          const swing = Math.sin(ph) * 25 * gait.strideFactor * amplitudeScale;
          const joints = { ...state, thigh_l: -swing, thigh_r: swing,
            arm_u_l: swing * 0.6, arm_u_r: -swing * 0.6 };
          Object.assign(state, joints);
          frames.push({ tick: t + i, joints });
        }
        t += cyc;
        break;
      }
      case 'balance': break;
      case 'look_at': intents.push({ tick: t, kind: 'look_at', target: node.target }); break;
      case 'attach': intents.push({ tick: t, kind: 'attach', entity: node.entity, effector: node.effector }); break;
      case 'detach': intents.push({ tick: t, kind: 'detach', effector: node.effector }); break;
      case 'emit': events.push({ tick: t, event: node.event }); break;
      case 'sequence': for (const c of node.children) walk(c); break;
      case 'parallel': {
        const t0 = t; let tMax = t;
        for (const c of node.children) { t = t0; walk(c); tMax = Math.max(tMax, t); }
        t = tMax;
        break;
      }
    }
  }
}

// --- Motion player state ---
let _rig = null;
let _active = null;

export function setMotionRig(r) { _rig = r; }

function buildTrack(program, count) {
  if (!_rig) return null;
  const seed = Date.now();
  if (program.phases) {
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
  const frames = [];
  let tick = 0;
  for (let i = 0; i < count; i++) {
    const t = solveProgramTrack(_rig, program, { seed, entityId: 0, startTick: tick });
    frames.push(...t.frames);
    tick = t.frames.length ? t.frames[t.frames.length - 1].tick : tick;
  }
  return { frames, loopStart: -1, loopEnd: -1 };
}

export function playMotion(program, { count = 1 } = {}) {
  const track = buildTrack(program, count);
  if (!track || track.frames.length === 0) return false;
  _active = {
    track,
    startMs: performance.now(),
    totalTicks: track.frames[track.frames.length - 1].tick - (track.frames[0]?.tick ?? 0),
    stopping: false,
  };
  return true;
}

export function stopMotion(hard = false) {
  if (!_active) return;
  if (hard) { _active = null; return; }
  _active.stopping = true;
}

export function isMotionActive() { return _active !== null; }

export function currentJoints(nowMs) {
  if (!_active) return null;
  const elapsed = nowMs - _active.startMs;
  const tickF = elapsed / MS_PER_TICK;
  const frames = _active.track.frames;
  const baseTick = frames[0]?.tick ?? 0;
  const rel = tickF + baseTick;

  const lastTick = frames[frames.length - 1].tick;
  if (rel >= lastTick) { _active = null; return null; }

  if (_active.stopping && _active.track.loopStart < 0) { _active = null; return null; }

  let lo = 0, hi = frames.length - 1;
  for (let i = 0; i < frames.length - 1; i++) {
    if (frames[i].tick <= rel && frames[i + 1].tick > rel) { lo = i; hi = i + 1; break; }
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
