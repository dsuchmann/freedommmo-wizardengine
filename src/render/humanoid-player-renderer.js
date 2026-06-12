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
const RIG_UNIT_PX = 0.55;   // ~58-unit body ≈ 32px (one tile) at zoom 1
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
 *  legacy doodle's 8-frame cycle (phase = frame * PI/4). */
function jointsFor(frame, animation) {
  if (animation !== 'walk' && animation !== 'sprint') return {};
  const gait = rig.gaits[animation === 'sprint' ? 'run' : 'walk'];
  const phase = frame * Math.PI / 4;
  const leg = Math.sin(phase) * 18 * gait.strideFactor;   // walk ±9°, run ±16.2°
  const arm = -Math.sin(phase) * 12 * gait.strideFactor;  // counter-swing
  return { thigh_l: leg, thigh_r: -leg, arm_u_l: arm, arm_u_r: -arm };
}

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
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const l of layers) {
    const img = images.get(l.part);
    const m = meta.parts[l.part];
    const b = pose[PART_BONE[l.part]];
    const k = (S / m.ppu) * l.scale;
    ctx.save();
    ctx.translate(x + b.origin.x * S, groundY - b.origin.y * S);
    ctx.rotate(-b.worldDeg * DEG);   // rig CCW(+y up) -> canvas (y down)
    ctx.drawImage(img, -m.pivot[0] * k, -m.pivot[1] * k, img.width * k, img.height * k);
    ctx.restore();
  }
  ctx.restore();
  return true;
}
