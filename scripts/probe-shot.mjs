import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const OUT = 'C:/Users/daves/AppData/Roaming/wizardgenie/projects/perf-opt/screenshots/';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const cdp = await page.context().newCDPSession(page);
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.ok, null, { timeout: 240000 });
const wait = ms => page.evaluate(m => new Promise(r => setTimeout(r, m)), ms);
const biome = () => page.evaluate(() => window._dbgChunkStore?.tileAt(Math.floor(window._player.x), Math.floor(window._player.y))?.biome);
// how many ready chunks actually have a painted bitmap (vs just tile data)?
const paintedInfo = () => page.evaluate(() => {
  const cs = window._dbgChunkStore; if (!cs) return null;
  let withBmp = 0, total = 0;
  for (const [, c] of cs.chunks) { total++; if (c && (c.bitmap || c.image || c.canvas)) withBmp++; }
  const prov = cs.provider;
  let readyWithBmp = 0, readyTotal = 0;
  if (prov && prov.ready) for (const [, c] of prov.ready) { readyTotal++; if (c && (c.bitmap || c.image || c.canvas)) readyWithBmp++; }
  return { store: { total, withBmp }, provReady: { readyTotal, readyWithBmp } };
});
const shot = async name => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT + name, Buffer.from(data, 'base64'));
};
await wait(15000);
console.log('A biome=', await biome(), 'painted=', JSON.stringify(await paintedInfo()));
await shot('ondemand-A-spawn.png');
await page.evaluate(() => { window._player.x = 9000; window._player.y = -9000; });
await wait(22000);
console.log('B biome=', await biome(), 'painted=', JSON.stringify(await paintedInfo()));
await shot('ondemand-B-teleport.png');
await browser.close();
console.log('done');
