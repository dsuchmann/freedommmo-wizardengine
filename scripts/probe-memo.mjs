// probe-memo.mjs — verify F2-MEMO cuts the per-frame resolve. Counts glc.atlasRect
// calls per frame at steady state (full pool, mostly at-rest sprites). WITHOUT the
// memo, atlasRect is called for ~every active sprite every frame; WITH it, only for
// the few whose animation frame changed. Also screenshots to confirm flora renders.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const OUT = 'C:/Users/daves/AppData/Roaming/wizardgenie/projects/perf-opt/screenshots/';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
const cdp = await page.context().newCDPSession(page);
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.gl && window._f2Stats, null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 30 && !window._f2PoolN; i++) await wait(1000);
  await wait(12000); // settle: full pool, sprites resolved

  const glc = window._dbgRenderer.glc;
  let calls = 0; const oAR = glc.atlasRect.bind(glc);
  glc.atlasRect = function (...a) { calls++; return oAR(...a); };

  // count frames via rAF over 3s, stationary
  let frames = 0, go = 1; const tk = () => { if (!go) return; frames++; requestAnimationFrame(tk); };
  requestAnimationFrame(tk);
  await wait(3000);
  go = 0; glc.atlasRect = oAR;

  return {
    activeSprites: window._f2Stats.activeCount, poolN: window._f2PoolN,
    frames, atlasRectCalls: calls,
    callsPerFrame: frames ? +(calls / frames).toFixed(1) : 0,
    callsPerFramePerActive: (frames && window._f2Stats.activeCount) ? +(calls / frames / window._f2Stats.activeCount).toFixed(3) : 0,
    atlasGen: glc.atlasGen,
  };
});
console.log(JSON.stringify(res, null, 2));
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'memo-verify.png', Buffer.from(data, 'base64'));
console.log('screenshot saved');
await browser.close();
