// src/render/humanoid-player-renderer.js — Pass 4 L2b: the first living-entity
// renderer. Assembles the player avatar from directional part sprites at the FK
// rest pose (walk = simple limb swing from rig gait params). Replays one-time-
// authored art + pivot meta — nothing is generated at runtime.
// 8-DIRECTION: assets + pivot meta load lazily PER DIRECTION; until a
// direction's set is ready we draw the south set (honest absence — the avatar
// is never invisible, it just hasn't turned yet). w/sw/nw are mirrored art of
// e/se/ne (flipped PNGs on disk, pilot convention).
// HONEST ABSENCES: no equipment layers (client has no equipment state); no
// hair/face layers; humanoid NPCs are not rendered (none exist until L5).
// When sprites/meta are absent the caller falls back to the legacy doodle.
import { PARTS, PART_BONE, partKey, composeLayers } from '../../sim/life/body.js';
import { solvePose } from '../life/pose.js';
import { setMotionRig, currentJoints, currentZHints, isMotionActive, stopMotion, playMotion } from './motion-player.js';
export { playMotion, stopMotion, isMotionActive };

const BP_BASE = '/assets/pixelab/body_parts/';
const RIG_URL = '/src/life/rigs/humanoid.json';
const DEG = Math.PI / 180;
const RIG_UNIT_PX = 1.4;    // ~58-unit body ≈ 81px (~2.5 tiles) at zoom 1 (user: 1-tile avatar far too small)
const FEET_OFFSET = 15;     // legacy doodle feet line: py + 15*zoom (keep continuity)

// Per-direction render params. xProj: rig x is the body's frontal plane — a
// profile view collapses it, diagonals partially. xSign: south view mirrors
// anatomical x (left limbs appear viewer-right); n/w/sw/nw un-mirror/flip.
const DIRS = {
  s:  { meta: 'south', xProj: 1,    xSign: -1 },
  n:  { meta: 'n',     xProj: 1,    xSign: +1 },
  e:  { meta: 'e',     xProj: 0.25, xSign: -1 },
  w:  { meta: 'w',     xProj: 0.25, xSign: +1 },
  se: { meta: 'se',    xProj: 0.75, xSign: -1 },
  sw: { meta: 'sw',    xProj: 0.75, xSign: +1 },
  ne: { meta: 'ne',    xProj: 0.75, xSign: -1 },
  nw: { meta: 'nw',    xProj: 0.75, xSign: +1 },
};

// Avatar body plan is CLIENT CONFIG (player node has no species; presentation choice).
const AVATAR = {
  race: 'human', bodyType: 'average', ageBand: 'adult',
  parts: Object.fromEntries(PARTS.map(p => [p, { scale: 1 }])),
};

let rig = null, rigStarted = false, rigFailed = false;
// dir -> { meta, layers, images: Map(part -> Image|null), started, failed }
const dirState = new Map();

function loadDir(d) {
  const st = { meta: null, layers: null, images: new Map(), started: true, failed: false };
  dirState.set(d, st);
  fetch(`/src/life/rigs/humanoid-parts-${DIRS[d].meta}.json`)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(m => {
      st.meta = m;
      st.layers = composeLayers(AVATAR, null, d).filter(l => l.part);
      for (const l of st.layers) {
        const img = new Image();
        img.src = BP_BASE + partKey(AVATAR.race, AVATAR.bodyType, AVATAR.ageBand, l.part, d) + '.png';
        img.onload = () => st.images.set(l.part, img);
        img.onerror = () => { st.failed = true; };
      }
    })
    .catch(() => { st.failed = true; });
  return st;
}

function dirReady(st) {
  return st && !st.failed && st.meta && st.layers && st.layers.every(l => st.images.get(l.part));
}

/** Resolve the direction to draw: requested if its assets are ready, else
 *  south (the pilot set — always attempted first). Kicks off lazy loads. */
function resolveDir(d) {
  if (!DIRS[d]) d = 's';
  let st = dirState.get(d);
  if (!st) st = loadDir(d);
  if (dirReady(st)) return [d, st];
  const south = dirState.get('s') ?? loadDir('s');
  return dirReady(south) ? ['s', south] : [null, null];
}

/** Walk/sprint limb swing from gait params; idle = rest. frame matches the
 *  legacy doodle's 8-frame cycle (phase = frame * PI/4).
 *  Front/back views (s/n + diagonals): stride is in DEPTH — rendered as
 *  alternating leg lift/foreshortening in drawHumanoidPlayer; arms keep a
 *  subtle planar counter-swing. Profile views (e/w): the stride IS planar —
 *  real thigh/arm swing reads correctly. */
function jointsFor(frame, animation, d) {
  if (animation !== 'walk' && animation !== 'sprint') return {};
  const gait = rig.gaits[animation === 'sprint' ? 'run' : 'walk'];
  const phase = frame * Math.PI / 4;
  if (d === 'e' || d === 'w') {
    const leg = Math.sin(phase) * 22 * gait.strideFactor;
    const arm = -Math.sin(phase) * 14 * gait.strideFactor;
    return {
      thigh_l: leg, thigh_r: -leg, shin_l: Math.max(0, -leg) * 0.6, shin_r: Math.max(0, leg) * 0.6,
      arm_u_l: arm, arm_u_r: -arm,
    };
  }
  const arm = -Math.sin(phase) * 5 * gait.strideFactor;
  return { arm_u_l: arm, arm_u_r: -arm };
}

// Per-part pre-downscale (stepwise halving, area-averaged). NEAREST minification
// at k«1 drops most source pixels — this is what made the GL-composited player
// (rasterized at zoom 1, k≈0.07–0.24) look shredded. Residual scale stays ~1.
const _scaledParts = new Map(); // part|dir@steps -> canvas
function partFrame(part, d, img, k) {
  // Quantize k to prevent cache thrashing during smooth zoom animation.
  // Round to nearest 0.05 — at most 20 discrete scale levels.
  const qk = Math.round(k * 20) / 20;
  let steps = 0;
  while (qk * (1 << (steps + 1)) <= 1.1) steps++;
  if (steps === 0) return img;
  const key = part + '|' + d + '@' + steps;
  let c = _scaledParts.get(key);
  if (!c) {
    let src = img, w = img.width, h = img.height;
    for (let i = 0; i < steps; i++) {
      const half = document.createElement('canvas');
      half.width = Math.max(1, Math.round(w / 2));
      half.height = Math.max(1, Math.round(h / 2));
      const hc = half.getContext('2d');
      hc.imageSmoothingEnabled = true;
      hc.drawImage(src, 0, 0, half.width, half.height);
      src = half; w = half.width; h = half.height;
    }
    c = src;
    _scaledParts.set(key, c);
  }
  return c;
}

const LEG_SIDE = { thigh_l: 'l', shin_l: 'l', foot_l: 'l', thigh_r: 'r', shin_r: 'r', foot_r: 'r' };

/** Draw the assembled avatar. Returns false when not ready (caller falls back).
 *  (x, y) matches drawPlayerAt's doodle anchor: feet at y + FEET_OFFSET*zoom.
 *  direction: 8-way facing code ('S','NE',... case-insensitive); defaults south. */
export function drawHumanoidPlayer(ctx, x, y, zoom, frame, animation, direction = 'S') {
  if (rigFailed) return false;
  if (!rigStarted) {
    rigStarted = true;
    fetch(RIG_URL).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(r => { rig = r; setMotionRig(r); }).catch(() => { rigFailed = true; });
  }
  if (!rig) return false;
  const [d, st] = resolveDir(String(direction).toLowerCase());
  if (!d) return false;
  const cfg = DIRS[d];
  // Motion override: active choreography joints take priority over walk cycle.
  // Movement input hard-stops any active performance.
  const moving = animation === 'walk' || animation === 'sprint';
  if (moving && isMotionActive()) stopMotion(true);
  const motionJoints = !moving ? currentJoints(performance.now()) : null;
  const pose = solvePose(rig, motionJoints ?? jointsFor(frame, animation, d));
  const gait = rig.gaits[animation === 'sprint' ? 'run' : 'walk'];
  const bob = (animation === 'walk' || animation === 'sprint')
    ? Math.abs(Math.sin(frame * Math.PI / 4)) * gait.bob * RIG_UNIT_PX * zoom : 0;
  const S = RIG_UNIT_PX * zoom;
  const groundY = y + FEET_OFFSET * zoom - bob;
  // Front/back-view step: each leg alternately lifts (foreshortens toward the
  // hip) — the depth-stride equivalent. Profile views use real planar swing.
  const planar = d === 'e' || d === 'w';
  const phase = frame * Math.PI / 4;
  const stepAmp = moving && !planar ? (animation === 'sprint' ? 0.22 : 0.14) : 0;
  const lift = {
    l: Math.max(0, Math.sin(phase)) * stepAmp,
    r: Math.max(0, -Math.sin(phase)) * stepAmp,
  };
  // Dynamic layer order: when a motion pose carries zHints, recompute the painter
  // order for this frame rather than using the cached static order.
  const zHints = isMotionActive() ? currentZHints() : {};
  const layers = Object.keys(zHints).length > 0
    ? composeLayers(AVATAR, null, d, zHints).filter(l => l.part)
    : st.layers;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const l of layers) {
    const img = st.images.get(l.part);
    const m = st.meta.parts[l.part];
    const b = pose[PART_BONE[l.part]];
    const k = (S / m.ppu) * l.scale;
    const side = LEG_SIDE[PART_BONE[l.part]];
    const squash = side ? 1 - lift[side] : 1;
    // Hip anchor for the leg foreshortening (thigh origin of this side)
    const hipY = side ? groundY - pose[side === 'l' ? 'thigh_l' : 'thigh_r'].origin.y * S : 0;
    ctx.save();
    // xSign mirrors anatomical x per direction (south: left limbs appear on the
    // viewer's RIGHT). The mirror flips angular direction; with xSign=-1 that
    // cancels the y-down rotation negation, with +1 it doesn't.
    const ty = groundY - b.origin.y * S;
    ctx.translate(x + cfg.xSign * b.origin.x * cfg.xProj * S, side ? hipY + (ty - hipY) * squash : ty);
    ctx.rotate(-cfg.xSign * b.worldDeg * DEG);
    const src = partFrame(l.part, d, img, k);
    ctx.drawImage(src, -m.pivot[0] * k, -m.pivot[1] * k * squash, img.width * k, img.height * k * squash);

    // ── Equipment overlay: draw armor aligned with body part ──
    const equipSlot = _PART_TO_EQUIP_SLOT[l.part];
    const equipImg = equipSlot && _equipImages.get(equipSlot);
    if (equipImg) {
      // Body part draws at: (-pivot.x * k, -pivot.y * k) with size (width * k, height * k).
      // Its visual center in the rotated ctx is at:
      //   cx = -pivot.x * k + width * k / 2 = (width/2 - pivot.x) * k
      //   cy = -pivot.y * k + height * k / 2 = (height/2 - pivot.y) * k
      // Draw equipment sprite centered on that same visual center.
      const bodyCx = (img.width / 2 - m.pivot[0]) * k;
      const bodyCy = (img.height / 2 - m.pivot[1]) * k * squash;
      const ew = equipImg.width * k;
      const eh = equipImg.height * k;
      ctx.drawImage(equipImg, bodyCx - ew / 2, bodyCy - eh / 2 * squash, ew, eh * squash);
    }

    ctx.restore();
  }
  ctx.restore();
  return true;
}

// ── Equipment overlay system ────────────────────────────────────────────
// Maps body part names to equipment slot names
const _PART_TO_EQUIP_SLOT = {
  head: 'head', torso: 'torso',
  arm_upper_l: 'arm_upper', arm_upper_r: 'arm_upper',
  arm_fore_l: 'arm_fore', arm_fore_r: 'arm_fore',
  hand_l: 'hand', hand_r: 'hand',
  thigh_l: 'thigh', thigh_r: 'thigh',
  shin_l: 'shin', shin_r: 'shin',
  foot_l: 'foot', foot_r: 'foot',
};

const _equipImages = new Map(); // slot -> Image
let _lastEquipUrls = null;

// Poll for equipment changes from window._playerEquipment (set by armor-swap.js)
function _checkEquipment() {
  const equip = typeof window !== 'undefined' ? window._playerEquipment : null;
  if (!equip && !_lastEquipUrls) return;
  const key = JSON.stringify(equip || {});
  if (key === _lastEquipUrls) return;
  _lastEquipUrls = key;

  _equipImages.clear();
  if (!equip) return;

  for (const [slot, url] of Object.entries(equip)) {
    const img = new Image();
    img.src = url;
    img.onload = () => _equipImages.set(slot, img);
  }
}
if (typeof window !== 'undefined') setInterval(_checkEquipment, 500);
