// src/render/wall-tuner.js — live tuning panel for wall rendering parameters.
// Press \ to toggle. / to cycle params. ←→ to adjust. C to copy values.

// Available wall tile sprites (for cycling through with east/west tile selection)
const TILE_OPTIONS = [
  'south_base', 'south_corner_west', 'south_corner_east',
  'south_window', 'south_door', 'interior_base', 'interior_archway',
  'edge_ew', 'north_back',
];

const PARAMS = {
  wallYOffset: 0.4,       // how far wall overlaps the floor edge (fraction of tile)
  cornerExtend: 1,        // tiles of plain wall beyond floor edge before corner molding
  wallHeight: 4,          // wall height in tiles
  northWall: true,        // render north walls
  northYOffset: 0.0,      // north wall Y offset (fraction of tile)
  interiorWall: false,    // render interior junction walls
  eastWestColumns: true,  // render east/west edge columns
  eastTile: 1,            // index into TILE_OPTIONS for east column sprite
  westTile: 1,            // index into TILE_OPTIONS for west column sprite
  ewTileHeight: 1,        // east/west column height in tiles
  ewXOffset: 0.0,         // east/west X offset (fraction of tile)
};

let enabled = false;
let selectedParam = 0;
const PARAM_KEYS = Object.keys(PARAMS);

export function wallTunerParams() {
  return {
    ...PARAMS,
    eastTileName: TILE_OPTIONS[Math.max(0, Math.min(TILE_OPTIONS.length - 1, Math.round(PARAMS.eastTile)))],
    westTileName: TILE_OPTIONS[Math.max(0, Math.min(TILE_OPTIONS.length - 1, Math.round(PARAMS.westTile)))],
  };
}

export function initWallTuner() {
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable]')) return;

    if (e.key === '\\' && !e.ctrlKey && !e.altKey) {
      enabled = !enabled;
      return;
    }
    if (!enabled) return;

    // / to cycle through parameters
    if (e.key === '/') { selectedParam = (selectedParam + 1) % PARAM_KEYS.length; e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { selectedParam = (selectedParam - 1 + PARAM_KEYS.length) % PARAM_KEYS.length; }
    if (e.key === 'ArrowDown') { selectedParam = (selectedParam + 1) % PARAM_KEYS.length; }

    const key = PARAM_KEYS[selectedParam];
    const val = PARAMS[key];

    // Left/right: adjust value
    const step = e.shiftKey ? 0.5 : 0.05;
    if (e.key === 'ArrowLeft') {
      if (typeof val === 'boolean') PARAMS[key] = !val;
      else if (typeof val === 'number') PARAMS[key] = Math.round((val - step) * 100) / 100;
    }
    if (e.key === 'ArrowRight') {
      if (typeof val === 'boolean') PARAMS[key] = !val;
      else if (typeof val === 'number') PARAMS[key] = Math.round((val + step) * 100) / 100;
    }

    // C to copy all values to clipboard
    if (e.key === 'c' || e.key === 'C') {
      const lines = PARAM_KEYS.map(k => {
        const v = PARAMS[k];
        let display = typeof v === 'boolean' ? (v ? 'true' : 'false') : v.toFixed(2);
        if (k === 'eastTile' || k === 'westTile') {
          const idx = Math.max(0, Math.min(TILE_OPTIONS.length - 1, Math.round(v)));
          display = `${v.toFixed(0)} (${TILE_OPTIONS[idx]})`;
        }
        return `${k}: ${display}`;
      });
      const text = '=== WALL TUNER VALUES ===\n' + lines.join('\n');
      navigator.clipboard.writeText(text).catch(() => {});
    }
  });

  window._wallTuner = { params: PARAMS, toggle: () => { enabled = !enabled; } };
}

export function drawWallTuner(ctx, w, h) {
  if (!enabled) return;

  const panelW = 380, lineH = 22, panelX = 8, panelY = h / 2 - 150;
  const panelH = (PARAM_KEYS.length + 3) * lineH + 10;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.88)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = 'rgba(100,200,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6cf';
  ctx.fillText('WALL TUNER (\\ toggle, / select, ←→ adjust, C copy)', panelX + 8, panelY + 18);

  for (let i = 0; i < PARAM_KEYS.length; i++) {
    const key = PARAM_KEYS[i];
    const val = PARAMS[key];
    const y = panelY + 40 + i * lineH;
    const isSelected = i === selectedParam;

    ctx.fillStyle = isSelected ? '#ffd24a' : '#aaa';
    ctx.font = isSelected ? 'bold 12px monospace' : '12px monospace';

    let display;
    if (typeof val === 'boolean') {
      display = val ? 'ON' : 'OFF';
    } else if (key === 'eastTile' || key === 'westTile') {
      const idx = Math.max(0, Math.min(TILE_OPTIONS.length - 1, Math.round(val)));
      display = `${idx}: ${TILE_OPTIONS[idx]}`;
    } else {
      display = val.toFixed(2);
    }

    const arrow = isSelected ? '► ' : '  ';
    ctx.fillText(`${arrow}${key}: ${display}`, panelX + 8, y);
  }

  // Footer
  ctx.font = '11px monospace';
  ctx.fillStyle = '#666';
  ctx.fillText('Shift+←→ = big steps | C = copy to clipboard', panelX + 8, panelY + panelH - 8);

  ctx.restore();
}
