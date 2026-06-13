// src/render/humanoid-player-renderer.js — Pass 4 L2b: the first living-entity
// renderer. Assembles the player avatar from pilot part sprites at the FK rest
// pose (walk = simple limb swing from rig gait params). Replays one-time-authored
// art + pivot meta — nothing is generated at runtime.
// HONEST ABSENCES: south direction only (pilot scope); no equipment layers
// (client has no equipment state); no hair/face layers; humanoid NPCs are not
// rendered (none exist until L5). When sprites/meta are absent the caller falls
// back to the legacy doodle (pre-L2b status quo, not a mock).
import { PARTS, PART_BONE, partKey, composeLayers } from '../../sim/life/body.js';
import { solvePose } from '../life/pose.js';

const BP_BASE = '/assets/pixelab/body_parts/';
const RIG_URL = '/src/life/rigs/humanoid.json';
const META_URL = '/src/life/rigs/humanoid-parts-south.json';
const DEG = Math.PI / 180;
const RIG_UNIT_PX = 1.4;    // ~58-unit body ≈ 81px (~2.5 tiles) at zoom 1 (user: 1-tile avatar far too small)
const FEET_OFFSET = 15;     // legacy doodle feet line: py + 15*zoom (keep continuity)

// Avatar body plan is CLIENT CONFIG (player node has no species; presentation choice).
const AVATAR = {
  race: 'human', bodyType: 'average', ageBand: 'adult',
  parts: Object.fromEntries(PARTS.map(p => [p, { scale: 1 }])),
};

let rig = null, meta = null, layers = null;
const images = new Map();   // part -> HTMLImageElement | null(failed)
let started = false, failed = false;

function startLoading() {
  started = true;
  Promise.all([fetch(RIG_URL), fetch(META_URL)])
    .then(rs => Promise.all(rs.map(r => { if (!r.ok) throw new Error(r.status); return r.json(); })))
    .then(([r, m]) => {
      rig = r; meta = m;
      layers = composeLayers(AVATAR, null, 's').filter(l => l.part);
      for (const l of layers) {
        const img = new Image();
        img.src = BP_BASE + partKey(AVATAR.race, AVATAR.bodyType, AVATAR.ageBand, l.part, 's') + '.png';
        img.onload = () => images.set(l.part, img);
        img.onerror = () => images.set(l.part, null);
      }
    })
    .catch(() => { failed = true; });
}

function ready() {
  return rig && meta && layers && layers.every(l => images.get(l.part));
}

/** Walk/sprint limb swing from gait params; idle = rest. frame matches the
 *  legacy doodle's 8-frame cycle (phase = frame * PI/4).
 *  South view faces the camera, so the stride is in DEPTH — a screen-plane leg
 *  rotation reads as sideways scissoring. Legs stay at rest here; the step is
 *  rendered as alternating leg lift/foreshortening in drawHumanoidPlayer.
 *  Arms keep a subtle planar counter-swing (visible silhouette motion). */
function jointsFor(frame, animation) {
  if (animation !== 'walk' && animation !== 'sprint') return {};
  const gait = rig.gaits[animation === 'sprint' ? 'run' : 'walk'];
  const phase = frame * Math.PI / 4;
  const arm = -Math.sin(phase) * 5 * gait.strideFactor;
  return { arm_u_l: arm, arm_u_r: -arm };
}

// Per-part pre-downscale (stepwise halving, area-averaged). NEAREST minification
// at k«1 drops most source pixels — this is what made the GL-composited player
// (rasterized at zoom 1, k≈0.07–0.24) look shredded. Residual scale stays ~1.
const _scaledParts = new Map(); // part@steps -> canvas
function partFrame(part, img, k) {
  let steps = 0;
  while (k * (1 << (steps + 1)) <= 1.1) steps++;
  if (steps === 0) return img;
  const key = part + '@' + steps;
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
 *  (x, y) matches drawPlayerAt's doodle anchor: feet at y + FEET_OFFSET*zoom. */
export function drawHumanoidPlayer(ctx, x, y, zoom, frame, animation) {
  if (failed) return false;
  if (!started) { startLoading(); return false; }
  if (!ready()) return false;
  const pose = solvePose(rig, jointsFor(frame, animation));
  const gait = rig.gaits[animation === 'sprint' ? 'run' : 'walk'];
  const bob = (animation === 'walk' || animation === 'sprint')
    ? Math.abs(Math.sin(frame * Math.PI / 4)) * gait.bob * RIG_UNIT_PX * zoom : 0;
  const S = RIG_UNIT_PX * zoom;
  const groundY = y + FEET_OFFSET * zoom - bob;
  // Front-view step: each leg alternately lifts (foreshortens toward the hip)
  // — the depth-stride equivalent for a camera-facing view.
  const moving = animation === 'walk' || animation === 'sprint';
  const phase = frame * Math.PI / 4;
  const stepAmp = moving ? (animation === 'sprint' ? 0.22 : 0.14) : 0;
  const lift = {
    l: Math.max(0, Math.sin(phase)) * stepAmp,
    r: Math.max(0, -Math.sin(phase)) * stepAmp,
  };
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const l of layers) {
    const img = images.get(l.part);
    const m = meta.parts[l.part];
    const b = pose[PART_BONE[l.part]];
    const k = (S / m.ppu) * l.scale;
    const side = LEG_SIDE[PART_BONE[l.part]];
    const squash = side ? 1 - lift[side] : 1;
    // Hip anchor for the leg foreshortening (thigh origin of this side)
    const hipY = side ? groundY - pose[side === 'l' ? 'thigh_l' : 'thigh_r'].origin.y * S : 0;
    ctx.save();
    // South view faces the camera: anatomical left appears on the viewer's RIGHT.
    // Rig x is anatomical (left limbs at -x), so mirror x for this direction; the
    // mirror flips angular direction, cancelling the y-down rotation negation.
    const ty = groundY - b.origin.y * S;
    ctx.translate(x - b.origin.x * S, side ? hipY + (ty - hipY) * squash : ty);
    ctx.rotate(b.worldDeg * DEG);
    const src = partFrame(l.part, img, k);
    ctx.drawImage(src, -m.pivot[0] * k, -m.pivot[1] * k * squash, img.width * k, img.height * k * squash);
    ctx.restore();
  }
  ctx.restore();
  return true;
}
