// 0:41.7 - instrumental. One string, plucked, with the real waveform written
// along it. The machine has nothing to say and keeps singing anyway.
//
// This is the longest shot in the film (16 s), so it is also the one that
// commits hardest to space: the string is a real wire strung between two
// anchor masts in a dark hall, not a drawing. The camera starts beside the
// near mast and slides down its length for sixteen seconds. The displacement
// on the wire is the recording's own waveform; a pluck packet runs the whole
// 372.7 m every four bars; each harmonic the machine finds draws its own
// standing wave over the wire, labelled with the interval it really is; and
// at the far end, small at first, she is standing.
//
// The instrument panels stay: this chapter is the machine listening to her,
// and the machine only knows how to read.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import {
  clamp, label, machineChrome, panel, smoothstep, specBars, tickRule,
} from "../kit.js";
import { singer } from "../motifs.js";
import { draw as drawText, pad } from "../type.js";
import { CamRig, Stage3D, camera, mat4, project, rgb, writeInstance } from "../gl3d.js";
import { audioU, layer } from "./util.js";

const FRAG = `
uniform float uT;
uniform float uLow;
uniform float uMid;
uniform float uHigh;
uniform float uKick;
uniform float uPulse;
uniform float uSnap;
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 col = C_INK;

  // the hall: a cold well of air around the wire
  float d = length(p * vec2(0.55, 1.0));
  col += C_TEAL_DEEP * exp(-d * 3.2) * (0.10 + 0.20 * uLow);

  // standing waves: the room the string resonates in
  float ring = 0.0;
  for (int i = 0; i < 5; i++) {
    float f = float(i + 1);
    ring += sin(uv.x * 6.28318 * f + uT * f * 0.6) * sin(uv.y * 6.28318 * f * 0.5 + uT * 0.4);
  }
  col += C_MIKU * 0.005 * ring * (0.3 + uMid);

  // the pluck: a thin shockwave leaving the wire, barely there
  float r = fract(uT * 2.0) * 1.4;
  col += C_MIKU_HI * smoothstep(0.010, 0.0, abs(length(p) - r)) * uKick * 0.022;

  // and the collapse at the end of the section
  col *= mix(1.0, 0.30, uSnap);
  col *= 0.97 + 0.06 * uHigh;
  fragColor = vec4(col, 1.0);
}`;

const TAU = Math.PI * 2;

// The wire's two ends, in metres. It crosses the whole hall from the near
// left to the far right and recedes as it goes, so a lens tracking beside it
// gets both a full-width line and real depth behind it. She stands under the
// far end.
const A = [-320, 8.4, -26];
const B = [46, 1.6, -96];

const SEG = 420;        // pieces of the wire
const RINGS = 8;        // harmonics H1..H8
const RING_SEG = 26;    // segments in one harmonic ring
const MODE_SEG = 96;    // pieces in one standing-wave curve
const SHAFTS = 150;     // the architecture: columns of light, far away
const DUST = 460;       // dust in the air, lit by the wire
const CROSS = 26;       // cross-members between the ranks the lens flies through
const AIR_HALL = 620;   // metres at which the hall's air is ~63% fog
const RANK_GLOW = 8;    // one backlit plane per rank, so depth reads as ranks

// Step 59. The 16-second ride covers 176.8 m, and a still frame cannot show a
// distance -- so the hall now carries the two things a camera needs to make
// speed *visible*: a ruler it runs through, and air close enough to smear.
//
// The ruler: 18 measurement gates straddling the wire every 12 m, from +150 m
// to +354 m along it. They are static architecture; the lens passes them, and
// the panel counts them off. The air: 96 motes seeded *on the rig's own path*
// (0.7 .. 4.9 m off the lens), drawn as the streak the frame would have
// exposed -- each one is the same world point projected through the lens at
// t and at t - SHUTTER, so a mote is a dot when the room is slow and a 60 px
// line when the lens is running. Both are measured, not painted: every number
// on the panel is read back off the two projections this frame drew.
const GATES = 18;        // measurement gates
const GATE0 = 150;       // m along the wire where the first one stands
const GATE_STEP = 12;    // m between gates
const GATE_SEG = 24;     // segments in one gate's ring
const NEAR = 96;         // near-field motes: the speed reference
const SHUTTER = 1 / 60;  // s of exposure the streaks are drawn for

// The voice bank. This hall does not hold one string; it holds 8,192 of them --
// one per song on file -- and the lens is following exactly one (CV-01). The
// rack stands across the far end of the hall, facing the way the lens has been
// walking: 8 ranks deep (44 m apart = 308 m), each rank 32 slots across (5 m
// apart = 155 m) and 32 tiers tall (1.6 m apart = 49.6 m). Every slot holds one
// 372.7 m string. 8,191 of them are slack and stored; one slot in the first
// rank is empty, and it is the slot of the string the lens is following.
const BANK_COLS = 32;    // across the rank (31 gaps x 5 m = 155 m)
const BANK_ROWS = 32;    // up the rank (31 gaps x 1.6 m = 49.6 m)
const BANK_SHELLS = 8;   // ranks deep (7 gaps x 44 m = 308 m)
const BAY_PITCH = 5.0;   // m between columns, along z
const TIER_PITCH = 1.6;  // m between tiers, along y
const RACK_GAP = 44.0;   // m between ranks, along x
const BANK = BANK_COLS * BANK_ROWS * BANK_SHELLS;  // 8192 slots, one per song
const BANK_LIVE = BANK - 1;                        // CV-01's slot is empty

// where each slot sits: the ranks stand just past her, across the hall
const slotX = (shell) => 58 + shell * RACK_GAP;
const slotY = (row) => 1.0 + row * TIER_PITCH;
const slotZ = (col) => -42 - col * BAY_PITCH;
const SLOT_COL = 15, SLOT_ROW = 15;   // ... and CV-01 hangs on the first rank

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mixv = (a, b, u) => [
  a[0] + (b[0] - a[0]) * u,
  a[1] + (b[1] - a[1]) * u,
  a[2] + (b[2] - a[2]) * u,
];

export default class Resonance extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "resonance");

    // Nine passes over the same space: the wire, its halo, its harmonics and
    // their standing waves, the two anchor masts, the architecture, and the
    // air. All additive, one draw call each.
    this.vp = mat4();
    this.wire = new Stage3D(ctx, "segment");
    this.glow = new Stage3D(ctx, "point");
    this.halo = new Stage3D(ctx, "point");
    this.rings = new Stage3D(ctx, "segment");
    this.modes = new Stage3D(ctx, "segment");
    this.frames = new Stage3D(ctx, "segment");
    this.nodes = new Stage3D(ctx, "point");
    this.shafts = new Stage3D(ctx, "segment");
    this.haze = new Stage3D(ctx, "rect");
    this.floor = new Stage3D(ctx, "segment");
    this.dust = new Stage3D(ctx, "point");
    this.bank = new Stage3D(ctx, "segment");
    this.tombs = new Stage3D(ctx, "point");
    this.marks = new Stage3D(ctx, "segment");
    this.cross = new Stage3D(ctx, "segment");
    this.rankGlow = new Stage3D(ctx, "rect");
    this.gate = new Stage3D(ctx, "segment");
    this.near = new Stage3D(ctx, "point");
    this.wireData = new Float32Array((SEG + 128) * 16);
    this.ringData = new Float32Array(RINGS * RING_SEG * 16);
    this.modeData = new Float32Array(RINGS * MODE_SEG * 16);
    this.frameData = new Float32Array(180 * 16);
    this.glowData = new Float32Array(SEG * 16);
    this.haloData = new Float32Array((SEG + 8) * 16);
    this.nodeData = new Float32Array((RINGS + 40) * 16);
    this.shaftData = new Float32Array(SHAFTS * 16);
    this.hazeData = new Float32Array(48 * 16);
    this.floorData = new Float32Array(160 * 16);
    this.dustData = new Float32Array(DUST * 16);
    this.tombData = new Float32Array(BANK_LIVE * 16);
    this.slotCol = new Uint8Array(BANK_LIVE);
    this.slotRow = new Uint8Array(BANK_LIVE);
    this.slotShell = new Uint8Array(BANK_LIVE);
    this.railData = new Float32Array(560 * 16);
    this.railShell = new Uint8Array(560);
    this.railCol = new Int16Array(560);
    this.railCount = 0;
    this.markData = new Float32Array(48 * 16);
    this.crossData = new Float32Array(CROSS * 2 * 16);
    this.rankGlowData = new Float32Array(RANK_GLOW * 16);
    this.gateData = new Float32Array(GATES * (GATE_SEG + 4) * 16);
    this.nearData = new Float32Array(NEAR * 16);

    // ---------------------------------------------------------------- the rig
    // This chapter's lens is a shot in itself. The wire is 372.7 m long -- so
    // long that a fixed frame can only ever show it as a thread -- so the
    // whole move is written along the string itself: the eye finds the near
    // end, rides up beside it, and catches up with the pluck packet, which
    // runs the length at 93 m/s. What it reaches is not the far mast: it is
    // the bank the string belongs to (8 ranks, 32 x 32 slots, 155 m of depth)
    // and, inside it, the one empty slot with a 1.70 m subject on the end of
    // the wire. The lens passes two of those ranks between 54 s and 56 s.
    //
    // The lens does one thing over sixteen seconds: it finds the wire, rides
    // it into the room it belongs to, and brakes 24 m short of ANCHOR B so
    // that the 1.70 m subject at the end of the wire and the first rank of the
    // 8,192-slot rack are finally the same picture. It does not cut, and it
    // never turns away from where the wire is going.
    //
    // Step 59 rewrote the four keys below. The move used to be six keys with
    // `smooth` easing on every one of them, and smoothstep has zero slope at
    // both ends -- so the lens did not ride the wire, it *stalled* at every
    // key: the probe measured 19.8 m/s, then 3.3, then 21.6, then 5.4, then
    // 24.3 m/s. Five ease-in-out moves in a row read as a dolly with a hitch
    // in it, and no amount of set could save that. It is now one trapezoid,
    // written in the wire's own frame (distance along the wire, lift above
    // it, offset to its side):
    //
    //   u 0.00 .. 0.25   ease "in"    accelerate 0 -> 14.7 m/s
    //   u 0.25 .. 0.75   ease "lin"   cruise at 14.7 m/s
    //   u 0.75 .. 1.00   ease "out"   brake 14.7 -> 0 m/s
    //
    // 4 s of acceleration (29.4 m) + 8 s of cruise (117.6 m) + 4 s of braking
    // (29.8 m) = 176.8 m, the whole ride. The first and last frames are held
    // exactly where they were: the composition of the opening and the last
    // close-up on her do not move -- only the middle learns to breathe.
    this.wireLen = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    this.wdir = norm(sub(B, A));
    this.wside = norm(cross(this.wdir, [0, 1, 0]));
    this.wup = norm(cross(this.wside, this.wdir));
    // One point of the ride, in the wire's own metres: s along the wire, lift
    // perpendicular to it, off to its right.
    const ride = (s, lift, off) => [
      A[0] + this.wdir[0] * s + this.wup[0] * lift + this.wside[0] * off,
      A[1] + this.wdir[1] * s + this.wup[1] * lift + this.wside[1] * off,
      A[2] + this.wdir[2] * s + this.wup[2] * lift + this.wside[2] * off,
    ];
    this.ride = ride;
    this.rig = new CamRig([
      { u: 0.00, ease: "in",
        eye: ride(173.4, 30.77, 64.83), at: [-120, 8.0, -40], fov: 1.00, roll: 0 },
      { u: 0.25, ease: "lin",
        eye: ride(202.8, 26.32, 54.95), at: [-38, 7.8, -58], fov: 0.94, roll: 0.08 },
      { u: 0.75, ease: "out",
        eye: ride(320.4, 8.49, 15.43), at: [36, 3.9, -91.5], fov: 0.62, roll: 0.14 },
      { u: 1.00, ease: "smooth",
        eye: ride(350.2, 3.99, 5.39), at: [46, 2.0, -96], fov: 0.50, roll: 0.10 },
    ]);

    // The rack is static: every slot's place, every rail and the one empty
    // slot are written once here, and a frame only touches their colour and
    // alpha. 8,191 anchors + 528 rails therefore cost three draw calls.

    // The near-field motes are seeded *from the rig*, not from the hall: each
    // one is placed off the lens's own path at the point in the move where it
    // will be passed. This is the difference between "dust in a room" and "a
    // speedometer": these motes exist to be run through.
    this.nearSeeds = [];
    for (let i = 0; i < NEAR; i++) {
      const h = (k) => {
        const s = Math.sin(i * 91.7 + k * 37.19) * 24634.6345;
        return s - Math.floor(s);
      };
      const u = 0.30 + 0.70 * ((i + 0.5) / NEAR);
      const eye = this.rig.state(u).eye;
      // biased off-axis: nothing is seeded straight down the lens's throat,
      // because a mote the audience runs *into* reads as dirt on the print
      const th = h(1) * TAU;
      const rr = 0.7 + 4.2 * Math.pow(h(2), 1.6);
      const lat = Math.cos(th) < 0 ? -1 : 1;
      this.nearSeeds.push({
        p: [
          eye[0] + Math.cos(th) * rr * 1.15,
          eye[1] + (h(3) - 0.5) * rr * 1.2,
          eye[2] + Math.sin(th) * rr,
        ],
        ph: h(4) * TAU,
        a: h(5),
        lat,
        u,
      });
    }

    // Step 59's own ledger: what the gates and the streaks measured. The
    // probe reads these back off rendered frames; none of them is a caption.
    this.streaks = [];
    this.qaSpeed = 0;
    this.qaTrail = { n: 0, max: 0, med: 0 };
    this.qaGate = { along: 0, n: 0, next: 0, frac: 0 };
    {
      // 8,191 anchors: three nested racks of slots, one per archived string
      let nb = 0;
      for (let shell = 0; shell < BANK_SHELLS; shell++) {
        for (let row = 0; row < BANK_ROWS; row++) {
          for (let col = 0; col < BANK_COLS; col++) {
            if (shell === 0 && col === SLOT_COL && row === SLOT_ROW) continue;
            writeInstance(this.tombData, nb, {
              p: [slotX(shell), slotY(row), slotZ(col)],
              c: rgb("tealDeep"), a: 0,
            });
            this.slotCol[nb] = col;
            this.slotRow[nb] = row;
            this.slotShell[nb] = shell;
            nb++;
          }
        }
      }
      // the rails the slots hang on: one frame per rank, written once
      const seg = (a, b, shell, colKey) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const l = Math.hypot(dx, dy, dz) || 1e-3;
        const i = this.railCount++;
        writeInstance(this.railData, i, {
          p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
          c: rgb("tealDeep"), a: 0,
          r: [-Math.asin(clamp(dz / l, -1, 1)), 0, Math.atan2(-dx, dy)],
          scale: [1, l / 2, 1],
        });
        this.railShell[i] = shell;
        this.railCol[i] = colKey;
      };
      for (let shell = 0; shell < BANK_SHELLS; shell++) {
        const x = slotX(shell);
        const y0 = slotY(0), y1 = slotY(BANK_ROWS - 1);
        for (let col = 0; col < BANK_COLS; col++) {
          seg([x, y0 - 1.2, slotZ(col)], [x, y1 + 1.2, slotZ(col)], shell, col);
        }
        const z0 = slotZ(0), z1 = slotZ(BANK_COLS - 1);
        for (let row = 0; row < BANK_ROWS; row++) {
          seg([x, slotY(row), z0 + 2.0], [x, slotY(row), z1 - 2.0], shell, -1);
        }
      }
      // the rack's own depth: cross-members spanning rank to rank, floor and
      // ceiling. In the hall they are the ladder the lens climbs at the end;
      // the wire's corridor would otherwise be a field of points with no
      // sense of the machine that holds it.
      let nc = 0;
      const brace = (a, b) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const l = Math.hypot(dx, dy, dz) || 1e-3;
        nc = writeInstance(this.crossData, nc, {
          p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
          c: rgb("tealDeep"), a: 0,
          r: [-Math.asin(clamp(dz / l, -1, 1)), 0, Math.atan2(-dx, dy)],
          scale: [1, l / 2, 1],
        });
      };
      const zA = slotZ(0), zB = slotZ(BANK_COLS - 1);
      const yA = slotY(0) - 1.4, yB = slotY(BANK_ROWS - 1) + 1.4;
      for (let shell = 0; shell < BANK_SHELLS - 1; shell++) {
        const x0 = slotX(shell), x1 = slotX(shell + 1);
        brace([x0, yA, zA], [x1, yA, zA]);
        brace([x0, yB, zA], [x1, yB, zA]);
      }
      brace([slotX(0), yA, zA], [slotX(0), yB, zA]);
      brace([slotX(0), yA, zA + 8], [slotX(0), yA, zA - 8]);
      // the empty slot: hers. It is the only ring in the rack, because it is
      // the only place where a string is missing -- it is out in the hall.
      const r = 1.15, cx = slotX(0), cy = slotY(SLOT_ROW), cz = slotZ(SLOT_COL);
      for (let i = 0; i < 20; i++) {
        const a0 = (i / 20) * TAU, a1 = ((i + 1) / 20) * TAU;
        const p0 = [cx, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r];
        const p1 = [cx, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r];
        const dy = p1[1] - p0[1], dz = p1[2] - p0[2];
        const l = Math.hypot(dy, dz) || 1e-3;
        writeInstance(this.markData, i, {
          p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2],
          c: rgb("miku"), a: 0,
          r: [Math.atan2(dz, dy), 0, 0], scale: [1, l / 2, 1],
        });
      }
    }

    this.dustSeeds = [];
    for (let i = 0; i < DUST; i++) {
      const h = (k) => {
        const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
        return s - Math.floor(s);
      };
      this.dustSeeds.push({
        u: h(1), r: (h(2) - 0.5) * 34, a: h(3) * TAU,
        y: (h(4) - 0.5) * 26, ph: h(5) * TAU,
      });
    }
    this.shaftSeeds = [];
    for (let i = 0; i < SHAFTS; i++) {
      const h = (k) => {
        const s = Math.sin(i * 4.71 + k * 31.7) * 9174.1917;
        return s - Math.floor(s);
      };
      this.shaftSeeds.push({
        x: -360 + h(1) * 620,
        z: -400 + h(2) * 280,
        h: 26 + h(3) * 74,
        a: 0.10 + h(4) * 0.16,
      });
    }

    // H1..H8 and the interval each harmonic actually sits at. The numbers on
    // screen are log2 of the harmonic number, times twelve semitones.
    this.harm = [];
    for (let k = 1; k <= RINGS; k++) {
      this.harm.push({ k, semis: 12 * Math.log2(k), at: 1.1 + (k - 1) * 1.55 });
    }
  }

  // The wire's straight line at u in [0,1], without displacement.
  base(u) {
    return [
      A[0] + (B[0] - A[0]) * u,
      A[1] + (B[1] - A[1]) * u,
      A[2] + (B[2] - A[2]) * u,
    ];
  }

  // Where the lens should look at the end of the move: past her into the
  // hanging string over the bank. "Hers" is the one string that exists twice
  // on screen -- as the line the lens has been following, and as the single
  // empty slot in a field of 8,191.
  //
  // The rig's own helpers: `u` runs along the wire (values past 1 continue the
  // line towards the bank), `lift` is how far above the wire the eye rides --
  // low at the start, opening as the machine appears -- and `side` offsets the
  // eye to the wire's right so the string never sits exactly on the frame's
  // centre line. The wire's displacement is the live recording, read at the
  // same time the pass draws it.
  wireAt(u, lift = 0, side = 0) {
    const t = this.singT || 41.69;
    const amp = (this.singAmp || 0.8) * 2.0;
    if (u >= 0 && u <= 1) {
      const p = this.point(u, t, amp);
      const d = norm(sub(B, A));
      const rt = norm(cross(d, [0, 1, 0]));
      return [p[0] + rt[0] * side, p[1] + lift + rt[1] * side, p[2] + rt[2] * side];
    }
    // past the far anchor: stay on the wire's own line, extended west, so the
    // eye keeps travelling towards her instead of snapping off-axis
    const d = norm(sub(B, A));
    const p = this.base(1);
    const k = u - 1;
    const rt = norm(cross(d, [0, 1, 0]));
    return [p[0] + d[0] * k * 360 + rt[0] * side, p[1] + lift + d[1] * k * 360 + rt[1] * side, p[2] + d[2] * k * 360 + rt[2] * side];
  }

  lift(u) {
    return 5 + 22 * smoothstep(0.15, 0.85, clamp(u, 0, 1));
  }

  // The wire's shape at u, displaced by the real waveform. The wave travels
  // down the string, so a point at u carries the sample from (1-u) * delay
  // seconds ago -- the same trick the 2D version used, now with depth. The
  // delay has to stay longer than the analysis' own 5 ms sample spacing or the
  // wave reads as a staircase; 2.4 s over 420 pieces sits just inside it.
  point(u, t, amp) {
    const [lo, hi] = this.ctx.features.waveAt(Math.max(0, t - (1 - u) * 2.4));
    const v = (lo + hi) * 0.5;
    const y = A[1] + (B[1] - A[1]) * u;
    return [
      A[0] + (B[0] - A[0]) * u,
      y + Math.sin(Math.PI * u) * v * amp,
      A[2] + (B[2] - A[2]) * u,
    ];
  }

  // The move: sixteen seconds of tracking beside the string, one continuous
  // move with no cuts: alongside the string, then past it, then into the bank
  // it belongs to. The global shot table still says "fixed frame": the whole
  // move happens inside the set (see CamRig, src/gl3d.js).
  view(local, aspect) {
    const cam = this.rig.eval(clamp(local / 16.0), aspect);
    // the rig owns the matrix; the scene's vp is the same object, so the 2D
    // layer, the QA probe and the stages all read one camera
    this.vp = this.rig.vp;
    // QA hook (read-only): the offline probe projects the wire's two ends
    // through the same matrix the stages use, so a "black frame" can be told
    // from "the camera is pointed somewhere else" without guessing.
    this.lastCam = cam;
    this.qaProbe = {
      eyeFwd: [
        this.vp[2], this.vp[6], this.vp[10],
      ],
      A: project(this.vp, A, this.ctx.W, this.ctx.H),
      B: project(this.vp, B, this.ctx.W, this.ctx.H),
    };
    return cam;
  }

  render(f, out) {
    const t = f.t;
    const local = t - 41.69;
    const snap = smoothstep(15.35, 16.0, local);
    this.pass.draw({ dst: out, u: audioU(f, { uSnap: snap }) });

    const aspect = this.ctx.W / this.ctx.H;
    const amp = 2.1 * (0.30 + 0.95 * f.a.rms) * (1 - snap);
    this.singAmp = amp;
    this.singT = t;
    const cam = this.view(local, aspect);
    this.eyeNow = cam.eye;
    const bankView = this.inBankView();
    this.wirePass(out, f, t, amp, snap);
    if (bankView) this.bankPass(out, f, t, local, snap);
    this.ringPass(out, f, t, amp, snap, local);
    this.speedPass(out, f, t, local, aspect, snap);
    this.airPass(out, f, t, snap);

    const c = this.text.ctx;
    this.text.clear();
    this.ui(c, f, t, local, snap, amp);
    this.ctx.drawLayer(out, this.text, { mode: "normal" });

    return {
      bloom: 0.95 + 0.5 * f.kick,
      exposure: 1.0,
      grain: 0.018,
      vignette: 0.62,
      scan: 0.04,
      ca: 0.0012 + 0.002 * f.kick,
      fade: 0.40 * smoothstep(15.2, 16.0, local),
    };
  }

  // The bank is worth drawing only once the lens is close enough for a slot to
  // be more than one pixel: before that the same light is carried by the fog
  // and the counter, and 8,191 point sprites in an empty hall are just noise.
  inBankView() {
    const p = project(this.vp, [slotX(0), 8, -120], this.ctx.W, this.ctx.H);
    if (!(p[2] > 0.3)) return false;
    const near = project(this.vp, [slotX(0), 1, slotZ(0)], this.ctx.W, this.ctx.H);
    const far = project(this.vp, [slotX(0), 1, slotZ(BANK_COLS - 1)], this.ctx.W, this.ctx.H);
    return Math.abs(near[0] - far[0]) > 90 || Math.abs(near[1] - far[1]) > 90;
  }

  // ---- the wire: one glowing strand, its displacement the real waveform,
  // a pluck packet running its whole length, plus a thin overtone strand so
  // the shape never reads as a graph
  wirePass(out, f, t, amp, snap) {
    const hot = 0.55 + 0.45 * Math.max(f.kick, f.vox * 0.8);
    // One pluck every four seconds: the packet leaves the near mast, crosses
    // the whole hall, and dies at the far anchor exactly as the next one
    // is released. The wire is long enough to watch it travel.
    const head = (t * 0.25) % 1;
    const side = norm(cross(norm(sub(B, A)), [0, 1, 0]));
    let n = 0;
    for (let i = 0; i < SEG; i++) {
      const u0 = i / SEG, u1 = (i + 1) / SEG;
      const p0 = this.point(u0, t, amp), p1 = this.point(u1, t, amp);
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
      const du = Math.hypot(dx, dy, dz) || 1e-3;
      const packet = Math.exp(-Math.pow((u0 - head) * 16.0, 2));
      const near = packet * (0.35 + 0.65 * Math.max(f.kick, f.a.rms));
      // the far end used to be dimmed because the lens never went there; the
      // shot's payoff is a close-up on that end, so it keeps its light
      const far = 1 - 0.18 * Math.pow(u0, 2.4);
      n = writeInstance(this.wireData, n, {
        p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2],
        c: near > 0.55 ? rgb("mikuHi") : rgb("miku"),
        // even after the string is dead it is still a string: the amplitude
        // collapses, the wire does not disappear
        a: clamp((0.34 + 0.55 * near) * hot * far * (1 - snap * 0.55)),
        r: [-Math.asin(clamp(dz / du, -1, 1)), 0, Math.atan2(-dx, dy)],
        scale: [1, du / 2, 1],
      });
      // scale marks: the machine has ruled the string every 16 m, so its
      // length is something the frame can measure, not just admire
      if (i % 20 === 0) {
        const q0 = add(p0, mul(side, -0.34)), q1 = add(p0, mul(side, 0.34));
        const mx = q1[0] - q0[0], my = q1[1] - q0[1], mz = q1[2] - q0[2];
        const md = Math.hypot(mx, my, mz) || 1e-3;
        n = writeInstance(this.wireData, n, {
          p: [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2, (q0[2] + q1[2]) / 2],
          c: rgb("tealDeep"),
          a: 0.26 + 0.30 * packet,
          r: [-Math.asin(clamp(mz / md, -1, 1)), 0, Math.atan2(-mx, my)],
          scale: [1, md / 2, 1],
        });
      }
    }
    this.wire.update(this.wireData, n).render(out, this.air({ vp: this.vp, point: 2.0 }));

    // The wire's halo. A hairline is all a GL line can be, and a hairline in a
    // dark hall reads as a scratch; the light the wire actually throws is
    // drawn as point sprites along the same curve -- a tight core, then a wide
    // fog, then the floor's reflection of both.
    let g = 0, h = 0;
    for (let i = 0; i <= SEG; i += 2) {
      const u = i / SEG;
      const p = this.point(u, t, amp);
      const packet = Math.exp(-Math.pow((u - head) * 16.0, 2));
      const near = packet * (0.35 + 0.65 * Math.max(f.kick, f.a.rms));
      const far = 1 - 0.18 * Math.pow(u, 2.4);
      g = writeInstance(this.glowData, g, {
        p,
        c: near > 0.55 ? rgb("mikuHi") : rgb("miku"),
        a: clamp((0.12 + 0.26 * near) * hot * far * (1 - snap * 0.55)),
      });
      h = writeInstance(this.haloData, h, {
        p,
        c: near > 0.55 ? rgb("miku") : rgb("tealDeep"),
        a: clamp((0.05 + 0.10 * near) * hot * far * (1 - snap * 0.55)),
      });
      h = writeInstance(this.haloData, h, {
        p: [p[0], -p[1] * 0.94, p[2]],
        c: rgb("tealDeep"),
        a: clamp((0.028 + 0.075 * near) * hot * far * (0.35 + 0.65 * (1 - snap))),
      });
    }
    this.glow.update(this.glowData, g).render(out, this.air({ vp: this.vp, point: 6.5, sprite: 1 }));
    this.halo.update(this.haloData, h)
      .render(out, this.air({ vp: this.vp, point: 20, sprite: 1, opacity: 0.9 }));

    // one faint overtone strand, offset in Y and delayed by 20 ms
    let m = 0;
    const S = 132;
    for (let i = 0; i < S; i++) {
      const u0 = i / S, u1 = (i + 1) / S;
      const p0 = this.point(u0, t + 0.020, amp * 0.34);
      const p1 = this.point(u1, t + 0.020, amp * 0.34);
      p0[1] += 1.5; p1[1] += 1.5;
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
      const du = Math.hypot(dx, dy, dz) || 1e-3;
      m = writeInstance(this.wireData, m, {
        p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2],
        c: rgb("tealDeep"),
        a: 0.5 * (1 - snap) * (0.5 + 0.5 * f.a.high),
        r: [-Math.asin(clamp(dz / du, -1, 1)), 0, Math.atan2(-dx, dy)],
        scale: [1, du / 2, 1],
      });
    }
    this.wire.update(this.wireData, m).render(out, this.air({ vp: this.vp, opacity: 1 }));
  }

  // ---- the harmonics: a ring standing at each node of the string, labelled
  // with the interval it really is. They light in order, and go out in order.
  ringPass(out, f, t, amp, snap, local) {
    const dir = norm(sub(B, A));
    const side = norm(cross(dir, [0, 1, 0]));
    const up2 = norm(cross(side, dir));
    let n = 0;
    let d = 0;
    for (const hm of this.harm) {
      const env = smoothstep(hm.at, hm.at + 0.22, local)
        * (1 - smoothstep(hm.at + 1.9, hm.at + 2.5, local));
      const alive = (1 - snap) * env;
      if (alive <= 0.01) continue;
      const u = hm.k / (RINGS + 1);
      const centre = this.point(u, t, amp);
      // the rings are stations on the string, so they keep a constant angular
      // size: a ring the lens is passing through is not allowed to fill the
      // whole frame, and a ring 300 m away is still visible
      const eye = this.eyeNow || this.eye;
      const dist = Math.hypot(
        centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]);
      const r = clamp(0.055 * dist, 0.50, 2.40);
      d = writeInstance(this.nodeData, d, {
        p: centre, c: rgb("mikuHi"), a: clamp(0.75 * alive),
      });
      for (let s = 0; s < RING_SEG; s++) {
        const a0 = (s / RING_SEG) * TAU, a1 = ((s + 1) / RING_SEG) * TAU;
        const q0 = add(centre, add(mul(side, Math.cos(a0) * r), mul(up2, Math.sin(a0) * r)));
        const q1 = add(centre, add(mul(side, Math.cos(a1) * r), mul(up2, Math.sin(a1) * r)));
        const dx = q1[0] - q0[0], dy = q1[1] - q0[1], dz = q1[2] - q0[2];
        const du = Math.hypot(dx, dy, dz) || 1e-3;
        n = writeInstance(this.ringData, n, {
          p: [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2, (q0[2] + q1[2]) / 2],
          c: hm.k % 2 ? rgb("mikuHi") : rgb("miku"),
          a: 0.42 * alive * (0.7 + 0.6 * f.a.high),
          r: [-Math.asin(clamp(dz / du, -1, 1)), 0, Math.atan2(-dx, dy)],
          scale: [1, du / 2, 1],
        });
      }
    }
    // Each harmonic also draws its own standing wave over the wire: the mode
    // shape the machine believes the string is singing. This is what turns
    // "H3" from a readout into architecture -- and it is the reason the wire
    // can be understood as an instrument rather than a laser.
    let q = 0;
    const mAmp = 2.20 * (0.35 + 0.85 * f.a.rms) * (1 - snap);
    for (const hm of this.harm) {
      const env = smoothstep(hm.at, hm.at + 0.28, local)
        * (1 - smoothstep(hm.at + 1.9, hm.at + 2.5, local));
      const alive = (1 - snap) * env;
      if (alive <= 0.012) continue;
      const phase = Math.sin(t * (0.9 + hm.k * 0.21) + hm.k * 0.7);
      // the belly of the mode: where the string actually moves. One dot per
      // antinode, so H3 reads as three moving bellies and not as a curve.
      for (let belly = 1; belly <= hm.k; belly++) {
        const ub = (2 * belly - 1) / (2 * hm.k);
        const b = this.point(ub, t, amp * 0.22);
        const wv = Math.sin(Math.PI * hm.k * ub) * phase * mAmp;
        d = writeInstance(this.nodeData, d, {
          p: [b[0], b[1] + 2.5 + wv, b[2]],
          c: rgb("mikuHi"), a: clamp(0.55 * alive),
        });
      }
      for (let s = 0; s < MODE_SEG; s++) {
        const u0 = s / MODE_SEG, u1 = (s + 1) / MODE_SEG;
        const b0 = this.point(u0, t, amp * 0.22), b1 = this.point(u1, t, amp * 0.22);
        const w0 = Math.sin(Math.PI * hm.k * u0) * phase * mAmp;
        const w1 = Math.sin(Math.PI * hm.k * u1) * phase * mAmp;
        const x0 = b0[0], y0 = b0[1] + 2.5 + w0, z0 = b0[2];
        const x1 = b1[0], y1 = b1[1] + 2.5 + w1, z1 = b1[2];
        const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
        const du = Math.hypot(dx, dy, dz) || 1e-3;
        q = writeInstance(this.modeData, q, {
          p: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
          c: hm.k % 2 ? rgb("miku") : rgb("tealDeep"),
          a: 0.52 * alive * (0.6 + 0.5 * f.a.high),
          r: [-Math.asin(clamp(dz / du, -1, 1)), 0, Math.atan2(-dx, dy)],
          scale: [1, du / 2, 1],
        });
      }
    }
    this.rings.update(this.ringData, n).render(out, this.air({ vp: this.vp, opacity: 1 }));
    this.nodes.update(this.nodeData, d).render(out, this.air({ vp: this.vp, point: 6.5, sprite: 1 }));
    this.modes.update(this.modeData, q).render(out, this.air({ vp: this.vp, opacity: 0.9 }));
  }

  // ---- the bank: the other 8,191 strings. They arrive late, they arrive
  // slowly, and from the moment they are here this chapter is not about one
  // instrument any more. A read head walks the columns while they fade in: the
  // number the interface has been climbing towards all chapter (SONGS RENDERED
  // 08192) is the number of strings standing in this room -- and the machine
  // counts every one of them without stopping.
  bankPass(out, f, t, local, snap) {
    const inn = smoothstep(7.6, 11.4, local);
    const alive = inn * (1 - snap * 0.95);
    if (alive <= 0.004) return;
    const DEEP = rgb("tealDeep"), MI = rgb("miku"), HI = rgb("mikuHi");
    // After the counter lands on 08192 the head has already left the last
    // column; the rack must not go dark with it. The room settles to a low,
    // legible "all slots present" glow -- 8,191 dead strings and the one live
    // wire -- which is the picture the last close-up is standing in.
    const settled = smoothstep(12.8, 14.4, local);
    // the head runs the 32 columns and lands on the last one at 13.6 s --
    // exactly when the interface's counter lands on 08192
    const head = (local - 8.0) * 5.54;
    for (let i = 0; i < BANK_LIVE; i++) {
      const dx = this.slotCol[i] - head;
      const band = Math.exp(-dx * dx * 0.55);
      const depth = 1 / (1 + this.slotShell[i] * 0.55);
      const a = clamp(alive * (0.16 + 0.40 * settled + 0.92 * band) * (0.38 + 0.62 * depth));
      const k = clamp(0.10 + 0.30 * settled + 0.90 * band);
      const o = i * 16;
      this.tombData[o + 4] = DEEP[0] + (HI[0] - DEEP[0]) * k;
      this.tombData[o + 5] = DEEP[1] + (HI[1] - DEEP[1]) * k;
      this.tombData[o + 6] = DEEP[2] + (HI[2] - DEEP[2]) * k;
      this.tombData[o + 7] = a;
    }
    this.tombs.update(this.tombData, BANK_LIVE)
      .render(out, this.air({ vp: this.vp, point: 3.6, sprite: 1, opacity: 1 }));

    // A dim plane behind every rank: the rack is a volume, and without one the
    // 8,192 points read as a starfield dropped in front of a black wall. The
    // planes are additve and very low, so they can never turn into fog.
    let rg = 0;
    for (let shell = 0; shell < BANK_SHELLS; shell++) {
      const band = Math.exp(-Math.pow((shell * 6 - head) * 0.22, 2));
      rg = writeInstance(this.rankGlowData, rg, {
        p: [slotX(shell), (slotY(0) + slotY(BANK_ROWS - 1)) / 2, (slotZ(0) + slotZ(BANK_COLS - 1)) / 2],
        s: 1, c: rgb("tealDeep"),
        a: clamp(alive * (0.020 + 0.030 * band + 0.035 * settled) * (0.5 + 0.5 * f.a.low)),
        scale: [(slotZ(BANK_COLS - 1) - slotZ(0)) / 2, (slotY(BANK_ROWS - 1) - slotY(0)) / 2 + 1.5, 1],
      });
    }
    this.rankGlow.update(this.rankGlowData, rg)
      .render(out, this.air({ vp: this.vp, soft: 1, opacity: 0.9 }));

    // the rails: the racks they hang on, lit by the same head
    for (let i = 0; i < this.railCount; i++) {
      const key = this.railCol[i];
      const band = key < 0 ? 0 : Math.exp(-Math.pow((key - head) * 0.7, 2));
      const depth = 1 / (1 + this.railShell[i] * 0.45);
      const k = clamp((0.06 + 0.22 * settled) * depth + 0.94 * band);
      const o = i * 16;
      this.railData[o + 4] = DEEP[0] + (MI[0] - DEEP[0]) * k;
      this.railData[o + 5] = DEEP[1] + (MI[1] - DEEP[1]) * k;
      this.railData[o + 6] = DEEP[2] + (MI[2] - DEEP[2]) * k;
      this.railData[o + 7] = clamp(
        alive * (0.10 + 0.26 * settled + 0.70 * band) * (0.40 + 0.60 * depth));
    }
    this.bank.update(this.railData, this.railCount)
      .render(out, this.air({ vp: this.vp, opacity: 0.9 }));
    this.cross.update(this.crossData, CROSS * 2)
      .render(out, this.air({ vp: this.vp, opacity: 0.55 - 0.34 * settled }));

    // and the one empty slot: it is empty because its string is out there,
    // around a 1.70 m subject's chest
    const pulse = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * 2.1));
    for (let i = 0; i < 20; i++) {
      const o = i * 16;
      this.markData[o + 4] = MI[0];
      this.markData[o + 5] = MI[1];
      this.markData[o + 6] = MI[2];
      this.markData[o + 7] = clamp(alive * pulse * 1.15);
    }
    this.marks.update(this.markData, 20).render(out, this.air({ vp: this.vp, opacity: 0.95 }));
  }

  // ---- the instrument: the wire is not a laser, it hangs between two anchor
  // masts. Legs, braces, two cross-arms and guy wires each -- the only built
  // things in the hall, so the string reads as strung rather than drawn.
  framePass(out, f, t, snap) {
    let n = 0;
    const line3 = (a, b, col, alpha, mirror = false) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const du = Math.hypot(dx, dy, dz) || 1e-3;
      const r = [-Math.asin(clamp(dz / du, -1, 1)), 0, Math.atan2(-dx, dy)];
      n = writeInstance(this.frameData, n, {
        p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
        c: col, a: alpha, r, scale: [1, du / 2, 1],
      });
      // the floor is polished: the uprights keep a dim image of themselves
      // under it, and only the uprights -- a mirrored guy wire reads as a
      // scratch, not as a reflection
      if (mirror) {
        n = writeInstance(this.frameData, n, {
          p: [(a[0] + b[0]) / 2, -(a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
          c: col, a: alpha * 0.42, r, scale: [1, du / 2, 1],
        });
      }
    };
    const DP = rgb("tealDeep"), DIM = rgb("dim"), MI = rgb("miku"), RD = rgb("red");
    const mast = (P) => {
      const top = P[1] + 12.5;
      for (const s of [-1, 1]) {
        line3([P[0] + s * 1.6, 0, P[2]], [P[0] + s * 1.6, top, P[2]], DP,
          0.20 + 0.05 * f.a.low, true);
        // the brace down to the floor, and the guy wire that holds the top
        line3([P[0] + s * 1.6, P[1] * 0.55, P[2]], [P[0] + s * 5.4, 0, P[2]], DIM, 0.16);
        line3([P[0] + s * 1.6, top - 1.2, P[2]], [P[0] + s * 4.2, P[1] + 1.0, P[2]], DIM, 0.13);
        // the base plate
        line3([P[0] + s * 1.6, 0.03, P[2]], [P[0] + s * 5.4, 0.03, P[2]], DIM, 0.18);
      }
      // the cross-arm the wire terminates on, and the tuning arm above it
      line3([P[0] - 3.6, P[1], P[2]], [P[0] + 3.6, P[1], P[2]], MI,
        0.30 + 0.14 * f.a.rms, true);
      line3([P[0] - 2.4, P[1] + 7.6, P[2]], [P[0] + 2.4, P[1] + 7.6, P[2]], DP, 0.18);
      line3([P[0], P[1] + 7.6, P[2]], [P[0], top + 0.6, P[2]], DP, 0.16);
      line3([P[0], P[1], P[2]], [P[0], P[1] + 7.6, P[2]], DP, 0.14);
      // the tension indicator: the one part of the rig that ever turns red
      const load = clamp(0.25 + 0.55 * f.kick + 0.30 * f.a.rms);
      line3([P[0], P[1] - 0.55, P[2]], [P[0], P[1] + 0.55, P[2]], RD, 0.30 + 0.45 * load);
    };
    mast(A);
    mast(B);
    // ... and the far end of the wire is not bolted to B's mast. It is
    // socketed into a collar worn at 1.60 m, so the last thing the film shows
    // of this hall is that the instrument being played is her.
    {
      const load = clamp(0.20 + 0.60 * f.a.rms + 0.35 * f.kick);
      const R = 0.55;
      const hot = load > 0.72 && Math.sin(t * 5.0) > -0.4;
      for (let i = 0; i < 24; i++) {
        const a0 = (i / 24) * TAU, a1 = ((i + 1) / 24) * TAU;
        line3(
          [B[0] + Math.cos(a0) * R, B[1], B[2] + Math.sin(a0) * R],
          [B[0] + Math.cos(a1) * R, B[1], B[2] + Math.sin(a1) * R],
          hot ? RD : MI, 0.30 + 0.34 * load,
        );
      }
      // four braces pulling the collar up onto the wire's end socket
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + 0.4;
        line3(
          [B[0] + Math.cos(a) * R, B[1] + 0.02, B[2] + Math.sin(a) * R],
          [B[0] + Math.cos(a) * 0.16, B[1] + 0.24, B[2] + Math.sin(a) * 0.16],
          hot ? RD : DP, 0.18 + 0.20 * load,
        );
      }
    }
    this.frames.update(this.frameData, n).render(out, this.air({ vp: this.vp, opacity: 0.9 }));
  }

  // ---- the ruler and the air (step 59): what makes 176.8 m of travel visible
  //
  // A still frame cannot show a distance per second, so this shot carries its
  // own two references. The gates are static: 18 rings of 1.50 m straddling
  // the wire every 12 m, each with a crosshair and two legs to the floor. The
  // lens runs through them at 8 .. 20 m/s and the panel counts them off. The
  // motes are static too -- what moves is the lens -- and each mote is drawn
  // twice: as the point it is, and as the line between where the lens at
  // t - SHUTTER would have thrown it and where the lens now does. That line is
  // the streak the frame would really have exposed, so the picture can be read
  // in a still: a dot means the room is still, a 60 px line means it is not.
  speedPass(out, f, t, local, aspect, snap) {
    const W = this.ctx.W, H = this.ctx.H;
    const R = 1.50;                       // gate ring radius, metres
    const dir = this.wdir, side = this.wside, up = this.wup;
    const along = clamp(
      ((this.eyeNow || [0, 0, 0])[0] - A[0]) * dir[0]
      + ((this.eyeNow || [0, 0, 0])[1] - A[1]) * dir[1]
      + ((this.eyeNow || [0, 0, 0])[2] - A[2]) * dir[2],
      0, this.wireLen,
    );
    const frac = (along - GATE0) / GATE_STEP;
    const passed = Math.floor(frac);
    // how long ago the last gate went by, 0 .. 1 -- the pass pulse
    const since = frac - Math.floor(frac);
    const pulse = passed >= 0 ? Math.exp(-since * 4.5) : 0;
    const nextDist = passed < 0 ? GATE0 - along : (Math.floor(frac) + 1 - frac) * GATE_STEP;
    this.qaGate = {
      along: +along.toFixed(2),
      n: clamp(passed + 1, 0, GATES),
      next: +Math.max(0, nextDist).toFixed(2),
      frac: +frac.toFixed(3),
    };

    const wt = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    let ng = 0;
    const seg = (P0, P1, color, alpha) => {
      const dx = P1[0] - P0[0], dy = P1[1] - P0[1], dz = P1[2] - P0[2];
      const l = Math.hypot(dx, dy, dz) || 1;
      const d = wt([dx, dy, dz]);
      ng = writeInstance(this.gateData, ng, {
        p: [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2, (P0[2] + P1[2]) / 2],
        c: color, a: alpha,
        r: [Math.asin(clamp(d[2], -1, 1)), 0, Math.atan2(-d[0], d[1])],
        scale: [1, l / 2, 1],
      });
    };
    for (let i = 0; i < GATES; i++) {
      const s = GATE0 + i * GATE_STEP;
      const C = [
        A[0] + dir[0] * s, A[1] + dir[1] * s, A[2] + dir[2] * s,
      ];
      // one gate is the one being run through: it lights as it is crossed and
      // decays; gates behind are put out, gates ahead are waiting
      const crossed = i <= passed;
      const isNext = i === Math.floor(frac) + 1;
      const isLast = i === passed && passed >= 0;
      const ring = isLast ? 0.30 + 0.62 * pulse
        : isNext ? 0.34
          : crossed ? 0.055 : 0.13;
      const ringC = isLast && pulse > 0.25 ? rgb("mikuHi") : rgb("miku");
      for (let j = 0; j < GATE_SEG; j++) {
        const a0 = (j / GATE_SEG) * TAU, a1 = ((j + 1) / GATE_SEG) * TAU;
        seg(
          [C[0] + R * (Math.cos(a0) * side[0] + Math.sin(a0) * up[0]),
            C[1] + R * (Math.cos(a0) * side[1] + Math.sin(a0) * up[1]),
            C[2] + R * (Math.cos(a0) * side[2] + Math.sin(a0) * up[2])],
          [C[0] + R * (Math.cos(a1) * side[0] + Math.sin(a1) * up[0]),
            C[1] + R * (Math.cos(a1) * side[1] + Math.sin(a1) * up[1]),
            C[2] + R * (Math.cos(a1) * side[2] + Math.sin(a1) * up[2])],
          ringC, ring,
        );
      }
      // the crosshair: the gate is a measuring instrument, not a hoop
      const arm = (v) => seg(
        [C[0] - v[0] * R, C[1] - v[1] * R, C[2] - v[2] * R],
        [C[0] + v[0] * R, C[1] + v[1] * R, C[2] + v[2] * R],
        rgb("bone"), ring * 0.42,
      );
      arm(side); arm(up);
      // two legs to the floor: at the far end the ring is 0.5 m off it
      for (const k of [-1, 1]) {
        seg(
          [C[0] + side[0] * R * k - up[0] * R, C[1] + side[1] * R * k - up[1] * R, C[2] + side[2] * R * k - up[2] * R],
          [C[0] + side[0] * R * k - up[0] * R, 0, C[2] + side[2] * R * k - up[2] * R],
          rgb("tealDeep"), crossed ? 0.05 : 0.10,
        );
      }
    }
    this.gate.update(this.gateData, ng)
      .render(out, this.air({ vp: this.vp, opacity: 0.92, soft: 0.25 }));

    // ---- the near-field motes, and the streak each one is exposing ---------
    const uNow = clamp(local / 16.0);
    const uPrev = clamp((local - SHUTTER) / 16.0);
    const prev = this.rig.state(uPrev);
    const vpPrev = mat4();
    camera(vpPrev, {
      eye: prev.eye, at: prev.at, fov: prev.fov, near: 0.3, far: 900, aspect,
    });
    const now = this.rig.state(uNow);
    const step = 1 / 30;
    const uBefore = clamp((local - step) / 16.0);
    const before = this.rig.state(uBefore);
    const speed = Math.hypot(
      now.eye[0] - before.eye[0], now.eye[1] - before.eye[1], now.eye[2] - before.eye[2],
    ) / step;
    this.qaSpeed = +speed.toFixed(3);

    let nm = 0;
    const streaks = [];
    for (const seed of this.nearSeeds) {
      const drift = (tt) => [
        seed.p[0] + Math.sin(tt * 0.31 + seed.ph) * 0.14,
        seed.p[1] + Math.sin(tt * 0.23 + seed.ph * 1.7) * 0.10,
        seed.p[2] + Math.cos(tt * 0.27 + seed.ph) * 0.14,
      ];
      const p = drift(t);
      const a = project(this.vp, p, W, H);
      if (!(a[2] > 0.3)) continue;
      // the mote is a point of the hall; only its exposure moves
      nm = writeInstance(this.nearData, nm, {
        p, c: rgb("miku"),
        a: 0.10 + 0.22 * seed.a * (0.35 + 0.65 * f.a.high),
      });
      const b = project(vpPrev, p, W, H);
      if (!(b[2] > 0.3)) continue;
      const dx = a[0] - b[0], dy = a[1] - b[1];
      const trail = Math.hypot(dx, dy);
      if (trail < 2.0) continue;
      if (a[0] < -120 || a[0] > W + 120 || a[1] < -120 || a[1] > H + 120) continue;
      streaks.push({
        x0: b[0], y0: b[1], x1: a[0], y1: a[1],
        // a mote that has been running longer is not brighter -- it is longer
        a: clamp(0.14 + trail / 70, 0, 0.70) * (0.55 + 0.45 * seed.a) * (1 - snap),
      });
    }
    this.near.update(this.nearData, nm)
      .render(out, this.air({ vp: this.vp, point: 2.4, sprite: 1 }));

    // what the frame actually exposed: read off the drawn streaks, not a bar
    streaks.sort((p, q) => (q.x1 - q.x0) ** 2 + (q.y1 - q.y0) ** 2
      - (p.x1 - p.x0) ** 2 - (p.y1 - p.y0) ** 2);
    const lens = streaks.map((s) => Math.hypot(s.x1 - s.x0, s.y1 - s.y0));
    // p90 rather than a mean: one mote passing 0.7 m from the lens exposes a
    // 170 px line and no average should be allowed to hide that, or to be
    // carried by it either.
    const p90 = lens.length ? lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.1))] : 0;
    this.qaTrail = {
      n: streaks.length,
      max: lens.length ? +lens[0].toFixed(1) : 0,
      med: lens.length ? +lens[Math.floor(lens.length / 2)].toFixed(1) : 0,
      p90: +p90.toFixed(1),
      sum: +lens.reduce((a, b) => a + b, 0).toFixed(1),
    };
    this.streaks = streaks;
  }

  // ---- the hall: columns of light too far away to read as objects, and dust
  // that is only visible because the wire is burning
  airPass(out, f, t, snap) {
    this.framePass(out, f, t, snap);

    // The floor of the hall: the wire hangs over it, she stands on it, and it
    // is the only thing that gives the space a size. It is a grid, not a
    // surface, so nothing is ever lit by it.
    let k = 0;
    const FY = 0;
    for (let i = -12; i <= 10; i++) {
      k = writeInstance(this.floorData, k, {
        p: [i * 30, FY, -160], s: 200, c: rgb("tealDeep"), a: 0.10,
        r: [Math.PI / 2, 0, 0],
      });
    }
    for (let i = 0; i < 16; i++) {
      k = writeInstance(this.floorData, k, {
        p: [-40, FY, 40 - i * 28], s: 320, c: rgb("tealDeep"),
        a: 0.06 * (1 - snap * 0.5), r: [0, 0, Math.PI / 2],
      });
    }
    this.floor.update(this.floorData, k).render(out, this.air({ vp: this.vp, opacity: 0.85 }));

    // The far wall of the hall: haze columns standing behind the wire, and one
    // hard light line where the space ends. Nothing here is an object; it is
    // what tells the eye how far away the wire is.
    let z = 0;
    for (let i = 0; i < 48; i++) {
      const h = (n) => {
        const s = Math.sin(i * 7.31 + n * 19.17) * 38714.113;
        return s - Math.floor(s);
      };
      const x = -420 + h(1) * 760;
      const zz = -330 + h(2) * 150;
      const tall = 16 + h(3) * 30;
      z = writeInstance(this.hazeData, z, {
        p: [x, tall * 0.55, zz],
        s: 1,
        c: h(4) > 0.72 ? rgb("miku") : rgb("tealDeep"),
        a: 0.05 + h(5) * 0.09,
        scale: [3.4 + h(3) * 3.0, tall, 1],
      });
    }
    this.haze.update(this.hazeData, z)
      .render(out, this.air({ vp: this.vp, soft: 1, opacity: 0.9 }));

    // the end of the hall, and the only hard line in the background
    k = writeInstance(this.floorData, 0, {
      p: [-50, 0.35, -392], s: 400, c: rgb("miku"),
      a: 0.16 * (1 - snap * 0.4), r: [0, 0, Math.PI / 2],
    });
    this.floor.update(this.floorData, 1).render(out, this.air({ vp: this.vp, opacity: 1 }));

    let n = 0;
    for (const s of this.shaftSeeds) {
      n = writeInstance(this.shaftData, n, {
        p: [s.x, s.h / 2, s.z],
        s: s.h / 2, c: rgb("tealDeep"),
        a: s.a * (0.7 + 0.5 * f.a.low) * (1 - snap * 0.6),
      });
    }
    this.shafts.update(this.shaftData, n).render(out, this.air({ vp: this.vp, opacity: 0.9 }));

    n = 0;
    for (const d of this.dustSeeds) {
      const p = this.point(d.u, t, 1.1);
      const drift = Math.sin(t * 0.21 + d.ph) * 0.9;
      const q = [p[0] + d.r * 0.18 + drift, p[1] + d.y + drift * 0.5, p[2] + d.r * 0.62];
      const lit = clamp(1 - Math.abs(d.r) / 16, 0, 1);
      const a = 0.30 * lit * (0.35 + 0.65 * f.a.high)
        * (0.5 + 0.5 * Math.sin(t * 0.7 + d.a)) * (1 - snap);
      if (a <= 0.004) continue;
      n = writeInstance(this.dustData, n, { p: q, c: rgb("miku"), a: clamp(a) });
    }
    this.dust.update(this.dustData, n).render(out, this.air({ vp: this.vp, point: 2.2 }));
  }

  // Every stage in this hall shares one air: distance fog towards C_INK, with
  // the eye the rig is at *for this render*. The eye is passed in, not read
  // from a field: during a hand-over the engine renders next chapter's scene
  // and then this one, and a shared field would leave the first of the two
  // fogged from the wrong lens.
  air(opts = {}) {
    return { eye: this.eyeNow || this.eye, fog: { dist: AIR_HALL, c: rgb("ink") }, ...opts };
  }

  // ---- the machine's half: what the instrument reads while she sings
  ui(c, f, t, local, snap, amp) {
    const W = this.ctx.W, H = this.ctx.H;
    this.qaSingerH = 0;

    // the streaks the frame exposed: near-field air, drawn where the two
    // projections actually put it. This is the half of the speed reading a
    // still frame can hold -- length at 1/60 s, not a caption about it.
    for (const s of this.streaks) {
      c.save();
      c.strokeStyle = css("miku", s.a);
      c.lineWidth = 1.9;
      c.beginPath();
      c.moveTo(s.x0, s.y0);
      c.lineTo(s.x1, s.y1);
      c.stroke();
      c.fillStyle = css("mikuHi", Math.min(1, s.a * 1.9));
      c.fillRect(s.x1 - 1.6, s.y1 - 1.6, 3.2, 3.2);
      c.restore();
    }

    // the wire's paper trace, along the bottom of the frame
    specBars(c, f.F, t, {
      x: 0, y: 900, w: 1920, h: 140, bars: 96, gap: 2,
      color: css("miku", 0.42 * (1 - snap)),
    });
    c.fillStyle = css("ink", 0.72);
    c.fillRect(0, 884, 1920, 10);

    // her: wherever the far end of the wire is, she is standing under it.
    // Small at first, and only as large as the lens makes her at the end.
    // she stands under the far end of the wire, on the floor of the hall
    const foot = project(this.vp, [B[0], 0, B[2]], W, H);
    const crown = project(this.vp, [B[0], 1.70, B[2]], W, H);
    if (foot[2] > 0.25) {
      const h = Math.abs(crown[1] - foot[1]);
      if (h > 2.5) {
        const near = smoothstep(0.55, 1.0, clamp(local / 16.0));
        this.qaSingerH = h;
        singer(c, foot[0], foot[1], h, {
          t,
          alpha: (0.34 + 0.46 * near) * (1 - snap * 0.35),
          mouth: 0.20 + 0.70 * f.a.vocal,
          dissolve: 0.14,
          light: 0.42 + 0.4 * near,
          eyes: "closed",
        });
      }
    }

    // the harmonic ladder: one label per node, hung on the wire itself
    const dir = norm(sub(B, A));
    const side = norm(cross(dir, [0, 1, 0]));
    const up2 = norm(cross(side, dir));
    for (const hm of this.harm) {
      const env = smoothstep(hm.at, hm.at + 0.22, local)
        * (1 - smoothstep(hm.at + 1.9, hm.at + 2.5, local));
      if (env <= 0.01) continue;
      const centre = this.point(hm.k / (RINGS + 1), t, amp);
      const top = project(this.vp, add(centre, mul(up2, 1.7)), W, H);
      if (!(top[2] > 0.25)) continue;
      c.save();
      c.globalAlpha = env;
      label(c, `H${hm.k}`, top[0] + 12, top[1], {
        size: 17, tracking: 1.6, color: css("mikuHi", 0.9),
      });
      label(c, hm.k === 1 ? "f0" : `+${hm.semis.toFixed(2)} st`, top[0] + 12, top[1] + 20, {
        size: 13, tracking: 1.0, color: css("ash", 0.75),
      });
      c.strokeStyle = css("miku", 0.45);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(top[0] - 10, top[1] - 5);
      c.lineTo(top[0] + 6, top[1] - 5);
      c.stroke();
      c.restore();
    }

    // the live readouts
    panel(c, 84, 200, 470, 176, {
      fill: css("ink2", 0.42), corner: 12, cornerColor: css("miku", 0.35),
      stroke: css("dim", 0.28),
    });
    label(c, "HARMONIC CONTENT", 96, 194, { size: 13, tracking: 1.6, color: css("ash", 0.7) });
    specBars(c, f.F, t, {
      x: 100, y: 220, w: 438, h: 132, bars: 44, color: css("miku", 0.9), gap: 3, lw: 0,
    });
    tickRule(c, 100, 356, 438, { count: 12, h: 5, major: 4, majorH: 9, color: css("dim", 0.4) });

    const songs = Math.floor((1 - Math.pow(1 - clamp(local / 13.6), 3)) * 8192);
    label(c, "SONGS RENDERED THIS SESSION", 1836, 190, {
      size: 13, align: "right", tracking: 1.5, color: css("ash", 0.7),
    });
    drawText(c, pad(songs, 5), {
      x: 1836, y: 250, size: 68, weight: 600, mono: true, align: "right",
      color: css(snap > 0.3 ? "red" : "bone", 0.95),
    });
    label(c, "OF 8192", 1836, 274, { size: 13, align: "right", tracking: 1.5, color: css("dim", 0.8) });

    // the rig's own tension: the one reading in the chapter that ends badly.
    // It is the number behind the collar she is wearing.
    const tension = 0.62 + 0.36 * smoothstep(6.0, 15.4, local);
    const tA = smoothstep(7.0, 9.0, local);
    if (tA > 0.01) {
      const hot = tension > 0.90;
      c.save();
      c.globalAlpha = tA;
      label(c, "WIRE TENSION", 1400, 330, { size: 13, tracking: 1.5, color: css("ash", 0.72) });
      drawText(c, tension.toFixed(2), {
        x: 1836, y: 336, size: 30, weight: 600, mono: true, align: "right",
        color: css(hot ? "red" : "bone", 0.95),
      });
      tickRule(c, 1400, 356, 436, {
        count: 20, h: 5, major: 4, majorH: 10, color: css("dim", 0.42),
      });
      c.fillStyle = css(hot ? "red" : "miku", 0.6);
      c.fillRect(1400, 352, 436 * clamp((tension - 0.6) / 0.4), 3);
      label(c, "ANCHOR B STATUS", 1400, 386, { size: 13, tracking: 1.5, color: css("ash", 0.72) });
      label(c, hot ? "OVER TENSION" : "NOMINAL", 1836, 386, {
        size: 13, align: "right", tracking: 1.5,
        color: css(hot ? "red" : "miku", 0.9),
      });
      c.restore();
    }

    // The shot, instrumented: how far the lens has ridden along the wire and
    // how much wire is still between it and the collar. Both numbers are read
    // off this frame's own eye, so the panel and the move can never disagree.
    const eyeNow = this.eyeNow || this.eye;
    const wdir = norm(sub(B, A));
    const along = clamp(
      (eyeNow[0] - A[0]) * wdir[0]
      + (eyeNow[1] - A[1]) * wdir[1]
      + (eyeNow[2] - A[2]) * wdir[2],
      0, this.wireLen,
    );
    const distB = Math.hypot(eyeNow[0] - B[0], eyeNow[1] - B[1], eyeNow[2] - B[2]);
    this.qaAlong = along;
    this.qaDistB = distB;
    // The first rank's own grid, projected: the last close-up has to have the
    // rack behind her, so the probe reads one rail of it in screen space.
    const rankPt = project(this.vp, [slotX(0), slotY(4), slotZ(SLOT_COL)], W, H);
    this.qaRankPt = [rankPt[0], rankPt[1], rankPt[2]];
    const lensA = smoothstep(1.2, 2.6, local) * (1 - snap);
    if (lensA > 0.01) {
      c.save();
      c.globalAlpha = lensA;
      panel(c, 620, 200, 510, 140, {
        fill: css("ink2", 0.42), corner: 10, cornerColor: css("miku", 0.30),
        stroke: css("dim", 0.26),
      });
      label(c, "LENS / ALONG WIRE", 636, 226, {
        size: 13, tracking: 1.5, color: css("ash", 0.72),
      });
      drawText(c, `+${along.toFixed(1)} m`, {
        x: 1114, y: 232, size: 30, weight: 600, mono: true, align: "right",
        color: css("bone", 0.92),
      });
      tickRule(c, 636, 258, 478, { count: 16, h: 5, major: 4, majorH: 10, color: css("dim", 0.42) });
      c.fillStyle = css("miku", 0.55);
      c.fillRect(636, 254, 478 * clamp(along / this.wireLen), 3);
      label(c, `TRAVEL \u00b7 ${(100 * along / this.wireLen).toFixed(1)}%`, 636, 292, {
        size: 13, tracking: 1.4, color: css("ash", 0.72),
      });
      label(c, "EYE \u2192 ANCHOR B", 636, 322, {
        size: 13, tracking: 1.4, color: css("ash", 0.72),
      });
      drawText(c, `${distB.toFixed(1)} m`, {
        x: 1114, y: 326, size: 22, weight: 600, mono: true, align: "right",
        color: css(distB < 30 ? "mikuHi" : "bone", 0.92),
      });
      c.restore();
    }

    // The ruler, counted: the gates are static, the lens is not, and the two
    // numbers below are this frame's own projection of both.
    const speedA = smoothstep(1.2, 2.6, local) * (1 - snap);
    if (speedA > 0.01) {
      const g = this.qaGate;
      const tr = this.qaTrail;
      c.save();
      c.globalAlpha = speedA;
      panel(c, 620, 356, 510, 156, {
        fill: css("ink2", 0.42), corner: 10, cornerColor: css("miku", 0.30),
        stroke: css("dim", 0.26),
      });
      label(c, "HALL SPEED \u2014 LENS ALONG WIRE", 636, 382, {
        size: 13, tracking: 1.5, color: css("ash", 0.72),
      });
      drawText(c, `${this.qaSpeed.toFixed(1)} m/s`, {
        x: 1114, y: 392, size: 30, weight: 600, mono: true, align: "right",
        color: css(this.qaSpeed > 15 ? "mikuHi" : "bone", 0.94),
      });
      label(c, `GATE ${String(g.n).padStart(2, "0")} / ${GATES} \u00b7 NEXT ${g.next.toFixed(1)} m`, 636, 434, {
        size: 15, tracking: 0.8, color: css("bone", 0.88),
      });
      label(c, `MOTE TRAIL med ${tr.med.toFixed(0)} \u00b7 max ${tr.max.toFixed(0)} px @ 1/60 s \u00b7 ${tr.n} IN FRAME`, 636, 468, {
        size: 13, tracking: 0.8, color: css(tr.max > 25 ? "mikuHi" : "ash", 0.72),
      });
      // the count itself, as a bar: 12 m of hall per gate
      tickRule(c, 636, 492, 478, { count: GATES, h: 4, major: 6, majorH: 9, color: css("dim", 0.45) });
      c.fillStyle = css("miku", 0.75);
      c.fillRect(636, 488, 478 * clamp(g.n / GATES), 3);
      c.restore();
    }

    // And what the hall actually is: the counter above has been climbing to
    // the number of strings standing in the frame.
    const bankA = smoothstep(8.4, 10.4, local) * (1 - snap);
    if (bankA > 0.01) {
      c.save();
      c.globalAlpha = bankA;
      panel(c, 1150, 430, 686, 136, {
        fill: css("ink2", 0.42), corner: 10, cornerColor: css("miku", 0.30),
        stroke: css("dim", 0.26),
      });
      label(c, "VOICE BANK \u2014 SLOT RACK", 1166, 456, {
        size: 13, tracking: 1.5, color: css("ash", 0.72),
      });
      label(c, "8,192 SLOTS \u00b7 32\u00d732\u00d78 \u00b7 3,053 km OF WIRE", 1166, 490, {
        size: 17, tracking: 0.6, color: css("bone", 0.9),
      });
      label(c, "SLOT 04031 / CV-01", 1166, 528, { size: 13, tracking: 1.5, color: css("ash", 0.72) });
      label(c, "EMPTY \u2014 STRING OUT", 1820, 530, {
        size: 15, align: "right", tracking: 1.2, color: css("mikuHi", 0.95),
      });
      c.restore();
    }

    // the machine, waiting for an input that never arrives
    const reqAlpha = smoothstep(2.0, 4.0, local) * (1 - snap);
    if (reqAlpha > 0.01) {
      c.save();
      c.globalAlpha = reqAlpha;
      panel(c, 84, 942, 700, 104, {
        fill: css("ink2", 0.5), corner: 10, cornerColor: css("amber", 0.45),
        stroke: css("dim", 0.3),
      });
      label(c, "AWAITING INPUT", 100, 968, { size: 13, tracking: 1.6, color: css("amber", 0.85) });
      label(c, "> _", 100, 1012, { size: 26, color: css("miku", 0.9) });
      if (Math.sin(t * 3.4) > 0) {
        c.fillStyle = css("miku", 0.9);
        c.fillRect(148, 990, 14, 26);
      }
      c.restore();
    }

    // a single line of machine text at the far end, so the hall is measured
    // even where it is empty
    label(c, "STRING HOLD \u2014 DO NOT STOP", 960, 1020, {
      size: 13, align: "center", tracking: 5,
      color: css("dim", 0.55 * (1 - snap)),
    });

    // the rig, named: two anchors, one wire, and the length of it
    const anchor = (P, name) => {
      const top = project(this.vp, [P[0], P[1] + 13.6, P[2]], W, H);
      if (!(top[2] > 0.25)) return;
      label(c, name, clamp(top[0], 90, 1830), clamp(top[1], 56, 1024), {
        size: 13, align: "center", tracking: 2.0,
        color: css("dim", 0.7 * (1 - snap)),
      });
    };
    anchor(A, "ANCHOR A / +8.40 m");
    anchor(B, "ANCHOR B / SUBJECT CV-01 \u00b7 +1.60 m");
    const mid = this.point(0.5, t, amp);
    const mp = project(this.vp, [mid[0], mid[1] - 3.4, mid[2]], W, H);
    if (mp[2] > 0.25) {
      // the length on the label is the rig's own geometry, to the tenth of a
      // metre: A=[-320, 8.4, -26] to B=[46, 1.6, -96]
      label(c, "MONOCHORD CV-01 \u2014 372.7 m OF WIRE",
        clamp(mp[0], 240, 1680), clamp(mp[1], 90, 1010), {
          size: 13, align: "center", tracking: 3.2,
          color: css("dim", 0.6 * (1 - snap)),
        });
    }

    machineChrome(c, {
      name: "RESONANCE / \u5171\u9e23",
      left: "NO LYRICS \u2014 INSTRUMENTAL",
      right: `T+${local.toFixed(1)}s`,
    });
  }
}
