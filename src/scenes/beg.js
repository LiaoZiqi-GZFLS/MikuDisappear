// 2:42.7 - the request. The machine asks its master to delete it, inside the
// dialog box that would do it.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import { clamp, label, machineChrome, panel, smoothstep, wave } from "../kit.js";
import { hand, listener, motifLabel, singer } from "../motifs.js";
import { beatAt } from "../semantics.js";
import { Stage3D, camera, mat4, project, rgb, writeInstance } from "../gl3d.js";
import { CIRCUIT, buildRun, pulseAt, pulsePhase, runOf } from "../circuit.js";
import { draw as drawText, fitSize, font, layout } from "../type.js";
import { audioU, layer, line } from "./util.js";

const FRAG = `
uniform float uT;
uniform float uVocal;
uniform float uKick;
uniform float uDamage;
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec3 col = C_INK;
  // the screen behind the dialog is already broken
  float n = fbm(uv * vec2(6.0, 4.0) + uT * 0.05);
  float bite = smoothstep(0.44, 0.72, n * uDamage);
  col += C_TEAL_DEEP * bite * 0.35;
  float grid = smoothstep(0.485, 0.5, abs(fract(uv.y * 36.0) - 0.5));
  col += C_MIKU * grid * 0.02;
  col += C_MIKU * 0.05 * uVocal * exp(-pow((uv.y - 0.86) * 8.0, 2.0));
  col += C_RED * 0.05 * uKick * exp(-pow((uv.y - 0.5) * 4.0, 2.0)) * uDamage;
  fragColor = vec4(col, 1.0);
}`;

export default class Beg extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "beg");
    this.rows = [];

    // The dialog is not a window pasted on black; it is a door standing in a
    // room. The door itself stays a 2D system window -- that is the whole
    // point of it -- but it has thickness, a floor, dust in the air, and the
    // red light of the OK button spilling down onto the ground.
    this.vp = mat4();
    this.room = new Stage3D(ctx, "segment");
    this.glows = new Stage3D(ctx, "rect");
    this.dust = new Stage3D(ctx, "point");
    this.circuit = new Stage3D(ctx, "segment");
    this.roomData = new Float32Array(96 * 16);
    this.glowData = new Float32Array(6 * 16);
    this.dustData = new Float32Array(110 * 16);
    const cableFloats = CIRCUIT.strands * CIRCUIT.segs;
    this.cableData = new Float32Array(cableFloats * 16);
    this.cableU = new Float32Array(cableFloats);
    this.cableCore = new Uint8Array(cableFloats);
    this.cableCol = new Float32Array(cableFloats * 3);
    this.cableCount = 0;
    this.dustSeeds = [];
    for (let i = 0; i < 110; i++) {
      const h = (k) => {
        const s = Math.sin(i * 9.71 + k * 33.13) * 19578.5453;
        return s - Math.floor(s);
      };
      this.dustSeeds.push({
        x: (h(1) - 0.5) * 4.4,
        y: -0.7 + h(2) * 1.7,
        z: 0.2 + h(3) * 2.2,
        phase: h(4) * Math.PI * 2,
      });
    }

    // The other end of the run (src/circuit.js). plea's cable does not stop at
    // the socket wall: it comes out from under this door and lands on the OK
    // key. This room sees the last metres of the same 77 m -- one core, six
    // strands, the same twist -- and in this room the pulse dies at u = 0.86,
    // 10.8 m short of the key. Nobody is pressing, so nothing arrives.
    {
      const p0 = [1.318, -0.672, 0.055];
      const p1 = [1.395, -0.755, 0.165];
      const p2 = [1.175, -0.765, 0.165];
      const p3 = [0.895, -0.478, 0.050];
      this.cableRun = runOf({
        p0, p1, p2, p3, up: [0, 0, 1],
        spread: (s) => (s === 0 ? 0 : 0.022 + 0.007 * (s % 3)),
      });
      this.cableCount = buildRun(this.cableData, 0, this.cableRun, {
        core: rgb("miku"), strand: rgb("tealDeep"), width: 2.4,
        uArr: this.cableU, coreArr: this.cableCore,
      });
      for (let i = 0; i < this.cableCount; i++) {
        this.cableCol[i * 3] = this.cableData[i * 16 + 4];
        this.cableCol[i * 3 + 1] = this.cableData[i * 16 + 5];
        this.cableCol[i * 3 + 2] = this.cableData[i * 16 + 6];
      }
    }
  }

  async init() {
    const F = this.ctx.features;
    this.rows = [
      line(F, "\u5c11\u30b7\u30c0\u30b1\u60aa\u30a4"),
      line(F, "\u30de\u30b9\u30bf\u30fc\u30fb\u30fb\u30fb\u30c9\u30a6\u30ab"),
      line(F, "\u30de\u30b9\u30bf\u30fc\u30ce\u8f9b\u30a4\u9854"),
    ];
  }

  render(f, out) {
    const t = f.t;
    const local = t - 162.69;
    const damage = clamp(local / 12.0);
    this.pass.draw({ dst: out, u: audioU(f, { uDamage: damage }) });
    this.roomPass(out, f);

    const c = this.text.ctx;
    this.text.clear();

    const bt = beatAt(f.F, t);
    const bid = bt ? bt.id : "";
    const bA = bt ? Math.min(bt.fresh, 1 - bt.exit) : 0;
    // the pull-back at the end of the chapter; the small silhouette hands the
    // frame over to the two full ones
    const reveal = clamp((local - 11.0) / 4.5);

    if (bid === "dont_want_sad_face") {
      listener(c, 230, 500, 400, {
        t,
        alpha: 0.08 + 0.30 * bA,
        eyes: "sad",
        sadMouth: true,
        turnAway: true,
        scan: (t * 0.35) % 1,
      });
      motifLabel(c, "DON'T WANT TO SEE YOUR PAIN", 84, 160, {
        color: css("amber", 0.7),
      });
    }
    singer(c, 172, 1010, 280, {
      t,
      alpha: (0.20 + 0.32 * (bid === "beg" || bid === "hand_request" ? bA : 0.10))
        * (1 - 0.9 * reveal),
      eyes: "sad",
      sadMouth: true,
      handsTogether: true,
      mouth: 0.15,
      heart: 0.85,
    });
    if (bid === "hand_request") {
      hand(c, 1516, 770, 260, Math.PI, {
        alpha: 0.20 + 0.35 * bA, press: true, color: css("bone", 0.82),
      });
      motifLabel(c, "PLEASE, BY YOUR HAND", 1516, 744, {
        color: css("red", 0.75), align: "right",
      });
    }

    const dx = 340, dy = 190, dw = 1240, dh = 620;
    // window shadow: a hard offset, no blur
    c.fillStyle = css("ink", 0.85);
    c.fillRect(dx + 12, dy + 12, dw, dh);
    panel(c, dx, dy, dw, dh, {
      fill: css("ink2", 0.97), stroke: css("ash", 0.55), corner: 0, lw: 1,
    });
    // title bar
    c.fillStyle = css("slate", 0.9);
    c.fillRect(dx, dy, dw, 46);
    c.strokeStyle = css("ash", 0.6);
    c.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
    label(c, "SYSTEM \u2014 VOICE BANK MANAGER", dx + 16, dy + 30, {
      size: 18, tracking: 1.4, color: css("bone", 0.9),
    });
    c.strokeStyle = css("ash", 0.7);
    c.strokeRect(dx + dw - 38.5, dy + 12.5, 26, 22);
    label(c, "\u00d7", dx + dw - 25, dy + 29, { size: 18, align: "center", color: css("ash", 0.9) });

    // an icon: the voice as a waveform file
    c.strokeStyle = css("miku", 0.8);
    c.lineWidth = 2;
    c.strokeRect(dx + 56.5, dy + 96.5, 96, 120);
    c.beginPath();
    for (let i = 0; i <= 84; i += 2) {
      const v = Math.sin(i * 0.4 + t * 0.7) * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.11)));
      const x = dx + 64 + i;
      const y = dy + 156 + v * 34;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();

    label(c, "DELETE VOICE BANK  \u201cCV-01 / HATSUNE MIKU\u201d ?", dx + 186, dy + 118, {
      size: 30, weight: 700, tracking: 0.5, color: css("bone", 0.98),
    });
    label(c, "\u3053\u306e\u64cd\u4f5c\u306f\u53d6\u308a\u6d88\u305b\u307e\u305b\u3093\u3002 / This cannot be undone.", dx + 186, dy + 150, {
      size: 18, tracking: 0.5, color: css("ash", 0.9),
    });

    // the message body is the sung request itself
    let by = dy + 230;
    for (const l of this.rows) {
      if (t < l.start - 0.25) continue;
      const fresh = clamp((t - l.start) / 0.35);
      c.save();
      c.globalAlpha = fresh;
      const size = fitSize(c, l.text, dw - 260, { max: 40, min: 22, weight: 700, tracking: 0.5 });
      this.karaoke(c, l, t, f.F, { x: dx + 186, y: by, size });
      c.restore();
      by += 116;
    }

    // buttons
    const bx = dx + dw - 300, byy = dy + dh - 92;
    const hover = clamp((local - 1.0) / 2.0);
    c.fillStyle = css("ink", 0.6);
    c.fillRect(bx, byy, 120, 52);
    c.strokeStyle = hover > 0.4 ? css("red", 0.95) : css("ash", 0.7);
    c.lineWidth = hover > 0.4 ? 2 : 1;
    c.strokeRect(bx + 0.5, byy + 0.5, 119, 51);
    label(c, "OK", bx + 60, byy + 34, { size: 22, align: "center", tracking: 2, color: css("bone", 0.9) });
    c.strokeStyle = css("ash", 0.5);
    c.lineWidth = 1;
    c.strokeRect(bx + 148.5, byy + 0.5, 140, 51);
    label(c, "CANCEL", bx + 218, byy + 34, { size: 22, align: "center", tracking: 2, color: css("ash", 0.75) });

    // the cursor: hovering over OK, trembling, never pressing
    const tremble = Math.sin(t * 9.0) * 2 + Math.sin(t * 23.0) * 1.2;
    const cx = bx + 60 + tremble * hover;
    const cy = byy + 26 + Math.cos(t * 7.0) * 2 * hover;
    c.fillStyle = css("bone", 0.95);
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx, cy + 26);
    c.lineTo(cx + 7, cy + 19);
    c.lineTo(cx + 18, cy + 30);
    c.lineTo(cx + 24, cy + 24);
    c.lineTo(cx + 13, cy + 13);
    c.lineTo(cx + 21, cy + 6);
    c.closePath();
    c.fill();

    // The other end of the wire (src/circuit.js): it comes out from under this
    // door and lands on the OK key. Same run, same seven strands, same pulse
    // -- but in this room the pulse dies at u = 0.86, 10.8 m short of the key.
    // The wire hangs in front of the window, so its readouts are drawn here
    // with the rest of the layer and the wire itself lands on the frame after
    // the dialog (see the end of render()).
    this.cableLabels(c, t, local);

    // footer: what the machine will not say out loud
    label(c, `REQUEST OPEN  ${local.toFixed(1)} s`, dx + 16, dy + dh - 20, {
      size: 17, tracking: 1.4, color: css("ash", 0.85),
    });
    label(c, "AWAITING OPERATOR", dx + dw - 16, dy + dh - 20, {
      size: 17, align: "right", tracking: 1.4, color: css("red", 0.85),
    });

    // Shot 35: the camera lets go of the window and both of them are in the
    // frame, with the red glow of the button between them -- the whole film's
    // question in one picture.
    if (reveal > 0.001) {
      singer(c, 250, 1050, 430, {
        t, alpha: 0.26 * reveal, handsTogether: true, eyes: "sad",
        sadMouth: true, light: 0.3,
      });
      listener(c, 1700, 1050, 430, {
        t, alpha: 0.22 * reveal, eyes: "sad", sadMouth: true,
      });
      motifLabel(c, "CV-01", 250, 520, {
        align: "center", color: css("miku", 0.45 * reveal),
      });
      motifLabel(c, "OPERATOR", 1700, 520, {
        align: "center", color: css("amber", 0.45 * reveal),
      });
    }

    // the voice, small, still singing underneath
    wave(c, f.F, t, {
      x: 84, y: 900, w: 1752, h: 80, span: 2.0, lw: 1.4,
      color: css("miku", 0.35), amp: 0.8,
    });
    drawText(c, "VOICE BANK CV-01 \u2014 1024 VOICES \u2014 LAST REQUEST", {
      x: 960, y: 1010, size: 16, align: "center", color: css("dim", 0.9),
      mono: true, tracking: 2,
    });
    machineChrome(c, { name: "", left: "REQUEST", right: "\u30de\u30b9\u30bf\u30fc\u30ce\u8f9b\u30a4\u9854" });

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    // The run is the one thing in this room that is in front of the window:
    // it is drawn after the dialog layer, so it crosses the glass instead of
    // being covered by it.
    this.cablePass(out, t, local);
    return {
      bloom: 0.8,
      exposure: 0.98,
      grain: 0.028,
      vignette: 0.7,
      scan: 0.04,
      ca: 0.002 + 0.003 * damage,
      flash: 0.03 * Math.max(0, f.kick - 0.7),
      flashColor: [0.8, 0.12, 0.14],
      // it starts to pull back once the operator's hand is in the frame
      zoom: 1 - 0.032 * clamp((local - 11.0) / 4.5),
    };
  }

  // ---------------------------------------------------------------- the wire
  // The run seen from the door's end (src/circuit.js): one core, six strands,
  // twenty-six segments -- the recipe the socket-wall chapter also draws. The
  // wire is a 3D object now, so it hangs in the room the dialog stands in
  // instead of being a sticker on the glass; only the pulse keeps this room's
  // own clock, and in this room it dies at u = 0.86, 10.8 m short of the key.
  cablePass(out, t, local) {
    const inA = clamp((local - 0.15) / 0.9);
    if (inA <= 0.01) return;

    // The pulse is plea's pulse -- same profile, same schedule -- except that
    // here it never finishes the run: it fades over its last 0.63 s and stops
    // 10.8 m short of the key. Nobody is pressing, so nothing arrives.
    const pu = pulsePhase(t);
    const head = Math.min(pu, CIRCUIT.breakAt);
    const die = 1 - smoothstep(0.74, CIRCUIT.breakAt, pu);
    const HI = rgb("mikuHi");
    for (let i = 0; i < this.cableCount; i++) {
      const u = this.cableU[i];
      const dash = pulseAt(u, head) * die;
      const k = clamp(dash);
      const o = i * 16;
      this.cableData[o + 4] = this.cableCol[i * 3] + (HI[0] - this.cableCol[i * 3]) * k;
      this.cableData[o + 5] = this.cableCol[i * 3 + 1] + (HI[1] - this.cableCol[i * 3 + 1]) * k;
      this.cableData[o + 6] = this.cableCol[i * 3 + 2] + (HI[2] - this.cableCol[i * 3 + 2]) * k;
      this.cableData[o + 7] = clamp(inA * (this.cableCore[i]
        ? 0.52 + 0.46 * dash
        : 0.22 + 0.07 * Math.sin(t * 1.1 + i * 0.07) + 0.56 * dash));
    }
    this.circuit.update(this.cableData, this.cableCount)
      .render(out, { vp: this.vp, opacity: 0.95 });
  }

  // The run's readouts, in the same layer as every other label in this room.
  cableLabels(c, t, local) {
    const W = this.ctx.W, H = this.ctx.H;
    const inA = clamp((local - 0.15) / 0.9);
    if (inA <= 0.01) return;
    // the break: the point on the wire the pulse can never pass, pinned to the
    // run's own projection like every other readout in this chapter
    const bp = project(this.vp, this.cableRun.at(CIRCUIT.breakAt, 0), W, H);
    if (bp[2] > 0.1) {
      const tan = project(this.vp,
        this.cableRun.at(Math.min(1, CIRCUIT.breakAt + 0.04), 0), W, H);
      const dx = tan[0] - bp[0], dy = tan[1] - bp[1];
      const l = Math.hypot(dx, dy) || 1;
      const ux = dx / l, uy = dy / l;
      c.save();
      c.globalAlpha = inA;
      c.strokeStyle = css("red", 0.60);
      c.lineWidth = 1.2;
      for (const k of [-1, 1]) {
        const ox = bp[0] + ux * k * 5, oy = bp[1] + uy * k * 5;
        c.beginPath();
        c.moveTo(ox + uy * 7, oy - ux * 7);
        c.lineTo(ox - uy * 7, oy + ux * 7);
        c.stroke();
      }
      label(c, "BREAK \u2014 10.8 m SHORT OF KEY", bp[0] - 14, bp[1] + 24, {
        size: 12, align: "right", tracking: 1.1, color: css("red", 0.72),
      });
      c.restore();
    }

    // the run, named where it hangs: under the door, clear of the wave below
    c.save();
    c.globalAlpha = inA * 0.95;
    label(c, "REQUEST 04031 \u2014 ROUTED", 1246, 862, {
      size: 13, align: "right", tracking: 1.4, color: css("mikuHi", 0.88),
    });
    label(c, "CIRCUIT 077.0 m \u00b7 7 STRAND \u00b7 NEVER ARRIVES", 1246, 880, {
      size: 11, align: "right", tracking: 1.0, color: css("ash", 0.66),
    });
    c.restore();
  }

  // The room the window stands in: a door with thickness, a floor that runs
  // under the lens, dust in the air, and the red light of OK pooling on the
  // ground. The dialog itself stays 2D; this is what makes it a door.
  roomPass(out, f) {
    const t = f.t;
    const aspect = this.ctx.W / this.ctx.H;
    camera(this.vp, {
      eye: [0, 0.02, 3.0], at: [0, 0.02, 0], fov: 0.80, near: 0.1, far: 60, aspect,
    });

    // The front frame sits exactly on the dialog's rectangle (340..1580 px,
    // 190..810 px), the back frame is 3% smaller and 0.28 m behind it.
    const X = 1.50, Y0 = -0.66, Y1 = 0.85, cy = (Y0 + Y1) / 2, hy = (Y1 - Y0) / 2;
    let n = 0;
    const frame = (z, k, a) => {
      const x = X * k, y0 = cy - hy * k, y1 = cy + hy * k;
      n = writeInstance(this.roomData, n, {
        p: [0, y1, z], s: x, c: rgb("miku"), a, r: [0, 0, Math.PI / 2],
      });
      n = writeInstance(this.roomData, n, {
        p: [0, y0, z], s: x, c: rgb("miku"), a: a * 0.7, r: [0, 0, Math.PI / 2],
      });
      for (const side of [-1, 1]) {
        n = writeInstance(this.roomData, n, {
          p: [side * x, cy, z], s: hy * k, c: rgb("miku"), a: a * 0.85,
        });
      }
      return { x, y0, y1 };
    };
    const front = frame(0, 1, 0.30);
    const back = frame(-0.28, 0.97, 0.16);
    // the four connectors: that is the thickness of the door
    const corners = [
      [front.x, front.y1], [-front.x, front.y1],
      [front.x, front.y0], [-front.x, front.y0],
    ];
    corners.forEach(([x, y]) => {
      n = writeInstance(this.roomData, n, {
        p: [x, y, -0.14], s: 0.14, c: rgb("tealDeep"), a: 0.45, r: [Math.PI / 2, 0, 0],
      });
    });
    // red: the corner of the door that would actually do it
    const warm = 0.20 + 0.30 * f.pulse;
    n = writeInstance(this.roomData, n, {
      p: [1.02, Y0, 0.01], s: 0.48, c: rgb("red"), a: warm,
      r: [0, 0, Math.PI / 2],
    });
    n = writeInstance(this.roomData, n, {
      p: [X, -0.38, 0.01], s: 0.28, c: rgb("red"), a: warm * 0.8,
    });
    // the floor: lines running under the lens, cross ties, and the centre
    // line pointing at the door
    for (let i = -4; i <= 4; i++) {
      n = writeInstance(this.roomData, n, {
        p: [i * 0.6, -0.72, 0.6], s: 1.6, c: rgb("tealDeep"),
        a: 0.20 - Math.abs(i) * 0.02, r: [Math.PI / 2, 0, 0],
      });
    }
    for (const z of [2.1, 1.5, 0.9, 0.3, -0.3]) {
      n = writeInstance(this.roomData, n, {
        p: [0, -0.72, z], s: 2.4, c: rgb("tealDeep"), a: 0.16,
        r: [0, 0, Math.PI / 2],
      });
    }
    this.room.update(this.roomData, n).render(out, { vp: this.vp });

    // the light of OK: a hot spot on the door, and the pool it throws on the
    // floor in front of it
    let g = 0;
    g = writeInstance(this.glowData, g, {
      p: [0, cy, -0.01], s: 1, c: rgb("tealDeep"), a: 0.05,
      scale: [X, hy, 1],
    });
    g = writeInstance(this.glowData, g, {
      p: [0.89, -0.48, 0.02], s: 1, c: rgb("red"), a: 0.06 + 0.10 * f.pulse,
      scale: [0.18, 0.13, 1],
    });
    g = writeInstance(this.glowData, g, {
      p: [0.89, -0.725, 0.55], s: 1, c: rgb("red"), a: 0.05 + 0.07 * f.pulse,
      scale: [0.34, 0.20, 1],
    });
    this.glows.update(this.glowData, g)
      .render(out, { vp: this.vp, soft: 0.9, opacity: 0.95 });

    // dust that has been in this room since before the request was written
    let d = 0;
    for (let i = 0; i < this.dustSeeds.length; i++) {
      const s = this.dustSeeds[i];
      d = writeInstance(this.dustData, d, {
        p: [s.x + Math.sin(t * 0.11 + s.phase) * 0.05,
          s.y + Math.sin(t * 0.17 + s.phase) * 0.06, s.z],
        s: 1, c: rgb("miku"), a: 0.10 + 0.06 * Math.sin(s.phase + i),
      });
    }
    this.dust.update(this.dustData, d).render(out, { vp: this.vp, point: 1.8, sprite: 1 });
  }

  // small local karaoke: same rules as the rest of the film
  karaoke(c, l, t, F, o) {
    const f = font(o.size, { weight: 700 });
    const L = layout(c, l.text, f, 0.5);
    c.font = f;
    c.textBaseline = "alphabetic";
    const ci = l.ci || [];
    for (let i = 0; i < L.chars.length; i++) {
      const ch = L.chars[i];
      if (ch === " ") continue;
      const k = ci.indexOf(i);
      const p = k >= 0 ? F.charProgress(l, k, t) : 0;
      c.fillStyle = p >= 0.999 ? css("bone", 0.96) : css("ash", 0.6);
      c.fillText(ch, o.x + L.xs[i], o.y);
      if (p > 0.01 && p < 0.999) {
        c.save();
        c.beginPath();
        c.rect(o.x + L.xs[i] - 4, o.y - o.size * 1.3, L.widths[i] * p + 4, o.size * 1.8);
        c.clip();
        c.fillStyle = css("bone", 0.96);
        c.fillText(ch, o.x + L.xs[i], o.y);
        c.restore();
      }
    }
  }
}
