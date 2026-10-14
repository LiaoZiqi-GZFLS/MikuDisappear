// ASCII art: a portrait of Hatsune Miku built out of characters.
//
// There is no bitmap in this project, so the picture itself is code: a
// luminance field (hair, face, eyes, headset, twin tails) is sampled on a
// glyph grid and printed with a density ramp, the way a terminal would print
// a photograph. Dense characters read as light, blanks read as shadow.
//
//   mikuAscii(ctx, x, y, w, { t, alpha, stage, light, reveal })
//
// `stage` erodes the portrait into 0/1 for the deletion scenes; everything is
// cached per (grid, pixel size, stage), so the per-frame cost is one drawImage
// plus a few animated overprints.

import { css } from "./palette.js";
import { clamp, hash, lerp, smoothstep } from "./kit.js";

const TAU = Math.PI * 2;
const RAMP = " .,:;-=+*#%@";

// ------------------------------------------------------------------ geometry

// A close-up: the face carries the frame, the tails run out the sides, and
// the shoulders only enter at the very bottom. At 96 columns the face is ~38
// cells wide, which is what makes the eyes legible in a glyph grid.
const HEAD = { x: 0.5, y: 0.400, rx: 0.200, ry: 0.262 };
const HAIR = { x: 0.5, y: 0.352, rx: 0.292, ry: 0.342 };

function ell(u, v, cx, cy, rx, ry) {
  return Math.hypot((u - cx) / rx, (v - cy) / ry);
}

function segDist(u, v, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = u - ax, wy = v - ay;
  const h = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy || 1e-9));
  return Math.hypot(wx - vx * h, wy - vy * h);
}

function polyDist(u, v, pts) {
  let best = 1e9, bi = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segDist(u, v, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) { best = d; bi = i; }
  }
  return { d: best, t: bi / (pts.length - 1) };
}

function bezier(p0, p1, p2, p3, n = 40) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = 1 - t;
    const a = s * s * s, b = 3 * s * s * t, c = 3 * s * t * t, d = t * t * t;
    out.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ]);
  }
  return out;
}

const quad = (p0, p1, p2, n = 24) => bezier(
  p0,
  [p0[0] + (2 / 3) * (p1[0] - p0[0]), p0[1] + (2 / 3) * (p1[1] - p0[1])],
  [p2[0] + (2 / 3) * (p1[0] - p2[0]), p2[1] + (2 / 3) * (p1[1] - p2[1])],
  p2, n,
);

// The twin tails: the loudest sign of who this is. Cached polylines.
const TAILS = [-1, 1].map((s) => bezier(
  [0.5 + s * 0.300, 0.215],
  [0.5 + s * 0.760, 0.245],
  [0.5 + s * 0.720, 0.760],
  [0.5 + s * 0.470, 1.060],
  52,
));

// Short strands that frame the face on their way down past the jaw.
const LOCKS = [-1, 1].map((s) => bezier(
  [0.5 + s * 0.255, 0.130],
  [0.5 + s * 0.330, 0.260],
  [0.5 + s * 0.315, 0.480],
  [0.5 + s * 0.285, 0.680],
  26,
));

// The fringe: five tapered strands with bright edges, tips just above the eyes.
const BANGS = [
  { x: 0.315, y: 0.130, len: 0.300, w: 0.075, bend: 0.026 },
  { x: 0.400, y: 0.078, len: 0.245, w: 0.070, bend: -0.012 },
  { x: 0.497, y: 0.068, len: 0.190, w: 0.062, bend: 0.014 },
  { x: 0.592, y: 0.078, len: 0.235, w: 0.070, bend: -0.020 },
  { x: 0.680, y: 0.130, len: 0.310, w: 0.075, bend: -0.026 },
];

const HEAD_BAND = quad([0.196, 0.400], [0.500, -0.030], [0.804, 0.400], 34);
const MIC_BOOM = quad([0.184, 0.470], [0.270, 0.720], [0.368, 0.560], 18);

function lash(cx, cy, hw = 0.058, lift = 0.056) {
  if (!lash._c) lash._c = new Map();
  const k = `${cx.toFixed(3)}:${hw}:${lift}`;
  if (!lash._c.has(k)) {
    lash._c.set(k, quad(
      [cx - hw, cy - lift * 0.52],
      [cx, cy - lift * 1.30],
      [cx + hw, cy - lift * 0.42],
      22,
    ));
  }
  return lash._c.get(k);
}

const EYES = [
  { x: 0.396, y: 0.455 },
  { x: 0.604, y: 0.455 },
];

// ------------------------------------------------------------------ the field
// Returns { l: luminance 0..1, z: zone } for a point in the portrait box.
function field(u, v) {
  let l = 0;
  let z = null;

  // --- twin tails (behind everything) ------------------------------------
  for (let s = 0; s < 2; s++) {
    const hit = polyDist(u, v, TAILS[s]);
    const wdt = 0.060 + 0.120 * Math.pow(Math.sin(Math.PI * clamp(hit.t)), 0.7);
    if (hit.d < wdt) {
      const edge = hit.d / wdt;
      // strand shadow: a slow wave along the tail keeps the glyph texture alive
      const strand = 0.05 * Math.sin(hit.t * 46 + (s ? 1.2 : 0));
      l = 0.17 + 0.08 * (1 - Math.abs(edge - 0.55) / 0.55) + strand;
      z = "hair";
      if (edge > 0.74) { l = 0.60; z = "rim"; }
      else if (edge < 0.26) { l = 0.24; z = "hair"; }
    }
  }

  // --- back hair ---------------------------------------------------------
  const dHair = ell(u, v, HAIR.x, HAIR.y, HAIR.rx, HAIR.ry);
  if (dHair < 1) {
    const rim = clamp(1 - Math.abs(dHair - 1) / 0.12);
    const side = u < 0.5 || v < 0.28 ? 1 : 0.35;
    l = 0.19 + 0.38 * rim * side;
    z = rim > 0.34 && side > 0.5 ? "rim" : "hair";
  }

  // --- side locks --------------------------------------------------------
  for (let s = 0; s < 2; s++) {
    const hit = polyDist(u, v, LOCKS[s]);
    const wdt = 0.042 - 0.026 * hit.t;
    if (hit.d < wdt) { l = 0.30 + 0.5 * clamp(hit.d / wdt); z = "hair"; }
  }

  // --- shoulders / clothes ----------------------------------------------
  if (v > 0.700) {
    const half = 0.150 + (v - 0.700) * 1.05;
    const dShoulder = Math.abs(u - 0.5) / half;
    if (dShoulder < 1.25) {
      const rim = clamp(1 - Math.abs(dShoulder - 1) / 0.16);
      l = 0.11 + 0.30 * rim * (u < 0.5 ? 1 : 0.55);
      z = rim > 0.35 && u < 0.5 ? "rim" : "cloth";
    }
  }

  // --- neck --------------------------------------------------------------
  if (Math.abs(u - 0.5) < 0.078 && v > 0.612 && v < 0.742) {
    l = 0.42; z = "shade";
  }

  // --- face --------------------------------------------------------------
  const dx = (u - HEAD.x) * (v > HEAD.y ? 1 + 0.50 * ((v - HEAD.y) / HEAD.ry) : 1);
  const dFace = Math.hypot(dx / HEAD.rx, (v - HEAD.y) / HEAD.ry);
  if (dFace < 1) {
    // skin is the mid tone: the whites of her eyes are the brightest thing
    const shade = clamp((u - HEAD.x) / HEAD.rx) * 0.55 + clamp(v / (HEAD.ry * 2)) * 0.22;
    l = 0.50 - 0.16 * shade;
    const blush = Math.hypot((u - 0.352) / 0.075, (v - 0.556) / 0.045) < 1
      || Math.hypot((u - 0.648) / 0.075, (v - 0.556) / 0.045) < 1;
    if (blush) l += 0.09;
    z = "skin";
    const rim = clamp(1 - Math.abs(dFace - 1) / 0.08);
    if (rim > 0.02 && u < HEAD.x) l = Math.max(l, 0.52 + 0.30 * rim);
    const jaw = clamp(1 - Math.abs(dFace - 1) / 0.05);
    if (jaw > 0.02 && v > HEAD.y + HEAD.ry * 0.35) l = Math.min(l, 0.30 + 0.2 * (1 - jaw));
  }

  // --- fringe ------------------------------------------------------------
  for (const b of BANGS) {
    const t = (v - b.y) / b.len;
    if (t < 0 || t > 1) continue;
    const cx = b.x + b.bend * t;
    const half = b.w * Math.pow(1 - t, 0.5) + 0.0016;
    const d = Math.abs(u - cx) / half;
    if (d < 1.05) {
      l = d > 0.72 ? 0.66 : 0.16 + 0.05 * (1 - t);
      z = d > 0.72 ? "rim" : "hair";
    }
  }

  // --- hair ties ---------------------------------------------------------
  for (const s of [-1, 1]) {
    const cx = 0.5 + s * 0.302;
    if (Math.abs(u - cx) < 0.048 && Math.abs(v - 0.212) < 0.056) {
      const e = Math.max(Math.abs(u - cx) / 0.048, Math.abs(v - 0.212) / 0.056);
      l = e > 0.58 ? 0.96 : 0.08;
      z = e > 0.58 ? "line" : "dark";
    }
  }

  // --- headset -----------------------------------------------------------
  if (polyDist(u, v, HEAD_BAND).d < 0.0095) { l = 0.98; z = "line"; }
  for (const s of [-1, 1]) {
    const cx = 0.5 + s * 0.302, cy = 0.402;
    if (Math.abs(u - cx) < 0.046 && Math.abs(v - cy) < 0.064) {
      const e = Math.max(Math.abs(u - cx) / 0.046, Math.abs(v - cy) / 0.064);
      l = e > 0.55 ? 0.95 : 0.14;
      z = e > 0.55 ? "line" : "dark";
    }
  }
  if (polyDist(u, v, MIC_BOOM).d < 0.010) { l = 0.94; z = "line"; }
  if (Math.hypot(u - 0.368, v - 0.560) < 0.022) { l = 1.0; z = "line"; }

  // --- eyes --------------------------------------------------------------
  for (const e of EYES) {
    const dxe = u - e.x, dye = v - e.y;
    const dSclera = ell(u, v, e.x, e.y, 0.094, 0.079);
    if (dSclera < 1) { l = 0.99; z = "skin"; }
    const rIris = Math.hypot(dxe, dye + 0.004);
    if (rIris < 0.062) { l = 0.31; z = "eye"; }
    if (rIris < 0.026) { l = 0.05; z = "dark"; }
    const hiD = Math.hypot(dxe + 0.024, dye + 0.028);
    if (hiD < 0.020) { l = 1.0; z = "line"; }
    if (hiD > 0.036 && hiD < 0.048 && dye > -0.006) { l = 0.62; z = "rim"; }
    if (polyDist(u, v, lash(e.x, e.y, 0.116, 0.060)).d < 0.019) { l = 0.02; z = "dark"; }
    // the double eyelid: a thin crease above the lash
    const crease = polyDist(u, v, lash(e.x, e.y - 0.036, 0.096, 0.044)).d;
    if (crease < 0.006) l = 0.34;
    if (Math.abs(dye - 0.086) < 0.011 && Math.abs(dxe) < 0.090) { l = 0.30; z = "shade"; }
  }

  // --- nose / mouth ------------------------------------------------------
  if (Math.abs(u - 0.506) < 0.014 && Math.abs(v - 0.532) < 0.012) { l = 0.48; z = "shade"; }
  const dMouth = polyDist(u, v, quad([0.468, 0.578], [0.5, 0.600], [0.532, 0.578], 16)).d;
  if (dMouth < 0.013) { l = 0.18; z = "dark"; }

  // --- shirt collar and tie ---------------------------------------------
  const dCollar = Math.min(
    polyDist(u, v, [[0.362, 0.742], [0.5, 0.848]]).d,
    polyDist(u, v, [[0.638, 0.742], [0.5, 0.848]]).d,
  );
  if (dCollar < 0.016) { l = 0.94; z = "line"; }
  if (v > 0.780 && v < 1.05) {
    const half = lerp(0.040, 0.020, (v - 0.780) / 0.270);
    if (Math.abs(u - 0.5) < half) { l = 0.46; z = "eye"; }
  }

  // the portrait fades out at the bottom edge instead of being cut
  l *= 1 - 0.30 * smoothstep(0.88, 1.06, v);
  if (l <= 0.001) z = null;
  return { l, z };
}

export { field as asciiField };

// ---------------------------------------------------------------- the grid
// Both the importer (tools/ascii-import.py) and the procedural fallback below
// produce the same shape: a grid of characters plus a palette letter per cell.

const ZONE = {
  hair: "A", rim: "B", skin: "D", shade: "E",
  dark: "G", eye: "A", line: "B", cloth: "F",
};

const PROC_PALETTE = {
  A: "miku", B: "mikuHi", C: "tealDeep", D: "bone", E: "ash",
  F: "dim", G: "slate", H: "ink2", I: "red", J: "amber", K: "leek",
};

// The hand-coded portrait: used when no imported data is available, so the
// film still runs from pure source.
export function proceduralData(cols = 96, rows = null) {
  rows = rows || Math.max(24, Math.round(cols * 0.6 * (4 / 3)));
  const chars = [];
  const colors = [];
  for (let j = 0; j < rows; j++) {
    let row = "";
    let col = "";
    for (let i = 0; i < cols; i++) {
      const f = field((i + 0.5) / cols, (j + 0.5) / rows);
      const l = clamp(f.l);
      const ch = l > 0.001 && f.z ? RAMP[Math.round(l * (RAMP.length - 1))] : " ";
      row += ch;
      col += ch === " " ? " " : (ZONE[f.z] || "D");
    }
    chars.push(row);
    colors.push(col);
  }
  return {
    id: `proc-${cols}`,
    source: "procedural",
    note: "code-drawn fallback portrait",
    cols, rows, ramp: RAMP, palette: PROC_PALETTE, chars, colors,
  };
}

const dataCache = new Map();

// Fetch imported ASCII data (tools/ascii-import.py output). Falls back to the
// procedural portrait when the file is missing, so a bare checkout still runs.
export async function loadAscii(url, { cols = 96 } = {}) {
  if (dataCache.has(url)) return dataCache.get(url);
  const p = (async () => {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      data.id = url;
      return data;
    } catch (err) {
      console.warn(`ascii: ${url} unavailable (${err.message}); using the code-drawn portrait`);
      const fallback = proceduralData(cols);
      fallback.id = url;
      return fallback;
    }
  })();
  dataCache.set(url, p);
  return p;
}

// ----------------------------------------------------------------- rendering

const cache = new Map();
const indexOfChar = (ramp) => {
  const m = new Map();
  for (let i = 0; i < ramp.length; i++) m.set(ramp[i], i);
  return m;
};

function bitmap(data, pxW, pxH, stage) {
  const key = `${data.id}:${pxW}x${pxH}:${stage.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { cols, rows, ramp, palette, chars, colors } = data;
  const rank = indexOfChar(ramp);
  const n = Math.max(1, ramp.length - 1);
  const canvas = document.createElement("canvas");
  canvas.width = pxW;
  canvas.height = pxH;
  const c = canvas.getContext("2d");
  const cw = pxW / cols;
  const ch = pxH / rows;
  c.font = `${(cw / 0.6).toFixed(2)}px "MV Mono"`;
  c.textAlign = "center";
  c.textBaseline = "middle";

  const cells = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const ch2 = chars[j] ? chars[j][i] : " ";
      if (!ch2 || ch2 === " ") continue;
      const letter = colors[j] ? colors[j][i] : "D";
      const name = palette[letter] || "bone";
      const l = clamp((rank.get(ch2) ?? n * 0.5) / n);

      // the erosion: cells drop out and a few come back as bits
      if (stage > 0) {
        const r = hash(i * 7.31 + j * 13.7);
        if (r < stage * 0.88) {
          if (hash(i * 3.17 + j * 5.53) < 0.30) {
            c.fillStyle = css(name === "bone" ? "miku" : name, 0.45 * (1 - stage * 0.5));
            c.fillText(hash(i * 1.7 + j * 2.9) > 0.5 ? "0" : "1",
              (i + 0.5) * cw, (j + 0.5) * ch);
          }
          continue;
        }
      }

      c.fillStyle = css(name, clamp(0.34 + 0.80 * l));
      c.fillText(ch2, (i + 0.5) * cw, (j + 0.5) * ch);
      cells.push({ i, j, ch: ch2, l, name, x: (i + 0.5) * cw, y: (j + 0.5) * ch });
    }
  }

  // feather the outer edge so a crop never ends in a hard rectangle
  c.save();
  c.globalCompositeOperation = "destination-in";
  const g = c.createRadialGradient(
    pxW * 0.5, pxH * 0.5, Math.min(pxW, pxH) * 0.30,
    pxW * 0.5, pxH * 0.5, Math.max(pxW, pxH) * 0.62,
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.82, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, pxW, pxH);
  c.restore();

  const bmp = { canvas, cells, cols, rows, pxW, pxH, palette };
  if (cache.size > 16) cache.clear();
  cache.set(key, bmp);
  return bmp;
}

// The print marks a machine would leave around a portrait.
export function asciiFrame(ctx, x, y, w, h, o = {}) {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= a;
  const col = o.color || css("dim", 0.55);
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  const L = o.len ?? 26;
  for (const [px, py, sx, sy] of [
    [x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(px + sx * L, py);
    ctx.lineTo(px, py);
    ctx.lineTo(px, py + sy * L);
    ctx.stroke();
  }
  if (o.label) {
    ctx.font = '15px "MV Mono"';
    ctx.fillStyle = o.color || css("ash", 0.8);
    ctx.textAlign = "left";
    ctx.fillText(o.label, x, y - 10);
  }
  ctx.restore();
}

// Draw the portrait from data. All options are optional:
//   t        song time (drives the flicker / scan)
//   alpha    overall opacity
//   stage    0 intact .. 1 erased into 0/1
//   reveal   0..1 — rows are printed top to bottom
//   light    [u, v, strength] — a soft moving light over the grid
//   scan     y position of a bright read line, in 0..1
//   glow     strength of the teal halo behind her
export function drawAscii(ctx, data, x, y, w, o = {}) {
  const aspect = data.rows / data.cols / (data.cellAspect || 0.6);
  const h = o.h ?? w * aspect;
  const pxW = Math.max(64, Math.round((w * (o.ss ?? 1)) / 8) * 8);
  const pxH = Math.max(48, Math.round((h * (o.ss ?? 1)) / 8) * 8);
  const stage = clamp(o.stage ?? 0);
  const bmp = bitmap(data, pxW, pxH, Math.round(stage * 5) / 5);
  const t = o.t ?? 0;
  const alpha = o.alpha ?? 1;
  if (alpha <= 0.002) return;

  ctx.save();
  ctx.globalAlpha *= alpha;

  if (o.glow) {
    const g = ctx.createRadialGradient(x + w * 0.5, y + h * 0.42, w * 0.04,
      x + w * 0.5, y + h * 0.42, w * 0.62);
    g.addColorStop(0, css("tealDeep", 0.55 * clamp(o.glow)));
    g.addColorStop(0.55, css("tealDeep", 0.18 * clamp(o.glow)));
    g.addColorStop(1, css("tealDeep", 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - w * 0.2, y - h * 0.1, w * 1.4, h * 1.2);
  }

  const reveal = o.reveal == null ? 1 : clamp(o.reveal);
  if (reveal < 1) {
    ctx.beginPath();
    ctx.rect(x, y - 2, w, h * reveal + 2);
    ctx.clip();
  }

  ctx.drawImage(bmp.canvas, x, y, w, h);

  // the print head: the row that is being drawn right now
  if (reveal > 0.001 && reveal < 0.999) {
    ctx.fillStyle = css("mikuHi", 0.55);
    ctx.fillRect(x, y + h * reveal - 1.5, w, 2.5);
    ctx.fillStyle = css("miku", 0.16);
    ctx.fillRect(x, y + h * reveal - 14, w, 14);
  }

  // a few cells re-typed every frame, so the portrait is never a still image
  const n = bmp.cells.length;
  if (n) {
    const cw = w / bmp.cols, chh = h / bmp.rows;
    ctx.font = `${(cw / 0.6).toFixed(2)}px "MV Mono"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const count = Math.min(90, Math.round(n * 0.02));
    for (let k = 0; k < count; k++) {
      const seed = k * 3.7 + Math.floor(t * 7) * 1.7;
      const cell = bmp.cells[Math.floor(hash(seed) * n)];
      if (!cell) continue;
      const flick = 0.35 + 0.65 * hash(seed * 1.3);
      ctx.globalAlpha = alpha * (0.35 + 0.6 * cell.l) * flick;
      ctx.fillStyle = css(cell.name, 0.95);
      ctx.fillText(cell.ch, x + cell.i * cw + cw / 2, y + cell.j * chh + chh / 2);
    }
    ctx.globalAlpha = alpha;
  }

  if (o.light) {
    const [lu, lv, strength = 1] = o.light;
    const lx = x + lu * w, ly = y + lv * h;
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, w * 0.42);
    g.addColorStop(0, css("mikuHi", 0.10 * strength));
    g.addColorStop(0.6, css("miku", 0.04 * strength));
    g.addColorStop(1, css("miku", 0));
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = "source-over";
  }

  if (o.scan != null) {
    const sy = y + clamp(o.scan) * h;
    ctx.fillStyle = css("mikuHi", 0.35);
    ctx.fillRect(x, sy - 1, w, 2);
    ctx.fillStyle = css("miku", 0.10);
    ctx.fillRect(x, sy - 10, w, 10);
  }

  ctx.restore();
}

// Convenience wrapper for the code-drawn portrait (used by tools + fallback).
export function mikuAscii(ctx, x, y, w, o = {}) {
  const data = o.data || proceduralData(o.cols ?? 96);
  drawAscii(ctx, data, x, y, w, o);
}

export function asciiRamp() { return RAMP; }
export { TAU };
