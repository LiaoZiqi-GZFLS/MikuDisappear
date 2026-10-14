// Minimal WebGL2 layer: programs, render targets, a small post chain.
// Everything renders through one fullscreen triangle; no vertex data is used.

import { GLSL_PALETTE } from "./palette.js";

export const VERT = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const GLSL_COMMON = `
${GLSL_PALETTE}
uniform vec2 uRes;          // logical render size, provided by every pass
#define PI 3.141592653589793
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1, 0));
  float c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float fillSDF(float d, float w) { return smoothstep(w, -w, d); }
float strokeSDF(float d, float w) { return 1.0 - smoothstep(-w, w, abs(d)); }
vec3 srgb2lin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 lin2srgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
`;

export function createCanvasGL(canvas) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  if (!gl) throw new Error("WebGL2 is not available in this browser");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");
  const linearFloat = !!gl.getExtension("OES_texture_float_linear");
  gl.getExtension("EXT_float_blend");
  return { gl, floatOk, linearFloat };
}

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = src.split("\n").map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join("\n");
    throw new Error(`${label} shader failed:\n${log}\n${numbered}`);
  }
  return sh;
}

export class Program {
  constructor(gl, frag, label = "pass") {
    this.gl = gl;
    this.uniforms = new Map();
    const src = frag.trimStart().startsWith("#version 300 es")
      ? frag
      : `#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;
${frag}`;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, label + ".vert"));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, src, label + ".frag"));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`${label} link failed: ${gl.getProgramInfoLog(prog)}`);
    }
    this.program = prog;
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      const name = info.name.replace(/\[0\]$/, "");
      this.uniforms.set(name, {
        loc: gl.getUniformLocation(prog, info.name),
        type: info.type,
        size: info.size,
      });
    }
  }

  use() {
    this.gl.useProgram(this.program);
    return this;
  }

  set(name, value) {
    const gl = this.gl;
    const u = this.uniforms.get(name);
    if (!u) return this;
    const { loc, type } = u;
    switch (type) {
      case gl.FLOAT: gl.uniform1f(loc, value); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(loc, value); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(loc, value); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(loc, value); break;
      case gl.INT: case gl.BOOL: case gl.SAMPLER_2D: gl.uniform1i(loc, value); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(loc, false, value); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(loc, false, value); break;
      default: break;
    }
    return this;
  }

  setAll(obj) {
    for (const k in obj) this.set(k, obj[k]);
    return this;
  }

  draw() {
    const gl = this.gl;
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

export class Pass {
  constructor(gl, frag, label) {
    this.gl = gl;
    this.program = new Program(gl, GLSL_COMMON + "\n" + frag, label);
    this.u = {};
  }

  // draw({ dst, tex:{uSrc: texture}, u:{...} })
  draw({ dst = null, tex = {}, u = {} } = {}) {
    const gl = this.gl;
    bindTarget(gl, dst);
    this.program.use();
    let unit = 0;
    for (const name in tex) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex[name]);
      this.program.set(name, unit);
      unit++;
    }
    for (const name in this.u) this.program.set(name, this.u[name]);
    for (const name in u) this.program.set(name, u[name]);
    this.program.draw();
  }
}

export function bindTarget(gl, rt) {
  if (!rt) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    return;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
  gl.viewport(0, 0, rt.w, rt.h);
}

export class RT {
  constructor(gl, w, h, { float = true, linear = true, depth = false, name = "" } = {}) {
    this.gl = gl;
    this.name = name;
    this.float = float;
    this.linear = linear;
    this.depth = depth;
    this.w = 0;
    this.h = 0;
    this.fbo = gl.createFramebuffer();
    this.tex = gl.createTexture();
    this.depthTex = depth ? gl.createTexture() : null;
    this.resize(w, h);
  }

  resize(w, h) {
    const gl = this.gl;
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    const filter = this.linear ? gl.LINEAR : gl.NEAREST;
    const internal = this.float ? gl.RGBA16F : gl.RGBA8;
    const type = this.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    if (this.depth) {
      gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

export function textureFromCanvas(gl, canvas, { linear = true, srgb = false } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function updateCanvasTexture(gl, tex, canvas) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
}

// --------------------------------------------------------------- compositor

const BLIT_FRAG = `
uniform sampler2D uSrc;
uniform sampler2D uDst;
uniform int uMode;       // 0 normal, 1 add, 2 screen, 3 multiply, 4 max
uniform float uOpacity;
uniform vec3 uTint;
uniform int uSRGB;       // source is a canvas layer (sRGB, premultiplied)
uniform int uPre;        // source is premultiplied
in vec2 vUv;
void main() {
  vec4 s = texture(uSrc, vUv);
  vec3 c = s.rgb;
  float a = s.a;
  if (uSRGB == 1) {
    vec3 un = c / max(a, 1e-4);
    c = srgb2lin(un);
  }
  c *= uTint;
  if (uPre == 0 && uSRGB == 0) a = 1.0;
  if (uPre == 0) c *= a;
  c *= uOpacity;
  a *= uOpacity;
  vec3 dst = texelFetch(uDst, ivec2(gl_FragCoord.xy), 0).rgb;
  vec3 outc;
  if (uMode == 1) outc = dst + c;
  else if (uMode == 2) outc = 1.0 - (1.0 - clamp(dst, 0.0, 1.0)) * (1.0 - clamp(c, 0.0, 1.0));
  else if (uMode == 3) outc = dst * mix(vec3(1.0), clamp(c, 0.0, 1.0), a);
  else if (uMode == 4) outc = max(dst, c);
  else outc = c + dst * (1.0 - clamp(a, 0.0, 1.0));
  fragColor = vec4(outc, 1.0);
}`;

const COPY_FRAG = `
uniform sampler2D uSrc;
in vec2 vUv;
void main() { fragColor = vec4(texture(uSrc, vUv).rgb, 1.0); }`;

const BRIGHT_FRAG = `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
in vec2 vUv;
vec3 tap(vec2 o) { return texture(uSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 c = tap(vec2(-1, -1)) + tap(vec2(1, -1)) + tap(vec2(-1, 1)) + tap(vec2(1, 1));
  c = c * 0.25;
  float l = max(max(c.r, c.g), c.b);
  float knee = max(uKnee, 1e-4);
  float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  fragColor = vec4(c * w, 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D uSrc;
uniform vec2 uDir;      // texel-sized direction
in vec2 vUv;
void main() {
  vec3 sum = texture(uSrc, vUv).rgb * 0.227027;
  sum += (texture(uSrc, vUv + uDir * 1.3846).rgb + texture(uSrc, vUv - uDir * 1.3846).rgb) * 0.3162162;
  sum += (texture(uSrc, vUv + uDir * 3.2308).rgb + texture(uSrc, vUv - uDir * 3.2308).rgb) * 0.0702702;
  fragColor = vec4(sum, 1.0);
}`;

const DOWN_FRAG = `
uniform sampler2D uSrc;
uniform vec2 uTexel;
in vec2 vUv;
void main() {
  vec3 c = texture(uSrc, vUv).rgb * 0.25;
  c += (texture(uSrc, vUv + vec2(uTexel.x, uTexel.y)).rgb + texture(uSrc, vUv - vec2(uTexel.x, uTexel.y)).rgb) * 0.1875;
  c += (texture(uSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture(uSrc, vUv - vec2(uTexel.x, -uTexel.y)).rgb) * 0.1875;
  fragColor = vec4(c, 1.0);
}`;

const FINAL_FRAG = `
uniform sampler2D uBase;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform sampler2D uBloom3;
uniform float uBloom;
uniform float uExposure;
uniform float uCA;
uniform float uGrain;
uniform float uVignette;
uniform float uScan;
uniform float uFlash;
uniform float uFade;      // 1 = black
uniform float uInvert;
uniform float uZoom;
uniform float uRot;       // camera roll, radians
uniform vec2 uPan;        // camera pan, in frame fractions
uniform vec2 uShake;
uniform float uTime;
uniform vec3 uFlashColor;
in vec2 vUv;

vec3 sampleCA(vec2 uv, float amt) {
  vec2 d = (uv - 0.5) * amt;
  vec3 c;
  c.r = texture(uBase, uv + d).r;
  c.g = texture(uBase, uv).g;
  c.b = texture(uBase, uv - d).b;
  return c;
}

// The camera: roll about the frame centre in square (physical) space, then
// dolly by uZoom, then pan. Everything is sampled from the same render target,
// so the whole picture moves as one piece.
vec2 camUv(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float c = cos(uRot), s = sin(uRot);
  p = mat2(c, -s, s, c) * p;
  p /= uZoom;
  return p / vec2(uRes.x / uRes.y, 1.0) + 0.5 + uPan;
}

void main() {
  vec2 uv = camUv(vUv) + uShake;
  vec3 base = uCA > 0.0 ? sampleCA(uv, uCA) : texture(uBase, uv).rgb;
  vec3 bloom = texture(uBloom1, uv).rgb * 0.55
             + texture(uBloom2, uv).rgb * 0.32
             + texture(uBloom3, uv).rgb * 0.22;
  vec3 col = base + bloom * uBloom;

  col *= uExposure;
  col = mix(col, col / (1.0 + col * 0.22), 0.6);            // gentle shoulder

  float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(1.15, 1.0)));
  col *= mix(1.0, vig, uVignette);

  float scan = 1.0 - uScan * 0.5 * (0.5 + 0.5 * sin(uv.y * 1080.0 * PI / 1.0));
  col *= scan;

  col = mix(col, vec3(1.0) - col, uInvert);
  col += uFlash * uFlashColor;
  col *= (1.0 - uFade);

  col = lin2srgb(max(col, 0.0));       // display encoding
  float g = hash21(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5;
  col += g * uGrain;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// The camera pass: a shot is rendered flat, then this pass applies the whole
// camera to it — dolly, roll, pan, handshake, a keystone for a tilted lens,
// and a shutter (motion blur) along the camera's own velocity. Two shots can be
// pushed through it with the *same* camera, which is what turns a cut into a
// camera move (see the relay in engine.js).
const CAMERA_FRAG = `
uniform sampler2D uSrc;
uniform float uZoom;
uniform float uRot;
uniform vec2 uPan;
uniform vec2 uShake;
uniform float uPersp;      // keystone: + = lens tilted up, - = down
uniform float uMotion;     // 0..1 fraction of the frame time the shutter is open
uniform vec2 uVel;         // camera pan velocity, in frame fractions per frame
uniform float uZoomVel;    // camera dolly velocity, per frame
in vec2 vUv;

vec2 camUv(vec2 uv, float e) {
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float c = cos(uRot), s = sin(uRot);
  p = mat2(c, -s, s, c) * p;
  p /= uZoom * (1.0 + e * uZoomVel);
  float d = 1.0 + uPersp * p.y;
  p /= max(0.30, d);
  return p / vec2(uRes.x / uRes.y, 1.0) + 0.5 + uPan + uShake + e * uVel;
}

void main() {
  if (uMotion < 0.002) {
    fragColor = vec4(texture(uSrc, camUv(vUv, 0.0)).rgb, 1.0);
    return;
  }
  vec3 c = vec3(0.0);
  for (int i = 0; i < 7; i++) {
    float t = (float(i) / 6.0 - 0.5) * uMotion;
    c += texture(uSrc, camUv(vUv, t)).rgb;
  }
  fragColor = vec4(c / 7.0, 1.0);
}`;

// The join pass: two shots, already pushed through the same camera, hand over
// to each other. type 0 fade, 1 pointcut (her pixels gather into a ball and
// reform), 2 curtain, 3 hard (a relay's hand-over), 4 tear.
const JOIN_FRAG = `
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uP;          // 0..1 across the join
uniform float uType;
uniform float uSeed;
uniform float uHandover;
uniform float uBall;
uniform float uGate;      // 0 = every cell flies; > 0 = only what glows does
uniform vec2 uCells;     // the pointcut's grid, in cells across the frame
in vec2 vUv;

void main() {
  vec2 uv = vUv;
  if (uType < 0.5) {
    float e = smoothstep(uHandover - 0.30, uHandover + 0.30, uP);
    fragColor = vec4(mix(texture(uA, uv).rgb, texture(uB, uv).rgb, e), 1.0);
    return;
  }
  if (uType < 1.5) {
    // pointcut: cells leave their place (the middle first), gather into a
    // turning ball of her colour, then take their new place (the middle last)
    vec2 grid = uCells;
    vec2 cell = floor(uv * grid);
    vec2 home = (cell + 0.5) / grid;
    float h = hash21(cell + uSeed), h2 = hash21(cell * 1.7 + 7.3 + uSeed);
    float r0 = length((home - 0.5) * vec2(1.15, 1.0)) / 0.79;
    float d1 = r0 * 0.16 + h * 0.10;
    float d2 = (1.0 - r0) * 0.10 + h2 * 0.10;
    float k1 = smoothstep(d1, d1 + 0.34, uP);
    float k2 = smoothstep(0.46 + d2, 0.84 + d2, uP);
    // Only the cells that carry light are allowed to come apart. In the one
    // place the film uses this join, that means her silhouette and the ten
    // thousand penlights leave their seats and cross the room while the dark
    // hall stays exactly where it is -- the hand-over is done by the light,
    // not by a blanket of noise laid over the whole frame.
    float gate = 1.0;
    if (uGate > 0.001) {
      float lum = dot(texture(uA, home).rgb, vec3(0.30, 0.62, 0.10));
      gate = smoothstep(uGate * 0.35, uGate, lum);
      k1 *= gate;
    }
    float inBall = k1 * (1.0 - k2);
    float ang = uP * 2.4 + h * 6.28318;
    vec2 ball = 0.5 + uBall * 0.16 * vec2(cos(ang), sin(ang)) * (0.35 + 0.65 * h2);
    vec2 pos = mix(mix(home, ball, k1), home, k2);
    float swap = smoothstep(0.46, 0.56, uP);
    // The cells are only *at* their home once they have landed: sampling
    // converges back to the real pixel at both ends of the join, so the
    // picture starts and finishes sharp.
    float block = smoothstep(0.0, 0.10, uP) * (1.0 - smoothstep(0.86, 1.0, uP));
    block *= mix(1.0, gate, step(0.001, uGate));
    vec2 suv = mix(uv, home, block);
    vec3 a = texture(uA, suv).rgb, b = texture(uB, suv).rgb;
    vec3 col = mix(a, b, swap);
    col = mix(col, mix(col, C_MIKU * 1.35, 0.55), inBall);
    // the cells are separated by dark seams while they are in flight
    vec2 f = fract(uv * grid);
    float gap = smoothstep(0.0, 0.07, min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)));
    float fly = smoothstep(0.02, 0.12, uP) * (1.0 - smoothstep(0.88, 0.98, uP));
    fly *= mix(1.0, gate, step(0.001, uGate));
    col *= mix(1.0, gap, fly * 0.85);
    // the ball itself casts a soft glow
    float g = exp(-pow(length(uv - 0.5) * 6.0, 2.0));
    col += C_MIKU_HI * g * inBall * 0.35;
    fragColor = vec4(col, 1.0);
    return;
  }
  if (uType < 2.5) {
    // curtain: panels close over the outgoing picture, then open on the new one
    float cw = uP < 0.5 ? uP * 2.0 : (1.0 - uP) * 2.0;
    cw = smoothstep(0.0, 1.0, cw);
    vec3 base = uP < 0.5 ? texture(uA, uv).rgb : texture(uB, uv).rgb;
    float panel = step(uv.x, cw * 0.52) + step(1.0 - cw * 0.52, uv.x);
    float fold = 0.5 + 0.5 * sin(uv.x * 90.0 + uSeed);
    vec3 cloth = mix(C_INK, C_RED_DEEP, 0.20) * (0.30 + 0.70 * fold);
    fragColor = vec4(mix(base, cloth, clamp(panel, 0.0, 1.0)), 1.0);
    return;
  }
  if (uType < 3.5) {
    vec3 hard = uP < uHandover ? texture(uA, uv).rgb : texture(uB, uv).rgb;
    fragColor = vec4(hard, 1.0);
    return;
  }
  // tear: horizontal bands slide out of alignment and the picture changes in
  // the seam; a bright line sweeps down the frame
  float rows = 22.0;
  float row = floor(uv.y * rows);
  float h = hash11(row * 3.7 + uSeed);
  float slide = (h - 0.5) * 0.60 * sin(uP * PI);
  vec3 a = texture(uA, uv + vec2(slide * (0.35 + h), 0.0)).rgb;
  vec3 b = texture(uB, uv + vec2(-slide * (0.35 + h), 0.0)).rgb;
  vec3 col = uP < 0.5 ? a : b;
  float seam = smoothstep(0.014, 0.0, abs(uv.y - uP));
  col += C_MIKU * seam * 0.55;
  fragColor = vec4(col, 1.0);
}`;

export class Compositor {
  constructor(gl, opts) {
    this.gl = gl;
    gl.__floatOk = opts.floatOk;
    this.floatOk = opts.floatOk;
    this.blit = new Pass(gl, BLIT_FRAG, "blit");
    this.copy = new Pass(gl, COPY_FRAG, "copy");
    this.bright = new Pass(gl, BRIGHT_FRAG, "bright");
    this.blurP = new Pass(gl, BLUR_FRAG, "blur");
    this.down = new Pass(gl, DOWN_FRAG, "down");
    this.final = new Pass(gl, FINAL_FRAG, "final");
    this.camera = new Pass(gl, CAMERA_FRAG, "camera");
    this.join = new Pass(gl, JOIN_FRAG, "join");
    this.targets = {};
    this.size = 1;
    this.count = 1;
  }

  // One extra target holds the destination while a layer is composited over it.
  init(w, h, { scale = 1 } = {}) {
    const opts = { float: this.floatOk, linear: true };
    this.w = w * scale;
    this.h = h * scale;
    this.scale = scale;
    const mk = (name, div) => new RT(this.gl, this.w / div, this.h / div, { ...opts, name });
    this.targets.scene = mk("scene", 1);
    this.targets.alt = mk("alt", 1);
    this.targets.tmp = mk("tmp", 1);
    this.targets.halfA = mk("halfA", 2);
    this.targets.halfB = mk("halfB", 2);
    this.targets.quarterA = mk("quarterA", 4);
    this.targets.quarterB = mk("quarterB", 4);
    this.targets.eighthA = mk("eighthA", 8);
    this.targets.eighthB = mk("eighthB", 8);
  }

  /* composite a canvas layer or scene texture over `dst`
     mode: 'normal' | 'add' | 'screen' | 'multiply' | 'max' */
  draw(dst, src, { mode = "normal", opacity = 1, tint = [1, 1, 1], srgb = false, premul = false } = {}) {
    const gl = this.gl;
    // read-modify-write: copy dst to tmp, then blend src over tmp into dst
    this.copy.draw({ dst: this.targets.tmp, tex: { uSrc: dst ? dst.tex : null } });
    const modes = { normal: 0, add: 1, screen: 2, multiply: 3, max: 4 };
    this.blit.u = {
      uMode: modes[mode] ?? 0,
      uOpacity: opacity,
      uTint: tint,
      uSRGB: srgb ? 1 : 0,
      uPre: premul ? 1 : 0,
      uDst: 0,
    };
    this.blit.draw({
      dst,
      tex: { uSrc: src, uDst: this.targets.tmp.tex },
      u: { uDst: 1, uMode: modes[mode] ?? 0, uOpacity: opacity, uTint: tint, uSRGB: srgb ? 1 : 0, uPre: premul ? 1 : 0 },
    });
  }

  bloom(src, { threshold = 0.75, knee = 0.35, radius = 1.0, intensity = 0.8 }) {
    const t = this.targets;
    this.bright.draw({
      dst: t.halfA,
      tex: { uSrc: src.tex },
      u: { uTexel: [1 / src.w, 1 / src.h], uThreshold: threshold, uKnee: knee },
    });
    this.blur(t.halfA, t.halfB, radius * 1.0);
    this.down.draw({
      dst: t.quarterA,
      tex: { uSrc: t.halfB.tex },
      u: { uTexel: [1 / t.halfB.w, 1 / t.halfB.h] },
    });
    this.blur(t.quarterA, t.quarterB, radius * 1.2);
    this.down.draw({
      dst: t.eighthA,
      tex: { uSrc: t.quarterB.tex },
      u: { uTexel: [1 / t.quarterB.w, 1 / t.quarterB.h] },
    });
    this.blur(t.eighthA, t.eighthB, radius * 1.5);
    return intensity;
  }

  blur(a, b, radius = 1) {
    const t = this.targets;
    this.blurP.draw({
      dst: b,
      tex: { uSrc: a.tex },
      u: { uDir: [radius / a.w, 0] },
    });
    this.blurP.draw({
      dst: a,
      tex: { uSrc: b.tex },
      u: { uDir: [0, radius / a.h] },
    });
  }

  // Push a shot through the camera: dolly, roll, pan, shake, lens tilt and a
  // shutter. `src` and `dst` must differ (this is a read-modify-write pass).
  cameraPass(src, dst, o = {}) {
    this.camera.draw({
      dst,
      tex: { uSrc: src.tex },
      u: {
        uRes: [this.w, this.h],
        uZoom: o.zoom ?? 1,
        uRot: o.rot ?? 0,
        uPan: o.pan ?? [0, 0],
        uShake: o.shake ?? [0, 0],
        uPersp: o.persp ?? 0,
        uMotion: o.motion ?? 0,
        uVel: o.vel ?? [0, 0],
        uZoomVel: o.zoomVel ?? 0,
      },
    });
  }

  // Hand two camera-warped shots over to each other.
  // type: "fade" | "pointcut" | "curtain" | "hard" | "tear"
  joinPass(a, b, dst, o = {}) {
    const types = { fade: 0, pointcut: 1, curtain: 2, hard: 3, tear: 4 };
    this.join.draw({
      dst,
      tex: { uA: a.tex, uB: b.tex },
      u: {
        uRes: [this.w, this.h],
        uP: o.p ?? 0,
        uType: types[o.type] ?? 0,
        uSeed: o.seed ?? 0,
        uHandover: o.handover ?? 0.5,
        uBall: o.ball ?? 1,
        uGate: o.gate ?? 0,
        uCells: o.cells ?? [96, 54],
      },
    });
  }

  present(src, o = {}) {
    const t = this.targets;
    this.final.draw({
      dst: null,
      tex: {
        uBase: src.tex,
        uBloom1: t.halfA.tex,
        uBloom2: t.quarterA.tex,
        uBloom3: t.eighthA.tex,
      },
      u: {
        uRes: [this.w, this.h],
        uBloom: o.bloom ?? 0.8,
        uExposure: o.exposure ?? 1.0,
        uCA: o.ca ?? 0.0,
        uGrain: o.grain ?? 0.02,
        uVignette: o.vignette ?? 0.5,
        uScan: o.scan ?? 0.0,
        uFlash: o.flash ?? 0.0,
        uFlashColor: o.flashColor ?? [1, 1, 1],
        uFade: o.fade ?? 0.0,
        uInvert: o.invert ?? 0.0,
        uZoom: o.zoom ?? 1.0,
        uRot: o.rot ?? 0.0,
        uPan: o.pan ?? [0, 0],
        uShake: o.shake ?? [0, 0],
        uTime: o.time ?? 0,
      },
    });
  }
}
