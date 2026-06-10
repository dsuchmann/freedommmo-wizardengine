// Runtime sprite denoiser — cleans up PixelLab noise artifacts at load time.
// Removes: isolated bright pixels (white confetti), stray colored pixels,
// semi-transparent edge fringe. Runs once per sprite, result cached.

// Remove frame-border artifact lines: near-continuous runs of low-saturation
// gray/dark pixels along the outermost rows/columns (generation frame remnants).
// Causes: dark vertical line on sprite edges, gray box outlines on anim frames.
// Returns true if any pixels were cleared.
export function clearBorderLines(data, w, h) {
  var changed = false;
  function isGray(idx) {
    var r = data[idx], g = data[idx + 1], b = data[idx + 2];
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return (mx - mn) < 40 && mx < 180;
  }
  function scanLine(getIdx, len) {
    var filled = 0, gray = 0;
    for (var i = 0; i < len; i++) {
      var idx = getIdx(i);
      if (data[idx + 3] > 32) { filled++; if (isGray(idx)) gray++; }
    }
    // A mostly-filled, mostly-gray border line is an artifact, not content
    if (filled >= len * 0.55 && gray >= filled * 0.75) {
      for (var j = 0; j < len; j++) {
        var jdx = getIdx(j);
        if (data[jdx + 3] > 0 && isGray(jdx)) { data[jdx + 3] = 0; changed = true; }
      }
    }
  }
  for (var c = 0; c < 2; c++) {
    var xr = w - 1 - c, xl = c, yt = c, yb = h - 1 - c;
    scanLine(function(i) { return (i * w + xr) * 4; }, h); // east column
    scanLine(function(i) { return (i * w + xl) * 4; }, h); // west column
    scanLine(function(i) { return (yt * w + i) * 4; }, w); // north row
    scanLine(function(i) { return (yb * w + i) * 4; }, w); // south row
  }
  return changed;
}

/**
 * Denoise an ImageBitmap by removing isolated noisy pixels.
 * Returns a new clean ImageBitmap. Works in both workers and main thread.
 * @param {ImageBitmap} bmp - Source bitmap
 * @param {object} opts - { strength: 1-10, whiteCutoff: 0-255, minNeighbors: 1-4 }
 * @returns {Promise<ImageBitmap>} Cleaned bitmap
 */
export async function denoiseBitmap(bmp, opts) {
  var strength = (opts && opts.strength) || 5;
  var whiteCutoff = (opts && opts.whiteCutoff) || 220;
  var minNeighbors = (opts && opts.minNeighbors) || 2;
  var w = bmp.width;
  var h = bmp.height;
  if (w < 3 || h < 3) return bmp;

  var canvas = new OffscreenCanvas(w, h);
  var ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  var imageData = ctx.getImageData(0, 0, w, h);
  var data = imageData.data;
  var changed = 0;

  // Strip frame-border artifact lines first (dark edge lines, gray box outlines)
  if (clearBorderLines(data, w, h)) changed++;

  // Build alpha mask for neighbor counting
  var alpha = new Uint8Array(w * h);
  for (var i = 0; i < w * h; i++) {
    alpha[i] = data[i * 4 + 3];
  }

  // Mark pixels to remove
  var remove = new Uint8Array(w * h);

  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var idx = y * w + x;
      var a = alpha[idx];
      if (a < 8) continue; // Already transparent

      var pi = idx * 4;
      var r = data[pi], g = data[pi + 1], b = data[pi + 2];

      // Count opaque neighbors (8-connected)
      var opaqueNeighbors = 0;
      var totalR = 0, totalG = 0, totalB = 0, nCount = 0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          var ni = (y + dy) * w + (x + dx);
          if (alpha[ni] > 32) {
            opaqueNeighbors++;
            var npi = ni * 4;
            totalR += data[npi];
            totalG += data[npi + 1];
            totalB += data[npi + 2];
            nCount++;
          }
        }
      }

      // 1. Isolated pixel removal — pixel with very few opaque neighbors
      if (opaqueNeighbors < minNeighbors) {
        remove[idx] = 1;
        changed++;
        continue;
      }

      // Skip further checks if pixel has many neighbors (it's interior, not noise)
      if (opaqueNeighbors >= 6) continue;

      if (nCount === 0) continue;
      var avgR = totalR / nCount;
      var avgG = totalG / nCount;
      var avgB = totalB / nCount;

      // 2. White/bright confetti — pixel much brighter than neighbors
      var brightness = r * 0.299 + g * 0.587 + b * 0.114;
      var neighborBrightness = avgR * 0.299 + avgG * 0.587 + avgB * 0.114;
      if (brightness > whiteCutoff && brightness - neighborBrightness > 60 && opaqueNeighbors < 5) {
        remove[idx] = 1;
        changed++;
        continue;
      }

      // 2b. Dark specks — only completely isolated single dark pixels
      if (brightness < 20 && neighborBrightness - brightness > 80 && opaqueNeighbors < 2) {
        remove[idx] = 1;
        changed++;
        continue;
      }

      // 3. Colored confetti — pixel very different color from neighbors
      var colorDiff = Math.abs(r - avgR) + Math.abs(g - avgG) + Math.abs(b - avgB);
      var threshold = 180 - strength * 12; // strength 5 → threshold 120
      if (colorDiff > threshold && opaqueNeighbors < 4) {
        remove[idx] = 1;
        changed++;
        continue;
      }

      // 4. Edge fringe — semi-transparent pixel at edge with low alpha
      if (a < 80 && opaqueNeighbors < 4) {
        // Check if it's a "fringe" pixel (very different from solid neighbors)
        if (colorDiff > 80) {
          remove[idx] = 1;
          changed++;
        }
      }
    }
  }

  // Apply removals
  if (changed === 0) return bmp; // No changes needed

  for (var i = 0; i < w * h; i++) {
    if (remove[i]) {
      data[i * 4 + 3] = 0; // Set alpha to 0
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return createImageBitmap(canvas);
}
