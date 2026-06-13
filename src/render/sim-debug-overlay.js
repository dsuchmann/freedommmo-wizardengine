// Civilization overlay: draws settlements with organic layouts from the world compiler.
// Pure functions imported client-side — same deterministic result as the sim.
// Toggle: key 9. Click a settlement to inspect its history.

import { layoutSettlement } from '../../sim/world/buildings/layout.js';
import { computeTerritory } from '../../sim/world/territory.js';

const EVENT_CAP = 50;

// ── Race colors (distinct per race for visual identification) ───────
const RACE_COLORS = {
  human:    { fill: 'rgba(220,200,150,', stroke: 'rgba(220,200,150,' },
  ignaar:   { fill: 'rgba(255,120,40,',  stroke: 'rgba(255,120,40,' },
  veylith:  { fill: 'rgba(160,200,255,', stroke: 'rgba(160,200,255,' },
  grotharn: { fill: 'rgba(100,180,80,',  stroke: 'rgba(100,180,80,' },
  kaldreth: { fill: 'rgba(180,180,200,', stroke: 'rgba(180,180,200,' },
  sylvari:  { fill: 'rgba(80,200,120,',  stroke: 'rgba(80,200,120,' },
  ashren:   { fill: 'rgba(220,180,100,', stroke: 'rgba(220,180,100,' },
  frostwyn: { fill: 'rgba(180,220,255,', stroke: 'rgba(180,220,255,' },
};
const DEFAULT_RACE = { fill: 'rgba(200,200,200,', stroke: 'rgba(200,200,200,' };

export function collectDebugDrawables(sim) {
  const out = { paths: [], roads: [], deltas: [], settlements: [], plots: [],
                buildings: [], crossings: [], groups: [], tick: sim?.tick ?? -1 };
  if (!sim?.entities) return out;
  for (const e of sim.entities.values()) {
    if (e.type === 'path') out.paths.push({ x: e.x, y: e.y, wear: e.wear ?? 0 });
    else if (e.type === 'matter' && e.archetype === 'road_segment') out.roads.push({ x: e.x, y: e.y });
    else if (e.type === 'matter' && (e.archetype === 'ford' || e.archetype === 'bridge'))
      out.crossings.push({ x: e.x, y: e.y, kind: e.archetype });
    else if (e.type === 'settlement' && e.territory)
      out.settlements.push({ id: e.id, x: e.x, y: e.y, tier: e.tier, state: e.state,
                             race: e.race, chronicleAge: e.chronicleAge,
                             territory: e.territory, districts: e.districts ?? [] });
    else if (e.type === 'plot' && e.rect)
      out.plots.push({ rect: e.rect, owner: e.owner, district: e.district });
    else if (e.type === 'building' && e.footprint)
      out.buildings.push({ template: e.template, footprint: e.footprint, stamps: e.stamps ?? [] });
    else if (e.type === 'group' && e.x != null)
      out.groups.push({ id: e.id, x: e.x, y: e.y });
  }
  for (const d of sim.deltas ?? []) {
    if (d.x != null && d.y != null) out.deltas.push({ x: d.x, y: d.y, kind: d.kind });
  }
  return out;
}

export function accumulateEvents(seen, batch) {
  const have = new Set(seen.map(e => e.id));
  for (const e of batch ?? []) if (!have.has(e.id)) seen.push(e);
  if (seen.length > EVENT_CAP) seen.splice(0, seen.length - EVENT_CAP);
  return seen;
}

let enabled = false;
const seenEvents = [];
let lastEventsRef = null;
let inspectResult = null;
let inspectPending = false;

export function drawSimDebugOverlay(ctx, camX, camY, tilePx, w, h) {
  if (!enabled) return;
  const sim = (typeof window !== 'undefined') ? window._simClient : null;
  if (sim && sim.events !== lastEventsRef) {
    accumulateEvents(seenEvents, sim.events);
    lastEventsRef = sim.events;
  }
  const d = collectDebugDrawables(sim);
  _lastDrawState = { camX, camY, tilePx, settlements: d.settlements };
  const onScreen = (sx, sy) => sx > -tilePx && sy > -tilePx && sx < w + tilePx && sy < h + tilePx;
  const px = v => Math.ceil(v * tilePx);
  const rectPx = r => [Math.floor(r.x0 * tilePx - camX), Math.floor(r.y0 * tilePx - camY), px(r.w), px(r.h)];
  const rectOnScreen = ([sx, sy, sw, sh]) => sx < w && sy < h && sx + sw > 0 && sy + sh > 0;

  ctx.save();

  // ── Road segments: filled tiles with road color ───────────────────
  for (const r of d.roads) {
    const sx = Math.floor(r.x * tilePx - camX), sy = Math.floor(r.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = 'rgba(160,140,100,0.4)';
    ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
  }

  // ── Road network lines: draw connections between settlements ──────
  if (d.settlements.length > 1) {
    ctx.lineWidth = Math.max(2, tilePx * 0.15);
    ctx.setLineDash([]);
    for (let i = 0; i < d.settlements.length; i++) {
      const a = d.settlements[i];
      if (a.state === 'ruined') continue;
      for (let j = i + 1; j < d.settlements.length; j++) {
        const b = d.settlements[j];
        if (b.state === 'ruined') continue;
        const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (dist > 100) continue; // only draw nearby connections
        const ax = Math.floor(a.x * tilePx - camX), ay = Math.floor(a.y * tilePx - camY);
        const bx = Math.floor(b.x * tilePx - camX), by = Math.floor(b.y * tilePx - camY);
        ctx.strokeStyle = 'rgba(160,140,100,0.35)';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
  }

  // ── Worn paths: amber intensity by wear ───────────────────────────
  for (const p of d.paths) {
    const sx = Math.floor(p.x * tilePx - camX), sy = Math.floor(p.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = `rgba(255,180,0,${(0.15 + 0.55 * Math.min(1, p.wear / 8)).toFixed(3)})`;
    ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
  }

  // ── Settlements: world-compiler layout ─────────────────────────────
  const DISTRICT_COLORS = {
    residential: 'rgba(80,220,120,', craft: 'rgba(255,150,60,', market: 'rgba(255,220,80,',
    civic: 'rgba(150,180,255,', religious: 'rgba(200,160,255,', military: 'rgba(200,80,80,',
    agricultural: 'rgba(120,180,80,', entertainment: 'rgba(255,180,200,', harbor: 'rgba(80,200,220,',
  };
  const BUILDING_COLORS = {
    wall: 'rgba(70,80,95,0.7)', door: 'rgba(160,110,60,0.8)', floor: 'rgba(200,190,170,0.25)',
  };
  for (const s of d.settlements) {
    const rc = RACE_COLORS[s.race] ?? DEFAULT_RACE;
    const isRuin = s.state === 'ruined' || s.tier === 'ruins';

    // Compute layout client-side (pure, same as sim)
    let layout = null;
    try {
      if (!isRuin) layout = layoutSettlement(42, { x: s.x, y: s.y }, s.tier || 'village', s.race || 'human', 'grassland');
    } catch { /* layout stays null — honest absence */ }

    if (layout) {
      // Road spines: tan lines
      ctx.lineWidth = Math.max(1, tilePx * 0.08);
      ctx.strokeStyle = 'rgba(160,140,100,0.5)';
      for (const spine of layout.spines) {
        ctx.beginPath();
        for (let i = 0; i < spine.points.length; i++) {
          const px2 = Math.floor(spine.points[i].x * tilePx - camX);
          const py2 = Math.floor(spine.points[i].y * tilePx - camY);
          if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
        }
        ctx.stroke();
      }

      // Buildings: colored footprints with type labels
      for (const b of layout.buildings) {
        const fp = b.footprint;
        // Walls
        for (const w of fp.walls) {
          const sx = Math.floor((b.x + w.x) * tilePx - camX), sy = Math.floor((b.y + w.y) * tilePx - camY);
          if (!onScreen(sx, sy)) continue;
          ctx.fillStyle = BUILDING_COLORS.wall;
          ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
        }
        // Floors
        for (const f of fp.floors) {
          const sx = Math.floor((b.x + f.x) * tilePx - camX), sy = Math.floor((b.y + f.y) * tilePx - camY);
          if (!onScreen(sx, sy)) continue;
          ctx.fillStyle = BUILDING_COLORS.floor;
          ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
        }
        // Doors
        for (const d2 of fp.doors) {
          const sx = Math.floor((b.x + d2.x) * tilePx - camX), sy = Math.floor((b.y + d2.y) * tilePx - camY);
          if (!onScreen(sx, sy)) continue;
          ctx.fillStyle = BUILDING_COLORS.door;
          ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
        }
        // Type label
        if (tilePx >= 8) {
          const lx = Math.floor(b.x * tilePx - camX);
          const ly = Math.floor(b.y * tilePx - camY) - 2;
          ctx.font = '9px monospace';
          ctx.textAlign = 'left';
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.fillText(fp.typeName || fp.typeId, lx, ly);
        }
      }

      // District labels at district centers
      for (const dist of layout.districts) {
        const c = DISTRICT_COLORS[dist.kind] ?? 'rgba(180,180,180,';
        // District center approximate: settlement center + angle offset
        const angle = (dist.angleStart + dist.angleEnd) / 2;
        const r2 = dist.radius * 0.5;
        const dx2 = Math.floor((s.x + Math.cos(angle) * r2) * tilePx - camX);
        const dy2 = Math.floor((s.y + Math.sin(angle) * r2) * tilePx - camY);
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = c + '0.9)';
        ctx.fillText(dist.kind, dx2, dy2);
      }
    } else {
      // Fallback: just draw the rect territory (ruins, or layout failed)
      const r = rectPx(s.territory);
      if (!rectOnScreen(r)) continue;
      ctx.setLineDash(isRuin ? [3, 6] : [6, 4]);
      ctx.strokeStyle = isRuin ? 'rgba(140,90,70,0.6)' : rc.stroke + '0.85)';
      ctx.lineWidth = isRuin ? 1 : 2;
      ctx.strokeRect(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1);
      ctx.setLineDash([]);
    }

    // ── Settlement label (rich info) ────────────────────────────────
    const labelX = r[0] + r[2] / 2, labelY = r[1] - 4;
    ctx.textAlign = 'center';

    // Background pill
    const tierName = isRuin ? 'RUINS' : (s.tier ?? 'village').toUpperCase();
    const raceName = s.race ? s.race.charAt(0).toUpperCase() + s.race.slice(1) : '';
    const ageStr = s.chronicleAge ? `${s.chronicleAge} ages` : '';
    const label = isRuin
      ? `${tierName}${raceName ? ' (' + raceName + ')' : ''}${ageStr ? ' · ' + ageStr : ''}`
      : `${tierName}${raceName ? ' · ' + raceName : ''}${ageStr ? ' · ' + ageStr : ''}`;

    ctx.font = 'bold 12px monospace';
    const labelW = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(labelX - labelW / 2, labelY - 12, labelW, 16);

    ctx.fillStyle = isRuin ? 'rgba(180,100,80,0.95)' : rc.stroke + '1)';
    ctx.fillText(label, labelX, labelY);

    // Settlement center marker
    const csx = Math.floor(s.x * tilePx - camX), csy = Math.floor(s.y * tilePx - camY);
    ctx.fillStyle = isRuin ? 'rgba(180,100,80,0.7)' : rc.fill + '0.9)';
    ctx.beginPath();
    ctx.arc(csx, csy, Math.max(4, tilePx * 0.3), 0, Math.PI * 2);
    ctx.fill();
    if (!isRuin) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // ── Plots: building footprint boxes ───────────────────────────────
  for (const p of d.plots) {
    const r = rectPx(p.rect);
    if (!rectOnScreen(r)) continue;
    ctx.fillStyle = 'rgba(200,190,170,0.08)';
    ctx.fillRect(...r);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1);
  }

  // ── Buildings: stamps ─────────────────────────────────────────────
  for (const b of d.buildings) {
    const fr = rectPx(b.footprint);
    if (!rectOnScreen(fr)) continue;
    for (const st of b.stamps) {
      const sx = Math.floor(st.x * tilePx - camX), sy = Math.floor(st.y * tilePx - camY);
      if (st.piece === 'wall') ctx.fillStyle = 'rgba(70,80,95,0.85)';
      else if (st.piece === 'door') ctx.fillStyle = 'rgba(160,110,60,0.85)';
      else ctx.fillStyle = 'rgba(200,190,170,0.35)';
      ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
    }
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(b.template, fr[0] + 2, fr[1] - 3);
  }

  // ── Crossings: teal diamonds ──────────────────────────────────────
  for (const c of d.crossings) {
    const sx = Math.floor(c.x * tilePx - camX), sy = Math.floor(c.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = c.kind === 'bridge' ? 'rgba(0,220,220,0.8)' : 'rgba(0,160,160,0.6)';
    const t = Math.ceil(tilePx), hx = sx + t / 2, hy = sy + t / 2;
    ctx.beginPath();
    ctx.moveTo(hx, sy + 2); ctx.lineTo(sx + t - 2, hy); ctx.lineTo(hx, sy + t - 2); ctx.lineTo(sx + 2, hy);
    ctx.closePath();
    ctx.fill();
  }

  // ── HUD: stats bar (top-right) ───────────────────────────────────
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(w - 340, 8, 332, 16 * 9 + 10);
  ctx.fillStyle = '#9ad';
  const active = d.settlements.filter(s => s.state !== 'ruined').length;
  const ruined = d.settlements.filter(s => s.state === 'ruined').length;
  ctx.fillText(`CIV OVERLAY  tick=${d.tick}  stl=${active}+${ruined}r  roads=${d.roads.length}  plots=${d.plots.length}`, w - 14, 22);
  seenEvents.slice(-8).forEach((e, i) => {
    const isChronicle = e.type?.startsWith('chronicle_') || e.type === 'settlement_founded';
    ctx.fillStyle = isChronicle ? '#ffd24a' : '#999';
    ctx.fillText(`[${e.tick}] ${e.type}`, w - 14, 38 + 16 * i);
  });

  // ── Inspect panel (bottom-left) ───────────────────────────────────
  if (inspectResult) {
    const panelW = 440, lineH = 15;
    const lines = [];
    const n = inspectResult.node;
    const isRuin = n?.attrs?.state === 'ruined';
    const race = n?.attrs?.race;
    const header = `${isRuin ? 'RUINS' : (n?.attrs?.tier ?? n?.type ?? '?').toUpperCase()}`
      + (race ? ` · ${race}` : '') + ` at ${n?.x},${n?.y}`;
    lines.push(header);
    if (inspectResult.summary) {
      const words = inspectResult.summary.split(' ');
      let line = '';
      for (const wd of words) {
        if ((line + ' ' + wd).length > 58) { lines.push(line); line = wd; }
        else line = line ? line + ' ' + wd : wd;
      }
      if (line) lines.push(line);
    }
    lines.push('');
    lines.push('CAUSAL CHAIN:');
    for (const ev of (inspectResult.events ?? []).slice(0, 10)) {
      const age = ev.age != null ? ` (${ev.age} ages ago)` : '';
      lines.push(`  [${ev.eventId}] ${ev.type}${age}`);
    }
    const panelH = (lines.length + 1) * lineH + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(8, h - panelH - 8, panelW, panelH);
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? '#ffd24a' : lines[i].startsWith('  [') ? '#9cf' : '#ccc';
      ctx.fillText(lines[i], 16, h - panelH + 6 + lineH * i);
    }
  } else if (inspectPending) {
    ctx.font = '12px monospace';
    ctx.fillStyle = '#888';
    ctx.textAlign = 'left';
    ctx.fillText('inspecting...', 16, h - 20);
  }

  ctx.restore();
}

/** Store last draw state for click detection. */
let _lastDrawState = { camX: 0, camY: 0, tilePx: 32, settlements: [] };

export function initSimDebugOverlay() {
  window.addEventListener('keydown', (e) => {
    if (e.key !== '9' || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable]')) return;
    enabled = !enabled;
    if (!enabled) inspectResult = null;
  });
  window.addEventListener('click', (e) => {
    if (!enabled) return;
    const sim = window._simClient;
    if (!sim?.inspect) return;
    const { camX, camY, tilePx, settlements } = _lastDrawState;
    const clickTileX = (e.clientX + camX) / tilePx;
    const clickTileY = (e.clientY + camY) / tilePx;
    let best = null, bestDist = Infinity;
    for (const s of settlements) {
      const dx = clickTileX - s.x, dy = clickTileY - s.y;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bestDist && d < 20) { bestDist = d; best = s; }
    }
    if (best) {
      inspectPending = true;
      inspectResult = null;
      sim.inspect(best.id).then(result => {
        inspectPending = false;
        inspectResult = result;
      });
    }
  });
  window._simDebugOverlay = { toggle: () => { enabled = !enabled; }, isEnabled: () => enabled };
}
