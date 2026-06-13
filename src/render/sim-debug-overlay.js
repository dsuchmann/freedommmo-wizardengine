// Dev debug overlay: draws live sim state (worn paths, road segments, deltas,
// event ticker) as translucent shapes. READ-ONLY over window._simClient.
// Toggle: key 9. Pure collector below is node-testable (no DOM at module top).
// Wire reality 2026-06-12: settlement/plot geometry (territory/districts/plots)
// crosses the wire via explicit wire forms (sim/server/protocol.js).
// Never fake absent layers — honest absence is declared, not simulated.

const EVENT_CAP = 50;

export function collectDebugDrawables(sim) {
  const out = { paths: [], roads: [], deltas: [], settlements: [], plots: [],
                buildings: [], crossings: [], tick: sim?.tick ?? -1 };
  if (!sim?.entities) return out;
  for (const e of sim.entities.values()) {
    if (e.type === 'path') out.paths.push({ x: e.x, y: e.y, wear: e.wear ?? 0 });
    else if (e.type === 'matter' && e.archetype === 'road_segment') out.roads.push({ x: e.x, y: e.y });
    else if (e.type === 'matter' && (e.archetype === 'ford' || e.archetype === 'bridge'))
      out.crossings.push({ x: e.x, y: e.y, kind: e.archetype });
    else if (e.type === 'settlement' && e.territory)
      out.settlements.push({ id: e.id, x: e.x, y: e.y, tier: e.tier, state: e.state,
                             territory: e.territory, districts: e.districts ?? [] });
    else if (e.type === 'plot' && e.rect)
      out.plots.push({ rect: e.rect, owner: e.owner, district: e.district });
    else if (e.type === 'building' && e.footprint)
      out.buildings.push({ template: e.template, footprint: e.footprint, stamps: e.stamps ?? [] });
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
let inspectResult = null;   // last inspect response {summary, events, node}
let inspectPending = false;

const DELTA_COLORS = { worn: 'rgba(255,180,0,0.9)', paved: 'rgba(130,130,255,0.9)' };

export function drawSimDebugOverlay(ctx, camX, camY, tilePx, w, h) {
  if (!enabled) return;
  const sim = (typeof window !== 'undefined') ? window._simClient : null;
  if (sim && sim.events !== lastEventsRef) {       // events batches are replaced; accumulate
    accumulateEvents(seenEvents, sim.events);
    lastEventsRef = sim.events;
  }
  const d = collectDebugDrawables(sim);
  _lastDrawState = { camX, camY, tilePx, settlements: d.settlements };
  const onScreen = (sx, sy) => sx > -tilePx && sy > -tilePx && sx < w + tilePx && sy < h + tilePx;

  ctx.save();
  for (const p of d.paths) {                       // worn-path intensity: amber, alpha by wear
    const sx = Math.floor(p.x * tilePx - camX), sy = Math.floor(p.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = `rgba(255,180,0,${(0.15 + 0.55 * Math.min(1, p.wear / 8)).toFixed(3)})`;
    ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
  }
  for (const r of d.roads) {                       // road segments: blue outline boxes
    const sx = Math.floor(r.x * tilePx - camX), sy = Math.floor(r.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = 'rgba(130,130,255,0.25)';
    ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
    ctx.strokeStyle = 'rgba(130,130,255,0.9)';
    ctx.strokeRect(sx + 0.5, sy + 0.5, Math.ceil(tilePx) - 1, Math.ceil(tilePx) - 1);
  }
  const px = v => Math.ceil(v * tilePx);
  const rectPx = r => [Math.floor(r.x0 * tilePx - camX), Math.floor(r.y0 * tilePx - camY), px(r.w), px(r.h)];
  const rectOnScreen = ([sx, sy, sw, sh]) => sx < w && sy < h && sx + sw > 0 && sy + sh > 0;
  const DISTRICT_COLORS = { residential: 'rgba(80,220,120,', craft: 'rgba(255,150,60,' };
  for (const s of d.settlements) {                 // territory: white dashed outline + tier label
    const r = rectPx(s.territory);
    if (!rectOnScreen(r)) continue;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1);
    ctx.setLineDash([]);
    for (const dist of s.districts) {              // districts: tinted fill + outline by kind
      const dr = rectPx(dist.rect);
      const c = DISTRICT_COLORS[dist.kind] ?? 'rgba(180,180,180,';
      ctx.fillStyle = c + '0.10)';
      ctx.fillRect(...dr);
      ctx.strokeStyle = c + '0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(dr[0] + 0.5, dr[1] + 0.5, dr[2] - 1, dr[3] - 1);
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = c + '0.9)';
      ctx.fillText(dist.kind, dr[0] + 3, dr[1] + 11);
    }
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'left';
    const isRuin = s.state === 'ruined' || s.tier === 'ruins';
    ctx.fillStyle = isRuin ? 'rgba(180,100,80,0.95)' : s.tier === 'ghost' ? 'rgba(160,160,160,0.95)' : '#ffd24a';
    ctx.fillText(isRuin ? 'RUINS' : s.tier.toUpperCase(), r[0] + 3, r[1] - 5);
  }
  for (const p of d.plots) {                       // plots: thin white box + owner tag
    const r = rectPx(p.rect);
    if (!rectOnScreen(r)) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1);
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`g${p.owner}`, r[0] + 2, r[1] + r[3] - 3);
  }
  for (const b of d.buildings) {                   // buildings: stamps are the render truth
    const fr = rectPx(b.footprint);
    if (!rectOnScreen(fr)) continue;
    for (const st of b.stamps) {
      const sx = Math.floor(st.x * tilePx - camX), sy = Math.floor(st.y * tilePx - camY);
      if (st.piece === 'wall') ctx.fillStyle = 'rgba(70,80,95,0.85)';
      else if (st.piece === 'door') ctx.fillStyle = 'rgba(160,110,60,0.85)';
      else ctx.fillStyle = 'rgba(200,190,170,0.35)';            // floor
      ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
    }
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(b.template, fr[0] + 2, fr[1] - 3);
  }
  for (const c of d.crossings) {                   // crossings: teal diamonds
    const sx = Math.floor(c.x * tilePx - camX), sy = Math.floor(c.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = c.kind === 'bridge' ? 'rgba(0,220,220,0.8)' : 'rgba(0,160,160,0.6)';
    const t = Math.ceil(tilePx), hx = sx + t / 2, hy = sy + t / 2;
    ctx.beginPath();
    ctx.moveTo(hx, sy + 2); ctx.lineTo(sx + t - 2, hy); ctx.lineTo(hx, sy + t - 2); ctx.lineTo(sx + 2, hy);
    ctx.closePath();
    ctx.fill();
  }
  for (const dd of d.deltas) {                     // deltas: small corner ticks, color by kind
    const sx = Math.floor(dd.x * tilePx - camX), sy = Math.floor(dd.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = DELTA_COLORS[dd.kind] ?? 'rgba(255,0,255,0.9)';
    ctx.fillRect(sx + 2, sy + 2, Math.max(3, tilePx / 6), Math.max(3, tilePx / 6));
  }
  // event ticker, top-right: last 8 events; settlement_founded highlighted.
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(w - 320, 8, 312, 16 * 9 + 10);
  ctx.fillStyle = '#9ad';
  ctx.fillText(`SIM DEBUG  tick=${d.tick}  paths=${d.paths.length} roads=${d.roads.length} stl=${d.settlements.length} plots=${d.plots.length} bld=${d.buildings.length}`, w - 14, 22);
  seenEvents.slice(-8).forEach((e, i) => {
    ctx.fillStyle = e.type === 'settlement_founded' ? '#ffd24a' : '#ccc';
    ctx.fillText(`[${e.tick}] ${e.type}`, w - 14, 38 + 16 * i);
  });
  // inspect panel: bottom-left, shows "why is this here?" for the last clicked settlement
  if (inspectResult) {
    const panelW = 420, lineH = 15;
    const lines = [];
    lines.push(`— ${inspectResult.node?.type ?? '?'} #${inspectResult.nodeId} at ${inspectResult.node?.x},${inspectResult.node?.y} —`);
    if (inspectResult.node?.attrs?.state === 'ruined') lines.push('STATE: RUINED');
    if (inspectResult.summary) {
      // word-wrap summary to ~50 chars
      const words = inspectResult.summary.split(' ');
      let line = '';
      for (const w2 of words) {
        if ((line + ' ' + w2).length > 55) { lines.push(line); line = w2; }
        else line = line ? line + ' ' + w2 : w2;
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
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
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
    if (!enabled) inspectResult = null;   // clear panel when overlay closes
  });
  // Click-to-inspect: when debug overlay is on, clicking a settlement queries its history
  window.addEventListener('click', (e) => {
    if (!enabled) return;
    const sim = window._simClient;
    if (!sim?.inspect) return;
    const { camX, camY, tilePx, settlements } = _lastDrawState;
    const clickTileX = (e.clientX + camX) / tilePx;
    const clickTileY = (e.clientY + camY) / tilePx;
    // Find the nearest settlement to the click
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
  window._simDebugOverlay = { toggle: () => { enabled = !enabled; }, isEnabled: () => enabled }; // probe hook
}
