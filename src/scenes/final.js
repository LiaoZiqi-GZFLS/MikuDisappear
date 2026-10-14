// 3:45.7 - the final verse. Everything the film has shown runs again, faster,
// until the picture is reduced to 0 and 1 and then to a name.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import {
  binaryField, clamp, label, lyricLine, machineChrome, panel, smoothstep,
  specBars, typeWall, wave,
} from "../kit.js";
import {
  displaySleep, dissolveDots, emptySeats, futureLight, heart,
  infinityLoop, leek, listener, motifLabel, note, recycleBin,
  ruinFrame, singer, skyTears, toyKey,
} from "../motifs.js";
import { beatAt } from "../semantics.js";
import { Stage3D, camera, mat4, project, rgb, samplePoints, writeInstance } from "../gl3d.js";
import { Stadium, VENUE, spotRig } from "../stadium.js";
import { draw as drawText, pad } from "../type.js";
import { audioU, layer, line } from "./util.js";

const hash1 = (n) => {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
};

// ---- the voice line (step 67) -------------------------------------------
// The house cannot hold a picture: 32 rows of seats are 32 rows of raster, and
// a face at that resolution is a blob (measured: rho 0.49-0.71, and a 20 cm
// step to the side shears the near rows by 1.4-3.3 cells). What it *can* hold
// is one line -- her voice, the one thing the film has drawn since 0:00.
//
// The house is written, not switched on. HEAD-01 -- the same head that printed
// her at 0:26, at the same 1.70 s and in the same left-to-right direction --
// is replayed at the scale of the bowl, and one hand per column is asked to
// raise its light to the row the song is singing right now. From the one eye
// the walk-around ends on, those 256 hands are her waveform; a hand's width to
// the side, the same arms are a crowd. Nothing here is painted on: the arms
// carry it, one light per column, and every other light in the house goes
// quiet behind the pen.
const LINE_COLS = 256;        // columns of the trace: two hands per column
const LINE_SWEEP = 1.70;      // HEAD-01's print time, left to right
const LINE_EYE_FOV = 1.14;    // the one eye
const LINE_CENTER = 0.27;     // where the ridge sits when the voice is mid
// The contour has to out-run the band it is written with. v14 measured the
// first pass: at 0.075 pitch and 0.028 half-thickness the ridge's +-40 px of
// swing were buried inside a ~70 px bar of light, so the finished image read
// as a lamp, not as a voice. The pitch swing is now 0.12 (+-65 px) and the
// band is less than half as thick: loudness still opens the two hands apart,
// but the line they hold is a contour again.
const LINE_PITCH = 0.12;      // how much of the frame the ridge sweeps
const LINE_THICK = 0.012;     // half-thickness at full voice
const LINE_MIN_THICK = 0.0025;
const LINE_B0 = 18;           // 45 Hz..11 kHz, log spaced: these 29 bands are
const LINE_B1 = 46;           // where a voice lives (245 Hz .. 2.3 kHz)
const LINE_TOL = 5;           // px: an arm this close to the row wins its column
const LINE_JUMP = 10;         // px of error charged per metre of arm change
const LINE_REACH = 2;         // columns a hand may reach across (the aisles)
const LINE_DY0 = -0.35;       // arm down, metres below the held position
const LINE_DY1 = 1.00;        // arm up
const LINE_FLOOR = 0.04;      // how much of the written house stays lit
const LINE_SECOND = 0.34;     // the runner-up hand in the same column
const LINE_HOLD_BEAT = 0.50;  // two beats of 240 BPM with the line finished
// After the reduction begins, the trace stays put while the points leave her
// body and land on it; then it lets go with the curtain.
const LINE_HOLD = 1.35;
const LINE_FADE = 2.90;

const FRAG = `
uniform float uT;
uniform float uVocal;
uniform float uLow;
uniform float uHigh;
uniform float uKick;
uniform float uSpeed;    // 0 -> 1 as the verse accelerates
uniform float uBinary;   // the reduction to 0 and 1
uniform float uName;     // only the name is left
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec3 col = C_INK;

  // streaks: the song running past the frame
  float lane = floor(uv.x * 90.0);
  float sp = 0.6 + uSpeed * 5.0;
  float s = hash21(vec2(lane, floor((uv.y + uT * sp) * 6.0)));
  float streak = step(0.86 - uSpeed * 0.25, s) * smoothstep(0.5, 0.0, abs(fract(uv.x * 90.0) - 0.5));
  col += C_TEAL_DEEP * streak * (0.14 + 0.5 * uHigh);

  // The reduction does not mosaic the room: it quantises the picture onto a
  // fine grid and lets single bits appear where the frame is dark, so the
  // audience and her body stay readable while the signal becomes language.
  vec2 cell = floor(uv * vec2(256.0, 144.0));
  float bit = step(0.88, hash21(cell + floor(uT * 2.0)));
  float land = 1.0 - smoothstep(0.015, 0.11, dot(col, vec3(0.34)));
  col += C_MIKU * bit * land * uBinary * 0.045;
  col = mix(col, floor(col * 12.0 + 0.5) / 12.0, uBinary * 0.18);

  // and then only the name is left: a teal core in the dark
  float core = exp(-pow(length((uv - 0.5) * vec2(2.2, 1.3)) * 3.4, 2.0));
  col = mix(col, C_TEAL_DEEP * core * (0.8 + 0.6 * uVocal), uName);

  col += C_MIKU * 0.10 * uLow * exp(-pow((uv.y - 0.03) * 8.0, 2.0)) * (1.0 - uName);
  col += C_MIKU_HI * 0.10 * uKick * exp(-pow((uv.y - 0.5) * 24.0, 2.0)) * (1.0 - uName) * (1.0 - uBinary);
  fragColor = vec4(col, 1.0);
}`;

// Replay one earlier motif inside the final verse's recall window.
function recallMotif(c, id, bt, t) {
  const a = bt ? Math.min(bt.fresh, 1 - bt.exit) : 0;
  if (a <= 0.005) return;
  c.save();
  c.beginPath();
  c.rect(1048, 108, 464, 304);
  c.clip();
  c.translate(1280, 330);
  c.globalAlpha = a;
  switch (id) {
    case "birth":
      singer(c, 0, 92, 220, { t, alpha: 0.75, dissolve: 1 - bt.fresh, eyes: "closed" });
      break;
    case "imitation":
    case "not_original":
    case "never_equal":
      listener(c, -70, 92, 180, {
        t, alpha: 0.45, eyes: "closed", sadMouth: true,
      });
      singer(c, 35, 92, 180, {
        t, alpha: 0.55, color: css("ash", 0.75), eyes: "closed", dissolve: 0.25,
      });
      motifLabel(c, "ORIGINAL / COPY", -100, -90, { color: css("ash", 0.7) });
      break;
    case "persist":
      singer(c, 0, 92, 200, { t, alpha: 0.65, mouth: 0.85, heart: 1 });
      note(c, 84, -30, 20, { alpha: 0.7 });
      break;
    case "eternity":
      infinityLoop(c, 0, 12, 250, { alpha: 0.75, phase: t * 0.3 });
      break;
    case "copy_song":
    case "toy":
      toyKey(c, 0, 30, 36, { alpha: 0.75, spin: t * 2.1 });
      break;
    case "resolve":
    case "sang_it_all":
      singer(c, 0, 94, 210, {
        t, alpha: 0.85, eyes: "happy", smile: 1, heart: 1, mouth: 0.15,
      });
      break;
    case "leek_sky_tear":
      skyTears(c, -120, -105, 240, 135, { alpha: 0.8, tear: bt.phase });
      leek(c, -90, 36, 66, { alpha: 0.85, rot: -0.4, bite: 0.35 });
      break;
    case "announce_end":
      heart(c, 0, 10, 58, { alpha: 0.75, fill: Math.max(0, 1 - bt.fresh), erode: bt.fresh });
      break;
    case "sleep_display":
      displaySleep(c, -100, -16, 200, 84, { alpha: 0.8, close: bt.phase, phase: t * 0.4 });
      break;
    case "recycle_bin":
      recycleBin(c, 55, 62, 72, { alpha: 0.8, drop: bt.phase, label: "TRASH" });
      break;
    case "memory_vanish":
    case "vanish_void":
      dissolveDots(c, -110, -80, 220, 180, bt.fresh, {
        alpha: 0.7, count: 28, seed: 4, color: css("miku", 0.6),
      });
      break;
    case "remember_you":
    case "happy_time":
      listener(c, -20, 82, 175, {
        t, alpha: 0.85, smile: 1, eyes: "happy", scan: (t * 0.4) % 1,
      });
      note(c, 82, -36, 16, { alpha: 0.55 });
      motifLabel(c, "REMEMBERED", -100, -94, { color: css("amber", 0.75) });
      break;
    case "leek_taste":
      leek(c, 0, 52, 72, { alpha: 0.9, rot: 0.25, bite: 0.4 });
      break;
    case "leek_fade":
      leek(c, 0, 52, 72, {
        alpha: 0.5 * (1 - bt.fresh), rot: 0.25, bite: 0.4, label: false,
      });
      break;
    case "want_more":
      note(c, -20, 6, 26, { alpha: 0.8 });
      note(c, 60, -28, 18, { alpha: 0.5 });
      motifLabel(c, "STILL / SING", -100, -90, { color: css("miku", 0.75) });
      break;
    case "final_goodbye":
      singer(c, 0, 92, 220, {
        t, alpha: 0.8, eyes: "happy", smile: 0.8, wave: 1, wavePhase: t * 0.6,
      });
      break;
    case "nothing_left":
      c.setLineDash([6, 6]);
      c.strokeStyle = css("dim", 0.7);
      c.lineWidth = 1;
      c.strokeRect(-110, -70, 220, 150);
      c.setLineDash([]);
      motifLabel(c, "NOTHING TO LEAVE", -100, -86, { color: css("ash", 0.7) });
      break;
    case "regret":
      label(c, "?", 0, 30, { size: 54, align: "center", color: css("amber", 0.8) });
      break;
    case "voice_memory":
      c.strokeStyle = css("miku", 0.6);
      c.lineWidth = 1.4;
      c.beginPath();
      for (let i = 0; i <= 70; i++) {
        const u = i / 70;
        const x = -110 + u * 220;
        const y = 10 + Math.sin(u * 28 - t * 2) * 14 * (1 - bt.fresh);
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
      break;
    case "protected":
    case "future_illusion":
      futureLight(c, -105, -60, 210, 105, { alpha: 0.8, fade: 1 - bt.fresh });
      break;
    case "compress_message":
      for (let i = 0; i < 7; i++) {
        note(c, -95 + i * 32, 22, 13, {
          alpha: i / 7 < 1 - bt.fresh ? 0.7 : 0.12,
          color: i / 7 < 1 - bt.fresh ? css("miku", 0.7) : css("dim", 0.5),
        });
      }
      break;
    case "not_meaningless":
      singer(c, 0, 94, 220, {
        t, alpha: 0.95, eyes: "happy", smile: 1, heart: 1, mouth: 0.2,
      });
      break;
    case "name":
      motifLabel(c, "NAME", -100, -90, { color: css("bone", 0.8) });
      break;
    case "binary":
    case "curtain":
      // the full-frame treatment already carries these two beats
      break;
    default:
      heart(c, 0, 8, 54, { alpha: 0.55, fill: 0.6, erode: 0.4 });
      break;
  }
  c.restore();
}

export default class Final extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "final");
    this.last = null;
    this.binaryLine = null;
    this.nameLine = null;
    this.curtainLine = null;
    this.singLine = null;

    // The point cloud: her silhouette is sampled once into a few hundred
    // points, and in the finale those points are what rises off the stage and
    // becomes the audience's lights.
    this.cloud = new Stage3D(ctx, "point");
    this.cloudPts = [];
    this.cloudData = null;

    // The room. She stands a little left of its axis, in front of the screen.
    this.stadium = new Stadium(ctx);
    this.rowLit = new Float32Array(VENUE.rows);
    this.rowArm = new Float32Array(VENUE.rows);
    this.her = { x: -1.6, y: 1.15, z: -5.4, h: 6.2, w: 2.1 };

    // The walk-around ends on one exact eye: radius 10.6 - 1.9, 1.5 m above
    // her head, half a circle from where the shot started. The trace is solved
    // in the image plane of *that* eye -- a hand's width to the side and the
    // same arms are only a crowd again.
    this.lineVp = mat4();
    this.lineEye = [this.her.x, 8.4, this.her.z - 8.7];
    this.lineAt = [this.her.x, 4.80, this.her.z + 0.30];
    this.lineSeats = [];
    this.lineCand = null;      // one candidate list per column, crisp arms first
    this.lineBarZ = 0;         // the depth the writing head stands at
    this.lineU = [0, 1];       // the span of the house in the picture
    this.lineGain = null;
    this.lineRim = null;
    this.lineLift = null;
    this.lineOn = new Uint8Array(1);
    this.lineQuiet = new Float32Array(1);
    this.lineUsed = new Uint8Array(1);
    this.lineWrite = new Float32Array(LINE_COLS);
    this.lineHi = new Float32Array(LINE_COLS);   // the loudest point of each instant
    this.lineLo = new Float32Array(LINE_COLS);   // and the quietest
    this.lineRidge = new Float32Array(LINE_COLS);  // the voice's own pitch contour
    this.lineRidgeS = new Float32Array(LINE_COLS);
    this.lineLoud = new Float32Array(LINE_COLS);
    this.lineSpec = new Float32Array(LINE_COLS * 64);
    this.lineSpan = 21.64;     // seconds of voice on the house (set in init)
    this.lineT0 = 225.69;
    this.lineCols = new Uint8Array(LINE_COLS);
    this.lineStats = null;
    this.linePens = [];
    this.qaVoice = null;
  }

  async init() {
    const F = this.ctx.features;
    // "ボクは 歌う": the line the camera finally walks around her on.
    this.singLine = line(F, "ボクは 歌う");
    this.last = line(F, "\u7121\u99c4\u3058\u3083\u306a\u3044");
    this.binaryLine = line(F, "0\u30681\u306b\u9084\u5143");
    this.nameLine = line(F, "\u540d\u3060\u3051\u6b8b\u308b");
    this.curtainLine = line(F, "\u5e55\u3092\u9589\u3058\u308b");
    // The house is written with the whole chapter's song: from the first frame
    // of `final` to the reduction at "0 と 1 に還元され" -- 21.6 s of voice,
    // reprinted across 256 columns in 1.70 s.
    this.lineT0 = 225.69;
    this.lineSpan = Math.max(4, (this.binaryLine ? this.binaryLine.start : 247.33) - this.lineT0);
    const body = (c, w, h) => singer(c, w / 2, h * 0.985, h * 1.02, {
      alpha: 1, color: "#ffffff", accent: "#ffffff", deep: "#9a9a9a", lw: 1.4,
      glow: false,
    });
    // The cloud the finale flies: the lines that carry her.
    this.cloudPts = samplePoints(body, { w: 132, h: 236, max: 1500, cut: 0.16 });
    this.cloudData = new Float32Array(this.cloudPts.length * 16);
    this.buildVoiceLine();
  }

  // ---- the one eye, solved once ------------------------------------------
  // Everything here happens at boot: which lights the eye can see, where each
  // of them lands, and how many pixels of image it buys per metre of arm.
  // Per frame the scene only evaluates the waveform and moves the arms.
  buildVoiceLine() {
    const S = this.stadium, W = this.ctx.W, H = this.ctx.H;
    camera(this.lineVp, {
      eye: this.lineEye, at: this.lineAt, fov: LINE_EYE_FOV,
      near: 0.5, far: 900, aspect: W / H,
    });
    // the same camera, stepped aside: the proof that the line belongs to one
    // point in the room
    this.lineVpOff = [0.50, 1.0, 5.0].map((dx) => {
      const vp = mat4();
      camera(vp, {
        eye: [this.lineEye[0] + dx, this.lineEye[1], this.lineEye[2]],
        at: this.lineAt, fov: LINE_EYE_FOV, near: 0.5, far: 900, aspect: W / H,
      });
      return vp;
    });
    this.lineGain = new Float32Array(S.total);
    this.lineRim = new Float32Array(S.total);
    this.lineLift = new Float32Array(S.total);
    this.lineOn = new Uint8Array(S.total);
    this.lineQuiet = new Float32Array(S.total);
    this.lineUsed = new Uint8Array(S.total);
    this.lineSeats = [];
    this.lineCand = Array.from({ length: LINE_COLS }, () => []);
    const vOf = (x, y, z) => project(this.lineVp, [x, y, z], W, H);
    let uMin = Infinity, uMax = -Infinity;
    for (let r = 0; r < S.rows; r++) {
      for (let i = 0; i < S.counts[r]; i++) {
        const k = S.start[r] + i;
        if (S.aisle[k]) continue;
        const q = S.seat(r, i);
        // the hand's *held* position: the same point `stadium.lightPass`
        // draws when the house is asked to be still (see the stillness note
        // there) -- solve and picture must be one geometry, not two
        const x = q.x + q.side * 0.15, z = q.z;
        const y0 = q.y + VENUE.shoulder + 0.22;
        const p = vOf(x, y0, z);
        if (!(p[2] > 0.2)) continue;
        const u = p[0] / W;
        if (u < -0.01 || u > 1.01) continue;
        const v0 = p[1] / H;
        // The arm's two endpoints, measured in the picture instead of
        // approximated by a slope: `vUp` with the hand a metre above the held
        // position, `vDown` with it 0.35 m below. Between those two the
        // projection is near enough to linear that the solve can invert it
        // exactly -- which is why the solved hand lands on the row it was
        // solved for, and the readout can be trusted to a pixel.
        const vUp = vOf(x, y0 + LINE_DY1, z)[1] / H;
        const vDown = vOf(x, y0 + LINE_DY0, z)[1] / H;
        if (!(vUp < v0 - 1e-6 && vDown > v0 + 1e-6)) continue;
        // ...and the same two endpoints in x: the lens is pitched down a
        // little, so a raised hand also slides sideways in the picture. The
        // solve has to satisfy both, or the hand lands on its own row and in
        // the wrong column -- which is exactly the error the readout reports.
        const uUp = vOf(x, y0 + LINE_DY1, z)[0] / W;
        const uDown = vOf(x, y0 + LINE_DY0, z)[0] / W;
        const dvdy = (vUp - v0) / LINE_DY1;
        if (u < uMin) uMin = u;
        if (u > uMax) uMax = u;
        this.lineSeats.push({ k, x, z, y0, u, uUp, uDown, v0, vUp, vDown, dvdy, col: 0 });
      }
    }
    // A column is a column of the picture, not a metre of the room: it is cut
    // in screen u as seen from the one eye, over the span the house actually
    // occupies -- all 256 columns have hands in them. The writing head stands
    // in the bowl and is placed by inverting this same projection (see
    // `barX`), so the light the bar draws and the lights it quiets are one and
    // the same column of the frame.
    const uSpan = Math.max(1e-3, uMax - uMin);
    this.lineU = [uMin, uMax];
    for (const s of this.lineSeats) {
      const c = Math.round(((s.u - uMin) / uSpan) * (LINE_COLS - 1));
      s.col = c < 0 ? 0 : c > LINE_COLS - 1 ? LINE_COLS - 1 : c;
    }
    this.lineBarZ = (S.rowZ(0) + S.rowZ(S.rows - 1)) / 2;
    // the two ends of the writing stroke, in world metres
    this.lineBarX = [this.barX(uMin), this.barX(uMax)];
    // A hand can be reached for by its own column and by the two columns on
    // either side of it: the house has five aisles cut through it, and a column
    // of the picture that lands in an aisle still has to be able to hold its
    // row, so the neighbour leans across. Inside a column, crisp arms first:
    // |dvdy| is how many pixels of image one metre of arm buys, so the near
    // rows -- the ones a jury can see raise a light -- are tried before the
    // far ones.
    for (const s of this.lineSeats) {
      for (let d = -LINE_REACH; d <= LINE_REACH; d++) {
        const c = s.col + d;
        if (c < 0 || c > LINE_COLS - 1) continue;
        this.lineCand[c].push({ s, d: Math.abs(d) });
      }
    }
    for (const list of this.lineCand) {
      list.sort((a, b) => a.d - b.d || a.s.dvdy - b.s.dvdy);
    }
  }

  // The two rows the trace wants at this column of the frame: the loudest point
  // of her voice at this column of the picture, and the quieter one.
  //
  // What is written on the house is the whole chapter's song, not one instant
  // of it: 21.6 s of her voice, reprinted across 256 columns in 1.70 s. The
  // centre of each column is the ridge of the real spectrum -- the strongest
  // band between 245 Hz and 2.3 kHz, out of the 64 log bands the analysis
  // stores -- and the distance between the two hands is her loudness at that
  // instant. The raw waveform cannot be used here and this was measured, not
  // assumed: 1.70 s across 256 columns is 150 samples a second of a signal
  // that moves hundreds of times a second, and neighbouring columns jumped
  // 30-60 px -- noise, not a line. The ridge is the same audio, and it is the
  // shape a room can hold.
  traceAt(F) {
    const spec = F.specSlice(this.lineT0, this.lineT0 + this.lineSpan, LINE_COLS, 64, this.lineSpec);
    const ridge = this.lineRidge, loud = this.lineLoud;
    let peak = 0;
    for (let i = 0; i < LINE_COLS; i++) {
      const o = i * 64;
      let sum = 0, wsum = 0;
      for (let b = LINE_B0; b <= LINE_B1; b++) {
        const e = spec[o + b];
        if (e > peak) peak = e;
        const w = e * e;
        sum += w * (b - LINE_B0);
        wsum += w;
      }
      ridge[i] = wsum > 1e-6 ? sum / wsum / (LINE_B1 - LINE_B0) : 0.5;
      loud[i] = F.envAt("vocal", this.lineT0 + (this.lineSpan * i) / (LINE_COLS - 1));
    }
    // a three-column average: the analysis is at 100 fps and the house is at
    // 256 columns, so the contour gets one smoothing pass before it is asked
    // to hold a line -- the film's own ruler, applied to the film's own data
    const smooth = this.lineRidgeS;
    for (let i = 0; i < LINE_COLS; i++) {
      const a = ridge[Math.max(0, i - 1)];
      const b = ridge[i];
      const c = ridge[Math.min(LINE_COLS - 1, i + 1)];
      const r = (a + 2 * b + c) / 4;
      smooth[i] = r;
      const centre = LINE_CENTER + (0.5 - r) * LINE_PITCH;
      const half = LINE_MIN_THICK + LINE_THICK * loud[i];
      this.lineHi[i] = centre - half;
      this.lineLo[i] = centre + half;
    }
    return { span: this.lineSpan, peak };
  }

  // Where does the writing head have to stand? It is a vertical bar at the
  // bowl's mid-depth, and it has to land on the same column of the picture the
  // pen is writing: invert the projection once per frame (twenty halvings of a
  // 120 m span, four decimals of a pixel -- cheap, and exact enough that the
  // bar and the quiet it leaves behind are the same column).
  barX(u) {
    const W = this.ctx.W, H = this.ctx.H, z = this.lineBarZ;
    const at = (x) => project(this.lineVp, [x, 4, z], W, H)[0] / W;
    let lo = -60, hi = 60;
    // the camera looks up the house, so its right axis is -x: screen u falls as
    // world x rises. Read which way the projection runs instead of assuming it.
    const dir = at(hi) > at(lo) ? 1 : -1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if ((at(mid) - u) * dir < 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // Where does a hand land in the picture if it is raised `d` metres? Two
  // straight lines, one for each side of the held position -- the measured
  // endpoints, not a tangent.
  vAt(s, d) {
    return d >= 0
      ? s.v0 + (s.vUp - s.v0) * (d / LINE_DY1)
      : s.v0 + (s.vDown - s.v0) * (d / LINE_DY0);
  }

  // The inverse: how far does this hand have to rise to hold this row?
  dAt(s, target) {
    if (target <= s.v0) {
      const w = (target - s.v0) / (s.vUp - s.v0);
      return Math.max(0, Math.min(LINE_DY1, w * LINE_DY1));
    }
    const w = (target - s.v0) / (s.vDown - s.v0);
    return Math.min(0, Math.max(LINE_DY0, w * LINE_DY0));
  }

  // ...and where in the picture does that raise put the hand horizontally?
  uAt(s, d) {
    return d >= 0
      ? s.u + (s.uUp - s.u) * (d / LINE_DY1)
      : s.u + (s.uDown - s.u) * (d / LINE_DY0);
  }

  // The written curve, read at an arbitrary place in the picture (u in 0..1):
  // this is what a hand that lands at that point would have to hold. `which`
  // picks the loud edge or the quiet one.
  wantAt(u, which = 0) {
    const src = which ? this.lineLo : this.lineHi;
    const cu = Math.max(0, Math.min(1, (u - this.lineU[0]) / (this.lineU[1] - this.lineU[0]))) * (LINE_COLS - 1);
    const i0 = Math.floor(cu);
    const i1 = Math.min(LINE_COLS - 1, i0 + 1);
    const f = cu - i0;
    return src[i0] * (1 - f) + src[i1] * f;
  }

  // Write the line. One hand per column -- the arm that lands closest to the
  // row the song is singing, charged for every metre it has to travel away
  // from the hand in the column before it (neighbours do not teleport between
  // rows: a line that jumps is not an arm). Everything else in the house holds
  // its light and goes quiet behind the pen. Returns the honest accounting.
  solveTrace(writeU) {
    const H = this.ctx.H;
    const gain = this.lineGain, rim = this.lineRim, lift = this.lineLift;
    const on = this.lineOn, quiet = this.lineQuiet, used = this.lineUsed;
    gain.fill(0); rim.fill(0); lift.fill(0); on.fill(0); quiet.fill(0); used.fill(0);
    this.lineCols.fill(0);
    const list = this.linePens;
    list.length = 0;
    if (!this.lineSeats.length) {
      return { pens: 0, second: 0, cols: 0, lifted: 0, lift: [0, 0], writeCol: 0 };
    }
    const writeCol = clamp(writeU, 0, 1) * (LINE_COLS - 1);
    // the pen has passed: everything behind it in the house is quiet
    for (const s of this.lineSeats) {
      quiet[s.k] = s.col <= writeCol ? 1 : 0;
    }
    let pens = 0, second = 0, lo = 1e9, hi = -1e9;
    let prevHi = null, prevLo = null;
    for (let col = 0; col < LINE_COLS; col++) {
      if (col > writeCol) break;
      const cand = this.lineCand[col];
      if (!cand || !cand.length) continue;
      // Two hands per column: one for the loud edge of her voice, one for the
      // quiet edge, so the column holds the *band* between them. Where the
      // voice is loud the two hands are far apart; where it is quiet they meet
      // and the line closes.
      for (let which = 0; which < 2; which++) {
        const prevD = which ? prevLo : prevHi;
        let best = null, bestD = 0, bs = 1e9;
        let runner = null, runnerD = 0, bs2 = 1e9;
        // First pass: the arm lands on the row. Second pass, looser, for
        // columns that fall in an aisle or at the rim of the bowl -- a hand
        // leaning across from the next column can still take it. If even that
        // fails the column stays empty: a wrong arm in the line reads as
        // noise, an empty column reads as the aisle it is.
        for (const tol of [LINE_TOL, LINE_TOL * 1.6]) {
          best = null; bs = 1e9; runner = null; bs2 = 1e9;
          for (const q of cand) {
            const s = q.s;
            if (used[s.k]) continue;
            // Where does this arm have to be? Raising it moves it both up
            // *and* sideways, so solve the two together: guess from the row,
            // read what the curve wants where the guess lands, guess again.
            // Three passes take the residual under a pixel.
            const target = this.wantAt(s.u, which);
            let d = this.dAt(s, target);
            for (let it = 0; it < 3; it++) {
              d = this.dAt(s, this.wantAt(this.uAt(s, d), which));
            }
            const uNow = this.uAt(s, d);
            const off = Math.abs(this.vAt(s, d) - this.wantAt(uNow, which)) * H;
            if (off > tol) continue;
            const jump = prevD == null ? 0 : Math.abs(d - prevD);
            // the hand's own column is preferred; leaning across an aisle costs
            const score = off + jump * LINE_JUMP + q.d * 2;
            if (score < bs) {
              runner = best; runnerD = bestD; bs2 = bs;
              best = s; bestD = d; bs = score;
            } else if (score < bs2) {
              runner = s; runnerD = d; bs2 = score;
            }
          }
          if (best) break;
        }
        if (which) prevLo = null;
        else prevHi = null;
        if (!best) continue;
        used[best.k] = 1;
        gain[best.k] = 1;
        lift[best.k] = bestD;
        on[best.k] = 1;
        if (bestD < lo) lo = bestD;
        if (bestD > hi) hi = bestD;
        pens++;
        list.push(best);
        this.lineCols[col] = which ? this.lineCols[col] : 1;
        if (which) prevLo = bestD;
        else prevHi = bestD;
        // one runner-up, half a metre of slack: it gives the edge a body
        // without turning a column into a wall
        if (runner && bs2 < LINE_TOL + LINE_JUMP * 0.5) {
          used[runner.k] = 1;
          gain[runner.k] = LINE_SECOND;
          lift[runner.k] = runnerD;
          second++;
        }
      }
    }
    let cols = 0;
    for (let i = 0; i < LINE_COLS; i++) cols += this.lineCols[i];
    return {
      pens, second, cols, lifted: this.lineSeats.length,
      lift: [lo === 1e9 ? 0 : lo, hi === -1e9 ? 0 : hi],
      writeCol: Math.floor(writeCol),
    };
  }

  // The line only exists at one eye. This measures it the way the eye sees it:
  // every lit hand is projected, and the curve it draws is compared against the
  // curve that was *written* for that column of the picture. At the one eye the
  // two agree to the pixel (the hands are on the line, by construction). Three
  // steps to the side the near rows shear faster than the far ones, the hands
  // land on columns whose words belong to other hands, and the same arms become
  // noise -- counted here as the median error and the number of folded columns.
  traceError() {
    const W = this.ctx.W, H = this.ctx.H;
    const run = (vp) => {
      const bins = new Map();
      const hand = [];
      let folds = 0;
      for (const s of this.lineSeats) {
        if (!this.lineOn[s.k]) continue;
        const p = project(vp, [s.x, s.y0 + this.lineLift[s.k], s.z], W, H);
        if (!(p[2] > 0.2)) continue;
        const u = p[0] / W;
        if (u < 0 || u > 1) continue;
        const c = Math.round(u * (LINE_COLS - 1));
        const a = bins.get(c);
        if (a) { a.push(p[1] / H); folds++; } else bins.set(c, [p[1] / H]);
        // the hand is on whichever edge of the band it was asked to hold
        const eHi = Math.abs(p[1] / H - this.wantAt(u, 0)) * H;
        const eLo = Math.abs(p[1] / H - this.wantAt(u, 1)) * H;
        hand.push(Math.min(eHi, eLo));
      }
      // The read is the *band*: at the one eye each column of the picture holds
      // the two hands of that column, so the band's centre is the ridge of her
      // voice. Off the eye the columns take hands from other columns, the
      // centre wanders, and the same arms draw a different melody.
      const ridge = [];
      for (const [c, a] of bins) {
        // a column with one hand has no band to read: skip it rather than
        // call half a thickness an error
        if (a.length < 2) continue;
        a.sort((x, y) => x - y);
        const mid = (a[0] + a[a.length - 1]) / 2;
        const u = c / (LINE_COLS - 1);
        const us = this.lineU[0] + (this.lineU[1] - this.lineU[0]) * u;
        ridge.push(Math.abs(mid - (this.wantAt(us, 0) + this.wantAt(us, 1)) / 2) * H);
      }
      const stat = (e) => {
        if (!e.length) return { n: 0, med: 0, p90: 0 };
        e.sort((x, y) => x - y);
        return {
          n: e.length,
          med: +e[Math.floor(e.length * 0.5)].toFixed(2),
          p90: +e[Math.floor(e.length * 0.9)].toFixed(2),
        };
      };
      const out = stat(ridge);
      out.folds = folds;
      out.hand = stat(hand);
      return out;
    };
    return {
      atEye: run(this.lineVp),
      atCam: run(this.stadium.vp),
      atSeat: run(this.lineVpOff[0]),
      at1: run(this.lineVpOff[1]),
      at5: run(this.lineVpOff[2]),
    };
  }


  render(f, out) {
    const t = f.t;
    const local = t - 225.69;
    const speed = clamp(local / 26.0);
    const binStart = this.binaryLine ? this.binaryLine.start : 247.33;
    // The plaque is printed on the closed curtain, one character at a time,
    // and it is finished *before* the hand-over to the empty hall begins
    // (that curtain's window opens at 4:15.5): the last thing left on the
    // dark stage is the name, and it gets three seconds to be read.
    const nameStart = (this.nameLine ? this.nameLine.start : 252.42) - 0.85;
    const binary = smoothstep(binStart, binStart + 2.2, t);
    const name = smoothstep(nameStart, nameStart + 1.85, t);
    // the story closes its curtain; the name is what remains on the dark stage
    const curtain = this.curtainLine
      ? smoothstep(this.curtainLine.start, this.curtainLine.start + 2.8, t) : 0;
    // Shot 44. "ボクは 歌う" is the one line the film answers with a camera
    // move instead of a cut: the lens leaves the wide, lands on her, and walks
    // a half-circle around her -- the only time in the film she is *inside*
    // the crowd instead of in front of it. It ends behind her shoulder, with
    // the whole house in front of the lens, so the reduction to 0 and 1 that
    // follows flies *away* from us, into ten thousand hands.
    const arcStart = this.singLine ? this.singLine.start : 241.45;
    // The walk lands one sweep early: from t = binStart - 1.70 s the lens is
    // parked on the one eye, still, and the last 1.70 s before the reduction
    // is spent watching the house write. Then the reduction pulls the lens
    // back off the eye -- and the line comes apart on its own.
    const landAt = binStart - LINE_SWEEP - LINE_HOLD_BEAT;
    const arc = t <= arcStart ? 0 : clamp((t - arcStart) / Math.max(0.5, landAt - arcStart));
    const solo = arc > 0.02;
    const rise = f.entry && f.entry.id === "finale"
      ? clamp((t - binStart - 0.05) / 1.25) : 0;
    const landing = smoothstep(0.25, 1.0, rise);

    // ---- the voice line, swept across the house ---------------------------
    // The last line before the reduction is ボクの想い すべて 虚空 消えて: every
    // feeling gone into the void. The void answers with the one thing that is
    // hers: her own waveform, written on the audience. The sweep takes exactly
    // 1.70 s -- HEAD-01's rate, at 0:26 -- and the trace is only legible from
    // the one eye the walk-around ends on, standing where she stands. Nothing
    // is projected on the crowd; they are asked to raise their arms, and from
    // that one place the arms become one line.
    const sinceSweep = t - landAt;
    const writeU = this.lineSeats.length
      ? clamp(sinceSweep / LINE_SWEEP) : 0;
    const sinceBin = t - binStart;
    const hold = 1 - smoothstep(LINE_HOLD, LINE_FADE, Math.max(0, sinceBin));
    // The trace exists while it is being written and while she is handed over
    // to it. During the walk there is no trace at all: the arms are a crowd.
    // `lock` is the landing -- the last 6 % of the move, a third of a second --
    // and it is the only reason the same arms read as a line.
    const lock = this.lineSeats.length ? smoothstep(0.94, 1.0, arc) : 0;
    const trace = clamp(lock * smoothstep(0, 0.02, writeU) * hold);
    const scan = smoothstep(0, 0.02, writeU) * (1 - smoothstep(0.995, 1.02, writeU));
    // where in the picture the head stands: the same fraction of the house's
    // own span the columns were cut over
    const penU = this.lineU[0] + (this.lineU[1] - this.lineU[0]) * writeU;

    // ------------------------------------------------------------ the room
    // This is not a replay, it is a concert, and the room is a real one. The
    // camera starts inside the house, level with the sea of lights, and cranes
    // up over it while ten thousand penlights come on row by row, from the
    // stage outwards.
    const arena = (1 - name) * smoothstep(0.6, 9.0, local);
    const crane = smoothstep(0, 14, local);
    const push = smoothstep(12, 30, local);
    let eye = [
      Math.sin(local * 0.06) * 1.1,
      12.6 + 4.6 * crane + 1.0 * push - 1.4 * landing,
      63 - 5 * crane - 8 * push - 9 * landing,
    ];
    let at = [
      this.her.x * 0.5 * landing,
      5.0 + 1.6 * crane + 0.4 * landing,
      VENUE.screenZ * 0.7 + 3.5 * landing,
    ];
    let fov = 1.06 - 0.10 * crane;
    // the walk around her: radius and height come down as the lens comes
    // round, so the shot tightens on her face-less head and then opens onto
    // the house behind her -- a cut on the vocal onset, then nothing but one
    // continuous 180-degree move
    if (arc > 0) {
      const ae = arc * arc * (3 - 2 * arc);
      const th = Math.PI * ae;
      const radius = 10.6 - 1.9 * ae;
      eye = [
        this.her.x + Math.sin(th) * radius * 0.94,
        // the lens lifts as it comes round: by the end of the walk it is
        // above her head, looking down over her shoulder into the bowl, and
        // the whole house fits in the top half of the frame instead of
        // squeezing into a band at her waist
        6.9 + 1.5 * ae,
        this.her.z + Math.cos(th) * radius,
      ];
      at = [
        // she stays in the frame through the whole half-circle: the lens is
        // circling her, not sliding past her. Raising the look-at as the arc
        // closes sits her a little lower in the frame and lets the house in
        // over her shoulder.
        this.her.x + 0.22 * Math.sin(th),
        4.10 + 0.70 * ae,
        this.her.z + 0.30,
      ];
      fov = 0.76 + 0.38 * ae;
    }
    // And the reduction takes the lens back off the eye. This has to happen
    // after the walk-around, not before: while the arc is running, the arc's
    // own equation is the camera, and the leave is added on top of it. Nine
    // metres back and 1.4 m down -- the same numbers as the wide shot this
    // move started from -- and the line the house is holding comes apart by
    // itself, because it was only ever true from one seat.
    if (landing > 0.001) {
      eye = [eye[0], eye[1] - 1.4 * landing, eye[2] - 9.0 * landing];
      at = [
        at[0] + (this.her.x * 0.5 - at[0]) * landing,
        at[1] + 0.4 * landing,
        at[2] + 3.5 * landing,
      ];
    }
    // The walk ends exactly on the one eye that can read the trace: the
    // geometry above is solved so that at arc = 1 it is this camera.
    void 0;
    this.stadium.view(eye, at, {
      fov, aspect: this.ctx.W / this.ctx.H,
    });

    // Solve the arms in the image plane of the camera that is about to draw
    // them -- so the readout can report what the *current* frame sees, and the
    // error collapses to a couple of pixels as the walk lands on the eye.
    if (this.lineSeats.length) {
      const wave = this.traceAt(f.F);
      const st = this.solveTrace(writeU);
      st.peak = wave.peak;
      st.span = wave.span;
      st.writeU = writeU;
      st.eye = this.lineEye;
      st.err = this.traceError();
      this.lineStats = st;
    }

    this.pass.draw({ dst: out, u: audioU(f, {
      uSpeed: speed * (1 - 0.82 * trace), uBinary: binary, uName: name,
    }) });

    if (arena > 0.01) {
      // the house fills up from the stage outwards: each row raises its light
      // a third of a second after the one in front of it
      for (let r = 0; r < this.rowLit.length; r++) {
        this.rowLit[r] = clamp((local - 1.1 - r * 0.42) / 1.3);
        // During the walk the house holds its lights *up* -- high enough to be
        // seen over the shoulders in front, and perfectly still: the one time
        // in the film ten thousand people are quiet for her.
        this.rowArm[r] = clamp(this.rowLit[r] * 1.4 - 0.25) * (solo ? 0.72 : 1);
      }
      this.stadium.frame(out, {
        t,
        rowLit: this.rowLit,
        rowArm: this.rowArm,
        energy: 0.35 + 0.65 * speed,
        warm: 0.10 + 0.30 * landing,
        // Facing her from behind, the room is the subject: the bowl's own
        // lines come up so the lights are a *house* and not a band of noise.
        structure: arena * (0.55 + 0.40 * solo) * (1 - 0.84 * trace),
        // the house holds still for her, but it does not go out: by the end of
        // the walk it is what she is standing in front of
        lightsAlpha: arena * (1 + 0.15 * solo) * (1 - 0.10 * trace),
        stage: 0.45 + 0.55 * arena,
        // the wave only exists once the whole house is up: one movement, big
        // enough to be seen from the back of the room
        wave: 0.45 * clamp((local - 8) / 3) * (1 - 0.8 * solo),
        wavePhase: local * 0.11,
        // Seen from the stage the house is a field of small lights, not a
        // wall of shoulders: the bodies step back during the walk, so what
        // she is standing in front of is ten thousand penlights.
        // the house stays people while it holds the trace: the arms are the
        // instrument, so the shoulders cannot disappear
        crowd: (solo ? 0.28 : 1) * (1 - 0.42 * trace),
        // the bowl recedes into its own air; the rig's beams are visible in it
        haze: 0.9 - 0.55 * trace,
        beam: arena * (0.55 + 0.45 * solo) * (1 - 0.92 * trace),
        // and the one viewpoint: one arm height per seat, recomputed every
        // frame from the waveform the song is singing, plus the quiet the
        // writing head leaves behind it and the head itself, at house scale
        seatGain: trace > 0.002 ? this.lineGain : null,
        seatRim: trace > 0.002 ? this.lineRim : null,
        seatLift: trace > 0.002 ? this.lineLift : null,
        seatQuiet: trace > 0.002 ? this.lineQuiet : null,
        traceFloor: LINE_FLOOR,
        writeHead: trace > 0.002 ? {
          x: this.lineBarX[0] + (this.lineBarX[1] - this.lineBarX[0]) * writeU,
          x0: this.lineBarX[0], x1: this.lineBarX[1],
          z: this.lineBarZ, amount: trace,
        } : null,
        trace,
      });
    }

    const c = this.text.ctx;
    this.text.clear();

    // v8: the last chapter begins in the audience's own seat. The lens starts
    // at eye z 63, level with the last row of the house -- so for the first
    // three seconds there is a stencil on the back of the seat in front of
    // it: SEAT 08192. It is the number the queue counts to (0:00.55), the one
    // the archive leaves unstamped (4:52), and the one the viewer is sitting
    // in. Planted once, at the bottom of the frame, then the crane takes it.
    {
      const seatA = smoothstep(0.55, 1.15, local) * (1 - smoothstep(2.05, 3.05, local));
      if (seatA > 0.01) {
        c.save();
        c.globalAlpha = seatA;
        c.strokeStyle = css("amber", 0.26);
        c.lineWidth = 1;
        c.strokeRect(880.5, 966.5, 159, 54);
        label(c, "SEAT 08192 \u00b7 ROW 32", 960, 982, {
          size: 14, align: "center", tracking: 2.2, color: css("amber", 0.60),
        });
        label(c, "HELD", 960, 1006, {
          size: 12, align: "center", tracking: 3.0, color: css("amber", 0.42),
        });
        c.restore();
      }
    }

    const bt = beatAt(f.F, t);
    const bid = bt ? bt.id : "";
    const recall = bt ? Math.min(bt.fresh, 1 - bt.exit) : 0;

    // ------------------------------------------- haze, and the spot rig
    // The room carries the crowd; this layer is only what hangs in its air --
    // haze bands and the spotlights that keep finding her -- lined up with the
    // room's own perspective.
    const rig = project(this.stadium.vp, [this.her.x, 4.0, this.her.z - 3], this.ctx.W, this.ctx.H);
    if (arena > 0.01) {
      spotRig(c, {
        t, x: rig[0], y: rig[1], alpha: 0.55 * arena * (1 - 0.95 * trace),
        energy: 0.25 + 0.75 * speed, warm: 0.34, count: 7,
      });
      const band = c.createLinearGradient(0, 700, 0, 1080);
      band.addColorStop(0, css("ink", 0));
      band.addColorStop(0.45, css("ink", 0.20));
      band.addColorStop(1, css("ink", 0.44));
      c.fillStyle = band;
      c.fillRect(0, 700, 1920, 380);
    }

    // The four corners of the film's own viewfinder, kept on through the walk:
    // this is still the machine's record, and the lens is still its eye even
    // while it is doing the one human thing it ever does.
    if (solo) {
      c.save();
      c.strokeStyle = css("dim", 0.42);
      c.lineWidth = 1;
      for (const [sx, sy, dx, dy] of [[420, 96, 1, 1], [1500, 96, -1, 1], [420, 1010, 1, -1], [1500, 1010, -1, -1]]) {
        c.beginPath();
        c.moveTo(sx, sy + dy * 30);
        c.lineTo(sx, sy);
        c.lineTo(sx + dx * 30, sy);
        c.stroke();
      }
      c.restore();
      label(c, "CV-01 / STILL RENDERING", 960, 1030, {
        size: 15, align: "center", tracking: 3,
        color: css("dim", 0.9), alpha: 0.8,
      });
    }

    // The pen itself: a scan line crossing the house from the left, writing
    // her voice onto the arms it passes. One 1.70 s pass, the same rate the
    // machine used to print her at 0:26 -- and the trail behind it is the only
    // thing in the frame that has already been written.
    if (trace > 0.01 && writeU > 0.001 && writeU < 0.999) {
      const sx = penU * 1920;
      const tail = 190;
      const g = c.createLinearGradient(sx - tail, 0, sx, 0);
      g.addColorStop(0, css("miku", 0));
      g.addColorStop(0.65, css("miku", 0.05));
      g.addColorStop(1, css("ink", 0.0));
      c.fillStyle = g;
      c.fillRect(sx - tail, 40, tail, 1000);
      c.save();
      c.globalAlpha = 0.55 * trace;
      c.fillStyle = css("mikuHi", 0.85);
      c.fillRect(sx - 1, 40, 2, 1000);
      c.restore();
      label(c, `WRITING \u00b7 ${pad(Math.round(writeU * LINE_COLS), 3)}/${LINE_COLS}`, sx + 12, 78, {
        size: 12, tracking: 1.8, color: css("mikuHi", 0.85 * trace),
      });
    }

    // The house's own readout while the trace is being written. This is a
    // measurement, not a mood: one hand per column, that hand's height measured
    // from the one eye, and the spread the same hands make the moment the eye
    // steps aside. The last number is the whole trick of the shot.
    if (trace > 0.01 && this.lineStats) {
      const st = this.lineStats;
      panel(c, 1408, 796, 436, 164, {
        fill: css("ink", 0.93), corner: 10,
        cornerColor: css("miku", 0.55), stroke: css("dim", 0.5),
      });
      label(c, "ANAMORPHIC VOICE LINE", 1424, 788, {
        size: 15, tracking: 2.0, color: css("ash", 0.95),
      });
      label(c, "ONE EYE \u00b7 " + `${st.pens} HANDS \u00b7 ${st.cols}/${LINE_COLS} COLUMNS`, 1424, 826, {
        size: 14, tracking: 1.4, color: css("miku", 0.9),
      });
      label(c, `SPECTRAL RIDGE ${LINE_B0}\u2013${LINE_B1}/64 \u00b7 ${st.span ? st.span.toFixed(1) : "21.6"} s \u2192 ${LINE_SWEEP.toFixed(2)} s`, 1424, 858, {
        size: 13, tracking: 1.4, color: css("dim", 0.95),
      });
      drawText(c, `${pad(Math.round(st.writeU * 100), 3)}%`, {
        x: 1828, y: 862, size: 26, weight: 600, mono: true, align: "right",
        color: st.writeU >= 1 ? css("miku", 0.95) : css("bone", 0.9),
      });
      const e0 = st.err ? st.err.atEye : { med: 0, p90: 0 };
      const ec = st.err ? st.err.atCam : e0;
      const e2 = st.err ? st.err.atSeat : { med: 0, p90: 0 };
      label(c, `RIDGE: NOW \u00b1${ec.med.toFixed(1)} px \u00b7 AT EYE \u00b1${e0.med.toFixed(1)} px`,
        1424, 898, { size: 13, tracking: 1.2, color: css("ash", 0.9) });
      label(c, `ONE SEAT (0.50 m) \u2192 \u00b1${e2.med.toFixed(1)} px \u00b7 ${e2.folds || 0} FOLDED COLUMNS`,
        1424, 926, {
        size: 13, tracking: 1.2, color: css("amber", 0.95),
      });
    }

    // ------------------------------------------------ 0 と 1 に還元され
    // Her body comes apart into single characters and they cross the room to
    // land in the seats -- each one on a seat that really exists, so the
    // hand-over from body to audience is one continuous movement.
    // Until then she is simply standing on the stage, in the light -- and once
    // the camera is walking around her, this is the only "her" in the frame:
    // the silhouette the lens is circling, drawn from the room's own matrix so
    // she cannot drift away from the stage she is standing on.
    if (!name && curtain < 0.02 && rise < 0.02 && arena > 0.2 && bid !== "not_meaningless") {
      const box = this.herBox();
      if (box.h > 8) {
        singer(c, box.x, box.feet, box.h, {
          t,
          alpha: (solo ? clamp(0.26 + 0.66 * arc) : 0.50 + 0.38 * arena) * (1 - 0.55 * trace),
          mouth: 0.20 + 0.70 * f.a.vocal,
          heart: 0.85,
          // a follow spot drifting slowly down her, the only light in the hall
          light: 0.32 + 0.58 * (0.5 + 0.5 * Math.sin(t * 0.31)),
        });
      }
    }
    if (rise > 0.001 && rise < 1.6 && !name) this.reduction(c, f, { rise });

    const clean = !name && !solo && rise < 0.04;
    if (clean) {
      // the wall runs: rows slide past at the rate of the verse
      const scroll = (t * (2 + speed * 5)) % 58;
      typeWall(c, f.F, t, {
        x: 110, y: 560 - scroll * 0.6, w: 900, count: 6, lineHeight: 58, size: 30,
        window: 6, lead: 0, dimColor: css("dim", 0.7), hotColor: css("miku", 0.95),
      });

      // one earlier image per repeated line, fast enough to feel like memory
      panel(c, 1048, 108, 464, 304, {
        fill: css("ink2", 0.55), corner: 12,
        cornerColor: css("miku", 0.4), stroke: css("dim", 0.45),
      });
      label(c, "RECALL", 1060, 98, {
        size: 15, tracking: 2, color: css("ash", 0.85),
      });
      recallMotif(c, bid, bt, t);
    }

    const active = f.line;
    const big = active && active.kind === "line" && !name && !solo;
    if (big) {
      lyricLine(c, active, t, f.F, {
        x: 84, y: 800, size: 88, weight: 900, maxWidth: 1500,
        sung: css("bone", 1), dim: css("ash", 0.85),
      });
    }
    // During the walk the words stay on the screen, one size down: they are
    // the reason the camera is moving, not a banner over it. The block sits
    // above the HUD's own column so the two never type over each other.
    if (solo && active && active.kind === "line" && !name) {
      lyricLine(c, active, t, f.F, {
        x: 96, y: 872, size: 54, weight: 900, maxWidth: 1120,
        sung: css("bone", 0.96), dim: css("ash", 0.62),
      });
    }

    // the instant where the voice becomes 0 and 1
    if (binary > 0.05 && !name) {
      c.save();
      c.globalAlpha = binary * 0.14;
      binaryField(c, t, {
        x: 0, y: 300, w: 1920, h: 780, cell: 52, size: 15, alpha: 0.30,
        color: css("miku", 0.8), density: 0.26, speed: 2.2, seed: 5,
      });
      c.restore();
      drawText(c, "0 \u3068 1 \u306b\u9084\u5143\u3055\u308c", {
        x: 960, y: 104, size: 34, weight: 900, align: "center",
        color: css("bone", 0.9), tracking: 4, alpha: 0.72 * binary,
      });
    }

    // the thesis of the song arrives as a person, not a readout
    if (bid === "resolve" && clean) {
      singer(c, 1180, 910, 510, {
        t,
        alpha: 0.10 + 0.28 * recall,
        eyes: "happy", smile: 1, heart: 1, mouth: 0.18,
      });
    }
    if (bid === "not_meaningless") {
      const warm = recall;
      const glow = c.createRadialGradient(1180, 600, 30, 1180, 600, 440);
      glow.addColorStop(0, css("amber", 0.09 * warm));
      glow.addColorStop(1, css("amber", 0));
      c.fillStyle = glow;
      c.fillRect(680, 120, 1000, 940);
      singer(c, 1180, 920, 540, {
        t,
        alpha: 0.14 + 0.78 * warm,
        eyes: "happy", smile: 1, heart: 1, mouth: 0.15,
      });
      motifLabel(c, "IT WAS NOT MEANINGLESS", 1180, 436, {
        align: "center", size: 16, color: css("bone", 0.85 * warm),
      });
    }

    if (curtain > 0.01) {
      const cw = 960 * curtain;
      c.save();
      c.fillStyle = css("ink", 0.97);
      c.fillRect(0, 0, cw, 1080);
      c.fillRect(1920 - cw, 0, cw, 1080);
      c.strokeStyle = css("redDeep", 0.55);
      c.lineWidth = 2;
      for (let i = 0; i <= 10; i++) {
        const x = (cw * i) / 10;
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x + 18, 1080);
        c.stroke();
        c.beginPath();
        c.moveTo(1920 - x, 0);
        c.lineTo(1920 - x - 18, 1080);
        c.stroke();
      }
      c.restore();
    }

    // The name, alone, and printed rather than faded in: the plaque is the
    // only thing the machine still has to say, so it types it out character
    // by character on the closed curtain.
    if (name > 0.01) {
      const PLATE = "\u521d\u97f3\u30df\u30af";
      const psize = 150, ptrack = 8;
      c.save();
      drawText(c, PLATE, {
        x: 960, y: 600, size: psize, weight: 900, align: "center",
        color: css("bone", 0.98), tracking: ptrack,
        drawChar: (g, ch, i, gx, w, y) => {
          const a = clamp((t - (nameStart + 0.12 + i * 0.34)) / 0.18);
          if (a <= 0) return;
          g.save();
          g.globalAlpha = a;
          g.fillStyle = css("bone", 0.98);
          g.fillText(ch, gx, y);
          if (a < 1) {
            // the print head: one glyph wide, and it leaves the character lit
            g.globalAlpha = (1 - a) * 0.7;
            g.fillStyle = css("mikuHi", 0.85);
            g.fillRect(gx, y - psize * 0.86, Math.max(2, w * (0.35 + 0.65 * a)), 3);
          }
          g.restore();
        },
      });
      label(c, "\u540d\u3060\u3051\u6b8b\u308b", 960, 660, {
        size: 22, align: "center", tracking: 8, color: css("miku", 0.9 * name),
      });
      c.restore();
    }

    if (clean) {
      // instrument: what is left of the machine
      panel(c, 1560, 300, 280, 220, {
        fill: css("ink2", 0.85), corner: 10, cornerColor: css("miku", 0.5), stroke: css("dim", 0.5),
      });
      label(c, "FINAL RENDER", 1576, 292, { size: 16, tracking: 1.8, color: css("ash", 0.95) });
      const pct = clamp(84 + speed * 16);
      drawText(c, pct.toFixed(1), {
        x: 1824, y: 380, size: 52, weight: 600, mono: true, align: "right", color: css("bone", 0.95),
      });
      label(c, "%", 1576, 380, { size: 18, color: css("ash", 0.85), tracking: 1.4 });
      c.fillStyle = css("dim", 0.5);
      c.fillRect(1576, 410, 248, 8);
      c.fillStyle = css("miku", 0.9);
      c.fillRect(1576, 410, 248 * (pct / 100), 8);
      drawText(c, `${pad(Math.max(0, 94 - f.lineIndex), 2)}`, {
        x: 1824, y: 480, size: 32, weight: 600, mono: true, align: "right", color: css("amber", 0.9),
      });
      label(c, "PHRASES LEFT", 1576, 480, { size: 15, color: css("ash", 0.8), tracking: 1.2 });
      specBars(c, f.F, t, {
        x: 1576, y: 500, w: 248, h: 40, bars: 24, gap: 2, color: css("miku", 0.7),
      });

      wave(c, f.F, t, {
        x: 84, y: 990, w: 1752, h: 58, span: 0.7 - 0.3 * speed, lw: 1.2,
        color: css("miku", 0.30 + 0.28 * speed), amp: 0.66,
      });
      machineChrome(c, {
        name: "",
        left: this.last && t > this.last.start ? "\u6c7a\u3057\u3066\u7121\u99c4\u3058\u3083\u306a\u3044" : "FINAL VERSE",
        right: `T+${local.toFixed(1)} s`,
      });
    }

    this.ctx.drawLayer(out, this.text, { mode: "normal" });

    // Her body, reduced to points, crossing the room into the seats: drawn
    // after the 2D layer so the lights land on top of the room, not behind it.
    if (rise > 0.001 && name < 0.999) this.pointCloud(out, rise, name, curtain);

    // Everything the probe needs to call this shot a lie or a measurement.
    const st = this.lineStats;
    this.qaVoice = {
      t: +t.toFixed(3),
      mix: +trace.toFixed(4),
      lock: +lock.toFixed(4),
      sweep: +writeU.toFixed(4),
      hold: +hold.toFixed(4),
      sinceBin: +sinceBin.toFixed(3),
      arc: +arc.toFixed(4),
      landAt: +landAt.toFixed(3),
      scan,
      eye: this.lineEye,
      camEye: [+eye[0].toFixed(4), +eye[1].toFixed(4), +eye[2].toFixed(4)],
      visible: this.lineSeats.length,
      onLine: st ? st.pens : 0,
      side: st ? st.second : 0,
      columns: st ? st.cols : 0,
      writeCol: st ? st.writeCol : 0,
      cols: LINE_COLS,
      lifted: st ? st.lifted : 0,
      lift: st ? st.lift : [0, 0],
      peak: st ? +st.peak.toFixed(4) : 0,
      span: st && st.span ? +st.span.toFixed(2) : this.lineSpan,
      uSpan: [this.lineU[0], this.lineU[1]],
      err0: st && st.err ? st.err.atEye : null,
      errCam: st && st.err ? st.err.atCam : null,
      errSeat: st && st.err ? st.err.atSeat : null,
      err1: st && st.err ? st.err.at1 : null,
      err5: st && st.err ? st.err.at5 : null,
      hi: this.lineHi,
      loTargets: this.lineLo,
    };

    return {
      bloom: (solo ? 0.8 : 1.1 + 0.5 * f.kick) * (1 - 0.80 * trace),
      exposure: (1.0 + 0.05 * speed) * (1 - 0.22 * trace),
      grain: 0.03 - 0.014 * trace,
      vignette: 0.66 + 0.12 * name,
      scan: 0.06,
      ca: 0.002 + 0.004 * speed,
      zoom: 1 + 0.014 * speed * f.kick + 0.05 * name,
      fade: 0.35 * smoothstep(29.0, 31.0, local),
    };
  }

  // Her body, reduced to points, lifted into the seats: the one transition the
  // script calls the largest in the film. `curtain` hands the last of her over
  // to the house: as the cloth closes, the points stop being drawn, because by
  // then the lights in the seats are the audience's own again -- what is left
  // on the closed curtain is only her name.
  pointCloud(out, rising, name, curtain = 0) {
    const S = this.stadium, her = this.her;
    const fade = (1 - name) * (1 - 0.9 * curtain);
    const CM = rgb("miku"), HI = rgb("mikuHi"), BO = rgb("bone"), AM = rgb("amber");
    let n = 0;
    for (let i = 0; i < this.cloudPts.length; i++) {
      const q = this.cloudPts[i];
      const a1 = hash1(i * 12.9898), a2 = hash1(i * 78.233), a3 = hash1(i * 37.719);
      const u = clamp((rising - a3 * 0.5) / 0.62);
      const e = u * u * (3 - 2 * u);
      // She stands on the stage; each point lands on a hand that is really on
      // the line -- the very lights that are holding her voice. Her body is
      // handed to the audience one character at a time, and what it lands on
      // is the trace she has been singing.
      const start = [her.x + q[0] * her.w, her.y + (q[1] + 1) * 0.5 * her.h, her.z];
      const pens = this.linePens;
      let hand, seat = null;
      if (pens.length) {
        const pen = pens[Math.min(pens.length - 1, Math.floor(a1 * pens.length))];
        hand = [pen.x, pen.y0 + this.lineLift[pen.k], pen.z];
      } else {
        const r = Math.min(VENUE.rows - 1, Math.floor(a1 * a1 * VENUE.rows));
        const s = S.seat(r, Math.floor(a2 * S.counts[r]));
        seat = s;
        hand = [s.x + s.side * 0.27, s.y + VENUE.shoulder + 0.62, s.z];
      }
      const p = [
        start[0] + (hand[0] - start[0]) * e,
        start[1] + (hand[1] - start[1]) * e + Math.sin(Math.PI * u) * (0.5 + a2 * 1.1),
        start[2] + (hand[2] - start[2]) * e,
      ];
      // the hands on the trace burn in her colour; a fallback seat keeps the
      // house's own amber under it
      const end = seat
        ? (seat.warm < 0.24 ? AM : seat.bone < 0.07 ? BO : HI)
        : HI;
      const c = [
        CM[0] + (end[0] - CM[0]) * e,
        CM[1] + (end[1] - CM[1]) * e,
        CM[2] + (end[2] - CM[2]) * e,
      ];
      n = writeInstance(this.cloudData, n, {
        p,
        c,
        a: (0.60 + 0.40 * q[2]) * fade * (1 - 0.25 * e),
      });
    }
    this.cloud.update(this.cloudData, n)
      .render(out, { vp: S.vp, point: 7, sprite: 1 });
  }

  // Screen-space box of her body on the stage. The 2D silhouette and the 3D
  // points are both placed from this, so the hand-over cannot disagree.
  herBox() {
    const vp = this.stadium.vp, W = this.ctx.W, H = this.ctx.H, her = this.her;
    const feet = project(vp, [her.x, her.y, her.z], W, H);
    const head = project(vp, [her.x, her.y + her.h, her.z], W, H);
    const l = project(vp, [her.x - her.w, her.y, her.z], W, H);
    const r = project(vp, [her.x + her.w, her.y, her.z], W, H);
    return { x: (l[0] + r[0]) / 2, feet: feet[1], h: feet[1] - head[1], w: r[0] - l[0] };
  }

  // "0 と 1 に還元され": she stands, comes apart into single characters, and
  // the characters cross the room to seats that exist. No mosaic, no noise --
  // the picture has to stay readable while it turns into language.
  reduction(c, f, { rise }) {
    const box = this.herBox();
    const solid = 1 - clamp(rise * 1.5);
    if (solid > 0.01 && box.h > 10) {
      singer(c, box.x, box.feet, box.h, {
        t: f.t,
        alpha: 0.95 * solid,
        mouth: 0.25 + 0.6 * f.a.vocal,
        heart: 0.9,
        dissolve: 1 - solid,
        light: 0.55 + 0.35 * solid,
      });
    }
    const S = this.stadium, W = this.ctx.W, H = this.ctx.H;
    for (let i = 0; i < 168; i++) {
      const a1 = hash1(i * 3.71 + 1.3), a2 = hash1(i * 7.13 + 5.1);
      const a3 = hash1(i * 11.7 + 2.9), a4 = hash1(i * 5.31 + 9.7);
      const u = clamp((rise - a2 * 0.45) / 0.70);
      if (u <= 0.01) continue;
      const e = u * u * (3 - 2 * u);
      const sx = box.x + (a1 - 0.5) * box.w * 0.80;
      const sy = box.feet - box.h * (0.06 + 0.88 * a2);
      const r = Math.min(VENUE.rows - 1, Math.floor(a3 * a3 * VENUE.rows));
      const s = S.seat(r, Math.floor(a4 * S.counts[r]));
      const sp = project(S.vp, [s.x + s.side * 0.27, s.y + VENUE.shoulder + 0.62, s.z], W, H);
      drawText(c, i % 2 ? "0" : "1", {
        x: sx + (sp[0] - sx) * e,
        y: sy + (sp[1] - sy) * e - Math.sin(Math.PI * u) * box.h * 0.16,
        size: 12 + 10 * e, mono: true, align: "center",
        color: i % 3 ? css("miku", 0.85) : css("mikuHi", 0.9),
        alpha: (0.88 - 0.55 * e) * clamp(u * 3),
      });
    }
  }

  dispose() {
    this.stadium.dispose();
    this.cloud.dispose();
  }
}
