// 0:21.69 - the record names itself, three times, on a plate.
//
// The chapter has a place now: an archive hall. A slab 12.8 m wide hangs in
// the dark, every centimetre of it ruled by grooves, and a stamping carriage
// rides two rails in front of it. The carriage prints the name and strikes the
// plate where it starts; the strike runs outward through the grooves as a
// travelling ripple, so the whole plate moves when the title lands. Nothing
// about the name is flat: it is an impression in a surface, measured off a
// camera that is standing in a room.
//
// Each rewrite is struck over the last one. The name you were reading is
// pushed up the plate into the ledger and the new one takes the hero position,
// so all three impressions stay on the plate at once -- an afterimage is a
// name that has been rewritten and is still there. The three voices are the
// film's three voices: mono (machine), heavy sans (the song), serif (the
// elegy).
//
// Everything is a function of the song's clock: a strike's ripple is
// `t - its own strike time`, so any frame of this chapter renders on its own.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { Stage3D, camera, mat4, project, rgb, writeInstance } from "../gl3d.js";
import { css } from "../palette.js";
import { clamp, easeInOutCubic, hash, label, smoothstep } from "../kit.js";
import { draw as drawText, font, measure } from "../type.js";
import { audioU, layer, line } from "./util.js";

const FRAG = `
uniform float uT;
uniform float uKick;
uniform float uPulse;
uniform float uIn;
uniform float uBlast;    // 0 at a strike, 1 one second later
in vec2 vUv;

void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 col = C_INK;

  // the hall the plate hangs in: a cold volume that fades at its edges
  float d = length(p * vec2(0.62, 1.0));
  col += C_TEAL_DEEP * exp(-pow(d * 1.35, 2.0)) * (0.22 + 0.22 * uIn);
  // a hall is lit from the middle: the ends fall off, so the plate has an edge
  col *= 0.55 + 0.65 * exp(-pow((uv.x - 0.5) * 2.1, 2.0));
  col += C_TEAL_DEEP * 0.16 * exp(-pow((uv.y - 0.06) * 4.2, 2.0));

  // the impact leaving the plate: two rings travelling through the air
  float r0 = uBlast * 1.42, r1 = uBlast * 0.94;
  float ring = smoothstep(0.020, 0.0, abs(d - r0));
  ring += smoothstep(0.012, 0.0, abs(d - r1)) * 0.55;
  col += C_MIKU * ring * (1.0 - uBlast) * 0.07;

  // the write head bleeding into the air around the plate
  col += C_MIKU_HI * 0.045 * uPulse * exp(-pow((uv.y - 0.52) * 3.4, 2.0));

  // the machine's floor noise
  float ln = 0.5 + 0.5 * sin(uv.y * 900.0 + uT * 20.0);
  col += C_MIKU * exp(-pow((uv.y - 0.5) * 9.0, 2.0)) * ln * 0.012 * (0.5 + uPulse);
  col *= 0.92 + 0.25 * uKick;
  fragColor = vec4(col, 1.0);
}`;

// The plate: half-width, bottom and top edge. It is 16.8 m across and 7 m
// tall -- a monument, not a caption -- and the camera stands 17 m back so the
// whole machine and the room it hangs in are inside the frame.
const PLATE = { hw: 8.40, y0: 1.35, y1: 8.35 };
// The rails and gantry the carriage rides: the machine is wider than the plate.
const RIG = { hw: 9.30, y0: 0.75, y1: 8.95, z: 0.60 };
// The archive behind the plate: frames standing one behind the other.
const HALL = { n: 15, z0: -4.00, dz: 2.30, hw: 13.50, hh: 7.80, cy: 4.85 };
// One operator stands at the foot of the plate, on the floor the grid is
// drawn on. The plate is 16.8 m across and 7 m tall; a 1.74 m human is what
// turns those numbers into a monument, so the person is a unit of measure
// first and a character second.
const OP = { x: -6.05, z: 1.55, h: 1.74 };
// The strike does not stop at the plate's edge: the front runs down the hall's
// axis at 42 m/s and the far shelves answer in the order they are passed.
const WAVE = 42.0;
const HALL_DEPTH = -HALL.z0 + (HALL.n - 1) * HALL.dz;   // 36.20 m
const GROOVE = { n: 48, seg: 30 };
const DUST = 140;
const SPAN = 0.92;                 // seconds the head takes to cross the plate
const HOME = -PLATE.hw + 0.45;     // where the head enters, and where it strikes
const MID = (PLATE.y0 + PLATE.y1) / 2;

// The three rewrites. Sizes are metres on the plate; the last one stays.
const CARDS = [
  { at: 0.00, main: "\u6b8b\u50cf", sub: "\u30a2\u30d5\u30bf\u30fc\u30a4\u30e1\u30fc\u30b8",
    mono: true, weight: 400, mainSize: 2.02, subSize: 0.40, mainTrack: 0.07, subTrack: 0.14 },
  { at: 1.20, main: "\u6b8b\u50cf", sub: "AFTERIMAGE",
    mono: false, weight: 900, mainSize: 2.24, subSize: 0.44, mainTrack: 0.055, subTrack: 0.16 },
  { at: 2.40, main: "\u6b8b\u50cf", sub: "AFTERIMAGE",
    serif: true, italic: true, weight: 600, mainSize: 2.06, subSize: 0.58, mainTrack: 0.06, subTrack: 0.14 },
];
// Where a name sits while it is the news, and where it goes when it is history.
const HERO = { x: PLATE.hw, mainY: 4.30, subY: 5.35 };
const LEDGER = [
  { x: 2.60, mainY: 1.30, subY: 1.92, size: 0.48, subSize: 0.26 },
  { x: 2.60, mainY: 2.56, subY: 3.18, size: 0.48, subSize: 0.26 },
];

export default class Wake extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "wake");
    this.broken = null;
    this.vp = mat4();
    this.blast = 0;

    // Four draws: the plate's grooves, every line that measures the machine,
    // the lit faces (the write seam, the strike mark), and the air.
    this.grooves = new Stage3D(ctx, "segment");
    this.wires = new Stage3D(ctx, "segment");
    this.faces = new Stage3D(ctx, "rect");
    this.dust = new Stage3D(ctx, "point");
    // The operator: one whole standing person, multiplied into the plate's
    // light like the bodies in the arena -- a dark shape, 1.74 m of it.
    this.people = new Stage3D(ctx, "standing");
    this.grooveData = new Float32Array(GROOVE.n * GROOVE.seg * 16);
    this.wireData = new Float32Array((HALL.n * 5 + 120) * 16);
    this.faceData = new Float32Array(32 * 16);
    this.dustData = new Float32Array(DUST * 16);
    this.peopleData = new Float32Array(2 * 16);

    // What the text layer needs to print on the plate, in screen pixels.
    this.plate = { ox: 0, oy: 0, ax: 1, ay: 0, bx: 0, by: 1, w: 1200, h: 490, ppm: 94 };
    this.head = { x: HOME, live: 0, card: 0, pulse: 0 };
    this.opMark = null;
  }

  async init() {
    this.broken = line(this.ctx.features, "\u30e2\u30a6");
  }

  // ------------------------------------------------------------------ the set
  // Which rewrite is being struck, where its carriage is, and how hard the
  // strike landed -- all read off the song's clock, never integrated.
  strike(local) {
    let ci = 0;
    for (let i = 0; i < CARDS.length; i++) if (local >= CARDS[i].at) ci = i;
    const card = CARDS[ci];
    const pr = clamp((local - card.at) / SPAN);
    const headX = HOME + (2 * PLATE.hw - 0.68) * pr;
    const live = clamp(1 - (local - card.at - SPAN) / 0.16);
    let pulse = 0;
    for (const k of CARDS) {
      const age = local - k.at;
      if (age < 0 || age > 0.9) continue;
      pulse = Math.max(pulse, Math.exp(-age / 0.13));
    }
    this.head.x = headX;
    this.head.live = live;
    this.head.card = ci;
    this.head.pulse = pulse;
    this.blast = clamp((local - card.at) / 1.0);
    return this.head;
  }

  setPass(out, f, t, local) {
    const W = this.ctx.W, H = this.ctx.H;
    const vp = this.vp;
    // One slow push toward the plate for the whole chapter -- the lens leans
    // in to read the name, and the machine does the moving.
    const push = clamp(local / 4.0);
    const eye = [2.60 - 0.34 * push, 4.40 + 0.28 * push, 17.50 - 1.45 * push];
    this.eyeNow = eye;
    camera(vp, {
      eye,
      at: [0.20, 4.85, 0], fov: 0.76, near: 0.50, far: 320, aspect: W / H,
    });

    // Grammar 7 (the air), in three distances: the plate is the monument and
    // keeps a long falloff so it is readable to its own edges (16.8 m wide);
    // the archive behind it recedes into C_INK inside 50 m; the dust sits
    // between the two. Depth is a quantity in this chapter, not a haze.
    const PLATE_AIR = { eye, fog: { dist: 120, c: rgb("ink") } };
    const HALL_AIR = { eye, fog: { dist: 50, c: rgb("ink") } };
    const DUST_AIR = { eye, fog: { dist: 64, c: rgb("ink") } };

    const headX = this.head.x;
    const live = this.head.live;
    const pulse = this.head.pulse;

    // The strike as a distance: one front at 42 m/s, so the hall answers the
    // impact in the order it is passed. This is what makes a 40 m room a room
    // rather than a backdrop -- and it costs the camera budget nothing.
    const strikeHit = (z) => {
      let hit = 0;
      for (const k of CARDS) {
        const age = local - k.at;
        if (age < 0 || age > 1.25) continue;
        const front = age * WAVE;
        hit = Math.max(hit,
          Math.exp(-Math.pow((Math.abs(z) - front) / 4.4, 2)) * (1 - age / 1.25));
      }
      return hit;
    };

    // ---- the plate's surface: grooves that carry the strike as a ripple
    let g = 0;
    const segLen = (2 * PLATE.hw) / GROOVE.seg;
    for (let i = 0; i < GROOVE.n; i++) {
      const y = PLATE.y0 + (PLATE.y1 - PLATE.y0) * ((i + 0.5) / GROOVE.n);
      for (let k = 0; k < GROOVE.seg; k++) {
        const x = -PLATE.hw + segLen * (k + 0.5);
        let z = 0, heat = 0;
        for (const c of CARDS) {
          const age = local - c.at;
          if (age < 0 || age > 1.5) continue;
          const r = Math.hypot(x - HOME, y - MID);
          const front = age * 8.2;
          const band = Math.exp(-Math.pow((r - front) / 1.25, 2)) * (1 - age / 1.5);
          if (band < 0.012) continue;
          z += band * 0.42 * Math.sin(r * 2.6 - age * 9.0);
          heat = Math.max(heat, band);
        }
        // the grooves under the head are being written into
        const under = live * Math.exp(-Math.pow((x - headX) / 0.70, 2));
        heat = Math.max(heat, under);
        g = writeInstance(this.grooveData, g, {
          p: [x, y, z + under * 0.04],
          c: rgb(heat > 0.45 ? "mikuHi" : heat > 0.16 ? "miku" : "tealDeep"),
          a: 0.085 + 0.10 * (1 - heat) + 0.55 * heat + 0.05 * f.a.vocal,
          r: [0, 0, Math.PI / 2],
          scale: [1, segLen * 0.52, 1],
        });
      }
    }

    // ---- every line: the plate's frame, the rig, the rings, the archive
    let w = 0;
    const edge = (a, b, col, alpha) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      w = writeInstance(this.wireData, w, {
        p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2]],
        c: rgb(col), a: alpha,
        r: [0, 0, Math.atan2(-dx, dy)],
        scale: [1, Math.hypot(dx, dy) / 2, 1],
      });
    };
    // the plate's own frame, with the four corner brackets of a hard record
    for (const y of [PLATE.y0, PLATE.y1]) {
      edge([-PLATE.hw, y, 0], [PLATE.hw, y, 0], "miku", 0.42 + 0.30 * pulse);
    }
    for (const s of [-1, 1]) {
      edge([s * PLATE.hw, PLATE.y0, 0], [s * PLATE.hw, PLATE.y1, 0], "miku", 0.42 + 0.30 * pulse);
      for (const y of [PLATE.y0, PLATE.y1]) {
        edge([s * PLATE.hw, y, 0], [s * (PLATE.hw - 0.78), y, 0], "mikuHi", 0.7);
        edge([s * PLATE.hw, y, 0], [s * PLATE.hw, y + Math.sign(y - MID) * 0.46, 0], "mikuHi", 0.7);
      }
    }
    // the gantry: what makes the carriage a machine instead of a cursor
    for (const s of [-1, 1]) {
      edge([s * RIG.hw, RIG.y0, RIG.z], [s * RIG.hw, RIG.y1, RIG.z], "dim", 0.55);
    }
    for (const y of [RIG.y0, RIG.y1]) {
      edge([-RIG.hw, y, RIG.z], [RIG.hw, y, RIG.z], "dim", 0.42);
    }
    // the carriage itself, standing at the head's x
    edge([headX, PLATE.y0 - 0.22, RIG.z - 0.16 * pulse],
      [headX, PLATE.y1 + 0.22, RIG.z - 0.16 * pulse], "mikuHi",
      (0.30 + 0.46 * pulse) * (0.30 + 0.70 * live));
    for (const y of [RIG.y0 - 0.02, RIG.y1 + 0.02]) {
      edge([headX - 0.34, y, RIG.z], [headX + 0.34, y, RIG.z], "miku", 0.28 + 0.5 * pulse);
    }
    // the strike, ringing outward through the room
    for (const k of CARDS) {
      const age = local - k.at;
      if (age < 0 || age > 0.95) continue;
      const r = 0.70 + age * 8.7;
      const a = (1 - age / 0.95) * 0.5;
      for (const s of [-1, 1]) {
        edge([HOME - r, MID + s * r, 0.12], [HOME + r, MID + s * r, 0.12], "miku", a);
        edge([HOME + s * r, MID - r, 0.12], [HOME + s * r, MID + r, 0.12], "miku", a * 0.8);
      }
    }
    // the archive behind: frames standing one behind the other, each fainter
    for (let k = 0; k < HALL.n; k++) {
      const z = HALL.z0 - k * HALL.dz;
      const hit = strikeHit(z);
      const a = 0.55 * (1 - k / HALL.n) + 0.10 + 0.75 * hit;
      const col = hit > 0.25 ? "mikuHi" : k === 0 ? "miku" : "dim";
      const x0 = -HALL.hw - k * 0.55, x1 = HALL.hw + k * 0.55;
      const y0 = HALL.cy - HALL.hh - k * 0.34, y1 = HALL.cy + HALL.hh + k * 0.34;
      edge([x0, y0, z], [x1, y0, z], col, a);
      edge([x0, y1, z], [x1, y1, z], col, a * 0.8);
      edge([x0, y0, z], [x0, y1, z], col, a * 0.9);
      edge([x1, y0, z], [x1, y1, z], col, a * 0.9);
      // every frame carries a rib, so the far ones read as a shelf, not a box
      const mid = (y0 + y1) / 2;
      edge([x0, mid, z], [x1, mid, z], col, a * 0.35);
    }
    // the cables the plate hangs from: it is held, not floating
    for (const s of [-1, 1]) {
      for (const y of [PLATE.y0, PLATE.y1]) {
        edge([s * PLATE.hw, y, 0], [s * PLATE.hw, RIG.y1 + 1.75, -0.75], "dim", 0.34);
      }
    }
    // the hall's ceiling rails: the depth of the room, said once
    for (const s of [-1, 1]) {
      edge([s * 10.6, 14.6, 6.0], [s * 10.6, 14.6, -34.0], "dim", 0.18);
      edge([s * 8.6, 0, 6.0], [s * 8.6, 0, -34.0], "dim", 0.22);
    }
    // the floor: 20 m of it, so the plate has a bottom
    for (let i = -6; i <= 6; i++) {
      w = writeInstance(this.wireData, w, {
        p: [i * 3.4, 0, -17], c: rgb("dim"), a: i % 2 ? 0.07 : 0.12,
        r: [Math.PI / 2, 0, 0], scale: [1, 17, 1],
      });
    }
    for (let j = 0; j < 11; j++) {
      const z = 2.4 - j * 3.0;
      w = writeInstance(this.wireData, w, {
        p: [0, 0, z], c: rgb("dim"),
        a: Math.max(0.02, 0.11 - j * 0.006) + 0.30 * strikeHit(z),
        r: [0, 0, Math.PI / 2], scale: [1, 20, 1],
      });
    }

    // ---- the operator. One whole person, 1.74 m, feet on the floor: the
    // scale of the plate is measured against a body, which is the one ruler a
    // viewer never has to be taught.
    let pc = 0;
    pc = writeInstance(this.peopleData, pc, {
      p: [OP.x + 0.02 * Math.sin(t * 0.6), 0, OP.z],
      s: OP.h,
      c: rgb("ink"),
      a: 0.95,
      r: [0, 0.22 + 0.02 * Math.sin(t * 0.4), 0],
    });

    // ---- the lit faces: the plate's surface, the write seam, the strike mark
    let fc = 0;
    fc = writeInstance(this.faceData, fc, {
      p: [0, MID, -0.07],
      c: rgb("tealDeep"),
      a: 0.12 + 0.06 * f.a.vocal + 0.12 * pulse,
      scale: [PLATE.hw, (PLATE.y1 - PLATE.y0) / 2, 1],
    });
    // the carriage's shoes, riding the top and bottom beams: the machine's
    // only solid parts, and the reason it reads as a machine
    for (const y of [RIG.y0 - 0.02, RIG.y1 + 0.02]) {
      fc = writeInstance(this.faceData, fc, {
        p: [headX, y, RIG.z - 0.02], c: rgb("miku"),
        a: 0.22 + 0.5 * pulse, scale: [0.55, 0.20, 1],
      });
    }
    fc = writeInstance(this.faceData, fc, {
      p: [headX, MID, RIG.z - 0.20],
      c: rgb("mikuHi"),
      a: 0.16 + 0.44 * live + 0.22 * pulse,
      scale: [0.07, 3.55, 1],
    });
    // ---- the operator's workstation: a light box standing on the floor in
    // front of the plate, and the pool it throws. A body in front of a light
    // is a silhouette; a body in front of nothing is a smudge, so this light
    // exists to make the 1.74 m readable -- it is what the ruler measures.
    fc = writeInstance(this.faceData, fc, {
      p: [OP.x, 1.15, 1.15], c: rgb("tealDeep"),
      a: 0.40 + 0.12 * pulse,
      scale: [0.85, 1.15, 1],
    });
    fc = writeInstance(this.faceData, fc, {
      p: [OP.x, 0.02, OP.z], c: rgb("tealDeep"),
      a: 0.22,
      r: [Math.PI / 2, 0, 0], scale: [1.10, 1.70, 1],
    });
    for (const k of CARDS) {
      const age = local - k.at;
      if (age < 0 || age > 0.6) continue;
      const a = Math.pow(1 - age / 0.6, 2);
      fc = writeInstance(this.faceData, fc, {
        p: [HOME, MID, 0.16], c: rgb("red"),
        a: a * 0.5, scale: [0.40 + age * 2.2, 0.40 + age * 2.2, 1],
      });
    }

    // ---- the air
    let m = 0;
    for (let i = 0; i < DUST; i++) {
      const h0 = hash(i * 2.71 + 0.3), h1 = hash(i * 5.13 + 1.1), h2 = hash(i * 8.77 + 2.9);
      m = writeInstance(this.dustData, m, {
        p: [
          -21 + 42 * h0 + 0.22 * Math.sin(t * 0.19 + i),
          0.3 + 15.0 * h2 + 0.12 * Math.sin(t * 0.31 + i * 1.7),
          -34 + 40 * h1,
        ],
        s: 1,
        c: rgb(i % 9 ? "dim" : "miku"),
        a: 0.08 + 0.16 * hash(i * 1.31),
      });
    }

    this.grooves.update(this.grooveData, g)
      .render(out, { ...PLATE_AIR, vp, soft: 0.3, opacity: 0.95 });
    this.faces.update(this.faceData, fc)
      .render(out, { ...PLATE_AIR, vp, soft: 1, opacity: 0.9 });
    this.wires.update(this.wireData, w).render(out, { ...HALL_AIR, vp });
    // the body runs after the light, so it carves its own hole in the plate
    this.people.update(this.peopleData, pc)
      .render(out, { vp, mode: "multiply", clearAlpha: 0, premul: true, opacity: 1 });
    this.dust.update(this.dustData, m)
      .render(out, { ...DUST_AIR, vp, point: 2.2, sprite: 1, opacity: 0.8 });

    // ---- where the plate lands on screen, so the name can be printed on it
    const TL = project(vp, [-PLATE.hw, PLATE.y1, 0], W, H);
    const TR = project(vp, [PLATE.hw, PLATE.y1, 0], W, H);
    const BL = project(vp, [-PLATE.hw, PLATE.y0, 0], W, H);
    const ppm = Math.hypot(TR[0] - TL[0], TR[1] - TL[1]) / (2 * PLATE.hw);
    const pw = 2 * PLATE.hw * ppm, ph = (PLATE.y1 - PLATE.y0) * ppm;
    this.plate = {
      ox: TL[0], oy: TL[1],
      ax: (TR[0] - TL[0]) / pw, ay: (TR[1] - TL[1]) / pw,
      bx: (BL[0] - TL[0]) / ph, by: (BL[1] - TL[1]) / ph,
      w: pw, h: ph, ppm,
    };

    // where the operator stands, in screen pixels: the 2D layer rules a
    // height bar between his feet and the top of his head
    const of_ = project(vp, [OP.x, 0, OP.z], W, H);
    const ot = project(vp, [OP.x, OP.h, OP.z], W, H);
    this.opMark = [of_[0], of_[1], ot[1], of_[2]];
  }

  render(f, out) {
    const t = f.t;
    const local = t - 21.69;
    const inU = clamp(local / 0.5);

    // the machine strikes first: the air pass needs the pulse, and the air
    // pass is drawn *under* the set (it overwrites the frame)
    const head = this.strike(local);
    this.pass.draw({
      dst: out,
      u: audioU(f, { uIn: inU, uBlast: this.blast, uPulse: head.pulse }),
    });
    this.setPass(out, f, t, local);

    const c = this.text.ctx;
    this.text.clear();

    this.names(c, local);
    this.phrase(c, t);
    this.scaleBar(c);
    this.hallMeter(c, local);

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    return {
      bloom: 1.15,
      exposure: 1.05,
      grain: 0.018,
      vignette: 0.5,
      ca: 0.0015 * (1 - inU),
      shake: [0, 0.004 * (1 - inU)],
      flash: 0.28 * Math.pow(1 - inU, 3),
    };
  }

  // The plate is 16.8 m and the operator is 1.74 m; both numbers are measured
  // off the geometry, and the ruler between them is drawn at his own feet.
  // This is the only object in the film that is bigger than the room it is in,
  // and a monument needs one thing next to it that a viewer already knows.
  scaleBar(c) {
    const m = this.opMark;
    if (!m || !m[0]) return;
    const [x, yFoot, yTop] = m;
    const bx = x + 30;
    c.save();
    c.strokeStyle = css("bone", 0.5);
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(bx - 7, yTop); c.lineTo(bx + 7, yTop);
    c.moveTo(bx - 7, yFoot); c.lineTo(bx + 7, yFoot);
    c.moveTo(bx, yTop); c.lineTo(bx, yFoot);
    c.stroke();
    // ticks every 0.25 m: the bar is a rule, not a bracket
    c.strokeStyle = css("dim", 0.45);
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 1; i < 7; i++) {
      const y = yFoot + (yTop - yFoot) * (i / 7);
      c.moveTo(bx - 3, y); c.lineTo(bx + 3, y);
    }
    c.stroke();
    c.restore();
    label(c, "OPERATOR 01", x, yTop - 16, {
      size: 14, align: "center", tracking: 2.2, color: css("ash", 0.9),
    });
    label(c, "1.74 m", bx + 8, (yTop + yFoot) / 2, {
      size: 14, tracking: 1.4, color: css("bone", 0.85),
    });
  }

  // The hall, measured. The 40.2 m rule is the archive's own depth (15 shelves
  // at 2.30 m), and the marker on it is the same 42 m/s front the 3D pass
  // uses -- so the instrument and the picture cannot disagree about where the
  // strike is, or about how long the room is.
  hallMeter(c, local) {
    // This block is inside the film's camera, and wake carries the largest
    // push in the film (1.165x, scaled about the frame centre): at that zoom
    // scene x < 136 px is outside the picture. So the instrument starts at
    // x = 250 and sits low enough that the push cannot lift it into the HUD.
    // The hall is drawn with more lines than any other chapter, so the
    // instrument gets its own plate: readings have to stay readable *over*
    // a ruled surface, or the room wins the argument.
    c.save();
    c.fillStyle = css("ink", 0.58);
    c.fillRect(234, 190, 256, 142);
    c.strokeStyle = css("dim", 0.28);
    c.lineWidth = 1;
    c.strokeRect(234.5, 190.5, 255, 141);
    c.restore();
    label(c, "ARCHIVE HALL / CV-01", 250, 216, {
      size: 15, tracking: 1.8, color: css("ash", 0.9),
    });
    label(c, `SHELVES ${HALL.n} \u00b7 DEPTH ${HALL_DEPTH.toFixed(1)} m`, 250, 242, {
      size: 13, tracking: 1.5, color: css("ash", 0.72),
    });

    let front = 0;
    for (const k of CARDS) {
      const age = local - k.at;
      if (age >= 0 && age <= 1.25) front = Math.min(HALL_DEPTH, age * WAVE);
    }
    const x = 250, w = 216, y = 302;
    c.save();
    c.strokeStyle = css("dim", 0.55);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x, y); c.lineTo(x + w, y);
    c.stroke();
    c.strokeStyle = css("dim", 0.4);
    c.beginPath();
    for (let i = 0; i <= 10; i++) {
      const tx = x + (w * i) / 10;
      c.moveTo(tx, y - (i % 5 === 0 ? 6 : 3));
      c.lineTo(tx, y + (i % 5 === 0 ? 6 : 3));
    }
    c.stroke();
    const mx = x + w * clamp(front / HALL_DEPTH);
    c.strokeStyle = css("mikuHi", 0.9);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(mx, y - 11); c.lineTo(mx, y + 11);
    c.stroke();
    c.restore();
    label(c, `STRIKE FRONT ${front.toFixed(1)} m`, x, y - 18, {
      size: 13, tracking: 1.5, color: css("miku", 0.85),
    });
    label(c, `${WAVE.toFixed(1)} m/s`, x + w, y + 20, {
      size: 12, align: "right", tracking: 1.4, color: css("dim", 0.8),
    });
  }

  // The name is printed on the plate. `draw` runs in plate pixels: +x across
  // the plate, +y down it, (0,0) at its top-left corner, so the text inherits
  // the room's perspective and the lens's push for free.
  onPlate(c, draw) {
    const p = this.plate;
    c.save();
    c.transform(p.ax, p.ay, p.bx, p.by, p.ox, p.oy);
    draw(c, p);
    c.restore();
  }

  // Three names on one plate. The current one is struck big in the hero
  // position; when the next strike lands, it is pushed up into the ledger and
  // stays there as a faint impression. Nothing is ever erased.
  names(c, local) {
    const ppm = this.plate.ppm;
    this.onPlate(c, (ctx, p) => {
      const headPx = (this.head.x + PLATE.hw) * ppm;
      const inset = 0.10 * ppm;

      // The ledger is a recess, not a list: the plate is milled lower on the
      // left third, and every retired name is read *inside* that well. The
      // grooves that carry the strike still ripple underneath it, so the
      // pocket is part of the same surface -- it just holds less light.
      const well = { x: 0.86 * ppm, y: 0.86 * ppm, w: 5.90 * ppm, h: 2.74 * ppm };
      ctx.save();
      ctx.fillStyle = css("ink", 0.46);
      ctx.fillRect(well.x, well.y, well.w, well.h);
      ctx.strokeStyle = css("miku", 0.20);
      ctx.lineWidth = Math.max(1, 0.012 * ppm);
      ctx.strokeRect(well.x, well.y, well.w, well.h);
      ctx.restore();

      // the ledger's margin rule: the plate is a record, and records are ruled
      ctx.save();
      ctx.fillStyle = css("miku", 0.24);
      ctx.fillRect(1.08 * ppm, 0.95 * ppm, 1.6, 2.72 * ppm);
      ctx.restore();

      for (let i = 0; i < CARDS.length; i++) {
        const k = CARDS[i];
        if (local < k.at) continue;
        const next = CARDS[i + 1];
        // the last card never leaves the hero position, so it has no row
        const row = LEDGER[i] || LEDGER[LEDGER.length - 1];
        // where this name sits: hero while it is news, ledger once it is history
        const u = next ? easeInOutCubic(clamp((local - next.at + 0.26) / 0.46)) : 0;
        const size = (k.mainSize + (row.size - k.mainSize) * u) * ppm;
        const subSize = (k.subSize + (row.subSize - k.subSize) * u) * ppm;
        const x = (HERO.x + (row.x - HERO.x) * u) * ppm;
        const mainY = (HERO.mainY + (row.mainY - HERO.mainY) * u) * ppm;
        const subY = (HERO.subY + (row.subY - HERO.subY) * u) * ppm;
        const alpha = 1 - 0.40 * u;
        const mainColor = u > 0.5 ? css("ash", 0.6 * alpha) : css("bone", 0.98 * alpha);
        const subColor = u > 0.5 ? css("dim", 0.55 * alpha)
          : k.serif ? css("ash", 0.92 * alpha) : css("miku", 0.85 * alpha);
        // the tracking is a fraction of the size, so a name that shrinks into
        // the ledger keeps its proportions instead of coming apart
        const mTrack = k.mainTrack * size, sTrack = k.subTrack * subSize;

        // printing: the name only exists to the left of the write head
        const printing = i === this.head.card && this.head.live > 0.001;
        ctx.save();
        if (printing) {
          ctx.beginPath();
          ctx.rect(0, 0, Math.max(0, headPx), p.h);
          ctx.clip();
        }
        // the letterpress: a dark impression under the ink
        drawText(ctx, k.main, {
          x, y: mainY + Math.max(1, 0.022 * ppm), size, weight: k.weight,
          mono: k.mono, serif: k.serif, tracking: mTrack,
          align: "center", color: css("ink", 0.75 * alpha),
        });
        drawText(ctx, k.main, {
          x, y: mainY, size, weight: k.weight, mono: k.mono, serif: k.serif,
          tracking: mTrack, align: "center", color: mainColor,
        });
        drawText(ctx, k.sub, {
          x, y: subY, size: subSize,
          weight: k.weight, mono: k.mono, serif: k.serif, italic: k.italic,
          tracking: sTrack, align: "center", color: subColor,
        });
        // the wet ink right behind the head, and the seam that cut it
        if (printing) {
          const bandW = Math.max(2, 0.9 * ppm);
          ctx.save();
          ctx.beginPath();
          ctx.rect(headPx - bandW, 0, bandW + 2, p.h);
          ctx.clip();
          drawText(ctx, k.main, {
            x, y: mainY, size, weight: k.weight, mono: k.mono, serif: k.serif,
            tracking: mTrack, align: "center", color: css("mikuHi", 0.95),
          });
          ctx.restore();
          ctx.fillStyle = css("mikuHi", 0.85 * this.head.live);
          ctx.fillRect(headPx - 1.2, inset, 2.4, p.h - inset * 2);
        }
        ctx.restore();
      }

      // the plate is a label, so it is labelled -- on the plate, at its foot
      const lsize = Math.max(9, 0.115 * ppm);
      label(ctx, "LAST KNOWN FRAME \u2014 FIRST BREATH", p.w * 0.5, p.h * 0.945, {
        size: lsize, align: "center", tracking: lsize * 0.42, color: css("dim", 0.8),
      });
      label(ctx, "CV-01", 0.95 * ppm, p.h * 0.945, {
        size: lsize, tracking: lsize * 0.4, color: css("dim", 0.7),
      });
      label(ctx, `HEAD ${(this.head.x + PLATE.hw).toFixed(2)} m`, p.w - 0.95 * ppm, p.h * 0.945, {
        size: lsize, align: "right", tracking: lsize * 0.4, color: css("miku", 0.6),
      });
    });
  }

  // The first phrase of the song, broken on the beat, in front of the machine.
  phrase(c, t) {
    const t0 = this.broken ? this.broken.start : 22.03;
    if (t < t0 - 0.1) return;
    const parts = ["\u30e2\u30a6\u30fb\u30fb", "\u3044\u3061\u3069", "\u30fb\u30c0\u30fb", "\u30b1\u30fb\u30fb\u30fb"];
    const size = 54, gap = 26;
    const f = font(size, { weight: 700 });
    const advances = parts.map((s) => measure(c, s, f, 0));
    const total = advances.reduce((a, b) => a + b, 0) + gap * (parts.length - 1);
    let x = 960 - total / 2;
    const y = 812;
    parts.forEach((s, i) => {
      const p = clamp((t - (t0 - 0.08 + i * 0.62)) / 0.22);
      if (p <= 0) return;
      const drop = (Math.sin(t * 27.0 + i * 2.3) > 0.55) ? 0.25 : 1.0;
      drawText(c, s, {
        x, y, size, weight: 700, color: css("miku", 0.95),
        alpha: p * drop,
      });
      x += advances[i] + gap;
    });
    label(c, "FIRST BREATH", 960, 880, {
      size: 14, align: "center", tracking: 4,
      color: css("dim", 0.75 * smoothstep(t0, t0 + 0.6, t)),
    });
  }
}
