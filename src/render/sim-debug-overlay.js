// Civilization overlay: draws settlements with organic layouts from the world compiler.
// Pure functions imported client-side — same deterministic result as the sim.
// Toggle: key 9. Click a settlement to inspect its history.

import { layoutSettlement, TIER_NAMES } from '../../sim/world/buildings/layout.js';
import { computeTerritory } from '../../sim/world/territory.js';
import { generateSettlementName } from '../../sim/world/buildings/specializations.js';
import { MACRO } from '../../sim/world/genesis.js';
import { REGION } from '../../sim/lod/aggregate.js';
import { worldEpochs } from '../../sim/chronicle/epochs.js';
import { macroCellPeoples } from '../../sim/chronicle/races.js';
import { regionChronicle, settlementState, chronicleTier } from '../../sim/chronicle/chronicle.js';
import { classifyBiome } from '../world/biomes.js';
import { rand } from '../../sim/kernel/rng.js';

const MAX_OVERLAY_BUILDINGS = 80; // cap layout generation for performance

const EVENT_CAP = 50;
const MACRO_TILES = MACRO * REGION;
const WORLD_SEED = 42;  // must match sim seed

/** Discover all settlements visible on screen by evaluating the chronicle directly.
 *  Pure function — no sim needed. Returns [{x, y, tier, race, state, chronicleAge}]. */
function discoverSettlements(camX, camY, w, h, tilePx) {
  const margin = MACRO_TILES * tilePx * 3; // scan 3 macro-cells beyond screen
  const tileX0 = Math.floor((camX - margin) / tilePx);
  const tileY0 = Math.floor((camY - margin) / tilePx);
  const tileX1 = Math.ceil((camX + w + margin) / tilePx);
  const tileY1 = Math.ceil((camY + h + margin) / tilePx);
  const mx0 = Math.floor(tileX0 / MACRO_TILES), mx1 = Math.ceil(tileX1 / MACRO_TILES);
  const my0 = Math.floor(tileY0 / MACRO_TILES), my1 = Math.ceil(tileY1 / MACRO_TILES);

  const epochs = worldEpochs(WORLD_SEED);
  const settlements = [];
  for (let my = my0; my <= my1; my++) {
    for (let mx = mx0; mx <= mx1; mx++) {
      const mk = `${mx},${my}`;
      const cx = mx * MACRO_TILES + Math.floor(MACRO_TILES / 2);
      const cy = my * MACRO_TILES + Math.floor(MACRO_TILES / 2);
      const biome = classifyBiome(cx, cy);
      const peoples = macroCellPeoples(WORLD_SEED, mk, epochs, biome);
      const chronicle = regionChronicle(WORLD_SEED, mk, peoples, biome.climate);
      const state = settlementState(chronicle);
      if (state === 'wilderness') continue;

      // Same position logic as genesis
      const ox = Math.floor((rand(WORLD_SEED, mx * 7 + 1, my * 13 + 2) - 0.5) * MACRO_TILES * 0.5);
      const oy = Math.floor((rand(WORLD_SEED, mx * 11 + 3, my * 17 + 4) - 0.5) * MACRO_TILES * 0.5);
      const x = cx + ox, y = cy + oy;

      const foundingEv = chronicle.find(e => e.type === 'ancient_founding' || e.type === 'founding');
      const race = foundingEv?.raceId ?? peoples[0]?.raceId ?? 'human';
      const chronicleAge = chronicle.length > 0 ? Math.max(...chronicle.map(e => e.age ?? 0)) : 0;
      const tier = state === 'ruined' ? 'ruins'
        : chronicleTier(chronicle, WORLD_SEED, mk);

      // Skip settlements centered on water
      const siteBiome = classifyBiome(x, y);
      if (['ocean', 'deep_ocean', 'lake', 'river', 'shallow_water'].includes(siteBiome.id)) continue;

      const name = generateSettlementName(WORLD_SEED, x, y);
      settlements.push({ x, y, tier, race, state, chronicleAge, biome: siteBiome.id, name });
    }
  }

  // ── Spacing enforcement: larger settlements suppress nearby smaller ones ──
  // Sort by tier rank (largest first). Each settlement has a suppression radius
  // proportional to its size. Smaller settlements within that radius are removed.
  const TIER_RANK = {};
  TIER_NAMES.forEach((t, i) => TIER_RANK[t] = i);
  TIER_RANK.ruins = -1;

  // Minimum tile distance between settlement centers by tier
  const MIN_SPACING = {
    homestead: 30, hamlet: 40, village: 50, township: 60,
    town: 80, borough: 100, city: 140, great_city: 180,
    capital: 220, metropolis: 280, megacity: 350, world_capital: 440,
    ruins: 30,
  };

  settlements.sort((a, b) => (TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0));
  const kept = [];
  for (const s of settlements) {
    const spacing = MIN_SPACING[s.tier] ?? 50;
    let tooClose = false;
    for (const k of kept) {
      const dist = Math.abs(s.x - k.x) + Math.abs(s.y - k.y);
      // A smaller settlement is suppressed if it's within the LARGER settlement's spacing
      const largerSpacing = MIN_SPACING[k.tier] ?? 50;
      if (dist < largerSpacing && (TIER_RANK[k.tier] ?? 0) >= (TIER_RANK[s.tier] ?? 0)) {
        tooClose = true; break;
      }
      // Two settlements of same tier: use the smaller spacing
      if (dist < Math.min(spacing, largerSpacing) * 0.7) {
        tooClose = true; break;
      }
    }
    if (!tooClose) kept.push(s);
  }
  return kept;
}

let _discoveredCache = { key: '', settlements: [] };

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
let selectedBuilding = null;   // clicked building with full metadata
let selectedSettlement = null; // clicked settlement (aggregate view)
let _renderedBuildings = [];   // [{x, y, w, h, building, settlement}] for click detection
let _teleportButtons = [];
let _teleportHover = -1;

export function drawSimDebugOverlay(ctx, camX, camY, tilePx, w, h) {
  if (!enabled) return;
  const sim = (typeof window !== 'undefined') ? window._simClient : null;
  if (sim && sim.events !== lastEventsRef) {
    accumulateEvents(seenEvents, sim.events);
    lastEventsRef = sim.events;
  }
  const d = collectDebugDrawables(sim);
  // Discover ALL settlements on screen from the chronicle (pure, no sim needed)
  // Cache aggressively: only recompute on large camera jumps (1000px+) to avoid per-frame layout generation
  const cacheKey = `${Math.floor(camX / 500)},${Math.floor(camY / 500)},${Math.floor(tilePx * 10)}`;
  if (_discoveredCache.key !== cacheKey) {
    _discoveredCache = { key: cacheKey, settlements: discoverSettlements(camX, camY, w, h, tilePx) };
  }
  const allSettlements = _discoveredCache.settlements;
  _lastDrawState = { camX, camY, tilePx, settlements: allSettlements };
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
  if (allSettlements.length > 1) {
    ctx.lineWidth = Math.max(2, tilePx * 0.15);
    ctx.setLineDash([]);
    for (let i = 0; i < allSettlements.length; i++) {
      const a = allSettlements[i];
      if (a.state === 'ruined') continue;
      for (let j = i + 1; j < allSettlements.length; j++) {
        const b = allSettlements[j];
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
  // Global occupied tile tracker — prevents cross-settlement building overlap
  const globalOccupied = new Set();
  _renderedBuildings = [];
  for (const s of allSettlements) {
    const rc = RACE_COLORS[s.race] ?? DEFAULT_RACE;
    const isRuin = s.state === 'ruined' || s.tier === 'ruins';
    const csx = Math.floor(s.x * tilePx - camX), csy = Math.floor(s.y * tilePx - camY);
    if (!onScreen(csx, csy)) continue;

    // Compute layout client-side (pure, same as sim)
    // Cap at MAX_OVERLAY_BUILDINGS to prevent freeze on metropolis+
    let layout = null;
    try {
      const overlayTier = s.tier || 'village';
      if (!isRuin) layout = layoutSettlement(42, { x: s.x, y: s.y }, overlayTier, s.race || 'human', s.biome || 'grassland');
      // Cap buildings for rendering performance
      if (layout && layout.buildings.length > MAX_OVERLAY_BUILDINGS) {
        layout = { ...layout, buildings: layout.buildings.slice(0, MAX_OVERLAY_BUILDINGS) };
      }
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

      // Buildings: draw as filled bounding-box outlines (fast) with type labels
      for (const b of layout.buildings) {
        const fp = b.footprint;
        const bb = fp.boundingBox;

        // Skip buildings touching any water (check corners + center)
        const WATER = new Set(['ocean', 'deep_ocean', 'lake', 'river', 'shallow_water', 'stream']);
        const checkPoints = [
          [b.x, b.y], [b.x + bb.w - 1, b.y],
          [b.x, b.y + bb.h - 1], [b.x + bb.w - 1, b.y + bb.h - 1],
          [b.x + Math.floor(bb.w / 2), b.y + Math.floor(bb.h / 2)],
        ];
        if (checkPoints.some(([px, py]) => WATER.has(classifyBiome(px, py).id))) continue;

        // Cross-settlement overlap check: skip if any tile already occupied
        let overlaps = false;
        for (let dy = 0; dy < bb.h && !overlaps; dy++) {
          for (let dx = 0; dx < bb.w && !overlaps; dx++) {
            if (globalOccupied.has(`${b.x + dx},${b.y + dy}`)) overlaps = true;
          }
        }
        if (overlaps) continue;
        // Mark tiles as occupied (with 2-tile margin)
        for (let dy = -2; dy < bb.h + 2; dy++) {
          for (let dx = -2; dx < bb.w + 2; dx++) {
            globalOccupied.add(`${b.x + dx},${b.y + dy}`);
          }
        }

        const bsx = Math.floor(b.x * tilePx - camX), bsy = Math.floor(b.y * tilePx - camY);
        const bw = Math.ceil(bb.w * tilePx), bh = Math.ceil(bb.h * tilePx);
        if (bsx > w || bsy > h || bsx + bw < 0 || bsy + bh < 0) continue;

        // Fill
        ctx.fillStyle = BUILDING_COLORS.floor;
        ctx.fillRect(bsx, bsy, bw, bh);
        // Outline (walls)
        ctx.strokeStyle = BUILDING_COLORS.wall;
        ctx.lineWidth = Math.max(1, tilePx * 0.1);
        ctx.strokeRect(bsx + 0.5, bsy + 0.5, bw - 1, bh - 1);
        // Non-rect sections: draw additional section outlines for L/T/compound shapes
        if (fp.sections.length > 1) {
          for (const sec of fp.sections) {
            const ssx = Math.floor((b.x + sec.x0) * tilePx - camX);
            const ssy = Math.floor((b.y + sec.y0) * tilePx - camY);
            ctx.strokeRect(ssx + 0.5, ssy + 0.5, Math.ceil(sec.w * tilePx) - 1, Math.ceil(sec.h * tilePx) - 1);
          }
        }
        // Doors: small colored marks
        for (const d2 of fp.doors) {
          const dsx = Math.floor((b.x + d2.x) * tilePx - camX);
          const dsy = Math.floor((b.y + d2.y) * tilePx - camY);
          ctx.fillStyle = BUILDING_COLORS.door;
          ctx.fillRect(dsx, dsy, Math.ceil(tilePx), Math.ceil(tilePx));
        }
        // Building label: show brand name if available, otherwise type name
        if (tilePx >= 6) {
          ctx.font = '9px monospace';
          ctx.textAlign = 'left';
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          const label = b.brand?.name || fp.typeName || fp.typeId;
          ctx.fillText(label, bsx + 2, bsy - 2);
        }
        // Track for click detection
        _renderedBuildings.push({ screenX: bsx, screenY: bsy, screenW: bw, screenH: bh, building: b, settlement: s });
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
      // Fallback: marker dot for ruins or layout-failed settlements
      ctx.fillStyle = isRuin ? 'rgba(140,90,70,0.5)' : rc.fill + '0.5)';
      ctx.beginPath();
      ctx.arc(csx, csy, Math.max(6, tilePx * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Settlement label (rich info) ────────────────────────────────
    const labelX = csx, labelY = csy - 20;
    ctx.textAlign = 'center';

    // Background pill — settlement name + tier + race
    const settlementName = s.name ?? 'Unknown';
    const tierName = isRuin ? 'ruins' : (s.tier ?? 'village');
    const raceName = s.race ? s.race.charAt(0).toUpperCase() + s.race.slice(1) : '';
    const label = isRuin
      ? `${settlementName} (${tierName}${raceName ? ' · ' + raceName : ''})`
      : `${settlementName} — ${tierName}${raceName ? ' · ' + raceName : ''}`;

    ctx.font = 'bold 12px monospace';
    const labelW = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(labelX - labelW / 2, labelY - 12, labelW, 16);

    ctx.fillStyle = isRuin ? 'rgba(180,100,80,0.95)' : rc.stroke + '1)';
    ctx.fillText(label, labelX, labelY);

    // Settlement center marker
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
  const active = allSettlements.filter(s => s.state !== 'ruined').length;
  const ruined = allSettlements.filter(s => s.state === 'ruined').length;
  ctx.fillText(`CIV OVERLAY  tick=${d.tick}  stl=${active}+${ruined}r  roads=${d.roads.length}  plots=${d.plots.length}`, w - 14, 22);
  seenEvents.slice(-8).forEach((e, i) => {
    const isChronicle = e.type?.startsWith('chronicle_') || e.type === 'settlement_founded';
    ctx.fillStyle = isChronicle ? '#ffd24a' : '#999';
    ctx.fillText(`[${e.tick}] ${e.type}`, w - 14, 38 + 16 * i);
  });

  // ── Teleport panel (left side) ───────────────────────────────────
  const TELEPORT_W = 180, TELEPORT_BTN_H = 22, TELEPORT_PAD = 4;
  const teleportPanelH = TIER_NAMES.length * (TELEPORT_BTN_H + TELEPORT_PAD) + 30;
  const teleportY0 = 8;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(8, teleportY0, TELEPORT_W, teleportPanelH);
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9ad';
  ctx.fillText('TELEPORT TO TIER', 14, teleportY0 + 16);

  // Count visible settlements per tier
  const tierCounts = {};
  for (const s of allSettlements) {
    if (s.state !== 'ruined') tierCounts[s.tier] = (tierCounts[s.tier] ?? 0) + 1;
  }

  // Store button rects for click detection
  _teleportButtons = [];
  for (let i = 0; i < TIER_NAMES.length; i++) {
    const name = TIER_NAMES[i];
    const by = teleportY0 + 24 + i * (TELEPORT_BTN_H + TELEPORT_PAD);
    const count = tierCounts[name] ?? 0;
    const isHover = _teleportHover === i;

    // Button background
    ctx.fillStyle = isHover ? 'rgba(100,140,200,0.5)' : 'rgba(40,50,60,0.7)';
    ctx.fillRect(12, by, TELEPORT_W - 8, TELEPORT_BTN_H);

    // Tier number + name
    ctx.font = '11px monospace';
    ctx.fillStyle = count > 0 ? '#eee' : '#666';
    const label = `${(i + 1).toString().padStart(2)} ${name.replace('_', ' ')}`;
    ctx.fillText(label, 16, by + 15);

    // Count badge
    if (count > 0) {
      ctx.fillStyle = '#7bf';
      ctx.textAlign = 'right';
      ctx.fillText(`${count}`, TELEPORT_W - 2, by + 15);
      ctx.textAlign = 'left';
    }

    _teleportButtons.push({ x: 12, y: by, w: TELEPORT_W - 8, h: TELEPORT_BTN_H, tier: name });
  }

  // ── Detail panel (right side) — building or settlement view ────────
  const PANEL_W = 320, LINE_H = 15, PANEL_X = w - PANEL_W - 8;
  if (selectedBuilding) {
    const b = selectedBuilding;
    const s = selectedSettlement;
    const fp = b.footprint;
    const lines = [];
    lines.push({ text: `${b.brand?.name ?? fp.typeName}`, color: '#ffd24a' });
    lines.push({ text: ``, color: '#666' });
    lines.push({ text: `TYPE: ${fp.typeName} (${fp.category})`, color: '#ccc' });
    if (b.specialization) lines.push({ text: `SPECIALIZATION: ${b.specialization.name}`, color: '#9cf' });
    if (b.specialization?.desc) lines.push({ text: `  "${b.specialization.desc}"`, color: '#888' });
    lines.push({ text: `DISTRICT: ${b.district}`, color: '#ada' });
    lines.push({ text: ``, color: '#666' });
    if (s) {
      lines.push({ text: `SETTLEMENT: ${s.name}`, color: '#ddd' });
      lines.push({ text: `  Tier: ${s.tier} · Race: ${s.race}`, color: '#aaa' });
      lines.push({ text: `  Age: ${s.chronicleAge} ages · Biome: ${s.biome}`, color: '#aaa' });
    }
    lines.push({ text: ``, color: '#666' });
    if (b.owner) lines.push({ text: `OWNER: ${b.owner}`, color: '#cba' });
    if (b.brand?.name) lines.push({ text: `BRAND: ${b.brand.name}`, color: '#ec9' });
    lines.push({ text: `SIZE: ${fp.boundingBox.w}×${fp.boundingBox.h} tiles`, color: '#aaa' });
    lines.push({ text: `PATTERN: ${fp.sections?.length ?? 1} sections`, color: '#aaa' });
    lines.push({ text: ``, color: '#666' });
    if (b.inventory) {
      lines.push({ text: `INVENTORY:`, color: '#9cf' });
      for (const item of (b.inventory.base ?? []).slice(0, 5)) {
        lines.push({ text: `  [base] ${item}`, color: '#888' });
      }
      for (const item of (b.inventory.specialty ?? []).slice(0, 5)) {
        lines.push({ text: `  [spec] ${item}`, color: '#adf' });
      }
    }
    if (fp.interior) {
      const int = fp.interior;
      lines.push({ text: ``, color: '#666' });
      lines.push({ text: `INTERIOR (${int.condition?.name ?? '?'}):`, color: '#da8' });
      lines.push({ text: `  Floor: ${int.floor?.name ?? '?'}`, color: '#aaa' });
      if (int.walls?.length) {
        const wCounts = {};
        for (const w2 of int.walls) wCounts[w2.name] = (wCounts[w2.name] ?? 0) + 1;
        let wLine = '  Walls: ';
        for (const [n, c] of Object.entries(wCounts)) wLine += `${c}× ${n}, `;
        lines.push({ text: wLine.slice(0, -2), color: '#aaa' });
      }
      if (int.structure?.length) {
        lines.push({ text: `  Structure:`, color: '#aaa' });
        for (const s2 of int.structure) {
          const dir = s2.direction ? ` (${s2.direction})` : '';
          lines.push({ text: `    ${s2.name}${dir}`, color: '#888' });
        }
      }
      if (int.furniture?.length) {
        lines.push({ text: `  Furniture:`, color: '#aaa' });
        const fCounts = {};
        for (const f2 of int.furniture) fCounts[f2.name] = (fCounts[f2.name] ?? 0) + 1;
        for (const [n, c] of Object.entries(fCounts)) {
          lines.push({ text: `    ${c > 1 ? c + '× ' : ''}${n}`, color: '#888' });
        }
      }
      if (int.objects?.length) {
        const MAX_C = 36;
        lines.push({ text: `  Objects:`, color: '#aaa' });
        let oLine = '    ';
        for (const o of int.objects) {
          if ((oLine + o.name + ', ').length > MAX_C) { lines.push({ text: oLine, color: '#888' }); oLine = '    '; }
          oLine += (oLine.length > 4 ? ', ' : '') + o.name;
        }
        if (oLine.length > 4) lines.push({ text: oLine, color: '#888' });
      }
      if (int.decorative?.length) {
        lines.push({ text: `  Decor:`, color: '#aaa' });
        for (const dec of int.decorative) {
          lines.push({ text: `    ${dec.name} (${dec.placement})`, color: '#888' });
        }
      }
    }
    lines.push({ text: ``, color: '#666' });
    lines.push({ text: `[click elsewhere to close · click settlement label for overview]`, color: '#666' });

    const panelH = (lines.length + 1) * LINE_H + 10;
    const panelY = Math.max(8, h / 2 - panelH / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(PANEL_X, panelY, PANEL_W, panelH);
    ctx.strokeStyle = 'rgba(255,215,74,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(PANEL_X, panelY, PANEL_W, panelH);
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = lines[i].color;
      ctx.fillText(lines[i].text, PANEL_X + 8, panelY + 14 + LINE_H * i);
    }
  } else if (selectedSettlement) {
    // Settlement aggregate view
    const s = selectedSettlement;
    const layout = (() => { try { return layoutSettlement(42, { x: s.x, y: s.y }, s.tier || 'village', s.race || 'human', s.biome || 'grassland'); } catch { return null; } })();
    const lines = [];
    lines.push({ text: `${s.name} — ${(s.tier || 'village').toUpperCase()}`, color: '#ffd24a' });
    lines.push({ text: `Race: ${s.race} · Age: ${s.chronicleAge} ages · Biome: ${s.biome}`, color: '#aaa' });
    lines.push({ text: ``, color: '#666' });
    if (layout) {
      lines.push({ text: `BUILDINGS: ${layout.buildings.length} total`, color: '#ccc' });
      lines.push({ text: `DISTRICTS: ${layout.districts.length}`, color: '#ccc' });
      lines.push({ text: `ROADS: ${layout.spines.length} spines`, color: '#ccc' });
      lines.push({ text: ``, color: '#666' });
      // Aggregate by category
      const cats = {};
      for (const b of layout.buildings) {
        const cat = b.footprint.category ?? 'unknown';
        cats[cat] = (cats[cat] ?? 0) + 1;
      }
      lines.push({ text: `BY CATEGORY:`, color: '#9cf' });
      for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
        lines.push({ text: `  ${cat}: ${count}`, color: '#aaa' });
      }
      lines.push({ text: ``, color: '#666' });
      // Aggregate by district
      const dists = {};
      for (const b of layout.buildings) {
        dists[b.district] = (dists[b.district] ?? 0) + 1;
      }
      lines.push({ text: `BY DISTRICT:`, color: '#ada' });
      for (const [dist, count] of Object.entries(dists).sort((a, b) => b[1] - a[1])) {
        lines.push({ text: `  ${dist}: ${count} buildings`, color: '#aaa' });
      }
      lines.push({ text: ``, color: '#666' });
      // List specializations
      const specs = layout.buildings.filter(b => b.specialization).map(b => `${b.brand?.name ?? b.footprint.typeName} (${b.specialization?.name ?? ''})`);
      if (specs.length > 0) {
        lines.push({ text: `BUSINESSES:`, color: '#ec9' });
        for (const sp of specs.slice(0, 15)) {
          lines.push({ text: `  ${sp}`, color: '#aaa' });
        }
        if (specs.length > 15) lines.push({ text: `  ... and ${specs.length - 15} more`, color: '#666' });
      }
    }
    lines.push({ text: ``, color: '#666' });
    lines.push({ text: `[click a building for details · click elsewhere to close]`, color: '#666' });

    const panelH = Math.min(h - 20, (lines.length + 1) * LINE_H + 10);
    const panelY = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(PANEL_X, panelY, PANEL_W, panelH);
    ctx.strokeStyle = 'rgba(100,200,255,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(PANEL_X, panelY, PANEL_W, panelH);
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i < Math.floor((panelH - 10) / LINE_H); i++) {
      if (i >= lines.length) break;
      ctx.fillStyle = lines[i].color;
      ctx.fillText(lines[i].text, PANEL_X + 8, panelY + 14 + LINE_H * i);
    }
  }

  ctx.restore();
}

/** Store last draw state for click detection. */
let _lastDrawState = { camX: 0, camY: 0, tilePx: 32, settlements: [] };

/** Scan outward from current camera position to find a settlement of the given tier.
 *  Evaluates macro-cells in expanding rings (up to 1000 cells out). */
function findSettlementOfTier(targetTier, camX, camY, tilePx) {
  const epochs = worldEpochs(WORLD_SEED);
  const centerTileX = Math.floor(camX / tilePx + 500 / tilePx);
  const centerTileY = Math.floor(camY / tilePx + 400 / tilePx);
  const centerMx = Math.floor(centerTileX / MACRO_TILES);
  const centerMy = Math.floor(centerTileY / MACRO_TILES);

  for (let ring = 0; ring <= 1000; ring++) {
    // Scan all cells at Manhattan distance `ring` from center
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== ring) continue; // only the ring perimeter
        const mx = centerMx + dx, my = centerMy + dy;
        const mk = `${mx},${my}`;
        const cx = mx * MACRO_TILES + Math.floor(MACRO_TILES / 2);
        const cy = my * MACRO_TILES + Math.floor(MACRO_TILES / 2);
        const biome = classifyBiome(cx, cy);
        const peoples = macroCellPeoples(WORLD_SEED, mk, epochs, biome);
        const chronicle = regionChronicle(WORLD_SEED, mk, peoples, biome.climate);
        const state = settlementState(chronicle);
        if (state === 'wilderness' || state === 'ruined') continue;

        const tier = chronicleTier(chronicle, WORLD_SEED, mk);
        if (tier !== targetTier) continue;

        // Found it - compute site position
        const ox = Math.floor((rand(WORLD_SEED, mx * 7 + 1, my * 13 + 2) - 0.5) * MACRO_TILES * 0.5);
        const oy = Math.floor((rand(WORLD_SEED, mx * 11 + 3, my * 17 + 4) - 0.5) * MACRO_TILES * 0.5);
        return { x: cx + ox, y: cy + oy };
      }
    }
  }
  return null;
}

export function initSimDebugOverlay() {
  window.addEventListener('keydown', (e) => {
    if (e.key !== '9' || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable]')) return;
    enabled = !enabled;
    if (!enabled) inspectResult = null;
  });
  window.addEventListener('mousemove', (e) => {
    if (!enabled) return;
    _teleportHover = -1;
    for (let i = 0; i < _teleportButtons.length; i++) {
      const b = _teleportButtons[i];
      if (e.clientX >= b.x && e.clientX <= b.x + b.w &&
          e.clientY >= b.y && e.clientY <= b.y + b.h) {
        _teleportHover = i;
        break;
      }
    }
  });
  window.addEventListener('click', (e) => {
    if (!enabled) return;

    // Check teleport panel clicks first
    for (const b of _teleportButtons) {
      if (e.clientX >= b.x && e.clientX <= b.x + b.w &&
          e.clientY >= b.y && e.clientY <= b.y + b.h) {
        const { camX, camY, tilePx } = _lastDrawState;
        const target = findSettlementOfTier(b.tier, camX, camY, tilePx);
        if (target) {
          window.location.href = `/?x=${target.x}&y=${target.y}`;
        }
        return; // consumed by teleport panel
      }
    }

    // Building click: check rendered buildings first
    for (const rb of _renderedBuildings) {
      if (e.clientX >= rb.screenX && e.clientX <= rb.screenX + rb.screenW &&
          e.clientY >= rb.screenY && e.clientY <= rb.screenY + rb.screenH) {
        selectedBuilding = rb.building;
        selectedSettlement = rb.settlement;
        return;
      }
    }

    // Settlement label click: check nearby settlement centers
    const { camX, camY, tilePx, settlements } = _lastDrawState;
    const clickTileX = (e.clientX + camX) / tilePx;
    const clickTileY = (e.clientY + camY) / tilePx;
    for (const s of settlements) {
      const dx = clickTileX - s.x, dy = clickTileY - s.y;
      if (Math.abs(dx) + Math.abs(dy) < 10) {
        selectedBuilding = null;
        selectedSettlement = s;
        return;
      }
    }

    // Click on empty space: clear selection
    selectedBuilding = null;
    selectedSettlement = null;
  });
  window._simDebugOverlay = { toggle: () => { enabled = !enabled; }, isEnabled: () => enabled };
}
