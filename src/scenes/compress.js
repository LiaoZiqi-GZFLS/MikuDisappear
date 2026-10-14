// 3:29.7 - the compressed farewell.
//
// The compression is not a filter this time; it is a machine. A 96 m bay,
// two 36 m platens, twelve hydraulic rams, and one 5 cm seam left in the
// middle of them: bitrate, colour depth and geometry are taken away in
// public, and the farewell gets smaller so that more of it survives.
//
// The shot is the move. The lens opens *inside* the machine -- in the gap,
// with 18 m of platen standing 8 m to either side -- and spends the sixteen
// seconds backing out and climbing, so the last frame is the whole bay seen
// from 66 m with one line of light down the middle of it. The retreat lives
// inside the shot: the global camera table for this chapter is a still frame
// (docs/镜头表.md), which is why 60 m of dolly costs no pan budget.
//
// Every readout is built from the same numbers the geometry is placed from:
// `gapAt()` drives the platen faces, the rod travel, the sheets of light, the
// pressure, and the pixel width of the seam printed in the corner.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import {
  clamp, hash, label, lyricLine, machineChrome, panel, smoothstep, wave,
} from "../kit.js";
import { futureLight, motifLabel, note } from "../motifs.js";
import { beatAt } from "../semantics.js";
import { Stage3D, camera, mat4, project, rgb, writeInstance } from "../gl3d.js";
import { draw as drawText, pad } from "../type.js";
import { audioU, layer, line } from "./util.js";

const FRAG = `
uniform float uT;
uniform float uVocal;
uniform float uKick;
uniform float uSqueeze;   // 0 = untouched, 1 = everything compressed away
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec3 col = C_INK;

  // 8x8 macroblocks: the picture is stored as blocks now
  vec2 blocks = mix(vec2(240.0, 135.0), vec2(24.0, 14.0), uSqueeze);
  vec2 buv = floor(uv * blocks) / blocks;
  float band = hash21(buv * 91.0) - 0.5;
  col += C_TEAL_DEEP * 0.16 * (0.5 + band * 0.6) * (0.5 + uVocal);

  // comb filter: quantised columns of whatever is left
  float comb = step(0.5, fract(uv.x * mix(360.0, 40.0, uSqueeze) + uT * 0.3));
  col *= mix(1.0, 0.85 + 0.3 * comb, uSqueeze * 0.7);

  // colour depth collapses: posterised steps
  float levels = mix(32.0, 3.0, uSqueeze);
  col = floor(col * levels + 0.5) / levels;

  col += C_MIKU * 0.10 * uKick * exp(-pow((uv.y - 0.5) * 20.0, 2.0)) * (1.0 - uSqueeze * 0.6);
  // the picture narrows to a vertical slit. This is the *image* being
  // compressed; the machine that does it is geometry and is drawn after this
  // pass, so the room survives the squeeze and only the light loses.
  float slit = smoothstep(0.5 * uSqueeze, 0.5 * uSqueeze + 0.004, abs(uv.x - 0.5));
  col *= 1.0 - slit * uSqueeze * 0.88;
  fragColor = vec4(col, 1.0);
}`;

// ---- the bay, in metres ----------------------------------------------------
// The machine is only epic if its size is a fact. These are the numbers the
// geometry is placed from and the numbers the instruments print, and they are
// the same ones written into the shooting script (v9, chapter 13).
const BAY = {
  halfW: 16.0,        // clear half-width of the bay
  height: 22.0,       // to the underside of the portal frames
  zNear: 34.0,        // the near end of the bay: behind the lens at 0:00
  zFar: -62.0,        // ...and 96 m of room beyond it
  ribs: 8,            // portal frames, one every 12 m
  ribGap: 12.0,
  platenHalfLen: 18.0,   // each platen is 36 m long
  platenH: 18.0,         // and 18 m tall
  platenHalfT: 1.2,      // 2.4 m of steel
  ramY: [5.0, 11.5],     // two rows of rams
  ramZ: [-11.0, 0.0, 11.0],
  ramOuter: 17.5,        // where a ram is anchored to the frame
  ramInner: 13.0,        // where its piston leaves the barrel
  barrelHalf: 2.25,      // a 4.5 m barrel
  barrelR: 1.15,         // 2.30 m bore
  open: 16.00,           // the gap when the chapter opens
  shut: 0.05,            // ...and when it has finished: five centimetres
  force: 8192,           // kN at full pressure -- the film's number, x1000
  sheets: 7,             // panes of song standing in the gap
  notes: 24,             // notes that will not survive the squeeze
  dust: 260,
};
const TRAVEL = (BAY.open - BAY.shut) / 2;             // 7.975 m per platen

const squeezeAt = (local) => clamp((local - 2.0) / 11.0);
const gapAt = (squeeze) => BAY.open + (BAY.shut - BAY.open) * squeeze;
// The back face of a platen: the inner face sits on the gap, the casting is
// 2.4 m thick, and the piston has to reach the far side of it.
const backAt = (gap) => gap / 2 + 2 * BAY.platenHalfT;

export default class Compress extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "compress");
    this.title = null;

    this.vp = mat4();
    // One stage per kind of thing: the castings are dark mass, everything
    // else is light. Order matters more than depth here -- there is no depth
    // buffer in this renderer, so the steel goes down first and the light is
    // added on top of it.
    this.steel = new Stage3D(ctx, "rect");     // the platens and their ribs
    this.room = new Stage3D(ctx, "segment");   // frames, rails, rods
    this.edge = new Stage3D(ctx, "quad");      // the castings' outlines
    this.rams = new Stage3D(ctx, "tube");      // twelve hydraulic barrels
    this.light = new Stage3D(ctx, "rect");     // the song, inside the gap
    this.notes = new Stage3D(ctx, "rect");     // notes being crushed
    this.air = new Stage3D(ctx, "point");      // dust pulled into the seam
    this.steelData = new Float32Array(48 * 16);
    this.roomData = new Float32Array(320 * 16);
    this.edgeData = new Float32Array(32 * 16);
    this.ramData = new Float32Array(16 * 16);
    this.lightData = new Float32Array(64 * 16);
    this.noteData = new Float32Array((BAY.notes + 2) * 16);
    this.airData = new Float32Array(BAY.dust * 16);

    // The dust is the room's own air: 260 grains, deterministic, drawn toward
    // the seam as the pressure comes up.
    this.grains = [];
    for (let i = 0; i < BAY.dust; i++) {
      const h = (k) => hash(i * 7.13 + k * 41.7);
      this.grains.push({
        x: (h(1) - 0.5) * 2 * (BAY.halfW - 1),
        y: 0.4 + h(2) * (BAY.height - 1.5),
        z: BAY.zFar + h(3) * (BAY.zNear - BAY.zFar),
        ph: h(4) * Math.PI * 2,
      });
    }
  }

  async init() {
    this.title = line(this.ctx.features, "\u5727\u7e2e\u3055\u308c\u305f\u5225\u308c\u306e\u6b4c");
  }

  render(f, out) {
    const t = f.t;
    const local = t - 209.69;
    const squeeze = squeezeAt(local);
    const gap = gapAt(squeeze);
    this.pass.draw({ dst: out, u: audioU(f, { uSqueeze: squeeze }) });

    const cam = this.view(local, this.ctx.W / this.ctx.H);
    this.eyeNow = cam.eye;
    this.machinePass(out, f, t, local, squeeze, gap);

    const c = this.text.ctx;
    this.text.clear();

    // Where the seam is on screen, from the room's own matrix: the 2D layer
    // is not allowed to guess where the light ended up.
    const [sxA, sxB, seamPx] = this.seamScreen(this.ctx.W, this.ctx.H, gap);
    const seamX = (sxA + sxB) / 2;

    const bt = beatAt(f.F, t);
    const bid = bt ? bt.id : "";
    const bA = bt ? Math.min(bt.fresh, 1 - bt.exit) : 0;

    if (bid === "future_illusion") {
      futureLight(c, 1080, 110, 620, 280, {
        alpha: bA,
        fade: 1 - bt.fresh,
      });
      const slit = bt.fresh;
      const open = 620 * (1 - 0.85 * slit);
      const side = (620 - open) * 0.5;
      c.fillStyle = css("ink", 0.86 * bA);
      c.fillRect(1080, 110, side, 280);
      c.fillRect(1080 + 620 - side, 110, side, 280);
      motifLabel(c, "LIGHT LEAVING", 1080, 102, {
        color: css("amber", 0.8 * (1 - slit)),
      });
    }
    if (bid === "sacrifice_sound") {
      const kept = 1 - bt.fresh;
      for (let i = 0; i < 9; i++) {
        const alive = i / 9 < kept;
        note(c, 760 + i * 118, 606 + Math.sin(i * 1.7) * 10, 18, {
          alpha: alive ? 0.55 : 0.10,
          color: alive ? css("miku", 0.75) : css("dim", 0.5),
        });
      }
      c.fillStyle = css("ink2", 0.86);
      c.fillRect(1080, 548, 620, 46);
      c.strokeStyle = css("bone", 0.55);
      c.lineWidth = 1;
      c.strokeRect(1080.5, 548.5, 619, 45);
      label(c, "MESSAGE PRESERVED / SOUND DISCARDED", 1390, 577, {
        size: 17, align: "center", tracking: 2, color: css("bone", 0.9),
      });
      motifLabel(c, "SACRIFICE", 760, 590, {
        color: css("red", 0.7),
      });
    }

    // text is squeezed with the picture
    const textSqueeze = squeeze * 0.55;
    c.save();
    c.translate(960, 0);
    c.scale(1 - textSqueeze, 1);
    c.translate(-960, 0);

    const active = f.line;
    if (active && active.kind === "line") {
      lyricLine(c, active, t, f.F, {
        x: 960, y: 300, size: 74, weight: 900, align: "center", maxWidth: 1700,
        sung: css("bone", 0.95), dim: css("ash", 0.6),
      });
    }
    if (this.title && t > this.title.start - 0.2) {
      const a = clamp((t - this.title.start) / 0.5);
      c.save();
      c.globalAlpha = a;
      drawText(c, "\uff1c\u5727\u7e2e\u3055\u308c\u305f\u5225\u308c\u306e\u6b4c\uff1e", {
        x: 960, y: 420, size: 60, weight: 900, align: "center", color: css("bone", 0.95),
      });
      label(c, "COMPRESSED FAREWELL / 32 kbps", 960, 462, {
        size: 18, align: "center", tracking: 4, color: css("red", 0.85),
      });
      c.restore();
    }
    c.restore();

    // the codec: what is being thrown away, in the language the chapter has
    // used for the whole film
    panel(c, 84, 640, 520, 280, {
      fill: css("ink2", 0.9), corner: 10, cornerColor: css("red", 0.5), stroke: css("dim", 0.5),
    });
    label(c, "ENCODER", 100, 632, { size: 17, tracking: 1.8, color: css("ash", 0.95) });
    const kbps = 320 - 288 * squeeze;
    drawText(c, kbps.toFixed(0), {
      x: 580, y: 700, size: 62, weight: 600, mono: true, align: "right",
      color: kbps < 96 ? css("red", 0.95) : css("bone", 0.95),
    });
    label(c, "kbps", 100, 700, { size: 18, color: css("ash", 0.85), tracking: 1.4 });
    const rows = [
      ["BIT DEPTH", `${Math.max(3, Math.round(16 - 13 * squeeze))} bit`],
      ["BLOCK SIZE", `${Math.round(8 + 24 * squeeze)}\u00d7${Math.round(8 + 24 * squeeze)}`],
      ["DISCARDED", `${(squeeze * 94.0).toFixed(1)} %`],
    ];
    rows.forEach(([k, v], i) => {
      const y = 760 + i * 44;
      label(c, k, 100, y, { size: 17, color: css("ash", 0.85), tracking: 1.2 });
      label(c, v, 580, y, { size: 19, align: "right", color: css("bone", 0.9), tracking: 1.2 });
    });

    // the press: the same loss told as tonnage. The pressure falls 320 -> 32
    // bar exactly as the bitrate falls 320 -> 32 kbps, because they are the
    // same loss measured at two ends of the same cable.
    panel(c, 1316, 640, 520, 300, {
      fill: css("ink2", 0.9), corner: 10, cornerColor: css("miku", 0.5), stroke: css("dim", 0.5),
    });
    label(c, "PRESS", 1332, 632, { size: 17, tracking: 1.8, color: css("ash", 0.95) });
    drawText(c, pad(Math.round(BAY.force * squeeze), 5), {
      x: 1820, y: 706, size: 56, weight: 600, mono: true, align: "right",
      color: css("bone", 0.95),
    });
    label(c, "kN", 1332, 704, { size: 18, color: css("ash", 0.85), tracking: 1.4 });
    const pressRows = [
      ["GAP", `${gap.toFixed(2)} m`],
      ["RAM TRAVEL", `${(TRAVEL * squeeze).toFixed(2)} m`],
      ["PRESSURE", `${Math.round(320 - 288 * squeeze)} bar`],
      ["PLATENS", "2 \u00d7 36.0 \u00d7 18.0 m"],
      ["SEAM AT FAR END", `${seamPx.toFixed(1)} px`],
    ];
    pressRows.forEach(([k, v], i) => {
      const y = 752 + i * 38;
      label(c, k, 1332, y, { size: 16, color: css("ash", 0.85), tracking: 1.2 });
      label(c, v, 1820, y, { size: 18, align: "right", color: css("bone", 0.9), tracking: 1.2 });
    });

    // the waveform with its resolution removed. It is about to be replaced by
    // the one line that survives.
    const band = smoothstep(7.5, 12.8, local) * (1 - smoothstep(14.4, 16.0, local));
    const step = 2 + 26 * squeeze;
    wave(c, f.F, t, {
      x: 640, y: 700, w: 600, h: 140, span: 1.6, step, lw: 2,
      color: css("miku", 0.8 - 0.4 * squeeze), amp: 1.15,
      alpha: 1 - 0.8 * band,
    });
    c.strokeStyle = css("dim", 0.5);
    c.setLineDash([4, 6]);
    c.beginPath();
    c.moveTo(640, 770);
    c.lineTo(1240, 770);
    c.stroke();
    c.setLineDash([]);
    label(c, `RESOLUTION ${Math.round(200 - 180 * squeeze)} / 200`, 640, 690, {
      size: 16, tracking: 1.4, color: css("ash", 0.85),
    });
    label(c, "BYTES KEPT", 640, 900, { size: 16, color: css("ash", 0.8), tracking: 1.4 });
    drawText(c, `${pad(Math.round(kbps * 24), 5)}`, {
      x: 1240, y: 902, size: 26, weight: 600, mono: true, align: "right", color: css("ash", 0.85),
    });

    // The line that is kept: everything she still has to say, pressed into a
    // single light band, standing exactly where the machine's own seam is.
    if (band > 0.01) {
      c.save();
      c.globalAlpha = band;
      const glow = c.createLinearGradient(seamX - 100, 0, seamX + 100, 0);
      glow.addColorStop(0, css("miku", 0));
      glow.addColorStop(0.5, css("miku", 0.09));
      glow.addColorStop(1, css("miku", 0));
      c.fillStyle = glow;
      c.fillRect(seamX - 100, 0, 200, 1080);
      c.fillStyle = css("mikuHi", 0.50);
      c.fillRect(Math.round(seamX) - 1, 96, 2, 888);
      c.save();
      c.translate(seamX, 540);
      c.rotate(Math.PI / 2);
      wave(c, f.F, t, {
        x: -430, y: -8, w: 860, h: 14, span: 1.1, lw: 1,
        color: css("mikuHi", 0.6), amp: 0.7,
      });
      c.restore();
      label(c, "1 px \u2014 MESSAGE KEPT", seamX + 26, 150, {
        size: 15, tracking: 2, color: css("mikuHi", 0.8),
      });
      label(c, "SOUND DISCARDED", seamX + 26, 174, {
        size: 13, tracking: 2, color: css("red", 0.7),
      });
      c.restore();
    }

    // The instruments leave before the curtain does. The hand-over to `final`
    // starts closing the cloth at 4:13.9, and a reading that gets eaten by a
    // transition is a reading the film is not allowed to print. The layer is
    // wiped rather than faded -- text sets its own alpha, so a group opacity
    // would leave every readout printed on top of the cloth. What survives is
    // the seam itself, because the seam is geometry and not annotation.
    const uiFade = 1 - smoothstep(13.4, 14.9, local);
    if (uiFade < 0.999) {
      c.save();
      c.globalCompositeOperation = "destination-out";
      c.fillStyle = `rgba(0,0,0,${(1 - uiFade).toFixed(3)})`;
      c.fillRect(0, 0, this.ctx.W, this.ctx.H);
      c.restore();
    }

    machineChrome(c, { name: "", left: "COMPRESSION", right: `T+${local.toFixed(1)} s` });

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    return {
      bloom: 0.62 - 0.22 * squeeze,
      exposure: 0.98,
      grain: 0.03 + 0.03 * squeeze,
      vignette: 0.7,
      scan: 0.05 + 0.08 * squeeze,
      ca: 0.002 + 0.006 * squeeze,
      zoom: 1 + 0.02 * squeeze,
      fade: 0.5 * smoothstep(13.5, 16.0, local),
    };
  }

  // ------------------------------------------------------------------ lens
  // One continuous move, sixteen seconds, no cuts: the lens starts 12 m in
  // front of the castings -- close enough that the two end caps run off the
  // top and bottom of the frame -- and backs away and climbs while the press
  // closes. By the end it is 66 m from the bay's mouth and 12.2 m up, and the
  // press has become a monument with a seam in it.
  view(local, aspect) {
    const back = smoothstep(1.2, 13.4, local);
    const lift = smoothstep(2.6, 15.6, local);
    const eye = [
      5.2 - 4.0 * back,
      5.40 + 6.80 * lift,
      26.0 + 20.0 * back,
    ];
    const at = [0, 4.40 + 1.20 * lift, -34.0 + 4.0 * back];
    const fov = 0.94 - 0.08 * back;
    camera(this.vp, { eye, at, fov, near: 0.3, far: 420, aspect });
    const cam = { eye, at, fov };
    this.lastCam = cam;   // QA hook: the probe reads the scene's own operator
    return cam;
  }

  // The seam, measured in the room's own perspective: how wide the gap
  // actually is on screen at the *far* end of the castings, which is the one
  // plane of the press that is in front of the lens for the whole chapter.
  // The printout in the corner and the light in the picture cannot disagree.
  seamScreen(W, H, gap) {
    const a = project(this.vp, [-gap / 2, BAY.platenH / 2, -BAY.platenHalfLen], W, H);
    const b = project(this.vp, [gap / 2, BAY.platenH / 2, -BAY.platenHalfLen], W, H);
    return [a[0], b[0], Math.abs(b[0] - a[0])];
  }

  // ------------------------------------------------------------------ set
  // Everything is written fresh from `local` each frame: no state, so any
  // frame of the chapter renders on its own.
  machinePass(out, f, t, local, squeeze, gap) {
    const MI = rgb("miku"), HI = rgb("mikuHi"), DEEP = rgb("tealDeep");
    const BO = rgb("bone"), INK2 = rgb("ink2"), SLATE = rgb("slate");
    const faceX = gap / 2;                     // inner face of a platen
    const cx = faceX + BAY.platenHalfT;        // its centreline
    const back = backAt(gap);                  // where the pistons land
    const fog = { dist: 170, c: rgb("ink") };
    const air = (opts = {}) => ({ vp: this.vp, eye: this.lastCam.eye, fog, ...opts });

    // ---- the castings: dark mass first, so every light after it is light
    // standing *in front of* steel rather than painted on a black frame
    let k = 0;
    for (const s of [-1, 1]) {
      // the face the gap lives between: 36 m long, 18 m tall
      k = writeInstance(this.steelData, k, {
        p: [s * faceX, BAY.platenH / 2, 0], s: 1, c: INK2, a: 0.94,
        r: [0, s * Math.PI / 2, 0],
        scale: [BAY.platenHalfLen, BAY.platenH / 2, 1],
      });
      // the end caps: once the lens is outside, this is the whole machine --
      // two 2.4 m slabs of steel with a hairline between them
      for (const e of [-1, 1]) {
        k = writeInstance(this.steelData, k, {
          p: [s * cx, BAY.platenH / 2, e * BAY.platenHalfLen], s: 1, c: SLATE, a: 0.92,
          scale: [BAY.platenHalfT, BAY.platenH / 2, 1],
        });
      }
      // the top face, so the mass has a top edge when the lens is above it
      k = writeInstance(this.steelData, k, {
        p: [s * cx, BAY.platenH, 0], s: 1, c: DEEP, a: 0.45,
        r: [-Math.PI / 2, 0, 0], scale: [BAY.platenHalfLen, BAY.platenHalfT, 1],
      });
      // ribs on the outboard side: a casting, not a box
      for (let i = -3; i <= 3; i++) {
        k = writeInstance(this.steelData, k, {
          p: [s * (cx + BAY.platenHalfT + 0.10), BAY.platenH / 2, i * 5.1], s: 1,
          c: DEEP, a: 0.5, r: [0, s * Math.PI / 2, 0],
          scale: [0.42, 8.55, 1],
        });
      }
    }
    this.steel.update(this.steelData, k).render(out, {
      vp: this.vp, opacity: 1, mode: "normal", clearAlpha: 0, premul: true,
    });

    // ---- the outlines of those castings: the only thing that survives the
    // squeeze on the steel itself
    let e = 0;
    for (const s of [-1, 1]) {
      e = writeInstance(this.edgeData, e, {
        p: [s * (cx + BAY.platenHalfT + 0.06), BAY.platenH / 2, 0], s: 1,
        c: MI, a: 0.26, r: [0, s * Math.PI / 2, 0],
        scale: [BAY.platenHalfLen, BAY.platenH / 2, 1],
      });
      for (const zz of [-1, 1]) {
        e = writeInstance(this.edgeData, e, {
          p: [s * cx, BAY.platenH / 2, zz * (BAY.platenHalfLen + 0.06)], s: 1,
          c: MI, a: 0.32, scale: [BAY.platenHalfT, BAY.platenH / 2, 1],
        });
      }
    }
    this.edge.update(this.edgeData, e).render(out, air());

    // ---- the room the machine stands in: eight portal frames, the rails,
    // the ties, and the crane that walks the bay while the press closes
    let n = 0;
    const seg = (p0, p1, c, a) => {
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
      const L = Math.hypot(dx, dy, dz);
      if (L < 1e-4 || n + 16 > this.roomData.length) return;
      n = writeInstance(this.roomData, n, {
        p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2],
        s: 1, c, a,
        r: [-Math.asin(Math.max(-1, Math.min(1, dz / L))), 0, Math.atan2(-dx, dy)],
        scale: [1, L / 2, 1],
      });
    };
    for (let i = 0; i < BAY.ribs; i++) {
      const z = BAY.zNear - i * BAY.ribGap;
      const a = 0.11 - i * 0.007;
      for (const s of [-1, 1]) {
        seg([s * BAY.halfW, 0, z], [s * BAY.halfW, BAY.height, z], MI, a);
        seg([s * BAY.halfW, 11.0, z], [s * BAY.halfW * 0.87, 15.6, z], MI, a * 0.55);
      }
      seg([-BAY.halfW, BAY.height, z], [BAY.halfW, BAY.height, z], MI, a);
      seg([-BAY.halfW * 0.94, BAY.height - 1.7, z], [BAY.halfW * 0.94, BAY.height - 1.7, z], DEEP, a * 0.5);
    }
    for (const x of [-15, -10, -5, 0, 5, 10, 15]) {
      seg([x, 0, BAY.zNear], [x, 0, BAY.zFar], x === 0 ? DEEP : MI, x === 0 ? 0.05 : 0.055);
    }
    for (let z = BAY.zNear; z >= BAY.zFar; z -= 12) {
      seg([-BAY.halfW, 0, z], [BAY.halfW, 0, z], DEEP, 0.022);
    }
    // the crane: a runway along both walls and a bridge that keeps pace with
    // the squeeze, so the room has one thing moving in it besides the press
    const gz = BAY.zNear - 6 - 34 * squeeze;
    for (const s of [-1, 1]) {
      seg([s * BAY.halfW, 20.6, BAY.zNear], [s * BAY.halfW, 20.6, BAY.zFar], MI, 0.075);
    }
    seg([-BAY.halfW, 20.6, gz], [BAY.halfW, 20.6, gz], BO, 0.13);
    seg([-1.0, 20.6, gz], [-1.0, 18.9, gz], BO, 0.10);
    seg([1.0, 20.6, gz], [1.0, 18.9, gz], BO, 0.10);
    seg([-1.0, 18.9, gz], [1.0, 18.9, gz], BO, 0.10);
    // the pistons: one hairline per ram, from the barrel's mouth to the back
    // of the casting. Its length *is* the ram travel, and the readout says so.
    for (const s of [-1, 1]) {
      for (const y of BAY.ramY) {
        for (const z of BAY.ramZ) {
          seg([s * BAY.ramInner, y, z], [s * back, y, z], BO, 0.15);
          seg([s * back, y - 0.55, z], [s * back, y + 0.55, z], BO, 0.20);
        }
      }
    }
    // the machined face of the casting: cross-hatching on the end cap, so the
    // last frame of the chapter is two slabs of steel and not two silhouettes
    for (const s of [-1, 1]) {
      for (let i = 1; i <= 9; i++) {
        const y = i * 1.8;
        seg([s * faceX, y, BAY.platenHalfLen], [s * (faceX + 2 * BAY.platenHalfT), y, BAY.platenHalfLen], BO, 0.085);
      }
      // vertical serrations: the cap is a machined face, not a pane of glass
      for (let i = 1; i <= 4; i++) {
        const x = faceX + (i * 2 * BAY.platenHalfT) / 5;
        seg([s * x, 0.2, BAY.platenHalfLen], [s * x, BAY.platenH - 0.2, BAY.platenHalfLen], BO, 0.05);
      }
      seg([s * cx, 0.2, BAY.platenHalfLen], [s * cx, BAY.platenH - 0.2, BAY.platenHalfLen], MI, 0.14);
    }
    this.room.update(this.roomData, n).render(out, air());

    // ---- the rams themselves: twelve barrels, each one a cage of 92
    // segments (see GEO.tube), anchored outside the clear width of the bay
    let r = 0;
    const ramCx = (BAY.ramOuter + BAY.ramInner) / 2;
    for (const s of [-1, 1]) {
      for (const y of BAY.ramY) {
        for (const z of BAY.ramZ) {
          r = writeInstance(this.ramData, r, {
            p: [s * ramCx, y, z], s: 1, c: DEEP, a: 0.62,
            r: [0, 0, Math.PI / 2],
            scale: [BAY.barrelR, BAY.barrelHalf, BAY.barrelR],
          });
        }
      }
    }
    this.rams.update(this.ramData, r).render(out, air({ opacity: 0.9 }));

    // ---- the song, inside the gap: seven panes standing one behind the
    // other, 14 m tall when the press opens and five centimetres wide when it
    // has finished. This is the thing the chapter is about.
    let q = 0;
    const half = gap / 2;
    for (let i = 0; i < BAY.sheets; i++) {
      const z = 12 - i * 4;
      const a = 0.036 - i * 0.0026;
      q = writeInstance(this.lightData, q, {
        p: [0, 7.0, z], s: 1, c: MI, a: a * (1 - 0.25 * squeeze),
        scale: [half * 0.92, 7.0, 1],
      });
      q = writeInstance(this.lightData, q, {
        p: [0, 7.0, z - 0.22], s: 1, c: HI, a: a * 0.55,
        scale: [half * 0.16, 6.85, 1],
      });
    }
    // the seam itself: the last pane, at the mouth of the machine, always
    // exactly as wide as the gap
    q = writeInstance(this.lightData, q, {
      p: [0, 7.0, BAY.platenHalfLen], s: 1, c: HI, a: 0.16 + 0.40 * squeeze,
      scale: [half, 7.0, 1],
    });
    this.light.update(this.lightData, q).render(out, air({ soft: 0.92, opacity: 0.95 }));

    // ---- the notes. Each one sits at a fixed x, and dies when the steel
    // reaches it: the flash is the moment of contact, not a fade
    let m = 0;
    for (let i = 0; i < BAY.notes; i++) {
      const h1 = hash(i * 1.71 + 0.31), h2 = hash(i * 3.13 + 0.77), h3 = hash(i * 5.37 + 1.19);
      const x = (h1 - 0.5) * BAY.open * 0.86;
      // the face closes inward from 8 m: a note is still whole while the
      // steel is outboard of it, and it is crushed the moment the face
      // reaches its x. The flash is the moment of contact, not a fade.
      const clear = clamp((half - Math.abs(x)) / 0.40);      // 0 = crushed
      const flash = Math.exp(-(1 - clear) * 7.0);
      const a = 0.24 * clear + 0.55 * flash;
      if (a < 0.01) continue;
      const y = 2.4 + h2 * 11.0;
      const z = 13 - h3 * 26;
      m = writeInstance(this.noteData, m, {
        p: [x, y, z], s: 1,
        c: flash > 0.35 ? rgb("red") : rgb("ash"),
        a: clamp(a),
        r: [0, 0, h3 * 0.5 + t * 0.08],
        scale: [0.10, 0.16, 1],
      });
    }
    if (m) this.notes.update(this.noteData, m).render(out, air({ opacity: 0.95 }));

    // ---- the air. Dust is pulled towards the seam as the pressure comes up,
    // which is the only cue in the frame that the machine is not just closing
    // but drawing something in.
    let d = 0;
    for (const g of this.grains) {
      const pull = 1 - 0.86 * squeeze;
      const x = g.x * pull + Math.sin(t * 0.4 + g.ph) * 0.10;
      const y = g.y + Math.cos(t * 0.3 + g.ph) * 0.10;
      const a = (0.055 + 0.05 * clamp(1 - Math.abs(x) / (BAY.halfW * pull)))
        * (0.35 + 0.65 * squeeze);
      d = writeInstance(this.airData, d, {
        p: [x, y, g.z], s: 1, c: rgb("mikuHi"), a: clamp(a),
      });
    }
    this.air.update(this.airData, d).render(out, air({ point: 2.4, sprite: 1 }));
  }

  dispose() {
    this.steel.dispose();
    this.room.dispose();
    this.edge.dispose();
    this.rams.dispose();
    this.light.dispose();
    this.notes.dispose();
    this.air.dispose();
  }
}
