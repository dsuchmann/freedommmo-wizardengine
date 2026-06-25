// probe-ondemand.mjs — verify per-chunk on-demand biome loading renders complete
// terrain at spawn AND after a far teleport (fast-travel hot-load), with no error
// flood / runaway repaint. Software-GL headless can't measure real fps, so this
// checks CORRECTNESS of the new streaming path, not framerate.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

let errors = 0, repaintLogs = 0, lastErr = '';
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error') { errors++; lastErr = t.slice(0, 120); }
  if (t.includes('painted incomplete') || t.includes('REPAINT')) repaintLogs++;
});
page.on('pageerror', e => { errors++; lastErr = ('PAGEERR ' + e.message).slice(0, 120); });

const SHOTS = 'C:/Users/daves/AppData/Roaming/wizardgenie/projects/perf-opt/screenshots/';
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });

// 1) wait for renderer + world data at spawn
await page.waitForFunction(() => window._dbgRenderer && window._dbgRenderer.glc && window._dbgRenderer.glc.ok, null, { timeout: 240000 });
const wait = ms => page.evaluate(m => new Promise(r => setTimeout(r, m)), ms);
const biomeAtPlayer = () => page.evaluate(() => {
  const p = window._player, cs = window._dbgChunkStore;
  if (!p || !cs) return null;
  const t = cs.tileAt(Math.floor(p.x), Math.floor(p.y));
  return t ? t.biome : null;
});
const chunkCount = () => page.evaluate(() => window._dbgChunkStore ? window._dbgChunkStore.chunks.size : -1);

// settle spawn area
for (let i = 0; i < 40; i++) { if (await biomeAtPlayer()) break; await wait(1000); }
await wait(8000);
const spawnBiome = await biomeAtPlayer();
const spawnChunks = await chunkCount();
const repaintsAfterSpawn = repaintLogs;
await page.screenshot({ path: SHOTS + 'ondemand-A-spawn.png' }).catch(() => {});

// 2) far teleport -> different region -> must hot-load + render complete
const dest = { x: 9000, y: -9000 };
await page.evaluate(d => { if (window._player) { window._player.x = d.x; window._player.y = d.y; } }, dest);
let destBiome = null;
for (let i = 0; i < 45; i++) { destBiome = await biomeAtPlayer(); if (destBiome) break; await wait(1000); }
await wait(12000); // let the new biome's tiles hot-load + paint
destBiome = await biomeAtPlayer();
const destChunks = await chunkCount();
await page.screenshot({ path: SHOTS + 'ondemand-B-teleport.png' }).catch(() => {});

// 3) check repaint activity has settled (no runaway loop): sample over 6s
const r0 = repaintLogs; await wait(6000); const repaintRate6s = repaintLogs - r0;

console.log(JSON.stringify({
  glcOk: true,
  spawn: { biome: spawnBiome, chunks: spawnChunks, repaintLogsDuringLoad: repaintsAfterSpawn },
  teleport: { dest, biome: destBiome, chunks: destChunks, loadedNewBiome: !!destBiome },
  settled: { repaintLogsIn6sAfterSettle: repaintRate6s },
  errors, lastErr,
}, null, 2));
await browser.close();
