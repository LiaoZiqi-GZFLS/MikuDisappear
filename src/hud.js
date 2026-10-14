// The film's own instrumentation. It is diegetic: the machine is reporting on
// itself, and the numbers get worse as the song goes on.

import { css } from "./palette.js";
import { label } from "./kit.js";
import { stateAt } from "./kit.js";
import { pad, timecode } from "./type.js";

const RAMP = {
  voices: [[0, 1024], [89.7, 1024], [103.7, 902], [139.7, 640], [177.7, 402], [209.7, 121],
           [225.7, 64], [256.7, 16], [266.8, 3], [273.7, 0]],
  bitrate: [[0, 320], [89.7, 320], [103.7, 256], [177.7, 192], [209.7, 96], [221.8, 32],
            [256.7, 24], [266.8, 8], [273.7, 0]],
  temp: [[0, 31.5], [103.7, 44.0], [139.7, 52.4], [177.7, 61.0], [209.7, 74.5], [225.7, 88.2],
         [256.7, 96.0], [273.7, 118.4]],
  errors: [[0, 0], [103.4, 0], [103.7, 1], [139.7, 7], [177.7, 23], [207.9, 64],
           [209.7, 129], [225.7, 512], [256.7, 2048], [273.7, 65535]],
};

function ramp(key, t) {
  const pts = RAMP[key];
  let v = pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, v0] = pts[i], [t1, v1] = pts[i + 1];
    if (t >= t1) v = v1;
    else if (t > t0) {
      const u = (t - t0) / (t1 - t0);
      v = v0 + (v1 - v0) * (u * u * (3 - 2 * u));
      break;
    }
  }
  return v;
}

// Quantised flicker on the numbers: the readout is not stable any more.
function jitter(t, amt, seed = 1) {
  const s = Math.sin(t * 63.7 + seed * 12.9) * Math.sin(t * 17.3 + seed * 3.1);
  return s > 0.86 ? amt * (s - 0.86) / 0.14 : 0;
}

export function filmHud(ctx, f, engine) {
  const t = f.t;
  const state = stateAt(t);
  const on = Math.min(1, Math.max(0, (t - 5.0) / 4.0)) * (1 - Math.max(0, Math.min(1, (t - 268.0) / 5.0)));
  if (on <= 0.001) return;
  const fatal = t > 273.4;
  const alarm = (t >= 103.42 && t < 139.0) || (t >= 207.88 && t < 225.0);
  const led = fatal ? css("red") : alarm ? css("red") : t > 89.7 ? css("amber") : css("miku");
  const dim = css("ash", 0.62 * on);
  const bright = css("bone", 0.86 * on);
  const mono = true;

  // identity, top left
  label(ctx, "VOCALOID / CV-01", 64, 74, { size: 20, color: bright, tracking: 2.2, alpha: on });
  label(ctx, "VOICE BANK : HATSUNE MIKU", 64, 98, { size: 15, color: dim, tracking: 1.6, alpha: on });
  ctx.save();
  ctx.globalAlpha = on;
  ctx.fillStyle = led;
  ctx.fillRect(64, 108, 8, 8);
  ctx.globalAlpha = on * (0.35 + 0.65 * Math.abs(Math.sin(t * (alarm ? 9 : 1.6))));
  ctx.fillRect(64, 108, 8, 8);
  ctx.restore();

  // transport readout, top right
  const bar = Math.floor(f.bar) + 1;
  label(ctx, timecode(t), 1856, 74, { size: 20, align: "right", color: bright, tracking: 1.5, alpha: on });
  label(ctx, `BAR ${pad(bar, 3)}   BEAT ${Math.floor(f.beatPhase * 4) + 1}   240.00 BPM`,
    1856, 98, { size: 15, align: "right", color: dim, tracking: 1.4, alpha: on });

  // live numbers, bottom left
  const voices = Math.max(0, Math.round(ramp("voices", t) - jitter(t, 3, 2)));
  const bitrate = Math.max(0, ramp("bitrate", t) - jitter(t, 2, 5));
  const temp = ramp("temp", t) + jitter(t, 0.8, 9);
  const errors = Math.round(ramp("errors", t));
  const lines = [
    [`VOICES`, `${pad(voices, 4)}`],
    [`BITRATE`, `${bitrate.toFixed(1)} kbps`],
    [`CORE TEMP`, `${temp.toFixed(1)} C`],
    [`ERRORS`, `${errors}`],
  ];
  ctx.save();
  ctx.globalAlpha = on;
  lines.forEach(([k, v], i) => {
    const y = 946 + i * 26;
    label(ctx, k, 64, y, { size: 15, color: dim, tracking: 1.6 });
    label(ctx, v, 232, y, { size: 15, align: "right", color: i === 3 && errors > 100 ? css("red", 0.9) : bright, tracking: 1.2 });
  });
  ctx.restore();

  // system state, bottom right
  ctx.save();
  ctx.globalAlpha = on;
  ctx.strokeStyle = fatal || alarm ? css("red", 0.7) : css("dim", 0.5);
  ctx.lineWidth = 1;
  ctx.strokeRect(1690.5, 986.5, 166, 30);
  label(ctx, state, 1773, 1008, {
    size: 17, align: "center", tracking: 3,
    color: fatal ? css("red") : alarm ? css("red", 0.92) : t > 89.7 ? css("amber", 0.9) : css("miku", 0.9),
  });
  ctx.restore();
  void engine; void mono;
}
