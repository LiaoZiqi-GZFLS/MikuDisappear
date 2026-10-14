// The film engine: timeline resolution, scene lifecycle, frame assembly and
// the post chain. A frame is a pure function of song time t.

import { Compositor, Pass, bindTarget, createCanvasGL } from "./gl.js";
import { Layer2D } from "./layer.js";
import { buildShots, camAt } from "./camera.js";

export const W = 1920;
export const H = 1080;

export class Scene {
  constructor(ctx) {
    this.ctx = ctx;
    this.stateful = false;
  }
  async init() {}
  render(/* f, out */) {}
  dispose() {}
}

const SOLID_FRAG = `
uniform vec3 uColor;
in vec2 vUv;
void main() { fragColor = vec4(uColor, 1.0); }`;

// ---------------------------------------------------------------- joins
// A join says how an entry *enters*: a hard cut, a fade, a pointcut, a
// curtain, a tear -- and whether the camera should fly from the outgoing
// shot's framing to the incoming one (`move`), which is what turns a cut into
// one continuous camera move.
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const inOutSine = (p) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(p));
function moveEase(move, p) {
  if (move === "whip") return Math.pow(clamp01(p), 2.4);
  if (move === "drift") return clamp01(p) * clamp01(p);
  return inOutSine(p);
}
function blendCam(a, b, k) {
  const mix = (x, y) => x + (y - x) * k;
  return {
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    z: mix(a.z, b.z),
    r: mix(a.r, b.r),
    persp: mix(a.persp ?? 0, b.persp ?? 0),
    shake: [mix(a.shake ? a.shake[0] : 0, b.shake ? b.shake[0] : 0),
      mix(a.shake ? a.shake[1] : 0, b.shake ? b.shake[1] : 0)],
  };
}
// A shot's camera with its own scene-side nudge (zoom/shake/pan the scene
// asked for) folded in, so the camera pass and the join see one camera.
function combineCam(cam, post = {}) {
  return {
    x: cam.x + (post.pan ? post.pan[0] : 0),
    y: cam.y + (post.pan ? post.pan[1] : 0),
    z: cam.z * (post.zoom ?? 1),
    r: cam.r + (post.rot ?? 0),
    persp: cam.persp ?? 0,
    shake: [
      (cam.shake ? cam.shake[0] : 0) + (post.shake ? post.shake[0] : 0),
      (cam.shake ? cam.shake[1] : 0) + (post.shake ? post.shake[1] : 0),
    ],
  };
}

export function resolveTimeline(spec, features) {
  const at = (s) => {
    if (s == null) return null;
    if (typeof s === "number") return s;
    if (s.section) {
      const sec = features.sections.find((x) => x.id === s.section);
      if (!sec) throw new Error(`unknown section ${s.section}`);
      return sec.t + (s.offset || 0);
    }
    if (s.line) {
      const l = features.lines.find((x) => x.text.includes(s.line));
      if (!l) throw new Error(`unknown lyric "${s.line}"`);
      return l.start + (s.offset || 0);
    }
    if (s.after) {
      const l = features.lines.find((x) => x.text.includes(s.after));
      if (!l) throw new Error(`unknown lyric "${s.after}"`);
      return l.end + (s.offset || 0);
    }
    return 0;
  };
  const out = [];
  for (let i = 0; i < spec.length; i++) {
    const e = spec[i];
    const t0 = at(e.from);
    let t1 = e.to != null ? at(e.to) : (spec[i + 1] ? at(spec[i + 1].from) : features.duration);
    // A chapter may outlive the audio (the record's closing credits do): its
    // `tail` is extra seconds of picture after the last analysed sample.
    if (e.tail) t1 += e.tail;
    if (t1 <= t0) t1 = t0 + 0.5;
    out.push({ ...e, t0, t1, index: i });
  }
  return out;
}

export class Engine {
  constructor(canvas, features, { scale = 1, hud = true } = {}) {
    const { gl, floatOk } = createCanvasGL(canvas);
    this.canvas = canvas;
    this.gl = gl;
    this.width = W;
    this.height = H;
    this.scale = scale;
    this.hudOn = hud;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    this.comp = new Compositor(gl, { floatOk });
    this.comp.init(W, H, { scale });
    this.solid = new Pass(gl, SOLID_FRAG, "solid");
    this.features = features;
    this.sceneClasses = new Map();
    this.scenes = new Map();
    this.timeline = [];
    this.shots = new Map();
    this.overlay = new Layer2D(gl, W, H, { scale });
    this.ctx = {
      gl, comp: this.comp, features, lyrics: features, W, H, scale,
      engine: this,
      drawLayer: (out, layer, opts = {}) => {
        layer.upload();
        this.comp.draw(out, layer.tex, { srgb: true, ...opts });
      },
      solid: (out, color) => {
        this.solid.draw({ dst: out, u: { uColor: color } });
      },
    };
    this._frame = null;
    this.stats = { draws: 0, lastMs: 0 };
  }

  register(map) {
    for (const k in map) this.sceneClasses.set(k, map[k]);
  }

  setTimeline(entries) {
    this.timeline = entries;
    this.shots = buildShots(this.features, entries);
  }

  async ensure(id) {
    if (this.scenes.has(id)) return this.scenes.get(id);
    const Cls = this.sceneClasses.get(id);
    if (!Cls) throw new Error(`scene "${id}" is not registered`);
    const inst = new Cls(this.ctx);
    this.scenes.set(id, inst);
    await inst.init();
    return inst;
  }

  // Instantiate every scene up front so the render loop stays synchronous.
  async preload() {
    const ids = [...new Set(this.timeline.map((e) => e.scene))];
    for (const id of ids) await this.ensure(id);
  }

  // which timeline entries are live at t (two while crossfading)
  entriesAt(t) {
    const list = this.timeline;
    let i = 0;
    for (let k = 0; k < list.length; k++) if (t >= list[k].t0) i = k;
    if (t < list[0].t0) return [list[0]];
    const cur = list[i];
    const mix = cur.mix || 0;
    if (mix > 0 && i > 0 && t < cur.t0 + mix) return [list[i - 1], cur];
    return [cur];
  }

  // The picture at t: one shot, or two while a join runs.
  // { a, b, join, p } -- b is null outside a join window.
  transitionAt(t) {
    const list = this.timeline;
    if (!list.length) return { a: null, b: null, join: null, p: 0 };
    let i = 0;
    for (let k = 0; k < list.length; k++) if (t >= list[k].t0) i = k;
    if (t < list[0].t0) return { a: list[0], b: null, join: null, p: 0 };
    // A join belongs to the shot that enters, and `bias` lets its window
    // straddle the cut (bias > 0 starts before it). So the window of the
    // *next* entry is tested as well -- otherwise the first half of every
    // hand-over would never be seen. The window is bounded on both sides: a
    // join is a hand-over, not a permanent filter.
    for (const idx of [i + 1, i]) {
      const cand = list[idx];
      if (!cand || idx === 0) continue;
      const j = cand.join;
      if (!j || !(j.dur > 0)) continue;
      const start = cand.t0 - j.dur * (j.bias ?? 0.5);
      if (t >= start && t < start + j.dur) {
        return { a: list[idx - 1], b: cand, join: j, p: clamp01((t - start) / j.dur) };
      }
    }
    const cur = list[i];
    const mix = cur.mix || 0;
    if (mix > 0 && i > 0 && t < cur.t0 + mix) {
      return {
        a: list[i - 1], b: cur, p: clamp01((t - cur.t0) / mix),
        join: { type: "fade", dur: mix, bias: 0, handover: 0.5 },
      };
    }
    return { a: cur, b: null, join: null, p: 0 };
  }

  // A light frame for camera maths, so a relay can be measured without
  // rendering anything.
  probeFrame(t) {
    const F = this.features;
    const beat = F.beatAt(t);
    return {
      t,
      beat,
      beatPhase: beat - Math.floor(beat),
      bar: beat / 4,
      lineIndex: F.lineIndexAt(t),
      kick: F.hit("kick", t, 0.10),
      snare: F.hit("snare", t, 0.09),
      vox: F.hit("vox", t, 0.08),
      F,
    };
  }

  shotCam(entry, t) {
    return camAt(this.shots, entry, t, this.probeFrame(t));
  }

  // Both shots' cameras at t (the incoming one is null outside a join).
  camsAt(A, B, t) {
    const a = this.shotCam(A, t);
    return { a, b: B ? this.shotCam(B, t) : null };
  }

  makeFrame(t, entry) {
    const F = this.features;
    const a = F.frame(t, {});
    const beat = F.beatAt(t);
    const barPhase = F.barPhaseFrac(t);
    const kick = F.hit("kick", t, 0.10);
    const snare = F.hit("snare", t, 0.09);
    const hat = F.hit("hat", t, 0.045);
    const vox = F.hit("vox", t, 0.08);
    const line = F.activeLine(t);
    const li = F.lineIndexAt(t);
    const f = {
      t,
      lt: t - entry.t0,
      p: Math.max(0, Math.min(1, (t - entry.t0) / (entry.t1 - entry.t0))),
      a,
      beat,
      bar: beat / 4,
      beatPhase: beat - Math.floor(beat),
      barPhase,
      kick, snare, hat, vox,
      pulse: Math.max(kick, snare * 0.9, vox * 0.7),
      line,
      lineIndex: li,
      nextLine: F.lines[li + 1] || null,
      prevLine: li > 0 ? F.lines[li - 1] : null,
      section: F.sectionAt(t),
      params: entry.params || {},
      entry,
      F,
      W, H,
      hit: Math.max(kick, snare, vox),
    };
    f.cam = camAt(this.shots, entry, t, f);
    this._frame = f;
    return f;
  }

  renderScene(entry, out, t) {
    const scene = this.scenes.get(entry.scene);
    if (!scene) throw new Error(`scene "${entry.scene}" was not preloaded`);
    const f = this.makeFrame(t, entry);
    const post = scene.render(f, out) || {};
    return { f, post };
  }

  render(t, { present = true } = {}) {
    const gl = this.gl;
    const t0 = performance.now();
    const T = this.comp.targets;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    const st = this.transitionAt(t);
    const A = st.a;
    const B = st.b;
    if (!A) return null;
    const rA = this.renderScene(A, T.scene, t);
    let rB = null;
    let post = rA.post;
    let frame = rA.f;
    if (B) {
      rB = this.renderScene(B, T.alt, t);
      post = { ...rA.post, ...rB.post };
      frame = rB.f;
    }

    // the camera: during a relay both shots share one blended framing, so the
    // cut becomes a camera move instead of a jump
    const cams = this.camsAt(A, B, t);
    const camA = combineCam(cams.a, rA.post);
    let cam = camA;
    if (rB) {
      const camB = combineCam(cams.b, rB.post);
      cam = st.join && st.join.move ? blendCam(camA, camB, moveEase(st.join.move, st.p)) : camA;
    }

    // shutter: how fast the camera itself is moving this frame. A join may
    // ask for one, and a single shot may open its own -- the shot table sets
    // `motion` for the whip pans and the dives, and everything moving inside
    // the frame then smears along the camera's own velocity.
    let motion = 0;
    let vel = [0, 0], zoomVel = 0;
    if (rB && st.join && st.join.move) {
      motion = st.join.motion ?? (st.join.move === "whip" ? 0.9 : 0.45);
      const pv = this.camsAt(A, B, t - 1 / 60);
      let prev = combineCam(pv.a, rA.post);
      const prevB = combineCam(pv.b, rB.post);
      const pk = moveEase(st.join.move, Math.max(0, st.p - (1 / 60) / st.join.dur));
      prev = blendCam(prev, prevB, pk);
      vel = [cam.x - prev.x, cam.y - prev.y];
      zoomVel = (cam.z - prev.z) / Math.max(1e-4, cam.z);
    } else if (cam.motion > 0.001) {
      motion = cam.motion;
      const prev = combineCam(this.shotCam(A, t - 1 / 60), rA.post);
      vel = [cam.x - prev.x, cam.y - prev.y];
      zoomVel = (cam.z - prev.z) / Math.max(1e-4, cam.z);
    }
    const camU = (c) => ({
      zoom: c.z, rot: (c.r || 0) * Math.PI / 180, pan: [c.x, c.y], shake: c.shake,
      persp: c.persp ?? 0, motion, vel, zoomVel,
    });

    const target = T.alt;
    if (!rB) {
      this.comp.cameraPass(T.scene, target, camU(camA));
    } else {
      this.comp.cameraPass(T.scene, T.tmp, camU(cam));
      this.comp.cameraPass(T.alt, T.scene, camU(cam));
      const j = st.join || { type: "fade" };
      this.comp.joinPass(T.tmp, T.scene, target, {
        type: j.type || "fade",
        p: st.p,
        handover: j.handover ?? 0.5,
        seed: j.seed ?? 0.37,
        ball: j.ball ?? 1,
        gate: j.gate ?? 0,
        cells: j.cells,
      });
    }

    if (this.hudOn && this.hud) {
      this.overlay.clear();
      this.hud(this.overlay.ctx, frame, this);
      this.overlay.upload();
      this.comp.draw(target, this.overlay.tex, { mode: "normal", srgb: true, opacity: post.hudAlpha ?? 0.85 });
    }

    if (present) {
      this.comp.bloom(target, {
        threshold: post.bloomThreshold ?? 0.72,
        knee: post.bloomKnee ?? 0.4,
        radius: post.bloomRadius ?? 1.0,
        intensity: post.bloom ?? 0.9,
      });
      this.comp.present(target, {
        ...post,
        time: t,
        zoom: 1,
        rot: 0,
        pan: [0, 0],
        shake: [0, 0],
      });
    }
    this.stats.lastMs = performance.now() - t0;
    this.lastFrame = frame;
    return frame;
  }

  dispose() {
    for (const s of this.scenes.values()) s.dispose();
    this.scenes.clear();
  }
}

export { bindTarget };
