// 2:57.7 - chorus 2. The picture itself is being abraded: edges rot inward,
// memory peels off in strips, and the second emergency stop breaks the frame
// into macroblocks.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import {
  clamp, hash, label, lyricLine, machineChrome, panel, smoothstep, specBars, wave,
} from "../kit.js";
import { listener, motifLabel, singer } from "../motifs.js";
import { beatAt } from "../semantics.js";
import {
  CamRig, Stage3D, camera, mat4, project, rgb, samplePoints, writeInstance,
} from "../gl3d.js";
import { HEAD, aimAt, writeBay, writeHeadRing, writeRecord } from "../head.js";
import { draw as drawText, font, layout, measure, pad } from "../type.js";
import { audioU, lastLine, layer } from "./util.js";

// The heart this chapter shaves away: nine cross-sections of one heart
// implicit, stacked front to back and each a little smaller than the one in
// front of it. Cutting into the volume exposes a *smaller* heart every time --
// the section the blade leaves is the picture of what is gone.
//
// Each layer is stored twice. `outline` is ray-marched around the implicit, so
// its points are evenly spaced along the contour and the stack reads as nested
// heart outlines -- a solid being sliced -- instead of a grid of dots.
// `fill` is a coarse interior, drawn only where the blade has left a face, so
// the exposed section is the one thing in the shot that is solid light.
const HEART_LAYERS = 9;
const HEART_Z0 = 0.46, HEART_Z1 = -0.92;
const HEART_RING = 176;
const HEART_FILL_STEP = 0.070;

// The chapter's own zero, and the frame the heart shot is locked to: the lens
// ends its orbit at these two points, and the dolly may only ride the axis they
// define.
const ERODE_T0 = 177.69;
const HEART_EYE0 = [0.60, 0.70, 4.60];
const HEART_AT0 = [0.60, 0.35, 0];
// Where the 1.00 m ruler is hung: 1.62 m down the focal plane's own "up", so
// the bar sits under the section on screen and still lies exactly in the one
// plane the dolly keeps still.
const RULER_U = -1.62;

// Everything the dolly needs: the unit view direction, the point where it
// crosses the plane of the last surviving section, the distance from the
// pre-stop lens to that point, and `k = d * tan(fov/2)` -- the one number the
// move is not allowed to change, because it *is* the subject's size.
function erodeAxis() {
  const d = [HEART_AT0[0] - HEART_EYE0[0], HEART_AT0[1] - HEART_EYE0[1], HEART_AT0[2] - HEART_EYE0[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  const v = [d[0] / L, d[1] / L, d[2] / L];
  const t = (HEART_EYE0[2] - HEART_Z1) / -v[2];       // m along v to z = HEART_Z1
  const anchor = [
    HEART_EYE0[0] + v[0] * t,
    HEART_EYE0[1] + v[1] * t,
    HEART_EYE0[2] + v[2] * t,
  ];
  // The lens's own "up": world up with the axis taken out of it. Every point
  // in `anchor + s * right + u * up` is at exactly the same view depth, which
  // is what makes the ruler a measurement and not a decoration.
  const uy = 1 - v[1] * v[1];
  const up = [0, uy, -v[1] * v[2]];
  const uL = Math.hypot(up[0], up[1], up[2]);
  up[0] /= uL; up[1] /= uL; up[2] /= uL;
  return { v, anchor, d0: t, k: t * Math.tan(DOLLY.fov0 / 2), up, right: [1, 0, 0] };
}

// The wall body is sampled on a 250 x 344 canvas; the figure is 1.62 m tall in
// the bay (step 58), so the sample's own aspect is what decides how wide she
// is in metres. Read straight off the canvas the figure comes out 1.376x too
// wide and reads as a dome instead of a person, and WALL_SX is the factor that
// puts her proportions back (it carries the old 1.04 correction with it).
const WALL_SAMPLE_W = 250, WALL_SAMPLE_H = 344;
const WALL_SX = 1.04 * (WALL_SAMPLE_W / WALL_SAMPLE_H);

const heartK = (u) => 1 - 0.16 * u;
const heartF = (x, y, k) => {
  const X = x / k, Y = y / k;
  const g = X * X + Y * Y - 1;
  return g * g * g - X * X * Y * Y * Y;
};

function buildHeart(layers = HEART_LAYERS) {
  const outline = [], fill = [];
  for (let l = 0; l < layers; l++) {
    const u = layers === 1 ? 0 : l / (layers - 1);   // 0 = front, 1 = back
    const z = HEART_Z0 + (HEART_Z1 - HEART_Z0) * u;
    const k = heartK(u);
    // the contour: one point per equal angle, found by bisecting the implicit
    for (let i = 0; i < HEART_RING; i++) {
      const a = (i / HEART_RING) * Math.PI * 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      let lo = 0, hi = 2.2;
      for (let s = 0; s < 22; s++) {
        const mid = (lo + hi) / 2;
        if (heartF(dx * mid, dy * mid, k) <= 0) lo = mid; else hi = mid;
      }
      const r = (lo + hi) / 2;
      outline.push({
        x: dx * r, y: dy * r, z, l,
        r: hash(i * 3.77 + l * 13.1),
      });
    }
    // the interior, coarse: this is what a cut exposes and what falls as a
    // sheet, so it only has to carry area, not edges
    for (let gx = -1.30; gx <= 1.301; gx += HEART_FILL_STEP) {
      for (let gy = -1.20; gy <= 1.241; gy += HEART_FILL_STEP) {
        if (heartF(gx, gy, k) > 0) continue;
        fill.push({
          x: gx, y: gy, z, l,
          r: hash(gx * 91.7 + gy * 47.3 + l * 13.1),
        });
      }
    }
  }
  return { outline, fill };
}

const FRAG = `
uniform float uT;
uniform float uVocal;
uniform float uLow;
uniform float uKick;
uniform float uErode;    // 0 -> 1 across the section
uniform float uStop;     // emergency stop
uniform float uDrop;     // and what it drops: the picture, in blocks
in vec2 vUv;

float noise(vec2 p) { return fbm(p * 3.0 + vec2(uT * 0.07, uT * 0.05)); }

void main() {
  vec2 uv = vUv;
  vec3 col = C_INK;

  // the frame is eaten from its edges inward
  vec2 d = min(uv, 1.0 - uv);
  float edge = min(d.x * 1.7, d.y);
  float n = noise(uv * vec2(5.0, 3.4));
  float eaten = smoothstep(edge * (5.0 - 3.4 * uErode), 0.0, n) ;
  float mask = smoothstep(0.02, 0.22, edge + n * 0.35 - uErode * 0.30);

  // what is left of the voice
  col += C_TEAL_DEEP * 0.10 * mask * (0.4 + uVocal);
  col += C_MIKU * 0.07 * uLow * exp(-pow((uv.y - 0.05) * 8.0, 2.0)) * mask;
  col += C_MIKU_HI * 0.06 * uKick * exp(-pow((uv.y - 0.5) * 26.0, 2.0)) * mask;

  // rot: vertical grain that widens as the picture is consumed
  float grain = hash21(vec2(floor(uv.x * 240.0), floor(uv.y * 60.0) + floor(uT * 7.0)));
  col *= 1.0 - smoothstep(0.6, 0.62, grain) * uErode * 0.5;
  col *= 1.0 - eaten * 0.9;

  // Emergency stop. The first one flooded the hall with red; this one is the
  // system having stopped caring -- the picture simply drops out in blocks,
  // and the only red left is the seam where a block used to be. The first stop
  // was a alarm; this one is an execution.
  //
  // The two are now separate events. uStop is the actuation: the device
  // fires and the frame admits it has a grid. uDrop is what happens after
  // the lens has taken the room's depth away -- first the space becomes a
  // picture, then the picture becomes blocks. (Step 48.)
  vec2 blk = floor(uv * vec2(24.0, 14.0));
  float dead = step(1.0 - uDrop * 0.55, hash21(blk + 7.7));
  vec2 f = fract(uv * vec2(24.0, 14.0));
  // The seam is a hairline. At 0.055 of a cell it was a 4 px band that bloomed
  // into a red net and ate the whole shot (step 48, first pass); the grid has
  // to be readable as *cells* and stay out of the way of the lens.
  float seam = 1.0 - smoothstep(0.0, 0.020, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
  col *= 1.0 - dead * 0.96;
  // Two colours, because there are two events. The machine's own grid comes up
  // in bone when the device fires -- the frame admitting it is a grid -- and the
  // red is only ever the *cut* between two blocks, i.e. only where something
  // has actually been taken away.
  col += C_ASH * uStop * seam * 0.050;
  col += C_RED * seam * dead * 0.30;
  col += C_RED * 0.022 * uStop * exp(-pow((uv.y - 0.5) * 3.0, 2.0));
  fragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------
// The depth bay: the room the section was always standing in, switched on by
// the second emergency stop. Six measured rings, 1.20 m apart, standing behind
// the surviving section.
//
// Nothing in this bay moves -- not one ring, not one metre. The only thing
// that moves in the whole shot is the lens: it rides 8.00 m back along its own
// optical axis while tan(fov/2) falls by exactly the same factor, so a metre
// at the section's plane keeps its size (212.7 px at 1080p) and every plane
// *behind* it is pulled towards it. The readings in the panel are not captions
// for that -- they are the projection of these six rings, taken every frame:
//
//   rail            5.54 m -> 13.54 m   (8.00 m of travel, 6.15 m/s)
//   lens vertical   49.3 deg -> 21.2 deg
//   a metre at the section   212.69 px -> 212.69 px   (locked)
//   the far ring    378.6 px -> 552.0 px   (+45.8 %)
//   the near ring   766.6 px -> 790.7 px   (+3.1 %, it sits 0.28 m back)
//
// A finite dolly can only pull a *finite* room flat: 40 % of this room's depth
// is taken away by the lens alone, and the last of it would need an infinite
// rail. So the bay is built 6.00 m deep -- deep enough that 40 % is the
// difference between a corridor and a plate, and the panel prints the growth
// of the far ring rather than a ratio that pretends to reach 1.000.
const BAY = {
  rings: 6,
  pitch: 1.20,        // m between rings
  zNear: -1.20,       // the first ring, 0.28 m behind the surviving section
  half: 1.90,         // m, half the ring's width and height
  rail: 0.030,        // m, half the thickness of a rail
  node: 0.058,        // m, half the size of a corner node
  air: 42,            // m, the distance at which the room's air is ~63% ink
};
const BAY_FAR = BAY.zNear - (BAY.rings - 1) * BAY.pitch;
const BAY_ZMID = (BAY.zNear + BAY_FAR) / 2;
const BAY_HALFLEN = (BAY.zNear - BAY_FAR) / 2;

// The move, in the chapter's own seconds. The relay closes (2 beats), the rail
// runs at a constant 6.15 m/s -- a servo, not a hand -- and then the picture
// drops out. Total 1.76 s: exactly the length of the `緊急停止装置作動` marker.
const DOLLY = {
  fov0: 0.86,         // rad, the lens before the stop
  back: 8.00,         // m of rail travel, along the optical axis
  arm: 0.06,          // s after the stop before the relay pulls
  armDur: 0.22,       // s for the rings to switch on
  rail: 0.28,         // s after the stop when the rail starts
  railDur: 1.30,      // s for 8.00 m of travel
  drop: 1.33,         // s after the stop when the blocks begin to fall
  dropDur: 0.42,      // s until 55% of them are gone
};

// What the far ring measures through the *pre-stop* lens, computed rather than
// remembered: it is the denominator of the one reading the panel shows growing
// (FAR RING +45.8 %), so it has to come from the same two points the shot is
// built on. Taken once, at module load, from HEART_EYE0 / HEART_AT0.
const BAY_REF_FAR_PX = (() => {
  const vp = mat4();
  camera(vp, {
    eye: HEART_EYE0, at: HEART_AT0, fov: DOLLY.fov0, near: 0.1, far: 60, aspect: 1920 / 1080,
  });
  const a = project(vp, [-BAY.half, 0, BAY_FAR], 1920, 1080);
  const b = project(vp, [BAY.half, 0, BAY_FAR], 1920, 1080);
  return Math.abs(b[0] - a[0]);
})();

// ---------------------------------------------------------------------------
// The abrasion bay (step 58).
//
// The first shot of this chapter used to be a flat cloud of points on a
// locked-off lens: the erosion was there, the *room* was not, and a person
// coming apart read as a particle demo. It is now the chamber that printed her
// in `birth`, run backwards. `birth` runs a print head down her silhouette
// from above; here a read head climbs from the floor at a servo's rate, and
// every point it has passed is already gone -- taken, drifting down, and
// written into the floor as a cell of the record.
//
// She is 1.62 m. The chamber is 13.20 m of ribs on a 7.20 m radius, so the
// machine is 8.1 of her tall; the lens makes one arc from a shoulder-high
// 3.4 m to a 6.8 m crane 11 m off the axis, and she stays on the same place in
// the frame at every key. Nothing else in the room moves: the rails below the
// head carry light because they have been read, and the rails above it are
// dark structure.
const HERO_H = 1.62;
// The bay is HEAD-01 (src/head.js): the same drawing `birth` prints with,
// read here in the opposite direction. `erode` keeps only the numbers that
// are its own.
const CHAMBER = HEAD;

// The rig's own keys: eye, lens, and where in the frame she has to stand.
// 0.60 of the width at every key, sinking from 0.58 to 0.68 of the height as
// the room grows over her.
const BAY_KEYS = [
  { u: 0.00, ease: "smooth", eye: [2.70, 2.30, 3.60], fov: 0.74, sx: 0.60, sy: 0.60 },
  { u: 0.40, ease: "smooth", eye: [3.30, 3.20, 4.60], fov: 0.78, sx: 0.60, sy: 0.62 },
  { u: 0.74, ease: "smooth", eye: [2.40, 5.00, 7.60], fov: 0.82, sx: 0.60, sy: 0.64 },
  { u: 1.00, ease: "lin", eye: [1.20, 7.60, 11.40], fov: 0.86, sx: 0.60, sy: 0.68 },
];

export default class Erode extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "erode");
    this.stopLine = null;

    // Two bodies, drawn as points. `wall` is the whole figure, which this
    // chapter eats from its edges inward until only the head is left; `bust`
    // is the same figure cut off at the hem with both hands brought together,
    // which is what kneeling behind the bottom of the frame looks like when
    // there is no floor to kneel on.
    this.vp = mat4();
    this.wallFill = new Stage3D(ctx, "point");
    this.wallLine = new Stage3D(ctx, "point");
    this.heartFill = new Stage3D(ctx, "point");
    this.heartOut = new Stage3D(ctx, "point");
    this.spoke = new Stage3D(ctx, "segment");
    this.blade = new Stage3D(ctx, "rect");
    this.bay = new Stage3D(ctx, "rect");
    this.chamber = new Stage3D(ctx, "segment");
    this.readHead = new Stage3D(ctx, "rect");
    this.record = new Stage3D(ctx, "rect");
    this.wallPts = null;
    this.wallFillData = null;
    this.wallLineData = null;
    const heart = buildHeart();
    this.heartFillPts = heart.fill;
    this.heartOutPts = heart.outline;
    this.heartFillData = new Float32Array(heart.fill.length * 16);
    this.heartOutData = new Float32Array(heart.outline.length * 16);
    this.spokeData = new Float32Array(48 * 16);
    this.bladeData = new Float32Array(8 * 16);
    // 6 rings x (4 rails + 4 nodes) + 4 long rails = 52, with room to spare.
    this.bayData = new Float32Array(72 * 16);
    // 24 ribs x 8 bands + 8 rings x 36 segments + 24 spokes + the head's ring.
    this.chamberData = new Float32Array(560 * 16);
    this.headData = new Float32Array(8 * 16);
    this.recordData = new Float32Array((CHAMBER.marks + 8) * 16);
    // The chamber's own camera: four composed keys, an arc, no frame cost.
    this.rig = new CamRig(BAY_KEYS.map((k) => ({
      u: k.u, ease: k.ease, eye: k.eye, fov: k.fov, roll: 0,
      at: aimAt(k.eye, k.fov, k.sx, k.sy, [0, HERO_H / 2, 0]),
    })));
    this.lastCamBody = null;
    this.qaAbrasion = null;
    // the abrasion probe (tools/abrasion-probe.mjs) turns this on to get the
    // drawn point cloud's box back; the film's own frames never do
    this.qaWantBody = false;
    this.qaBody = null;
    this.heartTag = null;
    this.rulerTag = null;
    this.cutCount = 0;
    this.wallTag = null;
    this.wallA = 0;      // how much of the frame the point-cloud body owns
    this.heartA = 0;     // and how much the cut-open heart owns
    this.stopLocal = 30.22;   // resolved from the lyric in init()
    this.lastCam = null;
    this.qaDepth = null;
    this.bayOn = 0;
    // The optical axis of the locked frame, taken from the same two points the
    // heart shot is built on -- so the axis and the camera can never drift
    // apart. The anchor is where that axis crosses the plane of the section
    // the blade leaves behind, which is the one plane the dolly keeps still.
    this.axis = erodeAxis();
  }

  async init() {
    this.stopLine = lastLine(this.ctx.features, "\u7dca\u6025\u505c\u6b62\u88c5\u7f6e\u4f5c\u52d5");
    this.stopLocal = this.stopLine.start - ERODE_T0;

    // Two samplings of the same figure, from two weights of the same drawing.
    // One fat sampling turns a person into weather: the strokes merge, the
    // silhouette fills in, and what erodes is a cloud. One thin sampling has
    // no volume to lose. So the wall is sampled twice -- the line art is a
    // hairline (bright, and the last thing to go), the volume is a fattened
    // stroke that really is solid.
    this.wallLinePts = samplePoints((c, w, h) => {
      singer(c, w / 2, h * 0.995, h * 0.98, {
        alpha: 1, color: "#ffffff", accent: "#ffffff", deep: "#7d7d7d", glow: false,
        lw: Math.max(1.0, h * 0.013),
      });
    // The contour is sampled *sparsely* on purpose: a thousand bright points,
    // with air between them, read as a drawn line. Cramming every stroke in
    // gives a smear -- which is exactly what a person stops looking like once
    // the picture is full of effect.
    //
    // The cut has to sit *below* the tails' own value. Her twin tails are the
    // silhouette's loudest sign, and the drawing fills them at 0.20 -> 0.26 ->
    // 0.03 alpha; sampling at the old 0.11 kept only their roots and left a
    // dome of points with legs under it, which is a mushroom, not a person.
    }, { w: WALL_SAMPLE_W, h: WALL_SAMPLE_H, max: 2600, cut: 0.055 });
    this.wallFillPts = samplePoints((c, w, h) => {
      singer(c, w / 2, h * 0.995, h * 0.98, {
        alpha: 1, color: "#ffffff", accent: "#ffffff", deep: "#4a4a4a", glow: false,
        // The volume pass used to be drawn at 3.6% of the figure's height. At
        // that weight every stroke of the drawing touches its neighbour, the
        // tails fuse with the dress, and the sampled body is a cocoon -- the
        // probe (tools/erode-probe.mjs) shows it as one solid white mass. Half
        // that weight still carries the interior, and keeps the silhouette's
        // shape: a narrow body with two tails flaring away from it.
        lw: Math.max(1.2, h * 0.019),
      });
    // Same floor for the volume, but a sparser one: since step 58 the volume
    // is a *shadow* of the drawing and the hairline does the reading. At 4,200
    // points the interior outshone the line art and she was a cocoon again.
    }, { w: WALL_SAMPLE_W, h: WALL_SAMPLE_H, max: 1800, cut: 0.130 });
    this.wallFillData = new Float32Array(this.wallFillPts.length * 16);
    this.wallLineData = new Float32Array(this.wallLinePts.length * 16);
  }

  render(f, out) {
    const t = f.t;
    const local = t - ERODE_T0;
    const erode = clamp(local / 29.0);
    // Actuation and dropout are two events now: the device fires, the lens
    // takes the room's depth away, and only then does the picture break.
    const stop = clamp((local - this.stopLocal) / 0.35);
    const drop = clamp((local - (this.stopLocal + DOLLY.drop)) / DOLLY.dropDur);
    this.pass.draw({ dst: out, u: audioU(f, { uErode: erode, uStop: stop, uDrop: drop }) });
    this.bodyPass(out, f, local);
    this.heartPass(out, f, local);
    this.depthPass(out, f, local);

    const c = this.text.ctx;
    this.text.clear();

    const bt = beatAt(f.F, t);
    const bid = bt ? bt.id : "";
    const bA = bt ? Math.min(bt.fresh, 1 - bt.exit) : 0;
    if (bid === "heart_shaved" && this.heartTag) {
      // The readout belongs to the heart in 3D, so it is pinned to the
      // projected section, not to a place on the screen: nine ticks, one per
      // cut, and the machine counts them as they are taken.
      const [hx, hy] = this.heartTag;
      const cuts = this.cutCount;
      const tx = Math.max(96, hx - 520);
      c.save();
      c.globalAlpha = 0.30 + 0.70 * bA;
      motifLabel(c, "HEART / SECTIONED IN DEPTH", tx, hy - 72, {
        color: css("miku", 0.85),
      });
      const ty = hy - 38;
      for (let i = 0; i < HEART_LAYERS; i++) {
        const taken = i < cuts;
        c.fillStyle = taken ? css("miku", 0.85) : css("dim", 0.45);
        c.fillRect(tx + i * 22, ty, taken ? 16 : 10, taken ? 7 : 3);
      }
      label(c, `SECTION ${String(Math.min(HEART_LAYERS, cuts)).padStart(2, "0")} / ${HEART_LAYERS}`, tx, ty + 30, {
        size: 15, tracking: 2, color: css("bone", 0.75),
      });
      label(c, `${Math.round((cuts / HEART_LAYERS) * 100)} % SHAVED`, tx + 232, ty + 30, {
        size: 15, tracking: 2, color: css("red", 0.8),
      });
      c.restore();
    }

    // The abrasion bay's own panel, pinned to the head in 3D: the machine's
    // measurement of her is drawn where the measurement is being taken. The
    // rule *is* her height -- 1.62 m -- with the head's line across it, and
    // the readings come off the same projection the room was drawn from.
    const qa = this.qaAbrasion;
    if (qa) {
      c.save();
      c.globalAlpha = (0.28 + 0.72 * clamp(this.wallA)) * (1 - clamp((local - 15.0) / 0.9));
      const [ax, ay] = qa.foot;
      const [bx, by] = qa.crown;
      const [hx0, hy0] = qa.headPx;
      c.strokeStyle = css("miku", 0.5);
      c.lineWidth = 1.3;
      c.beginPath();
      c.moveTo(ax, ay);
      c.lineTo(bx, by);
      for (let i = 0; i <= 8; i++) {
        const k = i / 8;
        const px = ax + (bx - ax) * k, py = ay + (by - ay) * k;
        const w = i % 4 === 0 ? 11 : 6;
        c.moveTo(px - w, py);
        c.lineTo(px + w, py);
      }
      c.stroke();
      // the head's own line across the rule
      c.strokeStyle = css("mikuHi", 0.95);
      c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(ax - 20, hy0);
      c.lineTo(hx0 + 20, hy0);
      c.stroke();
      c.restore();

      // pinned to the head, then clamped: a readout that leaves the page is a
      // readout nobody can read. (The chapter's own counters live bottom-right.)
      const tx = Math.min(qa.tag[0] + 18, this.ctx.W - 470);
      const ty = clamp(qa.tag[1], 230, 762);
      c.save();
      c.globalAlpha = (0.30 + 0.70 * clamp(this.wallA)) * (1 - clamp((local - 15.0) / 0.9));
      label(c, `ABRASION BAY / READ HEAD \u00b7 ${CHAMBER.serial}`, tx + 18, ty - 40, {
        size: 15, tracking: 2, color: css("miku", 0.9),
      });
      label(c, `HEIGHT  ${qa.head.toFixed(2)} m  /  ${HERO_H.toFixed(2)} m`, tx + 18, ty - 12, {
        size: 17, tracking: 1.4, color: css("bone", 0.95),
      });
      label(c, `CV-01 ON SCREEN  ${Math.round(qa.shePx)} px`, tx + 18, ty + 14, {
        size: 15, tracking: 1.4, color: css("ash", 0.9),
      });
      label(c, `RECORD  ${String(qa.cells).padStart(2, "0")} / ${CHAMBER.marks} CELLS`, tx + 18, ty + 40, {
        size: 15, tracking: 1.4,
        color: qa.cells >= CHAMBER.marks ? css("red", 0.9) : css("ash", 0.9),
      });
      // the same machine that printed her, with the two speeds side by side:
      // being born took a second and a half, being read away takes twelve
      label(c, `RATE  ${CHAMBER.readRate.toFixed(3)} m/s`, tx + 18, ty + 66, {
        size: 15, tracking: 1.4, color: css("bone", 0.92),
      });
      label(c, `PRINTED AT ${CHAMBER.printRate.toFixed(3)} m/s \u00b7 `
        + `\u00d7${(CHAMBER.printRate / CHAMBER.readRate).toFixed(1)} SLOWER`, tx + 18, ty + 92, {
        size: 15, tracking: 1.4, color: css("amber", 0.9),
      });
      c.restore();
    }

    const active = f.line;
    const isMarker = active && active.kind === "marker";

    // While the archive frame is on the right, the lyric narrows so the two
    // never fight for the same ink -- the page makes room for the photograph.
    const tight = smoothstep(15.2, 16.2, local) * (1 - smoothstep(24.4, 25.6, local));
    // And while a 3D body owns the frame, the words leave the middle of the
    // page: they rise into the header band, above the thing being taken apart.
    // The lyric and the object share one page, so one of them has to give.
    const focus = clamp(Math.max(this.wallA, this.heartA));
    const lyricY = 470 - 148 * smoothstep(0.10, 0.55, focus);
    const lyricSize = 92 - 10 * tight;
    const lyricMax = 1560 - 500 * tight;

    // lyric, with characters peeling away as they are sung
    if (active && !isMarker) {
      c.save();
      c.globalAlpha = 1 - clamp((t - active.end) / 0.8) * 0.7;
      lyricLine(c, active, t, f.F, {
        x: 96, y: lyricY, size: lyricSize, weight: 900, maxWidth: lyricMax,
        sung: css("bone", 0.98), dim: css("ash", 0.62),
      });
      c.restore();
      // peel: characters that have been sung drift off the line, dropping and
      // dimming. They have to leave from where the glyph really is, so this
      // uses the same layout the line above used -- ink and ghost must agree.
      const ci = active.ci || [];
      if (ci.length) {
        const raw = font(lyricSize, { weight: 900 });
        const adv = measure(c, active.text, raw);
        const size = adv > lyricMax
          ? Math.max(30, lyricSize * (lyricMax / adv)) : lyricSize;
        const L = layout(c, active.text, font(size, { weight: 900 }));
        for (let k = 0; k < ci.length; k++) {
          const i = ci[k];
          const gate = (k * 0.37 + active.start) % 1;
          if (gate > erode * 0.6 || i >= L.xs.length) continue;
          // A character peels once *it* has been sung, not once the line has
          // started, and it leaves from below the baseline: a peel that begins
          // on top of the ink is a double exposure, not a character falling.
          const cstart = active.ct && active.ct[k] != null ? active.ct[k] : active.start;
          const peel = clamp((t - cstart) / 1.4);
          if (peel < 0.5) continue;
          const drift = (peel - 0.5) / 0.5;
          c.save();
          c.globalAlpha = (1 - drift) * 0.34;
          c.fillStyle = css("ash", 0.8);
          c.font = font(size * (1 - drift * 0.40), { weight: 900 });
          c.fillText(active.text[i],
            96 + L.xs[i] + drift * 46 * Math.sin(k * 2.3),
            lyricY + 62 + drift * 168);
          c.restore();
        }
      }
    }

    // corridor of numbers: what erosion has cost so far
    //
    // One panel, two instruments. For twenty-nine seconds it counts what has
    // been taken off her. At the second stop the machine's last measurement is
    // not of her at all -- it is of the room, which it is about to take away.
    //
    // The hand-over is a *relabel*, not a cross-fade: each of the four rows is
    // overwritten once, on its own beat, and at no instant are two labels
    // asked to share the same line of paper. The first pass cross-faded the
    // two panels in place and printed a caption nobody could read -- a machine
    // does not double-expose its own readout. (Step 48.)
    const swapAt = (i) => (local - (this.stopLocal + DOLLY.arm + 0.06 + i * 0.05));
    const swapped = (i) => swapAt(i) > 0.010;
    const fresh = (i) => 1 - smoothstep(0.010, 0.150, swapAt(i));
    // what the ruler's own fade is tied to: the panel starts measuring the
    // room at its first relabelled row, not at its last
    const bayPanel = clamp((local - (this.stopLocal + DOLLY.arm + 0.06)) / 0.16);
    panel(c, 84, 620, 460, 260, {
      fill: css("ink2", 0.85), corner: 10,
      cornerColor: swapped(0) ? css("miku", 0.6) : css("red", 0.55), stroke: css("dim", 0.5),
    });
    c.save();
    c.globalAlpha = 1 - fresh(0) * 0.45;
    label(c, swapped(0) ? "DEPTH BAY / 2ND ACTUATION" : "DAMAGE REPORT", 100, 612, {
      size: 16, tracking: 1.8,
      color: swapped(0) ? css("miku", 0.95) : css("ash", 0.95),
    });
    c.restore();
    const q = this.qaDepth;
    // Row by row: what the chapter was counting, then what the lens is doing
    // about it. A row that has just been rewritten prints in bone for 0.15 s.
    const rows = [
      [
        ["SEGMENTS LOST", `${Math.floor(erode * 318)}`, css("bone", 0.88)],
        ["EYE \u2192 SECTION", q ? `${q.track.toFixed(2)} m` : "\u2014", css("bone", 0.88)],
      ],
      [
        ["MEMORY PEELED", `${(erode * 74.2).toFixed(1)} %`, css("bone", 0.88)],
        ["LENS  VERTICAL", q ? `${q.fovDeg.toFixed(1)}\u00b0` : "\u2014", css("bone", 0.88)],
      ],
      [
        ["HARMONICS", `${pad(Math.max(0, 64 - Math.floor(erode * 58)), 2)}`, css("bone", 0.88)],
        ["SCALE AT SECTION", q ? `${q.subjectPx.toFixed(1)} px/m` : "\u2014", css("miku", 0.92)],
      ],
      [
        ["VOICE", erode > 0.9 ? "\u2014" : "STILL HERE", css("miku", 0.9)],
        // the one number that says the room is coming forward: the far ring's
        // own width, against what the pre-stop lens measured it at
        ["FAR RING  vs LOCKED", q ? `+${(q.farGain * 100).toFixed(1)} %` : "\u2014",
          q && q.farGain >= 0.40 ? css("red", 0.95) : css("bone", 0.88)],
      ],
    ];
    for (let i = 0; i < rows.length; i++) {
      const bay = swapped(i);
      const [k, v, tint] = rows[i][bay ? 1 : 0];
      const y = 652 + i * 52;
      c.save();
      c.globalAlpha = 0.94;
      label(c, k, 104, y, { size: 16, color: css("ash", 0.85), tracking: 1.2 });
      // the ink a row is written with: its own tint, flashed to bone the
      // instant the machine rewrites it
      const ink = fresh(i) > 0.02 ? css("bone", 0.95) : tint;
      label(c, v, 520, y, { size: 18, align: "right", color: ink, tracking: 1.2 });
      c.restore();
    }

    // The ruler under her: 1.00 m of the section's own plane, projected. The
    // bay collapses by a factor of two around it and it does not move a pixel
    // -- which is the entire shot, drawn in one hairline. (Step 48.)
    if (this.rulerTag && bayPanel > 0.02) {
      const [a, b, mid, ry] = this.rulerTag;
      c.save();
      c.globalAlpha = Math.min(1, bayPanel) * (1 - drop);
      c.strokeStyle = css("mikuHi", 0.92);
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(a[0], a[1]);
      c.lineTo(b[0], b[1]);
      for (const p of [a, b]) {
        c.moveTo(p[0], p[1] - 8);
        c.lineTo(p[0], p[1] + 8);
      }
      c.stroke();
      const txt = `1.00 m AT THE SECTION  \u00b7  ${this.qaDepth.subjectPx.toFixed(1)} px  \u00b7  LOCKED`;
      label(c, txt, mid, ry + 26, {
        size: 15, align: "center", tracking: 1.6, color: css("ash", 0.92),
      });
      c.restore();
    }

    // Shot 37 · the memory peels: the remembered portrait is a photograph in
    // a frame, and the machine takes it apart the way it takes everything --
    // one horizontal strip at a time. The strips go from the bottom up, so
    // his face is the last thing to leave, and what stays behind is the frame.
    const peelFade = 1 - smoothstep(23.4, 25.4, local);
    if (local > 15.4 && peelFade > 0.004) {
      const peel = clamp((local - 15.4) / 7.6);
      const fx = 1236, fy = 150, fw = 600, fh = 430;
      const strips = 26, iy = fy + 12, ih = fh - 24;
      const stripH = ih / strips;
      c.save();
      c.globalAlpha = peelFade;
      panel(c, fx, fy, fw, fh, {
        fill: css("ink2", 0.72), corner: 12,
        cornerColor: css("amber", 0.45), stroke: css("dim", 0.5),
      });
      label(c, "ARCHIVE 0001 / MEMORY", fx + 14, fy - 12, {
        size: 15, tracking: 2, color: css("ash", 0.9),
      });
      label(c, `STRIPS LOST  ${String(Math.floor(peel * strips)).padStart(2, "0")} / ${strips}`, fx + fw - 14, fy - 12, {
        size: 15, tracking: 2, align: "right", color: peel > 0.7 ? css("red", 0.85) : css("ash", 0.85),
      });
      // the portrait inside the frame, cut into strips; each strip slides down
      // and fades on its own hash, so the picture comes apart in bands
      for (let i = 0; i < strips; i++) {
        const y0 = iy + i * stripH;
        const done = clamp((peel - (1 - (i + 1) / strips) * 0.80) / 0.34);
        if (done >= 0.999) continue;
        c.save();
        c.beginPath();
        c.rect(fx + 10, y0, fw - 20, Math.max(1, stripH + 0.6));
        c.clip();
        c.translate(done * done * (44 + i * 3.1), done * done * (96 + i * 5.1));
        c.globalAlpha = peelFade * (1 - done);
        listener(c, fx + fw / 2 - 30, iy + ih * 1.03, ih * 0.99, {
          t, alpha: 1, eyes: "sad", sadMouth: true,
          color: css("amber", 0.95), fill: css("amber", 0.12),
          scan: (t * 0.4) % 1,
        });
        c.restore();
        c.save();
        c.globalAlpha = peelFade * (1 - done) * 0.45;
        c.fillStyle = css("amber", 0.30);
        c.fillRect(fx + 10, y0, fw - 20, 1);
        c.restore();
      }
      // the recording kept in the corner of the frame is still playing
      c.save();
      c.globalAlpha = peelFade * (1 - peel * 0.85) * 0.8;
      wave(c, f.F, t - 30.0, {
        x: fx + 22, y: fy + fh - 44, w: fw - 44, h: 30, span: 3.0, lw: 1.2,
        color: css("amber", 0.55), amp: 1.0,
      });
      c.restore();
      // the scanner doing the peeling
      const sweep = (peel * 1.5) % 1;
      c.save();
      c.globalAlpha = peelFade * 0.45;
      c.fillStyle = css("miku", 0.6);
      c.fillRect(fx + 10, iy + ih * (1 - sweep), fw - 20, 1.5);
      c.restore();
      // and then there is nothing left to show -- but the frame is kept
      if (peel > 0.70) {
        const empty = smoothstep(0.70, 0.98, peel);
        c.save();
        c.globalAlpha = peelFade * empty;
        c.setLineDash([7, 7]);
        c.strokeStyle = css("dim", 0.55);
        c.lineWidth = 1.2;
        c.strokeRect(fx + 10.5, iy + 0.5, fw - 21, ih - 1);
        c.setLineDash([]);
        motifLabel(c, "NO DATA / FRAME KEPT", fx + 40, iy + ih / 2, {
          color: css("ash", 0.75),
        });
        c.restore();
      }
      c.restore();
    }

    // And then it is just her: kneeling behind the section with both hands
    // brought together, catching what is left of it. The frame's bottom edge
    // is the floor -- she is cut off by it, which is what kneeling looks like
    // when there is nothing left to kneel on.
    // She stays kneeling through the whole stop and is only taken apart by the
    // last of the blocks: the room loses its depth first, she loses her shape
    // after. (Step 48 -- before this, she was gone 0.1 s before the stop and
    // the device fired at an empty frame.)
    const kneel = smoothstep(23.6, 25.2, local) * (1 - smoothstep(31.55, 32.25, local));
    if (kneel > 0.01) {
      c.save();
      c.globalAlpha = kneel;
      // clipped just under the hem: the skirt is the last thing you see of a
      // kneeling figure, and the frame's bottom edge takes the rest
      c.beginPath();
      c.rect(900, 560, 620, 520);
      c.clip();
      // Under the section, cut off at the waist by the frame's bottom edge:
      // she is kneeling below her own heart with her hands already together,
      // which is the only way "she cannot protect it" reads as a picture
      // instead of a caption. Standing beside it says nothing.
      singer(c, 1180, 1400, 620, {
        t,
        alpha: 0.20 + 0.20 * f.a.vocal,
        handsTogether: true,
        mouth: 0.14 + 0.4 * f.a.vocal,
        dissolve: clamp((local - (this.stopLocal + 0.98)) / 1.10),
        light: 0.28 + 0.5 * f.a.vocal,
        seed: 31,
      });
      c.restore();
    }

    // The analyser belongs to the wall shot; when the heart arrives it has
    // already lost most of its bands, so it gives the bottom of the frame to
    // the section and the kneeling figure rather than sitting there dead.
    const bands = 1 - smoothstep(21.5, 23.8, local);
    if (bands > 0.01) {
      c.save();
      c.globalAlpha = bands;
      specBars(c, f.F, t, {
        x: 620, y: 840, w: 1220, h: 120, bars: 56, gap: 3,
        color: css("miku", 0.75), decayBands: Math.round(erode * 40),
      });
      c.restore();
    }
    drawText(c, `${pad(Math.floor(erode * 65535), 5)}`, {
      x: 1836, y: 1000, size: 30, weight: 600, mono: true, align: "right",
      color: stop > 0 ? css("red", 0.95) : css("ash", 0.85),
    });
    label(c, "FAULTS", 620, 1000, { size: 16, color: css("ash", 0.8), tracking: 1.4 });

    if (stop > 0) {
      c.save();
      c.globalAlpha = Math.min(1, stop);
      c.fillStyle = css("red", 0.02 + 0.07 * (1 - stop));
      c.fillRect(0, 0, 1920, 1080);
      c.strokeStyle = css("red", 0.9);
      c.lineWidth = 3;
      c.strokeRect(60.5, 48.5, 1799, 983);
      label(c, "\u7dca\u6025\u505c\u6b62\u88c5\u7f6e\u4f5c\u52d5", 960, 240, {
        size: 44, align: "center", tracking: 6, color: css("bone", 0.95),
      });
      label(c, "EMERGENCY STOP  /  SECOND ACTUATION", 960, 286, {
        size: 20, align: "center", tracking: 4, color: css("red", 0.95),
      });
      c.restore();
    }

    machineChrome(c, { name: "", left: "EROSION", right: `T+${local.toFixed(1)} s` });

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    return {
      bloom: 1.0 + 0.4 * f.kick,
      exposure: 1.0,
      grain: 0.03 + 0.04 * erode,
      vignette: 0.68 + 0.1 * (1 - erode),
      scan: 0.06 + 0.06 * erode,
      ca: 0.002 + 0.004 * erode,
      shake: [0.004 * stop * Math.sin(t * 60.0), 0.003 * stop * Math.cos(t * 47.0)],
      flash: 0.4 * stop * Math.max(0, 1 - stop * 2.2) + 0.05 * f.kick * stop * 0.6,
      flashColor: [0.85, 0.08, 0.12],
      // The old fade began at 29.5 s and was dimming the frame by 26-40% right
      // through the stop. It now only dips in the last six frames, so the drop
      // (which is the chapter's last word) is not read through a grey veil.
      fade: 0.30 * smoothstep(31.80, 32.10, local),
    };
  }

  // ---- shot 36: the abrasion bay -------------------------------------------
  // The chamber that printed her, run backwards. `birth` runs a print head
  // *down* her silhouette from above; here a read head climbs *up* from the
  // floor, and every point it has passed is already gone -- taken, drifting
  // down, and written into the floor as a cell of the record. She is 1.62 m;
  // the chamber is 13.20 m of ribs on a 7.20 m radius, so the machine is 8.1
  // of her tall, and the lens makes one arc from a shoulder-high 3.4 m to a
  // 6.8 m crane 11 m off the axis.
  //
  // Step 58. The version before this was a flat cloud of points on a
  // locked-off lens: the erosion was there, the room was not, and a person
  // coming apart read as a particle demo. Every number the panel prints is now
  // taken off the same projection the picture is drawn with.
  bodyPass(out, f, local) {
    const a = clamp(local / 0.9) * (1 - smoothstep(15.2, 16.6, local));
    this.wallA = a;
    this.qaAbrasion = null;
    this.qaBody = null;
    if (a < 0.004 || !this.wallLinePts) return;

    const W = this.ctx.W, H = this.ctx.H;
    const aspect = W / H;
    const u = clamp(local / 15.2);
    // the head: half a second to arm, then 2.02 m at a servo's 0.160 m/s
    const head = CHAMBER.h0 + (CHAMBER.h1 - CHAMBER.h0)
      * clamp((local - CHAMBER.arm) / CHAMBER.dur);
    const voice = 0.78 + 0.55 * f.a.vocal;

    const cam = this.rig.eval(u, aspect);
    const vp = this.rig.vp;
    this.lastCamBody = { eye: cam.eye, at: cam.at, fov: cam.fov };

    // ---- the room ---------------------------------------------------------
    // Bands, rings, spokes. A rail the head has passed carries light, because
    // it has been read; a rail above it is dark structure. Nothing here moves,
    // and the light is not decoration: it is the head's own height, drawn on
    // the room it is measuring.
    // The drawing itself lives in src/head.js, shared with `birth`. Here the
    // head reads *upward* (`dir: 1`): everything below it has been read.
    const nc = writeBay(this.chamberData, 0, {
      head, dir: 1, voice,
      lit: rgb("miku"), dim: rgb("tealDeep"),
    });
    this.chamber.update(this.chamberData, nc).render(out, {
      vp, eye: cam.eye, fog: { dist: CHAMBER.air, c: rgb("ink") }, opacity: 0.92,
    });

    // ---- the record on the floor ------------------------------------------
    // One cell lights for every 0.042 m the head has climbed. The machine
    // writes down what it has taken, in the order it took it.
    const cells = Math.min(CHAMBER.marks, Math.floor(
      ((head - CHAMBER.h0) / (CHAMBER.h1 - CHAMBER.h0)) * CHAMBER.marks));
    const nm = writeRecord(this.recordData, 0, {
      cells, lit: rgb("mikuHi"), dim: rgb("tealDeep"),
    });
    this.record.update(this.recordData, nm).render(out, {
      vp, eye: cam.eye, fog: { dist: CHAMBER.air, c: rgb("ink") },
      soft: 0.4, opacity: 0.9,
    });

    // ---- the head itself: a ring, a curtain, and a plate of light ---------
    const nh = writeHeadRing(this.headData, 0, {
      head, voice, ring: rgb("mikuHi"), mid: rgb("bone"), disc: rgb("miku"),
    });
    this.readHead.update(this.headData, nh).render(out, {
      vp, eye: cam.eye, soft: 0.9, opacity: 0.8,
    });

    // ---- her --------------------------------------------------------------
    // The sampling is metric now: 1.62 m of CV-01 standing on the chamber
    // floor, in a 0.30 m slab, so an oblique lens sees a volume, not a plate.
    const HH = HERO_H / 2;
    const her = (q, i) => {
      const face = hash(i * 1.37 + q[0] * 3.1 + q[1] * 7.7);
      return [
        q[0] * WALL_SX * HH,
        (q[1] + 1) * HH,
        (face < 0.62 ? 1 : -1) * (0.135 + 0.030 * hash(i * 2.71)),
      ];
    };
    // How far the head has passed a point, in metres: 0 = still hers, 1 =
    // gone. The drawing's hairline survives 0.06 m longer than the volume, so
    // the last thing to leave a cell is its edge.
    const taken = (y, lead) => clamp((head - lead - y) / 0.55);
    // The section the head is *on*: the machine does not just take what it has
    // passed, it lights the line it is reading. Without this the head was a
    // line in the room and her body had no idea it was being measured.
    const section = (y) => Math.exp(-Math.pow((y - head) / 0.055, 2));
    const drift = (p, i, age) => {
      const s = age * age;
      return [
        p[0] + (p[0] >= 0 ? 1 : -1) * 0.34 * s + Math.sin(i * 1.7) * 0.14 * s,
        Math.max(0.012, p[1] - (0.45 + 0.55 * hash(i * 3.7)) * s),
        p[2] + (p[2] >= 0 ? 1 : -1) * 0.30 * s,
      ];
    };

    // The probe hook: `qaWantBody` is set by tools/abrasion-probe.mjs only, so
    // the film's own frame never pays for projecting 5,000 points twice. The
    // box is the *drawn* cloud -- the points that survived the head, at the
    // place they were written -- not the sample it came from.
    const box = this.qaWantBody
      ? { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, n: 0 } : null;
    const note = (p) => {
      if (!box) return;
      const s = project(vp, p, W, H);
      if (s[0] < box.x0) box.x0 = s[0];
      if (s[0] > box.x1) box.x1 = s[0];
      if (s[1] < box.y0) box.y0 = s[1];
      if (s[1] > box.y1) box.y1 = s[1];
      box.n++;
    };

    // the volume of her: dim, and the first thing a cell loses
    let nf = 0;
    for (let i = 0; i < this.wallFillPts.length; i++) {
      const q = this.wallFillPts[i];
      const p = her(q, i);
      const age = taken(p[1], 0);
      const alive = (1 - age) * a;
      if (alive <= 0.004) continue;
      const pp = drift(p, i, age);
      note(pp);
      nf = writeInstance(this.wallFillData, nf, {
        p: pp, s: 1, c: rgb("tealDeep"),
        a: Math.min(1, alive * (0.008 + 0.018 * q[2]) + 0.10 * section(p[1]) * a),
      });
    }
    this.wallFill.update(this.wallFillData, nf)
      .render(out, { vp, eye: cam.eye, point: 2.8, sprite: 1, focal: 0.55 });
    // and the drawing of her: the line is what still says who this was
    let nl = 0;
    for (let i = 0; i < this.wallLinePts.length; i++) {
      const q = this.wallLinePts[i];
      const p = her(q, i);
      const age = taken(p[1], 0.06);
      const alive = (1 - age) * a;
      if (alive <= 0.004) continue;
      const pp = drift(p, i, age);
      const on = section(p[1]);
      note(pp);
      nl = writeInstance(this.wallLineData, nl, {
        p: pp, s: 1,
        c: on > 0.35 ? rgb("bone") : q[2] > 0.86 ? rgb("mikuHi") : rgb("miku"),
        a: Math.min(1, Math.pow(alive, 1.5) * (0.70 + 0.30 * q[2]) + 0.60 * on * a),
      });
    }
    this.wallLine.update(this.wallLineData, nl)
      .render(out, { vp, eye: cam.eye, point: 5.6, sprite: 1, focal: 0.55 });
    this.qaBody = box && box.n ? {
      x0: +box.x0.toFixed(1), x1: +box.x1.toFixed(1),
      y0: +box.y0.toFixed(1), y1: +box.y1.toFixed(1), n: box.n,
    } : null;

    // ---- what the panel is allowed to print -------------------------------
    // Every reading below is this frame's own projection of the same points
    // the room and she were drawn from -- not a caption.
    const crown = project(vp, [-0.86, HERO_H, 0], W, H);
    const foot = project(vp, [-0.86, 0, 0], W, H);
    const headP = project(vp, [-0.86, head, 0], W, H);
    const tag = project(vp, [1.15, head, 0], W, H);
    const herTop = project(vp, [0, HERO_H, 0], W, H);
    const herFoot = project(vp, [0, 0, 0], W, H);
    const nearRib = project(vp, [0, 1.0, CHAMBER.radius], W, H);
    const farRib = project(vp, [0, 1.0, -CHAMBER.radius], W, H);
    this.qaAbrasion = {
      local: +local.toFixed(3),
      head: +head.toFixed(4),
      cells,
      lift: +clamp((local - CHAMBER.arm) / CHAMBER.dur).toFixed(4),
      eye: cam.eye.map((v) => +v.toFixed(3)),
      fovDeg: +(cam.fov * 180 / Math.PI).toFixed(2),
      shePx: +Math.abs(herFoot[1] - herTop[1]).toFixed(1),
      sx: +(herTop[0] / W).toFixed(4),
      ribPx: +Math.hypot(nearRib[0] - farRib[0], nearRib[1] - farRib[1]).toFixed(1),
      crown, foot, headPx: headP, tag,
    };
  }

  // ---- shot 38: the heart, cut open -----------------------------------------
  // Nine sections stand one behind another, the front one full size and every
  // one behind it smaller. The blade makes nine separate cuts: each shave
  // advances in under half a beat and then holds, so the picture is a knife
  // taking a slice, not a slow dissolve. The slice that comes off leaves as a
  // sheet -- all of its points fall together -- while the newly exposed
  // section stays lit. The camera starts off-axis and squares up onto the cut,
  // which is the last thing left of the heart.
  heartPass(out, f, local) {
    const t = f.t;
    const W = this.ctx.W, H = this.ctx.H;
    this.heartTag = null;
    this.rulerTag = null;
    this.cutCount = 0;
    // The section now outlives the stop: the second actuation happens *to her*,
    // not to an empty page. (Before step 48 she was already gone by 30.1 s.)
    const a = smoothstep(22.5, 23.8, local) * (1 - smoothstep(31.62, 32.30, local));
    this.heartA = a;
    if (a < 0.004) return;
    const aspect = W / H;
    // 1. the square-up: one slow orbit, ending exactly on the cut (unchanged).
    const orbit = -0.38 * (1 - smoothstep(22.8, 29.4, local));
    let eye = [0.60 + Math.sin(orbit) * 4.60, 0.70, Math.cos(orbit) * 4.60];
    let at = [0.60, 0.35, 0];
    let fov = DOLLY.fov0;
    // 2. the dolly: the lens rides its own axis backwards at a constant rate
    // while the focal length tightens by exactly the same factor. The set does
    // not move -- not one ring -- so the depth is removed by the lens alone.
    const ax = this.axis;
    const rail = clamp((local - (this.stopLocal + DOLLY.rail)) / DOLLY.railDur);
    const d = ax.d0 + DOLLY.back * rail;
    if (rail > 0) {
      eye = [
        ax.anchor[0] - ax.v[0] * d,
        ax.anchor[1] - ax.v[1] * d,
        ax.anchor[2] - ax.v[2] * d,
      ];
      // tan(fov/2) * d = k: the one number this move is not allowed to change,
      // because it *is* the size of a metre in the focal plane. The `at` point
      // stays on the same axis, so the frame cannot tilt while it travels.
      fov = 2 * Math.atan(ax.k / d);
      at = [
        ax.anchor[0] + ax.v[0] * 2,
        ax.anchor[1] + ax.v[1] * 2,
        ax.anchor[2] + ax.v[2] * 2,
      ];
    }
    camera(this.vp, { eye, at, fov, near: 0.1, far: 60, aspect });
    this.lastCam = { eye, at, fov };

    // ---- the two readings this shot is built on, straight off the projection
    //
    // `subjectPx` is one metre lying *in the focal plane*: it is 212.7 px at
    // 1080p for the whole move, and the panel has to print what it measures,
    // not what it hopes. `parallax` is the two extreme rings of the bay: the
    // near one barely changes, the far one is dragged towards it, and at 1.000
    // there is no room left behind her to be a room.
    const rulerA = project(this.vp, [
      ax.anchor[0] - 0.5 + ax.up[0] * RULER_U,
      ax.anchor[1] + ax.up[1] * RULER_U,
      ax.anchor[2] + ax.up[2] * RULER_U,
    ], W, H);
    const rulerB = project(this.vp, [
      ax.anchor[0] + 0.5 + ax.up[0] * RULER_U,
      ax.anchor[1] + ax.up[1] * RULER_U,
      ax.anchor[2] + ax.up[2] * RULER_U,
    ], W, H);
    const nearA = project(this.vp, [-BAY.half, 0, BAY.zNear], W, H);
    const nearB = project(this.vp, [BAY.half, 0, BAY.zNear], W, H);
    const farA = project(this.vp, [-BAY.half, 0, BAY_FAR], W, H);
    const farB = project(this.vp, [BAY.half, 0, BAY_FAR], W, H);
    const nearPx = Math.abs(nearB[0] - nearA[0]);
    const farPx = Math.abs(farB[0] - farA[0]);
    this.qaDepth = {
      local: +local.toFixed(3),
      rail: +rail.toFixed(4),
      track: d,
      fovDeg: fov * 180 / Math.PI,
      subjectPx: Math.abs(rulerB[0] - rulerA[0]),
      nearPx,
      farPx,
      parallax: nearPx / Math.max(1e-6, farPx),
      // how much of the room the lens has dragged forward, measured against
      // the pre-stop lens: the far ring's own width, not a ratio
      farGain: farPx / BAY_REF_FAR_PX - 1,
    };
    this.rulerTag = [
      rulerA, rulerB,
      (rulerA[0] + rulerB[0]) / 2, (rulerA[1] + rulerB[1]) / 2,
    ];
    const layers = HEART_LAYERS;
    const p = clamp((local - 23.0) / 6.5);
    const stepi = Math.floor(p * layers);
    const frac = p * layers - stepi;
    const cut = Math.min(layers, stepi + smoothstep(0.015, 0.44, frac));
    const face = Math.min(layers - 1, Math.max(0, Math.ceil(cut - 1e-6)));
    const kFace = heartK(face / (layers - 1));
    const breath = 0.80 + 0.42 * f.a.vocal;
    const bite = 1 - smoothstep(0.0, 0.5, frac);   // the instant a slice lets go
    // One slice leaves as one sheet: every point of a layer shares the same
    // fall, so what the eye tracks is a heart coming off, not dust.
    const fall = (q, age) => [
      q.x + (q.x >= 0 ? 1 : -1) * 0.34 * age + Math.sin(q.r * 41.0) * 0.05 * age,
      q.y - age * (1.05 + 1.45 * q.r),
      q.z - age * 0.26,
    ];

    // the interior of the volume: only a cut face is ever solid
    let nf = 0;
    for (const q of this.heartFillPts) {
      const removed = cut - q.l;
      if (removed > 0) {
        const age = Math.min(1, removed / 1.35);
        if (age >= 0.997) continue;
        nf = writeInstance(this.heartFillData, nf, {
          p: fall(q, age), s: 1, c: rgb("tealDeep"),
          a: Math.min(1, Math.pow(1 - age, 1.5) * a * breath * 0.32),
        });
      } else if (q.l === face) {
        nf = writeInstance(this.heartFillData, nf, {
          p: [q.x, q.y, q.z], s: 1, c: rgb("miku"),
          a: Math.min(1, a * breath * (0.46 + 0.26 * bite)),
        });
      }
    }
    this.heartFill.update(this.heartFillData, nf)
      .render(out, { vp: this.vp, point: 3.0, sprite: 1 });

    // the contours: the stack of hearts still standing, plus the rims of the
    // slices on their way down
    let no = 0;
    for (const q of this.heartOutPts) {
      const removed = cut - q.l;
      if (removed > 0) {
        const age = Math.min(1, removed / 1.35);
        if (age >= 0.997) continue;
        no = writeInstance(this.heartOutData, no, {
          p: fall(q, age), s: 1, c: rgb("miku"),
          a: Math.min(1, Math.pow(1 - age, 1.5) * a * 0.55),
        });
      } else {
        const isFace = q.l === face;
        no = writeInstance(this.heartOutData, no, {
          p: [q.x, q.y, q.z], s: 1,
          c: isFace ? rgb("mikuHi") : rgb("miku"),
          a: Math.min(1, a * breath * (isFace ? 1.05 : 0.34 * (1 - 0.5 * q.l / layers))),
        });
      }
    }
    this.heartOut.update(this.heartOutData, no)
      .render(out, { vp: this.vp, point: 4.4, sprite: 1 });

    // The cut face is measured while it is open: ticks on the contour, all of
    // them inside the cutting plane. They are the machine reading the section
    // -- and, because they stay out at the rim, the face itself is left alone
    // to read as a surface. Spokes to the centre turned the heart into a sun.
    const zFace = HEART_Z0 + (HEART_Z1 - HEART_Z0) * (face / (layers - 1));
    const spokeStep = Math.max(1, Math.round(HEART_RING / 24));
    let ns = 0;
    for (let i = 0; i < HEART_RING; i += spokeStep) {
      const q = this.heartOutPts[face * HEART_RING + i];
      if (!q) continue;
      const len = Math.hypot(q.x, q.y);
      if (len < 1e-4) continue;
      ns = writeInstance(this.spokeData, ns, {
        p: [q.x * 0.83, q.y * 0.83, zFace], s: 1,
        c: rgb("mikuHi"),
        a: Math.min(1, a * breath * (0.20 + 0.26 * bite)),
        r: [0, 0, Math.atan2(-q.x, q.y)],
        scale: [1, len * 0.17, 1],
      });
    }
    this.spoke.update(this.spokeData, ns)
      .render(out, { vp: this.vp, soft: 0.5, opacity: 0.85 });

    this.cutCount = stepi + (frac >= 0.44 ? 1 : 0);

    // The blade: a hairline crossing the whole heart where the cut is, a soft
    // glow under it, and one tick past each shoulder. A filled sheet here
    // reads as a panel, and a panel is furniture, not a knife.
    const zCut = HEART_Z0 + (HEART_Z1 - HEART_Z0) * clamp(cut / (layers - 1));
    const half = 1.34 * kFace;
    let b = 0;
    b = writeInstance(this.bladeData, b, {
      p: [0, 0.02, zCut], s: 1, c: rgb("mikuHi"),
      a: (0.16 + 0.22 * bite) * a, scale: [half, 0.030, 1],
    });
    b = writeInstance(this.bladeData, b, {
      p: [0, 0.02, zCut], s: 1, c: rgb("bone"),
      a: (0.36 + 0.34 * bite) * a, scale: [half, 0.0048, 1],
    });
    for (const side of [-1, 1]) {
      b = writeInstance(this.bladeData, b, {
        p: [side * half, 0.02, zCut], s: 1, c: rgb("miku"),
        a: 0.30 * a, r: [0, 0, Math.PI / 2], scale: [0.085, 0.005, 1],
      });
    }
    this.blade.update(this.bladeData, b).render(out, { vp: this.vp, soft: 0.8, opacity: 0.75 });

    const pr = project(this.vp, [0, 0.30, HEART_Z0], this.ctx.W, this.ctx.H);
    this.heartTag = [pr[0], pr[1]];
  }

  // ---- the depth bay: the room, switched on at the second stop -------------
  // Six rings, 1.20 m apart, standing behind the section; four 6.00 m rails
  // tying them into a corridor. They are drawn exactly where they have always
  // been, every frame, and **nothing here moves**. The dolly pulls them
  // together by perspective alone; when the picture is flat it is the picture,
  // not the room, that drops out in blocks.
  depthPass(out, f, local) {
    const stop = this.stopLocal;
    // switched on in one beat, and taken away with the last of the blocks
    const on = clamp((local - (stop + DOLLY.arm)) / 0.12)
      * (1 - smoothstep(31.95, 32.35, local));
    this.bayOn = on;
    if (on < 0.01 || !this.lastCam) return;
    const data = this.bayData;
    const half = BAY.half, rail = BAY.rail;
    let n = 0;
    // The rings come on from the lens outward -- the frame extrudes the room
    // it is about to remove -- and each one lands on its own beat of the relay.
    for (let k = 0; k < BAY.rings; k++) {
      const z = BAY.zNear - k * BAY.pitch;
      const arrive = clamp((local - (stop + DOLLY.arm + k * (DOLLY.armDur / BAY.rings))) / 0.16);
      const a = (0.05 + 0.60 * arrive) * on * (1 - 0.07 * k);
      if (a <= 0.006) continue;
      const col = k === 0 ? rgb("bone") : rgb("dim");
      const node = k === 2 ? rgb("mikuHi") : rgb("miku");
      const nodeA = Math.min(1, a * (0.55 + 0.75 * arrive));
      n = writeInstance(data, n, { p: [0, half, z], s: 1, c: col, a, scale: [half, rail, 1] });
      n = writeInstance(data, n, { p: [0, -half, z], s: 1, c: col, a, scale: [half, rail, 1] });
      n = writeInstance(data, n, {
        p: [-half, 0, z], s: 1, c: col, a, r: [0, 0, Math.PI / 2], scale: [half, rail, 1],
      });
      n = writeInstance(data, n, {
        p: [half, 0, z], s: 1, c: col, a, r: [0, 0, Math.PI / 2], scale: [half, rail, 1],
      });
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          n = writeInstance(data, n, {
            p: [sx * half, sy * half, z], s: 1, c: node, a: nodeA,
            scale: [BAY.node, BAY.node, 1],
          });
        }
      }
    }
    // the four long rails: the 6.00 m of depth the reading is measured over
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        n = writeInstance(data, n, {
          p: [sx * half, sy * half, BAY_ZMID], s: 1, c: rgb("dim"), a: 0.13 * on,
          r: [0, Math.PI / 2, 0], scale: [BAY_HALFLEN, rail * 0.7, 1],
        });
      }
    }
    this.bay.update(data, n).render(out, {
      vp: this.vp,
      eye: this.lastCam.eye,
      fog: { dist: BAY.air, c: rgb("ink") },
      soft: 0.35,
      opacity: 0.92,
    });
  }
}
