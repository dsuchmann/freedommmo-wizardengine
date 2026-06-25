import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1382, height: 900 } });
await ctx.addInitScript(() => { try{localStorage.setItem('gpuFlora','1');}catch(e){} });
const page = await ctx.newPage();
let soilMiss = 0, repaintIncomplete = 0; const missMats = new Set();
page.on('console', m => { const t=m.text();
  if (t.includes('[SOIL MISS]')) { soilMiss++; const mm=t.match(/material:\s*(\S+)/); if(mm) missMats.add(mm[1]); }
  if (t.includes('painted incomplete')) repaintIncomplete++;
});
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.ok, null, { timeout: 240000 });
const wait = ms => page.evaluate(m => new Promise(r => setTimeout(r, m)), ms);
for (let i=0;i<25 && !(await page.evaluate(()=>window._f2PoolN));i++) await wait(1000);
const m0 = soilMiss;
// walk through varied biomes to hit transitions
for (let k=0;k<40;k++){ await page.evaluate(d=>{window._player.x+=d;}, 1.2); await wait(400); }
console.log(JSON.stringify({ soilMissDuringWalk: soilMiss - m0, soilMissTotal: soilMiss, missingMaterials: [...missMats], repaintIncompleteLogs: repaintIncomplete }, null, 2));
await browser.close();
