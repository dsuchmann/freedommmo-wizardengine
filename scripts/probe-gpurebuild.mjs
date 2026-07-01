import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1382, height: 900 } });
await ctx.addInitScript(() => { window._gpuFlora = true; });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.animOk, null, { timeout: 240000 });
const wait = ms => page.evaluate(m => new Promise(r => setTimeout(r, m)), ms);
for (let i=0;i<30 && !(await page.evaluate(()=>window._f2PoolN));i++) await wait(1000);
await wait(12000);
// warm the strip cache: walk back+forth a few times in a small loop so strips are cached
for (let k=0;k<8;k++){ await page.evaluate(d=>{window._player.x+=d;}, k%2?-8:8); await wait(2500); }
// now measure rebuilds over a cached back-and-forth (representative CPU cost; strips cached)
const res = await page.evaluate(async () => {
  const ms=[]; let last=window._f2Stats.rebuilds;
  const iv=setInterval(()=>{ const s=window._f2Stats; if(s.rebuilds!==last){ms.push(+s.lastRebuildMs.toFixed(1));last=s.rebuilds;} },16);
  // walk back and forth across the already-cached strip
  for(let k=0;k<10;k++){ window._player.x += (k%2?-8:8); await new Promise(r=>setTimeout(r,1500)); }
  clearInterval(iv);
  const p=(a,q)=>a.length?(+[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*q))].toFixed(1)):0;
  return { poolN: window._f2PoolN, rebuilds: ms.length, rebuildMs_p50: p(ms,.5), rebuildMs_p90: p(ms,.9), rebuildMs_MAX: p(ms,1) };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
