import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const OUT = 'C:/Users/daves/AppData/Roaming/wizardgenie/projects/perf-opt/screenshots/';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1382, height: 900 } });
await ctx.addInitScript(() => { window._gpuFlora = true; });
const page = await ctx.newPage();
const cdp = await page.context().newCDPSession(page);
let errs = 0; page.on('console', m=>{ if(m.type()==='error' && /shader|GL_|WebGL|TypeError|undefined/i.test(m.text())) errs++; });
page.on('pageerror', e=>errs++);
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.animOk, null, { timeout: 240000 });
const wait = ms => page.evaluate(m => new Promise(r => setTimeout(r, m)), ms);
for (let i=0;i<30 && !(await page.evaluate(()=>window._f2PoolN));i++) await wait(1000);
await wait(15000); // settle + cache strips
// reset stats, then walk continuously while measuring amort step + rebuild events
const res = await page.evaluate(async () => {
  window._f2Stats.amortStepMaxMs = 0;
  let lastRb = window._f2Stats.rebuilds, rebuildEvents = 0;
  const iv = setInterval(()=>{ if(window._f2Stats.rebuilds!==lastRb){rebuildEvents++;lastRb=window._f2Stats.rebuilds;} }, 16);
  const startX = window._player.x;
  for (let k=0;k<40;k++){ window._player.x += 0.8; await new Promise(r=>setTimeout(r,250)); } // ~32 tiles
  clearInterval(iv);
  return { walked:+(window._player.x-startX).toFixed(0), poolN: window._f2PoolN,
    gpuGusting: window._f2Stats.gpuGusting, rebuildEvents,
    amortStepMaxMs: +window._f2Stats.amortStepMaxMs.toFixed(1), lastRebuildMs: +window._f2Stats.lastRebuildMs.toFixed(1) };
});
console.log(JSON.stringify(res, null, 2));
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'amort.png', Buffer.from(data,'base64'));
console.log('errors:', errs);
await browser.close();
