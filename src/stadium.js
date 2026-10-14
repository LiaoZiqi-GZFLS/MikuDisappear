// The venue: one arena, built from instanced primitives.
//
// Stage at the far end, a raked bowl wrapping around it, a truss over
// everything. Every person in the house is three instances: a penlight (a lit
// rod in world space, so it shrinks with distance the way a real light does),
// an arm (a hairline from the shoulder, so the light belongs to somebody), and
// a body -- head and shoulders, composited with multiply, so the crowd can
// *block* the light behind it instead of adding to it. That last part is what
// turns a field of dots into ten thousand people: the front rows are dark
// because the stage is behind them, and they cut holes in the rows above.
//
// Nothing here is random: every seat, colour, arm and flicker phase comes out
// of a hash of its index, so any frame of the film can be rendered again
// exactly.
//
// The room is used twice. `final` fills it row by row for the last
// performance; `lastwords` empties it again.

import { Stage3D, camera, mat4, project, rgb, writeInstance } from "./gl3d.js";
import { css } from "./palette.js";

const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// The room's dimensions, in metres. Everything else is derived from these.
export const VENUE = {
  rows: 32,
  rowZ: 3.2,        // the first row, measured from the stage
  rowGap: 1.62,     // depth of one row
  rowY: 0.5,        // height of the first row's floor
  rake: 0.30,       // how much each row rises behind the one in front
  upper: 18,        // the walkway: everything above it is the upper tier
  upperRake: 0.30,  // extra rise per row up there
  upperGap: 2.6,    // depth of the walkway itself
  halfW: 16.5,      // half-width of the first row
  spread: 1.42,     // every row is this much wider than the one in front
  curve: 9.0,       // how far a row's ends wrap around towards the stage
  curveY: 1.3,      // and how much those ends rise
  pitch: 0.30,      // metres of row per person, shoulder to shoulder
  aisles: [-0.5, -0.25, 0, 0.25, 0.5],
  aisleHalf: 0.014, // half-width of an aisle, as a fraction of the row
  stageZ: -6.0,     // centre of the stage floor
  stageHalfW: 15.0,
  stageHalfD: 4.4,
  screenZ: -15.5,
  screenH: 4.8,
  screenY: 6.6,
  ceiling: 22.0,
  shoulder: 1.22,   // shoulder height above the row's floor
};

export class Stadium {
  constructor(ctx, { rows = VENUE.rows, seed = 9 } = {}) {
    this.ctx = ctx;
    this.rows = rows;
    this.seed = seed;
    this.vp = mat4();
    this.lights = new Stage3D(ctx, "rect");   // penlights, arms, the rig
    this.room = new Stage3D(ctx, "segment");  // the architecture, in lines
    this.face = new Stage3D(ctx, "rect");     // floor, stage, screen, walls
    this.crowd = new Stage3D(ctx, "person");  // the bodies, as a shadow
    this.beams = new Stage3D(ctx, "rect");    // the air under the truss
    this.scanBar = new Stage3D(ctx, "rect");  // HEAD-01, scaled to the house
    this.scanRig = new Stage3D(ctx, "segment");

    this.buildSeats();
    this.lightData = new Float32Array(this.total * 3 * 16 + 512 * 16);
    this.roomData = new Float32Array((this.rows * 12 + 360) * 16);
    this.faceData = new Float32Array(280 * 16);
    this.bodyData = new Float32Array(this.total * 16);
    this.beamData = new Float32Array(14 * 16);
    this.scanBarData = new Float32Array(16);
    this.scanRigData = new Float32Array(128 * 16);
    this.rowPix = new Float32Array(this.rows);
    this.litRows = 0;
  }

  // --- the bowl ------------------------------------------------------------
  rowZ(r) { return VENUE.rowZ + r * VENUE.rowGap + (r < VENUE.upper ? 0 : VENUE.upperGap); }
  rowY(r) {
    const F = VENUE;
    return F.rowY + r * F.rake + Math.max(0, r - F.upper + 1) * F.upperRake;
  }
  rowHalfW(r) { return VENUE.halfW + r * VENUE.spread; }

  // One deterministic pass over every seat in the house. Positions, colours
  // and phases live in flat arrays; the frame loop then only has to do the
  // cheap, time-dependent part.
  buildSeats() {
    const F = VENUE;
    const counts = new Int32Array(this.rows);
    const start = new Int32Array(this.rows + 1);
    let total = 0;
    for (let r = 0; r < this.rows; r++) {
      counts[r] = Math.max(10, Math.round((2 * this.rowHalfW(r)) / F.pitch));
      start[r] = total;
      total += counts[r];
    }
    start[this.rows] = total;
    this.counts = counts;
    this.start = start;
    this.total = total;
    const f = (n) => new Float32Array(n);
    this.sx = f(total); this.sy = f(total); this.sz = f(total);
    this.phase = f(total); this.warm = f(total); this.bone = f(total);
    this.depth = f(total); this.side = f(total); this.vary = f(total);
    this.aisle = new Uint8Array(total);

    for (let r = 0; r < this.rows; r++) {
      const n = counts[r], hw = this.rowHalfW(r), y0 = this.rowY(r), z0 = this.rowZ(r);
      for (let i = 0; i < n; i++) {
        const k = start[r] + i;
        const h1 = hash(r * 31.7 + i * 7.13 + this.seed);
        const h2 = hash(r * 13.3 + i * 3.71 + this.seed * 1.7);
        const h3 = hash(r * 5.7 + i * 2.31 + this.seed * 2.3);
        const h4 = hash(r * 41.1 + i * 11.7 + this.seed * 3.1);
        const u = (i + 0.5 + (h1 - 0.5) * 0.8) / n - 0.5;   // -0.5 .. 0.5
        const tt = u * 2;                                    // -1 .. 1
        this.sx[k] = tt * hw;
        this.sy[k] = y0 + F.curveY * tt * tt * (0.35 + 0.65 * (r / this.rows)) + (h2 - 0.5) * 0.06;
        this.sz[k] = z0 - F.curve * tt * tt + (h3 - 0.5) * 0.26;
        this.phase[k] = h1 * TAU;
        this.warm[k] = h2; this.bone[k] = h3; this.depth[k] = h4;
        this.side[k] = i % 2 ? 1 : -1;
        this.vary[k] = 0.9 + 0.2 * h4;
        let aisle = 0;
        for (const a of F.aisles) if (Math.abs(u - a) < F.aisleHalf) aisle = 1;
        this.aisle[k] = aisle;
      }
    }
  }

  // Where a light sits in the room, and what colour it burns. Pure math: no
  // state, so the same seat is the same light in every frame.
  seat(r, i) {
    const rr = Math.max(0, Math.min(this.rows - 1, r | 0));
    const k = this.start[rr] + Math.max(0, Math.min(this.counts[rr] - 1, i | 0));
    return {
      x: this.sx[k], y: this.sy[k], z: this.sz[k], phase: this.phase[k],
      warm: this.warm[k], bone: this.bone[k], depth: this.depth[k],
      side: this.side[k], aisle: !!this.aisle[k],
    };
  }

  // Where that person's light burns when the arm is up -- the point the
  // finale's pixel cloud lands on when her body is handed to the audience.
  lightAt(r, i) {
    const s = this.seat(r, i);
    return [s.x + s.side * 0.27, s.y + VENUE.shoulder + 0.62, s.z];
  }

  // --- the camera ----------------------------------------------------------
  // A view from inside the audience. `eye` and `at` are metres; the returned
  // vanishing point (screen pixels) lets a 2D layer line itself up with the
  // room's perspective.
  view(eye, at, { fov = 0.98, aspect = 1920 / 1080, near = 0.5, far = 900 } = {}) {
    camera(this.vp, { eye, at, fov, near, far, aspect });
    // the beams are billboarded against the eye that is looking at them
    this.eye = eye;
    return this.vp;
  }

  // The point every line running down the room's axis converges on.
  vanish(W = 1920, H = 1080) {
    const p = project(this.vp, [0, 0, -900], W, H);
    return [p[0] / W, p[1] / H];
  }

  // The big screen's corners, in screen pixels -- so a 2D picture can be laid
  // exactly onto the 3D frame the room draws.
  screenRect(W = 1920, H = 1080) {
    const z = VENUE.screenZ, hw = VENUE.stageHalfW, y = VENUE.screenY, hh = VENUE.screenH;
    const tl = project(this.vp, [-hw, y + hh, z], W, H);
    const br = project(this.vp, [hw, y - hh, z], W, H);
    return [tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]];
  }

  // --- draw ----------------------------------------------------------------
  // rowLit: Float32Array(rows) of 0..1, how lit each row of the audience is.
  // rowArm: the same, but for how high each row holds its light.
  // warm:   0 = the crowd is teal, 1 = the crowd burns amber.
  // house:  the working lights, from 0 (a dark house) to 1 (cleaning lights).
  frame(out, {
    t = 0, rowLit = null, rowArm = null, energy = 1, warm = 0,
    structure = 1, lightsAlpha = 1, stage = 1, house = 0,
    wave = 0, wavePhase = 0, crowd = 1, haze = 0.8, beam = 0,
    rowEcho = null,
    // The anamorphic voice line (step 67). `seatGain` is one value per seat,
    // in 0..1: is this hand holding the trace? `seatLift` is the same array's
    // partner in metres: how far that arm has moved from its held position.
    // `seatQuiet` is 1 for every seat the writing head has already passed:
    // behind the pen the house goes quiet, and only the line keeps burning.
    // `trace` is the whole effect, off at 0; `traceFloor` is how much of the
    // written house stays lit; `writeHead` is HEAD-01, scaled to the house.
    seatGain = null, seatRim = null, seatLift = null, seatQuiet = null,
    trace = 0, traceFloor = 0, writeHead = null,
  } = {}) {
    const W = this.ctx.W, H = this.ctx.H;

    // How tall is one person in this row, in pixels? Rows below a couple of
    // pixels are drawn as light only -- their bodies cannot be seen anyway, and
    // this is what keeps ten thousand of them cheap.
    let lit = 0;
    for (let r = 0; r < this.rows; r++) {
      const a = project(this.vp, [0, this.rowY(r), this.rowZ(r)], W, H);
      const b = project(this.vp, [0, this.rowY(r) + 0.9, this.rowZ(r)], W, H);
      const px = Math.abs(a[1] - b[1]);
      this.rowPix[r] = Number.isFinite(px) ? px : 0;
      if ((rowLit ? rowLit[r] : 1) > 0.02) lit++;
    }
    this.litRows = lit;

    this.facePass(out, { structure, stage, house });
    this.roomPass(out, { structure, stage, house, t, rowEcho });
    this.lightPass(out, {
      t, rowLit, rowArm, energy, warm, lightsAlpha, wave, wavePhase, haze,
      seatGain, seatRim, seatLift, seatQuiet, trace, traceFloor,
    });
    if (crowd > 0.001) this.crowdPass(out, { t, rowLit, rowArm, crowd, house, haze });
    if (writeHead && writeHead.amount > 0.002) this.writeHeadPass(out, writeHead);
    if (beam > 0.002) this.beamPass(out, { t, beam, warm });
  }

  // ---- HEAD-01, scaled to the house (step 67) ---------------------------
  // The same machine that printed her at 0:26 is replayed at the house's own
  // scale: one vertical bar, 1.70 s, left to right -- the identical rate and
  // the identical direction as `birth`. Behind it the audience is quiet; the
  // hands it has passed are the only ones still burning, and they are holding
  // her voice. The gantry rails and the 48-cell ledger are the same ledger
  // `birth` and `erode` write into, scaled up until a seat is one cell.
  writeHeadPass(out, { x = 0, x0 = null, x1 = null, z = 0, amount = 1 } = {}) {
    const F = VENUE;
    const bx = x;
    const zMid = z || (this.rowZ(0) + this.rowZ(this.rows - 1)) / 2;
    const y0 = 0.25, y1 = F.ceiling - 2.4;
    const a0 = x0 == null ? bx : x0, a1 = x1 == null ? bx : x1;
    const span = Math.max(1e-3, a1 - a0);
    const u = clamp01((bx - a0) / span);
    const BO = rgb("bone"), HI = rgb("mikuHi"), MI = rgb("miku");
    const a = clamp01(amount);

    // the print head: one vertical bar, floor to truss, standing in the bowl
    let n = writeInstance(this.scanBarData, 0, {
      p: [bx, (y0 + y1) / 2, zMid], s: 1, c: BO,
      a: 0.42 * a,
      scale: [0.05, (y1 - y0) / 2, 1],
      r: [0, 0, 0],
    });
    this.scanBar.update(this.scanBarData, n)
      .render(out, { vp: this.vp, opacity: 1, soft: 0.40 });

    // the gantry that carries it, and the 48-cell ledger it leaves behind
    let m = 0;
    const seg = (p0, p1, c, alpha, w = 1) => {
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
      const L = Math.hypot(dx, dy, dz);
      if (L < 1e-4 || m + 16 > this.scanRigData.length) return;
      m = writeInstance(this.scanRigData, m, {
        p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2],
        c, a: alpha, s: 1,
        r: [-Math.asin(Math.max(-1, Math.min(1, dz / L))), 0, Math.atan2(-dx, dy)],
        scale: [w, L / 2, 1],
      });
    };
    // the head itself: a bright spine, and the two arms that carry it
    seg([bx, y0, zMid], [bx, y1, zMid], HI, 0.34 * a, 0.05);
    const railY = y1 + 0.55;
    seg([a0 - 0.4, railY, zMid], [a1 + 0.4, railY, zMid], MI, 0.20 * a, 0.035);
    seg([bx, y1, zMid], [bx, railY, zMid], HI, 0.30 * a, 0.04);
    // 48 cells, one per 0.042 m of the head's travel in `erode` -- here the
    // travel is the width of the picture, and the cells behind the pen are lit
    for (let i = 0; i < 48; i++) {
      const cu = i / 47;
      const cx = a0 + span * cu;
      const lit = cu <= u ? 1 : 0.22;
      seg([cx, railY + 0.10, zMid], [cx, railY + 0.34, zMid],
        i % 8 === 0 ? BO : MI, 0.24 * a * lit, 0.028);
    }
    this.scanRig.update(this.scanRigData, m)
      .render(out, { vp: this.vp, opacity: 1, soft: 0.35 });
  }

  // ---- the audience: ten thousand penlights, in world space
  lightPass(out, {
    t, rowLit, rowArm, energy, warm, lightsAlpha, wave, wavePhase, haze = 0.8,
    seatGain = null, seatRim = null, seatLift = null, seatQuiet = null,
    trace = 0, traceFloor = 0,
  }) {
    const F = VENUE;
    const AM = rgb("amber"), BO = rgb("bone"), MI = rgb("miku"), HI = rgb("mikuHi");
    let n = 0;
    for (let r = 0; r < this.rows; r++) {
      const row = rowLit ? rowLit[r] : 1;
      const base = rowArm == null ? 1 : (typeof rowArm === "number" ? rowArm : rowArm[r]);
      const near = (r + 1) / this.rows;
      // Distance haze: the far side of the bowl recedes into the room's own
      // air, the first rows hold their light. The house is ten thousand lamps
      // spread over 60 m of depth, and without this they are one flat band.
      const dist = Math.max(0, this.rowZ(r) - VENUE.rowZ);
      const air = Math.exp(-(dist / 58) * haze);
      const bright = (0.45 + 0.55 * Math.pow(near, 0.5)) * air;
      const arms = this.rowPix[r] > 5.0;
      const w = 0.022 + 0.016 * near;
      for (let i = 0; i < this.counts[r]; i++) {
        const k = this.start[r] + i;
        if (this.aisle[k]) continue;
        const x = this.sx[k], y = this.sy[k], z = this.sz[k], ph = this.phase[k];
        const swing = Math.sin(t * 2.1 - x * 0.045 + ph) * 0.13 * energy;
        const bob = Math.sin(t * 1.63 + ph * 1.7) * 0.05 * energy;
        // the swell: a wave of raised arms travelling through the house,
        // delayed row by row so it reads as one movement, not a flicker
        let up = clamp01(base);
        if (wave > 0.001) {
          const c = Math.cos(TAU * (x * 0.011 + r * 0.055 - wavePhase));
          up = clamp01(up + wave * Math.pow(Math.max(0, c), 5) * 0.75);
        }
        // The one viewpoint: from the eye the walk-around ends on, these ten
        // thousand lights are one line -- her waveform, held up by hands.
        // Everywhere else they are a crowd. `pw` is 1 on a hand that is on the
        // trace, 0 for the rest of the house; `pm` is how much of the effect
        // is on this frame -- zero for almost every frame of the film.
        let pw = 0, pr = 0, pm = 0;
        if (seatGain && trace > 0.002) {
          pw = seatGain[k];
          pr = seatRim ? seatRim[k] : 0;
          pm = trace;
        }
        // the arm's own solve, in metres: this is what draws the line
        const lift = seatLift ? seatLift[k] : 0;
        const side = this.side[k];
        // While the house is holding the trace, ten thousand people are
        // perfectly still: no sway, no bob, no crowd arm. Stillness is the
        // instrument -- it is what lets a solved hand land on the row it was
        // solved for, to the pixel.
        const hx = seatLift ? x + side * 0.15 : x + swing + side * (0.15 + 0.12 * up);
        const hy = seatLift
          ? y + F.shoulder + 0.22 + lift
          : y + F.shoulder + 0.22 + bob + 0.46 * up + lift;
        const warmSeat = this.warm[k] < 0.24 + warm * 0.30;
        const boneSeat = !warmSeat && this.bone[k] < 0.055;
        let c = warmSeat ? AM : boneSeat ? BO : (this.depth[k] < 0.2 ? HI : MI);
        if (pm > 0.30 && pw > 0.60) c = HI;
        if (pm > 0.30 && pr > 0.45) c = BO;
        if (pm > 0.30 && pw > 0.20 && pw <= 0.60) c = MI;
        const flickBase = 0.62 + 0.38 * Math.sin(t * 3.1 + ph * 2.0);
        // on the line the house stops flickering: a trace that shimmers is
        // noise again
        const flick = flickBase * (1 - 0.85 * pm) + 0.95 * (0.85 * pm);
        let a = row * bright * (warmSeat ? 1.0 : 0.72) * flick * lightsAlpha;
        // The trace does not add light: it takes the house down and gives it
        // back to the hands that are on the line. Ten thousand lamps, and only
        // the ones holding her voice are burning -- and only *behind the pen*:
        // the quiet travels with the writing head, one column at a time.
        if (seatGain && trace > 0.002) {
          const on = sstep(0.12, 0.85, pw);
          const floor = Math.max(0, Math.min(1, traceFloor));
          const q = seatQuiet ? seatQuiet[k] * trace : 0;
          a *= 1 - q * (1 - (floor + (1 - floor) * on));
        }
        // v14: the trace has to stay countable. The first pass doubled every
        // light on the line and gave it a wide halo; 465 of them fused into a
        // solid band and the contour disappeared inside its own glow. The
        // line is still the only thing burning after the pen, but it is made
        // of lamps again, not of a wash.
        if (pm > 0.30 && pr > 0.45) a *= 1.55;
        // the hand that is holding the line is the only one burning
        if (pm > 0.30 && pw > 0.60) a *= 1.45;
        if (a > 0.002) {
          // on the trace the pen itself is thinner: 8,000 of them have to read
          // as a line, not as a wall of light
          const thin = seatLift ? 0.62 : 1;
          n = writeInstance(this.lightData, n, {
            p: [hx, hy, z],
            s: 1,
            c,
            a: clamp01(a),
            r: [0, 0, side * 0.12 + swing * 0.5],
            scale: [w * this.vary[k], thin * (0.070 + 0.030 * up) * (0.85 + 0.3 * this.vary[k]), 1],
          });
          // and a halo: one penlight is ten centimetres of light, so the trace
          // gets a second one to be readable from the back of the house
          if (pm > 0.35 && pw > 0.20) {
            const pen = pw > 0.60;
            n = writeInstance(this.lightData, n, {
              p: [hx, hy, z], s: 1, c: pen ? HI : MI,
              a: clamp01(a * (pen ? 0.12 : 0.07)),
              r: [0, 0, side * 0.12 + swing * 0.5],
              scale: pen
                ? [w * 1.30, 0.030 + 0.020 * up, 1]
                : [w * 1.05, 0.024 + 0.014 * up, 1],
            });
          }
        }
        if (arms && row > 0.05 && a > 0.02) {
          // the arm holding it: a hairline from the shoulder to the light
          const ax = x + swing - side * 0.16;
          const ay = y + F.shoulder + bob * 0.5;
          const dx = hx - ax, dy = hy - ay;
          const len = Math.hypot(dx, dy) || 1;
          n = writeInstance(this.lightData, n, {
            p: [(ax + hx) / 2, (ay + hy) / 2, z],
            s: 1, c: MI,
            // while the house is holding the trace the arms go almost dark:
            // 7,000 additive hairlines are a wall of light if they are not
            // held back, and the line has to be the only thing burning
            a: (0.035 + 0.055 * clamp01(a)) * (0.4 + 0.6 * up) * (seatLift ? 0.28 : 1),
            r: [0, 0, Math.atan2(-dx, dy)],
            scale: [0.012, len / 2, 1],
          });
        }
      }
    }

    // the rig: moving heads hanging over the stage, and the blinders on the
    // back truss -- the only lights in the frame nobody is holding
    const rigY = F.ceiling - 4.6, rigZ = F.stageZ + 4.0;
    for (let i = 0; i < 24; i++) {
      const x = ((i + 0.5) / 24 - 0.5) * 2 * (F.stageHalfW + 4);
      const sweep = Math.sin(t * 0.37 + i * 0.83);
      const a = (0.16 + 0.60 * Math.max(0, sweep)) * lightsAlpha;
      n = writeInstance(this.lightData, n, {
        p: [x, rigY, rigZ], s: 1, c: i % 6 === 0 ? AM : HI,
        a, scale: [0.055, 0.075, 1],
      });
    }
    const backZ = this.rowZ(this.rows - 1) + 7, backY = F.ceiling - 2.5;
    for (let i = 0; i < 11; i++) {
      const x = ((i + 0.5) / 11 - 0.5) * 2 * (F.halfW + 6);
      const flash = 0.25 + 0.75 * Math.max(0, Math.sin(t * 6.2 - i * 0.9));
      n = writeInstance(this.lightData, n, {
        p: [x, backY, backZ], s: 1, c: BO, a: flash * 0.5 * lightsAlpha,
        scale: [0.05, 0.10, 1],
      });
    }
    // soft: a penlight has a glow, not an edge -- the rod is a shape in world
    // space, but the thing you actually see is light
    this.lights.update(this.lightData, n)
      .render(out, { vp: this.vp, opacity: 1, soft: 0.85 });
  }

  // ---- the bodies: dark heads and shoulders, multiplied into the picture
  // This is the pass that makes the house read as people. It runs after the
  // lights, so a row in front of the lens carves its silhouette out of every
  // light behind it.
  crowdPass(out, { t, rowLit, rowArm, crowd, house, haze = 0.8 }) {
    const F = VENUE;
    const INK = rgb("ink");
    let n = 0;
    for (let r = 0; r < this.rows; r++) {
      const pix = this.rowPix[r];
      if (pix < 1.7) continue;
      const row = rowLit ? rowLit[r] : 1;
      const base = rowArm == null ? 1 : (typeof rowArm === "number" ? rowArm : rowArm[r]);
      const near = (r + 1) / this.rows;
      // The front of the house is the darkest: it is backlit by the stage and
      // it is the part that blocks the picture. The alpha has to stay small --
      // thirty rows of shoulders stack up along the same line of sight, and a
      // crowd is a shadow with lights in it, not a wall.
      const dist = Math.max(0, this.rowZ(r) - VENUE.rowZ);
      const air = Math.exp(-(dist / 58) * haze);
      const dark = (0.10 + 0.26 * Math.pow(near, 0.9)) * crowd * (1 - 0.55 * house) * (0.35 + 0.65 * air);
      const thin = Math.min(1, Math.max(0.35, pix / 14));
      for (let i = 0; i < this.counts[r]; i++) {
        const k = this.start[r] + i;
        if (this.aisle[k]) continue;
        const x = this.sx[k], y = this.sy[k], z = this.sz[k], ph = this.phase[k];
        const bob = Math.sin(t * 1.63 + ph * 1.7) * 0.05;
        const sway = Math.sin(t * 2.1 - x * 0.045 + ph) * 0.10;
        n = writeInstance(this.bodyData, n, {
          p: [x + sway, y + F.shoulder + bob, z],
          s: 0.30 * this.vary[k] * (0.94 + 0.10 * base),
          c: INK,
          a: clamp01(dark * (0.30 + 0.70 * row) * thin),
          r: [0, 0, sway * 0.35],
          scale: [1 + 0.06 * base, 1, 1],
        });
      }
    }
    this.crowd.update(this.bodyData, n)
      .render(out, { vp: this.vp, opacity: 1, mode: "multiply", clearAlpha: 0, premul: true });
  }

  // ---- the air under the truss: the beams themselves
  // A concert is legible from the back of the house only if you can see what
  // the light is doing on its way down. These are 14 long, soft, additive
  // quads hanging from the rig to the stage floor, billboarded to the eye that
  // called `view()`: cheap, and enough to give the room a ceiling.
  beamPass(out, { t, beam, warm }) {
    const F = VENUE;
    const eye = this.eye || [0, 8, 60];
    const AM = rgb("amber"), HI = rgb("mikuHi");
    const rigY = F.ceiling - 4.6;
    let n = 0;
    for (let i = 0; i < 14; i++) {
      const u = (i + 0.5) / 14;
      const x = (u - 0.5) * 2 * (F.stageHalfW + 3.5);
      const z0 = F.stageZ + 3.0, z1 = F.stageZ - 1.6;
      const zc = (z0 + z1) / 2;
      const dx = x - eye[0], dz = zc - eye[2];
      // the quad's normal faces the eye; both vectors are horizontal, so one
      // yaw is enough
      const ry = Math.atan2(dx, dz);
      const col = warm > u ? AM : HI;
      const sway = Math.sin(t * 0.31 + i * 1.31);
      const len = rigY - F.rowY - 0.2;
      const a = beam * (0.020 + 0.030 * Math.max(0, sway)) * (0.65 + 0.35 * Math.sin(t * 2.4 + i));
      n = writeInstance(this.beamData, n, {
        p: [x, F.rowY + len / 2, zc],
        s: 1, c: col, a: clamp01(a),
        r: [0, ry, 0],
        scale: [(0.55 + 0.25 * ((i % 3) / 3)) * (1 + 0.25 * Math.abs(sway)), len / 2, 1],
      });
    }
    this.beams.update(this.beamData, n)
      .render(out, { vp: this.vp, opacity: 1, soft: 0.9 });
  }

  // ---- the room: rails, aisles, truss, walls
  // `rowEcho` is the room's own impulse response, one value per row: when the
  // house is empty, the architecture is the only thing left that can answer.
  // It lights the row's lip and its aisle steps -- structure, not penlights --
  // so the room rings without pretending an audience came back.
  roomPass(out, { structure, stage, house, t, rowEcho = null }) {
    const F = VENUE;
    const MI = rgb("miku"), HI = rgb("mikuHi"), BO = rgb("bone"), DEEP = rgb("tealDeep");
    const lit = structure * (0.55 + 0.45 * (1 - house));
    let m = 0;
    const seg = (p0, p1, c, a, w = 1) => {
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
      const L = Math.hypot(dx, dy, dz);
      if (L < 1e-4 || m + 16 > this.roomData.length) return;
      m = writeInstance(this.roomData, m, {
        p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2],
        c, a, s: 1,
        r: [-Math.asin(Math.max(-1, Math.min(1, dz / L))), 0, Math.atan2(-dx, dy)],
        scale: [w, L / 2, 1],
      });
    };
    // the lip of every row: six chords following the bowl's curve
    for (let r = 0; r < this.rows; r++) {
      const hw = this.rowHalfW(r), y = this.rowY(r) - 0.14, z = this.rowZ(r);
      const ex = rowEcho ? Math.max(0, rowEcho[r]) : 0;
      const a = (0.035 + 0.05 * (r / this.rows)) * lit + 0.85 * ex;
      const lip = ex > 0.08 ? BO : MI;
      const N = 6;
      const at = (u) => [u * hw, y + F.curveY * u * u, z - F.curve * u * u];
      for (let s = 0; s < N; s++) {
        seg(at(-1 + (2 * s) / N), at(-1 + (2 * (s + 1)) / N), lip, a);
      }
      // the aisle steps between this row and the one behind it
      if (r) {
        const z1 = this.rowZ(r - 1), y1 = this.rowY(r - 1) - 0.14;
        for (const au of F.aisles) {
          const x0 = au * 2 * hw, x1 = au * 2 * this.rowHalfW(r - 1);
          seg([x0, y, z], [x1, y1, z1], ex > 0.08 ? BO : MI, 0.05 * lit + 0.40 * ex);
        }
      }
    }
    // the bowl's silhouette: where the seating meets the wall, left and right,
    // which is what gives the room its shape from the inside
    for (const s of [-1, 1]) {
      let prev = null;
      for (let r = 0; r < this.rows; r += 2) {
        const hw = this.rowHalfW(r);
        const p = [s * hw, this.rowY(r) + F.curveY + 0.3, this.rowZ(r) - F.curve];
        if (prev) seg(prev, p, MI, 0.10 * lit);
        prev = p;
      }
    }
    // the walkway between tiers: a rail across the room, with its posts
    {
      const r = F.upper - 1;
      const hw = this.rowHalfW(r), y = this.rowY(r) + 1.25, z = this.rowZ(r);
      const at = (u) => [u * hw, y + F.curveY * u * u, z - F.curve * u * u];
      for (let s = 0; s < 8; s++) {
        seg(at(-1 + (2 * s) / 8), at(-1 + (2 * (s + 1)) / 8), BO, 0.13 * lit);
      }
      for (let i = -4; i <= 4; i++) {
        const p = at(i / 4);
        seg(p, [p[0], p[1] - 1.2, p[2]], MI, 0.07 * lit);
      }
    }
    // the roof: cross beams, five runs down the room, and the columns
    const span = this.rowHalfW(this.rows - 1) + 5;
    for (let i = 0; i < 8; i++) {
      const z = -10 + i * 12;
      seg([-span, F.ceiling, z], [span, F.ceiling, z], MI, 0.055 * lit);
    }
    for (const x of [-span, -span / 2, 0, span / 2, span]) {
      seg([x, F.ceiling, -12], [x, F.ceiling, this.rowZ(this.rows - 1) + 10], MI, 0.05 * lit);
    }
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const z = -8 + i * 15;
        seg([s * span, 0, z], [s * span, F.ceiling, z], MI, 0.05 * lit);
      }
      seg([s * span, F.ceiling * 0.62, -14],
        [s * span, F.ceiling * 0.62, this.rowZ(this.rows - 1) + 12], BO, 0.045 * lit);
    }
    // the truss over the stage: two chords, braces, and the towers holding it
    {
      const y = F.ceiling - 4.6, z = F.stageZ + 4;
      const hw = F.stageHalfW + 4;
      for (const dy of [0, -1.1]) seg([-hw, y + dy, z], [hw, y + dy, z], MI, 0.14 * lit);
      for (let i = 0; i < 16; i++) {
        const x0 = -hw + (2 * hw * i) / 16, x1 = -hw + (2 * hw * (i + 1)) / 16;
        seg([x0, y, z], [x1, y - 1.1, z], MI, 0.06 * lit);
      }
      seg([-hw, y, z], [-hw, y, z + 6], MI, 0.10 * lit);
      seg([hw, y, z], [hw, y, z + 6], MI, 0.10 * lit);
    }
    // the stage: a lip, a downstage edge, monitor wedges, and the sides
    {
      const z = F.stageZ + F.stageHalfD, y = 1.15;
      seg([-F.stageHalfW, y, z], [F.stageHalfW, y, z], HI, 0.42 * stage);
      seg([-F.stageHalfW, y - 0.9, z], [F.stageHalfW, y - 0.9, z], MI, 0.12 * stage);
      seg([-F.stageHalfW, y, z - 1.2], [-F.stageHalfW, y, z], MI, 0.08 * stage);
      seg([F.stageHalfW, y, z - 1.2], [F.stageHalfW, y, z], MI, 0.08 * stage);
      for (const x of [-8, -3, 3, 8]) {
        seg([x, y + 0.55, z - 1.1], [x, y + 0.55, z - 0.2], MI, 0.10 * stage);
      }
    }
    // the screen: a frame around it, and the hanging side screens
    {
      const z = F.screenZ, hw = F.stageHalfW, y = F.screenY, hh = F.screenH;
      const a = 0.12 * stage;
      seg([-hw, y + hh, z], [hw, y + hh, z], BO, a);
      seg([-hw, y - hh, z], [hw, y - hh, z], BO, a);
      seg([-hw, y - hh, z], [-hw, y + hh, z], BO, a);
      seg([hw, y - hh, z], [hw, y + hh, z], BO, a);
      for (const s of [-1, 1]) {
        const x = s * (hw + 3.2);
        seg([x, y + hh, z], [x, y - hh, z], MI, 0.13 * stage);
        seg([x, y + hh, z], [x + s * 2.4, y + hh - 0.8, z], MI, 0.08 * stage);
      }
    }
    // the PA: a stack either side of the stage, with its drivers
    for (const s of [-1, 1]) {
      const x = s * (F.stageHalfW + 3.4), z = F.stageZ + 2.4, top = 9.5, bot = 0.4;
      seg([x - 1.5, top, z], [x + 1.5, top, z], MI, 0.20 * stage);
      seg([x - 1.5, bot, z], [x + 1.5, bot, z], MI, 0.16 * stage);
      seg([x - 1.5, bot, z], [x - 1.5, top, z], MI, 0.16 * stage);
      seg([x + 1.5, bot, z], [x + 1.5, top, z], MI, 0.16 * stage);
      for (const y of [2.2, 4.4, 6.6, 8.4]) seg([x - 1.5, y, z], [x + 1.5, y, z], MI, 0.10 * stage);
      seg([x, top, z], [x + s * 2.5, F.ceiling - 3.5, z + 1], BO, 0.07 * stage);
    }
    void DEEP; void t;
    this.room.update(this.roomData, m).render(out, { vp: this.vp, opacity: 1 });
  }

  // ---- the stage: filled shapes only, all of them nearly black
  facePass(out, { structure, stage, house }) {
    const F = VENUE;
    const DEEP = rgb("tealDeep"), INK = rgb("ink");
    let k = 0;
    // the floor between the stage and the first row of the bowl
    k = writeInstance(this.faceData, k, {
      p: [0, 0.02, (F.stageZ + F.rowZ) / 2], s: 1, c: DEEP,
      a: (0.10 + 0.30 * house) * structure,
      r: [-Math.PI / 2, 0, 0],
      scale: [F.stageHalfW + 10, (F.rowZ - F.stageZ) / 2 + 6, 1],
    });
    // the stage platform
    k = writeInstance(this.faceData, k, {
      p: [0, 1.1, F.stageZ], s: 1, c: DEEP,
      a: (0.14 + 0.22 * house) * stage,
      r: [-Math.PI / 2, 0, 0],
      scale: [F.stageHalfW, F.stageHalfD, 1],
    });
    // the big screen, then the side screens, then the black upstage wall
    k = writeInstance(this.faceData, k, {
      p: [0, F.screenY, F.screenZ], s: 1, c: DEEP, a: 0.30 * stage,
      scale: [F.stageHalfW, F.screenH, 1],
    });
    for (const s of [-1, 1]) {
      k = writeInstance(this.faceData, k, {
        p: [s * (F.stageHalfW + 3.2), F.screenY - 0.4, F.screenZ], s: 1, c: DEEP,
        a: 0.16 * stage, scale: [1.2, F.screenH * 0.8, 1],
      });
    }
    k = writeInstance(this.faceData, k, {
      p: [0, F.ceiling / 2, F.screenZ - 3], s: 1, c: INK,
      a: 0.55, scale: [F.stageHalfW + 8, F.ceiling / 2, 1],
    });
    // the PA stacks, as solid boxes
    for (const s of [-1, 1]) {
      k = writeInstance(this.faceData, k, {
        p: [s * (F.stageHalfW + 3.4), 5.0, F.stageZ + 2.4], s: 1, c: INK,
        a: 0.40, scale: [1.5, 4.5, 1],
      });
    }
    // the walls, barely there: enough to close the room without lighting it
    for (const s of [-1, 1]) {
      k = writeInstance(this.faceData, k, {
        p: [s * (this.rowHalfW(this.rows - 1) + 5), F.ceiling / 2, 16], s: 1, c: INK,
        a: 0.30 + 0.25 * house, r: [0, s * -Math.PI / 2, 0],
        scale: [40, F.ceiling / 2, 1],
      });
    }
    this.face.update(this.faceData, k).render(out, { vp: this.vp, opacity: 1 });
  }

  dispose() {
    this.lights.dispose();
    this.room.dispose();
    this.face.dispose();
    this.crowd.dispose();
    this.beams.dispose();
    this.scanBar.dispose();
    this.scanRig.dispose();
  }
}

// The rig above the room: a handful of spotlights hanging in haze, all of them
// pointed at the same place on the stage. Drawn in 2D, on top of the room --
// it is the air, not the architecture.
export function spotRig(ctx, {
  t = 0, x = 960, y = 660, alpha = 1, warm = 0.4, energy = 1, count = 7, spread = 0.86,
} = {}) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 4; i++) {
    const hy = 150 + i * 160;
    const g = ctx.createLinearGradient(0, hy - 80, 0, hy + 80);
    g.addColorStop(0, css("tealDeep", 0));
    g.addColorStop(0.5, css("tealDeep", 0.11 - i * 0.018));
    g.addColorStop(1, css("tealDeep", 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, hy - 80, 1920, 160);
  }
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    const sx = 960 + (u - 0.5) * 1920 * spread;
    const sway = Math.sin(t * 0.33 + i * 1.7) * 28;
    const tx = x + (sx - x) * 0.32 + sway;
    const col = warm > u ? "amber" : "mikuHi";
    const g = ctx.createLinearGradient(sx, 0, tx, y);
    const amt = (0.05 + 0.08 * energy) * (0.7 + 0.5 * Math.sin(t * 0.21 + i));
    g.addColorStop(0, css(col, Math.max(0, amt)));
    g.addColorStop(1, css(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx - 22, 0);
    ctx.lineTo(sx + 22, 0);
    ctx.lineTo(tx + 220, y + 70);
    ctx.lineTo(tx - 220, y + 70);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
