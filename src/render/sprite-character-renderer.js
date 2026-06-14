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
  ctx.restore();
  return true;
}
