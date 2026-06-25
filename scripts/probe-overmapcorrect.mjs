// probe-overmapcorrect.mjs — verify the incremental overmap scroll+strip produces the SAME
// image as a from-scratch full resample (catches parity/sign bugs in the scroll, which
// swiftshader can't show visually). Establish base at A, step ONE snapped pixel to B via the
// incremental path, snapshot; then force a full resample at the SAME position B and diff.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8123;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.gl && window._player && window._dbgOvermap, null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const ov = window._dbgOvermap;
  const CHUNK = 64, cs = ov.chunkScale || 2, size = ov.size;
  const px = () => ov.baseCtx.getImageData(0, 0, size, size).data;

  function diff(a, b) {
    let changed = 0, maxd = 0, total = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      total += d; if (d > 6) changed++; if (d > maxd) maxd = d;
    }
    return { changedPixels: changed, totalPixels: (a.length / 4), maxChannelSum: maxd, meanDiff: +(total / (a.length / 4)).toFixed(3) };
  }

  // Settle position, establish base with a full resample.
  window._player.x = 11000; window._player.y = -6000;
  ov.draw(true);
  // Step EAST by several snapped pixels via the incremental path.
  const results = [];
  for (let i = 0; i < 3; i++) {
    window._player.x += cs * CHUNK; // 1 snapped pixel east
    ov.draw();                       // incremental scroll + strip
  }
  const incr = px();
  // Force a full resample at the SAME (current) position and diff.
  ov.draw(true);
  const full = px();
  results.push({ axis: 'east-3px', ...diff(incr, full) });

  // Repeat going SOUTH (the user's walk direction) and on the y-axis strip path.
  window._player.x = 11000; window._player.y = -6000;
  ov.draw(true);
  for (let i = 0; i < 3; i++) { window._player.y += cs * CHUNK; ov.draw(); }
  const incrS = px();
  ov.draw(true);
  const fullS = px();
  results.push({ axis: 'south-3px', ...diff(incrS, fullS) });

  // Diagonal (both strips at once).
  window._player.x = 11000; window._player.y = -6000;
  ov.draw(true);
  for (let i = 0; i < 2; i++) { window._player.x += cs * CHUNK; window._player.y -= cs * CHUNK; ov.draw(); }
  const incrD = px();
  ov.draw(true);
  results.push({ axis: 'diag-2px', ...diff(incrD, px()) });

  return { size, chunkScale: cs, results };
});

console.log(JSON.stringify({ ...res, pageErrors: errors.slice(0, 5) }, null, 2));
await browser.close();
