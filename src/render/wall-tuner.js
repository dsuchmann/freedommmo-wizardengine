// src/render/wall-tuner.js — live tuning panel for wall rendering parameters.
// Press W to toggle the tuner. Arrow keys + number keys adjust parameters.
// Parameters are read by building-renderer.js via wallTunerParams().

const PARAMS = {
  wallYOffset: 0.4,       // how far wall overlaps the floor edge (fraction of tile)
  cornerExtend: 1,        // tiles of plain wall beyond floor edge before corner molding
  wallHeight: 4,          // wall height in tiles
  northWall: true,        // render north walls
  interiorWall: false,    // render interior junction walls
  eastWestColumns: true,  // render east/west edge columns
  showLabels: true,       // show parameter labels on screen
};

let enabled = false;
let selectedParam = 0;
const PARAM_KEYS = Object.keys(PARAMS);

export function wallTunerParams() { return PARAMS; }

export function initWallTuner() {
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable]')) return;

    if (e.key === 'w' && !e.ctrlKey && !e.altKey) {
      enabled = !enabled;
      return;
    }
    if (!enabled) return;

    // Up/down: select parameter
    if (e.key === 'ArrowUp') { selectedParam = (selectedParam - 1 + PARAM_KEYS.length) % PARAM_KEYS.length; }
    if (e.key === 'ArrowDown') { selectedParam = (selectedParam + 1) % PARAM_KEYS.length; }

    const key = PARAM_KEYS[selectedParam];
    const val = PARAMS[key];

    // Left/right: adjust value
    if (e.key === 'ArrowLeft') {
      if (typeof val === 'boolean') PARAMS[key] = !val;
      else if (typeof val === 'number') PARAMS[key] = Math.round((val - 0.05) * 100) / 100;
    }
    if (e.key === 'ArrowRight') {
      if (typeof val === 'boolean') PARAMS[key] = !val;
      else if (typeof val === 'number') PARAMS[key] = Math.round((val + 0.05) * 100) / 100;
    }

    // Shift+left/right for bigger steps
    if (e.key === 'ArrowLeft' && e.shiftKey && typeof val === 'number') {
      PARAMS[key] = Math.round((PARAMS[key] - 0.45) * 100) / 100; // undo small + apply big
    }
    if (e.key === 'ArrowRight' && e.shiftKey && typeof val === 'number') {
      PARAMS[key] = Math.round((PARAMS[key] + 0.45) * 100) / 100;
    }
  });

  window._wallTuner = { params: PARAMS, toggle: () => { enabled = !enabled; } };
}

export function drawWallTuner(ctx, w, h) {
  if (!enabled) return;

  const panelW = 300, lineH = 22, panelX = 8, panelY = h / 2 - 100;
  const panelH = (PARAM_KEYS.length + 2) * lineH + 10;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = 'rgba(100,200,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6cf';
  ctx.fillText('WALL TUNER (W toggle, ↑↓ select, ←→ adjust)', panelX + 8, panelY + 18);

  for (let i = 0; i < PARAM_KEYS.length; i++) {
    const key = PARAM_KEYS[i];
    const val = PARAMS[key];
    const y = panelY + 40 + i * lineH;
    const isSelected = i === selectedParam;

    ctx.fillStyle = isSelected ? '#ffd24a' : '#aaa';
    ctx.font = isSelected ? 'bold 12px monospace' : '12px monospace';

    const display = typeof val === 'boolean' ? (val ? 'ON' : 'OFF') : val.toFixed(2);
    const arrow = isSelected ? '► ' : '  ';
    ctx.fillText(`${arrow}${key}: ${display}`, panelX + 8, y);
  }

  ctx.restore();
}
