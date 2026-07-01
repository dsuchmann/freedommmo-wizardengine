// scripts/probe-f2memo.mjs — A/B the F2-MEMO win. Measures the flora forEach
// time per active sprite WITH memo vs WITHOUT (window.__noMemo), in one run.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer && window._dbgRenderer.glc && window._dbgRenderer.glc.ok && window.__f2prof, null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 30 && !window._f2PoolN; i++) await wait(1000);
  await wait(25000); // settle: full load + wind activity
  const pct = (a, p) => a.length ? +[...a].sort((x, y) => x - y)[Math.floor(a.length * p)].toFixed(2) : 0;
  const measure = async (noMemo, ms) => {
    window.__noMemo = noMemo;
    window.__f2prof.forEach.length = 0; window.__f2prof.active.length = 0;
    await wait(ms);
    const fe = pct(window.__f2prof.forEach, .5);
    const act = pct(window.__f2prof.active, .5);
    return { forEachMs_p50: fe, active_p50: act, perSpriteUs: act ? +(fe * 1000 / act).toFixed(2) : 0, samples: window.__f2prof.forEach.length };
  };
  const withMemo = await measure(false, 4000);
  const noMemo = await measure(true, 4000);
  window.__noMemo = false;
  return { poolN: window._f2PoolN, withMemo, noMemo,
    speedup: noMemo.perSpriteUs && withMemo.perSpriteUs ? +(noMemo.perSpriteUs / withMemo.perSpriteUs).toFixed(2) : 0 };
});
console.log(JSON.stringify(res, null, 2));
try { await page.screenshot({ path: 'C:/Users/daves/AppData/Roaming/wizardgenie/projects/default/screenshots/f2memo.png', timeout: 8000, animations: 'disabled' }); console.log('screenshot saved'); }
catch (e) { console.log('screenshot skipped:', e.message.slice(0, 40)); }
await browser.close();
