// WebGL2 terrain compositor — Stage 1 of the GPU migration.
//
// Draws worker-painted chunk ImageBitmaps as GPU textures on a GL canvas that
// sits UNDERNEATH the existing 2D canvas. Each chunk bitmap is uploaded whole
// via texImage2D (the path verified safe against the atlas stripe bug — we
// never re-assemble terrain from a tile atlas on the GPU).
//
// Sampling is NEAREST + CLAMP_TO_EDGE to match ctx.imageSmoothingEnabled=false.
// Quad placement uses the exact same CSS-pixel sx/sy/chunkPx math as the 2D
// path, so the two modes are pixel-comparable with the A/B toggle (G key).

var VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;            // unit quad corner (0..1)
uniform vec2 uPos;        // quad top-left, CSS px
uniform vec2 uSize;       // quad size, CSS px
uniform vec2 uViewport;   // viewport size, CSS px
out vec2 vUV;
void main() {
  vec2 px = uPos + aUnit * uSize;
  vec2 clip = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUnit;
}`;

var FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUV);
}`;

// --- Stage 2: instanced sprite pipeline (F2 small flora) ---
// Sprites live in a runtime shelf-packed atlas. Each instance replicates the
// 2D path's pivot math: translate(sx, sy + halfDraw); rotate(a); drawImage at
// (-halfDraw, -drawSize) — i.e. pivot at bottom-center of the quad.
var SPRITE_VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;     // unit quad corner (0..1)
in vec4 aPSR;      // pivot.xy (CSS px), size (CSS px), rotation (rad)
in float aAlpha;
in vec4 aUV;       // u0, v0, du, dv
uniform vec2 uViewport;
out vec2 vUV;
out float vAlpha;
void main() {
  vec2 local = vec2(aUnit.x * aPSR.z - aPSR.z * 0.5, aUnit.y * aPSR.z - aPSR.z);
  float c = cos(aPSR.w);
  float s = sin(aPSR.w);
  vec2 px = aPSR.xy + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 clip = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUV.xy + aUnit * aUV.zw;
  vAlpha = aAlpha;
}`;

var SPRITE_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
in float vAlpha;
uniform sampler2D uAtlas;
out vec4 outColor;
void main() {
  outColor = texture(uAtlas, vUV) * vAlpha; // premultiplied alpha
}`;

// Floats per sprite instance: pivotX, pivotY, size, rot, alpha, u0, v0, du, dv
export var SPRITE_FLOATS = 9;
var SPRITE_STRIDE = SPRITE_FLOATS * 4;

// Evict chunk textures not drawn for this many frames.
var EVICT_AFTER_FRAMES = 600;
var SWEEP_INTERVAL = 256;

function parseColor(css) {
  // Supports '#rgb', '#rrggbb', 'rgb(...)' / 'rgba(...)'. Fallback: dark slate.
  if (typeof css === 'string') {
    if (css[0] === '#') {
      var hex = css.slice(1);
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      if (hex.length >= 6) {
        var n = parseInt(hex.slice(0, 6), 16);
        if (!isNaN(n)) return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      }
    } else {
      var m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    }
  }
  return [0.094, 0.149, 0.169]; // #18262b
}

export class GLCompositor {
  constructor() {
    this.ok = false;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'glTerrain';
    var gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    if (!gl) {
      console.warn('[GL] WebGL2 unavailable — staying on Canvas 2D terrain path');
      return;
    }
    this.gl = gl;
    this.textures = new Map(); // 'cx,cy' -> { tex, bmp, lastUsed }
    this.frame = 0;
    this._lastSkyCss = null;
    this._skyRGB = [0, 0, 0];

    var program = this._buildProgram(VERT_SRC, FRAG_SRC);
    if (!program) return;
    this.program = program;
    this.uPos = gl.getUniformLocation(program, 'uPos');
    this.uSize = gl.getUniformLocation(program, 'uSize');
    this.uViewport = gl.getUniformLocation(program, 'uViewport');
    this.uTex = gl.getUniformLocation(program, 'uTex');

    // Static unit quad (triangle strip)
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.unitVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(program, 'aUnit');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.spritesOk = false;
    this._initSprites();

    gl.disable(gl.BLEND); // terrain chunks are opaque
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ok = false;
      console.warn('[GL] context lost — falling back to Canvas 2D terrain');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[GL] context restored — press G twice to re-enable');
    });

    this.ok = true;
    console.log('[GL] WebGL2 terrain compositor ready:', gl.getParameter(gl.VERSION));
  }

  _buildProgram(vsSrc, fsSrc) {
    var gl = this.gl;
    var vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error('[GL] vertex shader:', gl.getShaderInfoLog(vs));
      return null;
    }
    var fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error('[GL] fragment shader:', gl.getShaderInfoLog(fs));
      return null;
    }
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[GL] program link:', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  resize(cssW, cssH, dpr) {
    if (!this.ok) return;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
  }

  beginFrame(skyColorCss, cssW, cssH) {
    if (!this.ok) return;
    var gl = this.gl;
    if (skyColorCss !== this._lastSkyCss) {
      this._lastSkyCss = skyColorCss;
      this._skyRGB = parseColor(skyColorCss);
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(this._skyRGB[0], this._skyRGB[1], this._skyRGB[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uViewport, cssW, cssH);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
  }

  // Upload (or reuse) the chunk bitmap as a texture and draw it as a quad.
  // Identity check on the bitmap reference handles chunk repaints: the
  // provider creates a NEW ImageBitmap on repaint, triggering re-upload.
  drawChunk(key, bitmap, sx, sy, dw, dh) {
    if (!this.ok) return;
    var gl = this.gl;
    var entry = this.textures.get(key);
    if (!entry || entry.bmp !== bitmap) {
      var tex = entry ? entry.tex : gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry = { tex: tex, bmp: bitmap, lastUsed: this.frame };
      this.textures.set(key, entry);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      entry.lastUsed = this.frame;
    }
    gl.uniform2f(this.uPos, sx, sy);
    gl.uniform2f(this.uSize, dw, dh);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // --- Stage 2: sprite atlas + instanced rendering ---

  _initSprites() {
    var gl = this.gl;
    var prog = this._buildProgram(SPRITE_VERT_SRC, SPRITE_FRAG_SRC);
    if (!prog) return;
    this.spriteProgram = prog;
    this.sUViewport = gl.getUniformLocation(prog, 'uViewport');
    this.sUAtlas = gl.getUniformLocation(prog, 'uAtlas');

    // Runtime shelf-packed sprite atlas. F2 sprites are ~32px so a 4096²
    // atlas holds ~15k of them — far more than ever loads at once.
    this.atlasSize = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    this.atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.atlasSize, this.atlasSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.atlasRects = new Map(); // url -> {u0,v0,du,dv} | null (failed/full)
    // Fixed region reserved for the player sprite, re-uploaded every frame so
    // the player participates in the depth-sorted instance batch.
    this._playerRegion = { x: 1, y: 1, w: 256, h: 256 };
    this._shelfX = 1;
    this._shelfY = this._playerRegion.y + this._playerRegion.h + 2; // shelves pack below it
    this._shelfH = 0;
    this._atlasFullWarned = false;

    // Sprite VAO: shared unit quad + per-instance attributes (divisor 1)
    this.spriteVao = gl.createVertexArray();
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
    var locUnit = gl.getAttribLocation(prog, 'aUnit');
    gl.enableVertexAttribArray(locUnit);
    gl.vertexAttribPointer(locUnit, 2, gl.FLOAT, false, 0, 0);
    this.instVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
    var locPSR = gl.getAttribLocation(prog, 'aPSR');
    gl.enableVertexAttribArray(locPSR);
    gl.vertexAttribPointer(locPSR, 4, gl.FLOAT, false, SPRITE_STRIDE, 0);
    gl.vertexAttribDivisor(locPSR, 1);
    var locAlpha = gl.getAttribLocation(prog, 'aAlpha');
    gl.enableVertexAttribArray(locAlpha);
    gl.vertexAttribPointer(locAlpha, 1, gl.FLOAT, false, SPRITE_STRIDE, 16);
    gl.vertexAttribDivisor(locAlpha, 1);
    var locUV = gl.getAttribLocation(prog, 'aUV');
    gl.enableVertexAttribArray(locUV);
    gl.vertexAttribPointer(locUV, 4, gl.FLOAT, false, SPRITE_STRIDE, 20);
    gl.vertexAttribDivisor(locUV, 1);
    gl.bindVertexArray(null);
    this._instCapacityBytes = 0;
    this.spritesOk = true;
  }

  // Pack an Image into the atlas (or return its cached rect). Returns
  // {u0,v0,du,dv} or null (not ready / failed / atlas full → caller draws 2D).
  atlasRect(img, url) {
    if (!this.ok || !this.spritesOk) return null;
    var rect = this.atlasRects.get(url);
    if (rect !== undefined) return rect;
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h || !img.complete) return null; // not decoded yet — retry later
    var A = this.atlasSize;
    if (this._shelfX + w + 1 > A) {
      this._shelfY += this._shelfH + 1;
      this._shelfX = 1;
      this._shelfH = 0;
    }
    if (this._shelfY + h + 1 > A || w + 2 > A) {
      if (!this._atlasFullWarned) {
        this._atlasFullWarned = true;
        console.warn('[GL] sprite atlas full (' + this.atlasRects.size + ' sprites) — overflow draws on 2D canvas');
      }
      this.atlasRects.set(url, null);
      return null;
    }
    var x = this._shelfX;
    var y = this._shelfY;
    var gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } catch (e) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.atlasRects.set(url, null);
      return null;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this._shelfX += w + 1;
    if (h > this._shelfH) this._shelfH = h;
    // Half-texel inset prevents NEAREST bleed from neighboring sprites
    rect = { u0: (x + 0.5) / A, v0: (y + 0.5) / A, du: (w - 1) / A, dv: (h - 1) / A };
    this.atlasRects.set(url, rect);
    return rect;
  }

  // Upload the player's composited canvas into its reserved atlas region.
  // Returns the UV rect, or null if sprites are unavailable.
  uploadPlayerSprite(canvas) {
    if (!this.ok || !this.spritesOk) return null;
    var gl = this.gl;
    var r = this._playerRegion;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    } catch (e) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      return null;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    var A = this.atlasSize;
    return { u0: r.x / A, v0: r.y / A, du: r.w / A, dv: r.h / A };
  }

  // Draw `count` sprite instances from a packed Float32Array
  // (SPRITE_FLOATS floats each, in back-to-front order).
  drawSpriteInstances(data, count, cssW, cssH) {
    if (!this.ok || !this.spritesOk || count === 0) return;
    var gl = this.gl;
    gl.useProgram(this.spriteProgram);
    gl.bindVertexArray(this.spriteVao);
    gl.uniform2f(this.sUViewport, cssW, cssH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.sUAtlas, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
    var bytes = count * SPRITE_STRIDE;
    if (bytes > this._instCapacityBytes) {
      this._instCapacityBytes = bytes * 2;
      gl.bufferData(gl.ARRAY_BUFFER, this._instCapacityBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * SPRITE_FLOATS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  endFrame() {
    if (!this.ok) return;
    this.frame++;
    if (this.frame % SWEEP_INTERVAL === 0) this._sweep();
  }

  _sweep() {
    var gl = this.gl;
    for (var [key, entry] of this.textures) {
      if (this.frame - entry.lastUsed > EVICT_AFTER_FRAMES) {
        gl.deleteTexture(entry.tex);
        this.textures.delete(key);
      }
    }
  }

  stats() {
    return { glTextures: this.textures.size, atlasSprites: this.atlasRects ? this.atlasRects.size : 0 };
  }
}
