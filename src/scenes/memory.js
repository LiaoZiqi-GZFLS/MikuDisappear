// 1:13.7 - chorus 1. The only warm passage in the film.
//
// The memory is not an image, it is a room. A huge, almost empty hall; a
// screen at the far end still playing a performance; dust hanging in the
// projector's beam; and two people in the last row, watching it with their
// backs to us. Nothing in this chapter is counted, so for sixteen seconds the
// film stops being a record and becomes a place.
//
// Then the second line arrives -- "I cannot feel anything" -- and the picture
// does what the words say. The beam thins out, the screen loses its colour,
// the two silhouettes go, and a single empty seat is the last thing still lit.
// The camera does not cut away; it just stops looking at her.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import { clamp, label, lyricLine, machineChrome, offscreen, smoothstep, tickRule, wave } from "../kit.js";
import { motifLabel, singer } from "../motifs.js";
import { Stage3D, camera, mat4, project, rgb, writeInstance } from "../gl3d.js";
import { draw as drawText } from "../type.js";
import { audioU, layer, line } from "./util.js";

const FRAG = `
uniform float uT;
uniform float uRms;
uniform float uVocal;
uniform float uWarm;     // 1 = amber memory, 0 = cold present
uniform float uBeam;     // the projector is still running
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 col = C_INK;

  // The hall is black; what little light there is comes off the screen, so the
  // ground under it is warm and everything else is not. It has to stay a
  // *dark* room: the memory is one lit rectangle in a black space, and a hall
  // washed in amber is a sepia filter, not a place.
  float glow = exp(-pow(length(p * vec2(0.62, 0.95)) * 3.0, 2.0));
  col += C_AMBER * 0.011 * glow * uWarm * (0.4 + 0.6 * uBeam);
  col += C_TEAL_DEEP * 0.045 * glow * (1.0 - uWarm);

  // the beam's own haze: one soft wedge from above the last row to the screen
  float axis = smoothstep(0.62, 0.06, uv.y);
  col += C_AMBER * 0.006 * axis * uWarm * uBeam * (0.5 + 0.5 * uRms);

  // remembered concentric ripples, slow and even
  float r = length(p);
  float rip = sin(r * 26.0 - uT * 1.6) * exp(-r * 2.2);
  col += mix(C_TEAL_DEEP, C_AMBER, uWarm) * rip * (0.04 + 0.10 * uRms) * 0.18;

  col += C_MIKU * 0.010 * uVocal * exp(-pow((uv.y - 0.5) * 5.0, 2.0));
  fragColor = vec4(col, 1.0);
}`;

// --------------------------------------------------------------- the hall
// Everything is in metres. The screen is at the far end, the floor rakes up
// towards the lens, and the lens sits in the last row with two heads under it.
const HALL = {
  screenZ: -20.0, screenY: 8.40, screenHW: 13.1, screenHH: 7.05,
  // A long lens keeps the screen small; the pair then has to sit so far back
  // that their heads fall under the frame. The room is shot at 1.10 rad
  // instead: wide enough that two heads 2 m behind the seats and a screen
  // 33 m away fit in the same frame -- which is exactly what a cinema looks
  // like from the last row. The ceiling is nearly three times a person's
  // height because the hall has to read as a hangar with seats in it: the
  // smaller the two of them are against it, the more the room is a room.
  eye: [0, 2.60, 13.40], at: [0, 8.40, -20.0], fov: 1.10,
  lamp: [0, 14.4, 10.2],
  rows: 22, rowZ0: 12.2, rowGap: 1.25, rake: 0.17, zFlat: 1.6,
  // Two side aisles and one unbroken middle block: the seat the chapter ends
  // on has to be able to sit dead centre, between the two of them.
  seatHW: 9.6, seats: 12, aisle: [-3.6, 3.6], aisleW: 0.85,
  halfW: 22.0, ceiling: 22.0, depth: 62.0,
};

// Step 60. The beam used to be a screen-space wedge: a triangle of gradient
// from the lamp to the screen, correct as haze and useless as an object. It is
// now a real frustum in the room's metres -- a 0.35 m aperture at the lamp,
// the 26.2 x 14.1 m screen at the far end, four corners joined, and 14
// cross-sections of air growing between them. The panel prints what the
// geometry actually is: the throw, the aperture, the spread. A beam is the one
// thing in this chapter that can measure the room without a single label.
const BEAM = {
  aperture: 0.35,   // m across the lamp's own gate
  sections: 14,     // cross-sections of air between the gate and the screen
  iris: 12,         // segments in the ring on the barrel
};

const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const rowZ = (r) => HALL.rowZ0 - r * HALL.rowGap;
const floorY = (z) => Math.max(0, (z - HALL.zFlat) * HALL.rake);
const seatX = (i) => ((i + 0.5) / HALL.seats - 0.5) * 2 * HALL.seatHW;
const isAisle = (i) => {
  const x = seatX(i);
  return HALL.aisle.some((a) => Math.abs(x - a) < HALL.aisleW);
};

// The two people in the last row, in world metres: where their heads are, and
// how big a head is. Everything else about them is drawn in 2D, from where
// these project.
const PAIR = {
  z: 10.2,
  her: { x: -1.35, head: 2.26, r: 0.112, tails: true, warm: 0 },
  him: { x: 1.30, head: 2.20, r: 0.098, tails: false, warm: 1 },
};

// Her, from behind: the film never gives her a face, and this shot does not
// ask for one. What carries her here is the part of the silhouette a back view
// keeps -- twin tails with their square ties, the band of the headset, and
// shoulders that stop at the bottom edge of the frame.
function backView(ctx, x, y, s, o = {}) {
  const ink = o.ink || css("ink", 0.96);
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = o.alpha ?? 1;

  // shoulders first: the tails have to fall *outside* them, and the only way
  // to be sure is to draw the mass and then hang the hair over it
  const shTop = 2.35, shHalf = 2.85;
  ctx.beginPath();
  ctx.moveTo(-shHalf * s, 6.8 * s);
  ctx.lineTo(-shHalf * s, shTop * s);
  ctx.quadraticCurveTo(-2.05 * s, 1.02 * s, -0.72 * s, 0.86 * s);
  ctx.lineTo(0.72 * s, 0.86 * s);
  ctx.quadraticCurveTo(2.05 * s, 1.02 * s, shHalf * s, shTop * s);
  ctx.lineTo(shHalf * s, 6.8 * s);
  ctx.closePath();
  ctx.fillStyle = ink;
  ctx.fill();
  // the rim runs along the shoulder line only: a closed outline turns a back
  // into a capsule
  ctx.beginPath();
  ctx.moveTo(-shHalf * s, shTop * s);
  ctx.quadraticCurveTo(-2.05 * s, 1.02 * s, -0.72 * s, 0.86 * s);
  ctx.lineTo(0.72 * s, 0.86 * s);
  ctx.quadraticCurveTo(2.05 * s, 1.02 * s, shHalf * s, shTop * s);
  ctx.strokeStyle = o.tails ? css("miku", 0.42) : css("amber", 0.40);
  ctx.lineWidth = 1.4;
  ctx.stroke();

  if (o.tails) {
    for (const side of [-1, 1]) {
      const pts = [];
      const wide = [];
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const sway = Math.sin(u * 3.1 + side * 0.9) * 0.10 * u;
        pts.push([
          side * (0.80 + 1.55 * u * u) * s + sway * s,
          (0.30 + 4.2 * u) * s + Math.sin(u * 2.4 + side) * 0.06 * s,
        ]);
        wide.push(s * (0.34 + 0.34 * Math.sin(Math.PI * Math.pow(u, 0.8))) * (1 - 0.34 * u * u));
      }
      const g = ctx.createLinearGradient(0, 0, 0, 4.6 * s);
      g.addColorStop(0, css("miku", 0.34));
      g.addColorStop(0.42, css("tealDeep", 0.70));
      g.addColorStop(1, css("tealDeep", 0.08));
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i <= n; i++) ctx.lineTo(pts[i][0] - wide[i] * 0.5, pts[i][1]);
      for (let i = n; i >= 0; i--) ctx.lineTo(pts[i][0] + wide[i] * 0.5, pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = css("miku", 0.34);
      ctx.lineWidth = 1.1;
      ctx.stroke();
      // the hair tie: the anchor the film opens on, seen from the other side
      ctx.save();
      ctx.translate(side * 0.62 * s, 0.30 * s);
      ctx.rotate(side * 0.22);
      ctx.fillStyle = css("ink", 0.95);
      ctx.fillRect(-0.19 * s, -0.22 * s, 0.38 * s, 0.44 * s);
      ctx.strokeStyle = css("red", 0.55);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-0.19 * s, -0.22 * s, 0.38 * s, 0.44 * s);
      ctx.restore();
    }
  }

  // the back of the head: no features, only a rim where the screen light
  // catches hair -- the one place in the film where "no face" is literal
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.70 * s, 0.80 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = ink;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.70 * s, 0.80 * s, 0, Math.PI * 0.60, Math.PI * 1.40);
  ctx.strokeStyle = o.tails ? css("mikuHi", 0.34) : css("amber", 0.30);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  if (o.tails) {
    // the headset band, the only hardware visible from behind
    ctx.beginPath();
    ctx.ellipse(0, -0.06 * s, 0.72 * s, 0.82 * s, 0, Math.PI * 1.08, Math.PI * 1.92);
    ctx.strokeStyle = css("mikuHi", 0.18);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.restore();
}

export default class Memory extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "memory");

    // The hall: architecture in lines, the rows of empty seats in wire, and
    // the screen as the one filled surface in the room.
    this.vp = mat4();
    this.arch = new Stage3D(ctx, "segment");
    this.seats = new Stage3D(ctx, "quad");
    this.faces = new Stage3D(ctx, "rect");
    this.beamCone = new Stage3D(ctx, "rect");
    this.beamEdge = new Stage3D(ctx, "segment");
    this.archData = new Float32Array(460 * 16);
    this.seatData = new Float32Array(280 * 16);
    this.faceData = new Float32Array(16 * 16);
    this.coneData = new Float32Array(BEAM.sections * 16);
    this.beamData = new Float32Array((4 + 4 + BEAM.iris) * 16);

    // The motes live in the beam, so they are placed in world space and
    // projected; their size in pixels falls off with depth like everything
    // else in the room.
    this.motes = [];
    for (let i = 0; i < 190; i++) {
      const h = (k) => hash(i * 7.31 + k * 37.7);
      const u = h(1);                      // 0 = at the lamp, 1 = at the screen
      // Step 60 moved the dust from a thread to a volume: a mote is seeded
      // anywhere inside the cone *at its own u*, so the beam fills as it opens
      // and every mote can be checked against the same frustum that drew it.
      this.motes.push({
        u, drift: 0.004 + h(2) * 0.012,
        // as fractions of the cone at that mote's own u, so a mote can drift
        // for the whole chapter and still be inside the light when it is drawn
        af: (h(3) - 0.5) * 2 * 0.92,
        bf: (h(4) - 0.5) * 2 * 0.92,
        size: 0.9 + h(5) * 1.6, phase: h(6) * Math.PI * 2,
      });
    }
    this.screen = [0, 0, 0, 0];
    this.seatLight = null;
    this.qaBeam = null;
    this.beamMotes = 0;
    this.beamMotesOut = 0;

    // The beam's own frame, computed once from the two things it is made of --
    // the lamp and the screen. The frustum, the dust and the readout all use
    // these numbers, so none of the three can disagree about the light.
    {
      const [lx, ly, lz] = HALL.lamp;
      const dx = -lx, dy = HALL.screenY - ly, dz = HALL.screenZ - lz;
      const throwM = Math.hypot(dx, dy, dz);
      const dir = [dx / throwM, dy / throwM, dz / throwM];
      const e1 = [1, 0, 0];
      const e2 = [
        e1[1] * dir[2] - e1[2] * dir[1],
        e1[2] * dir[0] - e1[0] * dir[2],
        e1[0] * dir[1] - e1[1] * dir[0],
      ];
      this.beam = {
        lamp: HALL.lamp, screen: [0, HALL.screenY, HALL.screenZ],
        throwM, dir, e1, e2,
      };
    }
  }

  async init() {
    const F = this.ctx.features;
    this.warmLine = line(F, "\u3042\u3093\u306a\u306b\u697d\u3057\u304b\u3063\u305f");
    this.coldLine = line(F, "\u4f55\u3082\u611f\u3058\u306a\u304f\u306a\u3063\u3066");
  }

  render(f, out) {
    const t = f.t;
    const local = t - 73.69;
    const W = this.warmLine, C = this.coldLine;
    // The memory cools on its own line -- "I cannot feel anything" -- not on a
    // timer: the second she stops feeling it, the light starts leaving.
    const cold = C ? smoothstep(C.start, C.start + 4.6, t) : smoothstep(7.7, 12.3, local);
    const warm = 1 - cold;
    const beam = 1 - smoothstep(0.06, 0.68, cold);

    this.pass.draw({ dst: out, u: audioU(f, { uWarm: warm, uBeam: beam }) });
    this.hallPass(out, { t, warm, cold, beam });

    const c = this.text.ctx;
    this.text.clear();

    // The dust first: it is the beam's own air, and counting it is what lets
    // the frustum print how much of the room that light is actually crossing.
    if (beam > 0.01) this.motePass(c, { t, beam, warm });
    this.beamPass(out, { warm, beam });

    // ---------------------------------------------------------------- the beam
    // The 3D frustum above is the object; this wedge is only the last of its
    // haze, kept because a beam that is all edges reads as a diagram.
    const lamp = project(this.vp, HALL.lamp, this.ctx.W, this.ctx.H);
    if (beam > 0.01) {
      const [sx, sy, sw, sh] = this.screen;
      const cx = sx + sw / 2, cy = sy + sh / 2;
      const g = c.createLinearGradient(lamp[0], lamp[1], cx, cy);
      g.addColorStop(0, css("amber", 0));
      g.addColorStop(0.45, css("amber", 0.008 * beam));
      g.addColorStop(1, css("amber", 0.012 * beam * warm));
      c.save();
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(lamp[0], lamp[1]);
      c.lineTo(sx - sw * 0.06, sy - sh * 0.10);
      c.lineTo(sx + sw * 1.06, sy - sh * 0.10);
      c.closePath();
      c.fill();
      c.restore();
    }

    // -------------------------------------------------------------- the screen
    // What was playing then: the stage, her, and the lights of the people who
    // came to hear it -- the one performance in the film that nobody stopped.
    this.program(c, { t, f, warm, cold });

    // ------------------------------------------------ the last row, from behind
    // Two heads under the beam. They are placed by projection, so the film's
    // slow push moves them exactly as it moves the room around them.
    const pairFade = 1 - smoothstep(0.55, 0.95, cold);
    if (pairFade > 0.01) {
      for (const p of [PAIR.her, PAIR.him]) {
        // The drawing unit is *defined* by two projected points -- the head
        // centre and one head-radius above it -- so the figures are exactly
        // the size the room says they are, whatever the lens does.
        const [px, py, pw] = project(this.vp, [p.x, p.head, PAIR.z], this.ctx.W, this.ctx.H);
        const [, pyUp] = project(this.vp, [p.x, p.head + p.r, PAIR.z], this.ctx.W, this.ctx.H);
        if (pw <= 0.05) continue;
        // A touch smaller than the maths says: the two of them are the
        // foreground, not the subject, and a hall this size has to win them.
        const s = 0.72 * (py - pyUp) / 0.80;
        backView(c, px, py, s, {
          alpha: pairFade * 0.95,
          tails: p.tails,
          ink: css("ink", 0.94),
        });
      }
      motifLabel(c, "THE LAST ROW / NOBODY ELSE CAME", this.screen[0] + 2, this.screen[1] + this.screen[3] + 30, {
        color: css("amber", 0.52 * warm * pairFade),
      });
    }

    // ------------------------------------------------------------- the lyrics
    const which = t < (C ? C.start : 81.42) ? W : C;
    if (which) {
      const fresh = clamp((t - which.start) / 0.9);
      const cool = which === C ? cold : 0;
      c.save();
      c.globalAlpha = 0.90;
      lyricLine(c, which, t, f.F, {
        x: 960, y: 214 - 10 * cool, size: 110, weight: 900, align: "center", maxWidth: 1640,
        sung: which === C ? css("bone", 0.95 - 0.3 * cool) : css("amber", 0.98),
        dim: css("ash", 0.52),
      });
      c.restore();
      // The line gets a hairline under it instead of a caption: the screen is
      // already saying what this is, and two labels would fight.
      if (fresh > 0.02) {
        c.save();
        c.globalAlpha = fresh * (1 - clamp((t - which.end) / 0.6)) * 0.5;
        c.fillStyle = css(which === C ? "ash" : "amber", 0.7);
        c.fillRect(560, 246 - 10 * cool, 800, 1);
        c.restore();
      }
    }

    // ------------------------------------------------- and then the empty seat
    // The shot the whole chapter was built to reach: she is gone from it, and
    // the only thing still burning is a seat.
    if (this.seatLight && cold > 0.25) {
      const [sx, sy, sr] = this.seatLight;
      const a = smoothstep(0.25, 0.85, cold);
      c.save();
      // a pool of light, not a lit rectangle: the working lights came up on an
      // empty house, and one seat is under the only lamp still on
      const pool = c.createRadialGradient(sx, sy, 0, sx, sy, sr * 3.4);
      pool.addColorStop(0, css("amber", 0.30 * a));
      pool.addColorStop(0.42, css("amber", 0.13 * a));
      pool.addColorStop(1, css("amber", 0));
      c.fillStyle = pool;
      c.save();
      c.translate(sx, sy);
      c.scale(1, 0.72);
      c.beginPath();
      c.arc(0, 0, sr * 3.4, 0, Math.PI * 2);
      c.fill();
      c.restore();
      c.globalAlpha = a;
      c.strokeStyle = css("amber", 0.55);
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(sx, sy, sr * 1.35, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.moveTo(sx - sr * 2.6, sy);
      c.lineTo(sx - sr * 1.6, sy);
      c.moveTo(sx + sr * 1.6, sy);
      c.lineTo(sx + sr * 2.6, sy);
      c.stroke();
      c.restore();
      motifLabel(c, "SEAT 01 / VACANT", sx + sr * 2.1, sy + 4, {
        color: css("amber", 0.72 * a),
      });
    }

    // a readout that only ever measures the two things this chapter is about,
    // kept clear of the player's own HUD in the bottom corner
    c.save();
    c.globalAlpha = 0.85;
    tickRule(c, 96, 596, 260, { count: 20, h: 5, major: 5, majorH: 9, color: css("dim", 0.45) });
    label(c, "SCREEN LIGHT", 96, 574, { size: 15, tracking: 1.6, color: css("ash", 0.75) });
    drawText(c, `${(warm * 100).toFixed(1)} %`, {
      x: 356, y: 578, size: 18, weight: 600, mono: true, align: "right",
      color: warm > 0.5 ? css("amber", 0.9) : css("ash", 0.8),
    });
    label(c, "BEAM", 96, 660, { size: 15, tracking: 1.6, color: css("ash", 0.75) });
    drawText(c, `${(beam * 100).toFixed(0)} %`, {
      x: 356, y: 664, size: 18, weight: 600, mono: true, align: "right", color: css("ash", 0.8),
    });
    // and what that light *is*, in the room's own metres (step 60): the gate,
    // the throw, and the wall it lands on. All three are the numbers the
    // frustum above was built from -- a lamp, not a gradient.
    if (this.qaBeam) {
      const q = this.qaBeam;
      label(c, "PROJECTOR 02", 96, 706, { size: 13, tracking: 1.4, color: css("ash", 0.75) });
      drawText(c, `${q.throwM.toFixed(1)} m THROW`, {
        x: 356, y: 708, size: 16, weight: 600, mono: true, align: "right", color: css("ash", 0.8),
      });
      label(c, `GATE ${q.aperture.toFixed(2)} m \u2192 ${q.screenW.toFixed(1)} \u00d7 ${q.screenH.toFixed(1)} m`, 96, 740, {
        size: 14, tracking: 1.1, color: css("amber", 0.72 * (0.3 + 0.7 * beam)),
      });
      label(c, `SPREAD \u00d7${q.spread.toFixed(1)} \u00b7 ${q.sections} SECTIONS \u00b7 DUST ${q.motes}`, 96, 764, {
        size: 13, tracking: 1.1, color: css("ash", 0.62),
      });
    }
    c.restore();

    machineChrome(c, { name: "", left: "MEMORY / REMEMBERED", right: `T+${local.toFixed(1)} s` });

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    return {
      bloom: 0.80 + 0.55 * warm + 0.3 * f.vox,
      exposure: 1.0,
      grain: 0.02,
      vignette: 0.66 + 0.06 * cold,
      scan: 0.03,
      ca: 0.0016,
      fade: 0.35 * smoothstep(14.4, 16.0, local),
    };
  }

  // ---- the room ------------------------------------------------------------
  // Lines for everything the eye can measure itself against, wire squares for
  // the seats still waiting, and one filled plate: the screen.
  hallPass(out, { t, warm, cold, beam }) {
    const W = HALL;
    const aspect = this.ctx.W / this.ctx.H;
    const local = t - 73.69;
    // The camera's own push: monotone, no breathing -- a tripod in a room
    // nobody wants to disturb. It starts to lean towards the empty seat only
    // on "I cannot feel anything": the move *is* the line, not a timer.
    const push = smoothstep(0, 16, local) * 1.05;
    const drift = smoothstep(8.2, 15.0, local);
    // the seat the chapter ends on: centre block, middle of the house
    const seatRow = 9, seatCol = 12;
    const seatWorld = [seatX(seatCol), floorY(rowZ(seatRow)) + 0.58, rowZ(seatRow)];
    const lean = 0.20 * drift;
    const eye = [W.eye[0] + 0.16 * drift, W.eye[1] + 0.06 * push, W.eye[2] - push];
    camera(this.vp, {
      eye,
      at: [
        W.at[0] * (1 - lean) + seatWorld[0] * lean,
        W.at[1] * (1 - lean) + (seatWorld[1] + 0.30) * lean,
        W.at[2],
      ],
      fov: W.fov, near: 0.2, far: 300, aspect,
    });
    this.eye = eye;

    // The room's line colour is the memory's temperature: amber while it is
    // remembered, a neutral grey-blue once it is only a record. Mixing all the
    // way to tealDeep makes the room *vanish* -- it is one fiftieth the
    // luminance of amber, and a hall you cannot see is not a cold hall.
    const warmCol = rgb("amber"), coldCol = rgb("dim");
    const lineCol = warmCol.map((v, i) => v + (coldCol[i] - v) * cold);
    const lift = 1 + 0.8 * cold;
    let n = 0;
    const seg = (p0, p1, a, w = 1) => {
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
      const L = Math.hypot(dx, dy, dz);
      if (L < 1e-4 || n + 16 > this.archData.length) return;
      n = writeInstance(this.archData, n, {
        p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2],
        c: lineCol, a, s: 1,
        r: [-Math.asin(clamp(dz / L, -1, 1)), 0, Math.atan2(-dx, dy)],
        scale: [w, L / 2, 1],
      });
    };

    // ---- the volume of the hall (all in metres) ---------------------------
    // The room is 44 m wide and 22 m tall; the screen is a 26 m plate 33 m
    // away. Every later line is measured against those numbers -- which is
    // what makes the two people in the last row read as small.
    const zBack = W.rowZ0 + 2.0;
    const sy0 = W.screenY - W.screenHH;
    const sy1 = W.screenY + W.screenHH;

    // the far end: a proscenium around the screen, a cyclorama behind it, and
    // the one arch that tells the eye this room has a ceiling
    for (const x of [-W.screenHW - 1.2, W.screenHW + 1.2]) {
      seg([x, 0, W.screenZ - 0.1], [x, W.ceiling - 3.4, W.screenZ - 0.1], 0.10 * lift);
    }
    seg([-W.screenHW - 1.2, W.ceiling - 3.4, W.screenZ - 0.1],
      [W.screenHW + 1.2, W.ceiling - 3.4, W.screenZ - 0.1], 0.11 * lift);
    seg([-W.screenHW - 1.2, W.ceiling - 3.4, W.screenZ - 0.1],
      [-W.screenHW - 1.2, W.ceiling, W.screenZ], 0.07 * lift);
    seg([W.screenHW + 1.2, W.ceiling - 3.4, W.screenZ - 0.1],
      [W.screenHW + 1.2, W.ceiling, W.screenZ], 0.07 * lift);
    seg([-W.screenHW - 1.2, W.ceiling, W.screenZ],
      [W.screenHW + 1.2, W.ceiling, W.screenZ], 0.08 * lift);
    seg([-W.screenHW - 1.2, 0.4, W.screenZ - 0.1],
      [-W.screenHW - 1.2, W.ceiling, W.screenZ], 0.05 * lift);
    seg([W.screenHW + 1.2, 0.4, W.screenZ - 0.1],
      [W.screenHW + 1.2, W.ceiling, W.screenZ], 0.05 * lift);

    // the side walls: wainscot, gallery lip and ceiling cove running the whole
    // 32 m to the last row, plus piers every 5.2 m -- verticals are what give
    // a wide room its depth
    for (const s of [-1, 1]) {
      seg([s * W.halfW, 1.5, zBack], [s * W.halfW, 1.5, W.screenZ], 0.05 * lift);
      seg([s * W.halfW, 9.6, zBack], [s * W.halfW, 9.6, W.screenZ], 0.075 * lift);
      seg([s * (W.halfW - 2.4), W.ceiling, zBack],
        [s * (W.screenHW + 1.2), W.ceiling, W.screenZ], 0.05 * lift);
      seg([s * W.halfW, W.ceiling, W.screenZ], [s * W.halfW, 0.4, W.screenZ], 0.045 * lift);
      for (let pi = 0; pi < 7; pi++) {
        const pz = zBack - pi * 5.2;
        seg([s * W.halfW, 0.4, pz], [s * W.halfW, W.ceiling - 1.5, pz], 0.035 * lift);
      }
      // the gallery rail light: the one warm line that runs the length of the
      // room and stays lit after the screen has given up
      seg([s * W.halfW, 9.6, W.screenZ + 0.5], [s * W.halfW, 9.6, zBack],
        (0.10 + 0.05 * warm) * lift);
    }

    // ---- the ceiling: a ribcage ------------------------------------------
    // The ribs are the only thing in the room that is unmistakably huge: each
    // one starts at the top of a wall, drops 1.8 m, flattens across the whole
    // 44 m, and drops again on the far side.
    for (let i = 0; i < 13; i++) {
      const z = zBack - 1.0 - i * 2.7;
      const a = (0.030 + 0.020 * warm) * lift;
      const dy = 1.8;
      seg([-W.halfW, W.ceiling, z], [-W.halfW + 3.2, W.ceiling - dy, z], a);
      seg([W.halfW, W.ceiling, z], [W.halfW - 3.2, W.ceiling - dy, z], a);
      seg([-W.halfW + 3.2, W.ceiling - dy, z], [W.halfW - 3.2, W.ceiling - dy, z], a * 1.2);
      // a pair of longitudinal purlins along the flat top
      if (i % 2 === 0) {
        for (const s of [-1, 1]) {
          seg([s * 9.0, W.ceiling - dy, z], [s * 9.0, W.ceiling - dy, z - 2.7], a * 0.9);
        }
      }
    }

    // ---- floor ------------------------------------------------------------
    for (const a of W.aisle) {
      seg([a, floorY(W.rowZ0), W.rowZ0], [a, 0, W.screenZ + 1], (0.055 + 0.03 * warm) * lift);
    }
    seg([-W.seatHW, floorY(zBack), zBack], [-W.screenHW - 1, 0, W.screenZ + 1], 0.10 * lift);
    seg([W.seatHW, floorY(zBack), zBack], [W.screenHW + 1, 0, W.screenZ + 1], 0.10 * lift);

    // the screen's frame, and the speakers standing either side of it
    seg([-W.screenHW, sy1, W.screenZ], [W.screenHW, sy1, W.screenZ], 0.30 * warm + 0.08 * lift);
    seg([-W.screenHW, sy0, W.screenZ], [W.screenHW, sy0, W.screenZ], 0.20 * warm + 0.06 * lift);
    for (const s of [-1, 1]) {
      seg([s * W.screenHW, sy0, W.screenZ], [s * W.screenHW, sy1, W.screenZ], 0.24 * warm + 0.06 * lift);
      seg([s * (W.screenHW + 2.0), 0.2, W.screenZ + 1.6],
        [s * (W.screenHW + 2.0), 5.6, W.screenZ + 1.6], 0.14 * beam);
      seg([s * (W.screenHW + 3.1), 0.2, W.screenZ + 1.6],
        [s * (W.screenHW + 3.1), 5.6, W.screenZ + 1.6], 0.10 * beam);
    }

    // the projection booth, at the top of the back wall: the beam in the air
    // needs a machine it could have come out of
    seg([-2.0, W.lamp[1] - 0.8, W.lamp[2] + 0.4], [2.0, W.lamp[1] - 0.8, W.lamp[2] + 0.4], 0.10 * beam);
    seg([-2.0, W.lamp[1] + 0.7, W.lamp[2] + 0.4], [2.0, W.lamp[1] + 0.7, W.lamp[2] + 0.4], 0.08 * beam);
    for (const s of [-1, 1]) {
      seg([s * 2.0, W.lamp[1] - 0.8, W.lamp[2] + 0.4],
        [s * 2.0, W.lamp[1] + 0.7, W.lamp[2] + 0.4], 0.07 * beam);
    }
    seg([-0.34, W.lamp[1] - 0.05, W.lamp[2] + 0.42], [0.34, W.lamp[1] - 0.05, W.lamp[2] + 0.42],
      0.42 * beam);

    // ---- the house --------------------------------------------------------
    // 22 rows of seat backs recede into the dark: each row is one unbroken
    // line (with a gap at each aisle), which is all the eye needs to count a
    // full house. The near rows also get individual wire seats, because a seat
    // you can see is a seat somebody could be sitting in.
    let ns = 0;
    for (let r = 0; r < W.rows; r++) {
      const z = rowZ(r), y = floorY(z) + 0.90;
      const near = 1 - clamp(r / 9);
      const plate = 1 - smoothstep(0.05, 0.30, cold);
      const aRow = (0.022 + 0.048 * near) * lift;
      for (const [x0, x1] of [[-W.seatHW, W.aisle[0] - W.aisleW], [W.aisle[0] + W.aisleW, W.aisle[1] - W.aisleW], [W.aisle[1] + W.aisleW, W.seatHW]]) {
        if (x1 - x0 < 0.05) continue;
        seg([x0, y, z], [x1, y, z], aRow, near > 0.5 ? 1.2 : 1);
      }
      if (r > 6) continue;
      // Filled seat backs, not wire squares: a wire square at this distance is
      // a maze, a dark plate is furniture. Every other seat, so the row reads
      // as a row of seats and not as a wall.
      const step = r > 2 ? 3 : 1;
      for (let i = 0; i < W.seats; i += step) {
        if (isAisle(i)) continue;
        const x = seatX(i);
        ns = writeInstance(this.seatData, ns, {
          p: [x, floorY(z) + 0.52, z], s: 1, c: lineCol,
          a: (0.025 + 0.085 * near * (0.25 + 0.75 * warm) * (0.4 + 0.6 * beam)) * lift * plate,
          scale: [step === 1 ? 0.40 : 0.36, 0.24 + 0.06 * near, 1],
        });
      }
    }
    // the plate in the dark that everything in this room is pointed at
    let kf = 0;
    kf = writeInstance(this.faceData, kf, {
      p: [0, W.screenY, W.screenZ], s: 1, c: rgb("tealDeep"),
      a: 0.18 + 0.24 * warm, scale: [W.screenHW, W.screenHH, 1],
    });
    // After the picture has died the plate keeps one cold afterglow: a screen
    // that has been lit for years does not go to nothing in one second, and an
    // auditorium this big cannot be allowed to read as a void.
    if (cold > 0.05) {
      kf = writeInstance(this.faceData, kf, {
        p: [0, W.screenY, W.screenZ], s: 1, c: rgb("ash"),
        a: 0.020 * cold, scale: [W.screenHW * 0.92, W.screenHH * 0.88, 1],
      });
    }
    // the working light over the empty seat, once the memory is cold
    // No working light comes up on the empty seat: the point of the ending is
    // that nothing comes to look at it. The seat is only the seat that is left.
    this.seatLight = null;

    // The air (grammar 7). The hall is 62 m deep and the screen sits 33 m from
    // the last row: without the falloff the far end of the room is drawn at
    // the same weight as the seat in front of the lens, and the room reads as
    // a backdrop. The screen keeps its own, much longer falloff -- it is the
    // light source of this chapter, not one of its surfaces.
    const AIR = { eye, fog: { dist: 120, c: rgb("ink") } };
    const SCREEN_AIR = { eye, fog: { dist: 420, c: rgb("ink") } };
    this.arch.update(this.archData, n).render(out, { ...AIR, vp: this.vp, opacity: 1 });
    this.seats.update(this.seatData, ns).render(out, { ...AIR, vp: this.vp, opacity: 1 });
    this.faces.update(this.faceData, kf)
      .render(out, { ...SCREEN_AIR, vp: this.vp, opacity: 1, soft: 0.4 });

    // and the screen's rectangle on the page, so the 2D layer can lay a
    // picture onto the same plane the room draws
    const tl = project(this.vp, [-W.screenHW, sy1, W.screenZ], this.ctx.W, this.ctx.H);
    const br = project(this.vp, [W.screenHW, sy0, W.screenZ], this.ctx.W, this.ctx.H);
    this.screen = [tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]];
  }

  // ---- the beam, as an object (step 60) ------------------------------------
  //
  // Four corners, a 0.35 m gate at the lamp, the 26.2 x 14.1 m screen at the
  // far end, and 14 cross-sections of air between them. Everything here is in
  // room metres, so the panel can print the throw and the spread as the same
  // numbers the frustum was built from -- and when the beam dies on "I cannot
  // feel anything", the room loses its measure, not a decoration.
  beamPass(out, { warm, beam }) {
    const W = this.ctx.W, H = this.ctx.H;
    const B = this.beam;
    const [lx, ly, lz] = B.lamp;
    const cx = 0, cy = HALL.screenY, cz = HALL.screenZ;
    const dx = cx - lx, dy = cy - ly, dz = cz - lz;
    const throwM = B.throwM;
    const dir = B.dir;
    const half0 = BEAM.aperture / 2;
    const halfW = HALL.screenHW, halfH = HALL.screenHH;
    const warmMix = 0.35 + 0.65 * warm;
    // the lamp's own frame: `e1` across the barrel, `e2` up it
    const e1 = B.e1, e2 = B.e2;
    const rot = [Math.atan2(-dir[1], dir[2]), 0, 0];

    // what the panel is allowed to print: the gate and the wall, projected --
    // taken before the beam is allowed to die, because the room's measure does
    // not go away just because the light has
    const gp = project(this.vp, [
      lx + e1[0] * half0, ly + e1[1] * half0, lz + e1[2] * half0,
    ], W, H);
    const gc = project(this.vp, HALL.lamp, W, H);
    const w0 = project(this.vp, [-halfW, cy, cz], W, H);
    const w1 = project(this.vp, [halfW, cy, cz], W, H);
    this.qaBeam = {
      throwM: +throwM.toFixed(2),
      aperture: BEAM.aperture,
      screenW: +(halfW * 2).toFixed(1),
      screenH: +(halfH * 2).toFixed(1),
      spread: +((halfW * 2) / BEAM.aperture).toFixed(1),
      sections: BEAM.sections,
      motes: this.beamMotes,
      motesOut: this.beamMotesOut || 0,
      beam: +beam.toFixed(3),
      nearPx: +Math.hypot(gp[0] - gc[0], gp[1] - gc[1]).toFixed(1),
      farPx: +Math.abs(w1[0] - w0[0]).toFixed(1),
    };
    if (beam < 0.01) return;

    // the air between the gate and the screen: a cone that can be counted
    let nc = 0;
    for (let i = 0; i < BEAM.sections; i++) {
      const u = (i + 0.5) / BEAM.sections;
      const hw = half0 + (halfW - half0) * u;
      const hh = half0 + (halfH - half0) * u;
      nc = writeInstance(this.coneData, nc, {
        p: [lx + dx * u, ly + dy * u, lz + dz * u],
        s: 1, c: rgb("amber"),
        a: 0.019 * beam * warmMix * Math.pow(1 - u, 0.80),
        r: rot, scale: [hw, hh, 1],
      });
    }
    this.beamCone.update(this.coneData, nc)
      .render(out, { vp: this.vp, soft: 1, opacity: 1 });

    // the four corners, the gate, and the iris: an instrument, not a glow
    let nb = 0;
    const seg = (p0, p1, a) => {
      const sx = p1[0] - p0[0], sy = p1[1] - p0[1], sz = p1[2] - p0[2];
      const L = Math.hypot(sx, sy, sz) || 1;
      const d = [sx / L, sy / L, sz / L];
      nb = writeInstance(this.beamData, nb, {
        p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2],
        c: rgb("amber"), a,
        r: [Math.asin(clamp(d[2], -1, 1)), 0, Math.atan2(-d[0], d[1])],
        scale: [1, L / 2, 1],
      });
    };
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        seg(
          [lx + e1[0] * sx * half0 + e2[0] * sy * half0,
            ly + e1[1] * sx * half0 + e2[1] * sy * half0,
            lz + e1[2] * sx * half0 + e2[2] * sy * half0],
          [sx * halfW, cy + sy * halfH, cz],
          0.16 * beam * warmMix,
        );
      }
    }
    const gate = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const a0 = gate[i], a1 = gate[(i + 1) % 4];
      seg(
        [lx + e1[0] * a0[0] * half0 + e2[0] * a0[1] * half0,
          ly + e1[1] * a0[0] * half0 + e2[1] * a0[1] * half0,
          lz + e1[2] * a0[0] * half0 + e2[2] * a0[1] * half0],
        [lx + e1[0] * a1[0] * half0 + e2[0] * a1[1] * half0,
          ly + e1[1] * a1[0] * half0 + e2[1] * a1[1] * half0,
          lz + e1[2] * a1[0] * half0 + e2[2] * a1[1] * half0],
        0.42 * beam,
      );
    }
    const TAU = Math.PI * 2;
    for (let i = 0; i < BEAM.iris; i++) {
      const a0 = (i / BEAM.iris) * TAU, a1 = ((i + 1) / BEAM.iris) * TAU;
      const R = half0 * 2.1;
      seg(
        [lx + e1[0] * Math.cos(a0) * R + e2[0] * Math.sin(a0) * R,
          ly + e1[1] * Math.cos(a0) * R + e2[1] * Math.sin(a0) * R,
          lz + e1[2] * Math.cos(a0) * R + e2[2] * Math.sin(a0) * R],
        [lx + e1[0] * Math.cos(a1) * R + e2[0] * Math.sin(a1) * R,
          ly + e1[1] * Math.cos(a1) * R + e2[1] * Math.sin(a1) * R,
          lz + e1[2] * Math.cos(a1) * R + e2[2] * Math.sin(a1) * R],
        0.30 * beam,
      );
    }
    this.beamEdge.update(this.beamData, nb)
      .render(out, { vp: this.vp, opacity: 1 });
  }

  // ---- the dust the beam is made visible by --------------------------------
  motePass(c, { t, beam, warm }) {
    const [lx, ly, lz] = HALL.lamp;
    const cx = 0, cy = HALL.screenY, cz = HALL.screenZ;
    const sprite = offscreen(c, 64, 64, "memory-mote");
    if (!sprite.canvas._done) {
      const g = sprite.ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(240,169,78,0.95)");
      g.addColorStop(0.45, "rgba(240,169,78,0.22)");
      g.addColorStop(1, "rgba(240,169,78,0)");
      sprite.ctx.fillStyle = g;
      sprite.ctx.fillRect(0, 0, 64, 64);
      sprite.canvas._done = true;
    }
    c.save();
    c.globalCompositeOperation = "lighter";
    const k = (this.ctx.H / 2) / Math.tan(HALL.fov / 2);
    let seen = 0, out = 0;
    for (const m of this.motes) {
      const u = (m.u + t * m.drift) % 1;
      // dust in the beam, not dust near one: the mote's offsets are a fraction
      // of the cone at the u it is at *this* frame, so the check below cannot
      // pass on a mote that has drifted out of the light
      const half0 = BEAM.aperture / 2;
      const hw = half0 + (HALL.screenHW - half0) * u;
      const hh = half0 + (HALL.screenHH - half0) * u;
      const ox = lx + (cx - lx) * u, oy = ly + (cy - ly) * u, oz = lz + (cz - lz) * u;
      const px = ox + m.af * hw * this.beam.e1[0] + m.bf * hh * this.beam.e2[0];
      const py = oy + m.af * hw * this.beam.e1[1] + m.bf * hh * this.beam.e2[1];
      const pz = oz + m.af * hw * this.beam.e1[2] + m.bf * hh * this.beam.e2[2];
      const pr = project(this.vp, [px, py, pz], this.ctx.W, this.ctx.H);
      if (pr[2] <= 0.2) continue;
      const r = Math.max(0.6, (m.size * 0.010 * k) / pr[2]);
      if (pr[0] < -60 || pr[0] > this.ctx.W + 60 || pr[1] < -60 || pr[1] > this.ctx.H + 60) continue;
      seen++;
      // and the check is on the point that was actually drawn, against the
      // aperture and the screen the panel prints
      const d1 = (px - ox) * this.beam.e1[0] + (py - oy) * this.beam.e1[1] + (pz - oz) * this.beam.e1[2];
      const d2 = (px - ox) * this.beam.e2[0] + (py - oy) * this.beam.e2[1] + (pz - oz) * this.beam.e2[2];
      if (Math.abs(d1) > hw + 1e-6 || Math.abs(d2) > hh + 1e-6) out++;
      const flick = 0.55 + 0.45 * Math.sin(t * 1.7 + m.phase);
      // the motes belong to the same air as the room: the far end of the beam
      // is dimmer than the near end, so the cone reads as a length
      const haze = Math.exp(-pr[2] / 130);
      c.globalAlpha = clamp(0.10 * flick * beam * (0.35 + 0.65 * warm)) * haze;
      c.drawImage(sprite.canvas, pr[0] - r, pr[1] - r, r * 2, r * 2);
    }
    this.beamMotes = seen;
    this.beamMotesOut = out;
    c.restore();
  }

  // ---- what the screen is playing ------------------------------------------
  // A performance from before the record started: the stage, her, the lights
  // of the people who came, and -- under all of it -- her voice as a perfect
  // sine drawn over the real one. The memory is the ideal version; the tape is
  // the true one.
  program(c, { t, f, warm, cold }) {
    const [x, y, w, h] = this.screen;
    if (w < 4 || h < 4) return;
    const gy = 0.62;                            // the stage line
    const gate = 0.12 + 0.88 * (1 - smoothstep(0.05, 0.75, cold));
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    // the screen's own surface: dark, warmer at the centre
    const bg = c.createRadialGradient(x + w / 2, y + h * 0.45, 0, x + w / 2, y + h * 0.45, w * 0.7);
    bg.addColorStop(0, css("amber", 0.10 * gate));
    bg.addColorStop(0.55, css("ink2", 0.10));
    bg.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = bg;
    c.fillRect(x, y, w, h);

    const sh = h * gy;
    // the audience of that night: penlights, in rows, every one of them amber
    for (let r = 0; r < 7; r++) {
      const ry = y + h * (0.70 + r * 0.042);
      const spread = 0.30 + r * 0.10;
      for (let i = 0; i < 26; i++) {
        const u = (i + 0.5) / 26;
        const ph = hash(i * 3.1 + r * 9.7);
        const a = (0.10 + 0.55 * ph) * gate * warm;
        const lx = x + w * (0.5 + (u - 0.5) * 2 * spread);
        const ly = ry + Math.sin(t * 1.7 + ph * 6.0) * h * 0.006;
        c.fillStyle = css("amber", a);
        c.fillRect(lx - w * 0.0035, ly - h * 0.020, w * 0.007, h * 0.030);
      }
    }
    // the stage: a lip and a floor, then her, singing under one light
    c.strokeStyle = css("amber", 0.30 * gate);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x, y + sh);
    c.lineTo(x + w, y + sh);
    c.stroke();
    const spot = c.createLinearGradient(0, y, 0, y + sh);
    spot.addColorStop(0, css("amber", 0.075 * gate));
    spot.addColorStop(1, css("amber", 0));
    c.fillStyle = spot;
    c.beginPath();
    c.moveTo(x + w * 0.485, y);
    c.lineTo(x + w * 0.515, y);
    c.lineTo(x + w * 0.62, y + sh);
    c.lineTo(x + w * 0.38, y + sh);
    c.closePath();
    c.fill();
    // the house behind her, in two lines: a truss and the far wall
    c.strokeStyle = css("amber", 0.13 * gate);
    c.beginPath();
    c.moveTo(x, y + h * 0.10);
    c.lineTo(x + w, y + h * 0.10);
    c.moveTo(x + w * 0.06, y + h * 0.10);
    c.lineTo(x + w * 0.02, y + sh);
    c.moveTo(x + w * 0.94, y + h * 0.10);
    c.lineTo(x + w * 0.98, y + sh);
    c.stroke();
    c.save();
    c.globalAlpha = 0.55 + 0.45 * warm;
    singer(c, x + w * 0.5, y + sh + h * 0.012, sh * 0.52, {
      t,
      // She is the last thing on the screen and the last thing to lose its
      // colour: the performance goes grey, the person stays.
      alpha: (0.30 + 0.55 * gate) * (0.55 + 0.45 * warm),
      mouth: 0.18 + 0.5 * f.a.vocal,
      light: 0.30 + 0.55 * warm,
      color: warm > 0.5 ? css("amber", 0.85) : css("ash", 0.80),
      accent: warm > 0.5 ? css("amber", 0.95) : css("bone", 0.75),
      deep: css("redDeep", 0.55),
      seed: 5,
    });
    c.restore();

    // the voice: a perfect sine with the real waveform underneath it
    const wy = y + h * 0.925, wh = h * 0.10;
    c.save();
    c.globalAlpha = 0.40 * gate * warm;
    c.strokeStyle = css("amber", 0.85);
    c.lineWidth = 1.1;
    c.beginPath();
    for (let i = 0; i <= w; i += 3) {
      const u = i / w;
      // The remembered voice is a perfect sine. When she stops feeling
      // anything it does not fade -- it flattens, which is what "I cannot feel
      // anything" looks like when it happens to a waveform.
      const flat = 0.14 + 0.86 * (1 - cold);
      const py = wy - Math.sin(u * Math.PI * 9) * wh * 0.34 * (0.6 + 0.4 * f.a.rms) * flat;
      if (i === 0) c.moveTo(x + i, py);
      else c.lineTo(x + i, py);
    }
    c.stroke();
    c.restore();
    wave(c, f.F, t, {
      x, y: wy - wh * 0.5, w, h: wh, span: 4.0, lw: 1.2,
      color: css("amber", (0.20 + 0.45 * warm) * gate), amp: 1.0,
    });

    // the tape's own overlay, in the machine's voice: this is a recording,
    // even here, and the film never lets us forget it
    label(c, "ARCHIVE 0001  \u2014  SINGING  was  FUN", x + 14, y + 26, {
      size: 15, tracking: 2, color: css("amber", (0.55 + 0.35 * warm) * gate),
    });
    // on its own line: the archive's title runs the full width of the plate,
    // and two machine labels sharing one baseline is the kind of collision a
    // projector would be repaired for
    label(c, `PLAYBACK 1.000   FEELING ${warm >= 0.995 ? "-0.00" : cold.toFixed(2)}`,
      x + w - 14, y + 48, {
        size: 15, tracking: 2, align: "right",
        color: cold > 0.5 ? css("red", 0.7) : css("amber", (0.55 + 0.3 * warm) * gate),
      });
    label(c, "RECONSTRUCTED FROM MEMORY \u2014 NO SOURCE FILE", x + 14, y + h - 14, {
      size: 14, tracking: 2, color: css("ash", 0.42 * gate),
    });
    // a projected picture is darkest at its corners; without this the screen
    // reads as a panel of UI hanging in the dark instead of an image on a wall
    const vig = c.createRadialGradient(x + w / 2, y + h / 2, h * 0.30, x + w / 2, y + h / 2, w * 0.62);
    vig.addColorStop(0, "rgba(5,7,10,0)");
    vig.addColorStop(1, css("ink", 0.62));
    c.fillStyle = vig;
    c.fillRect(x, y, w, h);
    c.restore();
  }

  dispose() {
    this.arch.dispose();
    this.seats.dispose();
    this.faces.dispose();
  }
}
