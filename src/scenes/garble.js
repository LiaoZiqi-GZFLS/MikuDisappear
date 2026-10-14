// 0:57.7 - the voice stops being able to sing.
//
// The chapter has a place, and the place is a voice tape: 26 m of it, strung
// across the room at shoulder-plus height, running from the far left of the
// frame out past the near right edge. She stands on the floor under its near
// end. Over sixteen seconds the read head loses the track, the top band of the
// strip dies behind a travelling cut, and her words come off her body one
// glyph at a time and fall.
//
// Script, shots 17-18:
//   17  0:57.69  the first tape tear; she sings and drops characters; slow
//                lateral drift, roll accumulating to -0.7 degrees; the
//                diagnostic panel walks PHONEME TABLE down to
//                HIGH BAND: NO SIGNAL.
//   18  1:05.92  she practises: her finger presses the first virtual key, the
//                slate re-records "for your smile", and the focus racks off
//                her body and onto her fingertip.
// At 1:13.42 the rip opens the whole picture onto the warm chapter.
//
// Everything is a pure function of the song's clock: the strip rides the real
// waveform, the cut front is a time, and a falling glyph's position is
// `t - its own leave time`, so any frame of this chapter can be rendered on
// its own.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { Stage3D, camera, mat4, project, rgb, writeInstance } from "../gl3d.js";
import { css } from "../palette.js";
import { clamp, hash, label, machineChrome, panel, smoothstep, specWaterfall, tickRule } from "../kit.js";
import { listener, motifLabel, singer, soundRing } from "../motifs.js";
import { beatAt } from "../semantics.js";
import { font, layout, measure } from "../type.js";
import { audioU, layer, line } from "./util.js";

const FRAG = `
uniform float uT;
uniform float uVocal;
uniform float uFlux;
uniform float uKick;
uniform float uCut;      // how much of the top band is already gone
uniform float uDrop;     // dropout amount
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec3 col = C_INK;

  // tape static: vertical stripes that thicken as the signal degrades
  float stripe = hash21(vec2(floor(uv.x * 380.0), floor(uT * 24.0)));
  float band = smoothstep(0.86, 0.88, stripe) * (0.006 + 0.028 * uDrop);
  col += vec3(0.35, 0.42, 0.42) * band;

  // a hard horizontal tear every few frames
  float tearY = floor(uT * 6.0) / 6.0;
  float tear = smoothstep(0.004, 0.0, abs(fract(uv.y * 3.0) - fract(tearY * 3.0))) * uDrop;
  col += C_MIKU * tear * 0.18;

  // the voice is still audible: one soft band of light, thinning as the top
  // end of the spectrum goes
  float alive = exp(-pow((uv.y - 0.44) * 1.7, 2.0)) * (0.05 + 0.25 * uVocal);
  col += C_TEAL_DEEP * alive * (1.0 - uCut * 0.75);
  col += C_AMBER * 0.03 * uFlux * exp(-pow((uv.y - 0.44) * 6.0, 2.0));
  col += C_MIKU * 0.05 * uKick * exp(-pow((uv.y - 0.06) * 7.0, 2.0));
  fragColor = vec4(col, 1.0);
}`;

const CORRUPT = "\u30f6\u30ae\u30af\u30b2\u30b4\u30f4\u30a1\u30f7\u30f0\u30f5\u30fd\u30fe\u3005\u4e38\u53c9";

// The room. Every number the chapter prints is measured off this one object:
// a voice tape 26 m long, hung at shoulder-plus height, running from the far
// left of the frame out past the near right edge. She stands on the floor
// under its near end; he waits further down the strip.
const SET = {
  eye: [0.55, 1.72, 6.40], at: [0.10, 1.36, -4.0], fov: 0.86,
  // The strip is 26.00 m of tape, and that is a measurement, not a caption:
  // the run is dx across and dz into the room, so dx is cut to what makes
  // hypot(dx, dz) come out at exactly the length the chapter prints
  // (grammar 3). It still leaves the frame past the near right edge, which is
  // what the shot needs -- it just no longer claims to be shorter than it is.
  tape: { x0: -9.84, dx: 19.68, z0: -14, dz: 17, y: 2.36, seg: 64, half: 0.30 },
  hero: { x: 2.30, z: 2.10, h: 1.62 },
  guest: { x: 5.70, z: -2.20, h: 1.74 },
};
const TAPE_LEN = Math.hypot(SET.tape.dx, SET.tape.dz);   // 26.00 m
const GRAINS_PER_SEG = 3;
const DUST = 150;
const BITS = 3;

export default class Garble extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "garble");
    this.lines = {};
    this.vp = mat4();

    // The set, in four draw calls: the strip itself, every line that
    // describes it (two edges, the read head, the cut front, the floor), the
    // dust in the air, and the material coming off the strip.
    this.ribbon = new Stage3D(ctx, "rect");
    this.wires = new Stage3D(ctx, "segment");
    this.dust = new Stage3D(ctx, "point");
    this.bits = new Stage3D(ctx, "rect");
    // The magnetic grains on the strip: the layer that makes it a recording
    // instead of a ribbon. They are the only thing in the room that is lit by
    // being read, so the read head's position is legible without a label.
    this.grains = new Stage3D(ctx, "point");
    this.ribbonData = new Float32Array((SET.tape.seg * 3 + 4) * 16);
    this.wireData = new Float32Array((SET.tape.seg * 3 + 8 + 9 + 18) * 16);
    this.dustData = new Float32Array(DUST * 16);
    this.bitData = new Float32Array(SET.tape.seg * BITS * 16);
    this.grainData = new Float32Array(SET.tape.seg * GRAINS_PER_SEG * 16);

    // Where the 3D set lands on screen, so the 2D layer can write on it.
    this.marks = { tape: [0, 0], head: [0, 0], cut: [0, 0], hero: [0, 0, 300], guest: [0, 0, 200] };
    this.tracking = 0;
    this.headNear = 0;
    this.grainLit = 0;
  }

  async init() {
    const F = this.ctx.features;
    this.lines = {
      sing: line(F, "\u30dc\u30af\u30ac\u4e0a\u624b\u30af"),
      stay: line(F, "\u4e00\u7dd2\u30cb\u5c45\u30c6\u30af\u30ec\u30bf"),
      practice: line(F, "\u559c\u30d6\u9854"),
    };
  }

  // Draw a line with per-glyph corruption: some characters are replaced, some
  // are pushed off their baseline, some simply do not arrive.
  drawCorrupt(c, l, t, F, o) {
    const size = o.size;
    const f = font(size, { weight: o.weight ?? 700 });
    const L = layout(c, l.text, f, o.tracking ?? 0);
    const x0 = o.x - (o.align === "center" ? L.advance / 2 : 0);
    c.font = f;
    c.textBaseline = "alphabetic";
    const ci = l.ci || [];
    for (let i = 0; i < L.chars.length; i++) {
      const ch = L.chars[i];
      if (ch === " ") continue;
      const k = ci.indexOf(i);
      const prog = k >= 0 ? F.charProgress(l, k, t) : 0;
      const seed = hash(i * 7.3 + l.start);
      const drop = seed > 0.995 - 0.06 * o.drop;
      if (drop) continue;
      const swap = seed < 0.10 * o.drop;
      const glyph = swap ? CORRUPT[Math.floor(seed * 97) % CORRUPT.length] : ch;
      const jx = (hash(i * 3.1 + 1.7) - 0.5) * 6 * o.drop;
      const jy = (hash(i * 5.7 + 9.1) - 0.5) * 10 * o.drop;
      const alpha = prog >= 0.999 ? 1 : 0.42 + 0.3 * (1 - o.drop);
      c.globalAlpha = o.alpha * alpha * (swap ? 0.8 : 1);
      c.fillStyle = prog >= 0.999 ? o.sung : o.dim;
      c.fillText(glyph, x0 + L.xs[i] + jx, o.y + jy);
      if (prog > 0.01 && prog < 0.999) {
        c.save();
        c.beginPath();
        c.rect(x0 + L.xs[i] - 4, o.y - size * 1.4, L.widths[i] * prog + 4, size * 2);
        c.clip();
        c.fillStyle = o.sung;
        c.fillText(glyph, x0 + L.xs[i] + jx, o.y + jy);
        c.restore();
      }
    }
  }

  // ------------------------------------------------------------------ the set
  // The room, in 3D. The strip is the only object in it; everything else is
  // either a line that measures the strip or dust that proves there is air.
  setPass(out, f, t, cut, drop) {
    const W = this.ctx.W, H = this.ctx.H;
    const local = t - 57.69;
    const drift = clamp(local / 16.0);
    const eye = [SET.eye[0] - 0.55 * drift, SET.eye[1], SET.eye[2]];
    camera(this.vp, { eye, at: SET.at, fov: SET.fov, near: 0.25, far: 140, aspect: W / H });
    this.eyeNow = eye;

    // Grammar 7, the air. Three falloffs, because the room holds three kinds
    // of thing: the room itself (25 m deep, so it must recede), the strip (the
    // light source of the chapter -- it keeps a long falloff so it stays
    // readable end to end), and the crumbs coming off it (they are what
    // "falls away" means, so they go into the dark the fastest).
    const AIR = { eye, fog: { dist: 46, c: rgb("ink") } };
    const STRIP_AIR = { eye, fog: { dist: 150, c: rgb("ink") } };
    const BIT_AIR = { eye, fog: { dist: 64, c: rgb("ink") } };

    const tape = SET.tape;
    const panelLen = tape.dx / tape.seg;
    // The cut walks the strip from the near end (the newest material, the end
    // she is standing under) to the far end. Behind it the top band is gone.
    const cutU = 0.985 - 0.965 * clamp((local - 0.5) / 14.7);
    // The rip: the strip is pulled apart exactly where it is being read.
    const tear = clamp((local - 14.2) / 1.7);
    // The head never settles: it is looking for a signal that is leaving, but
    // it stays on the part of the strip the lens can see -- the failure is a
    // drift, not an exit.
    const readU = clamp(0.5 + 0.24 * Math.sin(t * 0.37) + 0.10 * Math.sin(t * 1.31), 0.26, 0.70);
    this.tracking = clamp(Math.abs(readU - 0.5) / 0.24);

    let n = 0, w = 0, m = 0, b = 0, g = 0;
    this.grainLit = 0;
    for (let i = 0; i < tape.seg; i++) {
      const u = i / (tape.seg - 1);
      const h = hash(i * 3.17 + 1.7);
      // the strip rides the real waveform: what is being read is what is heard
      const wy = f.F.waveAt(t + (u - 0.5) * 2.2)[1];
      const y = tape.y + wy * 0.30 * (1 - cut * 0.8);
      const sgn = u > readU ? 1 : -1;
      const x = tape.x0 + tape.dx * u + sgn * tear * 5.2 * (0.35 + h);
      const z = tape.z0 + tape.dz * u + sgn * tear * 4.0 * (0.35 + h);
      const ty = y + sgn * tear * 0.5;
      const read = Math.exp(-Math.pow((u - readU) / 0.05, 2));
      const dead = u > cutU;   // beyond the cut there is no top band left

      // the carrier: the low half of her voice, the part still readable
      n = writeInstance(this.ribbonData, n, {
        p: [x, ty - tape.half * 0.40, z],
        c: rgb(dead ? "slate" : "tealDeep"),
        a: (dead ? 0.20 : 0.28) + 0.34 * read + 0.14 * f.a.vocal,
        scale: [panelLen * 0.50, tape.half * 0.40, 1],
      });
      // the top band: the first thing the cut takes. Behind the cut it is
      // still there -- a tape that has lost its top end is a tube that is off,
      // not a tube that has been removed.
      n = writeInstance(this.ribbonData, n, {
        p: [x, ty + tape.half * 0.52, z],
        c: rgb(dead ? "slate" : read > 0.35 ? "mikuHi" : "miku"),
        a: dead ? 0.055 : 0.12 + 0.30 * read + 0.10 * f.a.mid,
        scale: [panelLen * 0.50, tape.half * 0.34, 1],
      });
      // and the cut front itself: one red panel, full height, standing where
      // the band dies
      if (Math.abs(u - cutU) < 0.55 / tape.seg) {
        n = writeInstance(this.ribbonData, n, {
          p: [x, ty, z + 0.03],
          c: rgb("red"),
          a: 0.55 + 0.35 * f.a.flux,
          scale: [panelLen * 0.13, tape.half * 1.25, 1],
        });
      }

      // perforations: the small holes that make it a piece of tape and not a
      // row of lit windows
      if (i % 3 === 0) {
        w = writeInstance(this.wireData, w, {
          p: [x, ty - tape.half * 0.78, z],
          c: rgb("dim"),
          a: 0.22,
          scale: [1, 0.035, 1],
        });
      }

      // the two edges: the light that tells the eye this is one piece of tape
      for (const side of [-1, 1]) {
        w = writeInstance(this.wireData, w, {
          p: [x, ty + side * tape.half, z],
          c: rgb(read > 0.35 ? "mikuHi" : "miku"),
          a: 0.10 + 0.32 * read + 0.10 * (1 - cut),
          r: [0, 0, Math.PI / 2],
          scale: [1, panelLen * 0.52, 1],
        });
      }

      // the grains: a strip this long cannot show a metre, but it can show
      // what a metre is made of. A grain lights under the head, stays
      // magnetised for a moment behind it, and is dark past the cut -- so the
      // head's drift and the cut front are both readable from the strip alone.
      const mag = u < readU ? Math.exp(-(readU - u) / 0.10) : 0;
      for (let k = 0; k < GRAINS_PER_SEG; k++) {
        const hg = hash(i * 7.13 + k * 3.31 + 0.7);
        const a = clamp((0.10 + 0.62 * read + 0.34 * mag)
          * (dead ? 0.18 : 1) * (0.45 + 0.55 * hg));
        if (a > 0.02) this.grainLit++;
        g = writeInstance(this.grainData, g, {
          p: [
            x + (hg - 0.5) * 0.07,
            ty + (hg - 0.5) * tape.half * 1.5,
            z + (hash(i * 2.9 + k * 1.7) - 0.5) * 0.05,
          ],
          s: 1,
          c: read > 0.40 ? rgb("mikuHi") : rgb("miku"),
          a,
        });
      }

      // What came off the strip: deterministic crumbs that leave the tape at
      // their own moment and fall through the room. Nothing here is integrated
      // frame to frame -- a crumb's position is a function of the song's
      // clock, so any frame of this chapter can be cut on its own.
      for (let k = 0; k < BITS; k++) {
        const hk = hash(i * 9.13 + k * 4.7 + 2.3);
        if (hk > 0.20 + drop * 0.62) continue;
        const age = t - (57.9 + hk * 13.6);
        if (age < 0 || age > 1.6) continue;
        const vy = 0.55 + hk * 0.95;
        b = writeInstance(this.bitData, b, {
          p: [
            x + (hk - 0.5) * 0.7 + age * (hk - 0.5) * 1.2,
            ty - tape.half - vy * age - 1.9 * age * age,
            z + (hk - 0.5) * 0.6 - age * 0.5,
          ],
          s: 0.026 + 0.030 * hk,
          c: k ? rgb("miku") : rgb("bone"),
          a: (1 - age / 1.6) * (0.30 + 0.40 * hk),
          r: [age * (1.4 + hk * 2.4), age * 1.2, age * hk * 3.2],
        });
      }
    }

    // the read head: one bar the machine keeps dragging over her, and the
    // only thing in the room that moves on its own
    const headU = readU;
    const hx = tape.x0 + tape.dx * headU;
    const hz = tape.z0 + tape.dz * headU;
    const hy = tape.y;
    for (const side of [-1, 1]) {
      w = writeInstance(this.wireData, w, {
        p: [hx, hy + side * 0.02, hz + 0.05],
        c: rgb(side < 0 ? "mikuHi" : "miku"),
        a: side < 0 ? 0.72 : 0.30,
        scale: [1, 0.95 * (1 + 0.05 * Math.sin(t * 2.1)), 1],
      });
    }

    // the floor: what turns a strip hanging in the dark into a room
    for (let i = -8; i <= 8; i++) {
      w = writeInstance(this.wireData, w, {
        p: [i * 2.1, 0, -11], c: rgb("dim"),
        a: i % 3 === 0 ? 0.085 : 0.045,
        r: [Math.PI / 2, 0, 0], scale: [1, 14, 1],
      });
    }
    for (let j = 0; j < 9; j++) {
      w = writeInstance(this.wireData, w, {
        p: [0, 0, 3 - j * 2.9], c: rgb("dim"),
        a: 0.075 - j * 0.004,
        r: [0, 0, Math.PI / 2], scale: [1, 15.4, 1],
      });
    }

    // dust: the air the tape runs through
    for (let i = 0; i < DUST; i++) {
      const h0 = hash(i * 2.71 + 0.3), h1 = hash(i * 5.13 + 1.1), h2 = hash(i * 8.77 + 2.9);
      m = writeInstance(this.dustData, m, {
        p: [
          -14 + 28 * h0 + 0.25 * Math.sin(t * 0.21 + i),
          0.12 + 3.3 * h2 + 0.10 * Math.sin(t * 0.37 + i * 1.7),
          -22 + 27 * h1,
        ],
        s: 1,
        c: rgb(i % 7 ? "dim" : "miku"),
        a: 0.10 + 0.18 * hash(i * 1.31),
      });
    }

    this.ribbon.update(this.ribbonData, n)
      .render(out, { ...STRIP_AIR, vp: this.vp, soft: 0.25, opacity: 0.95 });
    this.grains.update(this.grainData, g)
      .render(out, { ...STRIP_AIR, vp: this.vp, point: 2.0, sprite: 1, opacity: 0.9 });
    this.bits.update(this.bitData, b)
      .render(out, { ...BIT_AIR, vp: this.vp, soft: 0.5, opacity: 0.9 });
    this.wires.update(this.wireData, w).render(out, { ...AIR, vp: this.vp });
    this.dust.update(this.dustData, m).render(out, {
      ...AIR, vp: this.vp, point: 2.2, sprite: 1, opacity: 0.8,
    });

    // ---- where the 2D layer is allowed to write, in screen pixels
    const at = (u, dy) => project(this.vp, [
      tape.x0 + tape.dx * u, tape.y + dy, tape.z0 + tape.dz * u,
    ], W, H);
    this.marks.tape = at(0.18, -tape.half * 1.9);
    this.marks.cut = at(cutU, -tape.half * 1.9);
    // The head's label goes *above* the strip: below it, the strip's own name
    // and grain count are written, and the head travels the whole length of
    // them -- a label that the subject can walk into is not a label.
    this.marks.head = project(this.vp, [hx, hy + 0.62, hz], W, H);

    // She stands on the same floor the grid is drawn on, so the size she has
    // in the picture is the size the room gives her: the room decides, not the
    // drawing.
    const foot = (p) => project(this.vp, [p.x, 0, p.z], W, H);
    const top = (p) => project(this.vp, [p.x, p.h, p.z], W, H);
    const hf = foot(SET.hero), ht = top(SET.hero);
    this.marks.hero = [hf[0], hf[1], Math.max(120, hf[1] - ht[1])];
    const gf = foot(SET.guest), gt = top(SET.guest);
    this.marks.guest = [gf[0], gf[1], Math.max(70, gf[1] - gt[1])];
    // how close the head is to her body: her one light in this chapter comes
    // off the machine that is reading her
    this.headNear = Math.exp(-Math.pow(Math.hypot(hx - SET.hero.x, hz - SET.hero.z) / 3.4, 2));
  }

  // The rip of shot 18: at 1:13.42 the picture is torn open where it is being
  // read, and the warm light of the next chapter is what is behind it.
  rip(c, tear) {
    if (tear <= 0.001) return;
    const cx = clamp(this.marks.head[0], 300, 1620);
    // the slit the engine's own tear join will finish opening one beat later:
    // it starts at the read head and stays narrow until the hand-over
    const halfW = 10 + 92 * tear;
    c.save();
    // the warm light behind the picture: the next chapter is already there
    const g = c.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
    g.addColorStop(0, css("amber", 0));
    g.addColorStop(0.28, css("amber", 0.34 * tear));
    g.addColorStop(0.5, css("amber", 0.70 * tear));
    g.addColorStop(0.72, css("amber", 0.34 * tear));
    g.addColorStop(1, css("amber", 0));
    c.fillStyle = g;
    c.fillRect(cx - halfW, 0, halfW * 2, 1080);
    // two torn edges: the picture is coming apart, it is not fading
    for (const sgn of [-1, 1]) {
      c.beginPath();
      for (let i = 0; i <= 24; i++) {
        const y = (i / 24) * 1080;
        const j = (hash(i * 3.7 + (sgn > 0 ? 11.3 : 5.1)) - 0.5) * 34 * tear;
        const x = cx + sgn * halfW * (0.72 + 0.28 * Math.abs(Math.sin(i * 1.7))) + j;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.strokeStyle = css("ink", 0.9 * tear);
      c.lineWidth = 6 + 12 * tear;
      c.stroke();
      c.strokeStyle = css("bone", 0.30 * tear);
      c.lineWidth = 1.6;
      c.stroke();
      c.strokeStyle = css("red", 0.45 * tear);
      c.lineWidth = 1;
      c.setLineDash([9, 13]);
      c.stroke();
      c.setLineDash([]);
    }
    c.restore();
  }

  render(f, out) {
    const t = f.t;
    const local = t - 57.69;
    const cut = smoothstep(0.6, 15.2, local);          // the top band dies
    const drop = clamp(0.15 + local / 13.0);           // dropouts accumulate
    const tear = clamp((local - 14.2) / 1.7);          // shot 18's rip
    const beat = beatAt(f.F, t);
    const id = beat ? beat.id : "";
    const staying = id === "you_stayed" || id === "practice_for_smile";

    this.pass.draw({ dst: out, u: audioU(f, { uCut: cut, uDrop: drop }) });
    this.setPass(out, f, t, cut, drop);

    const c = this.text.ctx;
    this.text.clear();

    const hero = this.marks.hero;
    const guest = this.marks.guest;

    // ---- the listener is no longer a second portrait in a corner: he stands
    // on the same floor, further down the strip, and only while the song is
    // about him.
    const guestIn = smoothstep(this.lines.stay.start - 0.5, this.lines.stay.start + 1.2, t)
      * (1 - smoothstep(72.4, 73.3, t));
    if (guestIn > 0.002) {
      const pool = c.createRadialGradient(guest[0], guest[1] - 6, 4, guest[0], guest[1] - 6, guest[2] * 0.5);
      pool.addColorStop(0, css("amber", 0.16 * guestIn));
      pool.addColorStop(1, css("amber", 0));
      c.fillStyle = pool;
      c.fillRect(guest[0] - guest[2] * 0.6, guest[1] - guest[2] * 0.5, guest[2] * 1.2, guest[2] * 0.6);
      listener(c, guest[0], guest[1], guest[2], {
        t,
        alpha: 0.16 + 0.5 * guestIn,
        smile: id === "practice_for_smile" ? 1 : 0.4,
        scan: id === "practice_for_smile" ? (t * 0.55) % 1 : 0,
      });
    }

    // ---- her. Shot 18's rack focus: the picture lets go of her body and
    // finds her fingertip instead, so she is drawn soft and the hand is not.
    const focus = smoothstep(this.lines.practice.start, this.lines.practice.start + 2.6, t);
    c.save();
    if (focus > 0.01) c.filter = `blur(${(2.6 * focus).toFixed(2)}px)`;
    singer(c, hero[0], hero[1], hero[2], {
      t,
      alpha: 0.20 + 0.42 * (staying ? 1 : 0.55),
      mouth: 0.25 + 0.7 * f.a.vocal,
      sadMouth: id === "cannot_sing",
      dissolve: clamp(0.12 + drop * 0.7),
      crack: cut * 0.9,
      heart: staying ? 1 : Math.max(0.1, 1 - drop * 0.8),
      reach: focus > 0.35 ? { x: 0.42, y: -0.46 } : null,
      light: clamp(0.25 + 0.75 * this.headNear),
    });
    c.restore();

    // ---- shot 18: the first virtual key, and she is playing it on the beat
    const keyX = hero[0] + hero[2] * 0.42;
    const keyY = hero[1] - hero[2] * 0.46;
    if (local > 8.0) {
      const born = clamp((local - 8.0) / 1.2);
      const press = clamp(f.kick) * born;
      const kw = 86 * born, kh = 130 * born;
      c.save();
      c.globalAlpha = 0.35 + 0.55 * born;
      // one white key and one black key, drawn as a hologram
      c.fillStyle = css("miku", 0.10);
      c.fillRect(keyX - kw / 2, keyY - kh / 2 + press * 5, kw, kh);
      c.strokeStyle = css("mikuHi", 0.75);
      c.lineWidth = 1.4;
      c.strokeRect(keyX - kw / 2, keyY - kh / 2 + press * 5, kw, kh);
      c.fillStyle = css("ink", 0.55);
      c.fillRect(keyX - 21, keyY - kh / 2 + press * 5, 42, kh * 0.56);
      c.strokeStyle = css("miku", 0.55);
      c.strokeRect(keyX - 21, keyY - kh / 2 + press * 5, 42, kh * 0.56);
      motifLabel(c, "KEY 01 / SING", keyX, keyY + kh / 2 + 26, {
        align: "center", color: css("miku", 0.5 + 0.4 * born),
      });
      c.restore();
      if (press > 0.45) {
        soundRing(c, keyX, keyY, (t * 2.2) % 1, {
          alpha: 0.5 * born, r0: 8, r1: 120, color: css("mikuHi", 0.6),
        });
      }
      // the focus box: a camera finding her fingertip while the rest of her is
      // already soft
      if (focus > 0.02) {
        const fx = keyX, fy = keyY - kh * 0.10;
        const s = 74 + 34 * (1 - focus);
        c.save();
        c.globalAlpha = 0.85 * focus;
        c.strokeStyle = css("bone", 0.85);
        c.lineWidth = 1.6;
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            c.beginPath();
            c.moveTo(fx + sx * s, fy + sy * s * 0.6);
            c.lineTo(fx + sx * s, fy + sy * s);
            c.lineTo(fx + sx * s * 0.6, fy + sy * s);
            c.stroke();
          }
        }
        label(c, "AF LOCK 0.62 m", fx, fy - s - 12, {
          size: 14, align: "center", tracking: 1.6, color: css("bone", 0.8),
        });
        c.restore();
      }
    }

    // ---- what the machine can no longer hold: the line she is singing comes
    // off her body, one glyph at a time, and falls out of the frame
    const glyphs = f.line && f.line.text
      ? [...f.line.text].filter((ch) => ch !== " " && ch !== "\u3000") : null;
    if (glyphs && glyphs.length) {
      c.save();
      c.textBaseline = "alphabetic";
      for (let i = 0; i < 30; i++) {
        const h0 = hash(i * 6.11 + 1.3), h1 = hash(i * 4.37 + 7.9);
        const birth = 57.9 + h0 * 14.4;
        const age = t - birth;
        if (age < 0 || age > 2.2) continue;
        const ch = glyphs[(i + Math.floor(h0 * glyphs.length)) % glyphs.length];
        const x0 = hero[0] + (h1 - 0.5) * hero[2] * 0.34;
        const y0 = hero[1] - hero[2] * (0.30 + 0.30 * h0);
        const x = x0 + (h1 - 0.5) * 46 * age;
        const y = y0 + (80 + 130 * h0) * age + 150 * age * age;
        c.globalAlpha = (1 - age / 2.2) * (0.35 + 0.45 * h1) * (0.55 + 0.45 * drop);
        c.fillStyle = i % 3 ? css("miku") : css("bone");
        c.font = font(19 + 11 * h1, { weight: 400 });
        c.fillText(ch, x, y);
      }
      c.restore();
    }

    // ---- the machine's readout, kept clear of the film's own HUD
    panel(c, 84, 700, 620, 230, {
      fill: css("ink2", 0.85), corner: 12, cornerColor: css("red", 0.5),
      stroke: css("dim", 0.5),
    });
    label(c, "VOICE DIAGNOSTIC", 100, 692, { size: 17, tracking: 1.6, color: css("ash", 0.95) });
    const rows = [
      ["PHONEME TABLE", `${(100 - cut * 62).toFixed(1)} %`, cut > 0.2],
      ["PITCH STABILITY", `${Math.max(4, 94 - local * 5.6).toFixed(1)} %`, true],
      ["BREATH MODEL", local > 6 ? "OFFLINE" : "OK", local > 6],
      ["HIGH BAND > 8 kHz", cut > 0.5 ? "NO SIGNAL" : "weak", cut > 0.5],
      ["TAPE SPEED", "19.05 cm/s", false],
      ["DROPOUTS", `${Math.floor(local * 7.3 * drop)}`, true],
      // the read head is what is drifting: the tape is fine, the machine is not
      ["HEAD OFFSET", `${(this.tracking * 100).toFixed(1)} %`, this.tracking > 0.15],
    ];
    rows.forEach(([k, v, bad], i) => {
      const ry = 726 + i * 31;
      label(c, k, 104, ry, { size: 17, color: css("ash", 0.85), tracking: 1.2 });
      label(c, v, 684, ry, {
        size: 17, align: "right", color: bad ? css("red", 0.95) : css("miku", 0.9), tracking: 1.2,
      });
      if (bad) {
        c.fillStyle = css("red", 0.75);
        c.fillRect(94, ry - 11, 7, 7);
      }
    });

    // the spectrum, with the top end cut away -- live, from the real analysis
    panel(c, 1200, 140, 640, 210, {
      fill: css("ink2", 0.6), corner: 10, cornerColor: css("dim", 0.5),
      stroke: css("dim", 0.4),
    });
    label(c, "SPECTRUM / 64 BANDS", 1220, 172, {
      size: 14, tracking: 1.8, color: css("dim", 0.85),
    });
    specWaterfall(c, f.F, t, {
      x: 1220, y: 186, w: 600, h: 132, span: 5.0, alpha: 0.9, gain: 0.85,
      decayBands: Math.round(cut * 44),
    });
    const scut = 186 + 132 * (cut * 0.72);
    c.strokeStyle = css("red", 0.8);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(1220, scut);
    c.lineTo(1820, scut);
    c.stroke();
    label(c, `CUT ${(cut * 20).toFixed(1)} kHz`, 1820, scut - 10, {
      size: 16, align: "right", color: css("red", 0.9), tracking: 1.2,
    });
    tickRule(c, 1220, 372, 600, { count: 20, h: 5, major: 4, majorH: 10, color: css("dim", 0.5) });

    // ---- the words. The machine's transcription is left-aligned in the upper
    // band (where it cannot fight the panels); the line she is actually
    // singing sits under the strip, already coming apart.
    let y = 190;
    for (const k of ["sing", "stay", "practice"]) {
      const l = this.lines[k];
      if (t < l.start - 0.3) continue;
      const fresh = clamp((t - l.start) / 0.25);
      this.drawCorrupt(c, l, t, f.F, {
        x: 150, y, size: 40, align: "left", tracking: 1.5,
        sung: css("bone", 0.95 * fresh), dim: css("ash", 0.5 * fresh),
        drop, alpha: 1,
      });
      y += 64;
    }
    const active = f.line;
    if (active && active !== this.lines.sing && active !== this.lines.stay
        && active !== this.lines.practice && active.kind !== "marker") {
      this.drawCorrupt(c, active, t, f.F, {
        x: 150, y: 600, size: 42, align: "left", tracking: 1,
        sung: css("bone", 0.9), dim: css("ash", 0.5), drop: drop * 0.6, alpha: 1,
      });
    }

    // the slate: this is a recording, and it is being taken again and again
    if (staying) {
      const take = 120 + Math.floor(local * 1.4);
      motifLabel(c, id === "practice_for_smile"
        ? `TAKE ${take} / FOR YOUR SMILE` : "STAYED BESIDE HER", 960, 126, {
        align: "center", color: css("amber", 0.8),
      });
      c.save();
      c.globalAlpha = 0.30;
      c.strokeStyle = css("amber", 0.6);
      c.lineWidth = 1.2;
      c.setLineDash([4, 9]);
      c.beginPath();
      c.moveTo(980, 110);
      c.quadraticCurveTo(1240, 60 + Math.sin(t * 1.7) * 12, guest[0] - 40, guest[1] - guest[2] * 0.9);
      c.stroke();
      c.setLineDash([]);
      c.restore();
    }
    if (id === "cannot_sing") {
      c.save();
      c.globalAlpha = 0.6;
      c.strokeStyle = css("miku", 0.7);
      c.lineWidth = 1.4;
      c.beginPath();
      for (let i = 0; i <= 90; i++) {
        const u = i / 90;
        if (i > 34 && i < 44) continue;
        if (i > 65 && i < 71) continue;
        const x = hero[0] - 290 + u * 580;
        const yy = hero[1] - hero[2] * 1.02 + Math.sin(u * 25 - t * 6) * (2 + 20 * (1 - u) * f.a.vocal);
        if (i === 0) c.moveTo(x, yy);
        else c.lineTo(x, yy);
      }
      c.stroke();
      c.restore();
    }

    // ---- the set, named. Four readouts ride one strip, and the cut front
    // walks the whole length of them; at t = 70 s it passes under the strip's
    // own name, which is when a camera would pan or a machine would avoid it.
    // The labels are placed as one small collision set instead: the name
    // keeps its row, the grain count stays under it, and the two travelling
    // labels (read head, cut front) step off the row until they are clear.
    // A readout the subject can walk into is not a readout.
    const boxes = [];
    const spot = (anchor, y, w, h, o = {}) => {
      const cx = o.center ? anchor : anchor + w / 2;
      const cy = () => y - h * 0.35;
      for (let guard = 0; guard < 10; guard++) {
        const hit = boxes.find((b) =>
          Math.abs(cx - b.cx) < (w + b.w) * 0.5
          && Math.abs(cy() - b.cy) < (h + b.h) * 0.5);
        if (!hit) break;
        y += (o.up ? -1 : 1) * (h + 5);
      }
      boxes.push({ cx, cy: cy(), w, h });
      return y;
    };
    const box = (text, size, tracking) =>
      [measure(c, text, font(size, { mono: true }), tracking), size * 1.18];

    // The grain count is the geometry of the strip, not a claim about it:
    // `grainLit` is how many of the 192 grains came out above the visibility
    // threshold this frame, the same way the ribbons above are counted.
    const grains = SET.tape.seg * GRAINS_PER_SEG;
    const tapeName = `VOICE TAPE / CV-01 \u2014 ${TAPE_LEN.toFixed(2)} m`;
    const grainName = `GRAINS ${grains} / LIT ${String(this.grainLit).padStart(3, "0")}`;
    const [wName, hName] = box(tapeName, 15, 1.8);
    const nameY = spot(this.marks.tape[0] + 10, this.marks.tape[1], wName, hName);
    label(c, tapeName, this.marks.tape[0] + 10, nameY, {
      size: 15, tracking: 1.8, color: css("dim", 0.85),
    });
    const [wGrain, hGrain] = box(grainName, 13, 1.6);
    const grainY = spot(this.marks.tape[0] + 10, nameY + 22, wGrain, hGrain);
    label(c, grainName, this.marks.tape[0] + 10, grainY, {
      size: 13, tracking: 1.6, color: css("miku", 0.75),
    });

    const headText = "READ HEAD";
    const headX = clamp(this.marks.head[0], 130, 1790);
    const [wHead, hHead] = box(headText, 13, 2);
    const headY = spot(headX, this.marks.head[1], wHead, hHead, { center: true, up: true });
    label(c, headText, headX, headY, {
      size: 13, align: "center", tracking: 2, color: css("miku", 0.7),
    });

    const cutText = `CUT ${(cut * 20).toFixed(1)} kHz`;
    const [wCut, hCut] = box(cutText, 14, 1.6);
    const cutY = spot(this.marks.cut[0], this.marks.cut[1], wCut, hCut, { center: true });
    label(c, cutText, this.marks.cut[0], cutY, {
      size: 14, align: "center", tracking: 1.6, color: css("red", 0.85),
    });

    machineChrome(c, {
      name: "",
      left: "DEGRADED \u2014 \u30dc\u30a4\u30b9\u30c1\u30a7\u30c3\u30af\u5931\u6557",
      right: `DROPOUT ${(drop * 100).toFixed(0)} %`,
    });

    // the rip is drawn last: it tears the picture, the readouts included
    this.rip(c, tear);

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    return {
      bloom: 0.8,
      exposure: 0.95,
      grain: 0.035 + 0.05 * drop,
      vignette: 0.65,
      scan: 0.08 + 0.12 * drop,
      ca: 0.0015 + 0.004 * drop,
      shake: [0.002 * drop * Math.sin(t * 41.0), 0.0015 * drop * Math.sin(t * 57.0)],
    };
  }
}
