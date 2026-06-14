// src/render/sprite-character-renderer.js — PixelLab character sprite renderer.
// Renders a full-character sprite sheet (idle/walk/run per direction) instead
// of the assembled body-part FK rig. Hot-swappable with humanoid-player-renderer.

const CHAR_BASE = '/assets/pixelab/characters/base_male_clothed';
const FEET_OFFSET = 15;  // match humanoid-player-renderer
const CHAR_SCALE = 1.25; // scale 128px canvas to match ~81px assembled character at zoom 1

const DIR_MAP = {
  s: 'south', n: 'north', e: 'east', w: 'west',
  se: 'south-east', sw: 'south-west', ne: 'north-east', nw: 'north-west',
};

// State
let _rotations = new Map();  // dir -> Image
let _walkFrames = new Map(); // dir -> [Image, Image, ...]
let _idleFrames = new Map(); // dir -> [Image, Image, ...]
let _loaded = false;
let _loading = false;
let _failed = false;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

async function loadAll() {
  if (_loading || _loaded || _failed) return;
  _loading = true;
  try {
    // Load idle rotations
    for (const [code, name] of Object.entries(DIR_MAP)) {
      const img = await loadImage(`${CHAR_BASE}/${name}.png`);
      _rotations.set(code, img);
    }

    // Try loading walk frames — they might not exist yet
    for (const [code, name] of Object.entries(DIR_MAP)) {
      const frames = [];
      for (let i = 0; i < 6; i++) {
        try {
          const img = await loadImage(`${CHAR_BASE}/walk/${name}/${i}.png`);
          frames.push(img);
        } catch { break; }
      }
      if (frames.length > 0) _walkFrames.set(code, frames);
    }

    // Try loading idle anim frames
    for (const [code, name] of Object.entries(DIR_MAP)) {
      const frames = [];
      for (let i = 0; i < 4; i++) {
        try {
          const img = await loadImage(`${CHAR_BASE}/idle/${name}/${i}.png`);
          frames.push(img);
        } catch { break; }
      }
      if (frames.length > 0) _idleFrames.set(code, frames);
    }

    _loaded = true;
    console.log(`[sprite-char] Loaded: ${_rotations.size} rotations, ${_walkFrames.size} walk dirs, ${_idleFrames.size} idle dirs`);
  } catch (e) {
    console.warn('[sprite-char] Failed to load:', e.message);
    _failed = true;
  }
  _loading = false;
}

/** Draw the sprite character. Same signature as drawHumanoidPlayer.
 *  Returns false if not ready (caller falls back to assembled rig). */
export function drawSpriteCharacter(ctx, x, y, zoom, frame, animation, direction = 'S') {
  if (_failed) return false;
  if (!_loaded) { loadAll(); return false; }

  const d = String(direction).toLowerCase();
  const rotation = _rotations.get(d);
  if (!rotation) return false;

  // Pick the right frame source
  let img = rotation; // default: static rotation
  const moving = animation === 'walk' || animation === 'sprint';

  if (moving && _walkFrames.has(d)) {
    const frames = _walkFrames.get(d);
    const idx = Math.floor(frame) % frames.length;
    img = frames[idx];
  } else if (!moving && _idleFrames.has(d)) {
    const frames = _idleFrames.get(d);
    const idx = Math.floor(frame) % frames.length;
    img = frames[idx];
  }

  // Draw centered at (x, y + FEET_OFFSET*zoom) matching the assembled renderer
  const scale = CHAR_SCALE * zoom;
  const w = img.width * scale;
  const h = img.height * scale;
  const drawX = x - w / 2;
  const drawY = y + FEET_OFFSET * zoom - h * 0.85; // 0.85 = feet at ~85% down the sprite

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, drawX, drawY, w, h);
  ctx.restore();
  return true;
}
