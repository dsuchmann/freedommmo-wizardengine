// src/life/eval/stick-renderer.js — Pass 4 L5: skeleton visualiser for pose/motion eval.
// Renders the humanoid rig as a color-coded stick figure using FK from pose.js.
// Works in Node (via @napi-rs/canvas) and in browser (via document.createElement).

import { solvePose } from '../pose.js';

// ── bone visual style ──────────────────────────────────────────────────────────

const BONE_COLORS = {
  spine:    '#e0e0e0',
  head:     '#f0d060',
  arm_u_l:  '#6090e0',
  arm_f_l:  '#6090e0',
  hand_l:   '#6090e0',
  arm_u_r:  '#4070c0',
  arm_f_r:  '#4070c0',
  hand_r:   '#4070c0',
  thigh_l:  '#50b050',
  shin_l:   '#50b050',
  foot_l:   '#50b050',
  thigh_r:  '#308030',
  shin_r:   '#308030',
  foot_r:   '#308030',
};

// Draw order (root is skipped — length 0).
const DRAW_ORDER = [
  'thigh_l', 'shin_l', 'foot_l',
  'thigh_r', 'shin_r', 'foot_r',
  'spine',
  'arm_u_l', 'arm_f_l', 'hand_l',
  'arm_u_r', 'arm_f_r', 'hand_r',
  'head',
];

const BONE_WIDTH   = 3;
const JOINT_RADIUS = 4;

// ── canvas factory ─────────────────────────────────────────────────────────────

async function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    // Browser
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  // Node — dynamic import keeps the module browser-importable
  const mod = await import('@napi-rs/canvas');
  return mod.createCanvas(w, h);
}

async function toPng(canvas) {
  if (typeof document !== 'undefined') {
    // Browser: return the canvas element (caller can draw or export)
    return canvas;
  }
  // Node: @napi-rs/canvas exposes toBuffer or encode
  if (typeof canvas.encode === 'function') {
    return canvas.encode('png');
  }
  return canvas.toBuffer('image/png');
}

// ── core draw routine ──────────────────────────────────────────────────────────

/**
 * Draw a single pose onto ctx.
 * The rig uses y-up coordinates; canvas uses y-down — we flip y.
 * Figure is scaled to fill ~70% of the frame and centered.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} rig   – humanoid rig JSON
 * @param {object} joints – {boneName: degrees}
 * @param {number} x  – top-left of frame
 * @param {number} y  – top-left of frame
 * @param {number} w  – frame width
 * @param {number} h  – frame height
 * @param {{label?: string}} opts
 */
export function drawPose(ctx, rig, joints, x, y, w, h, opts = {}) {
  const solved = solvePose(rig, joints);

  // ── compute bounding box in rig space ──────────────────────────────────────
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const name of DRAW_ORDER) {
    const b = solved[name];
    for (const pt of [b.origin, b.tip]) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  const rigW = maxX - minX || 1;
  const rigH = maxY - minY || 1;

  // target 70% of frame
  const targetW = w * 0.70;
  const targetH = h * 0.70;
  const scale   = Math.min(targetW / rigW, targetH / rigH);

  // centre of rig (rig space)
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // canvas centre of frame
  const ocx = x + w / 2;
  const ocy = y + h / 2;

  // Transform: rig → canvas.  Y is flipped (rig +y = up, canvas +y = down).
  const toC = (rx, ry) => ({
    cx: ocx + (rx - cx) * scale,
    cy: ocy - (ry - cy) * scale,   // flip y
  });

  // ── ground line at lowest foot tip ────────────────────────────────────────
  const footY = Math.min(solved.foot_l.tip.y, solved.foot_r.tip.y);
  const groundC = toC(cx, footY);
  ctx.save();
  ctx.strokeStyle = '#555555';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x,     groundC.cy);
  ctx.lineTo(x + w, groundC.cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // ── bones ─────────────────────────────────────────────────────────────────
  for (const name of DRAW_ORDER) {
    const b   = solved[name];
    const col = BONE_COLORS[name] ?? '#ffffff';
    const o   = toC(b.origin.x, b.origin.y);
    const t   = toC(b.tip.x,    b.tip.y);

    // bone line
    ctx.beginPath();
    ctx.strokeStyle = col;
    ctx.lineWidth   = BONE_WIDTH;
    ctx.moveTo(o.cx, o.cy);
    ctx.lineTo(t.cx, t.cy);
    ctx.stroke();

    // joint circle at origin
    ctx.beginPath();
    ctx.fillStyle   = col;
    ctx.arc(o.cx, o.cy, JOINT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── head tip — large open circle ──────────────────────────────────────────
  const headTip = toC(solved.head.tip.x, solved.head.tip.y);
  ctx.beginPath();
  ctx.strokeStyle = BONE_COLORS.head;
  ctx.lineWidth   = 2;
  ctx.arc(headTip.cx, headTip.cy, 8, 0, Math.PI * 2);
  ctx.stroke();

  // ── optional label ────────────────────────────────────────────────────────
  if (opts.label) {
    ctx.fillStyle  = '#aaaaaa';
    ctx.font       = '11px monospace';
    ctx.textAlign  = 'center';
    ctx.fillText(opts.label, x + w / 2, y + h - 6);
  }
}

// ── public API ─────────────────────────────────────────────────────────────────

/**
 * Render a single pose to a PNG buffer (Node) or canvas element (browser).
 *
 * @param {object} rig
 * @param {object} joints  – {boneName: degrees}
 * @param {{width?: number, height?: number, label?: string}} options
 */
export async function renderPose(rig, joints, { width = 400, height = 600, label } = {}) {
  const canvas = await makeCanvas(width, height);
  const ctx    = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, width, height);

  drawPose(ctx, rig, joints, 0, 0, width, height, { label });

  return toPng(canvas);
}

/**
 * Render N frames side by side with separator lines and an optional title header.
 *
 * @param {object} rig
 * @param {Array<{joints: object, label?: string}>} frames
 * @param {{frameWidth?: number, frameHeight?: number, title?: string}} options
 */
export async function renderStrip(rig, frames, { frameWidth = 200, frameHeight = 400, title } = {}) {
  const TITLE_H  = title ? 28 : 0;
  const totalW   = frameWidth * frames.length;
  const totalH   = frameHeight + TITLE_H;

  const canvas = await makeCanvas(totalW, totalH);
  const ctx    = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, totalW, totalH);

  // Title
  if (title) {
    ctx.fillStyle  = '#cccccc';
    ctx.font       = '14px monospace';
    ctx.textAlign  = 'center';
    ctx.fillText(title, totalW / 2, 18);
  }

  // Frames
  for (let i = 0; i < frames.length; i++) {
    const fx = i * frameWidth;
    const fy = TITLE_H;

    drawPose(ctx, rig, frames[i].joints, fx, fy, frameWidth, frameHeight, {
      label: frames[i].label,
    });

    // Separator line between frames
    if (i > 0) {
      ctx.strokeStyle = '#444444';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx, fy + frameHeight);
      ctx.stroke();
    }
  }

  return toPng(canvas);
}
