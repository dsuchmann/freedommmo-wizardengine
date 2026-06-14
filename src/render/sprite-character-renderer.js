// src/render/sprite-character-renderer.js — PixelLab character sprite renderer.
// Renders full-character sprite sheet animations (idle/walk/run per direction).
// Hot-swappable with humanoid-player-renderer — returns false if not ready.

const CHAR_BASE = '/assets/pixelab/characters/base_male_clothed';
const FEET_OFFSET = 15;
const CHAR_SCALE = 1.25;

const DIR_MAP = {
  s: 'south', n: 'north', e: 'east', w: 'west',
  se: 'south-east', sw: 'south-west', ne: 'north-east', nw: 'north-west',
};

// Animation config: disk folder + max frame count per animation state
const ANIM_CONFIG = {
  idle:   { folder: 'idle',  maxFrames: 4,  fps: 3 },
  walk:   { folder: 'walk',  maxFrames: 6,  fps: 8 },
  sprint: { folder: 'run',   maxFrames: 8,  fps: 10 },
};

// Cache: animName -> dirCode -> [Image, ...]
const _animCache = new Map();
// Cache: dirCode -> Image (static rotation)
const _rotations = new Map();

let _loaded = false;
let _loading = false;
let _failed = false;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed: ${url}`));
    img.src = url;
  });
}

async function loadAll() {
  if (_loading || _loaded || _failed) return;
  _loading = true;
  try {
    // Load static rotations
    for (const [code, name] of Object.entries(DIR_MAP)) {
      try {
        _rotations.set(code, await loadImage(`${CHAR_BASE}/${name}.png`));
      } catch {}
    }

    // Load animation frames
    for (const [animName, cfg] of Object.entries(ANIM_CONFIG)) {
      const dirMap = new Map();
      for (const [code, name] of Object.entries(DIR_MAP)) {
        const frames = [];
        for (let i = 0; i < cfg.maxFrames; i++) {
          try {
            frames.push(await loadImage(`${CHAR_BASE}/${cfg.folder}/${name}/${i}.png`));
          } catch { break; }
        }
        if (frames.length > 0) dirMap.set(code, frames);
      }
      if (dirMap.size > 0) _animCache.set(animName, dirMap);
    }

    _loaded = true;
    const counts = [..._animCache.entries()].map(([k, v]) => `${k}:${v.size}dirs`).join(', ');
    console.log(`[sprite-char] Loaded: ${_rotations.size} rotations, ${counts}`);
  } catch (e) {
    console.warn('[sprite-char] Load failed:', e.message);
    _failed = true;
  }
  _loading = false;
}

/** Draw the sprite character. Returns false if not ready. */
export function drawSpriteCharacter(ctx, x, y, zoom, frame, animation, direction = 'S') {
  if (_failed) return false;
  if (!_loaded) { loadAll(); return false; }

  const d = String(direction).toLowerCase();

  // Map game animation state to our anim config
  let animName = 'idle';
  if (animation === 'walk') animName = 'walk';
  else if (animation === 'sprint') animName = 'sprint';

  // Get the right frame
  let img = null;
  const animDir = _animCache.get(animName);
  if (animDir?.has(d)) {
    const frames = animDir.get(d);
    const idx = Math.floor(frame) % frames.length;
    img = frames[idx];
  } else {
    // Fall back: sprint→walk→idle→static rotation
    for (const fallback of ['walk', 'idle']) {
      const fb = _animCache.get(fallback);
      if (fb?.has(d)) {
        img = fb.get(d)[Math.floor(frame) % fb.get(d).length];
        break;
      }
    }
    if (!img) img = _rotations.get(d);
  }

  if (!img) return false;

  const scale = CHAR_SCALE * zoom;
  const w = img.width * scale;
  const h = img.height * scale;
  const drawX = x - w / 2;
  const drawY = y + FEET_OFFSET * zoom - h * 0.85;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, drawX, drawY, w, h);

  // ── Equipment overlay: draw equipment sprites at FK bone positions ──
  if (_equipSprites.size > 0 && _rig) {
    const joints = _getWalkJoints(frame, animation, d);
    const pose = _solvePose(_rig, joints);
    const RIG_UNIT_PX = 1.4;
    const S = RIG_UNIT_PX * zoom;

    for (const [slot, equip] of _equipSprites) {
      const bone = pose[equip.bone];
      if (!bone) continue;
      const eImg = equip.img;
      if (!eImg) continue;

      // Position: character center + bone offset
      // The FK rig's origin is at the root (feet). Bone positions are in rig units.
      // xProj flattens x for front/back views (same as humanoid renderer).
      const xProj = { s: 1, n: 1, e: 0.25, w: 0.25, se: 0.75, sw: 0.75, ne: 0.75, nw: 0.75 }[d] ?? 1;
      const xSign = { s: -1, n: 1, e: -1, w: 1, se: -1, sw: 1, ne: -1, nw: 1 }[d] ?? -1;

      const boneX = x + xSign * bone.origin.x * xProj * S;
      const boneY = drawY + h - bone.origin.y * S; // flip Y: rig Y-up → canvas Y-down

      const eScale = (equip.scale || 0.6) * zoom;
      const ew = eImg.width * eScale;
      const eh = eImg.height * eScale;
      ctx.drawImage(eImg, boneX - ew / 2, boneY - eh / 2, ew, eh);
    }
  }

  ctx.restore();
  return true;
}

// ── Equipment system ──────────────────────────────────────────────────────
import { solvePose as _solvePose } from '../life/pose.js';

const _equipSprites = new Map(); // slot -> { bone, img, scale }
let _rig = null;

// Load rig for bone positions
fetch('/src/life/rigs/humanoid.json').then(r => r.json()).then(r => { _rig = r; }).catch(() => {});

function _getWalkJoints(frame, animation, d) {
  if (!_rig) return {};
  if (animation !== 'walk' && animation !== 'sprint') return {};
  const gait = _rig.gaits[animation === 'sprint' ? 'run' : 'walk'];
  const phase = frame * Math.PI / 4;
  if (d === 'e' || d === 'w') {
    const leg = Math.sin(phase) * 22 * gait.strideFactor;
    const arm = -Math.sin(phase) * 14 * gait.strideFactor;
    return { thigh_l: leg, thigh_r: -leg, arm_u_l: arm, arm_u_r: -arm };
  }
  const arm = -Math.sin(phase) * 5 * gait.strideFactor;
  return { arm_u_l: arm, arm_u_r: -arm };
}

/** Equip a sprite to a bone slot. Call from console: equipItem('chest', '/path/to.png', 'spine') */
export function equipItem(slot, imgUrl, boneName, scale = 0.6) {
  const img = new Image();
  img.src = imgUrl;
  img.onload = () => {
    _equipSprites.set(slot, { bone: boneName, img, scale });
    console.log(`[equip] ${slot} → ${boneName}`);
  };
}

/** Unequip a slot. */
export function unequipItem(slot) {
  _equipSprites.delete(slot);
}

// Expose on window for console testing
if (typeof window !== 'undefined') {
  window.equipItem = equipItem;
  window.unequipItem = unequipItem;
}
