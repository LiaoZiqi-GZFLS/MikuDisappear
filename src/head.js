// HEAD-01: the machine at both ends of CV-01's life.
//
// `birth` prints her with it; `erode` reads her away with it. Rule 6 of the
// film's 3D grammar says the same object may only have one drawing, so the bay
// -- 24 ribs, 4 rings, 4 floor rings, 24 spokes and the head's own ring -- and
// the 48-cell record on the floor are built here, once, with a direction:
// `dir = +1` means the head has already passed what is *below* it (reading
// up), `dir = -1` means it has passed what is above it (printing down).
//
// The two speeds are deliberately not the same, and both panels print them:
// printing is a render (2.020 m in 1.70 s), reading is an abrasion (2.020 m in
// 12.60 s). Being born takes a second and a half; being deleted takes twelve
// and a half. The asymmetry is the chapter.

import { writeInstance } from "./gl3d.js";

export const HEAD = {
  serial: "HEAD-01",
  radius: 7.20,      // m, half the width of the bay
  height: 13.20,     // m, the floor to the top of the ribs
  ribs: 24,
  ribBands: 8,       // each rib is 8 segments, so the room reads band by band
  seg: 36,           // segments in one ring
  rings: [0.12, 4.40, 8.80, 13.06],
  floorRings: [1.80, 3.60, 5.40, 7.20],
  spokes: 24,
  marks: 48,         // cells of the record, one per 0.042 m of travel
  markR: 6.30,       // m, where the record is written on the floor
  h0: 0.030,         // m, the head when it is armed at the floor
  h1: 2.050,         // m, and after it has passed her crown
  printDur: 1.70,    // s, the whole travel in `birth` -- a render
  arm: 0.55,         // s the head holds in `erode` before it climbs
  dur: 12.60,        // s, the whole climb in `erode` -- 0.160 m/s
  air: 46,           // m at which the bay's air is ~63 % ink
};
HEAD.travel = HEAD.h1 - HEAD.h0;
HEAD.printRate = HEAD.travel / HEAD.printDur;
HEAD.readRate = HEAD.travel / HEAD.dur;
HEAD.instances = HEAD.ribs * HEAD.ribBands
  + HEAD.rings.length * HEAD.seg
  + HEAD.floorRings.length * HEAD.seg
  + HEAD.spokes + HEAD.seg;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const TAU = Math.PI * 2;

// Where the head is, for either direction of travel. `dir < 0` prints down
// from above her crown; `dir > 0` reads up from the floor.
export function headSweep(p, dir = 1) {
  const u = clamp01(p);
  return dir > 0 ? HEAD.h0 + HEAD.travel * u : HEAD.h1 - HEAD.travel * u;
}

// Solve the aim point that puts a subject at (sx, sy) of the frame for a given
// lens. The shot's keys name an *eye* and a framing; the aim point is derived
// from the direction to the subject, so the composition cannot drift while the
// camera arcs -- and it works from above her as well as from her own height,
// because it turns about the lens's own right and up axes instead of
// flattening the look first. `birth` and `erode` both compose with this, which
// is why the two shots of the same machine hold her at the same place.
export function aimAt(eye, fov, sx, sy, s = [0, HEAD.h1 / 2, 0]) {
  const v = [s[0] - eye[0], s[1] - eye[1], s[2] - eye[2]];
  const L = Math.hypot(v[0], v[1], v[2]) || 1;
  const h = [v[0] / L, v[1] / L, v[2] / L];
  const r = [-h[2], 0, h[0]];                  // the lens's right, roll-free
  const rL = Math.hypot(r[0], r[1], r[2]) || 1;
  r[0] /= rL; r[1] /= rL; r[2] /= rL;
  const u = [                                  // and its up: r x h
    r[1] * h[2] - r[2] * h[1],
    r[2] * h[0] - r[0] * h[2],
    r[0] * h[1] - r[1] * h[0],
  ];
  const t = Math.tan(fov / 2);
  // A subject at 0.60 of the width means the lens is turned a tenth of a frame
  // to its own left of her; sy does the same vertically.
  const tanYaw = 2 * (sx - 0.5) * (16 / 9) * t;
  const tanPitch = (2 * sy - 1) * t;
  const d = [
    h[0] - tanYaw * r[0] + tanPitch * u[0],
    h[1] - tanYaw * r[1] + tanPitch * u[1],
    h[2] - tanYaw * r[2] + tanPitch * u[2],
  ];
  const dL = Math.hypot(d[0], d[1], d[2]) || 1;
  return [
    eye[0] + (d[0] / dL) * 6,
    eye[1] + (d[1] / dL) * 6,
    eye[2] + (d[2] / dL) * 6,
  ];
}

// The bay, written into an instance buffer in one fixed order: ribs, rings,
// floor rings, spokes, then the head's own ring. A rail the head has passed
// carries light -- it has been printed, or it has been read -- and everything
// on the other side of it is dark structure. The light is not decoration: it
// is the head's own height, drawn on the room it is measuring.
//
// `gain` scales every alpha together, so a cut-in can fade the whole machine
// in without changing any of its geometry.
export function writeBay(data, i, {
  head, dir = 1, voice = 1, gain = 1,
  lit, dim, dimScale = 0.42,
}) {
  const chord = 2 * HEAD.radius * Math.sin(Math.PI / HEAD.seg);
  // A segment is a unit line along Y; these two rotations lay one flat in the
  // XZ plane, either tangential (a ring) or radial (a spoke).
  const ringRot = (m) => [0, -(m + Math.PI / 2), -Math.PI / 2];
  const radialRot = (m) => [0, -m, -Math.PI / 2];
  const rail = (p, rot, scale, on, base) => {
    i = writeInstance(data, i, {
      p, s: 1, c: on ? lit : dim,
      a: base * gain * (on ? 1.0 : dimScale), r: rot, scale,
    });
  };
  const passed = (y) => (dir > 0 ? y <= head : y >= head);

  // 24 ribs, split into 8 bands, so the room is read band by band
  const band = HEAD.height / HEAD.ribBands;
  for (let k = 0; k < HEAD.ribs; k++) {
    const ang = (k / HEAD.ribs) * TAU;
    const x = Math.cos(ang) * HEAD.radius, z = Math.sin(ang) * HEAD.radius;
    for (let b = 0; b < HEAD.ribBands; b++) {
      const y0 = b * band;
      rail([x, y0 + band / 2, z], [0, 0, 0], [1, band / 2, 1],
        passed(y0 + band), 0.44);
    }
  }
  // four rings up the room, and four on the floor
  for (let r = 0; r < HEAD.rings.length; r++) {
    const y = HEAD.rings[r];
    const on = passed(y);
    for (let k = 0; k < HEAD.seg; k++) {
      const m = ((k + 0.5) / HEAD.seg) * TAU;
      rail([Math.cos(m) * HEAD.radius, y, Math.sin(m) * HEAD.radius],
        ringRot(m), [1, chord / 2, 1], on, r === 0 ? 0.58 : 0.34);
    }
  }
  for (let r = 0; r < HEAD.floorRings.length; r++) {
    const rad = HEAD.floorRings[r];
    const ch = 2 * rad * Math.sin(Math.PI / HEAD.seg);
    for (let k = 0; k < HEAD.seg; k++) {
      const m = ((k + 0.5) / HEAD.seg) * TAU;
      rail([Math.cos(m) * rad, 0.02, Math.sin(m) * rad],
        ringRot(m), [1, ch / 2, 1], true, 0.20);
    }
  }
  for (let k = 0; k < HEAD.spokes; k++) {
    const ang = (k / HEAD.spokes) * TAU;
    const r0 = HEAD.floorRings[0], r1 = HEAD.radius;
    const mid = (r0 + r1) / 2;
    rail([Math.cos(ang) * mid, 0.02, Math.sin(ang) * mid],
      radialRot(ang), [1, (r1 - r0) / 2, 1], true, 0.13);
  }
  // the head's own ring: the room, lit where it is being measured
  for (let k = 0; k < HEAD.seg; k++) {
    const m = ((k + 0.5) / HEAD.seg) * TAU;
    rail([Math.cos(m) * HEAD.radius, head, Math.sin(m) * HEAD.radius],
      ringRot(m), [1, chord / 2, 1], true, 0.95 * voice);
  }
  return i;
}

// The record on the floor: one cell for every 0.042 m of travel, written in
// the direction the head moves. It is the same 48 cells in both chapters --
// `birth` writes them, `erode` reads them.
export function writeRecord(data, i, {
  cells, lit, dim, gain = 1,
  marks = HEAD.marks, radius = HEAD.markR,
  litAlpha = 0.95, dimAlpha = 0.20,
}) {
  for (let k = 0; k < marks; k++) {
    const ang = (k / marks) * TAU + Math.PI / 2;
    const on = k < cells;
    i = writeInstance(data, i, {
      p: [Math.cos(ang) * radius, 0.03, Math.sin(ang) * radius],
      s: 1, c: on ? lit : dim,
      a: gain * (on ? litAlpha : dimAlpha),
      r: [Math.PI / 2, -(ang + Math.PI / 2), 0],
      scale: [on ? 0.34 : 0.22, 0.035, 1],
    });
  }
  return i;
}

// The head itself: a ring, a hairline through it, and a disc of light that
// falls on whatever it is passing. Three instances, both chapters.
export function writeHeadRing(data, i, {
  head, voice = 1, gain = 1, radius = HEAD.radius,
  ring, mid, disc,
}) {
  i = writeInstance(data, i, {
    p: [0, head, 0], s: 1, c: ring, a: 0.24 * voice * gain,
    scale: [radius, 0.030, 1],
  });
  i = writeInstance(data, i, {
    p: [0, head, 0], s: 1, c: mid, a: 0.50 * voice * gain,
    scale: [radius, 0.0055, 1],
  });
  i = writeInstance(data, i, {
    p: [0, head, 0], s: 1, c: disc, a: 0.045 * voice * gain,
    r: [Math.PI / 2, 0, 0], scale: [radius * 0.86, radius * 0.86, 1],
  });
  return i;
}
