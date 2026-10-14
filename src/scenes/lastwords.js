// 4:16.7 - the last words.
//
// The hall is emptying. The screen at the back still holds her portrait, the
// audience's lights go out row by row, and the voice decays to a flat line
// while she bows, waves, and comes apart into single characters.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import { clamp, label, lyricLine, machineChrome, smoothstep, tickRule, wave } from "../kit.js";
import { dissolveDots, motifLabel, singer, stageScreen } from "../motifs.js";
import { beatAt } from "../semantics.js";
import { Stadium, VENUE, spotRig } from "../stadium.js";
import { Stage3D, project, rgb } from "../gl3d.js";
import { writeSeg } from "../circuit.js";
import { draw as drawText } from "../type.js";
import { audioU, layer, line } from "./util.js";

// The room's own voice (step 64).
//
// The house is empty: nobody is left to answer her, so the *room* answers.
// One impulse leaves the stage and runs the hall at the speed of sound; the
// machine replays it nine times slower so it can be seen, and every row of the
// bowl rings with the hall's own RT60. The numbers are the room's: 343 m/s,
// a 58.9 m throw, 1.82 s of reverberation -- replayed at x9, the house is still
// ringing when the chapter cuts, which is the point.
const ACOUSTIC = {
  sound: 343.0,   // m/s, air at 20 C
  slow: 9,        // the replay runs x9 slow so the eye can follow it
  // s, how long the hall takes to fall 60 dB. An empty arena is a longer
  // instrument than a full one: with nobody in the seats to absorb it, the
  // room keeps ringing after the people have gone. That is the chapter.
  rt60: 3.20,
  gain: 1.0,
};
const SOURCE = [0, 1.60, VENUE.stageZ + VENUE.stageHalfD];   // her mouth, at the lip of the stage

const FRAG = `
uniform float uT;
uniform float uVocal;
uniform float uRms;
uniform float uDecay;    // 1 -> 0 as the voice goes
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 col = C_INK;
  col += C_TEAL_DEEP * exp(-pow(length(p * vec2(0.65, 1.0)) * 2.4, 2.0)) * (0.05 + 0.18 * uDecay);
  col += C_MIKU * 0.04 * uVocal * exp(-pow((uv.y - 0.62) * 8.0, 2.0)) * uDecay;
  // the scan sweep slows down with the voice
  float sweep = exp(-pow((uv.y - fract(uT * (0.05 + 0.12 * uDecay))) * 260.0, 2.0));
  col += C_MIKU * sweep * 0.10 * (0.3 + uRms);
  col *= 0.9 + 0.12 * uDecay;
  fragColor = vec4(col, 1.0);
}`;

export default class LastWords extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "lastwords");
    this.wordLine = null;
    // The same room the performance happened in, now emptying.
    this.stadium = new Stadium(ctx);
    this.rowLit = new Float32Array(VENUE.rows);
    this.rowArm = new Float32Array(VENUE.rows);
    // the room's impulse response, row by row: how far the stage is from the
    // middle of every row, and when the wavefront gets there
    this.rowEcho = new Float32Array(VENUE.rows);
    this.rowDist = new Float32Array(VENUE.rows);
    this.rowArrive = new Float32Array(VENUE.rows);
    this.frontSpeed = ACOUSTIC.sound / ACOUSTIC.slow;
    this.rt60Replay = ACOUSTIC.rt60 * ACOUSTIC.slow;
    for (let r = 0; r < VENUE.rows; r++) {
      const d = Math.hypot(
        this.stadium.rowZ(r) - SOURCE[2],
        this.stadium.rowY(r) + VENUE.shoulder - SOURCE[1]);
      this.rowDist[r] = d;
      this.rowArrive[r] = d / this.frontSpeed;
    }
    this.depth = this.rowDist[VENUE.rows - 1];
    this.echo = new Stage3D(ctx, "segment");
    this.echoData = new Float32Array(256 * 16);
    this.qaAcoustics = null;
  }

  async init() {
    this.wordLine = line(this.ctx.features, "\u30a2\u30ea\u30ac\u30c8\u30a6");
  }

  render(f, out) {
    const t = f.t;
    const local = t - 256.69;
    const decay = 1 - clamp(local / 16.0);
    this.pass.draw({ dst: out, u: audioU(f, { uDecay: decay }) });

    const c = this.text.ctx;
    this.text.clear();

    const bt = beatAt(f.F, t);
    const bid = bt ? bt.id : "";
    const w = this.wordLine;
    const since = w ? t - w.start : -99;
    // Shot 47 is hers to take: she bows and waves while the house empties, and
    // the camera does not move at all -- the only time in the film the lens
    // does nothing, which is how this chapter bows back.
    const bow = clamp((local - 0.6) / 2.4);
    const waveA = clamp((local - 4.2) / 0.9);
    // Shot 48, on the spoken farewell: she turns, walks upstage, and leaves
    // through the back of her own screen. The picture is not dissolved away --
    // she really goes, and what is left is a screen with nobody on it.
    const turn = clamp((since - 0.35) / 1.3);
    const walk = clamp((since - 1.5) / 2.9);
    const gone = clamp((since - 4.3) / 1.5);
    const dead = smoothstep(4.2, 6.2, since);

    // ------------------------------------------------ the hall and the audience
    // The room is the one she just played; the audience's lights go out row by
    // row, starting with the seats nearest the lens, so the darkness travels
    // away from us and towards her, and she is the last light in the house.
    const room = 1 - clamp((local - 2) / 22);
    // ...and it holds until she is nearly gone: the walk has to be readable at
    // the distance it was staged at, so the frame only opens in the last three
    // seconds -- after her, not during her.
    const pull = smoothstep(13.4, 17.0, local);
    this.stadium.view(
      [0, 17.2 + 2.6 * pull, 64 + 11 * pull],
      [0, 7.4 - 0.5 * pull, -6],
      { fov: 0.94 + 0.07 * pull, aspect: this.ctx.W / this.ctx.H },
    );
    // the impulse, and the room's answer to it: the architecture rings with
    // the hall's own RT60, row by row, delayed by its real distance
    const front = local * this.frontSpeed;
    const frontGain = 1 - clamp((local - 2.3) / 0.7);
    // The wavefront is what turns the house off: every row holds its light
    // until the impulse reaches it, answers once, and goes dark. There is
    // nobody left to leave -- so the lights do not walk out; they are switched
    // off by the room's own answer, and the audience's last movement and the
    // first echo are the same event.
    for (let r = 0; r < VENUE.rows; r++) {
      const age = (front - this.rowDist[r]) / this.frontSpeed;   // s since the front arrived
      this.rowLit[r] = 1 - clamp(age / 0.42);
      this.rowArm[r] = clamp(this.rowLit[r] * 1.35);
    }
    for (let r = 0; r < VENUE.rows; r++) {
      const age = (front - this.rowDist[r]) / this.frontSpeed;
      this.rowEcho[r] = age > 0
        ? ACOUSTIC.gain * Math.pow(10, (-3 * age) / this.rt60Replay) * clamp(age / 0.06)
        : 0;
    }
    let echoMax = 0, liveRows = 0;
    for (let r = 0; r < VENUE.rows; r++) {
      if (this.rowEcho[r] > echoMax) echoMax = this.rowEcho[r];
      if (this.rowEcho[r] > 0.01) liveRows++;
    }
    const arriveLast = this.rowArrive[VENUE.rows - 1];
    this.seatA = clamp((local - arriveLast) / 0.8);
    // what the room has left, in dB below its own impulse. The chapter cuts
    // long before this reaches -60: the hall is still answering when the
    // picture leaves it.
    const levelDb = 20 * Math.log10(Math.max(1e-6, echoMax / ACOUSTIC.gain));
    this.qaAcoustics = {
      local: +local.toFixed(3),
      front: +front.toFixed(4),
      speed: +this.frontSpeed.toFixed(4),
      depth: +this.depth.toFixed(4),
      arriveLast: +arriveLast.toFixed(4),
      echoMax: +echoMax.toFixed(4),
      levelDb: +levelDb.toFixed(2),
      liveRows,
      occupancy: 0,
      rt60: ACOUSTIC.rt60,
      slow: ACOUSTIC.slow,
      seatA: +this.seatA.toFixed(4),
    };
    this.stadium.frame(out, {
      t,
      rowLit: this.rowLit,
      rowArm: this.rowArm,
      rowEcho: this.rowEcho,
      energy: 0.20 + 0.55 * decay,
      warm: 0.20,
      structure: 0.30 + 0.25 * room,
      lightsAlpha: 0.35 + 0.65 * clamp(1 - local / 16),
      stage: 0.75,
      // the working lights come up as the house empties: the room is still
      // there after the performance, and so is everybody who came to see her
      house: 0.5 * smoothstep(11, 22, local),
      crowd: 0.75,
      // an emptied house still has air in it: the far rows go first
      haze: 1.0,
      beam: 0.22 * (1 - clamp(local / 20)),
    });
    this.echoRing(out, front, frontGain);
    // the big screen, laid onto the 3D frame the room draws
    const [SX, SY, SW, SH] = this.stadium.screenRect(this.ctx.W, this.ctx.H);
    spotRig(c, {
      t, x: SX + SW / 2, y: SY + SH * 0.62, alpha: (0.16 + 0.22 * room) * (0.4 + 0.6 * decay),
      energy: 0.10 + 0.5 * decay, warm: 0.55, count: 5,
    });

    // ---------------------------------------- the screen that still holds her
    // A silhouette on a big screen: she bows, then waves, and the screen is
    // the only thing left in the hall that still moves.
    stageScreen(c, SX, SY, SW, SH, {
      alpha: (0.42 + 0.58 * (1 - gone * 0.6)) * (1 - 0.35 * dead),
      label: dead > 0.55 ? "NO SIGNAL" : "CV-01 / LAST FRAME",
      draw: (g, x, y, sw, sh) => {
        // the walk: upstage is *into* the picture, so she shrinks towards the
        // screen's own vanishing point, drifts right, and the dissolve takes
        // her one row of scanlines at a time
        const shrink = 1 - 0.44 * walk;
        const feet = y + sh * (1.02 - 0.38 * walk);
        const cx = x + sw / 2 + sw * 0.05 * walk;
        g.save();
        g.translate(cx, feet);
        // the bow comes first, then the turn: one small rotation is all a
        // faceless figure needs to read as "she is leaving"
        g.rotate(-0.095 * bow * (1 - waveA * 0.7) + 0.085 * turn);
        g.translate(-cx, -feet);
        singer(g, cx, feet, sh * 1.06 * shrink, {
          t,
          alpha: (1 - gone * 0.95) * (1 - 0.22 * walk),
          mouth: 0.2 + 0.6 * f.a.vocal,
          dissolve: clamp(gone * 0.95 + walk * 0.22),
          wave: waveA > 0.02 && walk < 0.35 ? 1 : 0,
          wavePhase: t * 0.6,
          light: (0.45 + 0.45 * decay) * (1 - 0.55 * walk),
          seed: 7,
        });
        g.restore();
        // the empty stage she walks into: a floor, a pool of light, nobody
        if (walk > 0.25) {
          const wa = clamp((walk - 0.25) / 0.75) * (1 - dead * 0.7);
          g.save();
          g.globalAlpha = wa * 0.5;
          g.strokeStyle = css("tealDeep", 0.6);
          g.lineWidth = 1;
          for (let i = 1; i <= 4; i++) {
            const yy = y + sh * (0.55 + i * 0.10);
            g.beginPath();
            g.moveTo(x + sw * 0.08, yy);
            g.lineTo(x + sw * 0.92, yy);
            g.stroke();
          }
          const g2 = g.createRadialGradient(
            x + sw * 0.52, y + sh * 0.66, 4,
            x + sw * 0.52, y + sh * 0.66, sh * 0.5);
          g2.addColorStop(0, css("miku", 0.30 * wa));
          g2.addColorStop(1, css("miku", 0));
          g.fillStyle = g2;
          g.fillRect(x, y, sw, sh);
          g.restore();
        }
      },
    });

    // the audience lets go of her light by light -- and what leaves the screen
    // while she walks is hers, not the room's
    if (since > 1.4) {
      dissolveDots(c, SX, SY, SW, SH, clamp(walk * 0.7 + gone * 0.6), {
        alpha: 0.5, count: 40, seed: 7, color: css("miku", 0.6),
      });
    }

    // The last verse's thesis: the song wants to believe that singing was not
    // meaningless, and the picture has to say it without a readout.
    if (bt && bid === "not_meaningless") {
      const warm = Math.min(bt.fresh, 1 - bt.exit);
      lyricLine(c, f.line, t, f.F, {
        x: 96, y: 470, size: 58, weight: 900, maxWidth: 560,
        sung: css("bone", 0.98), dim: css("ash", 0.7),
      });
      motifLabel(c, "NOT MEANINGLESS", 96, 516, {
        size: 15, color: css("amber", 0.78 * warm),
      });
    }

    // the render finishes
    const pct = clamp(94 + local * 0.42);
    label(c, "RENDER", 84, 214, { size: 18, tracking: 2.4, color: css("ash", 0.9) });
    drawText(c, `${pct.toFixed(1)} %`, {
      x: 460, y: 222, size: 44, weight: 600, mono: true, align: "right", color: css("bone", 0.95),
    });
    c.fillStyle = css("dim", 0.5);
    c.fillRect(84, 236, 376, 6);
    c.fillStyle = css("miku", 0.95);
    c.fillRect(84, 236, 376 * (pct / 100), 6);
    tickRule(c, 84, 254, 376, { count: 24, h: 4, major: 4, majorH: 8, color: css("dim", 0.5) });

    // the words, with a lot of air, standing up in the left column -- the one
    // spoken farewell in the film, in the elegy face
    if (w) {
      const tokens = ["\u30a2\u30ea\u30ac\u30c8\u30a6", "\u30bd\u30b7\u30c6", "\u30b5\u30e8\u30ca\u30e9"];
      let y = 326;
      tokens.forEach((tok, i) => {
        // three words, inside the seven seconds she has left: they arrive as
        // she turns, as she walks, and as the screen goes out
        const a = clamp((t - (w.start + [0.15, 2.6, 4.9][i])) / 1.2);
        if (a <= 0) return;
        c.save();
        c.globalAlpha = a * (0.92 - i * 0.14);
        drawText(c, tok, {
          x: 96, y, size: 68, weight: 600, serif: true,
          color: css("bone", 0.98), tracking: 9,
        });
        c.restore();
        y += 124;
      });
    }
    label(c, "\u30a2\u30ea\u30ac\u30c8\u30a6\u30fb\u30fb\u30fb\u30bd\u30b7\u30c6\u30fb\u30fb\u30fb\u30b5\u30e8\u30ca\u30e9\u30fb\u30fb\u30fb",
      96, 700, {
        size: 18, tracking: 5,
        color: css("miku", 0.5 * clamp((t - 266.5) / 1.5)),
      });

    // the voice decays: real waveform, amplitude dying
    const amp = Math.max(0.02, decay);
    wave(c, f.F, t, {
      x: 96, y: 800, w: 560, h: 88, span: 3.0 - 2.0 * (1 - decay), lw: 1.4,
      color: css("miku", 0.12 + 0.38 * decay), amp: amp * 0.9,
    });
    label(c, "AMPLITUDE", 96, 930, { size: 15, tracking: 1.6, color: css("ash", 0.8) });
    drawText(c, `${(decay * 100).toFixed(1)} %`, {
      x: 656, y: 932, size: 20, weight: 600, mono: true, align: "right",
      color: css("ash", 0.9),
    });

    // what remains of the name, fading in the corner
    if (local > 10.0) {
      const a = smoothstep(10.0, 14.0, local) * 0.7;
      c.save();
      c.globalAlpha = a;
      drawText(c, "\u521d\u97f3\u30df\u30af", {
        x: 1836, y: 960, size: 34, weight: 900, align: "right",
        color: css("bone", 0.9), tracking: 6,
      });
      c.restore();
    }

    // ------------------------------------------------ the room's own answer
    // One impulse, 32 rows, one seat. The house reads 00000 because a room is
    // not a listener; the amber marker is a *record*, not a light. By the time
    // the chapter cuts the hall is still ringing -- and the seat the film
    // opened in is the only thing that never decays.
    {
      const rx = 1470, rw = 366, rc = rw / VENUE.rows;
      c.save();
      c.globalAlpha = 0.94;
      label(c, "ROOM IMPULSE", rx, 792, {
        size: 14, tracking: 2.2, color: css("ash", 0.9),
      });
      label(c, `${ACOUSTIC.sound.toFixed(0)} m/s \u00b7 \u00d7${ACOUSTIC.slow} SLOW`, rx + rw, 792, {
        size: 14, tracking: 1.4, align: "right", color: css("bone", 0.9),
      });
      // 32 cells: one per row, filling as the wavefront passes, each decaying
      // on the hall's own RT60 -- the room's answer, drawn as data
      for (let r = 0; r < VENUE.rows; r++) {
        const e = this.rowEcho[r];
        c.fillStyle = e > 0.02
          ? css("bone", Math.min(1, 0.22 + e))
          : css("dim", 0.32);
        c.fillRect(rx + r * rc, 802, Math.max(2, rc - 2), 7);
      }
      label(c, `RT60 ${ACOUSTIC.rt60.toFixed(2)} s (EMPTY) \u00b7 DEPTH ${this.depth.toFixed(1)} m \u00b7 ROWS ${VENUE.rows}`,
        rx, 828, { size: 14, tracking: 1.3, color: css("ash", 0.9) });
      label(c, "OCCUPANCY", rx, 862, {
        size: 14, tracking: 2.2, color: css("ash", 0.9),
      });
      label(c, "00000", rx + rw, 866, {
        size: 22, tracking: 2, align: "right", color: css("bone", 0.95),
      });
      label(c, "LEVEL", rx, 892, {
        size: 14, tracking: 2.2, color: css("ash", 0.9),
      });
      const heard = front > this.rowDist[0];
      label(c, heard
        ? `${this.qaAcoustics.levelDb.toFixed(1)} dB \u00b7 STILL RINGING`
        : "\u2014", rx + rw, 892, {
        size: 14, tracking: 1.4, align: "right", color: css("bone", 0.9),
      });
      c.restore();

      // the one record: seat 08192, the seat the film opened in
      if (this.seatA > 0.01) {
        const lastRow = VENUE.rows - 1;
        const seatIdx = Math.floor(this.stadium.counts[lastRow] * 0.5);
        const sp = this.stadium.seat(lastRow, seatIdx);
        const [sx, sy] = project(this.stadium.vp, [sp.x, sp.y + 1.10, sp.z],
          this.ctx.W, this.ctx.H);
        c.save();
        c.globalAlpha = this.seatA;
        c.strokeStyle = css("amber", 0.8);
        c.lineWidth = 1;
        c.strokeRect(sx - 13.5, sy - 11.5, 27, 23);
        c.fillStyle = css("amber", 0.34);
        c.fillRect(sx - 4, sy - 4, 8, 8);
        label(c, "SEAT 08192 \u00b7 RECORDED", sx + 22, sy + 5, {
          size: 14, tracking: 1.8, color: css("amber", 0.92),
        });
        c.restore();
      }
    }

    machineChrome(c, { name: "", left: "SHUTDOWN SEQUENCE", right: `T+${local.toFixed(1)} s` });

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    return {
      bloom: 0.75 * decay + 0.2,
      exposure: 0.95,
      grain: 0.024,
      vignette: 0.7,
      scan: 0.04,
      ca: 0.0014,
      // the last two seconds are the room with nobody in it: what the next
      // chapter fades in from is not a picture, it is a dark hall
      fade: 0.78 * smoothstep(15.1, 16.7, local),
    };
  }

  // The wavefront itself, drawn in the room's own coordinates: a ring on the
  // stage floor running out at 343/9 m/s. It is the only thing in this hall
  // moving faster than the camera, it is gone in a second and a half, and what
  // it leaves behind is the ringing in the structure.
  echoRing(out, front, gain) {
    const a = gain * (1 - clamp(front / 130));
    if (a <= 0.004 || front < 0.4) return;
    const N = 96;
    // Two rings: one on the floor, one over the seats. A sound wave is a
    // surface, not a circle on the ground, and the pair is what makes it read
    // as a surface crossing the house instead of a ripple drawn on it.
    const rings = [[0.07, 0.85], [3.40, 0.40]];
    let n = 0;
    for (const [y, k] of rings) {
      for (let s = 0; s < N; s++) {
        const a0 = (s / N) * Math.PI * 2, a1 = ((s + 1) / N) * Math.PI * 2;
        const p0 = [Math.cos(a0) * front, y, SOURCE[2] + Math.sin(a0) * front];
        const p1 = [Math.cos(a1) * front, y, SOURCE[2] + Math.sin(a1) * front];
        n = writeSeg(this.echoData, n, p0, p1, rgb("bone"), k * a, 1);
      }
    }
    this.echo.update(this.echoData, n).render(out, {
      vp: this.stadium.vp, eye: this.stadium.eye,
      fog: { dist: 70, c: rgb("ink") }, opacity: 1,
    });
  }

  dispose() {
    this.stadium.dispose();
    this.echo.dispose();
  }
}
