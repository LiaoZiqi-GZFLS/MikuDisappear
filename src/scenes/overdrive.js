// 1:57.7 - the fastest farewell song. The transport is pinned, the text runs
// away from the eye, and one line remembers a leek.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import {
  binaryField, clamp, easeOutCubic, label, lyricLine, machineChrome, panel,
  smoothstep, specBars, typeWall, wave,
} from "../kit.js";
import {
  displaySleep, heart, leek, listener, motifLabel, recycleBin, singer,
} from "../motifs.js";
import { beatAt } from "../semantics.js";
import { Stage3D, camera, heartF, mat4, project, rgb, writeInstance } from "../gl3d.js";
import { draw as drawText, pad } from "../type.js";
import { audioU, layer, line } from "./util.js";

const FRAG = `
uniform float uT;
uniform float uVocal;
uniform float uLow;
uniform float uKick;
uniform float uHigh;
uniform float uPulse;
uniform float uRate;      // 0..1 transport pressure
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  // the picture leans into the wind
  float lean = uRate * 0.05;
  vec2 q = uv - 0.5;
  q.x += q.y * lean;
  q *= 1.0 - lean * 0.4;
  vec3 col = C_INK;

  float speed = smoothstep(0.02, 0.0, abs(fract((uv.y + uT * (0.6 + uRate * 1.4)) * 26.0) - 0.5));
  col += C_TEAL_DEEP * speed * 0.14;

  col += C_MIKU * 0.16 * uLow * exp(-pow((uv.y - 0.03) * 7.0, 2.0));
  col += C_MIKU_HI * 0.10 * uKick * exp(-pow((uv.y - 0.5) * 22.0, 2.0));
  col += C_MIKU * 0.05 * uVocal * exp(-pow((uv.y - 0.72) * 5.0, 2.0));
  col *= 1.0 + 0.10 * uPulse + 0.06 * uHigh;
  fragColor = vec4(col, 1.0);
}`;

// ---- the heart in 3D -------------------------------------------------------
// The volume of the heart curve is carried to the GPU once, as a point cloud
// with its sampling position, its distance from the wound and two hashes.
const HEART_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aInst;    // xyz = world position, w = scale
layout(location = 2) in vec4 aTint;    // rgb + alpha = intactness
layout(location = 3) in vec4 aRot;     // local xyz = sampling position
layout(location = 4) in vec4 aScale;   // x = r, yz = hashes
uniform mat4 uVP;
uniform float uPoint;
uniform float uT;
uniform float uWound;    // how much has been cut away
uniform float uPulse;
uniform float uOpen;     // points falling inwards, towards the cut face
out vec3 vCol;
out float vAlpha;
out float vGlow;
void main() {
  // blinking while it exists is fine, but the *erosion phase* has to be a
  // function of the beat and not of wall time, so the chapter can be cut on
  // any frame; aTint.a carries that phase at upload time.
  float alive = fract(aTint.a + uT * 0.10);
  float h1 = aRot.y, h2 = aRot.z;
  // outside-in: the rim of the section is removed before the core
  float take = smoothstep(aScale.x - 0.30, aScale.x + 0.42, uWound + h1 * 0.34);
  float gone = take;
  // the wound becomes a *hole*: everything that is taken falls towards the
  // cut face and out through it
  vec2 dir = normalize(vec2(aScale.y, aScale.z) + vec2(0.0001, 0.0001));
  vec3 p = aInst.xyz;
  p.xy += dir * uWound * (0.55 + 0.9 * h1) * take;
  p.z -= uWound * (0.9 + 1.2 * h2) * take;
  p.z += uOpen * (0.5 + 0.8 * h1);
  gl_Position = uVP * vec4(p, 1.0);
  gl_PointSize = uPoint * (0.45 + 0.85 * h2) * (1.0 - 0.45 * uWound);
  // the cut face is the brightest thing in the volume, and the inside of the
  // heart is only visible where it has been cut
  float face = exp(-pow((aRot.z - 0.62) * 2.3, 2.0));
  float rim = smoothstep(0.55, 0.0, abs(aScale.x - 0.58));
  vGlow = 0.55 + 1.35 * face + 0.6 * rim + 0.5 * uPulse;
  // points on the rim of each section are the outline, and they fall last
  vAlpha = alive * (0.16 + 0.50 * rim) * (0.55 + 0.45 * face) * (1.0 - 0.55 * gone * (1.0 - rim));
  vCol = mix(aTint.rgb, vec3(0.95, 0.90, 0.98), 0.30 * gone);
}`;

const HEART_FRAG = `#version 300 es
precision highp float;
in vec3 vCol;
in float vAlpha;
in float vGlow;
out vec4 fragColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = vAlpha * exp(-r * r * 2.6) * (1.0 - smoothstep(0.82, 1.0, r));
  fragColor = vec4(vCol * vGlow, a);
}`;

// The corridor's wrap span, in one place: 14 tiles of 8 m = 112 m, with one
// sleeper every 4 m. The constructor sizes the buffers with these and
// trackPass places the geometry with them, so the floor cannot fall out of
// step with the gates.
//
// The tube's cross-section (step 49). It used to be 23.0 m wide and 3.85 m
// tall with the lens at 2.90 m: at 58 deg that puts all four edges *outside*
// the frame until 25 m away, so a 112 m corridor could only ever project as a
// horizon line, and the "3D track" read as a flat band. The tube is now 12.0 m
// wide and 3.90 m tall with the lens at 2.35 m and a 66.5 deg lens, which puts
// every edge off-frame at the near field and lets all four converge on the
// vanishing point -- the frame is inside the tube instead of looking at it.
// The gauge is printed by the chapter's own instrument, and the projection is
// audited frame by frame by tools/tunnel-probe.mjs.
const GAUGE = 6.0;        // m, half the tube's width (inside faces)
const FLOOR = 0.20;       // m, the floor the lens rides over
const CEIL = 4.10;        // m, the ceiling it rides under
const WIRE = 3.95;        // m, the contact wire, just under the ceiling
const LENS_Y = 2.35;      // m, the cab's eye height -- 2.15 m over the floor
const TUBE_FOV = 1.16;    // rad, 66.5 deg vertical
const RAILS = 14;
const TIES = 28;
const SPAN = RAILS * 8;

export default class Overdrive extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "overdrive");
    this.title = null;
    this.leek = null;
    this.trash = null;

    // The wall of words is not a page, it is a place: a track of glowing rails
    // running into the dark, arriving at the lens faster than they can be
    // read, with sparks tearing off them. The 2D type sits on top of this --
    // what the eye can read, and what is actually going past.
    //
    // v7 makes it a corridor instead of a set of gates: sleepers under the
    // lens, two walls at ±11.5 m with their own tick rule, a wire overhead and
    // a pantograph that belongs to the lens -- the camera is not watching a
    // track, it is riding one. Everything here is placed from the same `dolly`
    // the plates use, so the floor, the walls and the speed reading cannot
    // disagree about how fast the chapter is going.
    this.vp = mat4();
    this.plates = new Stage3D(ctx, "rect");
    this.rails = new Stage3D(ctx, "segment");
    this.sparks = new Stage3D(ctx, "segment");
    this.ties = new Stage3D(ctx, "segment");
    this.wall = new Stage3D(ctx, "segment");
    this.rig = new Stage3D(ctx, "segment");
    this.plateData = new Float32Array(RAILS * 16);
    this.railData = new Float32Array(RAILS * 4 * 16);
    this.sparkData = new Float32Array(180 * 16);
    this.tieData = new Float32Array(TIES * 16);
    this.wallData = new Float32Array(RAILS * 8 * 16);
    this.rigData = new Float32Array(16 * 16);
    this.sparkSeeds = [];
    for (let i = 0; i < 180; i++) {
      const h = (k) => {
        const s = Math.sin(i * 17.13 + k * 51.7) * 37131.7;
        return s - Math.floor(s);
      };
      this.sparkSeeds.push({
        // inside the tube, not beside it: a spark that flies outside the
        // corridor is a spark that says the corridor is not there
        x: (h(1) - 0.5) * 12.4,
        y: FLOOR + 0.15 + h(2) * (CEIL - FLOOR - 0.30),
        u: h(3),
        len: 0.5 + h(4) * 2.0,
        c: h(5),
      });
    }

    // ---- the weak heart, as a place --------------------------------------
    // Not a decal: a cloud of points filling the volume of the heart curve,
    // nine cross-sections deep, each with its own hash for the erosion order.
    // The camera is pushed *through* it on "a weak heart, the fear of
    // vanishing" -- the chapter's one interior shot, and the reason the point
    // cloud in the last act can be believed.
    this.heartVp = mat4();
    this.heartStage = new Stage3D(ctx, "point", { pt: HEART_VERT, frag: HEART_FRAG });
    this.heartPts = [];
    const LAYERS = 9;
    for (let li = 0; li < LAYERS; li++) {
      const u = li / (LAYERS - 1);
      const k = heartF.k(u);
      const z = 0.62 - u * 1.24;
      for (let iy = 0; iy < 11; iy++) {
        for (let ix = 0; ix < 11; ix++) {
          const gx = ((ix + 0.5) / 11) * 2.2 - 1.1;
          const gy = ((iy + 0.5) / 11) * 2.0 - 1.0;
          if (heartF(gx, gy, k) > 0) continue;
          const id = li * 121 + iy * 11 + ix;
          const h = (m) => {
            const s = Math.sin(id * 12.9898 + m * 78.233) * 43758.5453;
            return s - Math.floor(s);
          };
          const h1 = h(1), h2 = h(2);
          // Each point is stored in the three spaces the vertex shader needs:
          //   p  = where it sits in the volume, already shaped
          //   s  = how far the wound is from reaching it
          //   r  = the section it belongs to, and the two hashes that decide
          //        when the knife takes it.
          // The glyphs are a wide heart, not the round curve: two samples per
          // axis (a central column and the rim) make the concave notch of the
          // top edge legible from the front.
          this.heartPts.push({
            p: [gx * 1.55, gy * 1.02, z + (h(0) - 0.5) * 0.05],
            s: Math.hypot((gx * 1.55) / 1.8, gy * 1.02),
            r: [u, h1, h2],
            id,
          });
        }
      }
    }
    this.heartData = new Float32Array(this.heartPts.length * 16);
  }

  async init() {
    const F = this.ctx.features;
    this.title = line(F, "\u6700\u9ad8\u901f\u306e\u5225\u308c\u306e\u6b4c");
    this.leek = line(F, "\u30cd\u30ae");
    this.trash = line(F, "\u3054\u307f\u7bb1");
  }

  render(f, out) {
    const t = f.t;
    const local = t - 117.69;
    const rate = clamp(local / 12.0);
    this.pass.draw({ dst: out, u: audioU(f, { uRate: rate }) });
    this.trackPass(out, f, t, rate);
    this.heartPass(out, f, local);

    const c = this.text.ctx;
    this.text.clear();

    const bt = beatAt(f.F, t);
    const bid = bt ? bt.id : "";
    const bA = bt ? Math.min(bt.fresh, 1 - bt.exit) : 0;
    const active = f.line;

    // the illusion of a self, running too fast to hold together
    const phantom = bid === "existence_illusion" || bid === "cannot_wave_away"
      || bid === "collapse" || bid === "no_will";
    for (let i = 0; i < 4; i++) {
      singer(c, 1060 + (i - 1.5) * 54, 880, 440, {
        t,
        phase: i * 0.37,
        alpha: (phantom ? 0.10 : 0.035) * (1 - i * 0.17),
        dissolve: clamp(0.30 + i * 0.12 + (bid === "collapse" ? 0.30 : 0)),
        crack: bid === "collapse" ? 0.70 : 0.12,
        // only the front ghost carries a face; the rest are just her shadow
        eyes: i === 0 ? (bid === "weak_heart" ? "sad" : "open") : "closed",
        mouth: 0.20 + 0.60 * f.a.vocal,
        heart: bid === "weak_heart" ? Math.max(0, 1 - bt.fresh) : null,
        tilt: Math.sin(t * 4 + i * 1.7) * 0.01,
      });
    }
    if (phantom) {
      motifLabel(c, "EXISTENCE / ILLUSION", 1060, 430, {
        align: "center", color: css("miku", 0.55),
      });
    }
    if (bid === "weak_heart") {
      heart(c, 1060, 640, 130, {
        alpha: 0.85 * bA, fill: Math.max(0, 1 - bt.fresh), erode: bt.fresh,
        color: css("miku", 0.8), label: "WEAK HEART", seed: 12,
      });
    }
    if (bid === "sad_you" || bid === "your_face") {
      panel(c, 1520, 610, 316, 190, {
        fill: css("ink2", 0.78), corner: 8,
        cornerColor: css("amber", 0.55), stroke: css("dim", 0.45),
      });
      listener(c, 1678, 782, 176, {
        t,
        alpha: 0.25 + 0.55 * bA, sadMouth: true, eyes: "sad",
        scan: (t * 0.4) % 1,
      });
      motifLabel(c, "YOUR FACE / PAIN", 1520, 602, {
        color: css("amber", 0.75),
      });
    }
    if (bid === "sleep_display") {
      displaySleep(c, 1480, 630, 320, 150, {
        alpha: bA, close: bt.phase, phase: (t * 0.4) % 1,
        label: "DISPLAY / SLEEP",
      });
    }
    if (bid === "recycle_bin") {
      recycleBin(c, 1660, 666, 140, {
        alpha: bA, drop: bt.phase, label: "RECYCLE",
      });
    }
    if (bid === "leek_taste" || bid === "remember_taste") {
      const fade = bid === "remember_taste" ? 1 - bt.fresh : bt.fresh;
      leek(c, 1400, 790, 120, {
        alpha: 0.30 + 0.55 * fade, rot: 0.35, bite: 0.4,
        label: bid === "leek_taste",
      });
    }

    // the title card, straight onto the tape
    if (this.title && t < this.title.start + 3.0) {
      const u = clamp((t - this.title.start) / 0.35);
      const u2 = easeOutCubic(u);
      c.save();
      c.globalAlpha = 1 - Math.max(0, (t - this.title.start - 2.0) / 1.0);
      c.translate(960 + (1 - u2) * 420, 300);
      c.scale(1 + (1 - u2) * 0.4, 1 + (1 - u2) * 0.4);
      drawText(c, "\uff1c\u6700\u9ad8\u901f\u306e\u5225\u308c\u306e\u6b4c\uff1e", {
        x: 0, y: 0, size: 104, weight: 900, align: "center", color: css("bone", 0.98),
      });
      c.restore();
      label(c, "PLAYBACK RATE 4.00 \u00d7", 960, 360, {
        size: 20, align: "center", tracking: 4, color: css("red", 0.85),
      });
    }

    // the wall, running faster than anyone can read. It gets its own band:
    // the top HUD and the track instrument own their rows, so the text may
    // only exist between them. Without the clip the wall scrolls straight
    // through both readouts -- the picture of speed is not worth losing the
    // instrument that measures it.
    const l = this.leek && t > this.leek.start - 0.5 && t < this.leek.end + 1.2;
    c.save();
    c.beginPath();
    c.rect(64, 252, 1320, 396);
    c.clip();
    typeWall(c, f.F, t, {
      x: 84, y: 300, w: 1300, count: 12, lineHeight: 60, size: 34, window: 12,
      dimColor: css("dim", 0.85), hotColor: l ? css("leek", 1) : css("miku", 0.95),
    });
    c.restore();

    // the line being sung, huge
    if (active && active.kind !== "marker" && active.kind !== "title") {
      lyricLine(c, active, t, f.F, {
        x: 84, y: 700, size: 96, weight: 900, maxWidth: 1500,
        sung: l ? css("leek", 1) : css("bone", 1),
        dim: css("ash", 0.8),
      });
    }
    if (this.trash && Math.abs(t - this.trash.end) < 1.6) {
      label(c, "\u3053\u3053\u306f\u304d\u3063\u3068\u300c\u3054\u307f\u7bb1\u300d\u304b\u306a",
        1836, 620, { size: 22, align: "right", color: css("ash", 0.75), tracking: 1 });
    }

    // track instrument: the corridor's own log. SPEED is the variable that
    // moves the sleepers, DISTANCE is its integral, RULE is the number of wall
    // ticks that exist in the span -- three readings, one set of geometry.
    // The block sits on its own plate for the same reason the wall is clipped:
    // a reading that moves must never be drawn over a reading that stays.
    // The chapter pans up to 56 px and pushes in up to 10%, so the block is
    // laid out for the worst frame: at x 152 its left edge still clears the
    // safe area when the camera is at full left pan.
    // The panel is laid out for the worst frame the chapter can hand it -- the
    // scene layer is what the camera moves, so a reading has to survive a
    // 56 px pan and a 10 % push. Two spec lines on the left, the two counters
    // right-aligned in their own column: the strings and the numbers never
    // share a line of paper. (Step 49: adding the tube's dimensions to a
    // 560 px panel put TIES, DISTANCE and RULE on top of each other.)
    panel(c, 152, 158, 700, 92, {
      fill: css("ink", 0.80), corner: 8,
      cornerColor: css("miku", 0.45), stroke: css("dim", 0.50),
    });
    const span = SPAN;
    label(c, "TRACK / CV-01 \u2014 3D RAIL", 172, 176, {
      size: 14, tracking: 1.8, color: css("ash", 0.8),
    });
    label(c, `GAUGE ${(GAUGE * 2).toFixed(1)} m \u00b7 CELL 4.00 m \u00b7 TIES ${pad(TIES, 4)}`,
      172, 200, { size: 13, tracking: 1.5, color: css("dim", 0.9) });
    // The tube's own dimensions, because the picture has to be able to be
    // checked against a number: this is the cross-section the lens is inside.
    label(c, `TUBE ${(CEIL - FLOOR).toFixed(2)} m \u00b7 LENS ${LENS_Y.toFixed(2)} m \u00b7 FOV ${(TUBE_FOV * 180 / Math.PI).toFixed(1)}\u00b0 \u00b7 RULE ${pad(span / 4, 4)}`,
      172, 224, { size: 13, tracking: 1.5, color: css("dim", 0.9) });
    drawText(c, `${pad(Math.floor(this.dolly || 0), 6)} m`, {
      x: 736, y: 204, size: 17, weight: 500, mono: true, align: "right",
      color: css("bone", 0.9),
    });
    label(c, "DISTANCE", 748, 200, { size: 13, tracking: 1.5, color: css("ash", 0.7) });
    drawText(c, `${(this.speed || 0).toFixed(1)} m/s`, {
      x: 736, y: 228, size: 17, weight: 500, mono: true, align: "right",
      color: rate > 0.55 ? css("red", 0.95) : css("miku", 0.9),
    });
    label(c, "SPEED", 748, 224, { size: 13, tracking: 1.5, color: css("ash", 0.7) });

    // transport instrument
    panel(c, 1520, 300, 316, 300, {
      fill: css("ink2", 0.9), corner: 10, cornerColor: css("red", 0.6), stroke: css("dim", 0.5),
    });
    label(c, "TRANSPORT", 1536, 292, { size: 16, tracking: 1.8, color: css("ash", 0.95) });
    const bpm = f.F.tempoAt(t);
    drawText(c, bpm.toFixed(2), {
      x: 1820, y: 372, size: 56, weight: 600, mono: true, align: "right",
      color: bpm > 241 ? css("red", 0.95) : css("bone", 0.95),
    });
    label(c, "BPM", 1536, 372, { size: 16, color: css("ash", 0.8), tracking: 1.4 });

    // a rate bar that walks past its own limit
    const over = clamp((rate - 0.55) / 0.45);
    c.fillStyle = css("dim", 0.5);
    c.fillRect(1536, 410, 284, 12);
    c.fillStyle = rate > 0.55 ? css("red", 0.95) : css("miku", 0.95);
    c.fillRect(1536, 410, 284 * clamp(rate / 0.55) * 0.7 + 284 * 0.3 * over, 12);
    label(c, "SAFE LIMIT", 1536, 442, { size: 14, color: css("ash", 0.7), tracking: 1.2 });
    label(c, "4.00\u00d7", 1820, 442, { size: 14, align: "right", color: css("red", 0.8), tracking: 1.2 });
    drawText(c, `${pad(Math.floor(local * 240), 5)}`, {
      x: 1820, y: 520, size: 34, weight: 600, mono: true, align: "right", color: css("miku", 0.9),
    });
    label(c, "BARS DELIVERED", 1536, 520, { size: 14, color: css("ash", 0.75), tracking: 1.2 });
    specBars(c, f.F, t, {
      x: 1536, y: 540, w: 284, h: 44, bars: 28, gap: 2, color: css("miku", 0.75),
    });

    // the voice, stretched into a tape ribbon
    wave(c, f.F, t, {
      x: 84, y: 800, w: 1760, h: 110, span: 0.9 - 0.35 * rate, lw: 1.6,
      color: css("miku", 0.6 + 0.3 * over), amp: 1.15,
    });
    binaryField(c, t, {
      x: 84, y: 930, w: 1752, h: 90, cell: 20, size: 10, alpha: 0.35,
      color: css("miku", 0.5), density: 0.45, speed: 2.4, seed: 11,
    });

    machineChrome(c, { name: "", left: "OVERDRIVE", right: "\u6700\u9ad8\u901f\u306e\u5225\u308c\u306e\u6b4c" });

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    return {
      bloom: 1.0 + 0.5 * f.kick,
      exposure: 1.02,
      grain: 0.03,
      vignette: 0.66,
      scan: 0.06,
      ca: 0.002 + 0.003 * over,
      shake: [0.002 * over * Math.sin(t * 37.0), 0.0015 * over * Math.cos(t * 53.0)],
      zoom: 1 + 0.012 * over * f.kick,
      fade: 0.3 * smoothstep(20.5, 22.0, local),
    };
  }

  // The track's air: everything beyond the near rails falls into the ink, so
  // the corridor reads as speed instead of as a diagram. The eye is passed in
  // for the same reason every other rig does it: hand-over renders interleave.
  air(opts = {}) {
    return { eye: this.eyeNow || [0, 3, 7], fog: { dist: 150, c: rgb("ink") }, ...opts };
  }

  // ---- the track: rails of light arriving at the lens, and the sparks that
  // come off them. Everything is placed relative to the dolly, so the corridor
  // is endless and every frame is still a pure function of t.
  trackPass(out, f, t, rate) {
    const W = this.ctx.W, H = this.ctx.H;
    const speed = 11 + 34 * rate;
    const dolly = t * speed;
    // The same wrap the plates use, factored out so the floor, the walls and
    // the gates are guaranteed to travel together. The window is
    // [+6, +6 - SPAN] in world z, and the cab's eye is at z = 7: the nearest
    // gate is therefore 1.0 m in front of the lens and the farthest is 113 m
    // away, so a gate enters the frame at its edges and *leaves* it through the
    // corners -- the frame is inside the tube, not looking at the end of it.
    const wrap = (d) => 6 - (SPAN - (((d % SPAN) + SPAN) % SPAN));
    this.speed = speed;
    this.dolly = dolly;
    const cam = {
      // The cab's sway is a fraction of the tube now (0.9 m inside a 12 m
      // corridor, not 1.2 m inside a 23 m one), so the machine still moves and
      // the walls still stay cut by the frame.
      eye: [Math.sin(t * 0.31) * 0.90, LENS_Y + Math.sin(t * 0.7) * 0.18, 7],
      at: [Math.sin(t * 0.31) * 0.90, LENS_Y - 0.30, -46],
      fov: TUBE_FOV, near: 0.4, far: 300, aspect: W / H,
    };
    camera(this.vp, cam);
    // QA hook (read-only): the offline probe reports the cab's eye, the only
    // camera in this chapter that is not the film's frame.
    this.lastCam = cam;
    this.eyeNow = cam.eye;
    // QA hook (read-only): where the tube's four edges land on screen at a
    // depth `d` ahead of the lens, in pixels. tools/tunnel-probe.mjs uses it
    // to prove the frame is *inside* the tube -- all four edges off-frame in
    // the near field, then converging monotonically on the vanishing point.
    this.tubeProbe = (d) => {
      const z = cam.eye[2] - d;
      const l = project(this.vp, [-GAUGE, LENS_Y, z], W, H);
      const rr = project(this.vp, [GAUGE, LENS_Y, z], W, H);
      const fl = project(this.vp, [0, FLOOR, z], W, H);
      const ce = project(this.vp, [0, CEIL, z], W, H);
      return { d, left: l[0], right: rr[0], floor: fl[1], ceil: ce[1] };
    };

    let p = 0, r = 0;
    let nearGate = Infinity;
    for (let i = 0; i < 14; i++) {
      // wrap at the far end, where a rail is a couple of pixels wide
      const z = wrap(i * 8 + dolly);
      const ahead = cam.eye[2] - z;
      if (ahead < nearGate) nearGate = ahead;
      const near = clamp(1 + z / 130);
      // a gate that is on top of the lens is not a gate any more: the two
      // nearest metres are faded out, or a full-frame plate would flash the
      // picture five times a second
      const pass = smoothstep(2.0, 8.5, ahead);
      const a = (0.05 + 0.30 * near * near) * (1 - 0.35 * rate);
      if (a < 0.006) continue;
      const midY = (FLOOR + CEIL) / 2;
      p = writeInstance(this.plateData, p, {
        p: [0, midY, z], s: 1, c: rgb("tealDeep"),
        a: a * pass, scale: [GAUGE + 0.4, (CEIL - FLOOR) / 2 + 0.15, 1],
      });
      // Every gate is a *rib*: the four edges of the tube's own cross-section,
      // drawn on the gate's plane. Two horizontals give the floor and the
      // ceiling, two verticals give the walls -- which is what a corridor
      // needs in order to be a corridor and not a set of horizontal bars.
      const gw = GAUGE + 0.4, gh = (CEIL - FLOOR) / 2 + 0.15;
      for (const y of [midY - gh, midY + gh]) {
        r = writeInstance(this.railData, r, {
          p: [0, y, z], s: gw, c: y > midY ? rgb("mikuHi") : rgb("miku"),
          a: clamp(a * (y > midY ? 2.0 : 1.1) * (0.40 + 0.60 * pass)), r: [0, 0, Math.PI / 2],
        });
      }
      for (const side of [-1, 1]) {
        r = writeInstance(this.railData, r, {
          p: [side * gw, midY, z], s: 1, c: rgb("miku"),
          a: clamp(a * 1.5 * (0.40 + 0.60 * pass)), scale: [1, gh, 1],
        });
      }
    }
    this.plates.update(this.plateData, p)
      .render(out, this.air({ vp: this.vp, soft: 0.85, opacity: 0.62 }));
    this.rails.update(this.railData, r).render(out, this.air({ vp: this.vp, opacity: 1 }));
    // QA hook (read-only): how far ahead the nearest gate is this frame.
    this.gateNear = nearGate;

    // ---- the corridor itself. GAUGE is half the width in metres; the walls
    // carry a rule so that speed is measurable in the picture, not only in the
    // readout. A major tick every five tiles is the only thing on the wall
    // that is allowed to be bright.
    let ti = 0, wa = 0;
    for (let i = 0; i < 28; i++) {
      const z = wrap(i * 4 + dolly);
      const near = clamp(1 + z / 130);
      const major = i % 5 === 0;
      const a = (0.045 + 0.22 * near * near) * (major ? 2.1 : 0.8);
      if (a < 0.006) continue;
      ti = writeInstance(this.tieData, ti, {
        p: [0, FLOOR, z], s: 1,
        c: major ? rgb("miku") : rgb("tealDeep"),
        a: clamp(a), r: [0, 0, Math.PI / 2], scale: [1, GAUGE, 1],
      });
    }
    for (let i = 0; i < RAILS; i++) {
      const z0 = wrap(i * 8 + dolly);
      const near = clamp(1 + z0 / 130);
      const a = (0.05 + 0.26 * near * near) * (1 - 0.30 * rate);
      if (a < 0.006) continue;
      const major = i % 5 === 0;
      for (const side of [-1, 1]) {
        // the two wall rails: floor line and ceiling line, one tile long
        for (const y of [FLOOR, CEIL]) {
          wa = writeInstance(this.wallData, wa, {
            p: [side * GAUGE, y, z0 - 4], s: 1,
            c: rgb("tealDeep"), a: clamp(a * 0.85),
            r: [Math.PI / 2, 0, 0], scale: [1, 4, 1],
          });
        }
        // the rule: a short vertical bar on each wall, taller every fifth tile
        wa = writeInstance(this.wallData, wa, {
          p: [side * GAUGE, LENS_Y, z0], s: 1,
          c: major ? rgb("mikuHi") : rgb("dim"),
          a: clamp(a * (major ? 1.5 : 0.7)),
          scale: [1, major ? 0.62 : 0.30, 1],
        });
      }
      // the wire the pantograph is drawing from: one tile of it overhead
      wa = writeInstance(this.wallData, wa, {
        p: [0, WIRE, z0 - 4], s: 1, c: rgb("miku"), a: clamp(a * 0.9),
        r: [Math.PI / 2, 0, 0], scale: [1, 4, 1],
      });
    }
    this.ties.update(this.tieData, ti).render(out, this.air({ vp: this.vp, opacity: 0.95 }));
    this.wall.update(this.wallData, wa).render(out, this.air({ vp: this.vp, opacity: 1 }));

    // ---- the vehicle: a pantograph that belongs to the lens, so the picture
    // has a cab. It is placed 2.2 m in front and just under the top edge of
    // the frame -- present like a windshield wiper, never covering the lyric.
    // Its bar sits at 3.70 m: 1.35 m over the eye at 2.2 m is 31.5 deg, inside
    // a 66.5 deg lens by 1.8 deg, so the cab is in frame and out of the way.
    let rg = 0;
    {
      const ex = this.eyeNow[0], ez = this.eyeNow[2] - 2.2;
      const bar = 3.70, armY = WIRE - 0.05, spread = 1.35;
      rg = writeInstance(this.rigData, rg, {
        p: [ex, bar, ez], s: 1, c: rgb("mikuHi"), a: 0.44,
        r: [0, 0, Math.PI / 2], scale: [1, 1.55, 1],
      });
      for (const side of [-1, 1]) {
        const dx = side * spread, dy = armY - bar;
        rg = writeInstance(this.rigData, rg, {
          p: [ex + dx / 2, (bar + armY) / 2, ez + 0.40], s: 1, c: rgb("miku"), a: 0.32,
          r: [0, 0, Math.atan2(-dx, dy)],
          scale: [1, Math.hypot(dx, dy) / 2, 1],
        });
      }
      // the contact shoe: two short strokes under the wire
      for (const side of [-1, 1]) {
        rg = writeInstance(this.rigData, rg, {
          p: [ex + side * 0.72, bar + 0.06, ez], s: 1, c: rgb("bone"), a: 0.28,
          r: [0, 0, Math.PI / 2], scale: [1, 0.55, 1],
        });
      }
      this.rig.update(this.rigData, rg).render(out, { vp: this.vp, opacity: 0.9 });
    }

    // sparks: short strokes along the direction of travel, so the speed reads
    // as motion blur rather than as particles
    let s = 0;
    for (const sp of this.sparkSeeds) {
      const z = -2 - ((sp.u * 150 + dolly * 1.25) % 150);
      const near = clamp(1 + z / 150);
      const a = (0.10 + 0.34 * near * near) * (0.35 + 0.65 * rate);
      if (a < 0.01) continue;
      const len = sp.len * (0.5 + 2.4 * rate);
      s = writeInstance(this.sparkData, s, {
        p: [sp.x, sp.y, z], s: 1,
        c: sp.c > 0.86 ? rgb("mikuHi") : rgb("miku"),
        a: clamp(a), scale: [1, len, 1],
      });
    }
    this.sparks.update(this.sparkData, s).render(out, this.air({ vp: this.vp, opacity: 1 }));
    void H;
  }

  // ---- the weak heart, cut open -------------------------------------------
  // The chest is not drawn: the camera simply stops being outside. On the
  // "weak heart" line the rails give way to a cloud of points the size of the
  // frame, nine sections deep; every layer is shaved from its rim inwards, and
  // then the lens travels through the hole that is left. This is the chapter's
  // only interior, and it is made of the same points as the deletion.
  heartPass(out, f, local) {
    const APPEAR = 3.4, ERUPT = 13.0, GONE = 15.9;
    if (local < APPEAR || local > GONE + 0.6) return;
    const open = smoothstep(APPEAR, APPEAR + 1.4, local);
    const fly = smoothstep(14.6, 15.9, local);
    const fade = 1 - smoothstep(GONE, GONE + 0.6, local);
    const wound = clamp((local - 4.6) / 6.4) * 0.85;
    const aspect = this.ctx.W / this.ctx.H;
    const zc = 3.6 - fly * 3.8;
    const yc = 3.24 + fly * 0.22;
    camera(this.heartVp, {
      eye: [Math.sin(local * 0.4) * 0.05, yc, zc],
      at: [0, 0.08, 0], fov: 1.02, near: 0.2, far: 60, aspect,
    });

    let n = 0;
    const beat = beatAt(f.F, f.t);
    const pulse = beat ? beat.fresh : 0;
    for (const p of this.heartPts) {
      n = writeInstance(this.heartData, n, {
        p: p.p, s: 0.10, r: p.r,
        c: [0.35, 0.10, 0.15],
        a: local * 0.10 + open + 2.0 * p.r[1],
        scale: [p.s, p.s, 0],
      });
    }
    this.heartStage.update(this.heartData, n).render(out, {
      vp: this.heartVp, point: 2.6, soft: 1, opacity: (0.22 + 0.78 * open) * fade,
      uniforms: { uT: f.t, uWound: wound, uPulse: pulse, uOpen: fly * 1.6 },
    });
  }
}
