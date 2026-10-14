// Reusable, code-drawn imagery for the lyrics.
//
// The film's base language is machine instrumentation. These motifs are the
// human layer on top of it: a voice avatar, the listener, and the small
// objects the song keeps returning to. Everything is a pure function of the
// caller's arguments, so a frame is still reproducible.

import { clamp, css, hash, lerp, smoothstep } from "./kit.js";

// The singer and the listener have grown into a module of their own; they are
// re-exported so every scene keeps importing its imagery from one place.
export { singer, listener } from "./figure.js";

const TAU = Math.PI * 2;

function group(ctx, alpha, fn) {
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  fn();
  ctx.restore();
}

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.4, r), 0, TAU);
  ctx.fill();
}

// Local label that respects the ambient globalAlpha (kit.label replaces it).
function inkLabel(ctx, text, x, y, o = {}) {
  const size = o.size ?? 14;
  ctx.save();
  ctx.font = `${o.weight ?? 400} ${size}px "MV Mono"`;
  ctx.textAlign = o.align || "left";
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.fillStyle = o.color || css("ash", 0.72);
  ctx.fillText(text, x, y);
  ctx.restore();
}

function strokePath(ctx, pts, color, lw) {
  if (!pts.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.5, lw);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

// A closed shape around a centreline with per-point half-widths: the base
// primitive for hair, ribbons and anything that should taper.
function ribbon(ctx, pts, widths) {
  const n = pts.length;
  if (n < 2) return;
  const nx = [], ny = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    nx.push(-dy / l);
    ny.push(dx / l);
  }
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = pts[i][0] + nx[i] * widths[i], y = pts[i][1] + ny[i] * widths[i];
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  for (let i = n - 1; i >= 0; i--) {
    ctx.lineTo(pts[i][0] - nx[i] * widths[i], pts[i][1] - ny[i] * widths[i]);
  }
  ctx.closePath();
}

function sampleCurve(p0, p1, p2, p3, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, v = 1 - u;
    out.push([
      v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0],
      v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1],
    ]);
  }
  return out;
}

function softGlow(ctx, x, y, r, color, alpha) {
  if (alpha <= 0.002) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, fade(color, alpha));
  g.addColorStop(1, fade(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// Re-alpha any `rgb()`/`rgba()` colour string. `css(name, 1)` returns the
// three-component form, so a naive regex would silently leave it opaque —
// which is how a soft glow becomes a hard rectangle.
function fade(colour, k) {
  const m = String(colour).match(/rgba?\(([^)]+)\)/);
  if (!m) return colour;
  const p = m[1].split(",").map((v) => v.trim());
  return `rgba(${p[0]},${p[1]},${p[2]},${clamp(k).toFixed(3)})`;
}

function faceFeatures(ctx, x, y, r, o) {
  const eyes = o.eyes || "open";
  const eyeDx = r * 0.42;
  const eyeY = y - r * 0.08;
  const eyeR = r * 0.20;
  const col = o.color || css("miku", 0.9);
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1, r * 0.055);
  ctx.lineCap = "round";

  for (const side of [-1, 1]) {
    const ex = x + side * eyeDx;
    ctx.beginPath();
    if (eyes === "happy") {
      ctx.moveTo(ex - eyeR, eyeY + eyeR * 0.35);
      ctx.quadraticCurveTo(ex, eyeY - eyeR * 0.9, ex + eyeR, eyeY + eyeR * 0.35);
    } else if (eyes === "sad") {
      ctx.moveTo(ex - eyeR, eyeY - eyeR * 0.25);
      ctx.quadraticCurveTo(ex, eyeY + eyeR * 0.8, ex + eyeR, eyeY - eyeR * 0.25);
      ctx.moveTo(ex - eyeR * 1.1, eyeY - eyeR * 1.15);
      ctx.lineTo(ex + eyeR * 1.1, eyeY - eyeR * 0.55);
    } else if (eyes === "x") {
      ctx.moveTo(ex - eyeR * 0.7, eyeY - eyeR * 0.7);
      ctx.lineTo(ex + eyeR * 0.7, eyeY + eyeR * 0.7);
      ctx.moveTo(ex + eyeR * 0.7, eyeY - eyeR * 0.7);
      ctx.lineTo(ex - eyeR * 0.7, eyeY + eyeR * 0.7);
    } else if (eyes === "closed") {
      ctx.moveTo(ex - eyeR, eyeY);
      ctx.quadraticCurveTo(ex, eyeY + eyeR * 0.75, ex + eyeR, eyeY);
    } else {
      ctx.moveTo(ex - eyeR, eyeY);
      ctx.lineTo(ex + eyeR, eyeY);
    }
    ctx.stroke();
  }

  const mouthY = y + r * 0.42;
  ctx.beginPath();
  if (o.smile != null && o.smile > 0.35) {
    ctx.moveTo(x - r * 0.30, mouthY - r * 0.08);
    ctx.quadraticCurveTo(x, mouthY + r * 0.30 * o.smile, x + r * 0.30, mouthY - r * 0.08);
  } else if (o.sadMouth) {
    ctx.moveTo(x - r * 0.26, mouthY + r * 0.14);
    ctx.quadraticCurveTo(x, mouthY - r * 0.20, x + r * 0.26, mouthY + r * 0.14);
  } else {
    ctx.moveTo(x - r * 0.22, mouthY);
    ctx.lineTo(x + r * 0.22, mouthY);
  }
  ctx.stroke();
}

// --------------------------------------------------------------- the hand
// The listener's hand: the only part of "you" the film ever shows clearly.
// A forearm sleeve, a palm, four fingers and a thumb, drawn so it can press a
// button or hang above one.
export function hand(ctx, x, y, len, angle, o = {}) {
  const col = o.color || css("bone", 0.8);
  const w = Math.max(1.2, len * 0.09);
  group(ctx, o.alpha ?? 1, () => {
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const palmX = len * 0.66;
    const palmR = len * 0.16;

    // forearm + cuff
    ctx.strokeStyle = fade(col, 0.85);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(palmX - palmR * 0.40, 0);
    ctx.stroke();
    ctx.strokeStyle = fade(col, 0.5);
    ctx.lineWidth = w * 0.35;
    ctx.beginPath();
    ctx.moveTo(len * 0.10, -w * 0.30);
    ctx.lineTo(len * 0.10, w * 0.30);
    ctx.moveTo(len * 0.16, -w * 0.34);
    ctx.lineTo(len * 0.16, w * 0.34);
    ctx.stroke();

    // palm
    ctx.beginPath();
    ctx.ellipse(palmX, 0, palmR * 1.15, palmR, 0, 0, TAU);
    ctx.fillStyle = fade(col, 0.16);
    ctx.fill();
    ctx.strokeStyle = fade(col, 0.85);
    ctx.lineWidth = Math.max(1, w * 0.30);
    ctx.stroke();

    // fingers, curled or reaching
    const curl = clamp(o.press ? 0.85 : o.curl ?? 0);
    for (let i = 0; i < 4; i++) {
      const fy = -palmR * 0.62 + i * palmR * 0.42;
      const baseX = palmX + palmR * 0.72;
      const tipX = baseX + palmR * (1.30 - curl * 0.85);
      const tipY = fy + curl * palmR * 0.26 * (i < 2 ? 1 : -1);
      ctx.beginPath();
      ctx.moveTo(baseX, fy);
      ctx.quadraticCurveTo(baseX + palmR * 0.7, fy - palmR * 0.10,
        tipX, tipY);
      ctx.strokeStyle = fade(col, 0.8 - i * 0.06);
      ctx.lineWidth = Math.max(1, w * (0.26 - i * 0.02));
      ctx.stroke();
    }
    // thumb
    ctx.beginPath();
    ctx.moveTo(palmX + palmR * 0.25, palmR * 0.72);
    ctx.quadraticCurveTo(palmX + palmR * 1.05, palmR * 0.95,
      palmX + palmR * 1.15, palmR * 0.42);
    ctx.strokeStyle = fade(col, 0.75);
    ctx.lineWidth = Math.max(1, w * 0.26);
    ctx.stroke();

    if (o.press) {
      softGlow(ctx, palmX + palmR, 0, palmR * 1.5, css("red", 0.5), 0.18);
    }
  });
}

// --------------------------------------------------------------- the world
// A leek, a sky, a tear: the one ordinary, bodily memory in the song.
export function leek(ctx, x, y, s, o = {}) {
  const a = o.alpha ?? 1;
  const green = o.color || css("leek", 0.9);
  const bone = o.bone || css("bone", 0.8);
  const lw = o.lw ?? Math.max(1.2, s * 0.012);
  group(ctx, a, () => {
    ctx.translate(x, y);
    ctx.rotate(o.rot ?? -0.42);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const stem = 0.70 * s;
    const w = 0.16 * s;
    const bite = clamp(o.bite ?? 0);

    // leaves
    ctx.fillStyle = css("leek", 0.16);
    ctx.strokeStyle = green;
    ctx.lineWidth = lw;
    const blades = [
      [-0.30, -1.18, -0.10, -1.48, 0.02, -1.30],
      [0.02, -1.34, 0.08, -1.62, 0.18, -1.28],
      [0.16, -1.22, 0.34, -1.42, 0.34, -1.10],
    ];
    for (const b of blades) {
      ctx.beginPath();
      ctx.moveTo(0, -stem);
      ctx.bezierCurveTo(b[0] * s, b[1] * s, b[2] * s, b[3] * s, b[4] * s, b[5] * s);
      ctx.bezierCurveTo(b[2] * s + 0.03 * s, b[3] * s + 0.10 * s,
                        b[0] * s + 0.06 * s, b[1] * s + 0.18 * s, 0, -stem);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // stalk with an optional bite taken out of the top
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, 0);
    ctx.lineTo(-w * 0.5, -stem);
    ctx.quadraticCurveTo(-w * 0.5, -stem - 0.08 * s, 0, -stem - 0.08 * s);
    ctx.quadraticCurveTo(w * 0.5, -stem - 0.08 * s, w * 0.5, -stem);
    ctx.lineTo(w * 0.5, 0);
    ctx.closePath();
    if (bite > 0.01) {
      ctx.moveTo(w * 0.72, -stem - 0.08 * s + 0.22 * s);
      ctx.arc(0.18 * s, -stem - 0.08 * s + 0.22 * s, 0.24 * s * bite, 0, TAU);
    }
    ctx.fillStyle = css("bone", 0.14 + 0.10 * (1 - bite));
    ctx.fill("evenodd");
    ctx.strokeStyle = bone;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, 0);
    ctx.lineTo(-w * 0.5, -stem);
    ctx.quadraticCurveTo(-w * 0.5, -stem - 0.08 * s, 0, -stem - 0.08 * s);
    ctx.quadraticCurveTo(w * 0.5, -stem - 0.08 * s, w * 0.5, -stem);
    ctx.lineTo(w * 0.5, 0);
    ctx.stroke();

    ctx.strokeStyle = css("leek", 0.55);
    ctx.lineWidth = lw * 0.7;
    for (let i = 1; i <= 2; i++) {
      const yy = -stem * (0.18 + i * 0.17);
      ctx.beginPath();
      ctx.moveTo(-w * 0.42, yy);
      ctx.lineTo(w * 0.42, yy);
      ctx.stroke();
    }
    if (o.label !== false) {
      inkLabel(ctx, "NEGI", -w * 0.6, -stem * 0.45, {
        size: Math.max(11, s * 0.10), tracking: 2, color: css("leek", 0.85),
      });
    }
  });
}

export function skyTears(ctx, x, y, w, h, o = {}) {
  const a = o.alpha ?? 1;
  const tear = clamp(o.tear ?? 0);
  group(ctx, a, () => {
    const top = y;
    const horizon = y + h * 0.78;
    const left = x;
    const right = x + w;
    ctx.fillStyle = css("tealDeep", 0.10 + 0.10 * (1 - tear));
    ctx.fillRect(left, top, w, horizon - top);
    ctx.fillStyle = css("ink", 0.32);
    ctx.fillRect(left, horizon, w, y + h - horizon);

    ctx.fillStyle = css("bone", 0.55);
    for (let i = 0; i < 9; i++) {
      const sx = left + hash(i * 4.3 + 2.1) * w;
      const sy = top + hash(i * 8.7 + 4.4) * h * 0.48;
      dot(ctx, sx, sy, 1 + hash(i * 2.9) * 1.6);
    }
    // crescent moon
    ctx.strokeStyle = css("bone", 0.65);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(right - w * 0.18, top + h * 0.20, h * 0.09, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = css("tealDeep", 0.95);
    ctx.beginPath();
    ctx.arc(right - w * 0.155, top + h * 0.175, h * 0.085, 0, TAU);
    ctx.fill();

    // horizon and clouds
    strokePath(ctx, [[left, horizon], [right, horizon]], css("miku", 0.5), 1.2);
    ctx.strokeStyle = css("dim", 0.55);
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const cx = left + w * (0.18 + i * 0.30);
      const cy = top + h * (0.34 + (i % 2) * 0.10);
      ctx.beginPath();
      ctx.arc(cx, cy, w * 0.035, Math.PI, TAU);
      ctx.arc(cx + w * 0.05, cy, w * 0.045, Math.PI, TAU);
      ctx.arc(cx + w * 0.10, cy, w * 0.032, Math.PI, TAU);
      ctx.stroke();
    }

    // a small head looking up, so the sky has a witness
    const hx = x + w * 0.33;
    const hy = horizon - h * 0.16;
    const hr = h * 0.12;
    ctx.strokeStyle = css("miku", 0.75);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, -Math.PI * 0.25, Math.PI * 1.25);
    ctx.stroke();
    faceFeatures(ctx, hx, hy - hr * 0.05, hr, {
      eyes: "open",
      color: css("mikuHi", 0.85),
    });

    // the tear: once it lands, the horizon ripples
    const eye = { x: hx + hr * 0.42, y: hy - hr * 0.08 };
    if (tear > 0.01) {
      const ty = lerp(eye.y, horizon - h * 0.02, smoothstep(0, 1, tear));
      ctx.fillStyle = css("mikuHi", 0.8);
      ctx.beginPath();
      ctx.moveTo(eye.x, ty - hr * 0.24);
      ctx.bezierCurveTo(eye.x + hr * 0.22, ty + hr * 0.04,
                        eye.x + hr * 0.10, ty + hr * 0.26,
                        eye.x, ty + hr * 0.28);
      ctx.bezierCurveTo(eye.x - hr * 0.10, ty + hr * 0.26,
                        eye.x - hr * 0.22, ty + hr * 0.04,
                        eye.x, ty - hr * 0.24);
      ctx.fill();
      if (tear > 0.94) {
        const ring = 1 - (tear - 0.94) / 0.06;
        ctx.strokeStyle = css("mikuHi", 0.6 * ring);
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(eye.x, horizon, w * (0.05 + i * 0.035) * (1.2 - ring * 0.4),
                      h * 0.012 * (1.2 - ring * 0.4), 0, 0, TAU);
          ctx.stroke();
        }
      }
    }
    if (o.label !== false) {
      inkLabel(ctx, "SKY / TEAR", left, top + h - 6, {
        size: 14, tracking: 2, color: css("ash", 0.7),
      });
    }
  });
}

// A heart-shaped lattice. `erode` removes cells from the outside in.
export function heart(ctx, x, y, s, o = {}) {
  const a = o.alpha ?? 1;
  const erode = clamp(o.erode ?? 0);
  const fill = clamp(o.fill ?? (1 - erode));
  const col = o.color || css("miku", 0.85);
  const lw = o.lw ?? Math.max(1, s * 0.035);
  const seed = o.seed ?? 3;
  group(ctx, a, () => {
    ctx.translate(x, y);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(0, s * 0.42);
      ctx.bezierCurveTo(-s * 0.92, -s * 0.10, -s * 0.56, -s * 0.88, 0, -s * 0.34);
      ctx.bezierCurveTo(s * 0.56, -s * 0.88, s * 0.92, -s * 0.10, 0, s * 0.42);
      ctx.closePath();
    };
    path();
    if (fill > 0.01) {
      ctx.fillStyle = css("miku", 0.10 + 0.16 * fill);
      ctx.fill();
    }
    ctx.save();
    path();
    ctx.clip();
    const cells = [];
    for (let ix = -8; ix <= 8; ix++) {
      for (let iy = -7; iy <= 7; iy++) {
        const px = (ix / 8) * s * 0.72;
        const py = (iy / 7) * s * 0.60;
        if (!ctx.isPointInPath(px, py)) continue;
        const r = hash(seed + ix * 3.7 + iy * 9.1);
        const edge = 1 - Math.min(1, Math.hypot(ix / 8, iy / 7));
        const alive = r > erode * 1.25 - edge * 0.15;
        if (!alive) continue;
        cells.push([px, py, r]);
      }
    }
    for (const [px, py, r] of cells) {
      ctx.fillStyle = css("mikuHi", 0.22 + 0.55 * fill);
      dot(ctx, px, py, lw * (0.45 + 0.45 * r));
    }
    ctx.restore();
    path();
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.stroke();

    if (o.shave > 0.01) {
      const shave = clamp(o.shave);
      ctx.strokeStyle = css("red", 0.55);
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      ctx.moveTo(-s * 0.75, -s * 0.30 + shave * s * 0.72);
      ctx.lineTo(s * 0.75, -s * 0.42 + shave * s * 0.72);
      ctx.stroke();
      ctx.fillStyle = css("miku", 0.45 * (1 - shave));
      for (let i = 0; i < 9; i++) {
        const u = (i / 8) * s * 1.3 - s * 0.65;
        dot(ctx, u, -s * 0.28 + shave * s * 0.78 + Math.sin(i * 2.3) * s * 0.05,
          1 + hash(i * 3.3) * lw * 0.6);
      }
    }
    if (o.label) {
      inkLabel(ctx, o.label, -s * 0.4, s * 0.78, {
        size: Math.max(11, s * 0.14), tracking: 2, color: col,
      });
    }
  });
}

// ---------------------------------------------------------------- machines
export function ruinFrame(ctx, x, y, w, h, o = {}) {
  const a = o.alpha ?? 1;
  const br = clamp(o.break ?? 0.8);
  group(ctx, a, () => {
    ctx.strokeStyle = css("dim", 0.65);
    ctx.lineWidth = 1.2;
    const frags = [
      [x, y, w * 0.44, h * 0.44],
      [x + w * 0.48, y + h * 0.06, w * 0.52, h * 0.38],
      [x + w * 0.04, y + h * 0.52, w * 0.40, h * 0.48],
      [x + w * 0.50, y + h * 0.56, w * 0.46, h * 0.40],
    ];
    frags.forEach((f, i) => {
      ctx.strokeRect(f[0] + i * 3 * br, f[1] + i * 2 * br, f[2], f[3]);
      ctx.fillStyle = css("tealDeep", 0.06 + 0.06 * (1 - br));
      ctx.fillRect(f[0] + i * 3 * br, f[1] + i * 2 * br, f[2], f[3]);
    });
    // two tape reels
    for (let i = 0; i < 2; i++) {
      const cx = x + w * (0.22 + i * 0.22);
      const cy = y + h * 0.22;
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.08, 0, TAU);
      ctx.stroke();
      for (let k = 0; k < 4; k++) {
        const an = (k / 4) * TAU + o.spin * 0.6;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(an) * h * 0.075, cy + Math.sin(an) * h * 0.075);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = css("red", 0.55 * br);
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 7; i++) {
      const px = x + w * hash(i * 5.1 + 1.2);
      const py = y + h * hash(i * 7.7 + 3.4);
      ctx.beginPath();
      ctx.moveTo(px - 8, py - 10);
      ctx.lineTo(px, py);
      ctx.lineTo(px + 9, py - 7);
      ctx.stroke();
    }
    inkLabel(ctx, "HOME VIDEO / RUIN", x, y - 10, {
      size: 14, tracking: 2, color: css("ash", 0.8),
    });
  });
}

export function infinityLoop(ctx, x, y, w, o = {}) {
  const a = o.alpha ?? 1;
  const p = o.phase ?? 0;
  group(ctx, a, () => {
    ctx.strokeStyle = o.color || css("miku", 0.6);
    ctx.lineWidth = o.lw ?? 1.5;
    ctx.setLineDash([Math.max(2, w * 0.012), Math.max(2, w * 0.018)]);
    ctx.lineDashOffset = -p * w * 0.06;
    ctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const t = (i / 160) * TAU;
      const d = 1 + Math.sin(t) * Math.sin(t);
      const px = x + (w * 0.5) * Math.cos(t) / d;
      const py = y + (w * 0.22) * Math.sin(t) * Math.cos(t) / d;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    inkLabel(ctx, "ETERNAL / LOOP", x - w * 0.5, y + w * 0.30, {
      size: 14, tracking: 2, color: css("miku", 0.7),
    });
  });
}

export function toyKey(ctx, x, y, s, o = {}) {
  const a = o.alpha ?? 1;
  group(ctx, a, () => {
    ctx.translate(x, y);
    ctx.rotate(o.spin ?? 0);
    ctx.strokeStyle = o.color || css("dim", 0.8);
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.34, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const an = (i / 8) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(an) * s * 0.30, Math.sin(an) * s * 0.30);
      ctx.lineTo(Math.cos(an) * s * 0.48, Math.sin(an) * s * 0.48);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, s * 0.70);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, s * 0.78, s * 0.24, Math.PI * 0.1, Math.PI * 1.5);
    ctx.stroke();
    inkLabel(ctx, "TOY", 0, s * 1.20, {
      size: Math.max(10, s * 0.18), align: "center", tracking: 2,
      color: css("ash", 0.7),
    });
  });
}

export function mirrorPane(ctx, x, y, w, h, o = {}) {
  const a = o.alpha ?? 1;
  const rec = Math.max(2, Math.round(o.recurse ?? 6));
  group(ctx, a, () => {
    for (let i = 0; i < rec; i++) {
      const u = i / rec;
      const px = x + w * 0.5 * u;
      const py = y + h * 0.5 * u;
      const pw = w * (1 - u);
      const ph = h * (1 - u);
      ctx.strokeStyle = i === 0 ? css("red", 0.55) : css("miku", 0.30 - i * 0.03);
      ctx.lineWidth = i === 0 ? 1.6 : 1;
      ctx.strokeRect(px + 0.5, py + 0.5, pw, ph);
    }
    if (o.text) {
      ctx.save();
      ctx.translate(x + w, y + h * 0.58);
      ctx.scale(-1, 1);
      inkLabel(ctx, o.text, 0, 0, {
        size: o.textSize || 22, align: "left", tracking: 1,
        color: css("miku", 0.42 * a), alpha: 0.8,
      });
      ctx.restore();
    }
    ctx.strokeStyle = css("bone", 0.22);
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const sx = x + w * (0.18 + i * 0.21);
      ctx.beginPath();
      ctx.moveTo(sx, y + h * 0.10);
      ctx.lineTo(sx + w * 0.10, y + h * 0.62);
      ctx.lineTo(sx - w * 0.04, y + h * 0.92);
      ctx.stroke();
    }
    inkLabel(ctx, "MIRROR / REPEAT", x, y - 10, {
      size: 14, tracking: 2, color: css("ash", 0.75),
    });
  });
}

export function displaySleep(ctx, x, y, w, h, o = {}) {
  const a = o.alpha ?? 1;
  const close = clamp(o.close ?? 0);
  group(ctx, a, () => {
    panelFrame(ctx, x, y, w, h);
    const inner = { x: x + w * 0.06, y: y + h * 0.10, w: w * 0.88, h: h * 0.70 };
    ctx.fillStyle = css("tealDeep", 0.12);
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
    const mid = inner.y + inner.h * 0.55;
    ctx.strokeStyle = css("miku", 0.75);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const u = i / 80;
      const amp = (1 - close) * inner.h * 0.30;
      const px = inner.x + u * inner.w;
      const py = mid + Math.sin(u * 28 + (o.phase || 0) * TAU) * amp;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // a small sleeping figure, horizontal
    ctx.strokeStyle = css("bone", 0.45 * (1 - close));
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(inner.x + inner.w * 0.72, mid - inner.h * 0.20, inner.h * 0.055, 0, TAU);
    ctx.moveTo(inner.x + inner.w * 0.72, mid - inner.h * 0.14);
    ctx.lineTo(inner.x + inner.w * 0.72, mid + inner.h * 0.05);
    ctx.lineTo(inner.x + inner.w * 0.62, mid + inner.h * 0.14);
    ctx.stroke();
    if (close > 0.02) {
      ctx.fillStyle = css("ink", 0.90 * close);
      ctx.fillRect(inner.x, inner.y + (1 - close) * inner.h, inner.w, inner.h * close);
    }
    ctx.fillStyle = close > 0.85 ? css("red", 0.9) : css("amber", 0.9);
    dot(ctx, x + w * 0.94, y + h * 0.86, Math.max(2, h * 0.018));
    inkLabel(ctx, o.label || "DISPLAY / SLEEP", x, y - 8, {
      size: 14, tracking: 2, color: css("ash", 0.8),
    });
  });
}

function panelFrame(ctx, x, y, w, h) {
  ctx.strokeStyle = css("dim", 0.7);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.42, y + h);
  ctx.lineTo(x + w * 0.38, y + h * 1.12);
  ctx.lineTo(x + w * 0.62, y + h * 1.12);
  ctx.lineTo(x + w * 0.58, y + h);
  ctx.stroke();
}

export function recycleBin(ctx, x, y, s, o = {}) {
  const a = o.alpha ?? 1;
  const drop = clamp(o.drop ?? 0);
  group(ctx, a, () => {
    ctx.strokeStyle = css("ash", 0.8);
    ctx.lineWidth = Math.max(1.2, s * 0.022);
    ctx.beginPath();
    ctx.moveTo(x - s * 0.30, y);
    ctx.lineTo(x + s * 0.30, y);
    ctx.lineTo(x + s * 0.22, y + s * 0.62);
    ctx.lineTo(x - s * 0.22, y + s * 0.62);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.40, y);
    ctx.lineTo(x + s * 0.40, y);
    ctx.moveTo(x - s * 0.12, y - s * 0.10);
    ctx.lineTo(x + s * 0.12, y - s * 0.10);
    ctx.stroke();
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * s * 0.13, y + s * 0.08);
      ctx.lineTo(x + i * s * 0.11, y + s * 0.54);
      ctx.stroke();
    }
    if (drop > 0.01 && drop < 1.01) {
      const px = lerp(x - s * 0.10, x, smoothstep(0, 1, drop));
      const py = lerp(y - s * 0.95, y + s * 0.28, smoothstep(0, 1, drop));
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(drop * 0.9);
      ctx.strokeStyle = css("miku", 0.8);
      ctx.strokeRect(-s * 0.09, -s * 0.12, s * 0.18, s * 0.24);
      ctx.beginPath();
      for (let i = 0; i <= 14; i++) {
        const u = i / 14;
        ctx.lineTo(-s * 0.06 + u * s * 0.12,
          s * 0.02 + Math.sin(u * 12 + drop * 9) * s * 0.03);
      }
      ctx.stroke();
      ctx.restore();
    }
    inkLabel(ctx, o.label || "TRASH", x, y + s * 0.86, {
      size: Math.max(11, s * 0.16), align: "center", tracking: 2,
      color: css("ash", 0.75),
    });
  });
}

// ----------------------------------------------------------- light / people
export function futureLight(ctx, x, y, w, h, o = {}) {
  const a = o.alpha ?? 1;
  const fade = clamp(o.fade ?? 1);
  group(ctx, a, () => {
    const horizon = y + h * 0.72;
    const cx = x + w * 0.5;
    ctx.fillStyle = css("amber", 0.04 + 0.10 * fade);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = css("amber", 0.70 * fade);
    ctx.lineWidth = 1.3;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, horizon + h * 0.12, h * (0.16 + i * 0.11), Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
    }
    ctx.strokeStyle = css("amber", 0.32 * fade);
    for (let i = -5; i <= 5; i++) {
      const an = -Math.PI * 0.5 + i * 0.13;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(an) * h * 0.14, horizon + Math.sin(an) * h * 0.14);
      ctx.lineTo(cx + Math.cos(an) * h * 0.58, horizon + Math.sin(an) * h * 0.58);
      ctx.stroke();
    }
    strokePath(ctx, [[x, horizon], [x + w, horizon]], css("amber", 0.55 * fade), 1.2);
    // a tiny person facing the disappearing light
    ctx.strokeStyle = css("bone", 0.65 * fade);
    ctx.lineWidth = 1.2;
    const px = x + w * 0.25;
    ctx.beginPath();
    ctx.arc(px, horizon - h * 0.15, h * 0.045, 0, TAU);
    ctx.moveTo(px, horizon - h * 0.105);
    ctx.lineTo(px, horizon - h * 0.01);
    ctx.moveTo(px, horizon - h * 0.07);
    ctx.lineTo(px - h * 0.07, horizon - h * 0.12);
    ctx.moveTo(px, horizon - h * 0.07);
    ctx.lineTo(px + h * 0.08, horizon - h * 0.03);
    ctx.stroke();
    inkLabel(ctx, "FUTURE / LIGHT", x, y - 8, {
      size: 14, tracking: 2, color: css("amber", 0.75),
    });
  });
}

export function emptySeats(ctx, x, y, w, h, o = {}) {
  const a = o.alpha ?? 1;
  const rows = o.rows ?? 3;
  const cols = o.cols ?? 9;
  group(ctx, a, () => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sx = x + (w / cols) * (c + 0.12);
        const sy = y + (h / rows) * (r + 0.15);
        const sw = (w / cols) * 0.72;
        const sh = (h / rows) * 0.62;
        ctx.strokeStyle = css("dim", 0.42);
        ctx.lineWidth = 1;
        ctx.strokeRect(sx, sy, sw, sh * 0.56);
        ctx.beginPath();
        ctx.moveTo(sx + sw * 0.08, sy + sh * 0.56);
        ctx.lineTo(sx + sw * 0.20, sy + sh);
        ctx.lineTo(sx + sw * 0.80, sy + sh);
        ctx.lineTo(sx + sw * 0.92, sy + sh * 0.56);
        ctx.stroke();
      }
    }
    const hx = x + w * 0.18;
    const hy = y + h * 0.32;
    ctx.strokeStyle = css("amber", 0.75);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(hx, hy, h * 0.08, 0, TAU);
    ctx.moveTo(hx, hy + h * 0.08);
    ctx.lineTo(hx, hy + h * 0.28);
    ctx.stroke();
    inkLabel(ctx, "AUDIENCE 0", x, y - 9, {
      size: 14, tracking: 2, color: css("red", 0.75),
    });
  });
}

export function soundRing(ctx, x, y, p, o = {}) {
  const a = (o.alpha ?? 1) * (1 - clamp(p));
  group(ctx, a, () => {
    ctx.strokeStyle = o.color || css("mikuHi", 0.7);
    ctx.lineWidth = o.lw ?? 1.4;
    for (let i = 0; i < (o.rings ?? 3); i++) {
      const u = clamp(p - i * 0.16);
      if (u <= 0) continue;
      ctx.beginPath();
      ctx.arc(x, y, (o.r0 ?? 18) + u * (o.r1 ?? 180), 0, TAU);
      ctx.stroke();
    }
  });
}

export function note(ctx, x, y, s, o = {}) {
  const a = o.alpha ?? 1;
  group(ctx, a, () => {
    ctx.strokeStyle = o.color || css("miku", 0.8);
    ctx.fillStyle = o.color || css("miku", 0.8);
    ctx.lineWidth = Math.max(1, s * 0.09);
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.28, s * 0.20, -0.35, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + s * 0.24, y - s * 0.05);
    ctx.lineTo(x + s * 0.24, y - s * 0.86);
    ctx.quadraticCurveTo(x + s * 0.52, y - s * 0.80, x + s * 0.58, y - s * 0.52);
    ctx.stroke();
  });
}

export function dissolveDots(ctx, x, y, w, h, p, o = {}) {
  const a = o.alpha ?? 1;
  const prog = clamp(p);
  group(ctx, a, () => {
    ctx.fillStyle = o.color || css("mikuHi", 0.75);
    for (let i = 0; i < (o.count ?? 54); i++) {
      const seed = hash(i * 3.7 + (o.seed || 0));
      const u = (seed + prog * (0.4 + seed)) % 1;
      const px = x + hash(i * 9.1 + 1.1) * w + Math.sin(prog * 4 + i) * w * 0.02;
      const py = y + h * (1 - u) - prog * h * (0.4 + seed * 0.8);
      if (py < y || hash(i * 5.3) < prog * 0.35) continue;
      dot(ctx, px, py, 0.8 + hash(i * 2.3) * 1.8);
    }
  });
}

// --------------------------------------------------------------- shorthand
// A few tiny wrappers so scenes can stay readable.
export function motifLabel(ctx, text, x, y, o = {}) {
  inkLabel(ctx, text, x, y, {
    size: o.size ?? 14, tracking: o.tracking ?? 2,
    color: o.color || css("ash", 0.72), align: o.align || "left",
  });
}

export function motifFade(f, o = {}) {
  const inA = smoothstep(o.in ?? 0.10, o.inFull ?? 0.45, f.local ?? 0);
  const outAt = o.outAt ?? Math.max(0.7, (f.line ? f.line.end - f.line.start : 1) - 0.35);
  const out = 1 - smoothstep(outAt, outAt + (o.out ?? 0.35), f.local ?? 0);
  return clamp(Math.min(inA, out));
}

// ------------------------------------------------------------ the big room
// A concert hall drawn as perspective: trusses, side light strips, a floor
// that recedes, and haze. Everything scales off the vanishing point, so the
// scene can fly the camera through it.
export function hall(ctx, o = {}) {
  const {
    t = 0, vpx = 0.5, vpy = 0.52, alpha = 1, energy = 0.3, horizon = 0.62,
    color = css("tealDeep"), warm = 0, beams = 6,
  } = o;
  const W = o.w ?? 1920, H = o.h ?? 1080;
  const cx = W * vpx, cy = H * vpy;
  group(ctx, alpha, () => {
    // ceiling: trusses converging on the vanishing point
    ctx.strokeStyle = css("dim", 0.32);
    ctx.lineWidth = 1;
    const trusses = o.trusses ?? 9;
    for (let i = 0; i <= trusses; i++) {
      const u = i / trusses;
      const x0 = u * W;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(cx + (x0 - cx) * 0.12, cy - H * 0.06);
      ctx.stroke();
      const y0 = (i / trusses) * H * horizon;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(cx - W * 0.06, cy - H * 0.04);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(W, y0);
      ctx.lineTo(cx + W * 0.06, cy - H * 0.04);
      ctx.stroke();
    }

    // side light strips: verticals that get shorter and fainter with distance
    for (let i = 0; i < 12; i++) {
      const u = Math.pow(i / 11, 1.7);
      const px = u * 0.46;
      const hgt = H * (0.62 - u * 0.42);
      const a = (0.34 - u * 0.28) * (0.6 + 0.8 * energy);
      ctx.fillStyle = css("miku", Math.max(0, a) * 0.5);
      ctx.fillRect(W * (0.5 - px) - 2, cy - hgt * 0.62, 4, hgt);
      ctx.fillRect(W * (0.5 + px) - 2, cy - hgt * 0.62, 4, hgt);
    }

    // haze bands
    for (let i = 0; i < 5; i++) {
      const y = H * (0.30 + i * 0.085);
      const g = ctx.createLinearGradient(0, y - 40, 0, y + 40);
      g.addColorStop(0, css("tealDeep", 0));
      g.addColorStop(0.5, css("tealDeep", 0.05 + 0.05 * (1 - i / 5)));
      g.addColorStop(1, css("tealDeep", 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 40, W, 80);
    }

    // stage floor: a bright lip and receding horizontal lines
    const fy = H * horizon;
    ctx.strokeStyle = color;
    ctx.globalAlpha *= 0.8;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, fy);
    ctx.lineTo(W, fy);
    ctx.stroke();
    ctx.globalAlpha /= 0.8;
    for (let i = 1; i <= 14; i++) {
      const u = i / 14;
      const y = fy + (H - fy) * Math.pow(u, 2.1);
      ctx.strokeStyle = css("miku", 0.05 + 0.12 * u * (0.5 + energy));
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // reflections of the stage lip
    const rg = ctx.createLinearGradient(0, fy, 0, H);
    rg.addColorStop(0, css("miku", 0.10 + 0.08 * energy));
    rg.addColorStop(1, css("miku", 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, fy, W, H - fy);

    // spotlights from the ceiling
    for (let i = 0; i < beams; i++) {
      const u = (i + 0.5) / beams;
      const sx = W * (0.12 + u * 0.76);
      const sway = Math.sin(t * 0.35 + i * 1.7) * 0.04;
      const tx = cx + (sx - cx) * (0.35 + sway);
      const g = ctx.createLinearGradient(sx, 0, tx, fy + H * 0.05);
      const amt = (0.05 + 0.11 * energy) * (warm > u ? 1.4 : 0.8);
      g.addColorStop(0, withAlpha(css(warm > u ? "amber" : "mikuHi"), amt));
      g.addColorStop(1, css(warm > u ? "amber" : "mikuHi", 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(sx - 26, 0);
      ctx.lineTo(sx + 26, 0);
      ctx.lineTo(tx + 190, fy + H * 0.06);
      ctx.lineTo(tx - 190, fy + H * 0.06);
      ctx.closePath();
      ctx.fill();
    }
  });
  void cy;
}

const withAlpha = fade;

// The audience: a sea of penlights, receding into the dark. Far rows are
// dabs, near rows are sticks, and a wave of agreement runs across them.
export function penlightSea(ctx, o = {}) {
  const {
    x = 0, y = 640, w = 1920, h = 440, t = 0, alpha = 1, energy = 1,
    rows = 16, seed = 11, warm = 0.22, wave = 1,
  } = o;
  group(ctx, alpha, () => {
    ctx.lineCap = "round";
    for (let r = 0; r < rows; r++) {
      const v = r / (rows - 1);
      const depth = v;
      const rowY = y + h * Math.pow(v, 1.55);
      const count = Math.round(26 + 118 * Math.pow(v, 1.3));
      const sizeScale = 0.30 + 1.05 * Math.pow(v, 1.5);
      const dim = 0.28 + 0.72 * Math.pow(v, 1.2);
      for (let i = 0; i < count; i++) {
        const hx = hash(seed + r * 31.7 + i * 7.13);
        const hy = hash(seed + r * 13.3 + i * 3.71);
        const px = x + ((i + hx * 0.9) / count) * w;
        const py = rowY + (hy - 0.5) * h * 0.05;
        const phase = hash(seed + i * 5.7 + r * 2.3) * Math.PI * 2;
        const swing = Math.sin(t * 2.6 - px * 0.0038 + phase) * (4 + 8 * depth) * wave;
        const len = (5 + 15 * sizeScale) * (0.85 + 0.3 * Math.sin(t * 3.1 + phase));
        const tipX = px + swing;
        const tipY = py - len;
        const c = hx < warm ? "amber" : (hy < 0.10 ? "bone" : "miku");
        const a = (0.14 + 0.40 * dim) * (0.62 + 0.28 * Math.sin(t * 2.2 + phase));
        // the silhouette of a head under each light, so it reads as a crowd
        ctx.fillStyle = css("ink", 0.55 * dim);
        dot(ctx, px, py + 2 * sizeScale, Math.max(1.2, 2.6 * sizeScale));
        // the stick
        ctx.strokeStyle = css(c, Math.min(0.62, a));
        ctx.lineWidth = Math.max(1, 1.1 * sizeScale);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        // the light
        ctx.fillStyle = c === "bone" ? css("bone", a * 1.2) : css("mikuHi", a * 1.35);
        dot(ctx, tipX, tipY, Math.max(0.8, 1.5 * sizeScale));
      }
    }
    // one broad glow so the whole crowd reads as light, not sticks
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, css("miku", 0.05 + 0.05 * energy));
    g.addColorStop(1, css("miku", 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  });
}

// A giant on-stage screen: frame, scanlines, and whatever the caller draws.
export function stageScreen(ctx, x, y, w, h, o = {}) {
  const a = o.alpha ?? 1;
  group(ctx, a, () => {
    ctx.fillStyle = css("ink", 0.72);
    ctx.fillRect(x, y, w, h);
    if (o.draw) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      o.draw(ctx, x, y, w, h);
      ctx.restore();
    }
    // scanlines + a slight vignette, so it reads as a screen and not a window
    ctx.fillStyle = css("ink", 0.18);
    for (let sy = y; sy < y + h; sy += 4) ctx.fillRect(x, sy, w, 1.6);
    const g = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.2,
      x + w / 2, y + h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, css("ink", 0));
    g.addColorStop(1, css("ink", 0.55));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    if (o.label) {
      inkLabel(ctx, o.label, x, y - 12, {
        size: 15, tracking: 3, color: css("ash", 0.85),
      });
    }
  });
}
