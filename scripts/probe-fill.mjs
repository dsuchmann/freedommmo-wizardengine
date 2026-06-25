import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1382, height: 900 } });
await ctx.addInitScript(() => { try{localStorage.setItem('gpuFlora','1');}catch(e){} });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.animOk, null, { timeout: 240000 });
// start measuring frameJS IMMEDIATELY (capture the initial strip-fill burst), keep walking
const res = await page.evaluate(async () => {
  const fj=[]; const oR=requestAnimationFrame.bind(window);
  window.requestAnimationFrame=cb=>oR(t=>{const s=performance.now();cb(t);fj.push(performance.now()-s);});
  // wait for pool then walk continuously for ~22s through the fill
  for (let i=0;i<25 && !window._f2PoolN;i++) await new Promise(r=>setTimeout(r,1000));
  for (let k=0;k<88;k++){ window._player.x += 0.5; await new Promise(r=>setTimeout(r,250)); }
  window.requestAnimationFrame=oR;
  const p=(a,q)=>a.length?(+[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*q))].toFixed(1)):0;
  const over = a => a.filter(x=>x>50).length;
  return { frames: fj.length, frameJS_p50:p(fj,.5), p95:p(fj,.95), p99:p(fj,.99), MAX:p(fj,1), framesOver50ms: over(fj) };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
