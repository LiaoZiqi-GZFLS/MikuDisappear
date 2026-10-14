// 4:43.69 - the record is still open.
//
// The film's last place is not a black frame. It is the archive the record was
// kept in: two walls of cold-storage cells running 58 m into the dark, 400
// records in all. A gantry sweeps the corridor from the moment the voice stops
// and stamps a red deletion cross on every cell it passes. The one cell it does
// not stamp is hers -- it slows down, reads it, marks it HELD, and moves on.
//
// Her afterimage is not drawn: it is *written* on the glass by a read head and
// then decays, strand by strand, at the rate each strand's phosphor holds.
// Persistence of vision becomes a measurable quantity, which is the only way
// this film is allowed to say goodbye. The three languages are cut into the
// same pane of glass, in the room's own perspective.
//
// The credits' last row is lit by the only warm thing in the hall: a seat at
// the far end that is still occupied. Nothing else in the archive is warm,
// because nothing else in the archive is being watched.
//
// Every number in the chapter counts geometry that is on screen (400 records,
// 399 crossed out, 1 held), and the clock keeps running after the recording
// stops -- nobody in the film stops it.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { Stage3D, camera, mat4, project, rgb, writeInstance } from "../gl3d.js";
import { css } from "../palette.js";
import { clamp, hash, label, smoothstep } from "../kit.js";
import { FILM_TAIL } from "../timeline.js";
import { draw as drawText, timecode } from "../type.js";
import { audioU, layer } from "./util.js";

const START = 283.69;      // 4:43.69, the last silence of the song
const SONG_END = 286.72;   // 4:46.72, the moment the recording stops
// The chapter runs FILM_TAIL seconds past the song, so its own clock ends here.
const END = FILM_TAIL + (SONG_END - START);   // 11.63 local = 4:55.32

// ---- the archive ----------------------------------------------------------
// One cell is 1.24 m wide (along the corridor) and 1.76 m tall -- a tape on a
// shelf -- on a wall 9.24 m across from the other wall. The corridor is 40
// bays deep and 58 m long: 40 x 5 x 2 = 400 records.
const HALL = {
  bays: 40, dz: 1.24, z0: 3.60,
  halfW: 4.62, slots: 5, y0: 1.15, dy: 1.92,
  halfD: 0.62, halfH: 0.88,
  ceil: 10.40,
  endZ: -52,
};
const RECORDS = HALL.bays * HALL.slots * 2;
// The one record the sweep leaves alone: bay 2, middle of the wall, left side,
// which is where the lens is standing when the chapter opens.
const HELD = { bay: 2, slot: 2, side: -1 };
// The word is cut across the held cell and its two neighbours: a 4.14 m pane
// of wall, wide enough for three scripts, ruled in the room's own perspective.
const BAND = { halfD: HALL.dz + HALL.halfD };
// One seat at the end of the corridor. It is not a record, so the sweep has
// nothing to stamp there, and its light is the only warm colour in the room.
const SEAT = { x: 1.05, y: 0.62, z: HALL.endZ + 1.4 };

// ---- the sweep ------------------------------------------------------------
// It starts one beat after the voice stops and never leaves the song's grid:
// 240 BPM is 0.25 s, so the gantry takes one bay every half beat and stops for
// exactly three beats at the held record. `sweepBay` is the exact inverse of
// that clock, so the stamps, the counter and the gantry can never disagree --
// and after the sound is gone the machine is still counting in the song's time
// (see docs/短片剧本_残像.md, v7: the 34.4 silent beats).
const BEAT = 0.25;
const SONG_END_LOCAL = SONG_END - START;      // 3.03
const SWEEP = { t0: SONG_END_LOCAL + BEAT, dt: BEAT / 2, dwell: 3 * BEAT };
const stampAt = (bay) => SWEEP.t0 + bay * SWEEP.dt + (bay > HELD.bay ? SWEEP.dwell : 0);
function sweepBay(local) {
  const x = (local - SWEEP.t0) / SWEEP.dt;
  if (x <= 0) return x;
  const dwell = SWEEP.dwell / SWEEP.dt;
  if (x <= HELD.bay) return x;
  if (x <= HELD.bay + dwell) return HELD.bay + (x - HELD.bay) * 0.07;
  return x - dwell * 0.93;
}
function deletedCount(sb) {
  const full = Math.floor(clamp(sb, 0, HALL.bays));
  const n = full * HALL.slots * 2 - (sb > HELD.bay + 0.25 ? 1 : 0);
  return clamp(n, 0, RECORDS - 1);
}

// ---- the afterimage -------------------------------------------------------
// It is written once, top to bottom, in the first two seconds, and then only
// decays. Each strand holds its charge for a different length of time: the
// drawn line lasts, its echoes go first, and the tips go before the roots.
const GHOST = { in: 0.42, peak: 2.10 };
const STRANDS = [
  { dx: 0.020, k: 1.000, alpha: 1.00, tau: 0.92 },
  { dx: 0.065, k: 0.972, alpha: 0.42, tau: 0.58 },
  { dx: 0.118, k: 0.938, alpha: 0.20, tau: 0.34 },
];
const TAIL_N = 34;
const DUST = 120;

// ---- the words ------------------------------------------------------------
// One word, three scripts, on the glass of the held record: あなた -> 你 -> YOU.
// The old language is cut away by the rewrite front, never blended under it.
const WORDS = [
  { text: "\u3042\u306a\u305f", a: 2.55 },
  { text: "\u4f60", a: 3.69 },
  { text: "YOU", a: 4.60 },
];
const PRINT = 0.30;        // the first language prints itself in this long
const REWRITE = 0.44;      // the front crosses the word in this long
// The credits land 13 beats after the voice stops (3.03 + 3.25) and then ride
// the same grid: one row every two beats. The film's last edit is still cut to
// a song that is no longer playing.
const CREDIT_AT = SONG_END_LOCAL + 13 * BEAT;
const CREDIT_STEP = 2 * BEAT;

const FRAG = `
uniform float uT;
uniform float uIn;
uniform float uDel;      // 0 -> 1 as the records are crossed out
uniform float uSeat;     // the one warm light in the hall, 0 -> 1
uniform vec2 uSeatPos;   // where that seat lands on screen (uv)
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 col = C_INK * 0.92;

  // the hall: a cold volume down the corridor, dying as the records are lost
  float d = length(p * vec2(0.72, 1.06));
  col += C_TEAL_DEEP * exp(-pow(d * 1.5, 2.0)) * (0.30 * (1.0 - 0.84 * uDel) + 0.06 * uIn);
  // the floor catching the gantry's light, far back where the machine is
  col += C_TEAL_DEEP * 0.12 * exp(-pow((uv.y - 0.90) * 5.4, 2.0)) * (1.0 - 0.75 * uDel);
  // the machine's hum travelling away from the lens
  float hum = exp(-pow((uv.y - fract(0.14 + uT * 0.021)) * 74.0, 2.0));
  col += C_BONE * hum * 0.010 * (1.0 - uDel);
  // the seat: the only warm thing left, and the last thing to go
  vec2 sv = (uv - uSeatPos) * vec2(uRes.x / uRes.y, 1.0);
  col += C_AMBER * uSeat * 0.085 * exp(-pow(length(sv) * 30.0, 2.0));
  // the record's own floor noise, thin and cold
  float ln = 0.5 + 0.5 * sin(uv.y * 860.0 + uT * 7.0);
  col += C_MIKU * ln * 0.006 * (1.0 - uDel);
  fragColor = vec4(col, 1.0);
}`;

// Cubic bezier on one axis, for the two tails.
function bez(a, b, c, d, u) {
  const v = 1 - u;
  return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
}

// The twin tails, in the held cell's own coordinates. Each strand is a
// polyline of world points with its own charge time and half-life.
function buildTails() {
  const zc = HALL.z0 - HELD.bay * HALL.dz;
  const yc = HALL.y0 + HELD.slot * HALL.dy;
  const xWall = -HALL.halfW;
  const out = [];
  for (const side of [-1, 1]) {
    for (const st of STRANDS) {
      const pts = [];
      for (let i = 0; i <= TAIL_N; i++) {
        const u = i / TAIL_N;
        const gu = bez(side * 0.09, side * 0.50, side * 0.58, side * 0.40, u);
        const gv = bez(0.84, 0.54, -0.14, -0.88, u);
        pts.push({
          p: [xWall + st.dx, yc + gv * HALL.halfH * st.k, zc - gu * HALL.halfD],
          s: clamp((1 - gv) / 1.9),
          at: GHOST.in + clamp((1 - gv) / 1.9) * (GHOST.peak - GHOST.in),
        });
      }
      out.push({ side, st, pts });
    }
  }
  return out;
}

export default class Afterimage extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "afterimage");
    this.vp = mat4();

    // Three draws for the whole set: structure and cell frames are segments,
    // lamps and machine heads are lit faces, the air is points.
    this.lines = new Stage3D(ctx, "segment");
    this.faces = new Stage3D(ctx, "rect");
    this.dust = new Stage3D(ctx, "point");
    this.ghost = new Stage3D(ctx, "point");
    this.lineData = new Float32Array((RECORDS * 6 + 1400) * 16);
    this.faceData = new Float32Array((RECORDS + 80) * 16);
    this.dustData = new Float32Array(DUST * 16);
    this.ghostData = new Float32Array((TAIL_N + 1) * 8 * 16);

    this.tails = buildTails();
    // Where the glass of the held record lands on screen, so text can be
    // printed on it in the room's own perspective.
    this.glass = { ox: 0, oy: 0, ax: 1, ay: 0, bx: 0, by: 1, w: 1, h: 1, ppm: 1 };
  }

  // The lens. Shot 51 is a frontal close-up of the held record; at 4.4 s it
  // backs out and turns until the whole archive is in frame, and the last thing
  // it does is look down the corridor at the one light the sweep cannot touch.
  // After the song the camera breathes: it is a person's eye now, not a reader.
  view(local) {
    // Two moves, not one: the lens backs off the record first (the pane stays
    // centred and shrinks, so the hall is discovered around it), and only when
    // it has arrived does it turn its head down the corridor.
    const pull = smoothstep(4.35, 8.0, local);
    const turn = smoothstep(8.0, 10.6, local);
    const pe = pull * pull * (3 - 2 * pull);
    const te = turn * turn * (3 - 2 * turn);
    const eye = [0.35 + 2.75 * pe, 5.02 + 1.95 * pe, 0.70 + 12.8 * pe];
    const at = [
      -4.60 + 2.95 * te,
      4.99 - 0.72 * te,
      0.70 - 33.0 * te,
    ];
    const hum = smoothstep(SONG_END - START + 0.3, SONG_END - START + 2.8, local);
    eye[0] += 0.05 * hum * Math.sin(local * 1.13);
    eye[1] += 0.045 * hum * Math.sin(local * 0.87 + 1.2);
    at[1] += 0.03 * hum * Math.sin(local * 0.71);
    const fov = 0.46 + 0.39 * pe;
    camera(this.vp, {
      eye, at, fov, near: 0.3, far: 260,
      aspect: this.ctx.W / this.ctx.H,
    });
    return eye;
  }

  render(f, out) {
    const t = f.t;
    const local = t - START;
    const W = this.ctx.W, H = this.ctx.H;

    // the sweep's own clock
    const sb = sweepBay(local);
    const deleted = deletedCount(sb);
    const delU = clamp(deleted / (RECORDS - 1));
    const readOn = smoothstep(0.50, 0.05, Math.abs(sb - HELD.bay));
    const heldOn = smoothstep(HELD.bay + 0.06, HELD.bay + 0.60, sb);
    // The machine reads exactly one record in the whole film, and the number
    // flips on the same frame the gantry reaches it: READ 00001 / UNREAD 08191
    // is the second half of the bookend that opens in `prologue` at 00000.
    // It latches: the ledger records what has been read, not where the gantry
    // happens to be pointing now.
    const readTotal = sb > HELD.bay + 0.25 ? 1 : 0;
    const seatA = 0.30 + 0.70 * smoothstep(6.4, 9.8, local);
    const inU = clamp(local / 0.7);

    const eye = this.view(local);
    const camZ = eye[2];
    const seatP = project(this.vp, [SEAT.x, SEAT.y + 0.98, SEAT.z], W, H);

    this.pass.draw({
      dst: out,
      u: audioU(f, {
        uIn: inU, uDel: delU, uSeat: seatA,
        uSeatPos: [seatP[0] / W, seatP[1] / H],
      }),
    });

    this.build(out, this.vp, local, sb, delU, readOn, heldOn, seatA, camZ, t);

    const c = this.text.ctx;
    this.text.clear();
    c.textBaseline = "alphabetic";

    const endFade = 1 - smoothstep(END - 1.15, END - 0.08, local);
    // The pane's own labels are ruled onto the glass, so they only arrive
    // once the lens has backed off far enough to hold the whole pane: in the
    // opening close-up a clipped "01 / COLD STORAGE" would just read as a
    // broken word, and while the pane still fills the frame that label lands
    // on top of the screen-space readout ledger in the top-left corner.
    const paneLabels = smoothstep(0.34, 0.62, smoothstep(4.35, 8.0, local));
    this.pinGlass(this.vp, W, H);
    this.glassText(c, local, readOn, heldOn, paneLabels);
    this.readout(c, local, deleted, endFade, readTotal);
    this.credits(c, local, endFade);
    this.silentBeat(c, local, endFade);
    this.clock(c, t, local, endFade);

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    return {
      bloom: 1.0,
      exposure: 0.98,
      grain: 0.032,
      vignette: 0.84,
      scan: 0.03,
      ca: 0.0012 + 0.0008 * smoothstep(7.0, 10.5, local),
      fade: smoothstep(END - 0.85, END - 0.02, local),
    };
  }

  // ------------------------------------------------------------------ the set
  // Everything is written fresh each frame from `local`: no state, so any frame
  // of the chapter renders on its own.
  build(out, vp, local, sb, delU, readOn, heldOn, seatA, camZ, t) {
    const LD = this.lineData, FD = this.faceData, DD = this.dustData;
    const MI = rgb("miku"), HI = rgb("mikuHi");
    const BONE = rgb("bone"), DIM = rgb("dim"), RED = rgb("red"), AM = rgb("amber");
    const hw = HALL.halfW;
    let n = 0, k = 0, m = 0;

    // fog: the archive is 58 m deep, and the far end is only a rumour
    const fog = (z, floor = 0.012) =>
      clamp(1 - Math.pow(Math.max(0, camZ - z) / 58, 1.15), floor, 1);

    const seg = (p0, p1, c, a, w = 1) => {
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
      const L = Math.hypot(dx, dy, dz);
      if (L < 1e-4 || a <= 0.002) return;
      n = writeInstance(LD, n, {
        p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2],
        c, a: clamp(a), s: 1,
        r: [-Math.asin(clamp(dz / L, -1, 1)), 0, Math.atan2(-dx, dy)],
        scale: [w, L / 2, 1],
      });
    };

    // ---- the room: floor rails, ceiling, wall posts, one crossbar per bay
    const fy = 0.02, cy = HALL.ceil, zA = HALL.z0 + HALL.dz * 0.5, zB = HALL.endZ;
    for (const s of [-1, 1]) {
      seg([s * hw, fy, zA], [s * hw, fy, zB], MI, 0.16);
      seg([s * hw, cy, zA], [s * hw, cy, zB], MI, 0.10);
      seg([s * hw, fy, zB], [s * hw, cy, zB], MI, 0.10);
    }
    seg([-hw, fy, zB], [hw, fy, zB], MI, 0.14);
    seg([-hw, cy, zB], [hw, cy, zB], MI, 0.09);
    seg([-hw, cy, zA], [-hw, fy, zA], MI, 0.06);
    seg([hw, cy, zA], [hw, fy, zA], MI, 0.06);
    for (let bay = 0; bay < HALL.bays; bay++) {
      const z = HALL.z0 - bay * HALL.dz;
      const g = fog(z, 0.02);
      seg([-hw, fy, z], [hw, fy, z], MI, 0.05 * g);
      for (const s of [-1, 1]) seg([s * hw, fy, z], [s * hw, cy, z], MI, 0.045 * g);
    }

    // ---- the cells: 416 frames, and the one that is held
    for (const side of [-1, 1]) {
      const x = side * hw;
      const ry = -side * Math.PI / 2;   // filled faces look into the corridor
      for (let bay = 0; bay < HALL.bays; bay++) {
        const z = HALL.z0 - bay * HALL.dz;
        const passed = clamp(sb - bay);
        const g = fog(z);
        for (let slot = 0; slot < HALL.slots; slot++) {
          const y = HALL.y0 + slot * HALL.dy;
          const held = side === HELD.side && bay === HELD.bay && slot === HELD.slot;
          const onBand = side === HELD.side && slot === HELD.slot;
          const bandNear = onBand && bay === HELD.bay - 1;
          const bandFar = onBand && bay === HELD.bay + 1;
          // The held record is pulled out and laid open: one pane three cells
          // wide, with no frame, lamp or cross inside it.
          const pane = held || bandNear || bandFar;
          const y0 = y - HALL.halfH, y1 = y + HALL.halfH;
          const za = z + HALL.halfD, zb = z - HALL.halfD;
          const deep = 1 - 0.55 * delU;
          if (pane) {
            const a = (0.30 + 0.30 * readOn) * g;
            seg([x, y1, za], [x, y1, zb], HI, a * (held ? 1 : 0.8));
            seg([x, y0, za], [x, y0, zb], HI, a * (held ? 1 : 0.8));
            if (bandNear) seg([x, y0, za], [x, y1, za], HI, a);
            if (bandFar) seg([x, y0, zb], [x, y1, zb], HI, a);
          } else {
            const a = 0.045 * g * deep * (0.7 + 0.6 * hash(bay * 31 + slot * 7 + side));
            seg([x, y0, za], [x, y1, za], MI, a);
            seg([x, y0, zb], [x, y1, zb], MI, a);
            seg([x, y1, za], [x, y1, zb], MI, a * 0.8);
            seg([x, y0, za], [x, y0, zb], MI, a * 0.8);
          }

          // the lamp: out the moment the sweep reaches this bay
          if (!pane) {
            const h1 = hash(bay * 13.3 + slot * 3.71 + (side + 1) * 7.7);
            const flick = 0.55 + 0.45 * Math.sin(t * (2.1 + h1) + h1 * 9.0);
            const a = (0.06 + 0.13 * h1) * flick * (1 - smoothstep(0.02, 0.46, passed)) * g;
            k = writeInstance(FD, k, {
              p: [x + (side === -1 ? 0.02 : -0.02), y0 + 0.10, zb + 0.12],
              s: 1, c: h1 > 0.86 ? DIM : MI, a: clamp(a),
              r: [0, ry, 0], scale: [0.035, 0.035, 1],
            });
          } else {
            k = writeInstance(FD, k, {
              p: [x + 0.022, y1 - 0.09, za - 0.10],
              s: 1, c: held ? HI : MI, a: (held ? 0.45 + 0.45 * readOn : 0.16) * g,
              r: [0, ry, 0], scale: [0.018, 0.018, 1],
            });
          }

          // the cross: two strokes over the cell, and it stays there. The held
          // record is the one cell in the hall that never gets one.
          if (!pane && passed > 0.02) {
            // and it dies off with the square of the fog, or forty bays of
            // crosses at a grazing angle turn the far wall into moire
            const a = smoothstep(0.04, 0.34, passed) * 0.40 * g * g;
            const e = 0.62;
            seg([x, y - HALL.halfH * e, z + HALL.halfD * e],
              [x, y + HALL.halfH * e, z - HALL.halfD * e], RED, a, 1.6);
            seg([x, y + HALL.halfH * e, z + HALL.halfD * e],
              [x, y - HALL.halfH * e, z - HALL.halfD * e], RED, a, 1.6);
          }
        }
      }
    }

    // ---- the held record's afterimage
    // A line and a trail of charge on the same path: hairlines read as the
    // drawing, the points are what the phosphor is still holding.
    const GD = this.ghostData;
    let q = 0;
    for (const strand of this.tails) {
      const { st, pts, side } = strand;
      for (let i = 0; i < pts.length - 1; i++) {
        const a0 = pts[i], a1 = pts[i + 1];
        const age = local - (a0.at + a1.at) * 0.5;
        if (age < 0) continue;
        // the head passes: a hard flash, then the phosphor lets go
        const flash = Math.exp(-age / 0.075);
        const tau = st.tau * (1 - 0.42 * a0.s);
        const decay = Math.exp(-age / tau);
        const a = st.alpha * (0.62 * decay + 0.85 * flash);
        if (a < 0.004) continue;
        // the tails settle as the charge leaks out of them
        const wig = Math.sin(t * 2.6 + a0.s * 5.2 + side * 1.3)
          * 0.020 * Math.exp(-age * 0.45);
        seg(
          [a0.p[0], a0.p[1] + wig, a0.p[2]],
          [a1.p[0], a1.p[1] - wig * 0.4, a1.p[2]],
          st === STRANDS[0] ? HI : MI, a, st === STRANDS[0] ? 1.5 : 1.0,
        );
      }
      for (let i = 0; i <= TAIL_N; i++) {
        const p = pts[i];
        const age = local - p.at;
        if (age < 0) continue;
        const tau = st.tau * (1 - 0.42 * p.s);
        const a = st.alpha * (0.44 * Math.exp(-age / tau) + 0.80 * Math.exp(-age / 0.075));
        if (a < 0.005) continue;
        q = writeInstance(GD, q, {
          p: [p.p[0] + 0.012, p.p[1], p.p[2]],
          s: 1, c: st === STRANDS[0] ? HI : MI, a: clamp(a),
        });
      }
    }
    if (local > GHOST.in && local < GHOST.peak + 0.5) {
      // the read head that wrote it: a seam of light moving down the glass
      const q = clamp((local - GHOST.in) / (GHOST.peak - GHOST.in));
      const zc = HALL.z0 - HELD.bay * HALL.dz;
      const yc = HALL.y0 + HELD.slot * HALL.dy;
      const y = yc + HALL.halfH * (1 - 2 * q);
      const a = 0.55 * (1 - smoothstep(GHOST.peak, GHOST.peak + 0.5, local));
      seg([-hw + 0.03, y, zc + HALL.halfD * 0.94],
        [-hw + 0.03, y, zc - HALL.halfD * 0.94], HI, a, 1.4);
      k = writeInstance(FD, k, {
        p: [-hw + 0.09, y + 0.06, zc - HALL.halfD * 0.6],
        s: 1, c: BONE, a: a * 0.5,
        r: [0, Math.PI / 2, 0], scale: [0.035, 0.018, 1],
      });
    }
    // ...and the re-read, four seconds later, when the sweep reaches it
    const dwellStart = SWEEP.t0 + HELD.bay * SWEEP.dt;
    const reread = clamp((local - dwellStart) / SWEEP.dwell);
    if (reread > 0 && reread < 1.2) {
      const zc = HALL.z0 - HELD.bay * HALL.dz;
      const yc = HALL.y0 + HELD.slot * HALL.dy;
      const y = yc + HALL.halfH * (1 - 2 * Math.min(1, reread));
      const a = 0.30 * Math.sin(Math.PI * Math.min(1, reread));
      seg([-hw + 0.03, y, zc + HALL.halfD * 0.94],
        [-hw + 0.03, y, zc - HALL.halfD * 0.94], MI, a, 1.2);
    }

    // the rewrite front: a seam of light crossing the band, cutting one script
    // out of the wall and the next one in
    {
      const zc = HALL.z0 - HELD.bay * HALL.dz;
      const yc = HALL.y0 + HELD.slot * HALL.dy;
      for (let i = 0; i < WORDS.length - 1; i++) {
        const p = (local - (WORDS[i + 1].a - REWRITE)) / REWRITE;
        if (p <= 0 || p >= 1) continue;
        const z = zc + BAND.halfD - p * 2 * BAND.halfD;
        const a = Math.sin(Math.PI * p) * 0.5;
        seg([-hw + 0.10, yc - HALL.halfH, z],
          [-hw + 0.10, yc + HALL.halfH, z], HI, a, 1.4);
      }
    }

    // ---- the gantry: the machine that crosses records out
    // Its head is not a slab but the die itself -- the same X it prints. On
    // every other record it rides flat against the glass; at hers it lifts
    // 0.66 m off the wall and stays up, so the machine reads her cell and
    // never stamps it. Since the die is drawn, not filled, the film's last
    // word is not merely uncrossed: it is never even covered.
    if (sb > -0.35 && sb < HALL.bays + 0.6) {
      const zm = HALL.z0 - clamp(sb, -0.35, HALL.bays + 0.6) * HALL.dz;
      const g = clamp(fog(zm, 0.25), 0.25, 1);
      seg([-hw - 0.45, HALL.ceil - 0.15, zm], [hw + 0.45, HALL.ceil - 0.15, zm], BONE, 0.34 * g);
      seg([-hw - 0.45, 0.30, zm], [hw + 0.45, 0.30, zm], DIM, 0.10 * g);
      for (const s of [-1, 1]) {
        seg([s * (hw + 0.45), 0.05, zm], [s * (hw + 0.45), HALL.ceil - 0.15, zm], DIM, 0.16 * g);
      }
      // the die: an X on a stem, hung at stamp height and lifted at her cell
      const side = HELD.side;
      const upheld = 1 - smoothstep(1.15, 2.55, Math.abs(sb - HELD.bay));
      const fresh = Math.exp(-Math.max(0, local - stampAt(Math.round(clamp(sb, -0.35, HALL.bays + 0.6) - 0.35))) / 0.16);
      const yc = 5.50 + 0.66 * upheld;
      const xd = side * (hw - (0.055 + 0.22 * upheld));
      const e = 0.32;
      const die = (0.30 + 0.42 * fresh) * g * (1 - 0.22 * upheld);
      seg([xd, yc - e, zm - e], [xd, yc + e, zm + e], fresh > 0.35 ? RED : BONE, die);
      seg([xd, yc + e, zm - e], [xd, yc - e, zm + e], fresh > 0.35 ? RED : BONE, die);
      seg([xd, yc - e * 1.25, zm], [xd, yc + e * 1.25, zm], DIM, die * 0.5);
      seg([xd, yc + e * 1.25, zm], [xd, HALL.ceil - 0.15, zm], DIM, 0.11 * g);
    }

    // ---- the seat: a bench, and a light that is not a record
    {
      const sx = SEAT.x, sy = SEAT.y, sz = SEAT.z;
      const a = 0.20 + 0.30 * seatA;
      seg([sx - 0.42, sy + 0.44, sz], [sx + 0.42, sy + 0.44, sz], AM, a * 0.5, 1.2);
      seg([sx - 0.42, sy + 0.02, sz - 0.3], [sx + 0.42, sy + 0.02, sz - 0.3], AM, a * 0.35, 1.0);
      seg([sx - 0.34, sy + 0.02, sz - 0.3], [sx - 0.34, sy + 0.44, sz], AM, a * 0.35);
      seg([sx + 0.34, sy + 0.02, sz - 0.3], [sx + 0.34, sy + 0.44, sz], AM, a * 0.35);
      k = writeInstance(FD, k, {
        p: [sx, sy + 0.98, sz - 0.15],
        s: 1, c: AM, a: clamp(seatA * 0.95),
        r: [0, 0, 0], scale: [0.055, 0.055, 1],
      });
    }

    // ---- the air
    for (let i = 0; i < DUST; i++) {
      const h1 = hash(i * 1.31), h2 = hash(i * 2.71 + 5.1), h3 = hash(i * 3.37 + 9.7);
      const z = HALL.z0 - h1 * 74;
      const a = (0.03 + 0.06 * h3) * fog(z, 0.004);
      m = writeInstance(DD, m, {
        p: [(h2 - 0.5) * 2 * hw * 0.92, 0.3 + h3 * (HALL.ceil - 0.6), z],
        s: 1, c: DIM, a: clamp(a),
      });
    }

    this.lines.update(LD, n).render(out, { vp });
    this.ghost.update(GD, q).render(out, { vp, point: 5.5, sprite: 1, opacity: 1 });
    this.faces.update(FD, k).render(out, { vp, soft: 0.25 });
    this.dust.update(DD, m).render(out, { vp, point: 2.0, sprite: 1, opacity: 0.75 });
    void heldOn;
  }

  // ------------------------------------------------------------------ text on glass
  // The four corners of the held cell's pane are projected, so the word is
  // printed on the glass in the room's perspective: it is part of the set.
  pinGlass(vp, W, H) {
    const zc = HALL.z0 - HELD.bay * HALL.dz;
    const yc = HALL.y0 + HELD.slot * HALL.dy;
    const xg = -HALL.halfW + 0.16;
    const TL = project(vp, [xg, yc + HALL.halfH, zc + BAND.halfD], W, H);
    const TR = project(vp, [xg, yc + HALL.halfH, zc - BAND.halfD], W, H);
    const BL = project(vp, [xg, yc - HALL.halfH, zc + BAND.halfD], W, H);
    const ppm = Math.hypot(TR[0] - TL[0], TR[1] - TL[1]) / (2 * BAND.halfD);
    const pw = 2 * BAND.halfD * ppm, ph = 2 * HALL.halfH * ppm;
    this.glass = {
      ox: TL[0], oy: TL[1],
      ax: (TR[0] - TL[0]) / pw, ay: (TR[1] - TL[1]) / pw,
      bx: (BL[0] - TL[0]) / ph, by: (BL[1] - TL[1]) / ph,
      w: pw, h: ph, ppm,
    };
  }

  onGlass(c, draw) {
    const p = this.glass;
    c.save();
    c.transform(p.ax, p.ay, p.bx, p.by, p.ox, p.oy);
    draw(c, p);
    c.restore();
  }

  glassText(c, local, readOn, heldOn, paneLabels = 1) {
    this.onGlass(c, (g, p) => {
      // the record's own labels, ruled onto the pane
      const top = p.h * 0.16;
      label(g, "CV-01 / COLD STORAGE", p.w * 0.035, top, {
        size: Math.max(8, p.h * 0.032), tracking: p.h * 0.006,
        color: css("dim", 0.85 * paneLabels),
      });
      const held = heldOn * (0.5 + 0.5 * readOn);
      if (held > 0.01) {
        label(g, "HELD", p.w * 0.965, top, {
          size: Math.max(8, p.h * 0.032), tracking: p.h * 0.008, align: "right",
          color: css("miku", 0.9 * held * paneLabels),
        });
      }

      // one word, three scripts: the old language is cut away, never blended
      const first = WORDS[0];
      if (local < first.a - 0.2) return;
      const head = smoothstep(first.a - 0.2, first.a + 0.15, local);
      const size = p.h * 0.24;
      label(g, "\u89b3\u5ba2 / AUDIENCE", p.w * 0.5, p.h * 0.40, {
        size: Math.max(8, p.h * 0.042), tracking: p.h * 0.010, align: "center",
        color: css("dim", 0.7 * head),
      });
      const at = (text, alpha) => drawText(g, text, {
        x: p.w * 0.5, y: p.h * 0.70, size,
        weight: 600, serif: true, align: "center",
        color: css("bone", 0.95), tracking: size * 0.10, alpha,
      });
      const band = (x0, x1, fn) => {
        g.save();
        g.beginPath();
        g.rect(x0, 0, Math.max(0, x1 - x0), p.h);
        g.clip();
        fn();
        g.restore();
      };
      let i = 0;
      for (let j = 0; j < WORDS.length; j++) if (local >= WORDS[j].a) i = j;
      const w0 = WORDS[i];
      const next = WORDS[i + 1];
      const alpha = i === 0 ? smoothstep(w0.a, w0.a + 0.12, local) : 1;
      if (!next) {
        at(w0.text, alpha);
        return;
      }
      const prog = clamp((local - (next.a - REWRITE)) / REWRITE);
      if (prog <= 0) {
        const shown = i === 0 ? clamp((local - w0.a) / PRINT) : 1;
        if (shown <= 0.004) return;
        if (i === 0 && shown < 1) band(0, p.w * shown, () => at(w0.text, alpha));
        else at(w0.text, alpha);
      } else {
        const cut = p.w * prog;
        band(cut, p.w, () => at(w0.text, alpha));
        band(0, cut, () => at(next.text, alpha));
        if (prog > 0.001 && prog < 0.999) {
          g.save();
          g.globalAlpha = Math.sin(Math.PI * prog) * 0.6;
          g.fillStyle = css("mikuHi", 0.9);
          g.fillRect(cut - p.h * 0.003, p.h * 0.46, p.h * 0.006, p.h * 0.30);
          g.restore();
        }
      }
    });
  }

  // ---- the machine's own account of what it is doing
  readout(c, local, deleted, endFade, readTotal = 0) {
    const on = smoothstep(0.5, 1.4, local) * endFade;
    if (on <= 0.01) return;
    c.save();
    c.globalAlpha = on;
    label(c, "ARCHIVE 01 / COLD STORAGE", 84, 74, {
      size: 18, tracking: 2.4, color: css("dim", 0.9),
    });
    const rows = [
      ["RECORDS", `${RECORDS}`, css("bone", 0.92)],
      ["DELETED", `${deleted}`, css("red", 0.95)],
      ["HELD", "1", css("miku", 0.95)],
    ];
    rows.forEach(([key, value, color], i) => {
      const y = 116 + i * 26;
      label(c, key, 84, y, { size: 16, tracking: 1.8, color: css("ash", 0.8) });
      drawText(c, value, {
        x: 348, y, size: 19, weight: 500, mono: true, align: "right", color,
      });
    });
    c.fillStyle = css("dim", 0.35);
    c.fillRect(84, 192, 264, 1);
    // The second ledger in the same instrument: 8,192 voice slots, filed
    // elsewhere in the record. At t=0 the machine had read none of them; by
    // the end it has read one, and the panel says so without being told.
    label(c, "VOICE SLOTS \u00b7 READ LEDGER", 84, 218, {
      size: 13, tracking: 1.8, color: css("dim", 0.9),
    });
    const readRows = [
      ["READ", String(readTotal).padStart(5, "0"), readTotal ? "miku" : "dim"],
      ["UNREAD", String(8192 - readTotal).padStart(5, "0"), "dim"],
    ];
    readRows.forEach(([key, value, col], i) => {
      const y = 244 + i * 24;
      label(c, key, 84, y, { size: 15, tracking: 1.8, color: css("ash", 0.7) });
      drawText(c, value, {
        x: 348, y, size: 18, weight: 500, mono: true, align: "right",
        color: css(col, col === "miku" ? 0.95 : 0.8),
      });
    });
    c.restore();

    // the seat, named only when everything else is already dark. Seat 08192 is
    // the plant from the final concert: the lens started the last chapter in
    // that seat, and it is the only seat the archive cannot stamp -- the word
    // on it is the same word the held record uses.
    const seatA = smoothstep(8.4, 10.2, local) * endFade;
    if (seatA > 0.01) {
      c.save();
      c.globalAlpha = seatA;
      label(c, "SEAT 08192", 84, 992, {
        size: 15, tracking: 2.0, color: css("amber", 0.75),
      });
      label(c, "OCCUPIED \u00b7 HELD", 84, 1016, {
        size: 15, tracking: 2.0, color: css("amber", 0.95),
      });
      c.restore();
    }
  }

  // ---- the silent tail, counted in the song's own unit
  // The recording stops at 4:46.72 (local 3.03). The picture keeps running for
  // FILM_TAIL = 8.60 s, which at 240 BPM is 34.4 beats: thirty-four beats land
  // *after* there is nothing left to hear, the thirty-fifth would land at
  // 8.75 s and the film ends before it -- so the last mark of the ruler is
  // drawn but never lights. The one thing the machine never executes, again.
  silentBeat(c, local, endFade) {
    const a = smoothstep(SONG_END_LOCAL + 0.15, SONG_END_LOCAL + 0.75, local) * endFade;
    if (a <= 0.004) return;
    const beats = clamp((local - SONG_END_LOCAL) / BEAT, 0, 34.4);
    const x0 = 84, y = 930, dx = 6.6, h = 10;
    c.save();
    c.globalAlpha = a;
    label(c, "SILENT TAIL \u2014 008.60 s", 84, 884, {
      size: 14, tracking: 1.9, color: css("ash", 0.75),
    });
    label(c, "240.00 BPM \u00b7 34.4 BEATS", 84, 906, {
      size: 13, tracking: 1.7, color: css("dim", 0.85),
    });
    for (let i = 0; i < 35; i++) {
      const landed = beats >= i + 1;
      const x = x0 + i * dx;
      if (landed) {
        c.fillStyle = css("miku", 0.75);
        c.fillRect(x, y - h, 1.4, h);
      } else if (i === 34) {
        // the beat that never lands: an outline, and one red hairline
        c.strokeStyle = css("dim", 0.55);
        c.lineWidth = 1;
        c.strokeRect(x + 0.5, y - h + 0.5, 1.5, h - 1);
        c.fillStyle = css("red", 0.55);
        c.fillRect(x, y - h - 6, 2, 4);
      } else {
        c.fillStyle = css("dim", 0.4);
        c.fillRect(x, y - h, 1.2, h);
      }
    }
    c.fillStyle = css("dim", 0.4);
    c.fillRect(x0, y, 34 * dx, 1);
    label(c, "35th BEAT \u2014 NOT LANDED", 84, 958, {
      size: 13, tracking: 1.7, color: css("red", 0.6),
    });
    c.restore();
  }

  // ---- the credits, written after the sound has stopped. The last row is the
  // only warm type in the film's closing: the audience, in memory's colour.
  credits(c, local, endFade) {
    const rows = [
      ["\u76e3\u7763 / DIRECTOR", "CV-01", false],
      ["\u4e3b\u6f14 / LEAD", "\u521d\u97f3\u30df\u30af", false],
      ["\u97f3\u697d / MUSIC", "cosMo@\u66b4\u8d70P", false],
      ["\u89b3\u5ba2 / AUDIENCE", "\u3042\u306a\u305f \u30fb \u4f60 \u30fb YOU", true],
    ];
    if (local < CREDIT_AT - 0.1) return;
    const rise = 14 * smoothstep(CREDIT_AT, CREDIT_AT + 2.0, local);
    rows.forEach(([key, value, warm], i) => {
      // one row every two beats: the last cuts of the film are still on the grid
      const at = CREDIT_AT + i * CREDIT_STEP;
      const a = smoothstep(at, at + 0.42, local);
      if (a <= 0.004) return;
      const y = 726 + i * 50 - rise;
      c.save();
      c.globalAlpha = a * endFade * (warm ? 0.55 + 0.45 * smoothstep(8.6, 10.4, local) : 1);
      label(c, key, 700, y, {
        size: 17, tracking: 2.2,
        color: warm ? css("amber", 0.9) : css("dim", 0.95),
      });
      drawText(c, value, {
        x: 1180, y, size: warm ? 24 : 20, weight: 600, serif: true,
        align: "left", color: warm ? css("amber", 0.95) : css("ash", 0.9),
      });
      // the seat the film has been sitting in all along, in the same unit as
      // the queue: the audience row is not a credit, it is an address.
      if (warm) {
        label(c, "SEAT 08192 \u00b7 HELD", 1180, y + 28, {
          size: 13, tracking: 2.2, color: css("amber", 0.62),
        });
      }
      c.restore();
    });
  }

  // ---- the record's own clock. It starts the moment the song ends and keeps
  // counting; nobody in the film stops it.
  clock(c, t, local, endFade) {
    const a = smoothstep(SONG_END - START + 0.15, SONG_END - START + 0.75, local);
    if (a <= 0.004) return;
    c.save();
    c.globalAlpha = a * 0.46 * endFade;
    label(c, "CV-01 / RECORD", 1824, 1012, {
      size: 14, tracking: 2.4, align: "right", color: css("dim", 0.9),
    });
    drawText(c, timecode(t, false), {
      x: 1824, y: 1040, size: 20, weight: 500, mono: true, align: "right",
      color: css("bone", 0.85),
    });
    c.fillStyle = css("miku", 0.7);
    c.fillRect(1660, 1028, 2, 14);
    c.restore();
  }
}
