// The two figures the film keeps returning to: the singer and the listener.
//
// They are drawn as holograms, not as illustrations. The silhouette has to
// read at 180 px and still hold together at 560 px, so the drawing is built
// from a few confident shapes: twin tails that hang like hair instead of
// nesting around the body, a dress with a real waist, and a face made of two
// eyes and a mouth. On top of that silhouette sits the film's own material --
// scanlines clipped to the body, a travelling light, and data motes -- so she
// belongs to the machine that is singing her.
//
// Everything is parameterised by the same options the scenes already pass:
//   singer(ctx, x, y, h, { alpha, color, accent, deep, tilt, mouth,
//                          smile, sadMouth, heart, dissolve, crack, wave,
//                          wavePhase, handsTogether, reach, seed, t, lw,
//                          phase, breath, light })
//   listener(ctx, x, y, h, { alpha, color, fill, smile, sadMouth, scan,
//                            turnAway, tilt, t, lw, phase })
//
// `t` is the song time. When a scene passes it, the figure breathes, sways,
// and drags its twin tails a beat behind the body; without it the figure
// simply stands still, which is also a valid pose.
//
// She has no face. `eyes`, `mouth`, `smile` and `sadMouth` are still accepted
// (the scenes pass them) and are used only as posture cues: mouth drives the
// glow in the throat, everything else is ignored. Identity is the silhouette.

import { css } from "./palette.js";
import { clamp, hash, lerp } from "./kit.js";

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

// Re-alpha any `rgb()`/`rgba()` colour string. `css(name, 1)` returns the
// three-component form, so a naive regex would leave the glow opaque and turn
// it into a rectangle.
function fade(colour, k) {
  const m = String(colour).match(/rgba?\(([^)]+)\)/);
  if (!m) return colour;
  const p = m[1].split(",").map((v) => v.trim());
  return `rgba(${p[0]},${p[1]},${p[2]},${clamp(k).toFixed(3)})`;
}

function softGlow(ctx, x, y, r, colour, alpha) {
  if (alpha <= 0.002) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, fade(colour, alpha));
  g.addColorStop(1, fade(colour, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function strokePath(ctx, pts, colour, lw) {
  if (!pts.length) return;
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(0.5, lw);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function curve(p0, p1, p2, p3, n = 20) {
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

// Unit normals of a polyline: the direction a ribbon grows sideways.
function normals(pts) {
  const n = pts.length;
  const nx = [], ny = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    nx.push(-dy / l);
    ny.push(dx / l);
  }
  return [nx, ny];
}

// Add a closed shape around a centreline with per-point half-widths.
function addRibbon(ctx, pts, widths) {
  const n = pts.length;
  if (n < 2) return;
  const [nx, ny] = normals(pts);
  ctx.moveTo(pts[0][0] + nx[0] * widths[0], pts[0][1] + ny[0] * widths[0]);
  for (let i = 1; i < n; i++) {
    ctx.lineTo(pts[i][0] + nx[i] * widths[i], pts[i][1] + ny[i] * widths[i]);
  }
  for (let i = n - 1; i >= 0; i--) {
    ctx.lineTo(pts[i][0] - nx[i] * widths[i], pts[i][1] - ny[i] * widths[i]);
  }
  ctx.closePath();
}

function ribbon(ctx, pts, widths) {
  ctx.beginPath();
  addRibbon(ctx, pts, widths);
}

// One edge of a ribbon, offset by `sign * width`, for rim light.
function rim(pts, widths, sign, k = 1) {
  const [nx, ny] = normals(pts);
  return pts.map((p, i) => [p[0] + nx[i] * widths[i] * sign * k, p[1] + ny[i] * widths[i] * sign * k]);
}

// ------------------------------------------------------------ the blank face
// She is never given a face. No eyes, no nose, no mouth: identity has to come
// from the silhouette (twin tails, hair ties, headset, tie, detached sleeves,
// the 01 on her arm, the layered skirt, the boots) and from where the light
// falls. This function paints the *absence*: a dark plate where a face would
// be, one rim light, and -- when she is singing -- a glow low in the throat, so
// the voice still has a body without ever having features.
function blankFace(ctx, r, o) {
  const hi = o.accent || css("mikuHi", 0.95);
  ctx.save();
  // the plate: darker than the skull, so the head reads as a volume
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.86, r * 1.02, 0, 0, TAU);
  ctx.fillStyle = css("ink", 0.35);
  ctx.fill();
  // the only light on it: a rim from the left, never a feature
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.86, r * 1.02, 0, Math.PI * 0.62, Math.PI * 1.38);
  ctx.strokeStyle = fade(hi, 0.30);
  ctx.lineWidth = Math.max(1, r * 0.055);
  ctx.stroke();
  // singing: a soft glow low in the throat, where a mouth would have been
  const open = clamp(o.mouth == null ? 0 : o.mouth);
  if (open > 0.02) {
    softGlow(ctx, 0, r * 0.72, r * 0.85, hi, 0.10 + 0.16 * open);
  }
  ctx.restore();
}

// ------------------------------------------------------------ holo texture
// Scanlines and one travelling light band, clipped to whatever silhouette
// paths the caller has just built. Cheap, and it is what makes the figures
// belong to the same machine as the ASCII portrait.
function holoTexture(ctx, s, paths, colour, lightPos, strength) {
  const k = clamp(strength == null ? 1 : strength);
  if (k <= 0.01) return;
  ctx.save();
  ctx.beginPath();
  for (const p of paths) p();
  ctx.clip();

  const step = Math.max(3.6, s * 0.022);
  ctx.fillStyle = fade(colour, 0.036 * k);
  for (let y = -1.02 * s; y <= 0.02 * s; y += step) {
    ctx.fillRect(-0.55 * s, y, 1.10 * s, Math.max(1, s * 0.0045));
  }

  const band = (lightPos == null ? 0.35 : lightPos) * 1.15 - 0.08;
  const half = 0.085 * s;
  const g = ctx.createLinearGradient(0, band * s - half, 0, band * s + half);
  g.addColorStop(0, fade(colour, 0));
  g.addColorStop(0.5, fade(colour, 0.16 * k));
  g.addColorStop(1, fade(colour, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-0.55 * s, band * s - half, 1.10 * s, half * 2);
  ctx.restore();
}

// --------------------------------------------------------------- the singer
export function singer(ctx, x, y, h, o = {}) {
  const s = h;
  const col = o.color || css("miku", 0.92);
  const hi = o.accent || css("mikuHi", 0.95);
  const deep = o.deep || css("tealDeep", 0.92);
  const lw = o.lw ?? Math.max(1.2, s * 0.0055);
  const dissolve = clamp(o.dissolve ?? 0);
  const crack = clamp(o.crack ?? 0);
  const heartFill = o.heart == null ? null : clamp(o.heart);
  const t = o.t ?? 0;
  const ph = o.phase ?? 0;

  // idle life: a breath every four seconds, a weight shift every eleven
  const breath = Math.sin(TAU * (t / 4.2) + ph);
  const sway = Math.sin(TAU * (t / 11.4) + ph * 0.8);
  const bob = breath * s * 0.0035;

  // proportions: about six heads tall, long legs, skirt to mid-thigh
  const headR = s * 0.098;
  const headY = -0.858 * s + bob;
  const shY = -0.735 * s + bob * 0.6;
  const shW = s * 0.108;
  const waistY = -0.565 * s;
  const waistW = s * 0.056;
  const hipW = s * 0.086;
  const hemY = -0.315 * s;
  const hemW = s * 0.152;

  const tails = [-1, 1].map((side) => {
    const base = curve(
      [side * 0.064 * s, -0.898 * s],
      [side * 0.196 * s, -0.868 * s],
      [side * 0.180 * s, -0.520 * s],
      [side * 0.132 * s, -0.102 * s],
      30,
    );
    const pts = base.map((p, i) => {
      const u = i / (base.length - 1);
      const w1 = Math.sin(TAU * (t / 3.6) - u * 2.4 + side * 1.1 + ph);
      const w2 = Math.sin(TAU * (t / 9.0) - u * 1.2 + side * 2.2 + ph * 0.7);
      const amp = (w1 * 0.55 + w2 * 0.45) * Math.pow(u, 1.6) * 0.030 * s;
      // the tip flicks outward, away from the body
      return [p[0] + amp + side * Math.pow(u, 3.6) * 0.032 * s, p[1] - amp * 0.35];
    });
    const wide = pts.map((_, i) => {
      const u = i / (pts.length - 1);
      const bulk = 0.021 + 0.026 * Math.sin(Math.PI * Math.pow(u, 0.85));
      return s * (0.004 + bulk * (1 - Math.pow(u, 2.4)));
    });
    return { side, pts, wide };
  });

  const addDress = () => {
    ctx.moveTo(-shW * 0.94, shY);
    ctx.quadraticCurveTo(-shW * 1.06, shY - 0.028 * s, -shW * 0.40, shY - 0.034 * s);
    ctx.quadraticCurveTo(0, shY - 0.050 * s, shW * 0.40, shY - 0.034 * s);
    ctx.quadraticCurveTo(shW * 1.06, shY - 0.028 * s, shW * 0.94, shY);
    ctx.bezierCurveTo(shW * 0.76, -0.665 * s, waistW * 1.60, -0.616 * s, waistW, waistY);
    ctx.bezierCurveTo(waistW * 1.70, -0.520 * s, hipW * 0.86, -0.424 * s, hemW, hemY);
    ctx.quadraticCurveTo(0, hemY + 0.034 * s, -hemW, hemY);
    ctx.bezierCurveTo(-hipW * 0.86, -0.424 * s, -waistW * 1.70, -0.520 * s, -waistW, waistY);
    ctx.bezierCurveTo(-waistW * 1.60, -0.616 * s, -shW * 0.76, -0.665 * s, -shW * 0.94, shY);
    ctx.closePath();
  };
  const dressPath = () => {
    ctx.beginPath();
    addDress();
  };

  group(ctx, o.alpha ?? 1, () => {
    ctx.translate(x, y);
    ctx.rotate((o.tilt || 0) + sway * 0.006);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Hologram light: a halo behind her and a pool at her feet. A sampler
    // (`glow: false`) has to skip this: a gradient covering the frame is not
    // her body, and points taken from it are fog, not a silhouette.
    if (o.glow !== false) {
      softGlow(ctx, 0, -0.58 * s, 0.62 * s, css("tealDeep", 1), 0.30);
      softGlow(ctx, 0, headY, 0.30 * s, css("mikuHi", 1), 0.075);
      ctx.fillStyle = fade(col, 0.14);
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.195 * s, 0.017 * s, 0, 0, TAU);
      ctx.fill();
    }

    // ---- twin tails: the silhouette's loudest sign ----------------------
    for (const tail of tails) {
      const { side, pts, wide } = tail;
      const g = ctx.createLinearGradient(0, -0.92 * s, 0, -0.18 * s);
      g.addColorStop(0, fade(col, 0.20));
      g.addColorStop(0.45, fade(deep, 0.26));
      g.addColorStop(1, fade(deep, 0.03));
      ctx.fillStyle = g;
      ribbon(ctx, pts, wide);
      ctx.fill();
      ctx.strokeStyle = fade(col, 0.48);
      ctx.lineWidth = lw * 0.75;
      ctx.stroke();
      // rim light on the outside edge, and two strands inside the mass
      strokePath(ctx, rim(pts, wide, side, 0.88), fade(hi, 0.34), lw * 0.8);
      strokePath(ctx, rim(pts, wide, -side, 0.30), fade(hi, 0.16), lw * 0.6);
      strokePath(ctx, rim(pts, wide, side * 0.30), fade(col, 0.28), lw * 0.55);
      // hair tie: a hard square with a magenta rim — her anchor, and the first
      // thing the film ever shows
      ctx.save();
      ctx.translate(side * 0.066 * s, -0.895 * s);
      ctx.rotate(side * 0.20);
      ctx.fillStyle = fade(deep, 0.95);
      ctx.fillRect(-0.019 * s, -0.023 * s, 0.038 * s, 0.046 * s);
      ctx.strokeStyle = css("red", 0.6);
      ctx.lineWidth = lw * 0.55;
      ctx.strokeRect(-0.019 * s, -0.023 * s, 0.038 * s, 0.046 * s);
      ctx.restore();
    }

    // ---- legs: tapered, with thigh-high boots ---------------------------
    for (const side of [-1, 1]) {
      const hip = [side * 0.055 * s, -0.500 * s];
      const knee = [side * 0.050 * s, -0.255 * s];
      const ankle = [side * 0.046 * s, -0.030 * s];
      ctx.strokeStyle = fade(col, 0.78);
      ctx.lineWidth = lw * 2.3;
      ctx.beginPath();
      ctx.moveTo(hip[0], hip[1]);
      ctx.quadraticCurveTo(side * 0.062 * s, -0.370 * s, knee[0], knee[1]);
      ctx.quadraticCurveTo(side * 0.044 * s, -0.120 * s, ankle[0], ankle[1]);
      ctx.stroke();
      // the boot edge is the one line that makes a leg read as a leg
      ctx.strokeStyle = fade(hi, 0.35);
      ctx.lineWidth = lw * 0.7;
      ctx.beginPath();
      ctx.moveTo(side * 0.038 * s, -0.255 * s);
      ctx.lineTo(side * 0.062 * s, -0.248 * s);
      ctx.stroke();
      ctx.fillStyle = fade(deep, 0.92);
      ctx.beginPath();
      ctx.ellipse(side * 0.050 * s, -0.014 * s, 0.031 * s, 0.015 * s, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = fade(hi, 0.40);
      ctx.lineWidth = lw * 0.6;
      ctx.stroke();
    }

    // ---- dress: one filled silhouette ----------------------------------
    const dg = ctx.createLinearGradient(0, shY, 0, hemY);
    dg.addColorStop(0, fade(col, 0.22));
    dg.addColorStop(0.55, fade(deep, 0.30));
    dg.addColorStop(1, fade(deep, 0.06));
    dressPath();
    ctx.fillStyle = dg;
    ctx.fill();
    ctx.strokeStyle = fade(col, 0.78);
    ctx.lineWidth = lw;
    ctx.stroke();
    // skirt pleats
    ctx.strokeStyle = fade(col, 0.30);
    ctx.lineWidth = lw * 0.6;
    for (const k of [-0.45, 0, 0.45]) {
      ctx.beginPath();
      ctx.moveTo(waistW * k * 0.35, waistY + 0.030 * s);
      ctx.quadraticCurveTo(hemW * k * 0.55, -0.450 * s, hemW * k * 0.92, hemY - 0.008 * s);
      ctx.stroke();
    }
    // rim light on her left, hem underline, collar
    ctx.beginPath();
    ctx.moveTo(-shW * 0.94, shY);
    ctx.bezierCurveTo(-shW * 0.76, -0.665 * s, -waistW * 1.60, -0.616 * s, -waistW, waistY);
    ctx.bezierCurveTo(-waistW * 1.70, -0.520 * s, -hipW * 0.86, -0.424 * s, -hemW, hemY);
    ctx.strokeStyle = fade(hi, 0.46);
    ctx.lineWidth = lw * 1.1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-hemW * 0.96, hemY - 0.005 * s);
    ctx.quadraticCurveTo(0, hemY + 0.030 * s, hemW * 0.96, hemY - 0.005 * s);
    ctx.strokeStyle = fade(hi, 0.5);
    ctx.lineWidth = lw * 1.15;
    ctx.stroke();
    // the skirt has an under-layer: a second hem, a little higher and shorter
    ctx.beginPath();
    ctx.moveTo(-hemW * 0.80, hemY - 0.032 * s);
    ctx.quadraticCurveTo(0, hemY + 0.002 * s, hemW * 0.80, hemY - 0.032 * s);
    ctx.strokeStyle = fade(hi, 0.22);
    ctx.lineWidth = lw * 0.8;
    ctx.stroke();
    // shoulder straps + tie
    ctx.beginPath();
    ctx.moveTo(-shW * 0.52, shY + 0.004 * s);
    ctx.lineTo(-shW * 0.20, shY + 0.052 * s);
    ctx.moveTo(shW * 0.52, shY + 0.004 * s);
    ctx.lineTo(shW * 0.20, shY + 0.052 * s);
    ctx.moveTo(-shW * 0.20, shY + 0.052 * s);
    ctx.lineTo(0, shY + 0.092 * s);
    ctx.lineTo(shW * 0.20, shY + 0.052 * s);
    ctx.strokeStyle = fade(hi, 0.42);
    ctx.lineWidth = lw * 0.85;
    ctx.stroke();

    // ---- arms: one smooth limb each, hand included ----------------------
    const arm = (side, wrist, ctrl) => {
      const sh = [side * shW * 0.94, shY + 0.018 * s];
      // detached sleeve: a soft band from shoulder to elbow
      ctx.beginPath();
      ctx.moveTo(sh[0], sh[1]);
      ctx.quadraticCurveTo(ctrl[0], ctrl[1], wrist[0], wrist[1]);
      ctx.strokeStyle = fade(deep, 0.55);
      ctx.lineWidth = lw * 2.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sh[0], sh[1]);
      ctx.quadraticCurveTo(ctrl[0], ctrl[1], wrist[0], wrist[1]);
      ctx.strokeStyle = fade(col, 0.82);
      ctx.lineWidth = lw * 1.5;
      ctx.stroke();
      // cuff + hand
      const cx = lerp(ctrl[0], wrist[0], 0.88);
      const cy = lerp(ctrl[1], wrist[1], 0.88);
      ctx.strokeStyle = fade(hi, 0.42);
      ctx.lineWidth = lw * 0.7;
      ctx.beginPath();
      ctx.moveTo(cx - lw * 1.2, cy - lw * 1.2);
      ctx.lineTo(cx + lw * 1.2, cy + lw * 1.2);
      ctx.stroke();
      ctx.fillStyle = fade(hi, 0.85);
      ctx.beginPath();
      ctx.ellipse(wrist[0], wrist[1], lw * 1.6, lw * 1.9, 0, 0, TAU);
      ctx.fill();
    };
    if (o.handsTogether) {
      arm(-1, [-0.026 * s, -0.520 * s], [-0.125 * s, -0.585 * s]);
      arm(1, [0.026 * s, -0.520 * s], [0.125 * s, -0.585 * s]);
    } else if (o.reach) {
      const tx = (o.reach.x ?? 0.25) * s;
      const ty = (o.reach.y ?? -0.62) * s;
      arm(1, [tx, ty], [0.175 * s, -0.640 * s]);
      arm(-1, [-0.145 * s, -0.400 * s], [-0.160 * s, -0.530 * s]);
    } else if (o.wave) {
      const swing = Math.sin((o.wavePhase || 0) * TAU) * 0.030 * s;
      arm(1, [0.215 * s + swing, -0.885 * s + bob], [0.198 * s, -0.760 * s]);
      arm(-1, [-0.145 * s, -0.400 * s], [-0.160 * s, -0.530 * s]);
    } else {
      arm(-1, [-0.138 * s, -0.372 * s], [-0.166 * s, -0.535 * s]);
      arm(1, [0.138 * s, -0.372 * s], [0.166 * s, -0.535 * s]);
    }

    // ---- head: skull, hair cap with a parted fringe, side locks ---------
    ctx.beginPath();
    ctx.moveTo(-0.021 * s, headY + headR * 0.90);
    ctx.lineTo(-0.024 * s, shY + 0.010 * s);
    ctx.moveTo(0.021 * s, headY + headR * 0.90);
    ctx.lineTo(0.024 * s, shY + 0.010 * s);
    ctx.strokeStyle = fade(col, 0.6);
    ctx.lineWidth = lw * 1.5;
    ctx.stroke();

    // back hair, so the head has volume and the tails have a root
    ctx.fillStyle = fade(deep, 0.30);
    ctx.beginPath();
    ctx.ellipse(0, headY + headR * 0.10, headR * 1.14, headR * 1.24, 0, 0, TAU);
    ctx.fill();

    const sg = ctx.createLinearGradient(0, headY - headR, 0, headY + headR);
    sg.addColorStop(0, fade(deep, 0.24));
    sg.addColorStop(1, fade(deep, 0.07));
    ctx.beginPath();
    ctx.moveTo(headR * 1.02, headY + headR * 0.06);
    ctx.ellipse(0, headY + headR * 0.06, headR * 1.02, headR * 1.14, 0, 0, TAU);
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.strokeStyle = fade(col, 0.82);
    ctx.lineWidth = lw;
    ctx.stroke();

    // hair cap: one shape, and the fringe is cut into its bottom edge
    const cap = () => {
      ctx.beginPath();
      ctx.moveTo(-headR * 1.08, headY + headR * 0.16);
      ctx.bezierCurveTo(-headR * 1.20, headY - headR * 1.06, -headR * 0.44, headY - headR * 1.38,
        0, headY - headR * 1.32);
      ctx.bezierCurveTo(headR * 0.44, headY - headR * 1.38, headR * 1.20, headY - headR * 1.06,
        headR * 1.08, headY + headR * 0.16);
      ctx.quadraticCurveTo(headR * 0.96, headY - headR * 0.34, headR * 0.54, headY - headR * 0.42);
      ctx.lineTo(headR * 0.20, headY - headR * 0.12);
      ctx.lineTo(-headR * 0.14, headY - headR * 0.56);
      ctx.lineTo(-headR * 0.54, headY - headR * 0.20);
      ctx.quadraticCurveTo(-headR * 0.96, headY - headR * 0.34, -headR * 1.08, headY + headR * 0.16);
      ctx.closePath();
    };
    const cg = ctx.createLinearGradient(0, headY - headR * 1.25, 0, headY + headR * 0.2);
    cg.addColorStop(0, fade(col, 0.50));
    cg.addColorStop(1, fade(deep, 0.38));
    cap();
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = fade(hi, 0.5);
    ctx.lineWidth = lw * 0.9;
    ctx.stroke();

    // side locks framing the jaw
    for (const side of [-1, 1]) {
      const lock = curve(
        [side * headR * 1.00, headY - headR * 0.12],
        [side * headR * 1.24, headY + headR * 0.55],
        [side * headR * 1.04, headY + headR * 1.25],
        [side * headR * 0.84, headY + headR * 1.70],
        10,
      );
      strokePath(ctx, lock, fade(col, 0.62), lw * 1.25);
      strokePath(ctx, lock.slice(2), fade(hi, 0.22), lw * 0.55);
    }
    // ahoge: the one strand that never stops moving
    const ah = curve(
      [headR * 0.04, headY - headR * 1.24],
      [headR * 0.16, headY - headR * 1.56],
      [headR * 0.62, headY - headR * 1.46],
      [headR * 0.72 + sway * headR * 0.10, headY - headR * 1.16],
      8,
    );
    strokePath(ctx, ah, fade(hi, 0.5), lw * 0.8);

    // headset: a band across the hair and two cups at the sides
    ctx.beginPath();
    ctx.moveTo(-headR * 1.00, headY - headR * 0.20);
    ctx.quadraticCurveTo(0, headY - headR * 1.10, headR * 1.00, headY - headR * 0.20);
    ctx.strokeStyle = fade(hi, 0.30);
    ctx.lineWidth = lw * 0.7;
    ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.fillStyle = fade(hi, 0.5);
      ctx.beginPath();
      ctx.ellipse(side * headR * 0.99, headY - headR * 0.06, lw * 1.4, lw * 1.9, side * 0.24, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(-headR * 0.98, headY + headR * 0.02);
    ctx.quadraticCurveTo(-headR * 0.76, headY + headR * 0.50, -headR * 0.42, headY + headR * 0.42);
    ctx.strokeStyle = fade(hi, 0.34);
    ctx.lineWidth = lw * 0.6;
    ctx.stroke();
    ctx.fillStyle = fade(hi, 0.75);
    ctx.beginPath();
    ctx.arc(-headR * 0.40, headY + headR * 0.42, lw * 0.9, 0, TAU);
    ctx.fill();

    // ---- the machine's material over the body ---------------------------
    const lightPos = o.light == null ? ((t * 0.11 + ph * 0.13) % 1) : clamp(o.light);
    holoTexture(ctx, s, [
      () => {
        ctx.moveTo(headR * 1.16, headY + headR * 0.10);
        ctx.ellipse(0, headY + headR * 0.06, headR * 1.16, headR * 1.26, 0, 0, TAU);
      },
      addDress,
      ...tails.map((tail) => () => addRibbon(ctx, tail.pts, tail.wide)),
    ], hi, lightPos, 1);

    ctx.save();
    ctx.translate(0, headY - headR * 0.02);
    blankFace(ctx, headR * 0.92, {
      accent: hi, mouth: o.mouth == null ? 0 : o.mouth,
    });
    ctx.restore();

    // the one character ever printed on her body
    if (s > 150) {
      ctx.save();
      ctx.translate(shW * 1.06, -0.636 * s);
      ctx.rotate(0.14);
      ctx.textAlign = "center";
      ctx.fillStyle = css("red", 0.7);
      ctx.font = `600 ${Math.max(10, s * 0.044)}px "MV Mono", monospace`;
      ctx.fillText("01", 0, 0);
      ctx.fillStyle = fade(hi, 0.25);
      ctx.fillRect(-s * 0.023, s * 0.010, s * 0.046, 1.4);
      ctx.restore();
    }

    // the heart she keeps losing
    if (heartFill != null) {
      ctx.save();
      ctx.translate(0, -0.600 * s);
      const hr = 0.078 * s;
      softGlow(ctx, 0, 0, hr * 1.7, col, 0.12 * (0.4 + heartFill));
      ctx.beginPath();
      ctx.moveTo(0, hr * 0.42);
      ctx.bezierCurveTo(-hr * 0.92, -hr * 0.10, -hr * 0.56, -hr * 0.88, 0, -hr * 0.34);
      ctx.bezierCurveTo(hr * 0.56, -hr * 0.88, hr * 0.92, -hr * 0.10, 0, hr * 0.42);
      ctx.closePath();
      ctx.fillStyle = fade(col, 0.12 + 0.22 * heartFill);
      ctx.fill();
      ctx.strokeStyle = fade(col, 0.85);
      ctx.lineWidth = Math.max(1, lw * 0.8);
      ctx.stroke();
      if (1 - heartFill > 0.02) {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = fade(deep, 0.9);
        const cut = (1 - heartFill) * hr * 1.1;
        ctx.fillRect(-hr, hr * 0.42 - cut, hr * 2, cut);
        ctx.restore();
      }
      ctx.restore();
    }

    // fracture lines when the voice bank destabilises
    if (crack > 0.01) {
      for (let i = 0; i < 4; i++) {
        const y0 = -0.800 * s + i * 0.135 * s;
        const pts = [];
        for (let k = 0; k <= 8; k++) {
          const u = k / 8;
          pts.push([
            lerp(-0.115 * s, 0.115 * s, u),
            y0 + Math.sin(u * 9 + i * 2.1 + t * 1.7) * 0.024 * s * crack,
          ]);
        }
        strokePath(ctx, pts, css("red", 0.18 + 0.34 * crack), lw * 0.65);
      }
    }

    // coming apart: she sheds points upward
    if (dissolve > 0.02) {
      for (let i = 0; i < 32; i++) {
        const seed = hash((o.seed || 5) + i * 3.7);
        if (seed < dissolve * 0.72) continue;
        const u = (seed + dissolve * 0.55 + t * 0.045) % 1;
        const px = (hash(i * 7.1) - 0.5) * 0.36 * s + sway * 0.012 * s;
        const py = lerp(-0.90 * s, -0.05 * s, u) - dissolve * 0.05 * s;
        ctx.fillStyle = fade(hi, 0.55 * (1 - dissolve * 0.35));
        dot(ctx, px, py, lw * (0.45 + hash(i * 2.3) * 0.85));
      }
    }
  });
}

// ------------------------------------------------------------- the listener
// The song's "you": a warm, soft presence. More human than the singer, but
// never detailed -- a hood of light, a face you can just make out, and the one
// line that scans across it when they are being remembered.
export function listener(ctx, x, y, h, o = {}) {
  const s = h;
  const warm = o.color || css("amber", 0.88);
  const fill = o.fill || css("amber", 0.09);
  const lw = o.lw ?? Math.max(1.2, s * 0.0055);
  const t = o.t ?? 0;
  const ph = o.phase ?? 0;
  const breath = Math.sin(TAU * (t / 5.1) + ph);
  const sway = Math.sin(TAU * (t / 13.0) + ph * 0.6);
  const bob = breath * s * 0.003;

  const headR = s * 0.100;
  const headY = -0.856 * s + bob;
  const shY = -0.718 * s + bob * 0.6;
  const shW = s * 0.150;
  const hemY = -0.048 * s;
  const hemW = s * 0.198;

  group(ctx, o.alpha ?? 1, () => {
    ctx.translate(x, y);
    ctx.rotate((o.tilt || 0) + sway * 0.005);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    softGlow(ctx, 0, -0.62 * s, 0.62 * s, css("amber", 0.6), 0.20);
    // a warm pool that grounds the figure
    ctx.fillStyle = fade(warm, 0.10);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.20 * s, 0.016 * s, 0, 0, TAU);
    ctx.fill();

    // one cloak, shoulders to a soft hem
    const cloak = () => {
      ctx.beginPath();
      ctx.moveTo(-shW * 0.94, shY);
      ctx.quadraticCurveTo(-shW * 1.30, -0.600 * s, -hemW * 0.98, -0.235 * s);
      ctx.quadraticCurveTo(-hemW * 1.03, hemY - 0.010 * s, -hemW * 0.60, hemY + 0.008 * s);
      ctx.quadraticCurveTo(0, hemY - 0.024 * s, hemW * 0.60, hemY + 0.008 * s);
      ctx.quadraticCurveTo(hemW * 1.03, hemY - 0.010 * s, hemW * 0.98, -0.235 * s);
      ctx.quadraticCurveTo(shW * 1.30, -0.600 * s, shW * 0.94, shY);
      ctx.quadraticCurveTo(0, shY - 0.044 * s, -shW * 0.94, shY);
      ctx.closePath();
    };
    const g = ctx.createLinearGradient(0, shY, 0, hemY);
    g.addColorStop(0, fade(warm, 0.13));
    g.addColorStop(0.65, fade(fill, 0.9));
    g.addColorStop(1, fade(fill, 0.15));
    cloak();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = fade(warm, 0.72);
    ctx.lineWidth = lw;
    ctx.stroke();
    // rim light down one side + two folds, so the cloak is cloth and not a cone
    ctx.beginPath();
    ctx.moveTo(-shW * 0.94, shY);
    ctx.quadraticCurveTo(-shW * 1.30, -0.600 * s, -hemW * 0.98, -0.235 * s);
    ctx.strokeStyle = fade(warm, 0.48);
    ctx.lineWidth = lw * 1.05;
    ctx.stroke();
    ctx.strokeStyle = fade(warm, 0.14);
    ctx.lineWidth = lw * 0.65;
    for (const k of [-0.42, 0.30]) {
      ctx.beginPath();
      ctx.moveTo(shW * k * 0.75, shY + 0.055 * s);
      ctx.quadraticCurveTo(hemW * k * 0.95, -0.500 * s, hemW * k * 1.18, hemY - 0.010 * s);
      ctx.stroke();
    }
    // arms: two lines that fold into the cloak, hands hidden in it
    ctx.strokeStyle = fade(warm, 0.32);
    ctx.lineWidth = lw * 1.7;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * shW * 0.80, shY + 0.020 * s);
      ctx.quadraticCurveTo(side * shW * 0.88, -0.560 * s, side * shW * 0.52, -0.430 * s);
      ctx.stroke();
    }
    // shoulders
    ctx.beginPath();
    ctx.moveTo(-shW * 0.94, shY);
    ctx.quadraticCurveTo(0, shY - 0.052 * s, shW * 0.94, shY);
    ctx.strokeStyle = fade(warm, 0.62);
    ctx.lineWidth = lw * 1.15;
    ctx.stroke();

    // neck, then head with hair
    ctx.beginPath();
    ctx.moveTo(0, headY + headR * 1.02);
    ctx.lineTo(0, shY + 0.012 * s);
    ctx.strokeStyle = fade(warm, 0.42);
    ctx.lineWidth = lw * 1.3;
    ctx.stroke();
    // hair mass behind the head
      ctx.fillStyle = fade(warm, 0.12);
      ctx.beginPath();
      ctx.ellipse(0, headY - headR * 0.14, headR * 1.06, headR * 1.10, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(headR * 0.90, headY + headR * 0.10);
    ctx.ellipse(0, headY + headR * 0.10, headR * 0.90, headR * 1.02, 0, 0, TAU);
    const hg = ctx.createLinearGradient(0, headY - headR, 0, headY + headR);
    hg.addColorStop(0, fade(warm, 0.20));
    hg.addColorStop(1, fade(fill, 0.7));
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.strokeStyle = warm;
    ctx.lineWidth = lw * 1.0;
    ctx.stroke();
    // a hair sweep across the brow
    ctx.beginPath();
    ctx.moveTo(-headR * 0.92, headY - headR * 0.16);
    ctx.quadraticCurveTo(-headR * 0.10, headY - headR * 0.86, headR * 0.94, headY - headR * 0.26);
    ctx.strokeStyle = fade(warm, 0.28);
    ctx.lineWidth = lw * 0.7;
    ctx.stroke();

    if (o.turnAway) {
      // looking away: the hair covers the face and only the profile survives
      ctx.fillStyle = fade(css("ink", 0.55), 0.55);
      ctx.beginPath();
      ctx.ellipse(-headR * 0.22, headY + headR * 0.05, headR * 0.80, headR * 0.98, 0.1, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = fade(warm, 0.55);
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      ctx.moveTo(-headR * 0.10, headY - headR * 0.30);
      ctx.quadraticCurveTo(-headR * 0.55, headY + headR * 0.10, -headR * 0.16, headY + headR * 0.48);
      ctx.stroke();
    } else {
      // no features: the listener is only ever a warm shape and a light that
      // falls on it. What we read as a face is the rim, not a drawing.
      ctx.save();
      ctx.translate(0, headY + headR * 0.02);
      ctx.beginPath();
      ctx.ellipse(0, 0, headR * 0.80, headR * 0.96, 0, 0, TAU);
      ctx.fillStyle = css("ink", 0.28);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, headR * 0.80, headR * 0.96, 0, Math.PI * 0.55, Math.PI * 1.45);
      ctx.strokeStyle = fade(css("amber", 0.9), 0.26);
      ctx.lineWidth = Math.max(1, headR * 0.055);
      ctx.stroke();
      ctx.restore();
    }

    if (o.scan) {
      const y0 = headY + Math.sin(o.scan * TAU) * headR * 1.6;
      ctx.beginPath();
      ctx.moveTo(-shW * 1.05, y0);
      for (let i = 1; i <= 40; i++) {
        const u = i / 40;
        ctx.lineTo(-shW * 1.05 + u * shW * 2.10,
          y0 + Math.sin(u * 18 + o.scan * TAU) * 0.010 * s);
      }
      ctx.strokeStyle = fade(css("amber", 0.8), 0.5);
      ctx.lineWidth = Math.max(1, lw * 0.75);
      ctx.stroke();
    }
  });
}
