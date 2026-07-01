// Off-thread sprite denoise worker (opt-in via window._denoiseWorker).
// Runs the SAME spatial denoise as field2-animator.js:denoiseImage(), but off
// the main thread and WITHOUT the toDataURL re-encode + Image re-decode:
//   fetch(url) -> blob -> createImageBitmap (straight alpha) -> OffscreenCanvas
//   2D getImageData -> [keyOutGrayBackground + clearBorderLines + confetti loop]
//   -> putImageData -> transferToImageBitmap (cheap) -> postMessage(transfer).
//
// The pixel logic below is a VERBATIM port of denoiseImage's spatial pass so
// worker-cleaned sprites are byte-identical to the main-thread path. Any change
// here MUST be mirrored in field2-animator.js:denoiseImage() and vice-versa.
//
// DOM-free: uses only fetch / createImageBitmap / OffscreenCanvas / self — all
// available in a module worker. No window / document / Image.

import { clearBorderLines } from './sprite-denoise.js';

// ---- VERBATIM PORT of field2-animator.js:keyOutGrayBackground (:181) ----
// Key out a solid gray generation-background square (PixelLab artifact on many
// anim frames/variants). Finds the dominant low-saturation gray color among
// opaque pixels; if it covers a large area (a box, not natural texture), clears
// all pixels close to that color. Returns true if any pixels were cleared.
function keyOutGrayBackground(data, w, h, strict) {
  var total = w * h;
  // Histogram of low-saturation mid-tone colors. Legacy: quantized to 8
  // levels/channel. Strict: exact colors (a generated box is one flat color).
  var buckets = new Map();
  for (var i = 0; i < total; i++) {
    var p = i * 4;
    if (data[p + 3] < 200) continue;
    var r = data[p], g = data[p + 1], b = data[p + 2];
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn > 28 || mx < 60 || mx > 215) continue; // only flat grays
    var key = strict ? ((r << 16) | (g << 8) | b)
                     : (((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5));
    var e = buckets.get(key);
    if (e) { e.n++; e.r += r; e.g += g; e.b += b; }
    else buckets.set(key, { n: 1, r: r, g: g, b: b });
  }
  var top = null;
  buckets.forEach(function(e) { if (!top || e.n > top.n) top = e; });
  // A background box covers a big chunk of the frame; natural gray texture doesn't
  if (!top || top.n < total * (strict ? 0.20 : 0.12)) return false;
  var mr = top.r / top.n, mg = top.g / top.n, mb = top.b / top.n;
  if (strict) {
    // Box must reach the frame edge: ≥40% of the 2px border ring is the color
    var borderHit = 0, borderN = 0;
    for (var by = 0; by < h; by++) {
      for (var bx = 0; bx < w; bx++) {
        if (bx >= 2 && bx < w - 2 && by >= 2 && by < h - 2) continue;
        borderN++;
        var bp = (by * w + bx) * 4;
        if (data[bp + 3] >= 200 && data[bp] === Math.round(mr) && data[bp + 1] === Math.round(mg) && data[bp + 2] === Math.round(mb)) borderHit++;
      }
    }
    if (borderHit < borderN * 0.4) return false;
  }
  var changed = false;
  for (var j = 0; j < total; j++) {
    var q = j * 4;
    if (data[q + 3] < 8) continue;
    var r2 = data[q], g2 = data[q + 1], b2 = data[q + 2];
    var mx2 = Math.max(r2, g2, b2), mn2 = Math.min(r2, g2, b2);
    if (mx2 - mn2 > 34) continue; // keep saturated content (flowers, foliage)
    if (Math.abs(r2 - mr) + Math.abs(g2 - mg) + Math.abs(b2 - mb) <= 66) {
      data[q + 3] = 0;
      changed = true;
    }
  }
  return changed;
}

// Run the exact spatial denoise of denoiseImage on an ImageData in place.
// Returns true if any pixel changed. VERBATIM logic from denoiseImage:247-302.
function denoiseImageData(data, w, h, url) {
  var changed = false;
  // PixelLab artifact: many anim frames ship with a solid gray background box
  // (steppe sparse_weed, arctic ice_needle, hills, ...). Hills keeps the legacy
  // looser heuristic it shipped with; everything else uses the strict detector.
  // Gray-bodied sprites (lichen/moss/rock objects) are skipped entirely — their
  // art is legitimately flat gray.
  if (url && url.indexOf('/small_flora/') !== -1) {
    if (url.indexOf('/small_flora/hills/') !== -1) {
      if (keyOutGrayBackground(data, w, h, false)) changed = true;
    } else if (!/lichen|moss|rock/.test(url)) {
      if (keyOutGrayBackground(data, w, h, true)) changed = true;
    }
  }
  // Strip frame-border artifact lines (dark edge lines, gray box outlines)
  if (clearBorderLines(data, w, h)) changed = true;
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var idx = (y * w + x) * 4;
      if (data[idx + 3] < 8) continue;
      // Count opaque neighbors
      var opaque = 0;
      var totalR = 0, totalG = 0, totalB = 0, nCount = 0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          var ni = ((y + dy) * w + (x + dx)) * 4;
          if (data[ni + 3] > 32) {
            opaque++;
            totalR += data[ni]; totalG += data[ni + 1]; totalB += data[ni + 2];
            nCount++;
          }
        }
      }
      // Remove isolated pixels (fewer than 2 opaque neighbors)
      if (opaque < 2) { data[idx + 3] = 0; changed = true; continue; }
      if (opaque >= 6) continue;
      if (nCount === 0) continue;
      var avgR = totalR / nCount, avgG = totalG / nCount, avgB = totalB / nCount;
      var brightness = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      var avgBright = avgR * 0.299 + avgG * 0.587 + avgB * 0.114;
      // Remove bright confetti
      if (brightness > 220 && brightness - avgBright > 60 && opaque < 5) {
        data[idx + 3] = 0; changed = true; continue;
      }
      // Remove dark specks — only truly isolated dark dots
      if (brightness < 30 && avgBright - brightness > 60 && opaque < 3) {
        data[idx + 3] = 0; changed = true; continue;
      }
      // Remove color confetti
      var colorDiff = Math.abs(data[idx] - avgR) + Math.abs(data[idx + 1] - avgG) + Math.abs(data[idx + 2] - avgB);
      if (colorDiff > 120 && opaque < 4) {
        data[idx + 3] = 0; changed = true; continue;
      }
      // Remove fringe
      if (data[idx + 3] < 80 && opaque < 4 && colorDiff > 80) {
        data[idx + 3] = 0; changed = true;
      }
    }
  }
  return changed;
}

self.onmessage = async function(e) {
  var id = e.data.id, url = e.data.url;
  try {
    var resp = await fetch(url);
    if (!resp || !resp.ok) { self.postMessage({ id: id, ok: false }); return; }
    var blob = await resp.blob();
    // Straight (non-premultiplied) alpha + no color-space conversion so the 2D
    // getImageData bytes match what a same-src <img> drawn to a 2D canvas yields
    // on the main thread — keeps the pixel math byte-identical to denoiseImage.
    var srcBitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    var w = srcBitmap.width, h = srcBitmap.height;
    if (w < 3 || h < 3) {
      // Mirror denoiseImage's `if (w < 3 || h < 3) return img;` — hand back a usable bitmap.
      self.postMessage({ id: id, ok: true, changed: false, bitmap: srcBitmap }, [srcBitmap]);
      return;
    }
    var canvas = new OffscreenCanvas(w, h);
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(srcBitmap, 0, 0);
    var imageData = ctx.getImageData(0, 0, w, h);
    var changed = denoiseImageData(imageData.data, w, h, url);
    if (!changed) {
      // Unchanged: transfer the source bitmap back so the caller still gets one.
      self.postMessage({ id: id, ok: true, changed: false, bitmap: srcBitmap }, [srcBitmap]);
      return;
    }
    ctx.putImageData(imageData, 0, 0);
    var out = canvas.transferToImageBitmap(); // cheap: no PNG re-encode, no re-decode
    if (srcBitmap.close) srcBitmap.close();
    self.postMessage({ id: id, ok: true, changed: true, bitmap: out }, [out]);
  } catch (err) {
    self.postMessage({ id: id, ok: false });
  }
};
