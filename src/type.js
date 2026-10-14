// Typography: three shipped families, glyph-accurate layout, karaoke drawing.
// Japanese lyric voice = MV Sans (Noto Sans JP subset, 400/700/900).
// Machine voice = MV Mono (IBM Plex Mono subset, 400/600).
// Elegy voice = MV Serif (Noto Serif JP subset, 600) -- used exactly three
// times in the film: the title, the goodbye, the credits.

export const FAMILY = "MV Sans";
export const MONO = "MV Mono";
export const SERIF = "MV Serif";

const FACES = [
  ["MV Sans", 400, "noto-jp-400.woff2"],
  ["MV Sans", 700, "noto-jp-700.woff2"],
  ["MV Sans", 900, "noto-jp-900.woff2"],
  ["MV Mono", 400, "plex-mono-400.woff2"],
  ["MV Mono", 600, "plex-mono-600.woff2"],
  ["MV Serif", 600, "noto-serif-jp-600.woff2"],
];

export async function loadFonts(base = "./assets/fonts") {
  await Promise.all(FACES.map(async ([family, weight, file]) => {
    const face = new FontFace(family, `url(${base}/${file})`, { weight: String(weight) });
    document.fonts.add(face);
    await face.load();
  }));
  await document.fonts.ready;
}

export function font(size, { weight = 400, mono = false, serif = false, italic = false } = {}) {
  const family = mono ? MONO : serif ? SERIF : FAMILY;
  return `${italic ? "italic " : ""}${weight} ${size}px "${family}"`;
}

export function pxFont(size, weight = 400, o = {}) {
  return font(Math.round(size), { weight, ...o });
}

// ---------------------------------------------------------------- layout
const cache = new Map();

function key(ctx, text, f, tracking) {
  return `${ctx.font}|${tracking}|${text}`;
}

// Per-character x positions with pair kerning (CJK gets none, Latin does).
export function layout(ctx, text, f, tracking = 0) {
  ctx.font = f;
  const k = key(ctx, text, f, tracking);
  const hit = cache.get(k);
  if (hit) return hit;
  const chars = [...text];
  const widths = new Array(chars.length);
  const kern = new Array(chars.length).fill(0);
  for (let i = 0; i < chars.length; i++) {
    widths[i] = ctx.measureText(chars[i]).width;
  }
  for (let i = 0; i < chars.length; i++) {
    if (i + 1 < chars.length) {
      const pair = ctx.measureText(chars[i] + chars[i + 1]).width;
      kern[i] = pair - widths[i] - widths[i + 1];
    }
  }
  const xs = new Array(chars.length);
  let x = 0;
  for (let i = 0; i < chars.length; i++) {
    xs[i] = x;
    x += widths[i] + kern[i] + tracking;
  }
  const out = { chars, xs, widths, advance: x };
  if (cache.size > 6000) cache.clear();
  cache.set(k, out);
  return out;
}

export function measure(ctx, text, f, tracking = 0) {
  return layout(ctx, text, f, tracking).advance;
}

// Largest size (<= max, >= min) where `text` fits `width`.
export function fitSize(ctx, text, width, { max = 200, min = 8, weight = 900, mono = false, tracking = 0 } = {}) {
  let lo = min, hi = max;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (measure(ctx, text, font(mid, { weight, mono }), tracking) <= width) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------- drawing
// Draw a string glyph by glyph. opts.drawChar(ctx, ch, i, x, width, y) may
// override how each glyph is painted (colour, scale, offset).
export function draw(ctx, text, opts) {
  const {
    x = 0, y = 0, size = 100, weight = 400, mono = false, serif = false, italic = false,
    tracking = 0, color = "#fff", align = "left", baseline = "alphabetic",
    alpha = 1, drawChar = null, skipSpace = false,
  } = opts;
  const f = opts.font || font(size, { weight, mono, serif, italic });
  const L = layout(ctx, text, f, tracking);
  const start = align === "center" ? -L.advance / 2 : align === "right" ? -L.advance : 0;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = f;
  ctx.textBaseline = baseline;
  ctx.fillStyle = color;
  for (let i = 0; i < L.chars.length; i++) {
    const ch = L.chars[i];
    const gx = x + start + L.xs[i];
    if (drawChar) {
      drawChar(ctx, ch, i, gx, L.widths[i], y, f);
    } else if (!(skipSpace && ch === " ")) {
      ctx.fillText(ch, gx, y);
    }
  }
  ctx.restore();
  return L.advance;
}

// Karaoke line: unsung characters dim, sung characters bright, optional
// per-character wipe. `line` is a lyrics entry with ct[] onset times.
export function drawKaraoke(ctx, line, opts) {
  const {
    x = 0, y = 0, size = 100, weight = 900, tracking = 0,
    sung = "#fff", dim = "rgba(255,255,255,0.28)", t = 0, features = null,
    align = "left", wipe = true, charScale = null, charY = null, alpha = 1,
    shadow = null, showAll = false,
  } = opts;
  const text = line.text;
  const f = opts.font || font(size, { weight });
  const L = layout(ctx, text, f, tracking);
  const start = align === "center" ? -L.advance / 2 : align === "right" ? -L.advance : 0;
  ctx.save();
  ctx.font = f;
  ctx.textBaseline = opts.baseline || "alphabetic";
  ctx.globalAlpha = alpha;
  const ci = line.ci || [];
  for (let i = 0; i < L.chars.length; i++) {
    const ch = L.chars[i];
    const isChar = ci.includes(i);
    const frac = isChar && features
      ? features.charProgress(line, ci.indexOf(i), t)
      : (showAll ? 1 : 0);
    if (ch !== " ") {
      const gx = x + start + L.xs[i];
      const gy = y + (charY ? charY(i, frac) : 0);
      const sc = charScale ? charScale(i, frac) : 1;
      if (sc !== 1) {
        ctx.save();
        ctx.translate(gx + L.widths[i] / 2, gy);
        ctx.scale(sc, sc);
        ctx.translate(-(gx + L.widths[i] / 2), -gy);
      }
      ctx.fillStyle = dim;
      if (shadow) {
        ctx.save();
        ctx.globalAlpha = alpha * shadow.alpha;
        ctx.fillStyle = shadow.color;
        ctx.fillText(ch, gx + (shadow.dx || 0), gy + (shadow.dy || 0));
        ctx.restore();
      }
      ctx.fillStyle = frac >= 0.999 ? sung : dim;
      ctx.fillText(ch, gx, gy);
      if (wipe && frac > 0.001 && frac < 0.999) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(gx - L.widths[i] * 0.1, gy - size * 1.45,
                 L.widths[i] * (frac + 0.1), size * 2.2);
        ctx.clip();
        ctx.fillStyle = sung;
        ctx.fillText(ch, gx, gy);
        ctx.restore();
      }
      if (sc !== 1) ctx.restore();
    }
  }
  ctx.restore();
  return L.advance;
}

// plain integer helpers used all over the machine readouts
export function pad(n, len = 2, fill = "0") {
  const s = Math.max(0, Math.floor(n)).toString();
  return s.length >= len ? s : fill.repeat(len - s.length) + s;
}

export function timecode(t, withMs = true) {
  const m = Math.floor(Math.abs(t) / 60);
  const s = Math.floor(Math.abs(t) % 60);
  const cs = Math.floor((Math.abs(t) % 1) * 100);
  return `${pad(m)}:${pad(s)}${withMs ? "." + pad(cs) : ""}`;
}

// fixed-width decimal, e.g. fnum(3.14159, 3) -> "3.142"
export function fnum(v, digits = 2) {
  return (v < 0 ? "-" : "") + Math.abs(v).toFixed(digits);
}
