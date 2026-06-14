// src/render/wall-tuner.js — live tuning panel for wall rendering parameters.
// Press \ to toggle. / to cycle params. , and . to adjust. C to copy.

const TILE_OPTIONS = [
  'south_base', 'south_corner_west', 'south_corner_east',
  'south_window', 'south_door', 'interior_base', 'interior_archway',
  'edge_ew', 'north_back',
];

// 'int' type steps by 1, 'float' by 0.05, 'bool' toggles, 'tile' cycles tile list
const PARAM_DEFS = [
  { key: 'wallYOffset',     type: 'float', default: 0.25, desc: 'south wall Y offset' },
  { key: 'cornerExtend',    type: 'int',   default: 0,    desc: 'tiles past floor before corner' },
  { key: 'wallHeight',      type: 'float', default: 4,    desc: 'wall height in tiles' },
  { key: 'northWall',       type: 'bool',  default: true,  desc: 'render north walls' },
  { key: 'northYOffset',    type: 'float', default: 0.25, desc: 'north wall Y offset' },
  { key: 'interiorWall',    type: 'bool',  default: false, desc: 'render interior walls' },
  { key: 'eastWestColumns', type: 'bool',  default: true,  desc: 'render east/west columns' },
  { key: 'eastTile',        type: 'tile',  default: 7,    desc: 'east column sprite' },
  { key: 'westTile',        type: 'tile',  default: 7,    desc: 'west column sprite' },
  { key: 'ewTileHeight',    type: 'float', default: 0.40, desc: 'east/west tile height' },
  { key: 'ewXOffset',       type: 'float', default: -0.30, desc: 'east/west X offset' },
  { key: 'ewFrequency',     type: 'int',   default: 1,    desc: 'paint every N tiles' },
  { key: 'ewFlipH',         type: 'bool',  default: false, desc: 'flip east/west horizontal' },
  { key: 'ewFlipV',         type: 'bool',  default: false, desc: 'flip east/west vertical' },
  { key: 'ewRotate90',      type: 'bool',  default: true,  desc: 'rotate east/west 90°' },
];

const PARAMS = {};
for (const d of PARAM_DEFS) PARAMS[d.key] = d.default;

let enabled = false;
let selectedParam = 0;

export function wallTunerParams() {
  const eastIdx = Math.max(0, Math.min(TILE_OPTIONS.length - 1, Math.round(PARAMS.eastTile)));
  const westIdx = Math.max(0, Math.min(TILE_OPTIONS.length - 1, Math.round(PARAMS.westTile)));
  return {
    ...PARAMS,
    eastTileName: TILE_OPTIONS[eastIdx],
    westTileName: TILE_OPTIONS[westIdx],
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

    if (e.key === '/') {
      selectedParam = (selectedParam + 1) % PARAM_DEFS.length;
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowUp') selectedParam = (selectedParam - 1 + PARAM_DEFS.length) % PARAM_DEFS.length;
    if (e.key === 'ArrowDown') selectedParam = (selectedParam + 1) % PARAM_DEFS.length;

    const def = PARAM_DEFS[selectedParam];
    const key = def.key;
    const val = PARAMS[key];

    const isDown = e.key === ',' || e.key === 'ArrowLeft';
    const isUp = e.key === '.' || e.key === 'ArrowRight';

    if (isDown || isUp) {
      const dir = isUp ? 1 : -1;
      if (def.type === 'bool') {
        PARAMS[key] = !val;
      } else if (def.type === 'tile') {
        PARAMS[key] = ((Math.round(val) + dir) % TILE_OPTIONS.length + TILE_OPTIONS.length) % TILE_OPTIONS.length;
      } else if (def.type === 'int') {
        PARAMS[key] = Math.round(val) + dir * (e.shiftKey ? 5 : 1);
      } else {
        const step = e.shiftKey ? 0.5 : 0.05;
        PARAMS[key] = Math.round((val + dir * step) * 100) / 100;
      }
    }

    // C to copy
    if (e.key === 'c' || e.key === 'C') {
      const lines = PARAM_DEFS.map(d => {
        const v = PARAMS[d.key];
        let display;
        if (d.type === 'bool') display = v ? 'true' : 'false';
        else if (d.type === 'tile') {
          const idx = Math.max(0, Math.min(TILE_OPTIONS.length - 1, Math.round(v)));
          display = `${idx} (${TILE_OPTIONS[idx]})`;
        } else display = typeof v === 'number' ? v.toFixed(2) : String(v);
        return `${d.key}: ${display}`;
      });
      navigator.clipboard.writeText('=== WALL TUNER VALUES ===\n' + lines.join('\n')).catch(() => {});
    }
  });

  window._wallTuner = { params: PARAMS, toggle: () => { enabled = !enabled; } };
}

export function drawWallTuner(ctx, w, h) {
  if (!enabled) return;

  const panelW = 420, lineH = 20, panelX = 8;
  const panelH = (PARAM_DEFS.length + 3) * lineH + 10;
  const panelY = Math.max(8, Math.floor(h / 2 - panelH / 2));

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.9)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = 'rgba(100,200,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6cf';
  ctx.fillText('\\ toggle  / select  ,. adjust  C copy', panelX + 8, panelY + 16);

  for (let i = 0; i < PARAM_DEFS.length; i++) {
    const def = PARAM_DEFS[i];
    const val = PARAMS[def.key];
    const y = panelY + 36 + i * lineH;
    const isSelected = i === selectedParam;

    ctx.fillStyle = isSelected ? '#ffd24a' : '#aaa';
    ctx.font = isSelected ? 'bold 11px monospace' : '11px monospace';

    let display;
    if (def.type === 'bool') display = val ? 'ON' : 'OFF';
    else if (def.type === 'tile') {
      const idx = Math.max(0, Math.min(TILE_OPTIONS.length - 1, Math.round(val)));
      display = `◄ ${TILE_OPTIONS[idx]} ►`;
    } else if (def.type === 'int') display = String(Math.round(val));
    else display = val.toFixed(2);

    const arrow = isSelected ? '► ' : '  ';
    ctx.fillText(`${arrow}${def.key}: ${display}`, panelX + 8, y);

    // Show description for selected param
    if (isSelected) {
      ctx.font = '10px monospace';
      ctx.fillStyle = '#888';
      ctx.fillText(def.desc, panelX + 280, y);
    }
  }

  ctx.restore();
}
