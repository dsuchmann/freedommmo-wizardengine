import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = [];
page.on('console', m => { if (m.type()==='error' && /shader|program|GL|anim/i.test(m.text())) errs.push(m.text().slice(0,200)); });
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.ok, null, { timeout: 240000 });
const r = await page.evaluate(() => {
  const g = window._dbgRenderer.glc;
  return { ok: g.ok, spritesOk: g.spritesOk, animOk: g.animOk, hasAtlasStrip: typeof g.atlasStrip === 'function', hasDrawAnim: typeof g.drawAnimSprites === 'function' };
});
console.log(JSON.stringify(r, null, 2));
if (errs.length) console.log('GL errors:', errs.slice(0,5));
await browser.close();
