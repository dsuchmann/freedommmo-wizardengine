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
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(program, 'aUnit');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

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
    return { glTextures: this.textures.size };
  }
}
