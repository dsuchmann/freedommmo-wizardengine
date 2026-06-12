// scripts/probe-f3-visual.mjs — does F3 actually paint into chunk bitmaps,
// and do tuner edits change the painted result? Hashes the player's chunk
// bitmap under: baseline, f3 density 0, f3 master size 2, reset.
// Run with dev server up on :8741.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('console', m => { if (/SOIL REPAINT|fieldTuning|error/i.test(m.text())) console.log('[page]', m.text()); });
await page.goto('http://localhost:8741/?x=1312&y=1312', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._fieldTuning && window._debugProvider
  && window._debugProvider.getBitmap(20, 20), null, { timeout: 240000 });
await page.waitForTimeout(5000); // let painting settle

const res = await page.evaluate(async () => {
  const prov = window._debugProvider;
  const CX = 20, CY = 20; // chunk of (1312,1312) with chunkSize 64

  function hashBitmap(bmp) {
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let h = 0 >>> 0, sum = 0;
    for (let i = 0; i < d.length; i += 16) { // sample every 4th px
      h = ((h * 31) + d[i] + d[i + 1] + d[i + 2]) >>> 0;
      sum += d[i] + d[i + 1] + d[i + 2];
    }
    return h + ':' + sum;
  }

  async function waitRepaint(timeoutMs) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      if (prov.getBitmap(CX, CY)) { await new Promise(r => setTimeout(r, 500)); return true; }
      prov.schedulePump && prov.schedulePump();
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }

  const out = { bitmapsBefore: prov.stats().bitmaps };
  const baseline = hashBitmap(prov.getBitmap(CX, CY));

  window._fieldTuning.set({ f2: {}, f3: { density: 0 }, f4: {} });
  out.repaint0 = await waitRepaint(60000);
  const h0 = out.repaint0 ? hashBitmap(prov.getBitmap(CX, CY)) : null;

  window._fieldTuning.set({ f2: {}, f3: { size: 2.0 }, f4: {} });
  out.repaint2 = await waitRepaint(60000);
  const h2 = out.repaint2 ? hashBitmap(prov.getBitmap(CX, CY)) : null;

  window._fieldTuning.set({ f2: {}, f3: {}, f4: {} });
  out.repaintR = await waitRepaint(60000);
  const hr = out.repaintR ? hashBitmap(prov.getBitmap(CX, CY)) : null;

  out.density0Differs = h0 !== null && h0 !== baseline;
  out.size2Differs = h2 !== null && h2 !== baseline;
  out.resetMatches = hr !== null && hr === baseline;
  out.hashes = { baseline, h0, h2, hr };
  out.bitmapsAfter = prov.stats().bitmaps;
  return out;
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
// The three post-edit repaints must be pairwise distinct: density-0 (no F3),
// size-2 (big F3), reset (default F3). Boot baseline is informational only —
// it may predate this worker's F3 sprite loading (the heal pass fixes it).
// h2===h0 was the stale-bitmap race; h2===hr would mean size is ignored;
// h0===hr would mean F3 never paints.
const { h0, h2, hr } = res.hashes;
const ok = h0 && h2 && hr && h0 !== h2 && h2 !== hr && h0 !== hr;
console.log(ok ? 'F3 VISUAL PROBE PASSED' : 'F3 VISUAL PROBE FAILED');
process.exit(ok ? 0 : 1);
