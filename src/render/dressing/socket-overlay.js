// src/render/dressing/socket-overlay.js
// In-GL placement overlay (D-stack de-risk): highlights every façade SOCKET where a wall attachment
// would anchor, so we can verify the addressing math BEFORE generating any D3 art. The marker bitmap is
// composited into the SCENE FBO via gl-compositor.drawSceneOverlayBitmap() (CLAUDE.md: world content
// goes through GL, never a 2D top-pass) — so markers sit on the walls under the same lighting/CRT.
//
// Toggle: window._socketOverlay.enabled = true (intended to become a checkbox in the unified dev panel,
// so this adds NO new keybinding). Non-premultiplied alpha — drawSceneOverlayBitmap re-premultiplies.
import { buildSockets, projectSocket } from './socket-index.js';
import { windowTilePaths } from '../building-tiles.js';
import { measureWindowAnchor } from './aperture-measure.js';

export const SOCKET_OVERLAY = { enabled: false, radius: 4 };
if (typeof window !== 'undefined') window._socketOverlay = window._socketOverlay || SOCKET_OVERLAY;

// Marker colour per socket kind. Exported so the Dev HUD can render a readable DOM legend (instead of a
// CRT-warped box baked into the world bitmap that hid behind the minimap).
export const SOCKET_STYLE = {
  window_sill: '#4ec3ff',
  above_door:  '#ffd24a',
  wall_corner: '#ff7a7a',
  roof_edge:   '#8aff9e',
  beside_door: '#d59bff',
  window_jamb: '#ff9e57',
  on_door:     '#ffe27a',
};

let _cv = null, _cx = null;
function ensure(w, h) {
  if (!_cv || _cv.width !== w || _cv.height !== h) {
    _cv = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h)
      : (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!_cv) return false;
    _cv.width = w; _cv.height = h; _cx = _cv.getContext('2d');
  }
  return true;
}

/** Per-frame socket-marker bitmap for the near buildings, or null when disabled / empty / no canvas. */
export function buildSocketOverlayBitmap(buildings, camX, camY, tilePx, w, h) {
  const cfg = (typeof window !== 'undefined' && window._socketOverlay) || SOCKET_OVERLAY;
  if (!cfg.enabled || !buildings || !buildings.length) return null;
  if (!ensure(w, h)) return null;
  const ctx = _cx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  const r = cfg.radius || 4;
  let drew = false;
  for (const b of buildings) {
    // Measure this material's window opening (cached) so sills sit on the real glass, not a guess.
    let winAnchor = null;
    try { const paths = windowTilePaths(b); if (paths) winAnchor = measureWindowAnchor(paths.plain, paths.window); } catch { /* fall back to default sill */ }
    let socks; try { socks = buildSockets(b, { winAnchor }); } catch { continue; }
    for (const s of socks) {
      const p = projectSocket(b, s, camX, camY, tilePx);
      if (p.x < -16 || p.x > w + 16 || p.y < -16 || p.y > h + 16) continue;
      ctx.fillStyle = SOCKET_STYLE[s.kind] || '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      drew = true;
    }
  }
  return drew ? _cv : null;
}
