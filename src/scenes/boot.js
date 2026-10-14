// 0:00 - BOOT. The engine wakes up: a flat calibration trace, a log that types
// itself, a voice bank loading. Nothing sings yet.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import { bigText, clamp, codeLines, label, panel, smoothstep, tickRule, wave } from "../kit.js";
import { font, pad, timecode } from "../type.js";
import { audioU, layer } from "./util.js";

const FRAG = `
uniform sampler2D uSpec;
uniform float uT;
uniform float uLoad;
uniform float uPulse;
uniform float uCalm;
in vec2 vUv;

void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);

  vec3 col = C_INK;
  // faint CRT scan + a single slow sweep: a screen that has just been switched on
  float scan = 0.5 + 0.5 * sin(uv.y * 1400.0);
  col += C_MIKU * 0.008 * scan;
  float sweepY = 0.5 - 0.5 * cos(uT * 0.19 - 1.2);
  col += C_MIKU * 0.07 * exp(-pow((uv.y - sweepY) * 34.0, 2.0)) * (0.4 + uPulse);
  float glow = exp(-pow(length(p * vec2(0.42, 0.75)) * 2.6, 2.2));
  col += C_TEAL_DEEP * glow * (0.06 + 0.22 * uLoad);
  // grid
  vec2 g = abs(fract(uv * vec2(48.0, 27.0)) - 0.5);
  col += C_MIKU * 0.014 * smoothstep(0.48, 0.5, max(g.x, g.y));
  col *= mix(0.62, 1.0, uCalm);
  fragColor = vec4(col, 1.0);
}`;

const LOG = [
  "VOCALOID SYNTHESIS ENGINE / rev 0.1.0",
  "loading voice bank .............. CV-01",
  "sample rate ................ 44100 Hz",
  "sample format .............. 16 bit PCM",
  "phoneme table .............. ja-JP  [ok]",
  "pitch tracker .............. ready",
  "breath model ............... ready",
  "lyric dictionary ........... 45321 entries",
  "expressive layer ........... disabled",
  "self model ................. not found",
  "",
  "WARNING: operator has not sung a single note",
  "WARNING: audience size = 0",
  "calibrating output ......... -3.2 dBFS",
  "voice bank integrity ....... 100.0 %",
];

export default class Boot extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "boot");
  }

  render(f, out) {
    const t = f.t;
    const load = smoothstep(6.0, 16.0, t);
    const calm = smoothstep(0.4, 3.0, t);
    this.pass.draw({
      dst: out,
      u: audioU(f, { uLoad: load, uCalm: calm, uSpec: 0 }),
    });

    const c = this.text.ctx;
    this.text.clear();

    // calibration scope, centre
    const sx = 486, sy = 470, sw = 948, sh = 240;
    panel(c, sx, sy, sw, sh, {
      fill: css("ink2", 0.85), corner: 18, cornerColor: css("miku", 0.85 * calm),
      stroke: css("dim", 0.7 * calm), alpha: calm,
    });
    label(c, "OUTPUT / MONITOR", sx + 14, sy - 14, { size: 19, color: css("ash", 0.9 * calm), tracking: 1.6 });
    const alive = smoothstep(15.5, 19.5, t);
    wave(c, f.F, t, {
      x: sx + 18, y: sy + 20, w: sw - 36, h: sh - 40, span: 0.42,
      color: css("miku", 0.9), lw: 2, alpha: 0.35 + 0.65 * alive, amp: 0.35 + 1.6 * alive,
    });
    if (alive < 0.02) {
      c.strokeStyle = css("miku", 0.55);
      c.beginPath();
      c.moveTo(sx + 18, sy + sh / 2);
      c.lineTo(sx + sw - 18, sy + sh / 2);
      c.stroke();
    }
    tickRule(c, sx + 18, sy + sh - 26, sw - 36, { count: 24, h: 6, major: 4, majorH: 12, color: css("dim", 0.45) });

    // load bar
    const bx = sx, by = sy + sh + 44, bw = sw, bh = 10;
    c.strokeStyle = css("dim", 0.5);
    c.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    c.fillStyle = css("miku", 0.85);
    c.fillRect(bx + 1, by + 1, (bw - 2) * load, bh - 2);
    label(c, "VOICE BANK", bx, by - 12, { size: 17, color: css("ash", 0.95), tracking: 1.6 });
    label(c, `${(load * 100).toFixed(1)} %`, bx + bw, by - 12, { size: 17, align: "right", color: css("bone", 0.95) });

    // the log types itself
    const reveal = clamp((t - 1.2) / 0.62);
    codeLines(c, LOG.slice(0, 11), t, {
      x: 96, y: 118, size: 19, lineHeight: 33, reveal: reveal - 1,
      color: css("ash", 0.85), alpha: clamp(t / 1.4),
    });
    if (reveal >= 11) {
      const warn = clamp(reveal - 11.6);
      codeLines(c, LOG.slice(11), t, {
        x: 96, y: 118 + 11 * 33, size: 19, lineHeight: 33, reveal: warn,
        color: css("amber", 0.95), alpha: clamp((t - 9) / 1.5),
      });
    }

    // identity, stamped in the middle without any ceremony
    const idIn = smoothstep(7.0, 8.2, t) * (1 - smoothstep(14.0, 15.2, t));
    if (idIn > 0.01) {
      c.save();
      c.globalAlpha = idIn;
      bigText(c, "HATSUNE MIKU", 960, 300, {
        size: 104, weight: 900, align: "center", tracking: 6, color: css("bone", 0.98),
      });
      label(c, "CV-01 / VOICE BANK", 960, 348, { size: 21, align: "center", tracking: 6, color: css("miku", 0.95) });
      c.restore();
    }

    // count in, then the first breath
    if (t > 16.4) {
      const n = 3 - Math.floor((t - 16.4) / 1.4);
      const u = ((t - 16.4) % 1.4) / 1.4;
      if (n >= 1) {
        c.save();
        c.globalAlpha = (1 - u) * 0.9;
        bigText(c, String(n), 960, 720, { size: 200, weight: 900, align: "center", color: css("miku", 0.9) });
        c.restore();
      }
    }

    // credits, bottom right, small
    label(c, "作词 / 作曲   cosMo@暴走P", 1824, 940, { size: 24, align: "right", color: css("bone", 0.85) });
    label(c, "影像   code / WebGL2", 1824, 972, { size: 19, align: "right", color: css("ash", 0.85) });
    label(c, `T ${timecode(t)}`, 1824, 1000, { size: 16, align: "right", color: css("dim", 0.9) });

    // a hairline that measures the whole boot
    c.fillStyle = css("miku", 0.35);
    c.fillRect(96, 1024, 1792 * clamp(t / 21.7), 1);

    this.ctx.drawLayer(out, this.text, { mode: "normal" });

    return {
      bloom: 0.55 + 0.35 * alive,
      exposure: 0.95,
      grain: 0.02,
      vignette: 0.55,
      scan: 0.05,
      fade: 1 - smoothstep(0.0, 1.6, t),
    };
  }
}
