// Shared drawing vocabulary for the scenes: the machine's chrome, the real
// waveform, the real spectrogram, the lyric wall. One voice, many instruments.

import { css, mix, PALETTE } from "./palette.js";
import { draw as drawText, drawKaraoke, font, layout, MONO, measure, pad } from "./type.js";

export { css, mix };

// ---------------------------------------------------------------- math
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};
export const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
export const easeInExpo = (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10));
export const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
export const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOutBack = (x) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
export const pulse = (t, freq = 1, sharp = 3) => Math.pow(0.5 + 0.5 * Math.sin(t * freq * Math.PI * 2), sharp);
export const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const rand = (seed, i) => hash(seed * 3.7 + i * 1.13);
export const window01 = (t, a, b, fade = 0.4) => smoothstep(a, a + fade, t) * (1 - smoothstep(b - fade, b, t));

// ---------------------------------------------------------------- text
export function label(ctx, text, x, y, o = {}) {
  return drawText(ctx, text, {
    x, y,
    size: o.size ?? 22,
    weight: o.weight ?? 400,
    mono: o.mono !== false,
    serif: !!o.serif,
    italic: !!o.italic,
    tracking: o.tracking ?? 0,
    color: o.color ?? css("bone", o.alpha ?? 0.92),
    align: o.align ?? "left",
    baseline: o.baseline ?? "alphabetic",
  });
}

export function bigText(ctx, text, x, y, o = {}) {
  return drawText(ctx, text, {
    x, y,
    size: o.size ?? 120,
    weight: o.weight ?? 900,
    mono: !!o.mono,
    serif: !!o.serif,
    italic: !!o.italic,
    tracking: o.tracking ?? 0,
    color: o.color ?? css("bone"),
    align: o.align ?? "left",
    alpha: o.alpha ?? 1,
  });
}

// Rectangular hairline/panel chrome, the film's recurring "instrument" box.
export function panel(ctx, x, y, w, h, o = {}) {
  if (o.fill) {
    ctx.fillStyle = o.fill;
    ctx.fillRect(x, y, w, h);
  }
  if (o.stroke !== false) {
    ctx.strokeStyle = o.stroke || css("dim", o.alpha ?? 0.7);
    ctx.lineWidth = o.lw ?? 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  const c = o.corner ?? 12;
  if (c > 0) {
    ctx.strokeStyle = o.cornerColor || css("miku", o.cornerAlpha ?? 0.85);
    ctx.lineWidth = o.cornerLw ?? 2;
    const seg = o.cornerLen ?? 10;
    const pts = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]];
    if (o.cornerShape === "diagonal") {
      for (const [px, py, sx, sy] of pts) {
        ctx.beginPath();
        ctx.moveTo(px + sx * c, py);
        ctx.lineTo(px, py + sy * c);
        ctx.stroke();
      }
    } else {
      for (const [px, py, sx, sy] of pts) {
        ctx.beginPath();
        ctx.moveTo(px + sx * c, py);
        ctx.lineTo(px, py);
        ctx.lineTo(px, py + sy * seg);
        ctx.stroke();
      }
    }
  }
}

// Tick ruler: the film's most common annotation.
export function tickRule(ctx, x, y, w, { count = 24, h = 8, color = css("dim", 0.6), major = 4, labels = null, labelSize = 16, majorH = 14 } = {}) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i <= count; i++) {
    const px = x + (w * i) / count;
    const big = i % major === 0;
    ctx.beginPath();
    ctx.moveTo(Math.round(px) + 0.5, y);
    ctx.lineTo(Math.round(px) + 0.5, y + (big ? majorH : h));
    ctx.stroke();
    if (labels && big) {
      label(ctx, labels[i / major] ?? String(Math.round((i / count) * 100)), px, y + majorH + labelSize + 2, {
        size: labelSize, align: "center", color: css("ash", 0.75),
      });
    }
  }
}

// ---------------------------------------------------------------- signal
// The real waveform, drawn as one continuous vertical stroke per column.
export function wave(ctx, F, t, o = {}) {
  const { x = 0, y = 0, w = 800, h = 200, span = 2.0, color = css("miku"), lw = 2, alpha = 1, amp = 1, center = 0 } = o;
  const n = Math.max(16, Math.round(w / (o.step ?? 2)));
  const { lo, hi } = F.waveSlice(t - span, t, n, o._lo, o._hi);
  o._lo = lo; o._hi = hi;
  const cy = y + h * (0.5 + center);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const px = x + (w * i) / n;
    const a = cy - hi[i] * (h / 2) * amp;
    const b = cy - lo[i] * (h / 2) * amp;
    ctx.moveTo(px, a);
    ctx.lineTo(px, b + 0.01);
  }
  ctx.stroke();
  ctx.restore();
  return { lo, hi };
}

// Oscilloscope envelope: |wave| smeared horizontally, used as a backdrop.
export function waveEnvelope(ctx, F, t, o = {}) {
  const { x = 0, y = 0, w = 1920, h = 400, span = 8.0, color = css("miku", 0.5) } = o;
  const n = 260;
  const { lo, hi } = F.waveSlice(t - span, t, n);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const px = x + (w * i) / n;
    ctx.lineTo(px, y + h / 2 - hi[i] * h * 0.5);
  }
  for (let i = n - 1; i >= 0; i--) {
    const px = x + (w * i) / n;
    ctx.lineTo(px, y + h / 2 - lo[i] * h * 0.5);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Live spectrum bars from the analysed spectrogram.
export function specBars(ctx, F, t, o = {}) {
  const {
    x = 0, y = 0, w = 900, h = 200, bars = 64, color = css("miku"),
    alpha = 1, gap = 2, mirror = false, decayBands = 0, lw = 0, glow = null,
  } = o;
  const bw = w / bars;
  const pk = `${Math.round(x)},${Math.round(y)},${bars}`;
  let peak = peakCache.get(pk);
  if (!peak || peak.length !== bars) {
    peak = new Float32Array(bars);
    peakCache.set(pk, peak);
  }
  if (o.resetPeaks) peak.fill(0);
  ctx.save();
  for (let i = 0; i < bars; i++) {
    let v = F.specAt(i, t);
    if (decayBands > 0 && i > bars - 1 - decayBands) v = 0;
    v = Math.pow(v, 1.4);
    peak[i] = Math.max(v, peak[i] * (o.peakFall ?? 0.94));
    const bh = Math.max(1, v * h);
    const px = x + i * bw;
    if (lw > 0) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(px + bw / 2, y + h);
      ctx.lineTo(px + bw / 2, y + h - bh);
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(px + gap / 2, y + h - bh, Math.max(1, bw - gap), bh);
      if (mirror) ctx.fillRect(px + gap / 2, y, Math.max(1, bw - gap), bh * 0.55);
    }
    if (glow) {
      ctx.fillStyle = glow;
      ctx.fillRect(px + gap / 2, y + h - peak[i] * h - 2, Math.max(1, bw - gap), 2);
    }
  }
  ctx.restore();
}

const peakCache = new Map();

// Scrolling spectrogram (real data) in a rectangle. Built from a small
// ImageData which is then scaled up: cheap and it reads as instrumentation.
let water = null;
export function specWaterfall(ctx, F, t, o = {}) {
  const {
    x = 0, y = 0, w = 1200, h = 300, span = 6.0, alpha = 1, invert = false,
    gain = 0.8, gamma = 1.6,
  } = o;
  const cols = 512, rows = 64;
  if (!water || water.width !== cols || water.height !== rows) {
    water = ctx.createImageData(cols, rows);
  }
  const data = water.data;
  const tint = o.tint || [0.22, 0.78, 0.73];
  for (let i = 0; i < cols; i++) {
    const tt = t - span + (span * i) / cols;
    for (let b = 0; b < rows; b++) {
      const band = rows - 1 - b;
      let v = tt < 0 ? 0 : F.specAt(band, tt);
      if (o.decayBands && band > rows - 1 - o.decayBands) v = 0;
      const k = (b * cols + i) * 4;
      const g = Math.pow(v, gamma) * gain;
      if (invert) {
        data[k] = 255 * g; data[k + 1] = 255 * g; data[k + 2] = 255 * g;
      } else {
        data[k] = 255 * g * tint[0] * 1.0;
        data[k + 1] = 255 * g * tint[1];
        data[k + 2] = 255 * g * tint[2];
      }
      data[k + 3] = 255;
    }
  }
  const c = offscreen(ctx, cols, rows);
  c.ctx.putImageData(water, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(c.canvas, x, y, w, h);
  ctx.restore();
}

const pools = new Map();
export function offscreen(ctx, w, h, key = `${ctx.canvas.width}x${ctx.canvas.height}`) {
  const k = `${key}:${w}x${h}`;
  let c = pools.get(k);
  if (!c) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    c = { canvas, ctx: canvas.getContext("2d") };
    pools.set(k, c);
  }
  return c;
}

// ---------------------------------------------------------------- lyrics
export function lyricLine(ctx, line, t, F, o = {}) {
  if (!line) return 0;
  const size = o.size ?? 96;
  const width = o.maxWidth ?? 1600;
  const weight = o.weight ?? 900;
  const tracking = o.tracking ?? 0;
  const f = font(size, { weight });
  const adv = measure(ctx, line.text, f, tracking);
  let s = size;
  if (adv > width) {
    s = Math.max(o.minSize ?? 30, size * (width / adv));
  }
  return drawKaraoke(ctx, line, {
    x: o.x ?? 0, y: o.y ?? 0, size: s, weight,
    tracking, t, features: F,
    sung: o.sung ?? css("bone"),
    dim: o.dim ?? css("dim", 0.85),
    align: o.align ?? "left",
    wipe: o.wipe !== false,
    alpha: o.alpha ?? 1,
    charScale: o.charScale,
    font: o.font,
  });
}

// A column/wall of recent lines: the song's text at the speed it is sung.
export function typeWall(ctx, F, t, o = {}) {
  const {
    x = 0, y = 0, w = 900, lineHeight = 34, size = 22, count = 40,
    lead = 0, alpha = 1, dimColor = css("dim", 0.55), hotColor = css("miku"),
    tracking = 0, rightAlign = false, window = 26,
  } = o;
  const lines = F.lines;
  const end = F.lineIndexAt(t);
  ctx.save();
  ctx.globalAlpha = alpha;
  let row = 0;
  for (let i = end; i >= 0 && row < count; i--) {
    const l = lines[i];
    if (l.start < t - window) break;
    const fresh = clamp(1 - (t - l.start) / 0.35);
    const cy = y - row * lineHeight + lead;
    const hot = i === end && t <= l.end + 0.4;
    const col = fresh > 0.01
      ? (hot ? hotColor : css("bone", 0.55 + 0.45 * (1 - fresh)))
      : dimColor;
    drawText(ctx, l.text, {
      x: rightAlign ? x + w : x, y: cy,
      size, weight: hot ? 700 : 400, tracking,
      color: col, align: rightAlign ? "right" : "left",
      baseline: "top",
    });
    row++;
  }
  ctx.restore();
}

// Binary lattice: the song's "0 と 1 に還元され" motif. Deterministic in t.
export function binaryField(ctx, t, o = {}) {
  const {
    x = 0, y = 0, w = 1920, h = 1080, cell = 34, size = 18,
    alpha = 0.5, color = css("miku"), speed = 1, density = 1, seed = 7,
    threshold = 0,
  } = o;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  ctx.save();
  ctx.font = font(size, { weight: 400, mono: true });
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (let ix = 0; ix < cols; ix++) {
    for (let iy = 0; iy < rows; iy++) {
      const s = rand(seed, ix * 71 + iy * 13);
      if (s > density) continue;
      const phase = rand(seed + 3, ix * 17 + iy * 29);
      const flick = 0.5 + 0.5 * Math.sin((t * speed + phase * 10) * 3.1 + ix * 0.7);
      const a = alpha * (0.25 + 0.75 * flick);
      if (a < threshold) continue;
      ctx.globalAlpha = Math.min(1, a);
      ctx.fillStyle = color;
      const bit = (Math.floor(phase * 10 + t * (1 + s)) % 2) === 0 ? "0" : "1";
      ctx.fillText(bit, x + ix * cell + cell / 2, y + iy * cell + cell / 2);
    }
  }
  ctx.restore();
}

// Machine chrome: corner labels + hairline frame. Used sparingly.
export function machineChrome(ctx, o = {}) {
  const { x = 64, y = 52, w = 1792, h = 976, name = "", alpha = 0.9, right = "", left = "" } = o;
  ctx.save();
  ctx.globalAlpha = alpha;
  const c = css("dim", 0.8);
  ctx.strokeStyle = c;
  ctx.lineWidth = 1;
  const L = 26;
  const corners = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]];
  for (const [px, py, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(px + sx * L, py);
    ctx.lineTo(px, py);
    ctx.lineTo(px, py + sy * L);
    ctx.stroke();
  }
  if (name) {
    label(ctx, name, x + 4, y - 14, { size: 19, color: css("ash", 0.95), tracking: 1.5 });
  }
  if (left) label(ctx, left, x + 4, y + h + 26, { size: 17, color: css("ash", 0.85), tracking: 1 });
  if (right) label(ctx, right, x + w - 4, y + h + 26, { size: 17, align: "right", color: css("ash", 0.85), tracking: 1 });
  ctx.restore();
}

// A deterministic block of pseudo-code / log lines (the machine's own voice).
export function codeLines(ctx, lines, t, o = {}) {
  const { x = 0, y = 0, size = 18, lineHeight = 28, color = css("ash", 0.8), alpha = 1, reveal = Infinity, tracking = 0 } = o;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < lines.length; i++) {
    if (i > reveal) break;
    const s = reveal - i;
    const txt = s < 1 && s > 0 ? lines[i].slice(0, Math.ceil(lines[i].length * s)) : lines[i];
    drawText(ctx, txt, { x, y: y + i * lineHeight, size, mono: true, color, tracking });
  }
  ctx.restore();
  void t;
}

export function pad2(n) { return pad(n, 2); }

// Section bookkeeping shared by the HUD and a few scenes.
export const STATES = [
  [0.0, "INIT"], [21.7, "ONLINE"], [41.7, "SINGING"], [57.7, "DEGRADED"],
  [89.7, "LOSSY"], [103.7, "HALT"], [117.7, "OVERDRIVE"], [139.7, "WAITING"],
  [162.7, "REQUEST"], [177.7, "CORRUPT"], [209.7, "COMPRESS"], [225.7, "FINAL"],
  [256.7, "SHUTDOWN"], [273.7, "FATAL"],
];

export function stateAt(t) {
  let s = STATES[0][1];
  for (const [tt, name] of STATES) if (t >= tt) s = name;
  return s;
}

export const INK = PALETTE.ink;
