// Minimal instanced 3D for the film's set pieces: a cathedral of pillars, a
// mirror corridor, a cloud of points that becomes an audience.
//
// No depth buffer, no lighting, no textures. Everything the film builds in 3D
// is additive light, so the only things that matter are where a vertex lands
// on screen and how much light it adds. Geometry is unit-sized and one
// instance carries its own transform (position / scale / euler rotation) and
// its own colour, which keeps every set piece to a single draw call.

import { LIN } from "./palette.js";
import { RT } from "./gl.js";

// Linear-light colour, the space the compositor works in.
export const rgb = (name) => LIN[name];
// The film is composed for 16:9; a rig that is not told otherwise frames for it.
export const ASPECT = 1920 / 1080;

// ------------------------------------------------------------------- mat4
export function mat4() { return new Float32Array(16); }

export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function lookAt(out, eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

// out = a * b (a and b are column-major, like every mat4 here)
export function multiply(out, a, b) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

// A camera: eye, target and a field of view, ready to hand to Stage3D.
export function camera(out, { eye, at, fov = 0.9, near = 0.25, far = 320, aspect }) {
  const p = perspective(mat4(), fov, aspect, near, far);
  const v = lookAt(mat4(), eye, at, [0, 1, 0]);
  return multiply(out, p, v);
}

// ------------------------------------------------------------------- geo
const TAU = Math.PI * 2;

// A back-of-the-head silhouette, for the crowd. Shoulders are the unit line
// (x from -1 to 1) and the origin sits on the shoulder line, so an instance's
// position is exactly where that person's shoulders are; the head is a disc
// just above them. One mesh, one draw call, ten thousand people.
function personGeometry(seg = 16, r = 0.36, cy = 0.80) {
  const v = [];
  const tri = (a, b, c) => {
    v.push(a[0], a[1], 0, b[0], b[1], 0, c[0], c[1], 0);
  };
  tri([-1, 0], [1, 0], [0.58, 0.46]);
  tri([-1, 0], [0.58, 0.46], [-0.58, 0.46]);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
    tri([0, cy], [Math.cos(a0) * r, cy + Math.sin(a0) * r],
      [Math.cos(a1) * r, cy + Math.sin(a1) * r]);
  }
  return v;
}

// One person, standing, seen from behind: head, shoulders, torso, two legs.
// Unit height is exactly 1.0 with the origin on the floor, so an instance's
// xyz scale *is* a person's height in metres -- which is what lets a lone
// figure be used as a unit of measure next to something monumental.
function standingGeometry(seg = 14, r = 0.045, cy = 0.925) {
  const v = [];
  const quad = (a, b, c, d) => {
    v.push(a[0], a[1], 0, b[0], b[1], 0, c[0], c[1], 0);
    v.push(a[0], a[1], 0, c[0], c[1], 0, d[0], d[1], 0);
  };
  const tri = (a, b, c) => {
    v.push(a[0], a[1], 0, b[0], b[1], 0, c[0], c[1], 0);
  };
  // torso, tapering from the shoulders to the waist
  quad([-0.105, 0.845], [0.105, 0.845], [0.072, 0.495], [-0.072, 0.495]);
  // arms, hanging just outside the torso
  quad([-0.105, 0.845], [-0.150, 0.815], [-0.118, 0.505], [-0.072, 0.520]);
  quad([0.105, 0.845], [0.150, 0.815], [0.118, 0.505], [0.072, 0.520]);
  // legs, with the gap between them left empty
  quad([-0.070, 0.505], [-0.008, 0.505], [-0.016, 0.010], [-0.062, 0.004]);
  quad([0.070, 0.505], [0.008, 0.505], [0.016, 0.010], [0.062, 0.004]);
  // the head, a disc, and the neck that joins it to the shoulders
  quad([-0.030, 0.870], [0.030, 0.870], [0.034, 0.845], [-0.034, 0.845]);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
    tri([0, cy], [Math.cos(a0) * r, cy + Math.sin(a0) * r],
      [Math.cos(a1) * r, cy + Math.sin(a1) * r]);
  }
  return v;
}

// A wire cage: a cylinder of `TUBE_SIDES` sides, `TUBE_RINGS` rings along its
// height, and `TUBE_RIBS` vertical ribs between them. Radius 1 and y from -1
// to 1, so one instance's per-axis scale *is* (radius, half-height, radius) in
// metres. This is what turns the organ's pipes from cards into tubes without
// introducing a shaded material: the cage carries the volume, the lit rect
// inside it carries the light. `TUBE_SEG` is exported so a scene can print the
// number of segments it actually drew -- the film's readings have to be able
// to name their geometry.
const TUBE_SIDES = 12, TUBE_RINGS = 5, TUBE_RIBS = 8;
const TUBE_Y = [-1, -0.5, 0, 0.5, 1];
export const TUBE_SEG = TUBE_SIDES * TUBE_RINGS + TUBE_RIBS * (TUBE_RINGS - 1);

function tubeGeometry() {
  const v = [];
  const push = (a, b) => v.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  for (const y of TUBE_Y) {
    for (let i = 0; i < TUBE_SIDES; i++) {
      const a0 = (i / TUBE_SIDES) * TAU, a1 = ((i + 1) / TUBE_SIDES) * TAU;
      push([Math.cos(a0), y, Math.sin(a0)], [Math.cos(a1), y, Math.sin(a1)]);
    }
  }
  for (let i = 0; i < TUBE_RIBS; i++) {
    const a = (i / TUBE_RIBS) * TAU;
    const x = Math.cos(a), z = Math.sin(a);
    for (let k = 0; k < TUBE_Y.length - 1; k++) {
      push([x, TUBE_Y[k], z], [x, TUBE_Y[k + 1], z]);
    }
  }
  return v;
}

export const GEO = {
  // a single vertex, drawn as a point sprite
  point: [0, 0, 0],
  // a unit segment along Y: rotate it to lay floor lines or hang a shard
  segment: [0, -1, 0, 0, 1, 0],
  // the crowd: shoulders plus a head, in one unit of triangle soup
  person: personGeometry(),
  // one person, whole, one metre tall, feet on the origin: a unit of measure
  standing: standingGeometry(),
  // a unit wire cylinder: the cage around every pipe in the organ
  tube: tubeGeometry(),
  // a unit wire square in the XY plane
  quad: [
    -1, -1, 0, 1, -1, 0,
    1, -1, 0, 1, 1, 0,
    1, 1, 0, -1, 1, 0,
    -1, 1, 0, -1, -1, 0,
  ],
  // the same square, filled: two triangles, for lights and lit surfaces
  rect: [
    -1, -1, 0, 1, -1, 0, 1, 1, 0,
    1, 1, 0, -1, 1, 0, -1, -1, 0,
  ],
};

// Instance layout (16 floats): position.xyz, uniform scale, colour.rgb, alpha,
// euler.xyz, pad, per-axis scale.xyz, pad.
export const INSTANCE_FLOATS = 16;

// Air and rig (see docs/制作日志.md, step 26): the 3D camera rig and the
// distance-fogged stages were added together, because a moving lens through a
// flat set reads as a pan, and a deep set with a locked lens reads as a matte.
// The air is part of the shot: any 3D light drawn through Stage3D may be
// faded and widened by distance from the lens, so a deep space has parallax
// even when the machine's own frame does not move.

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aInst;    // xyz = position, w = scale
layout(location = 2) in vec4 aTint;    // rgb + alpha
layout(location = 3) in vec4 aRot;     // euler xyz, radians
layout(location = 4) in vec4 aScale;   // per-axis scale
uniform mat4 uVP;
uniform float uPoint;
uniform vec3 uEye;      // the lens, in world metres
uniform vec3 uFog;      // the colour distant lights fall back to
uniform float uFogInv;  // 1 / the distance at which the air is ~63% fog
uniform float uFocal;   // 1 = fixed pixel size, < 1 = scale the point with depth
out vec3 vColor;
out float vAlpha;
out vec2 vLocal;

mat3 rotXYZ(vec3 a) {
  float cx = cos(a.x), sx = sin(a.x);
  float cy = cos(a.y), sy = sin(a.y);
  float cz = cos(a.z), sz = sin(a.z);
  mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  mat3 ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  mat3 rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
  return rz * ry * rx;
}

void main() {
  vec3 p = rotXYZ(aRot.xyz) * (aPos * aScale.xyz * aInst.w) + aInst.xyz;
  gl_Position = uVP * vec4(p, 1.0);
  // Aerial perspective: every instance falls towards the hall's own air at
  // its own distance. This is what turns a flat starfield into depth -- and
  // the fog colour never leaves C_INK, so the darks stay darks.
  //
  // Point size: uFocal = 1 keeps the old behaviour exactly (a fixed pixel
  // size, which is what most of the film's 3D wants); below 1 a point is drawn
  // as the size it would have at REF metres, so a cloud that is walked away
  // from gets *finer* instead of staying the same thickness and fusing into a
  // blob. Added for the abrasion bay (step 58); nothing else passes it.
  const float POINT_REF = 6.0;
  float fog = 0.0;
  float dist = length(p - uEye);
  float size = uPoint * mix(clamp(POINT_REF / max(dist, 0.5), 0.30, 2.0), 1.0, uFocal);
  if (uFogInv > 0.0) {
    fog = 1.0 - exp(-dist * uFogInv);
    gl_PointSize = size;
  } else {
    gl_PointSize = size;
  }
  vColor = mix(aTint.rgb, uFog, fog * 0.72);
  vAlpha = aTint.a * (1.0 - 0.42 * fog);
  vLocal = aPos.xy;
}`;

const FRAG = `#version 300 es
precision highp float;
uniform float uSoft;    // 0 = a hard edge, 1 = a light that has no edge
uniform float uSprite;  // 1 = point sprites fall off from their centre
uniform float uFocal;   // 1 = keep the intended point size, < 1 = widen with distance
in vec3 vColor;
in float vAlpha;
in vec2 vLocal;
out vec4 fragColor;
void main() {
  float a = vAlpha;
  if (uSprite > 0.5) {
    a *= smoothstep(0.5, 0.06, length(gl_PointCoord - 0.5));
  } else if (uSoft > 0.001) {
    a *= mix(1.0, smoothstep(1.0, 0.12, length(vLocal * vec2(1.0, 0.85))), uSoft);
  }
  fragColor = vec4(vColor, a);
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`${label} shader failed: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

export class Stage3D {
  constructor(ctx, geoName = "segment", material = null) {
    const gl = ctx.gl;
    this.gl = gl;
    this.ctx = ctx;
    this.name = geoName;
    this.custom = material || null;
    this.mode = geoName === "point" ? gl.POINTS
      : geoName === "rect" ? gl.TRIANGLES : gl.LINES;
    const geo = GEO[geoName] || GEO.segment;
    this.vertices = geo.length / 3;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER,
      this.custom ? this.custom.pt : VERT, `stage3d.${geoName}.vert`));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER,
      this.custom ? this.custom.frag : FRAG, `stage3d.${geoName}.frag`));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`stage3d link failed: ${gl.getProgramInfoLog(prog)}`);
    }
    this.program = prog;
    this.uVP = gl.getUniformLocation(prog, "uVP");
    this.uPoint = gl.getUniformLocation(prog, "uPoint");
    this.uSoft = gl.getUniformLocation(prog, "uSoft");
    this.uSprite = gl.getUniformLocation(prog, "uSprite");
    this.uEye = gl.getUniformLocation(prog, "uEye");
    this.uFog = gl.getUniformLocation(prog, "uFog");
    this.uFogInv = gl.getUniformLocation(prog, "uFogInv");
    this.uFocal = gl.getUniformLocation(prog, "uFocal");
    this.customU = this.custom
      ? Object.fromEntries(Object.keys(this.custom.uniforms || {}).map((k) => [k, gl.getUniformLocation(prog, k)]))
      : null;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    this.instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    const stride = INSTANCE_FLOATS * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 32);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 48);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);

    this.cap = 0;
    this.count = 0;
    this.rt = new RT(gl, ctx.W * ctx.scale, ctx.H * ctx.scale, {
      float: false, linear: true, name: `stage3d-${geoName}`,
    });
  }

  // `data` is a Float32Array written with writeInstance(); count is how many
  // instances are live this frame.
  update(data, count) {
    const gl = this.gl;
    this.count = Math.min(count, data.length / INSTANCE_FLOATS | 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    if (data.length * 4 > this.cap) {
      gl.bufferData(gl.ARRAY_BUFFER, data.length * 4, gl.DYNAMIC_DRAW);
      this.cap = data.length * 4;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, this.count * INSTANCE_FLOATS);
    return this;
  }

  // Draw into this stage's own target, then add it to the scene.
  // `clearAlpha` matters when a pass is composited with multiply: the target
  // has to be transparent where nothing was drawn, or the whole frame darkens.
  // `premul` must be on for a pass whose own alpha is the point of it (the
  // crowd, composited with multiply): the compositor otherwise assumes the
  // source is opaque.
  render(out, {
    vp, point = 2.0, opacity = 1, mode = "add", clearAlpha = 1, premul = false,
    soft = 0, sprite = 0, uniforms = null, eye = null, fog = null, focal = 1,
  }) {
    const gl = this.gl;
    if (!this.count) return this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rt.fbo);
    gl.viewport(0, 0, this.rt.w, this.rt.h);
    gl.clearColor(0, 0, 0, clearAlpha);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uVP, false, vp);
    gl.uniform1f(this.uPoint, point * (this.ctx.scale || 1));
    gl.uniform1f(this.uSoft, soft);
    gl.uniform1f(this.uSprite, sprite);
    gl.uniform1f(this.uFocal, focal);
    // A plain JS array has no @@iterator for uniform3fv: flatten it into the
    // three floats the uniform wants, so scenes can write fog/eye as literals.
    const e = eye || [0, 0, 0];
    gl.uniform3f(this.uEye, e[0], e[1], e[2]);
    const fogC = (fog && fog.c) || [0, 0, 0];
    gl.uniform3f(this.uFog, fogC[0], fogC[1], fogC[2]);
    // 0 means "no air": the default keeps every existing stage exactly as it
    // was, and the chapters that want depth opt in by passing a fog distance.
    let fogInv = 0;
    if (fog && fog.dist > 0.5) fogInv = 1 / fog.dist;
    gl.uniform1f(this.uFogInv, fogInv);
    if (this.customU && uniforms) {
      for (const [k, v] of Object.entries(uniforms)) {
        const loc = this.customU[k];
        if (!loc) continue;
        if (Array.isArray(v) || v instanceof Float32Array) gl.uniform1fv(loc, v);
        else gl.uniform1f(loc, v);
      }
    }
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(this.mode, 0, this.vertices, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.ctx.comp.draw(out, this.rt.tex, { mode, opacity, premul });
    return this;
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.instBuf);
  }
}

// ------------------------------------------------------------------- rig
// A 3D camera rig for one chapter: keyframed eye / look-at / fov / roll, read
// back as a pure function of the chapter's own time. A keyframe value may be a
// number, a [x,y,z] point, or a function of the position along the rig
// `(u, rig) => value`, so a path can be written as data and still bend.
//
// The film's global camera (`src/camera.js`) still owns the frame and its
// budget; this rig is the *scene's* own operator, and it only exists inside
// the 3D set. That separation is the point: a move inside a shot costs no
// frame displacement, so the picture can be still while the lens is moving.
function evalKey(v, u, rig) {
  return typeof v === "function" ? v(u, rig) : v;
}

const mixvRig = (a, b, u) => [
  a[0] + (b[0] - a[0]) * u,
  a[1] + (b[1] - a[1]) * u,
  a[2] + (b[2] - a[2]) * u,
];

// Smooth, deterministic easing for a rig keyframe; `lin` rides a rail at a
// constant rate, which is what makes a long reveal feel like a machine.
const EASE_RIG = {
  smooth: (u) => u * u * (3 - 2 * u),
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
  lin: (u) => u,
};

export class CamRig {
  constructor(keys, { helpers = null } = {}) {
    this.keys = keys;
    this.helpers = helpers;
    this.vp = mat4();
    this.eye = [0, 0, 1];
    this.at = [0, 0, 0];
    this.fov = 0.9;
    this.roll = 0;
    this.u = 0;
  }

  // Interpolate the rig at u in [0,1] without touching the matrix. This is
  // what the shot-report tools read, and what lets a scene measure its own
  // framing (project the subject, check it stays in frame) before rendering.
  state(u, aspect = ASPECT) {
    const keys = this.keys;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    let i = 0;
    while (i < keys.length - 2 && u >= keys[i + 1].u) i++;
    const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
    const span = Math.max(1e-6, b.u - a.u);
    const raw = Math.max(0, Math.min(1, (u - a.u) / span));
    const k = (a.ease ? EASE_RIG[a.ease] || EASE_RIG.smooth : EASE_RIG.smooth)(raw);
    const h = this.helpers;
    const eye = mixvRig(evalKey(a.eye, u, h), evalKey(b.eye, u, h), k);
    const at = mixvRig(evalKey(a.at, u, h), evalKey(b.at, u, h), k);
    const fov = evalKey(a.fov ?? 0.9, u, h) + (evalKey(b.fov ?? 0.9, u, h) - evalKey(a.fov ?? 0.9, u, h)) * k;
    const roll = (evalKey(a.roll ?? 0, u, h) + (evalKey(b.roll ?? 0, u, h) - evalKey(a.roll ?? 0, u, h)) * k);
    return { eye, at, fov, roll };
  }

  // Resolve the rig at u into this.vp and remember where the lens was, so the
  // scene can hand `eye` to Stage3D for the air.
  eval(u, aspect = ASPECT) {
    const s = this.state(u, aspect);
    this.u = u < 0 ? 0 : u > 1 ? 1 : u;
    this.eye = s.eye;
    this.at = s.at;
    this.fov = s.fov;
    this.roll = s.roll;
    camera(this.vp, { eye: s.eye, at: s.at, fov: s.fov, near: 0.3, far: 900, aspect });
    return s;
  }
}

// Write one instance into a shared Float32Array.
export function writeInstance(data, i, { p, s = 1, c, a = 1, r = [0, 0, 0], scale = [1, 1, 1] }) {
  const k = i * INSTANCE_FLOATS;
  data[k] = p[0]; data[k + 1] = p[1]; data[k + 2] = p[2]; data[k + 3] = s;
  data[k + 4] = c[0]; data[k + 5] = c[1]; data[k + 6] = c[2]; data[k + 7] = a;
  data[k + 8] = r[0]; data[k + 9] = r[1]; data[k + 10] = r[2]; data[k + 11] = 0;
  data[k + 12] = scale[0]; data[k + 13] = scale[1]; data[k + 14] = scale[2]; data[k + 15] = 0;
  return i + 1;
}

// Sample a drawing into a point cloud: draw the figure once into a small
// offscreen canvas, keep the pixels that carry light, and thin them to a
// deterministic set of points in [-1, 1] with y pointing up.
export function samplePoints(draw, { w = 150, h = 240, max = 1400, cut = 0.14 } = {}) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d", { willReadFrequently: true });
  c.fillStyle = "#000";
  c.fillRect(0, 0, w, h);
  draw(c, w, h);
  const src = c.getImageData(0, 0, w, h).data;
  const pool = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = (src[i] + src[i + 1] + src[i + 2]) / 765;
      if (l <= cut) continue;
      pool.push([(x + 0.5) / w * 2 - 1, 1 - (y + 0.5) / h * 2, l]);
    }
  }
  const out = [];
  const step = Math.max(1, pool.length / max);
  for (let k = 0; k * step < pool.length && out.length < max; k++) {
    out.push(pool[Math.floor(k * step)]);
  }
  return out;
}

// The heart curve the film cuts open twice: (x^2+y^2-1)^3 = x^2 y^3, as an
// implicit function. Negative inside, positive outside, `k` shrinking the
// whole section for a depth slice. Exposed as a function with a `.k` helper so
// the erode and overdrive chapters measure the same heart.
export function heartF(x, y, k = 1) {
  const hx = x / k, hy = y / k;
  const a = hx * hx + hy * hy - 1;
  return a * a * a - hx * hx * hy * hy * hy;
}
heartF.k = (u) => 1 - 0.16 * u;

// Project a world point through a VP matrix into screen pixels, so a 2D layer
// (a caption, a big screen's content, a beam's vanishing point) can be placed
// exactly where the 3D set is. Returns [x, y, depth]: depth is the clip-space
// w, positive in front of the lens.
export function project(vp, p, W = 1920, H = 1080) {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
  const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
  const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  const iw = Math.abs(w) < 1e-6 ? 1e-6 : 1 / w;
  return [(x * iw * 0.5 + 0.5) * W, (1 - (y * iw * 0.5 + 0.5)) * H, w];
}
