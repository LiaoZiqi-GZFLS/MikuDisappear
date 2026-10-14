// 0:25.7 - verse 1. The machine discovers what it is, at eleven characters a
// second. The lyric wall is the picture: one line per bar, in real time.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import {
  binaryField, clamp, label, lyricLine, machineChrome, panel, smoothstep,
  specWaterfall, typeWall, wave,
} from "../kit.js";
import {
  emptySeats, heart, infinityLoop, leek, motifLabel, ruinFrame, singer,
  skyTears, toyKey,
} from "../motifs.js";
import { beatAt } from "../semantics.js";
import { Stage3D, camera, mat4, project, rgb, writeInstance } from "../gl3d.js";
import { HEAD, aimAt, headSweep, writeBay, writeHeadRing, writeRecord } from "../head.js";
import { draw as drawText, pad } from "../type.js";
import { audioU, layer, line } from "./util.js";

const FRAG = `
uniform float uT;
uniform float uVocal;
uniform float uLow;
uniform float uPulse;
uniform float uKick;
uniform float uProg;
uniform float uIns;
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec3 col = C_INK;

  // The room she is born in is a hall of data that runs to a vanishing
  // point: columns of light recede, the floor keeps going, and the far end
  // of the hall is where she is being printed.
  vec2 vp = vec2(0.5, 0.54);
  vec2 p = (uv - vp) * vec2(aspect, 1.0);
  float r = length(p) + 0.02;
  float ang = atan(p.y, p.x);
  float depth = 1.0 / max(r, 0.06);

  float cols = pow(abs(cos(ang * 11.0 + 0.4)), 26.0);
  cols *= smoothstep(0.05, 0.35, r) * smoothstep(1.6, 0.5, r);
  col += C_TEAL_DEEP * cols * (0.30 + 0.55 * uProg);

  float rings = pow(abs(cos(depth * 1.7 - uT * 0.15)), 52.0);
  rings *= smoothstep(0.16, 0.6, r);
  col += C_MIKU * rings * 0.035;

  float core = exp(-pow(r * 4.2, 2.0));
  col += C_MIKU_HI * core * (0.05 + 0.14 * uProg + 0.07 * uVocal);
  col += C_TEAL_DEEP * exp(-pow(r * 1.9, 2.0)) * 0.20;

  // a horizontal printer line that sweeps with the current phrase
  float ph = fract(uT * 0.25);
  float sweep = exp(-pow((uv.y - (0.3 + 0.5 * ph)) * 210.0, 2.0));
  col += C_MIKU * sweep * (0.04 + 0.10 * uVocal);

  // low end as a wide glow at the bottom
  col += C_MIKU * 0.02 * uLow * exp(-pow((uv.y - 0.02) * 8.0, 2.0));
  float rad = uKick * exp(-pow(length((uv - vec2(0.5, 0.5)) * vec2(1.2, 0.85)) * 2.6, 2.0));
  col += C_MIKU_HI * rad * 0.03;
  col *= 1.0 + 0.05 * uPulse;
  col *= mix(0.9, 1.05, smoothstep(0.0, 0.4, uProg));
  // FIRST RENDER: the hall is still there, but the machine printing her is
  // the only thing allowed to be bright.
  col *= 1.0 - 0.86 * uIns;
  fragColor = vec4(col, 1.0);
}`;

export default class Birth extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "birth");
    this.count = 0;
    this.birthLine = null;

    // The hall she is born in is a real 3D set: server pillars running to a
    // vanishing point, a floor grid, and data falling from above. It is added
    // to the 2D instrument picture as light behind everything.
    this.vp = mat4();
    this.pillars = new Stage3D(ctx, "segment");
    this.grid = new Stage3D(ctx, "segment");
    this.rain = new Stage3D(ctx, "point");
    const P = 306, G = 64, R = 720;
    this.pillarData = new Float32Array(P * 16);
    this.gridData = new Float32Array(G * 16);
    this.rainData = new Float32Array(R * 16);
    this.pillarSeeds = [];
    for (let i = 0; i < P; i++) {
      const h = (k) => {
        const s = Math.sin(i * 21.71 + k * 63.13) * 13758.5453;
        return s - Math.floor(s);
      };
      this.pillarSeeds.push({
        x: (i % 17 - 8) * 4 + (h(1) - 0.5) * 1.2,
        z: -3 - Math.floor(i / 17) * 7 - h(2) * 2.5,
        h: 5 + h(3) * 21,
        bright: 0.45 + h(4) * 0.55,
      });
    }
    this.rainSeeds = [];
    for (let i = 0; i < R; i++) {
      const h = (k) => {
        const s = Math.sin(i * 3.71 + k * 17.31) * 9174.1917;
        return s - Math.floor(s);
      };
      this.rainSeeds.push({
        x: (h(1) - 0.5) * 64,
        z: -2 - h(2) * 118,
        y0: h(3) * 30,
        speed: 1.6 + h(4) * 3.4,
        bright: 0.3 + h(5) * 0.7,
      });
    }

    // The printer, on its own lens. It is HEAD-01 (src/head.js): the same
    // drawing `erode` later reads her away with, run the other way -- here the
    // head starts above her crown and sweeps down.
    this.printVP = mat4();
    this.bay3d = new Stage3D(ctx, "segment");
    this.record3d = new Stage3D(ctx, "rect");
    this.head3d = new Stage3D(ctx, "rect");
    this.bayData = new Float32Array(HEAD.instances * 16);
    this.recordData = new Float32Array((HEAD.marks + 2) * 16);
    this.headData = new Float32Array(8 * 16);
    this.printFrame = null;
  }

  async init() {
    this.birthLine = line(this.ctx.features, "\u30dc\u30af\u306f\u751f\u307e\u308c");
  }

  render(f, out) {
    const t = f.t;
    // The FIRST RENDER insert runs on the first line: "ボクは生まれ". The
    // counter, the 2D mask and the 3D head all read the same `head`, so the
    // line that prints her and the bar that crosses her cannot disagree.
    const b0 = this.birthLine ? this.birthLine.start : 25.66;
    // The insert opens on the chapter's first frame and the print runs from
    // that same frame: the chapter *is* the render. It clears once the next
    // line has taken over.
    const ins = clamp((t - b0 + 0.30) / 0.7)
      * (1 - smoothstep(b0 + 1.62, b0 + 2.32, t));
    this.qaPrint = null;
    this.pass.draw({ dst: out, u: { ...audioU(f), uIns: ins } });
    this.hall(out, f);
    if (ins > 0.004) this.printer(out, f, t, b0, ins);

    const c = this.text.ctx;
    this.text.clear();

    // ---------------------------------------------------- the birth, close up
    // One insert on the first line: the print head runs down her silhouette,
    // top of the hair first, and stops at the waist. No features are ever
    // printed -- the beam only draws where the light lands on her.
    if (ins > 0.004) {
      const pf = this.printFrame;
      const print = pf ? pf.print : 0;
      const py = pf ? pf.py : -400;

      // The cut-in's own vignette: the hall stays visible through it, because
      // the machine that is printing her is standing in that hall.
      const vig = c.createRadialGradient(960, 620, 240, 960, 620, 1180);
      vig.addColorStop(0, css("ink", 0));
      vig.addColorStop(0.62, css("ink", 0.26 * ins));
      vig.addColorStop(1, css("ink", 0.72 * ins));
      c.fillStyle = vig;
      c.fillRect(0, 0, 1920, 1080);

      c.save();
      c.beginPath();
      c.rect(0, 0, 1920, py);
      c.clip();
      singer(c, 960, 1210, 1180, {
        t,
        alpha: 0.92 * ins,
        mouth: 0.2 + 0.5 * f.a.vocal,
        dissolve: 0.05,
        light: 0.86,
      });
      c.restore();

      // the beam that prints her, and the framing brackets the machine would
      // leave around a render
      const beam = c.createLinearGradient(0, py - 34, 0, py + 46);
      beam.addColorStop(0, css("miku", 0));
      beam.addColorStop(0.5, css("mikuHi", 0.55 * ins));
      beam.addColorStop(1, css("miku", 0));
      c.fillStyle = beam;
      c.fillRect(0, py - 34, 1920, 80);
      c.strokeStyle = css("dim", 0.6 * ins);
      c.lineWidth = 1;
      const bx = 596, by = 96, bw = 728, bh = 900;
      for (const [sx, sy, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) {
        c.beginPath();
        c.moveTo(sx, sy + dy * 34);
        c.lineTo(sx, sy);
        c.lineTo(sx + dx * 34, sy);
        c.stroke();
      }
      label(c, "FIRST RENDER / CV-01", 596, 66, {
        size: 16, tracking: 4,
        color: css("ash", 0.9 * ins),
      });
      // the record HEAD-01 writes as it prints: 48 cells, one per 0.042 m
      const cells = pf ? pf.cells : 0;
      const rx = 912, rw = 412, rc = rw / HEAD.marks;
      c.save();
      c.globalAlpha = ins;
      // the machine's own plate: the room behind this readout is bright
      // structure, and a readout that cannot be read is not a readout
      c.fillStyle = css("ink", 0.62);
      c.fillRect(rx - 10, 52, rw + 20, 36);
      for (let i = 0; i < HEAD.marks; i++) {
        c.fillStyle = i < cells ? css("miku", 0.95) : css("dim", 0.35);
        c.fillRect(rx + i * rc, 76, Math.max(2, rc - 3), 6);
      }
      label(c, `HEAD-01 \u00b7 PRINT ${pad(cells, 2)} / 48 \u00b7 `
        + `${pf ? pf.head.toFixed(3) : "0.000"} m / 2.020 m`, rx + rw, 66, {
        size: 13, tracking: 1.6, align: "right", color: css("miku", 0.8),
      });
      c.restore();
      label(c, "\u30dc\u30af\u306f\u751f\u307e\u308c \u305d\u3057\u3066\u6c17\u3065\u304f", 970, 900, {
        size: 30, align: "center", tracking: 6, color: css("bone", 0.95 * ins),
      });
    }

    const beat = beatAt(f.F, t);
    const id = beat ? beat.id : "";
    const enter = beat ? beat.fresh : 0;
    const leave = beat ? beat.exit : 0;
    const active = f.line;

    // ------------------------------------------------------------- the voice
    // A ghost of her is always present. Each line changes one part of her.
    const fig = {
      t,
      // During FIRST RENDER the inserted printer is the subject: the chapter's
      // own ghost steps out of the way instead of standing next to her.
      alpha: (0.15 + 0.22 * (beat ? 1 - leave : 0.35)) * (1 - 0.94 * ins),
      eyes: "open",
      mouth: 0.25 + 0.75 * f.a.vocal,
      dissolve: 0.20,
      crack: 0,
      tilt: 0,
      heart: null,
      smile: 0,
    };
    if (id === "birth") { fig.dissolve = 1 - enter; fig.eyes = "closed"; fig.mouth = 0; }
    if (id === "imitation") fig.eyes = "closed";
    if (id === "persist") fig.mouth = 0.35 + 0.65 * f.a.vocal;
    if (id === "eternity" || id === "resolve") { fig.eyes = "happy"; fig.smile = 0.9; }
    if (id === "leek_sky_tear") { fig.eyes = "happy"; fig.smile = 0.55; fig.tilt = -0.025; }
    if (id === "self_on_song") fig.heart = enter;
    if (id === "unstable") { fig.crack = 0.25 + 0.55 * enter; fig.tilt = 0.018 * Math.sin(t * 5.4); }
    if (id === "heart_gone") { fig.heart = 1 - enter; fig.eyes = "sad"; fig.sadMouth = true; }
    if (id === "runaway") { fig.crack = 0.65; fig.dissolve = 0.5; fig.tilt = 0.03 * Math.sin(t * 8.0); }
    if (id === "world_end") { fig.alpha *= 0.55; fig.dissolve = 0.7; fig.eyes = "closed"; }
    singer(c, 1235, 900, 560, fig);
    if (id === "imitation") {
      singer(c, 1170, 900, 560, {
        t,
        alpha: 0.12 * enter * (1 - leave) * (1 - ins), color: css("ash", 0.8),
        eyes: "closed", dissolve: 0.12,
      });
      motifLabel(c, "HUMAN / ORIGINAL", 1090, 560, { color: css("ash", 0.7), align: "right" });
      motifLabel(c, "IMITATION", 1430, 560, { color: css("miku", 0.75) });
    }

    // ---------------------------------------------------------- text wall
    const wallX = 84, wallW = 1010;
    typeWall(c, f.F, t, {
      x: wallX, y: 470, w: wallW, count: 6, lineHeight: 48, size: 26,
      lead: 0, window: 14, dimColor: css("dim", 0.68), hotColor: css("miku", 0.95),
    });
    if (active) {
      lyricLine(c, active, t, f.F, {
        x: wallX, y: 655, size: 90, weight: 900, maxWidth: wallW,
        sung: css("bone", 1), dim: css("dim", 0.95), tracking: 1,
      });
      // the machine transcribes: a caret at the sung position
      const p = f.F.lineProgress(active, t);
      c.fillStyle = css("miku", 0.95);
      c.fillRect(wallX + wallW * p, 676, 4, 22);
    }

    // ------------------------------------------------------- instrument
    const ix = 1580, iw = 260;
    panel(c, ix, 330, iw, 340, {
      fill: css("ink2", 0.9), corner: 12, cornerColor: css("miku", 0.7),
      stroke: css("dim", 0.6),
    });
    label(c, "VOICE PRINT", ix + 12, 320, { size: 17, tracking: 1.6, color: css("ash", 0.95) });
    specWaterfall(c, f.F, t, { x: ix + 10, y: 342, w: iw - 20, h: 176, span: 4.0, alpha: 0.95 });
    wave(c, f.F, t, { x: ix + 10, y: 530, w: iw - 20, h: 128, span: 0.6, lw: 2.2, amp: 1.35 });

    // phrase bookkeeping
    const idx = Math.max(0, f.lineIndex);
    label(c, `PHRASE ${pad(idx + 1, 3)}`, ix, 720, { size: 18, color: css("bone", 0.95), tracking: 1.4 });
    label(c, `TEMPO 240.00`, ix, 748, { size: 18, color: css("ash", 0.95), tracking: 1.4 });
    label(c, `CHARS/S ${f.F.a.charsPerSecond.toFixed(2)}`, ix, 776, { size: 18, color: css("amber", 0.95), tracking: 1.4 });
    this.count = Math.max(this.count, idx + 1);
    label(c, "SYLLABLES RENDERED", ix, 830, { size: 16, color: css("dim", 0.95), tracking: 1.4 });
    drawText(c, `${pad(this.count * 17, 6)}`, {
      x: ix, y: 872, size: 40, weight: 600, mono: true, color: css("miku", 0.98),
    });

    // -------------------------------------------------------- binary floor
    binaryField(c, t, {
      x: 0, y: 884, w: 1920, h: 132, cell: 22, size: 11, alpha: 0.4,
      color: css("miku", 0.55), density: 0.5, speed: 0.8, seed: 3,
    });
    c.fillStyle = css("ink", 0.8);
    c.fillRect(0, 1040, 1920, 40);
    c.fillStyle = css("miku", 0.85);
    c.fillRect(84, 1038, 1752 * clamp((t - 25.7) / 16.0), 2);

    // keep the readout legible over the lattice
    c.fillStyle = css("ink", 0.72);
    c.fillRect(48, 900, 404, 120);

    // ---------------------------------------------------- lyric-driven motifs
    if (beat) {
      const a = Math.max(0, Math.min(1, Math.min(enter, 1 - leave)));
      switch (id) {
        case "persist": {
          // one line of song leaves her mouth and refuses to stop
          c.save();
          c.globalAlpha = a * 0.65;
          c.strokeStyle = css("mikuHi", 0.75);
          c.lineWidth = 1.5;
          c.beginPath();
          for (let i = 0; i <= 120; i++) {
            const u = i / 120;
            const x = 1235 - u * 900;
            const y = 560 + Math.sin(u * 22 - t * 8) * (4 + 26 * f.a.vocal);
            if (i === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
          }
          c.stroke();
          c.restore();
          motifLabel(c, "KEEP SINGING", 330, 540, { color: css("miku", 0.8) });
          break;
        }
        case "eternity":
          infinityLoop(c, 1235, 620, 620, { alpha: a * 0.8, phase: t * 0.3 });
          break;
        case "copy_song":
        case "toy":
          toyKey(c, 1415, 640, 74, { alpha: a * 0.85, spin: t * 1.7 });
          break;
        case "leek_sky_tear":
          leek(c, 250, 400, 170, { alpha: a, bite: beat.phase * 0.8, rot: -0.5 });
          skyTears(c, 1030, 130, 540, 300, { alpha: a, tear: beat.phase });
          break;
        case "loss":
          leek(c, 250, 400, 170, {
            alpha: a * (1 - enter), rot: -0.5, label: false,
          });
          skyTears(c, 1030, 130, 540, 300, { alpha: a * 0.5, tear: 1 });
          break;
        case "ruins":
          ruinFrame(c, 100, 170, 520, 230, { alpha: a, break: 0.85, spin: t });
          break;
        case "forgotten":
          emptySeats(c, 90, 170, 520, 230, { alpha: a * 0.9 });
          break;
        case "heart_gone":
          heart(c, 1235, 620, 140, {
            alpha: a * 0.9, fill: 1 - enter, erode: enter, seed: 8,
            color: css("miku", 0.8), label: "HEART",
          });
          break;
        case "world_end": {
          c.save();
          c.globalAlpha = a * 0.8;
          c.strokeStyle = css("red", 0.7);
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(84, 820);
          c.lineTo(1800, 820);
          c.stroke();
          c.strokeStyle = css("miku", 0.5);
          c.beginPath();
          c.ellipse(1235, 430, Math.max(20, 260 - enter * 190),
                    Math.max(12, 120 - enter * 95), 0, 0, Math.PI * 2);
          c.stroke();
          motifLabel(c, "VOCALOID / THE END", 1235, 850, {
            align: "center", color: css("red", 0.8),
          });
          c.restore();
          break;
        }
      }
    }

    machineChrome(c, { name: "", left: "VOCALOID CV-01", right: `BAR ${pad(Math.floor(f.bar) + 1, 3)}` });

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    return {
      bloom: 0.85 + 0.35 * f.vox,
      exposure: 1.0 + 0.05 * f.kick,
      grain: 0.016,
      vignette: 0.6,
      scan: 0.03,
      ca: 0.0008 + 0.0016 * f.kick,
      flash: 0.02 * Math.max(0, f.kick - 0.55),
    };
  }

  // The temple's air: pillars 100 m deep fall back into the ink the deeper the
  // camera dives into them, and the falling data is dimmed with distance, so
  // the hall reads as a room instead of a wall of lines.
  air(opts = {}) {
    return { eye: this.eyeNow || [0, 5, 10], fog: { dist: 240, c: rgb("ink") }, ...opts };
  }

  // ---- the FIRST RENDER insert --------------------------------------------
  // HEAD-01 prints her on its own lens. The 2D silhouette is clipped at the
  // exact screen height of the 3D head (`py` is this frame's projection of
  // [0, head, 0]), so the bar the audience sees and the light in the room are
  // one object. The lens is long and the machine is 7.2 m in radius: the eye
  // stands inside the bay, the ribs pass the frame's edges, and the head ring
  // crosses the whole picture like a printer's platen.
  printer(out, f, t, b0, ins) {
    const W = this.ctx.W, H = this.ctx.H;
    const aspect = W / H;
    const print = clamp((t - b0) / HEAD.printDur);
    const head = headSweep(print, -1);
    const voice = 0.78 + 0.55 * f.a.vocal;
    const fov = 0.34;
    const eye = [0.55, 1.42, 4.15];
    const at = aimAt(eye, fov, 0.5, 0.574, [0, 0.81, 0]);
    const vp = this.printVP;
    camera(vp, { eye, at, fov, near: 0.05, far: 80, aspect });

    const nb = writeBay(this.bayData, 0, {
      head, dir: -1, voice, gain: ins,
      lit: rgb("mikuHi"), dim: rgb("tealDeep"),
    });
    this.bay3d.update(this.bayData, nb).render(out, {
      vp, eye, fog: { dist: 30, c: rgb("ink") }, opacity: 1,
    });

    // the same 48 cells `erode` will read back, written here in order
    const cells = Math.min(HEAD.marks, Math.floor(print * HEAD.marks));
    const nr = writeRecord(this.recordData, 0, {
      cells, lit: rgb("mikuHi"), dim: rgb("tealDeep"),
    });
    this.record3d.update(this.recordData, nr).render(out, {
      vp, eye, fog: { dist: 30, c: rgb("ink") }, soft: 0.4, opacity: 0.9,
    });

    const nh = writeHeadRing(this.headData, 0, {
      head, voice, ring: rgb("mikuHi"), mid: rgb("bone"), disc: rgb("miku"),
    });
    this.head3d.update(this.headData, nh).render(out, {
      vp, eye, soft: 0.9, opacity: 0.85,
    });

    // what the 2D layer is allowed to print: all of it is this frame's own
    // projection, so the bar, the mask and the readout move together
    const bar = project(vp, [0, head, 0], W, H);
    const foot = project(vp, [0, 0, 0], W, H);
    const crown = project(vp, [0, 1.62, 0], W, H);
    this.printFrame = {
      print, head, cells, py: bar[1],
      foot, crown,
      shePx: +Math.abs(foot[1] - crown[1]).toFixed(1),
      eye: eye.map((v) => +v.toFixed(3)),
      fovDeg: +(fov * 180 / Math.PI).toFixed(2),
    };
    // the probe hook (tools/head-probe.mjs) reads the same object the 2D layer
    // is drawn from; it is not a second source of truth.
    this.qaPrint = this.printFrame;
  }

  // Crane down 40 m from the dome, then hold: the 3D half of the birth.
  hall(out, f) {
    const t = f.t;
    const local = t - 25.69;
    const aspect = this.ctx.W / this.ctx.H;
    const fall = smoothstep(0.0, 1.7, local);
    const e = fall * fall * (3 - 2 * fall);
    const slide = smoothstep(1.7, 8.0, local) * 2.2;
    const eye = [slide, 38 - e * 32.6, 52 - e * 41];
    const at = [slide * 0.4, 4.6 - e * 1.2, -14];
    camera(this.vp, { eye, at, fov: 1.06, near: 0.3, far: 340, aspect });
    this.eyeNow = eye;

    // pillars: height and brightness breathe with the low end
    let n = 0;
    for (let i = 0; i < this.pillarSeeds.length; i++) {
      const s = this.pillarSeeds[i];
      const breathe = 0.9 + 0.25 * Math.sin(t * 0.6 + i * 0.7) + f.a.low * 0.25;
      n = writeInstance(this.pillarData, n, {
        p: [s.x, s.h * breathe, s.z],
        s: s.h * breathe,
        c: rgb("tealDeep"),
        a: 0.55 * s.bright * (1 - Math.min(1, -s.z / 150)),
      });
    }
    this.pillars.update(this.pillarData, n).render(out, this.air({ vp: this.vp }));

    // floor grid: lines running to the vanishing point, plus cross lines
    n = 0;
    for (let i = -8; i <= 8; i++) {
      n = writeInstance(this.gridData, n, {
        p: [i * 4, 0.02, -62], s: 62, c: rgb("tealDeep"), a: 0.34,
        r: [Math.PI / 2, 0, 0],
      });
    }
    for (let i = 0; i < 22; i++) {
      const z = -2 - i * 6;
      n = writeInstance(this.gridData, n, {
        p: [0, 0.02, z], s: 34, c: rgb("tealDeep"), a: 0.22,
        r: [0, 0, Math.PI / 2],
      });
    }
    this.grid.update(this.gridData, n).render(out, this.air({ vp: this.vp, opacity: 0.9 }));

    // data rain, falling past her towards the floor
    n = 0;
    for (let i = 0; i < this.rainSeeds.length; i++) {
      const r = this.rainSeeds[i];
      const y = 30 - ((r.y0 + t * r.speed) % 30);
      n = writeInstance(this.rainData, n, {
        p: [r.x, y, r.z],
        c: r.y0 > 26 ? rgb("mikuHi") : rgb("miku"),
        a: 0.34 * r.bright * (1 - Math.min(1, -r.z / 140)),
      });
    }
    this.rain.update(this.rainData, n).render(out, this.air({ vp: this.vp, point: 2.2 }));
  }
}
