// The circuit: SLOT 04031 and the OK key are the two ends of one 77.0 m run
// of cable -- one core, six wound strands, twenty-six segments, one pulse.
//
// Three chapters see that run, each from its own end:
//   plea   1 m from the button   the whole run, 5.26 s per pulse
//   beg    at the door           the pulse dies at u = 0.86, 10.8 m short
//   error  at the key            0.31 s, running the other way
//
// The film's rule 6 says the same circuit may only have one drawing, so the
// recipe lives here: the strand count, the segment count, the twist, the
// colours and the pulse are shared. Each room hands the run a spine in its own
// space, because each room is a different place the same wire passes through.

import { writeInstance } from "./gl3d.js";

export const CIRCUIT = {
  strands: 7,           // one core + six wound strands
  segs: 26,             // segments per strand, in every room
  meters: 77.0,         // the run's length, as the readouts name it
  pulseSeconds: 5.26,   // plea: a pulse takes this long to crawl the run
  pulseTail: 1.84,      // ... and the wire is quiet this long in between
  breakAt: 0.86,        // beg: where the pulse dies (10.8 m short of the key)
  breakShortM: 10.8,
  acceptSeconds: 0.31,  // error: the reverse run, key to socket
  twist: 3.5,           // turns of the wound strands over the whole run
  dashWidth: 0.055,     // the pulse's own width, in u
};

const TAU = Math.PI * 2;

const cubic = (p, u) => {
  const v = 1 - u;
  const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
  return [
    p[0][0] * a + p[1][0] * b + p[2][0] * c + p[3][0] * d,
    p[0][1] * a + p[1][1] * b + p[2][1] * c + p[3][1] * d,
    p[0][2] * a + p[1][2] * b + p[2][2] * c + p[3][2] * d,
  ];
};

const lerp3 = (a, b, u) => [
  a[0] + (b[0] - a[0]) * u,
  a[1] + (b[1] - a[1]) * u,
  a[2] + (b[2] - a[2]) * u,
];

// One run. `p0`/`p3` are the two ends in the room's own space; `p1`/`p2` bend
// the spine, and a spine that is not given them is a straight line. `sag`
// drops the middle of the run along `up`, and the wound strands ride a frame
// that follows the spine, so the same recipe reads as a cable in any room.
export function runOf({
  p0, p3, p1 = null, p2 = null, sag = 0, up = [0, 1, 0],
  spread = null, twist = CIRCUIT.twist,
}) {
  const p = [
    p0,
    p1 || lerp3(p0, p3, 1 / 3),
    p2 || lerp3(p0, p3, 2 / 3),
    p3,
  ];
  const rad = typeof spread === "function"
    ? spread
    : (s) => (s === 0 ? 0 : spread == null ? 0.11 + 0.035 * (s % 3) : spread);
  const ul = Math.hypot(up[0], up[1], up[2]) || 1;
  const U = [up[0] / ul, up[1] / ul, up[2] / ul];

  const at = (u, s = 0) => {
    const c = cubic(p, u);
    const e = 1e-3;
    const a = cubic(p, Math.max(0, u - e));
    const b = cubic(p, Math.min(1, u + e));
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    // n = t x up, and the second axis of the frame follows from n x t
    let nx = ty * U[2] - tz * U[1];
    let ny = tz * U[0] - tx * U[2];
    let nz = tx * U[1] - ty * U[0];
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;
    const r = rad(s) * (0.25 + 0.75 * u);
    const tw = u * TAU * twist + s * (TAU / CIRCUIT.strands);
    const ct = Math.cos(tw), st = Math.sin(tw);
    const drop = Math.sin(u * Math.PI) * sag;
    return [
      c[0] + nx * ct * r + bx * st * r - U[0] * drop,
      c[1] + ny * ct * r + by * st * r - U[1] * drop,
      c[2] + nz * ct * r + bz * st * r - U[2] * drop,
    ];
  };
  return { at, spine: (u) => cubic(p, u) };
}

// Write one world-space line into a stage's instance array: the same segment
// writer the three rooms use for the run, so a strand is laid out identically
// wherever it is drawn.
export function writeSeg(arr, i, a, b, col, alpha, width = 1) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz) || 1e-3;
  return writeInstance(arr, i, {
    p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    c: col, a: alpha,
    r: [-Math.asin(Math.max(-1, Math.min(1, dz / l))), 0, Math.atan2(-dx, dy)],
    scale: [width, l / 2, 1],
  });
}

// Fill a stage's buffer with the run -- core first, then the six strands -- and
// hand back where each segment sits on the run (u) and whether it is the core,
// so a chapter can light the pulse without re-deriving the route.
export function buildRun(data, i0, run, {
  core, strand, width = 1, segs = CIRCUIT.segs, uArr = null, coreArr = null,
} = {}) {
  let i = i0;
  for (let s = 0; s < CIRCUIT.strands; s++) {
    for (let k = 0; k < segs; k++) {
      writeSeg(data, i, run.at(k / segs, s), run.at((k + 1) / segs, s),
        s === 0 ? core : strand, 0, width);
      if (uArr) uArr[i - i0] = (k + 0.5) / segs;
      if (coreArr) coreArr[i - i0] = s === 0 ? 1 : 0;
      i++;
    }
  }
  return i;
}

// One pulse profile for all three rooms: a Gaussian head on the run, with an
// optional echo the machine leaves behind when it executes an instruction.
export function pulseAt(u, head, width = CIRCUIT.dashWidth, echo = 0) {
  const head1 = Math.exp(-Math.pow((u - head) / width, 2));
  if (echo <= 0) return head1;
  return head1 + echo * Math.exp(-Math.pow((u - head - 0.085) / 0.11, 2));
}

// plea's schedule: a pulse leaves the socket every pulseSeconds + pulseTail,
// and the value it returns runs from 0 (at the socket) to 1 (at the key) and
// then past it, off the run, where nothing draws it.
export function pulsePhase(t, seconds = CIRCUIT.pulseSeconds, tail = CIRCUIT.pulseTail) {
  return (t % (seconds + tail)) / seconds;
}
