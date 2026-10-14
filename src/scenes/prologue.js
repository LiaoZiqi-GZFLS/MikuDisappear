// 0:00 - the cold open. A record is opened, a voice bank is scheduled for
// deletion, and she is assembled out of her own specification. She is never
// shown all at once: a hair tie, a headset, one strand of hair, the 01 on her
// arm, and only then a silhouette with no face.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import { clamp, hash, label, smoothstep } from "../kit.js";
import { armMark, buildLattice, figureRaster } from "../lattice.js";
import { singer } from "../motifs.js";
import { Stage3D, camera, mat4, project, rgb, writeInstance } from "../gl3d.js";
import { draw as drawText } from "../type.js";
import { audioU, layer } from "./util.js";

const FRAG = `
uniform float uT;
uniform float uLow;
uniform float uVocal;
uniform float uOn;       // the machine is powered up
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec3 col = C_INK;
  // the hall breathes
  col += C_TEAL_DEEP * 0.06 * uOn * exp(-pow((uv.y - 0.62) * 5.0, 2.0));
  col += C_MIKU * 0.025 * uLow * uOn * exp(-pow((uv.y - 0.66) * 4.0, 2.0));
  // a scanner sweeping the empty hall
  float sweep = smoothstep(0.026, 0.0, abs(uv.y - fract(uT * 0.055)));
  col += C_MIKU * sweep * 0.020 * uOn;
  col += C_MIKU_HI * 0.012 * uVocal * uOn;
  fragColor = vec4(col, 1.0);
}`;

const TYPE_FONT = (size, weight = 400) => `${weight} ${size}px "MV Mono"`;

export default class Prologue extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "prologue");

    // The cold open happens inside a real machine hall. It is not scenery:
    // these racks are what is writing the record, and the lens walks the
    // aisle exactly once -- from the entrance to the rank that is writing
    // her. Two rows of server frames recede past the lens, LEDs blink on the
    // self-test, one scanner gate passes over the racks, and during the
    // assembly the hall switches off rank by rank so only she stays lit.
    this.vp = mat4();
    this.tieVp = mat4();
    this.racks = new Stage3D(ctx, "quad");
    this.lights = new Stage3D(ctx, "rect");
    this.leds = new Stage3D(ctx, "point");
    this.floor = new Stage3D(ctx, "segment");
    this.tie = new Stage3D(ctx, "quad");
    this.tieScreen = null;

    // The assembly: her own drawing re-read as line segments and drawn in the
    // aisle of the hall, as light. This is the one place in the film where she
    // is built in front of the lens -- so the segments are 3D, they arrive out
    // of the hall's depth, and a print head walks up her body as they land.
    this.body = new Stage3D(ctx, "rect");
    this.print = new Stage3D(ctx, "rect");
    this.bodyData = null;
    this.printData = new Float32Array(8 * 16);
    this.segs = null;
    this.bounds = null;
    // where she stands, in the hall's own metres: right of the aisle's centre,
    // between the rack rows, her feet on the floor the lens is walking on
    this.fig = { x: 1.72, z: -5.2, h: 4.7 };
    this.figScreen = null;

    const RANKS = 15, SIDES = 2;
    this.rackData = new Float32Array(RANKS * SIDES * 2 * 16 + 16); // + the gate
    // per rack face: the panel, four blade slots and the tray light
    this.lightData = new Float32Array((RANKS * SIDES * 6 + 4) * 16);
    this.ledData = new Float32Array(RANKS * SIDES * 6 * 16);
    this.floorData = new Float32Array(64 * 16);
    this.tieData = new Float32Array(16);
    this.ranks = [];
    for (let r = 0; r < RANKS; r++) {
      const h = (k) => {
        const s = Math.sin(r * 7.31 + k * 41.7) * 24634.6345;
        return s - Math.floor(s);
      };
      this.ranks.push({
        z: 5.5 - r * 4.35 - h(1) * 0.5,
        seed: h(2),
        rows: 5 + Math.floor(h(3) * 2),
      });
    }
  }

  async init() {
    const raster = figureRaster({ weight: 0.013 });
    const built = buildLattice({ raster, max: 560 });
    // the arm mark is drawn as segments too, so the one character on her body
    // lands with the body and goes out with it
    this.segs = built.segs.concat(armMark(0.295, 0.245, 0.075));
    this.bounds = built.bounds;
    this.bodyData = new Float32Array(this.segs.length * 16);
  }

  render(f, out) {
    const t = f.t;
    const on = smoothstep(0.2, 6.0, t);
    this.pass.draw({ dst: out, u: audioU(f, { uOn: on }) });
    this.hall(out, f);
    this.hairTie3d(out, f);
    this.assembly3d(out, f);

    const c = this.text.ctx;
    this.text.clear();
    c.textBaseline = "alphabetic";

    this.subtitles(c, t);
    this.bootLog(c, t);
    this.countdown(c, t);
    this.tieLabel(c, t);
    this.headset(c, t, f);
    this.specSheet(c, t);
    this.assembly(c, t, f);

    // the record's own header, present from the first frame. It sits below the
    // film HUD's identity block (64,74) so the two never type over each other.
    label(c, "CV-01 / LAST KNOWN FRAME", 84, 152, {
      size: 17, tracking: 3, color: css("ash", 0.75),
    });
    label(c, "RECORD 0001 \u2014 DELETION PENDING", 84, 176, {
      size: 14, tracking: 2, color: css("dim", 0.9),
    });
    // The first half of the film's bookend (v7): the same read ledger that
    // closes the picture at READ 00001 / UNREAD 08191 starts here at zero --
    // the scanner gate crosses the whole hall in the first six seconds and
    // finds none of the 8,192 slots. The last sweep finds one.
    label(c, "VOICE SLOTS \u00b7 READ 00000 / UNREAD 08192", 84, 200, {
      size: 13, tracking: 1.8, color: css("dim", 0.8),
    });

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    return {
      bloom: 0.8 + 0.5 * f.a.vocal,
      exposure: 0.98,
      grain: 0.03,
      vignette: 0.78,
      scan: 0.04,
      ca: 0.0016,
      fade: 1 - smoothstep(0.0, 0.9, t),
    };
  }

  // ---------------------------------------------------------------- the hall
  // One move, no cuts: the lens walks the aisle from the entrance to the rack
  // that is writing the record. The racks wake rank by rank while the system
  // boots, a scanner gate crosses the whole hall, and during the assembly the
  // hall goes dark from the far end towards her, so that only she stays lit.
  hall(out, f) {
    const t = f.t;
    const aspect = this.ctx.W / this.ctx.H;
    const walk = smoothstep(0.10, 9.20, t);
    const e = walk * walk * (3 - 2 * walk);
    // the lens stops walking long before the assembly: from there the move is
    // the operator's own -- a slow rise, so that what was written in the aisle
    // is finally looked up at instead of read
    const settle = smoothstep(16.0, 21.0, t);
    const eye = [
      1.02 - e * 0.62 + Math.sin(t * 0.23) * 0.05,
      2.26 + Math.sin(t * 0.17) * 0.07 + 0.38 * settle,
      12.5 - e * 8.6,
    ];
    camera(this.vp, {
      eye, at: [0.24 - e * 0.16, 1.60 + 0.48 * settle, eye[2] - 26],
      fov: 0.94, near: 0.2, far: 300, aspect,
    });
    this.eye = eye;

    const up = smoothstep(0.25, 4.60, t);
    const hallA = smoothstep(0.05, 0.60, t) * (1 - smoothstep(21.2, 22.0, t));
    // the falling tie is a macro insert: the hall steps back for it
    const tieShot = smoothstep(9.35, 9.90, t) * (1 - smoothstep(12.45, 12.95, t));
    const dim = 1 - 0.62 * tieShot;

    // the scanner gate: one frame of light crossing the aisle while the lens
    // is still walking towards it
    const gateT = smoothstep(0.55, 5.60, t);
    const gateZ = 9.0 - gateT * 27.0;
    const gateA = (1 - smoothstep(5.60, 6.60, t)) * smoothstep(0.30, 0.80, t);

    let n = 0, l = 0, led = 0;
    for (let r = 0; r < this.ranks.length; r++) {
      const rk = this.ranks[r];
      const wake = smoothstep(0.30 + r * 0.15, 0.95 + r * 0.15, t);
      const sleep = smoothstep(
        16.80 + (this.ranks.length - 1 - r) * 0.20,
        17.55 + (this.ranks.length - 1 - r) * 0.20, t);
      const gateBoost = gateA * Math.exp(-Math.pow((rk.z - gateZ) / 5.5, 2));
      const a = hallA * dim * wake * (1 - sleep) * up;
      if (a <= 0.004) continue;
      const breathe = 0.85 + 0.15 * Math.sin(t * 0.9 + rk.seed * 6.0);
      for (const side of [-1, 1]) {
        const x = side * 2.90;
        // the rack's face catches the hall light: a filled panel, dim, with
        // the outline on top of it
        l = writeInstance(this.lightData, l, {
          p: [x, 1.55, rk.z], s: 1, c: rgb("tealDeep"),
          a: 0.115 * a * breathe, r: [0, Math.PI / 2, 0],
          scale: [0.94, 1.38, 1],
        });
        // the rack face: a frame along the aisle, not a door across it
        n = writeInstance(this.rackData, n, {
          p: [x - side * 0.01, 1.55, rk.z], s: 1, c: rgb("tealDeep"), a: 0.62 * a * breathe,
          r: [0, Math.PI / 2, 0], scale: [0.96, 1.42, 1],
        });
        n = writeInstance(this.rackData, n, {
          p: [x - side * 0.02, 1.55, rk.z], s: 1, c: rgb("tealDeep"), a: 0.26 * a,
          r: [0, Math.PI / 2, 0], scale: [0.80, 1.24, 1],
        });
        // blade slots: what makes it a server rack and not a door frame
        for (let b = 0; b < 4; b++) {
          const by = 0.72 + b * 0.52;
          const on = Math.pow(0.5 + 0.5 * Math.sin(
            t * (0.8 + rk.seed * 1.6) + b * 1.9 + rk.seed * 17.0), 6);
          l = writeInstance(this.lightData, l, {
            p: [x - side * 0.055, by, rk.z], s: 1,
            c: on > 0.4 ? rgb("miku") : rgb("tealDeep"),
            a: (0.020 + 0.075 * on + 0.09 * gateBoost) * a,
            r: [0, Math.PI / 2, 0], scale: [0.86, 0.028, 1],
          });
        }
        // the light the rack spills into the aisle
        l = writeInstance(this.lightData, l, {
          p: [x - side * 0.10, 2.34, rk.z], s: 1, c: rgb("miku"),
          a: (0.045 + 0.09 * gateBoost) * a,
          r: [0, Math.PI / 2, 0], scale: [0.72, 0.055, 1],
        });
        // LEDs, blinking through the self-test
        const rows = rk.rows;
        for (let k = 0; k < rows; k++) {
          const blink = Math.pow(0.5 + 0.5 * Math.sin(
            t * (1.7 + rk.seed * 3.1) + rk.seed * 41.0 + k * 2.7), 3);
          led = writeInstance(this.ledData, led, {
            p: [x - side * 0.08, 0.58 + k * (2.02 / Math.max(1, rows - 1)), rk.z + 0.18],
            s: 1,
            c: blink > 0.72 ? rgb("mikuHi") : rgb("miku"),
            a: (0.26 + 0.52 * blink + 0.5 * gateBoost) * a,
          });
        }
      }
    }
    this.racks.update(this.rackData, n).render(out, { vp: this.vp });
    this.lights.update(this.lightData, l).render(out, { vp: this.vp, soft: 0.9 });
    this.leds.update(this.ledData, led).render(out, { vp: this.vp, point: 3.0, sprite: 1 });

    // the floor: the aisle edge and its cross ties, running to the vanishing
    // point so the walk has something to measure itself against
    let fl = 0;
    // the scanner: a reading line crossing the whole aisle and riding down
    // the hall ahead of the lens, touching each rack as it passes it
    if (gateA > 0.004) {
      fl = writeInstance(this.floorData, fl, {
        p: [0, 1.62, gateZ + 0.02], s: 2.86, c: rgb("mikuHi"),
        a: 0.46 * gateA * hallA, r: [0, 0, Math.PI / 2],
      });
      fl = writeInstance(this.floorData, fl, {
        p: [0, 1.52, gateZ], s: 2.86, c: rgb("miku"),
        a: 0.16 * gateA * hallA, r: [0, 0, Math.PI / 2],
      });
      for (const side of [-1, 1]) {
        fl = writeInstance(this.floorData, fl, {
          p: [side * 2.80, 1.62, gateZ], s: 0.42, c: rgb("mikuHi"),
          a: 0.35 * gateA * hallA,
        });
      }
    }
    for (const side of [-1, 1]) {
      fl = writeInstance(this.floorData, fl, {
        p: [side * 2.86, 0.02, -32], s: 33, c: rgb("tealDeep"),
        a: 0.30 * hallA * up, r: [Math.PI / 2, 0, 0],
      });
    }
    fl = writeInstance(this.floorData, fl, {
      p: [0, 0.02, -32], s: 33, c: rgb("miku"), a: 0.10 * hallA * up,
      r: [Math.PI / 2, 0, 0],
    });
    for (const rk of this.ranks) {
      fl = writeInstance(this.floorData, fl, {
        p: [0, 0.02, rk.z], s: 2.86, c: rgb("tealDeep"), a: 0.16 * hallA * up,
        r: [0, 0, Math.PI / 2],
      });
    }
    this.floor.update(this.floorData, fl).render(out, { vp: this.vp, opacity: 0.95 });
  }

  // Shot 1 of her body: the hair tie, falling alone in the dark. It is its own
  // macro camera now -- a long lens, a slow fall, and the scan beam passing in
  // front of the plate, cutting it where the light actually is.
  hairTie3d(out, f) {
    const t = f.t;
    this.tieScreen = null;
    const a = smoothstep(9.35, 9.85, t) * (1 - smoothstep(12.35, 12.90, t));
    if (a <= 0.004) return;
    const aspect = this.ctx.W / this.ctx.H;
    const p = clamp((t - 9.55) / 2.25);
    const e = p * p * (3 - 2 * p);
    const y = 0.62 - e * 0.92;
    // the plate falls on the frame's golden section, not through its middle
    const x = -0.17;
    const eye = [x + 0.30 + Math.sin(t * 0.21) * 0.02, y + 0.09 - e * 0.02, 1.58];
    camera(this.tieVp, {
      eye, at: [x + 0.15, y + 0.015, 0], fov: 0.58, near: 0.05, far: 40, aspect,
    });
    const rot = [0.10 + e * 0.18, 0.16 + Math.sin(t * 0.55) * 0.12, 0.14 + e * 0.16];
    // the plate: hard square, red rim outside, blue rim inside
    let n = 0;
    n = writeInstance(this.tieData, n, {
      p: [x, y, 0], s: 1, c: rgb("red"), a: 0.80 * a,
      r: rot, scale: [0.085, 0.085, 1],
    });
    n = writeInstance(this.tieData, n, {
      p: [x, y, 0.001], s: 1, c: rgb("miku"), a: 0.50 * a,
      r: rot, scale: [0.065, 0.065, 1],
    });
    // the beam crosses in front of the plate; the hot edge is where it cuts
    const beam = x - 0.44 + p * 0.88;
    const cut = clamp(1 - Math.abs(beam - x) / 0.6);
    n = writeInstance(this.tieData, n, {
      p: [beam, y, 0.14], s: 1, c: rgb("mikuHi"), a: (0.12 + 0.24 * cut) * a,
      scale: [0.006, 0.50 + 0.06 * cut, 1],
    });
    this.tie.update(this.tieData, n).render(out, { vp: this.tieVp });

    let l = 0;
    l = writeInstance(this.lightData, l, {
      p: [x, y, -0.01], s: 1, c: rgb("miku"), a: 0.15 * a, r: rot,
      scale: [0.098, 0.098, 1],
    });
    l = writeInstance(this.lightData, l, {
      p: [beam, y, 0.15], s: 1, c: rgb("mikuHi"), a: (0.05 + 0.16 * cut) * a,
      scale: [0.016, 0.54, 1],
    });
    this.lights.update(this.lightData, l).render(out, { vp: this.tieVp, soft: 0.85 });

    const s = project(this.tieVp, [x, y, 0], this.ctx.W, this.ctx.H);
    this.tieScreen = [s[0], s[1], a];
  }

  // Three languages, each one overwriting the last: the record introduces
  // itself as a document before it introduces her as a person.
  subtitles(c, t) {
    const cards = [
      { a: 0.0, b: 2.4, size: 40, text: "\u3053\u306e\u8a18\u9332\u306f\u3001\u524a\u9664\u3055\u308c\u305f\u97f3\u58f0\u306e\u6700\u5f8c\u306e4\u520646\u79d2\u3067\u3059\u3002" },
      { a: 2.4, b: 4.8, size: 40, text: "\u6b64\u8bb0\u5f55\u4e3a\u4e00\u6bb5\u88ab\u5220\u9664\u58f0\u97f3\u7684\u6700\u540e 4 \u5206 46 \u79d2\u3002" },
      { a: 4.8, b: 7.2, size: 34, text: "This is the last 4 minutes and 46 seconds of a deleted voice." },
    ];
    const x = 220, y = 560;
    c.save();
    c.globalAlpha = 1 - smoothstep(7.2, 8.0, t);
    for (let i = 0; i < cards.length; i++) {
      const k = cards[i];
      if (t < k.a || t > k.b + 0.45) continue;
      const inA = smoothstep(k.a, k.a + 0.35, t);
      const outA = 1 - smoothstep(k.b, k.b + 0.45, t);
      const alpha = Math.min(inA, outA);
      const prev = cards[i - 1];
      const wipe = clamp((t - k.a) / 0.45);
      // the previous language is still legible while this one overwrites it
      if (prev && t < k.a + 0.45) {
        c.save();
        c.globalAlpha = alpha * (1 - wipe) * 0.55;
        c.font = TYPE_FONT(prev.size, 400);
        c.fillStyle = css("ash", 0.65);
        c.fillText(prev.text, x, y);
        c.restore();
      }
      c.save();
      c.globalAlpha = alpha;
      c.font = TYPE_FONT(k.size, 400);
      const w = c.measureText(k.text).width;
      c.beginPath();
      c.rect(x - 4, y - k.size, w * wipe + 8, k.size * 1.5);
      c.clip();
      c.fillStyle = css("bone", 0.95);
      c.fillText(k.text, x, y);
      c.restore();
      if (wipe < 1) {
        c.fillStyle = css("miku", 0.9 * alpha);
        c.fillRect(x + w * wipe, y - k.size * 0.9, 2.5, k.size * 1.2);
      }
    }
    c.restore();
  }

  // A boot log, typed a character at a time, on a macro shot of the board.
  bootLog(c, t) {
    // The log hands the frame over to the specification sheet at 14.4: the
    // machine stops talking about itself and starts describing her.
    const fade = 1 - smoothstep(13.2, 14.1, t);
    if (t < 7.2 || fade <= 0.01) return;
    const rows = [
      "> VOCALOID CV-01",
      "> VOICE BANK : HATSUNE MIKU",
      "> RENDER 0 : LAST KNOWN FRAME",
      "> SCHEDULED FOR DELETION",
      "> CODEC OK / VOICES 1024 / ERRORS 0",
    ];
    const x = 200, y0 = 260, lh = 46;
    const start = 7.2;
    c.save();
    c.globalAlpha = fade;
    for (let i = 0; i < rows.length; i++) {
      const lt = start + i * 0.34;
      if (t < lt) continue;
      const n = Math.floor((t - lt) / 0.022);
      const shown = rows[i].slice(0, n);
      const done = n >= rows[i].length;
      c.font = TYPE_FONT(26, 400);
      c.fillStyle = done ? css("bone", 0.9) : css("miku", 0.95);
      c.fillText(shown, x, y0 + i * lh);
      if (!done) {
        c.fillStyle = css("miku", 0.9);
        c.fillRect(x + c.measureText(shown).width + 4, y0 + i * lh - 22, 12, 26);
      }
    }
    // a macro circuit: one trace closing a relay, with a small spark
    const cy = 720;
    c.strokeStyle = css("dim", 0.55);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(160, cy);
    c.lineTo(520, cy);
    c.lineTo(620, cy + 90);
    c.lineTo(980, cy + 90);
    c.moveTo(160, cy + 180);
    c.lineTo(420, cy + 180);
    c.lineTo(520, cy + 90);
    c.stroke();
    const close = clamp((t - 8.4) / 0.30);
    c.strokeStyle = close > 0 ? css("mikuHi", 0.85) : css("dim", 0.6);
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(700, cy + 90);
    c.lineTo(700 + 40 * close, cy + 90);
    c.stroke();
    if (close > 0.9) {
      const a = 1 - clamp((t - 8.7) / 0.5);
      c.fillStyle = css("mikuHi", 0.9 * a);
      c.beginPath();
      c.arc(742, cy + 90, 6 + 18 * (1 - a), 0, Math.PI * 2);
      c.fill();
    }
    label(c, "POWER / BOARD A7", 1080, cy - 26, {
      size: 15, tracking: 2, color: css("ash", 0.7),
    });
    c.restore();
  }

  countdown(c, t) {
    const left = Math.max(0, 286.72 - t);
    const m = Math.floor(left / 60);
    const s = left - m * 60;
    const txt = `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
    drawText(c, txt, {
      x: 1836, y: 898, size: 34, weight: 600, mono: true, align: "right",
      color: left < 30 ? css("red", 0.95) : css("ash", 0.8),
    });
    label(c, "UNTIL DELETION", 1836, 924, {
      size: 13, align: "right", tracking: 2, color: css("dim", 0.9),
    });
  }

  // Shot 1's caption. The tie itself is the 3D object below; the label is
  // pinned to where it actually is on screen, so it survives every move.
  tieLabel(c, t) {
    const s = this.tieScreen;
    if (!s || t < 9.4 || t > 12.6) return;
    // below the plate, clear of the board log on the left and of the rack
    // readouts on the right
    label(c, "HAIR TIE / TYPE-C", s[0] + 34, s[1] + 214, {
      size: 15, align: "left", tracking: 2, color: css("ash", 0.75 * s[2]),
    });
    label(c, "COMPONENT 003 / UNDAMAGED", s[0] + 34, s[1] + 238, {
      size: 13, align: "left", tracking: 2, color: css("dim", 0.85 * s[2]),
    });
  }

  // Shot 2: the headset bar and one strand of hair — the first living things.
  headset(c, t, f) {
    if (t < 11.9 || t > 15.0) return;
    const a = smoothstep(12.0, 12.5, t) * (1 - smoothstep(14.3, 14.9, t));
    c.save();
    c.globalAlpha = a;
    c.strokeStyle = css("bone", 0.5);
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(700, 470);
    c.quadraticCurveTo(940, 330, 1180, 470);
    c.stroke();
    c.fillStyle = css("red", 0.55);
    c.beginPath();
    c.arc(1180, 470, 9, 0, Math.PI * 2);
    c.fill();
    // a strand of teal hair, with a highlight travelling up it
    const hair = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      hair.push([900 + Math.sin(u * 2.4) * 70 + u * 150, 420 + u * 470]);
    }
    c.strokeStyle = css("miku", 0.55);
    c.lineWidth = 3.2;
    c.beginPath();
    c.moveTo(hair[0][0], hair[0][1]);
    for (const p of hair) c.lineTo(p[0], p[1]);
    c.stroke();
    const hp = clamp((t - 12.2) / 1.6);
    const hi = Math.floor(hp * 40);
    c.strokeStyle = css("mikuHi", 0.75);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(hair[Math.max(0, hi - 6)][0], hair[Math.max(0, hi - 6)][1]);
    c.lineTo(hair[hi][0], hair[hi][1]);
    c.stroke();
    // her first breath: a tiny oscilloscope under the strand
    c.strokeStyle = css("miku", 0.6);
    c.lineWidth = 1.6;
    c.beginPath();
    for (let i = 0; i <= 120; i++) {
      const u = i / 120;
      const x = 720 + u * 460;
      const amp = 26 * (0.4 + 0.6 * f.a.vocal) * a * Math.sin(u * Math.PI);
      const y = 980 + Math.sin(u * 24 - t * 5) * amp;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    label(c, "FIRST BREATH", 950, 1030, {
      size: 14, align: "center", tracking: 3, color: css("miku", 0.7),
    });
    c.restore();
  }

  // Shot 3: the data sheet. Every row that is typed lights the part it names.
  specSheet(c, t) {
    if (t < 14.3) return;
    const rows = [
      ["MODEL", "CV-01"],
      ["NAME", "HATSUNE MIKU"],
      ["TWIN TAILS", "1.80 m"],
      ["VOICE", "VOCALOID / 1024"],
      ["PERSONA", "SONG"],
      ["ARM MARK", "01"],
    ];
    const x = 180, y0 = 330, lh = 62;
    const a = smoothstep(14.4, 15.0, t);
    c.save();
    c.globalAlpha = a * (1 - smoothstep(20.6, 21.4, t));
    c.strokeStyle = css("dim", 0.4);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(960, 220);
    c.lineTo(960, 900);
    c.stroke();
    label(c, "SPECIFICATION \u2014 CV-01", x, 290, {
      size: 18, tracking: 3, color: css("ash", 0.9),
    });
    rows.forEach(([k, v], i) => {
      const lt = 14.6 + i * 0.32;
      if (t < lt) return;
      const fresh = clamp((t - lt) / 0.3);
      c.globalAlpha = a * (1 - smoothstep(20.6, 21.4, t)) * fresh;
      label(c, k, x, y0 + i * lh, { size: 19, tracking: 2, color: css("ash", 0.85) });
      drawText(c, v, {
        x: 880, y: y0 + i * lh, size: 22, weight: 600, mono: true, align: "right",
        color: css("bone", 0.95),
      });
      c.fillStyle = css("miku", 0.35 * fresh);
      c.fillRect(x, y0 + i * lh + 14, 700 * fresh, 1);
    });
    // the right half answers the sheet: every row lights the part it names, so
    // she is assembled by her own specification before she is ever seen whole
    c.globalAlpha = a * (1 - smoothstep(20.6, 21.4, t));
    const lit = (i) => smoothstep(14.6 + i * 0.32, 15.0 + i * 0.32, t);
    // ...and then the paper hands every part over to the hall: as the segments
    // land, the diagram's own hints let go of them
    const hint = 1 - smoothstep(16.2, 17.6, t);
    const tails = lit(2);
    if (tails > 0.01) {
      for (const side of [-1, 1]) {
        c.save();
        c.globalAlpha = a * tails * hint;
        c.strokeStyle = css("miku", 0.5);
        c.lineWidth = 2.2;
        c.beginPath();
        c.moveTo(1330 + side * 30, 330);
        c.bezierCurveTo(
          1330 + side * 150, 420,
          1330 + side * 120, 700,
          1330 + side * 60, 900,
        );
        c.stroke();
        c.restore();
      }
      label(c, "TWIN TAILS", 1180, 940, { size: 14, tracking: 2, color: css("miku", 0.7) });
    }
    const voice = lit(3);
    if (voice > 0.01) {
      c.save();
      c.globalAlpha = a * voice * hint;
      c.strokeStyle = css("mikuHi", 0.5);
      c.lineWidth = 1.3;
      c.beginPath();
      for (let i = 0; i <= 60; i++) {
        const u = i / 60;
        const yy = 360 + u * 300;
        const xx = 1460 + Math.sin(u * 34 + t * 6.0) * 26 * (1 - u * 0.3);
        if (i === 0) c.moveTo(xx, yy);
        else c.lineTo(xx, yy);
      }
      c.stroke();
      c.restore();
      label(c, "VOICE", 1540, 506, { size: 14, tracking: 2, color: css("mikuHi", 0.7) });
    }
    const persona = lit(4);
    if (persona > 0.01) {
      c.save();
      c.globalAlpha = a * persona * hint;
      const g = c.createRadialGradient(1330, 560, 20, 1330, 560, 320);
      g.addColorStop(0, css("tealDeep", 0.35));
      g.addColorStop(1, css("tealDeep", 0));
      c.fillStyle = g;
      c.fillRect(1000, 240, 700, 700);
      c.restore();
      label(c, "PERSONA / SONG", 1180, 990, { size: 14, tracking: 2, color: css("ash", 0.75) });
    }
    // The "01" itself is printed by the figure (src/figure.js) on her left arm;
    // the sheet only names it, so the mark is never drawn twice.
    const mark = lit(5);
    if (mark > 0.01) {
      c.save();
      c.globalAlpha = a * mark * hint;
      label(c, "ARM MARK", 1500, 604, { size: 14, tracking: 2, color: css("red", 0.75) });
      c.restore();
    }
    c.restore();
  }

  // Shot 4, in the hall's own space: the drawing is re-read as line segments
  // and printed up her body. The paper pass below hands over to it at the end;
  // this is where the assembly actually happens.
  assembly3d(out, f) {
    const t = f.t;
    const a = smoothstep(15.9, 16.7, t);
    // the projected frame of the body, so the 2D layer and this pass agree
    // about where she stands no matter where the lens has ended up
    const { x: FX, z: FZ, h: FH } = this.fig;
    const feet = project(this.vp, [FX, 0, FZ], this.ctx.W, this.ctx.H);
    const top = project(this.vp, [FX, FH, FZ], this.ctx.W, this.ctx.H);
    this.figScreen = [feet[0], feet[1], feet[1] - top[1]];
    if (a <= 0.002 || !this.segs) return;

    const P = clamp((t - 16.7) / 3.2);              // the print runs 16.7 -> 19.9
    const hand = smoothstep(20.15, 21.05, t);       // then the drawing takes over
    const keep = a * (1 - hand);
    const b = this.bounds;
    const span = Math.max(1e-6, b.y1 - b.y0);
    const sx = FH / span;                           // metres per sample unit
    const cx = (b.x0 + b.x1) / 2;
    // the print head: its height *is* the landing front, so the scan and the
    // assembly are the same event
    // the head starts below the feet and overshoots the top, so every segment
    // -- the last one on her head included -- lands inside the print window
    const frontY = b.y0 - 0.14 * span + P * 1.28 * span;
    const headWy = (frontY - b.y0) * sx;
    const flare = Math.exp(-Math.pow((t - 19.95) / 0.42, 2));

    let n = 0;
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i];
      const h1 = hash(i * 3.71 + 0.13), h2 = hash(i * 5.77 + 1.7);
      const h3 = hash(i * 8.31 + 4.2), h4 = hash(i * 2.13 + 7.9);
      // where it belongs, in world metres
      const mx = FX + ((s.x0 + s.x1) / 2 - cx) * sx;
      const my = ((s.y0 + s.y1) / 2 - b.y0) * sx;
      const ang = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
      // how far the print head has passed this segment
      const reach = (frontY - (s.y0 + s.y1) / 2) / (span * 0.20);
      const u = clamp((reach - s.r * 0.35) / 1.0);
      const e = 1 - Math.pow(1 - u, 4);
      const snap = e + 0.07 * Math.sin(Math.PI * u) * (1 - u);
      // before it lands it is cold data, scattered through the hall's depth
      const px = mx + (1 - e) * (h1 - 0.5) * 26;
      const py = my + (1 - e) * ((h2 - 0.5) * 9 + 2.2);
      const pz = FZ + (1 - e) * (-7.5 - h3 * 30);
      const rot = [
        (1 - e) * (h3 - 0.5) * 2.4,
        (1 - e) * (h4 - 0.5) * 2.4,
        ang + (1 - e) * (h2 - 0.5) * 1.8,
      ];
      const kind = s.kind || "warp";
      const th = kind === "mark" ? 0.030
        : kind === "edge" ? 0.021
          : kind === "bar" ? 0.012 : 0.017;
      const hot = clamp(snap) + flare * 0.6;
      const lockCol = kind === "mark" ? rgb("red")
        : kind === "bar" ? (hot > 0.9 ? rgb("miku") : rgb("tealDeep"))
          : kind === "edge" ? rgb("mikuHi") : rgb("miku");
      const col = snap < 0.32 ? rgb("tealDeep") : lockCol;
      const warm = kind === "edge" || kind === "mark" ? 0.85
        : kind === "bar" ? 0.30 : 0.62;
      const alpha = clamp((0.12 + 0.88 * snap) * (warm + 0.35 * flare) * keep);
      if (alpha <= 0.004) continue;
      // at the end the segments retract towards the body's own axis, as the
      // flat drawing takes over the frame
      const retract = hand;
      n = writeInstance(this.bodyData, n, {
        p: [px + (FX - px) * 0.12 * retract, py, pz],
        s: 1, c: col, a: Math.min(1, alpha),
        r: rot,
        scale: [
          (s.len * sx * (1 - 0.30 * retract)
            * (kind === "bar" ? 0.55 : 0.5)) * (0.55 + 0.45 * clamp(snap + flare)),
          th, 1,
        ],
      });
    }

    // the print head itself, and the column of light under it
    if (P > 0 && P < 1.08 && hand < 0.5) {
      const ha = a * (1 - smoothstep(0.98, 1.08, P));
      n = writeInstance(this.printData, 0, {
        p: [FX, headWy, FZ + 0.06], s: 1, c: rgb("miku"),
        a: 0.20 * ha, scale: [3.1, 0.020, 1],
      });
      n = writeInstance(this.printData, 1, {
        p: [FX, headWy, FZ + 0.07], s: 1, c: rgb("mikuHi"),
        a: 0.65 * ha, scale: [2.5, 0.005, 1],
      });
      for (const side of [-1, 1]) {
        n = writeInstance(this.printData, 2 + (side + 1) / 2, {
          p: [FX + side * 2.72, headWy, FZ + 0.06], s: 1, c: rgb("miku"),
          a: 0.34 * ha, scale: [0.05, 0.42, 1],
        });
      }
      n = writeInstance(this.printData, 4, {
        p: [FX, headWy * 0.5, FZ + 0.04], s: 1, c: rgb("miku"),
        a: 0.09 * ha, scale: [0.006, Math.max(0.02, headWy * 0.5), 1],
      });
      n = writeInstance(this.printData, 5, {
        p: [FX, 0.012, FZ], s: 1, c: rgb("mikuHi"),
        a: 0.16 * ha, scale: [1.9, 0.004, 1],
      });
    }

    const fog = { dist: 72, c: rgb("ink") };
    this.body.update(this.bodyData, n)
      .render(out, { vp: this.vp, soft: 0.72, fog, eye: this.eye });
    if (n) {
      this.print.update(this.printData, 6)
        .render(out, { vp: this.vp, soft: 0.9, fog, eye: this.eye, opacity: 0.95 });
    }
  }

  // Shot 4, on the record's own page: the counter that watches the segments
  // land, and then the flat drawing that the body is handed over to.
  assembly(c, t, f) {
    const hand = smoothstep(20.15, 21.05, t);
    const fs = this.figScreen;
    const P = clamp((t - 16.7) / 3.2);
    if (t > 16.4 && t < 21.2 && fs) {
      const done = Math.round(P * this.segs.length);
      label(c, "ASSEMBLY", 1400, 246, {
        size: 15, tracking: 2.4, color: css("ash", 0.8),
      });
      drawText(c, `${done} / ${this.segs.length}`, {
        x: 1740, y: 250, size: 26, weight: 600, mono: true, align: "right",
        color: P >= 1 ? css("mikuHi", 0.95) : css("bone", 0.9),
      });
      c.fillStyle = css("dim", 0.45);
      c.fillRect(1400, 264, 340, 2);
      c.fillStyle = css("miku", 0.9);
      c.fillRect(1400, 264, 340 * P, 2);
    }
    // the flat drawing: her body arrives out of the lattice, exactly where the
    // 3D pass left it, breathing, a fraction of a second before the title
    if (hand > 0.001 && fs) {
      singer(c, fs[0], fs[1], fs[2], {
        t,
        alpha: 0.30 * hand,
        eyes: "closed",
        light: 0.35 + 0.3 * f.a.vocal,
      });
    }
    // the last beat before the title: something is about to be said
    if (t > 21.0) {
      const k = clamp((t - 21.0) / 0.6);
      c.fillStyle = css("miku", 0.18 * k);
      c.fillRect(0, 0, 1920, 1080);
    }
  }
}
