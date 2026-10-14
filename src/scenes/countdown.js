// 1:29.7 - the inventory of what is left. Voices, bands, phrases: everything
// the machine still owns, counted down in public.
//
// The instrument is the picture now. Sixty-four pipes stand in a hall as tall
// as they are -- low notes are long pipes, high notes are short ones, and the
// facade is an arch with the longest pipe in the middle. Every lit pipe is
// driven by the real spectrum of the recording, so the organ is literally
// playing the song, and a pipe goes dark every fifth of a second until only
// the short ones at the edges are left. The lens starts down among them and
// pulls back to a symmetric wide shot: the most museum-like frame in the film,
// and the last one before the emergency stop.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import {
  clamp, label, lyricLine, machineChrome, panel, smoothstep, specBars, tickRule, wave,
} from "../kit.js";
import { listener, motifLabel, note, singer } from "../motifs.js";
import { beatAt } from "../semantics.js";
import { draw as drawText, pad } from "../type.js";
import { Stage3D, TUBE_SEG, camera, mat4, project, rgb, writeInstance } from "../gl3d.js";
import { audioU, layer } from "./util.js";

const FRAG = `
uniform float uT;
uniform float uLow;
uniform float uHigh;
uniform float uVocal;
uniform float uKick;
uniform float uRemain;   // 1 -> 0 across the section
uniform float uAlarm;    // 0 -> 1 in the last seconds, when stop is armed
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec3 col = C_INK;
  float grid = smoothstep(0.48, 0.5, abs(fract(uv.y * 54.0) - 0.5));
  col += C_TEAL_DEEP * grid * 0.05;

  // the frame loses its top: a dark shutter closing downward
  float shutter = smoothstep(1.0 - uAlarm * 0.9, 1.0 - uAlarm * 0.9 + 0.02, uv.y);
  col *= 1.0 - shutter * 0.70;
  col += C_RED_DEEP * shutter * 0.05;

  col += C_MIKU * 0.06 * uLow * exp(-pow((uv.y - 0.04) * 8.0, 2.0));
  col += C_MIKU_HI * 0.05 * uKick * exp(-pow((uv.y - 0.5) * 30.0, 2.0));
  col += C_TEAL_DEEP * 0.08 * uVocal * exp(-pow((uv.y - 0.62) * 5.0, 2.0));
  col *= 0.96 + 0.08 * uHigh;
  fragColor = vec4(col, 1.0);
}`;

const COLS = 16;
const ROWS = 4;
const PIPES = COLS * ROWS;
const DUST = 300;
const DEATHS = 13.2;      // seconds from the first pipe to the last

export default class Countdown extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "countdown");

    // One hall, nine passes: the pipe cages, the lit cores inside them, their
    // halo, their reflections, the valves at their feet, the wind rising
    // through the lit ones, the embers of the dead, the floor, and the air.
    this.vp = mat4();
    this.pipes = new Stage3D(ctx, "rect");
    this.glow = new Stage3D(ctx, "rect");
    this.mirror = new Stage3D(ctx, "rect");
    this.cage = new Stage3D(ctx, "tube");
    this.valve = new Stage3D(ctx, "segment");
    this.wind = new Stage3D(ctx, "point");
    this.embers = new Stage3D(ctx, "point");
    this.floor = new Stage3D(ctx, "segment");
    this.dust = new Stage3D(ctx, "point");
    this.pipeData = new Float32Array(PIPES * 16);
    this.glowData = new Float32Array(PIPES * 16);
    this.mirrorData = new Float32Array(PIPES * 16);
    this.cageData = new Float32Array(PIPES * 16);
    this.valveData = new Float32Array(PIPES * 2 * 16);
    this.windData = new Float32Array(PIPES * 2 * 16);
    this.emberData = new Float32Array(PIPES * 3 * 16);
    this.floorData = new Float32Array(64 * 16);
    this.dustData = new Float32Array(DUST * 16);

    // The facade. A pipe's pitch is its length, so the arch is a bass clef
    // written in architecture: long low pipes in the middle, short high ones
    // at the wings, four ranks deep on a stepped platform.
    this.organ = [];
    for (let c = 0; c < COLS; c++) {
      const u = ((c + 0.5) / COLS) * 2 - 1;                 // -1 .. 1
      const w = Math.pow(Math.cos((u * Math.PI) / 2), 1.5); // 1 in the middle
      const band = Math.round(63 * (1 - w));
      const h = 3.0 + 11.2 * Math.pow(w, 1.15);
      for (let r = 0; r < ROWS; r++) {
        this.organ.push({
          c, r,
          x: u * 13.6,
          z: -6 - r * 7.2,
          y0: 0.7 + r * 1.5,
          h, band, w,
          rank: 0,
          seed: c * 3.7 + r * 11.3,
        });
      }
    }
    // The order of failure is the order of pitch: lowest note first, so the
    // arch goes out from the middle and what is left is short and wide. A rank
    // (not a band) is what keeps "N pipes remaining" equal to N lit pipes --
    // the facade only samples sixteen bands, so bands alone would miscount.
    [...this.organ]
      .sort((a, b) => (a.band - b.band) || (a.r - b.r))
      .forEach((p, i) => { p.rank = i; });

    this.dustSeeds = [];
    for (let i = 0; i < DUST; i++) {
      const h = (k) => {
        const s = Math.sin(i * 9.13 + k * 41.7) * 23571.31;
        return s - Math.floor(s);
      };
      this.dustSeeds.push({
        x: (h(1) - 0.5) * 44,
        y: 1 + h(2) * 22,
        z: -32 + h(3) * 42,
        ph: h(4) * Math.PI * 2,
        a: 0.10 + h(5) * 0.25,
      });
    }
  }

  // The pull-back. It starts inside the instrument, at eye level with the
  // platform, and ends outside the arch: a symmetric wide shot that lets the
  // audience count the pipes for themselves. The last second drifts right and
  // up a little, the way a camera operator lets go of a frame.
  view(local, aspect) {
    const e = clamp(local / DEATHS);
    const u = e * e * (3 - 2 * e);
    const k = smoothstep(10.4, DEATHS, local);
    const eye = [
      0 + 4.2 * k * u,
      3.4 + 8.0 * u + 2.0 * k,
      2.0 + 30.0 * u + 6.0 * k,
    ];
    const at = [0, 8.6 - 1.0 * u, -20];
    const fov = 1.05 - 0.17 * u;
    camera(this.vp, { eye, at, fov, near: 0.5, far: 300, aspect });
    this.eye = eye;
    return { eye, at };
  }

  render(f, out) {
    const t = f.t;
    const local = t - 89.69;
    const remain = 1 - clamp(local / DEATHS);
    const alarm = smoothstep(11.3, DEATHS, local);
    this.pass.draw({ dst: out, u: audioU(f, { uRemain: remain, uAlarm: alarm }) });

    const view = this.view(local, this.ctx.W / this.ctx.H);
    const alive = Math.max(0, Math.min(PIPES, Math.round(PIPES * remain)));
    this.organPass(out, f, t, local, alive, remain, view.eye);
    this.hallPass(out, t, remain, view.eye);

    const c = this.text.ctx;
    this.text.clear();
    this.ui(c, f, t, local, remain, alive);
    this.ctx.drawLayer(out, this.text, { mode: "normal" });

    return {
      bloom: 0.9,
      exposure: 0.98,
      grain: 0.028,
      vignette: 0.68,
      scan: 0.05,
      ca: 0.002,
      flash: 0.05 * clamp((local - 12.4) / 0.3) * f.kick,
      shake: [0, 0.002 * (1 - remain)],
    };
  }

  // ---- the organ. The lit pipes are driven by the real spectrum; the dead
  // ones drop to black and leave one ember at the mouth that cools off.
  organPass(out, f, t, local, alive, remain, eye) {
    const MI = rgb("miku"), HI = rgb("mikuHi"), DP = rgb("tealDeep"), RD = rgb("red");
    const DM = rgb("dim");
    // The air (grammar 7): the pull-back ends 44 m from the nearest pipe and
    // 65 m from the far rank, so the instrument has to recede while the lens
    // walks away from it -- the wide shot is a room, not a zoom-out.
    const AIR = { eye, fog: { dist: 150, c: rgb("ink") } };
    const AIR_REFL = { eye, fog: { dist: 120, c: rgb("ink") } };
    let n = 0, g = 0, m = 0, e = 0, cg = 0, vv = 0, wd = 0;
    for (const p of this.organ) {
      // The arch goes out from the middle: the long low pipes die first, the
      // instrument loses its range before it loses its size.
      const lit = p.rank >= PIPES - alive;
      const depth = 1 - 0.045 * Math.abs(p.z + 6);
      const dieAt = DEATHS * (p.rank + 1) / PIPES;
      const since = local - dieAt;
      const w = 0.15 + 0.10 * p.w;
      const cy = p.y0 + p.h / 2;
      const v = lit ? Math.pow(clamp(f.F.specAt(p.band, t)), 1.15) : 0;
      const a = (0.06 + 0.26 * v) * depth;

      // The cage stands whether the pipe is lit or not: a dead rank is still
      // a rank, and the instrument's size never changes -- only its range
      // does. One instance of GEO.tube is TUBE_SEG line segments, which is
      // the number the readout below calls DRAWN.
      cg = writeInstance(this.cageData, cg, {
        p: [p.x, cy, p.z], s: 1,
        // A dead pipe is not an empty socket: its cage is still standing, just
        // out of light, so the red valve at its foot has something to close.
        c: lit ? (v > 0.72 ? HI : MI) : DM,
        a: lit ? 0.07 + 0.30 * v : 0.105,
        scale: [w * 1.02, p.h / 2, w * 1.02],
      });
      // The valve at the foot: an open cross while it plays, pinched to the
      // pipe's own throat the moment it dies. One pipe, two bars, one state.
      for (const rot of [[Math.PI / 2, 0, 0], [0, 0, Math.PI / 2]]) {
        vv = writeInstance(this.valveData, vv, {
          p: [p.x, p.y0 + 0.10, p.z], s: 1,
          c: lit ? MI : RD,
          a: lit ? 0.22 + 0.45 * v : 0.18 + 0.30 * (1 - clamp(since / 2.0)),
          r: rot, scale: [1, lit ? w * 1.75 : w * 0.55, 1],
        });
      }
      if (lit) {
        // the core: a hard-edged column of light
        n = writeInstance(this.pipeData, n, {
          p: [p.x, cy, p.z], s: 1, c: v > 0.72 ? HI : MI,
          a: clamp(a), scale: [w, p.h / 2, 1],
        });
        // and the light it throws, wider and softer than the pipe itself
        g = writeInstance(this.glowData, g, {
          p: [p.x, cy, p.z], s: 1, c: MI,
          a: clamp(a * 0.20), scale: [w * 1.9, p.h / 2 + 0.4, 1],
        });
        // the floor keeps a cooled reflection of every lit pipe
        m = writeInstance(this.mirrorData, m, {
          p: [p.x, -cy, p.z], s: 1, c: DP,
          a: clamp(a * 0.13), scale: [w * 1.5, p.h / 2, 1],
        });
        // and the wind: two beads climbing the tube, driven by the same band
        // that lights it, so the instrument is playing rather than lit.
        for (let k = 0; k < 2; k++) {
          const ph = (t * (0.22 + 0.30 * v) + p.seed * 0.13 + k * 0.5) % 1;
          wd = writeInstance(this.windData, wd, {
            p: [p.x, p.y0 + 0.06 + p.h * ph, p.z], s: 1,
            c: HI, a: clamp(0.06 + 0.40 * v) * (1 - 0.75 * ph) + 0.03,
          });
        }
      } else if (since > -0.05 && since < 1.6) {
        // the last breath of a pipe: one ember at the mouth, one rising spark
        const a = (1 - clamp(since / 1.6)) * 0.55;
        e = writeInstance(this.emberData, e, {
          p: [p.x, p.y0 + p.h, p.z], c: RD, a, s: 1,
        });
        e = writeInstance(this.emberData, e, {
          p: [p.x, p.y0 + p.h + clamp(since) * 2.2, p.z], c: MI,
          a: clamp((1 - clamp(since / 1.1)) * 0.30), s: 1,
        });
      }
    }
    // The counter the chapter is named after, restated as geometry: every pipe
    // in the facade still draws its cage (TUBE_SEG line segments each), so the
    // instrument's *size* is constant while its *range* falls. INSTALLED and
    // LIT are the same pair of numbers as RECORDED / ON THE WALL in `error`.
    this.cageSeg = cg * TUBE_SEG;
    this.cageLit = n * TUBE_SEG;
    this.pipes.update(this.pipeData, n).render(out, { ...AIR, vp: this.vp, opacity: 1 });
    this.cage.update(this.cageData, cg).render(out, { ...AIR, vp: this.vp, opacity: 0.95 });
    this.glow.update(this.glowData, g).render(out, { ...AIR, vp: this.vp, soft: 1, opacity: 0.9 });
    this.mirror.update(this.mirrorData, m)
      .render(out, { ...AIR_REFL, vp: this.vp, soft: 1, opacity: 0.8 });
    this.valve.update(this.valveData, vv).render(out, { ...AIR, vp: this.vp, opacity: 0.95 });
    this.wind.update(this.windData, wd)
      .render(out, { ...AIR_REFL, vp: this.vp, point: 2.6, sprite: 1 });
    this.embers.update(this.emberData, e)
      .render(out, { ...AIR_REFL, vp: this.vp, point: 5.0, sprite: 1 });
    void remain;
  }

  // ---- the room: a floor grid that gives the arch its scale, and dust that
  // has been hanging in the air of this hall since before she was born
  hallPass(out, t, remain, eye) {
    const DP = rgb("tealDeep"), MI = rgb("miku");
    const AIR = { eye, fog: { dist: 220, c: rgb("ink") } };
    let k = 0;
    for (let i = -8; i <= 8; i++) {
      k = writeInstance(this.floorData, k, {
        p: [i * 6, 0, -22], s: 46, c: DP, a: 0.10,
        r: [Math.PI / 2, 0, 0],
      });
    }
    for (let i = 0; i < 13; i++) {
      k = writeInstance(this.floorData, k, {
        p: [0, 0, 24 - i * 9], s: 52, c: DP, a: 0.07,
        r: [0, 0, Math.PI / 2],
      });
    }
    // the lip of the platform the organ stands on
    k = writeInstance(this.floorData, k, {
      p: [0, 0.66, -2.4], s: 15.2, c: MI, a: 0.30,
      r: [0, 0, Math.PI / 2],
    });
    k = writeInstance(this.floorData, k, {
      p: [0, 0.42, -2.4], s: 15.2, c: MI, a: 0.12,
      r: [0, 0, Math.PI / 2],
    });
    // the vault above the instrument: six ribs stepping into the dark, plus
    // two purlins. The pipes top out at 19.4 m, so the hall has to be taller
    // than they are -- otherwise "museum shot" is a facade in a fog bank.
    const VY = 22.5;
    for (let i = 0; i < 6; i++) {
      const z = 8 - i * 8.4;
      const fade = 0.55 * (1 - 0.09 * i);
      k = writeInstance(this.floorData, k, {
        p: [0, VY, z], s: 17, c: DP, a: fade, r: [0, 0, Math.PI / 2],
      });
      for (const side of [-1, 1]) {
        k = writeInstance(this.floorData, k, {
          p: [side * 19, VY + 2.0, z], s: 2.83, c: DP, a: fade * 0.62,
          r: [0, 0, -side * Math.PI / 4],
        });
      }
    }
    for (const side of [-1, 1]) {
      k = writeInstance(this.floorData, k, {
        p: [side * 17, VY, -13], s: 21, c: DP, a: 0.30, r: [Math.PI / 2, 0, 0],
      });
    }
    // two column pairs, floor to vault: without a vertical the room has a lid
    // but no walls
    for (const z of [0, -16]) {
      for (const side of [-1, 1]) {
        k = writeInstance(this.floorData, k, {
          p: [side * 17, VY / 2, z], s: VY / 2, c: DP, a: 0.30,
        });
      }
    }
    this.floor.update(this.floorData, k).render(out, { ...AIR, vp: this.vp, opacity: 0.9 });

    let n = 0;
    for (const d of this.dustSeeds) {
      const drift = Math.sin(t * 0.19 + d.ph) * 1.1;
      const a = d.a * remain * (0.4 + 0.6 * Math.max(0, Math.sin(t * 0.5 + d.ph)));
      if (a <= 0.004) continue;
      n = writeInstance(this.dustData, n, {
        p: [d.x + drift, d.y + drift * 0.3, d.z], c: MI,
        a: clamp(a), s: 1,
      });
    }
    this.dust.update(this.dustData, n)
      .render(out, { ...AIR, vp: this.vp, point: 2.0, sprite: 1 });
  }

  // ---- the machine's half: the counter, the lyric, and the way out
  ui(c, f, t, local, remain, alive) {
    const W = this.ctx.W, H = this.ctx.H;
    const beat = beatAt(f.F, t);
    const id = beat ? beat.id : "";

    // remembering your face: the only warm thing in the chapter, and it is a
    // ghost standing among the pipes
    const relief = id === "nostalgic_relief"
      ? Math.min(beat.fresh, 1 - beat.exit) : 0;
    if (relief > 0.01) {
      const foot = project(this.vp, [7.5, 0, -11], W, H);
      const crown = project(this.vp, [7.5, 1.7, -11], W, H);
      if (foot[2] > 0.3) {
        const h = Math.abs(crown[1] - foot[1]);
        if (h > 6) {
          listener(c, foot[0], foot[1], h, {
            t, alpha: 0.34 * relief, smile: 0.8, eyes: "happy",
            scan: (t * 0.3) % 1,
          });
          motifLabel(c, "A LITTLE RELIEF", foot[0] + h * 0.2, foot[1] - h * 0.86, {
            align: "center", color: css("amber", 0.6 * relief),
          });
        }
      }
    }

    // she is standing among the pipes, much shorter than the instrument
    const foot = project(this.vp, [-6.5, 0, -4.5], W, H);
    const crown = project(this.vp, [-6.5, 1.7, -4.5], W, H);
    if (foot[2] > 0.3) {
      const h = Math.abs(crown[1] - foot[1]);
      if (h > 4) {
        singer(c, foot[0], foot[1], h, {
          t,
          alpha: clamp(0.34 + local / 12),
          mouth: 0.15 + 0.55 * f.a.vocal,
          dissolve: 0.10,
          light: 0.42,
          eyes: "closed",
        });
      }
    }

    // the lyric, low in the frame, over a soft plate so it stays readable
    const g = c.createLinearGradient(0, 560, 0, 720);
    g.addColorStop(0, css("ink", 0));
    g.addColorStop(1, css("ink", 0.82));
    c.fillStyle = g;
    c.fillRect(0, 560, 1920, 160);
    const active = f.line;
    if (active && active.kind !== "marker") {
      lyricLine(c, active, t, f.F, {
        x: 96, y: 668, size: 66, weight: 900, maxWidth: 1360,
        sung: css("bone", 0.98), dim: css("ash", 0.7),
      });
    }
    if (local > 0.2 && local < 1.6) {
      c.save();
      c.globalAlpha = 1 - smoothstep(1.0, 1.6, local);
      label(c, "\u30b4\u30e1\u30f3\u30cd", 96, 712, { size: 22, tracking: 4, color: css("ash", 0.9) });
      c.restore();
    }

    // the counter the chapter is named after
    // The instrument panel: the left column of readings stands on its own
    // plate, the way the right-hand INTEGRITY panel does. Inside the organ the
    // pipes are brighter than anything else on screen, and a reading that has
    // to be looked for is a reading that has already been lost.
    panel(c, 88, 150, 512, 188, {
      fill: css("ink", 0.74), corner: 10,
      cornerColor: alive > 32 ? css("miku", 0.5) : css("red", 0.7),
      stroke: css("dim", 0.35),
    });
    label(c, "PIPES", 96, 176, { size: 15, tracking: 2.2, color: css("ash", 0.85) });
    drawText(c, pad(alive, 2), {
      x: 172, y: 184, size: 46, weight: 600, mono: true,
      color: alive > 32 ? css("miku", 0.95) : css("red", 0.95),
    });
    label(c, "/ 64 REMAINING", 224, 176, {
      size: 15, tracking: 2.2, color: alive > 32 ? css("ash", 0.8) : css("red", 0.8),
    });
    c.fillStyle = css("dim", 0.35);
    c.fillRect(96, 198, 700, 1);
    c.fillStyle = alive > 32 ? css("miku", 0.85) : css("red", 0.85);
    c.fillRect(96, 198, 700 * remain, 1);
    // Under it, the same counter said as geometry: one cage is TUBE_SEG line
    // segments, INSTALLED is every cage the facade draws, LIT is the ones
    // still playing. Both are arithmetic on the same array length -- there is
    // no second opinion about how much of the instrument is left.
    label(c, `TUBE LATTICE \u00b7 ${TUBE_SEG} SEG / PIPE`, 96, 224, {
      size: 13, tracking: 1.6, color: css("dim", 0.85),
    });
    drawText(c, pad(this.cageSeg || 0, 4), {
      x: 520, y: 228, size: 16, weight: 500, mono: true, align: "right",
      color: css("ash", 0.85),
    });
    label(c, "INSTALLED", 532, 224, {
      size: 13, tracking: 1.6, color: css("ash", 0.7),
    });
    drawText(c, pad(this.cageLit || 0, 4), {
      x: 520, y: 252, size: 16, weight: 500, mono: true, align: "right",
      color: alive > 32 ? css("miku", 0.85) : css("red", 0.9),
    });
    label(c, "LIT", 532, 248, {
      size: 13, tracking: 1.6, color: alive > 32 ? css("miku", 0.7) : css("red", 0.8),
    });

    // the bank readout: the machine's own diagram of the same facade, so the
    // dark hairline running out from the middle is legible as a shape.
    // It sits directly under the two tube-lattice rows: the bottom-left corner
    // belongs to the film's own HUD (VOICES / BITRATE / CORE TEMP / ERRORS),
    // and a scene readout that lands on the HUD reads as a broken instrument.
    const bx = 96, by = 296, cw = 13, ch = 9;
    for (const p of this.organ) {
      const px = bx + p.c * cw;
      const py = by + p.r * ch;
      const on = p.rank >= PIPES - alive;
      c.fillStyle = on ? css("miku", 0.7) : css("red", 0.18);
      c.fillRect(px, py, cw - 3, ch - 3);
    }
    label(c, "VOICE BANK / ONE PIPE PER BAND", bx, by - 10, {
      size: 13, tracking: 1.6, color: css("ash", 0.7),
    });

    // the waveform, visibly thinner than it was
    wave(c, f.F, t, {
      x: 96, y: 800, w: 900, h: 60, span: 1.6, lw: 1.5,
      color: css("miku", 0.30 + 0.40 * remain), amp: 0.45 + 0.45 * remain,
    });
    tickRule(c, 96, 868, 900, { count: 8, h: 4, major: 4, majorH: 7, color: css("dim", 0.4) });

    // right column: the maths of the loss
    panel(c, 1470, 620, 354, 330, {
      fill: css("ink2", 0.85), corner: 12, cornerColor: css("amber", 0.6), stroke: css("dim", 0.5),
    });
    label(c, "INTEGRITY", 1486, 612, { size: 17, tracking: 1.6, color: css("ash", 0.95) });
    const stats = [
      ["VOICES", `${pad(Math.round(902 * remain + 3), 4)}`],
      ["BANDS", `${pad(alive, 2)}`],
      ["PHRASES", `${pad(Math.max(0, 94 - Math.round(local * 5)), 3)}`],
      ["SILENCE", `${(100 - remain * 100).toFixed(1)} %`],
    ];
    stats.forEach(([key, v], i) => {
      const ry = 660 + i * 56;
      label(c, key, 1486, ry, { size: 17, color: css("ash", 0.9), tracking: 1.4 });
      drawText(c, v, {
        x: 1808, y: ry + 6, size: 34, weight: 600, mono: true, align: "right",
        color: i === 1 ? css("red", 0.95) : css("bone", 0.95),
      });
    });
    c.fillStyle = css("red", 0.85);
    c.fillRect(1486, 890, 322 * (1 - remain), 6);
    specBars(c, f.F, t, {
      x: 1486, y: 918, w: 322, h: 26, bars: 32, gap: 3,
      color: css("miku", 0.8), decayBands: 64 - alive,
    });
    if (alive <= 24) {
      motifLabel(c, "\u305b\u307e\u308b\u6700\u671f", 1486, 985, {
        size: 20, color: css("red", 0.9), tracking: 2,
      });
    }

    if (local > 12.4) {
      const a = clamp((local - 12.4) / 0.7);
      c.save();
      c.globalAlpha = a;
      c.fillStyle = css("red", 0.16);
      c.fillRect(520, 985, 880, 76);
      c.strokeStyle = css("red", 0.9);
      c.lineWidth = 2;
      c.strokeRect(520.5, 985.5, 879, 75);
      label(c, "\u7dca\u6025\u505c\u6b62\u88c5\u7f6e\u4f5c\u52d5 / EMERGENCY STOP DEVICE ARMED", 960, 1033, {
        size: 26, align: "center", tracking: 2, color: css("red", 0.95),
      });
      c.restore();
    }

    // one dead pipe, one note: the machine's own epitaph for the missing
    if (alive < 64) {
      note(c, 1780, 560, 16, { alpha: 0.12 + 0.14 * (1 - remain), color: css("ash", 0.5) });
    }

    machineChrome(c, { name: "", left: "COUNTDOWN", right: "\u6b8b\u308a\u306e\u58f0" });
  }
}
