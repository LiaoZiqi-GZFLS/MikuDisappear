// The specification lattice: her own line drawing, turned back into the line
// segments a machine would draw it with.
//
// The opening needs a body made of *lines* -- not a curve, not a picture. So
// the figure is rasterised once, at load, and read the way a plotter would
// read it:
//
//   * the silhouette trace follows the outermost ink of every row band: that
//     is the outline, tails included, and it is the read that has to survive;
//   * the strokes are vectorised by their own runs -- horizontal runs become
//     the weft (hem, collar, headset, boot rims), vertical runs the warp
//     (tail edges, sleeves, legs);
//   * a handful of long ink runs per row become the scan bars, which is the
//     only thing in the lattice that carries volume rather than edge.
//
// Every run is one segment: one instance, one draw call, and one hash that
// decides when it lands, where it flies in from, and how bright it burns. The
// result is not a wireframe of a model -- it is her drawing, re-read as
// instructions.

import { hash } from "./kit.js";
import { singer } from "./motifs.js";

// A luminance field of the figure, in the film's own drawing. `weight` is the
// stroke weight as a fraction of the height: the hairline pass keeps her
// edges, the fat pass fills her mass.
export function figureRaster({
  w = 250, h = 344, weight = 0.013, deep = "#7d7d7d", t = 0,
} = {}) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d", { willReadFrequently: true });
  c.fillStyle = "#000";
  c.fillRect(0, 0, w, h);
  singer(c, w / 2, h * 0.995, h * 0.98, {
    alpha: 1, color: "#ffffff", accent: "#ffffff", deep, glow: false, t,
    lw: Math.max(1.0, h * weight),
  });
  const src = c.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0, k = 0; i < src.length; i += 4, k++) {
    lum[k] = (src[i] + src[i + 1] + src[i + 2]) / 765;
  }
  return { w, h, lum };
}

const nx = (px, w) => (px + 0.5) / w * 2 - 1;
const ny = (py, h) => 1 - (py + 0.5) / h * 2;

// Maximal runs of ink along one row / column.
function rowRuns(r, y, thr) {
  const { w, lum } = r;
  const out = [];
  let start = -1;
  for (let x = 0; x <= w; x++) {
    const on = x < w && lum[y * w + x] > thr;
    if (on && start < 0) start = x;
    else if (!on && start >= 0) {
      out.push([start, x - 1]);
      start = -1;
    }
  }
  return out;
}

function colRuns(r, x, thr) {
  const { w, h, lum } = r;
  const out = [];
  let start = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && lum[y * w + x] > thr;
    if (on && start < 0) start = y;
    else if (!on && start >= 0) {
      out.push([start, y - 1]);
      start = -1;
    }
  }
  return out;
}

const at = (r, x, y) => (x < 0 || y < 0 || x >= r.w || y >= r.h ? 0 : r.lum[y * r.w + x]);
const peakOf = (r, x0, x1, y) => {
  let m = 0;
  for (let x = x0; x <= x1; x++) m = Math.max(m, at(r, x, y));
  return m;
};
const peakOfCol = (r, y0, y1, x) => {
  let m = 0;
  for (let y = y0; y <= y1; y++) m = Math.max(m, at(r, x, y));
  return m;
};

// The vectoriser: one pass for the outline, one for horizontal strokes, one
// for vertical strokes, one for the scan. It is deliberately dumb -- the
// drawing has already done the hard part.
function vectorise(raster, {
  max = 560, sweep = 3, inkThr = 0.015,
  edgeThr = 0.20, thin = 0.55,
  minH = 4, maxH = 0.38, minV = 4, maxV = 0.46,
  barStep = 11, barMin = 0.13, barMax = 40,
} = {}) {
  const { w, h, lum } = raster;
  const segs = [];
  const used = new Uint8Array(w * h);
  const add = (x0, y0, x1, y1, kind) => {
    // length in the normalised space, not pixels: the scene scales it into
    // metres and a pixel length would put a segment a hundred metres long
    const len = Math.hypot(nx(x1, w) - nx(x0, w), ny(y1, h) - ny(y0, h));
    if (len < 1e-3) return;
    segs.push({
      x0: nx(x0, w), y0: ny(y0, h), x1: nx(x1, w), y1: ny(y1, h),
      vert: Math.abs(y1 - y0) > Math.abs(x1 - x0) ? 1 : 0,
      kind, len,
    });
  };
  const mark = (x0, x1, y, thick) => {
    for (let yy = Math.max(0, y - thick); yy <= Math.min(h - 1, y + thick); yy++) {
      for (let x = x0; x <= x1; x++) used[yy * w + x] = 1;
    }
  };

  // ---- the silhouette: the outermost ink of every row band. Gaps (between a
  // tail and the body, or between the legs) are respected: the trace restarts
  // instead of drawing a line across the hole.
  const trace = { l: null, r: null };
  for (let y = 0; y < h; y += sweep) {
    let xl = -1, xr = -1;
    for (let x = 0; x < w; x++) if (lum[y * w + x] > inkThr) { xl = x; break; }
    for (let x = w - 1; x >= 0; x--) if (lum[y * w + x] > inkThr) { xr = x; break; }
    for (const side of ["l", "r"]) {
      const x = side === "l" ? xl : xr;
      const prev = trace[side];
      if (x < 0) { trace[side] = null; continue; }
      if (prev) {
        const jump = Math.abs(x - prev[1]);
        if (jump <= Math.max(3, w * 0.035)) add(prev[1], prev[2], x, y, "edge");
        else if (jump > w * 0.10) { trace[side] = [x, x, y]; continue; }
      }
      trace[side] = [prev ? prev[1] : x, x, y];
    }
  }

  // ---- the weft: thin horizontal strokes (hem, collar, tie, headset, boot
  // rims, skirt layers). A run only counts as a stroke if the ink above and
  // below it is darker -- otherwise it is the inside of a filled shape.
  for (let y = 1; y < h - 1; y += sweep) {
    for (const [a, b] of rowRuns(raster, y, edgeThr)) {
      const len = b - a + 1;
      if (len < minH || len > w * maxH) continue;
      const peak = peakOf(raster, a, b, y);
      const mid = (a + b) >> 1;
      // a stroke has at least one dark side; a filled area has none
      const above = at(raster, mid, Math.max(0, y - 5));
      const below = at(raster, mid, Math.min(h - 1, y + 5));
      if (above > peak * thin && below > peak * thin) continue;
      let seen = 0;
      for (let x = a; x <= b; x++) seen += used[y * w + x];
      if (seen > len * 0.5) continue;
      mark(a, b, y, 2);
      add(a, y, b, y, "weft");
    }
  }

  // ---- the warp: thin vertical strokes (tail edges, sleeves, legs).
  for (let x = 1; x < w - 1; x += sweep) {
    for (const [a, b] of colRuns(raster, x, edgeThr)) {
      const len = b - a + 1;
      if (len < minV || len > h * maxV) continue;
      const peak = peakOfCol(raster, a, b, x);
      const mid = (a + b) >> 1;
      const left = at(raster, Math.max(0, x - 5), mid);
      const right = at(raster, Math.min(w - 1, x + 5), mid);
      if (left > peak * thin && right > peak * thin) continue;
      let seen = 0;
      for (let y = a; y <= b; y++) seen += used[y * w + x];
      if (seen > len * 0.5) continue;
      for (let y = a; y <= b; y++) {
        for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) used[y * w + xx] = 1;
      }
      add(x, a, x, b, "warp");
    }
  }

  // ---- the volume: one long ink run per row band, top to bottom, so the scan
  // is spread over the whole body instead of clustering in the widest mass.
  let bars = 0;
  for (let y = 4; y < h - 2 && bars < barMax && segs.length < max; y += barStep) {
    let best = null;
    for (const [a, b] of rowRuns(raster, y, inkThr)) {
      const len = b - a + 1;
      if (len >= w * barMin && (!best || len > best[2] - best[0] + 1)) best = [a, b, len];
    }
    if (!best) continue;
    add(best[0], y, best[1], y, "bar");
    bars++;
  }
  return segs;
}

function boundsOf(segs) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const s of segs) {
    x0 = Math.min(x0, s.x0, s.x1);
    x1 = Math.max(x1, s.x0, s.x1);
    y0 = Math.min(y0, s.y0, s.y1);
    y1 = Math.max(y1, s.y0, s.y1);
  }
  return { x0, x1, y0, y1 };
}

// The lattice proper: the strokes above, hashed and normalised so the scene
// can place them in metres.
export function buildLattice({ raster, max = 560, opts = {} } = {}) {
  const segs = vectorise(raster, { max, ...opts });
  const bounds = boundsOf(segs);
  const span = Math.max(1e-6, bounds.y1 - bounds.y0);
  const cx = (bounds.x0 + bounds.x1) / 2;
  const half = Math.max(1e-6, (bounds.x1 - bounds.x0) / 2);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    s.r = hash(i * 12.9898 + s.len * 78.233);
    s.h = (s.y0 - bounds.y0) / span;             // 0 at the floor, 1 at the top
    s.tip = Math.min(1, Math.max(Math.abs(s.x0 - cx), Math.abs(s.x1 - cx)) / half);
  }
  return { segs, bounds };
}

// The two-glyph "01" the figure prints on her arm, as segments, so the mark is
// drawn the same way the body is: it lands with the lattice, it flares once,
// and it is the last thing to fall apart.
export function armMark(cx, cy, s) {
  const w = s * 0.34, h = s * 0.5;
  const out = [];
  for (const [ax, ay, bx, by] of [
    [-w / 2, -h / 2, w / 2, -h / 2],
    [w / 2, -h / 2, w / 2, h / 2],
    [w / 2, h / 2, -w / 2, h / 2],
    [-w / 2, h / 2, -w / 2, -h / 2],
  ]) out.push({ x0: cx + ax, y0: cy + ay, x1: cx + bx, y1: cy + by, vert: ax === bx });
  out.push({ x0: cx + w * 1.35, y0: cy - h / 2, x1: cx + w * 1.35, y1: cy + h / 2, vert: 1 });
  out.push({ x0: cx + w * 0.95, y0: cy - h / 2, x1: cx + w * 1.35, y1: cy - h * 0.24, vert: 0 });
  for (const sgm of out) {
    sgm.len = Math.hypot(sgm.x1 - sgm.x0, sgm.y1 - sgm.y0);
    sgm.r = hash(sgm.x0 * 91.7 + sgm.y0 * 47.3);
    sgm.tip = 1;
    sgm.h = 0.5;
    sgm.kind = "mark";
  }
  return out;
}
