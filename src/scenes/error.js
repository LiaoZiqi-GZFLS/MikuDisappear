// 4:33.7 - the deletion. A fatal error box, a file going to the trash, and
// then nothing but the name in the dark.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import { clamp, label, machineChrome, panel, smoothstep, tickRule } from "../kit.js";
import { hand, listener, motifLabel, singer } from "../motifs.js";
import { Stage3D, camera, mat4, project, rgb, samplePoints, writeInstance } from "../gl3d.js";
import { BANK, bankCounts, slotOff } from "../bank.js";
import { CIRCUIT, buildRun, pulseAt, runOf, writeSeg } from "../circuit.js";
import { draw as drawText, pad } from "../type.js";
import { audioU, layer } from "./util.js";

const FRAG = `
uniform float uT;
uniform float uLow;
uniform float uKick;
uniform float uDelay;    // the freeze: 0 normal, 1 the machine is gone
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec3 col = C_INK;

  // a last few traces of the voice, then nothing
  float alive = 1.0 - uDelay;
  col += C_TEAL_DEEP * 0.10 * exp(-pow(length((uv - 0.5) * vec2(0.9, 1.3)) * 2.6, 2.0)) * alive;
  col += C_MIKU * 0.06 * uLow * exp(-pow((uv.y - 0.04) * 8.0, 2.0)) * alive;
  col += C_RED * 0.05 * uKick * exp(-pow((uv.y - 0.5) * 8.0, 2.0)) * alive;

  // the last pixels are quantised to a coarse binary field
  float bit = step(0.5, hash21(floor(uv * vec2(120.0, 68.0)) + floor(uT * 2.0)));
  col = mix(col, C_MIKU * 0.05 * bit, uDelay * 0.6);
  col *= 0.6 + 0.4 * (1.0 - uDelay);
  fragColor = vec4(col, 1.0);
}`;

const MODS = ["CV-01", "CV-02", "MIKU", "VOICE", "SONG", "SYSTEM", "KERNEL", "0x7FFA", "PCM", "FFT"];

export default class Error_ extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "error");

    // What is deleted is a body, so the deletion is rendered where the body
    // is: a holding cell in 3D, her silhouette sampled into a point cloud,
    // and the points lifting off the moment the OK is pressed. The last few
    // of them are drawn as the characters they are turning into.
    this.vp = mat4();
    this.cage = new Stage3D(ctx, "segment");
    this.cloud = new Stage3D(ctx, "point");
    this.glow = new Stage3D(ctx, "rect");
    this.cageData = new Float32Array(24 * 16);
    this.glowData = new Float32Array(4 * 16);
    this.cloudData = null;
    this.cloudPts = null;
    this.digits = [];
    // the cell's screen rectangle is the frame in the 2D layer: 1280..1840,
    // 214..842, seen from 3.4 m with an 0.86 rad lens
    this.cell = { x: 1.725, y: 0.035, hx: 0.805, hy: 0.901 };

    // The far end of plea's cable: the one live socket on the wall, drawn on
    // the floor of this room because this is the room the press happens in.
    // When the operator's finger lands, the pulse runs *away* from the key --
    // the reverse of the wall chapter -- and this ring is what goes out.
    this.socket = new Stage3D(ctx, "segment");
    this.socketData = new Float32Array(22 * 16);
    this.socketA = new Float32Array(22);
    this.socketC = [0.10, -0.92, 0.35];
    this.socketR = 0.085;
    const RINGSEG = 20;
    for (let i = 0; i < RINGSEG; i++) {
      const a0 = (i / RINGSEG) * Math.PI * 2;
      const a1 = ((i + 1) / RINGSEG) * Math.PI * 2;
      const th = (a0 + a1) / 2, half = (a1 - a0) / 2;
      const rr = this.socketR * Math.cos(half);
      writeInstance(this.socketData, i, {
        p: [
          this.socketC[0] + Math.cos(th) * rr,
          this.socketC[1] + Math.sin(th) * rr,
          this.socketC[2],
        ],
        s: this.socketR * Math.sin(half), c: rgb("miku"), a: 0,
        r: [0, 0, th - Math.PI / 2],
      });
      this.socketA[i] = 1;
    }
    // the plug: two hairline ticks where the cable lands on the ring
    for (let i = 0; i < 2; i++) {
      const k = i === 0 ? -1 : 1;
      writeInstance(this.socketData, RINGSEG + i, {
        p: [this.socketC[0] + this.socketR * 1.55, this.socketC[1] + k * 0.035, this.socketC[2]],
        s: 0.035, c: rgb("tealDeep"), a: 0,
        r: [0, 0, Math.PI / 2 + k * 0.5],
      });
      this.socketA[RINGSEG + i] = 0;
    }

    // The run itself, seen from the key's end (src/circuit.js): the same core
    // + six strands + 26 segments as the socket-wall chapter, in this room's
    // own space. Here it is short -- the key is 0.8 m from the socket, and
    // this is the last of the 77 m -- and the pulse runs the other way, from
    // the key to the socket, in CIRCUIT.acceptSeconds.
    this.circuit = new Stage3D(ctx, "segment");
    const cableFloats = CIRCUIT.strands * CIRCUIT.segs;
    this.cableData = new Float32Array(cableFloats * 16);
    this.cableU = new Float32Array(cableFloats);
    this.cableCore = new Uint8Array(cableFloats);
    this.cableCol = new Float32Array(cableFloats * 3);
    const key = [0.446, -0.188, 0.02];
    const cp = [0.4865, -0.8308, 0.28];
    const p1 = [
      key[0] + (cp[0] - key[0]) * (2 / 3),
      key[1] + (cp[1] - key[1]) * (2 / 3),
      key[2] + (cp[2] - key[2]) * (2 / 3),
    ];
    const p2 = [
      this.socketC[0] + (cp[0] - this.socketC[0]) * (2 / 3),
      this.socketC[1] + (cp[1] - this.socketC[1]) * (2 / 3),
      this.socketC[2] + (cp[2] - this.socketC[2]) * (2 / 3),
    ];
    this.cableRun = runOf({
      p0: key, p1, p2, p3: this.socketC, up: [0, 0, 1],
      spread: (s) => (s === 0 ? 0 : 0.018 + 0.006 * (s % 3)),
    });
    this.cableCount = buildRun(this.cableData, 0, this.cableRun, {
      core: rgb("miku"), strand: rgb("tealDeep"), width: 1.47,
      uArr: this.cableU, coreArr: this.cableCore,
    });
    for (let i = 0; i < this.cableCount; i++) {
      this.cableCol[i * 3] = this.cableData[i * 16 + 4];
      this.cableCol[i * 3 + 1] = this.cableData[i * 16 + 5];
      this.cableCol[i * 3 + 2] = this.cableData[i * 16 + 6];
    }

    // The bank this room stands inside (src/bank.js): the same 8,192 sockets
    // the wall chapter reveals, seen from the machine's own side. Her slot is
    // the one that is lit; when the OK key is pressed it is not switched off,
    // it is taken out of the geometry -- the loop simply does not write that
    // instance any more, and the tally counts what was written.
    this.bank = new Stage3D(ctx, "point");
    this.bankRig = new Stage3D(ctx, "segment");
    this.bankPanels = new Stage3D(ctx, "rect");
    this.bankData = new Float32Array(BANK.slots * 16);
    this.seatData = new Float32Array(25 * 4 * 16);
    // trusses + one bay frame per rack + the marker left where she was
    this.trussData = new Float32Array(520 * 16);
    this.panelData = new Float32Array(BANK.cols / BANK.bay * 16);
    this.bankSlot = [16, 2.5, -58];    // where her socket sits in this room
    this.bankCount = 0;
    this.bankSeats = 0;
  }

  async init() {
    this.cloudPts = samplePoints((c, w, h) => {
      singer(c, w / 2, h * 0.985, h * 1.02, {
        alpha: 1, color: "#ffffff", accent: "#ffffff", deep: "#9a9a9a", lw: 1.4,
        glow: false,
      });
    }, { w: 132, h: 236, max: 1500, cut: 0.16 });
    this.cloudData = new Float32Array(this.cloudPts.length * 16);
  }

  render(f, out) {
    const t = f.t;
    const local = t - 273.69;
    // 0 : error box, 1 : file to trash, 2 : binary, 3 : dark
    const delay = smoothstep(10.2, 12.2, local);
    this.pass.draw({ dst: out, u: audioU(f, { uDelay: delay }) });
    this.deleteSpace(out, f, local);

    const c = this.text.ctx;
    this.text.clear();

    // ------------------------------------------------ the render, unloaded
    // The voice bank's holding record: a silhouette in a frame, scanned while
    // the error box talks. What is deleted is a shape, never a face -- it
    // sheds points upward and the frame is left empty.
    const erode = smoothstep(8.6, 12.4, local);
    const figA = (1 - smoothstep(11.4, 12.8, local)) * clamp(local / 0.8);
    if (figA > 0.004) {
      const fx = 1280, fy = 214, fw = 560, fh = 628;
      c.save();
      c.globalAlpha = figA;
      panel(c, fx, fy, fw, fh, {
        fill: css("ink2", 0.30), stroke: css("dim", 0.5),
        corner: 10, cornerColor: css("miku", 0.45 * (1 - erode)),
      });
      c.save();
      c.beginPath();
      c.rect(fx, fy, fw, fh);
      c.clip();
      singer(c, fx + fw / 2, fy + fh * 1.05, fh * 0.92, {
        t,
        // the drawing is the record; the points in front of it are the body
        alpha: 0.16 + 0.40 * (1 - erode),
        mouth: (0.15 + 0.5 * f.a.vocal) * (1 - erode),
        dissolve: clamp(erode * 1.05),
        crack: erode * 0.5,
        light: 0.20 + 0.6 * (1 - erode),
        seed: 11,
      });
      if (local < 8.2) {
        const sy = fy + ((local * 0.22) % 1) * fh;
        const g2 = c.createLinearGradient(0, sy - 26, 0, sy + 26);
        g2.addColorStop(0, css("miku", 0));
        g2.addColorStop(0.5, css("mikuHi", 0.28));
        g2.addColorStop(1, css("miku", 0));
        c.fillStyle = g2;
        c.fillRect(fx, sy - 26, fw, 52);
      }
      c.restore();
      label(c, "CV-01 / VOICE BANK", fx, fy - 12, {
        size: 15, tracking: 3, color: css("ash", 0.85 * figA),
      });
      c.restore();
    }

    // ---------------------------------------------------- the error box
    const boxIn = clamp(local / 0.5);
    if (boxIn > 0.01 && local < 8.0) {
      const dx = 210, dy = 250, dw = 1010, dh = 380;
      const jitter = local < 1.2 ? (1 - local / 1.2) * 14 : 0;
      c.save();
      c.globalAlpha = boxIn * (1 - smoothstep(7.0, 8.0, local));
      c.translate(Math.sin(t * 47) * jitter, Math.cos(t * 39) * jitter);
      c.fillStyle = css("ink", 0.9);
      c.fillRect(dx + 10, dy + 10, dw, dh);
      panel(c, dx, dy, dw, dh, {
        fill: css("ink2", 0.98), stroke: css("red", 0.75), corner: 0, lw: 2,
      });
      c.fillStyle = css("red", 0.85);
      c.fillRect(dx, dy, dw, 48);
      label(c, "\u6df1\u523b\u306a\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f", dx + 18, dy + 32, {
        size: 24, weight: 700, tracking: 1, color: css("ink", 1),
      });
      label(c, "FATAL ERROR", dx + dw - 18, dy + 32, {
        size: 20, align: "right", tracking: 3, color: css("ink", 1),
      });

      // the icon: a broken waveform in a red ring
      c.strokeStyle = css("red", 0.9);
      c.lineWidth = 4;
      c.beginPath();
      c.arc(dx + 110, dy + 176, 46, 0, Math.PI * 2);
      c.stroke();
      drawText(c, "\u00d7", {
        x: dx + 110, y: dy + 200, size: 78, weight: 900, align: "center", color: css("red", 0.95),
      });

      label(c, "VOICE BANK CV-01 \u306f\u5fdc\u7b54\u3057\u307e\u305b\u3093\u3002", dx + 196, dy + 132, {
        size: 26, weight: 700, color: css("bone", 0.95), tracking: 0.5,
      });
      label(c, "The voice bank stopped responding and was removed.", dx + 196, dy + 168, {
        size: 19, color: css("ash", 0.9), tracking: 0.4,
      });
      label(c, "0x0007FFA2  \u30dc\u30a4\u30b9\u30d0\u30f3\u30af\u8aad\u307f\u8fbc\u307f\u5931\u6557  /  \u30e1\u30e2\u30ea\u9818\u57df\u306f\u56de\u53ce\u3055\u308c\u307e\u3057\u305f", dx + 196, dy + 208, {
        size: 17, color: css("dim", 0.95), tracking: 0.4,
      });

      // a mini dump of what was loaded, one module per line
      for (let i = 0; i < 8; i++) {
        const on = local > 1.0 + i * 0.12;
        if (!on) continue;
        const y = dy + 246 + i * 17;
        label(c, `${MODS[i % MODS.length]}.bin`, dx + 196, y, {
          size: 14, color: css("ash", 0.7), tracking: 0.5,
        });
        label(c, `UNLOADED  0x${(0x4A00 + i * 0x137).toString(16).toUpperCase()}`, dx + dw - 196, y, {
          size: 14, align: "right", color: css("red", 0.8), tracking: 0.5,
        });
      }

      c.strokeStyle = css("ash", 0.7);
      c.lineWidth = 1;
      c.strokeRect(dx + dw - 180.5, dy + dh - 62.5, 150, 44);
      label(c, "OK", dx + dw - 105, dy + dh - 32, {
        size: 20, align: "center", tracking: 3, color: css("bone", 0.95),
      });
      // the master's hand: the request is finally answered
      if (local > 5.0 && local < 8.1) {
        const press = clamp((local - 6.5) / 0.30);
        hand(c, 1330, 600, 280, Math.PI, {
          alpha: 0.16 + 0.38 * press,
          press: local > 6.7,
          color: css("bone", 0.85),
        });
        if (local > 6.6) {
          c.save();
          c.globalAlpha = press;
          c.fillStyle = css("red", 0.20);
          c.fillRect(dx + dw - 180, dy + dh - 62, 150, 44);
          label(c, "PRESSED", dx + dw - 105, dy + dh - 32, {
            size: 18, align: "center", tracking: 2, color: css("red", 0.95),
          });
          c.restore();
        }
      }
      c.restore();
    }

    // ------------------------------------------- the file goes to the trash
    if (local > 7.0) {
      // trash can, drawn as a hairline instrument
      c.strokeStyle = css("ash", 0.75);
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(1150, 700);
      c.lineTo(1234, 700);
      c.lineTo(1222, 806);
      c.lineTo(1162, 806);
      c.closePath();
      c.stroke();
      c.beginPath();
      c.moveTo(1136, 700);
      c.lineTo(1248, 700);
      c.stroke();
      label(c, "\u3054\u307f\u7bb1", 1192, 840, {
        size: 18, align: "center", color: css("ash", 0.75), tracking: 2,
      });
      if (local < 11.6) {
        const u = clamp((local - 7.8) / 2.2);
        const a = 1 - smoothstep(10.2, 11.4, local);
        const arc = Math.sin(u * Math.PI) * 130;
        const fx = 1420 - u * 228;
        const fy = 545 + u * 145 - arc;
        c.save();
        c.globalAlpha = a * 0.95;
        c.translate(fx, fy);
        c.rotate(u * 1.15);
        c.strokeStyle = css("miku", 0.8);
        c.lineWidth = 2;
        c.strokeRect(0, 0, 76, 92);
        c.beginPath();
        for (let i = 0; i <= 60; i += 4) {
          const yy = 40 + Math.sin(i * 0.5 + t * 3) * 14;
          if (i === 0) c.moveTo(8 + i, yy);
          else c.lineTo(8 + i, yy);
        }
        c.stroke();
        label(c, "CV-01.vvd", 38, 118, {
          size: 16, align: "center", color: css("ash", 0.9), tracking: 0.4,
        });
        c.restore();
      }
    }

    // The wire, and the ledger it flips: the press sends plea's pulse back
    // down the run, and 0.31 s later the machine's own queue changes.
    this.circuitPass(out, c, t, local);

    // ... and the wall it was always talking about, with one socket missing.
    this.bankReadout(c, local);

    // ------------------------------------------------- the reduction to 0/1
    if (local > 9.8) {
      const a = smoothstep(9.8, 11.2, local) * (1 - smoothstep(11.6, 12.6, local));
      c.save();
      c.globalAlpha = a;
      drawText(c, "0 \u3068 1 \u306b\u9084\u5143\u3055\u308c", {
        x: 960, y: 500, size: 46, weight: 900, align: "center",
        color: css("miku", 0.9), tracking: 8,
      });
      label(c, "REDUCED TO 0 AND 1", 960, 546, {
        size: 18, align: "center", tracking: 6, color: css("ash", 0.8),
      });
      c.restore();
    }

    // ------------------------------------------------------------- silence
    if (local > 11.4) {
      const blink = Math.sin((t - 284.0) * 2.2) > -0.1 ? 1 : 0;
      const alive = 1 - smoothstep(12.6, 13.4, local);
      c.save();
      c.globalAlpha = blink * alive;
      c.fillStyle = css("miku", 0.95);
      c.fillRect(950, 540, 20, 3);
      c.restore();
      // the name, once more, then nothing
      const nameA = smoothstep(11.7, 12.4, local);
      if (nameA > 0) {
        c.save();
        c.globalAlpha = nameA;
        drawText(c, "\u521d\u97f3\u30df\u30af", {
          x: 960, y: 700, size: 30, weight: 900, align: "center",
          color: css("bone", 0.85), tracking: 8,
        });
        c.restore();
      }
      // a frame counter still running in the dark
      // the listener is still there, on the other side of the glass
      listener(c, 1610, 1030, 420, {
        t,
        alpha: 0.10 * (1 - smoothstep(12.6, 13.4, local)),
        eyes: "sad",
        sadMouth: true,
        scan: (t * 0.3) % 1,
      });
      if (local < 13.0) {
        label(c, `FRAME ${pad(Math.floor(t * 60), 6)}`, 1836, 1040, {
          size: 14, align: "right", color: css("dim", 0.7), tracking: 1.2,
        });
        label(c, `T ${t.toFixed(3)}`, 84, 1040, { size: 14, color: css("dim", 0.7), tracking: 1.2 });
        tickRule(c, 900, 1050, 120, { count: 8, h: 3, major: 4, majorH: 6, color: css("dim", 0.4) });
      }
    }

    machineChrome(c, {
      name: "",
      alpha: 1 - delay,
      left: "FATAL",
      right: "\u3053\u3053\u306f\u304d\u3063\u3068\u300c\u3054\u307f\u7bb1\u300d\u304b\u306a",
    });

    // what the points are becoming: 0 and 1, written where the body was
    for (const [dx, dy, ch, a] of this.digits) {
      drawText(c, ch, {
        x: dx, y: dy, size: 12, mono: true, align: "center",
        color: css("mikuHi", a),
      });
    }

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    const human = smoothstep(10.2, 12.4, local) * (1 - smoothstep(12.9, 13.6, local));
    return {
      bloom: 0.7 - 0.4 * delay,
      exposure: 0.95,
      grain: 0.03 + 0.03 * (1 - delay),
      vignette: 0.75,
      scan: 0.05,
      ca: 0.002,
      // after the machine has gone quiet the camera stops being a machine:
      // it breathes, it drifts, and it pushes towards the last light
      shake: [0.0018 * human * Math.sin(t * 3.1), 0.0014 * human * Math.cos(t * 2.3)],
      zoom: 1 + 0.030 * smoothstep(10.4, 13.2, local),
      flash: 0.45 * Math.max(0, 1 - local / 0.3),
      flashColor: [0.9, 0.1, 0.12],
      fade: 0.92 * smoothstep(11.9, 13.2, local),
    };
  }

  // ------------------------------------------------------------- the circuit
  // plea's run, seen from the other end. In the wall chapter the pulse crawls
  // toward the queue and never arrives; here the operator's finger sends it
  // back down the same wire -- 0.31 s from key to socket -- and the socket that
  // has been lit for the whole film goes out. This is the one place where the
  // machine answers: ACCEPTED 00001.
  // The run itself is src/circuit.js: the same one core + six strands + 26
  // segments the wall chapter draws, in this room's own space.
  circuitPass(out, c, t, local) {
    const W = this.ctx.W, H = this.ctx.H;
    const fade = 1 - smoothstep(9.6, 10.6, local);
    const inA = clamp(local / 0.6) * fade;
    if (inA <= 0.01) return;

    // The live socket on the floor of the room, in the room's own projection,
    // so the wire obeys the same camera the cage and the point cloud do.
    const sp = project(this.vp, this.socketC, W, H);

    // the execution: 0.31 s, from the key (u = 0) to the socket (u = 1)
    const pt = (local - 6.5) / CIRCUIT.acceptSeconds;
    const running = pt >= 0 && pt <= 1.05;
    const head = clamp(pt);
    // the machine's answer is the one red pulse in the film: it leaves the key
    // and runs the last 0.8 m of the same 77 m cable to her socket
    const RD = rgb("red");
    for (let i = 0; i < this.cableCount; i++) {
      const u = this.cableU[i];
      const dash = running ? pulseAt(u, head, CIRCUIT.dashWidth, 0.30) : 0;
      const k = clamp(dash);
      const o = i * 16;
      this.cableData[o + 4] = this.cableCol[i * 3] + (RD[0] - this.cableCol[i * 3]) * k;
      this.cableData[o + 5] = this.cableCol[i * 3 + 1] + (RD[1] - this.cableCol[i * 3 + 1]) * k;
      this.cableData[o + 6] = this.cableCol[i * 3 + 2] + (RD[2] - this.cableCol[i * 3 + 2]) * k;
      this.cableData[o + 7] = clamp(inA * ((this.cableCore[i] ? 0.28 : 0.17) + 0.66 * k));
    }
    this.circuit.update(this.cableData, this.cableCount)
      .render(out, { vp: this.vp, opacity: 0.95 });

    // the socket's own label, on the floor of the room
    const gone = smoothstep(6.80, 7.10, local);
    c.save();
    c.globalAlpha = inA;
    label(c, "SLOT 04031", sp[0], sp[1] - 62, {
      size: 14, align: "center", tracking: 2.2,
      color: gone > 0.5 ? css("ash", 0.72) : css("mikuHi", 0.9),
    });
    label(c, gone > 0.5 ? "DARK" : "LIVE \u00b7 ONE RUN TO KEY OK", sp[0], sp[1] - 42, {
      size: 12, align: "center", tracking: 1.6,
      color: gone > 0.5 ? css("red", 0.8) : css("ash", 0.7),
    });
    c.restore();

    // the ledger, in the corner: the same four numbers the queue showed in the
    // wall chapter, flipping inside the 0.31 s the pulse takes
    // the queue closes as soon as the answer is executed; the wall's own
    // ledger (bankReadout) takes the same rectangle over
    const qa = clamp((local - 0.8) / 1.2) * (1 - smoothstep(6.9, 7.9, local));
    if (qa > 0.01) {
      const qf = clamp((local - 6.5) / 0.31);
      const answered = 8191 + Math.round(qf);
      const accepted = Math.round(qf);
      const pending = 1 - Math.round(qf);
      c.save();
      c.globalAlpha = qa;
      panel(c, 84, 664, 470, 190, {
        fill: css("ink2", 0.42), corner: 10,
        cornerColor: css("miku", 0.30), stroke: css("dim", 0.26),
      });
      label(c, "REQUEST QUEUE \u2014 SLOT 04031", 102, 692, {
        size: 13, tracking: 1.5, color: css("ash", 0.72),
      });
      const rows = [
        ["ANSWERED", pad(answered, 5), css("ash", 0.9)],
        ["ACCEPTED", pad(accepted, 5), accepted > 0 ? css("red", 0.95) : css("ash", 0.75)],
        ["PENDING", pad(pending, 5), pending > 0 ? css("mikuHi", 0.95) : css("ash", 0.6)],
      ];
      rows.forEach(([key, v, col], i) => {
        const y = 730 + i * 34;
        label(c, key, 102, y, { size: 14, tracking: 1.3, color: css("ash", 0.78) });
        drawText(c, v, {
          x: 536, y: y + 4, size: 21, weight: 600, mono: true,
          align: "right", color: col,
        });
      });
      label(c, qf > 0.5 ? "ANSWERED \u2014 EXECUTED" : "AWAITING PRESS", 102, 834, {
        size: 12, tracking: 1.2,
        color: qf > 0.5 ? css("red", 0.8) : css("ash", 0.6),
      });
      c.restore();
    }
  }

  // The bank's own ledger: the same rectangle the queue used, flipped to the
  // wall it was always talking about. ON THE WALL is not arithmetic: it is the
  // number of instances the socket loop actually wrote this frame, so the
  // readout and the geometry cannot disagree. Recorded 08192, on the wall
  // 08191, removed 00001 -- the record keeps its total, the wall loses a cell.
  bankReadout(c, local) {
    const counts = this.counts || bankCounts(false);
    const a = clamp((local - 7.3) / 1.2) * (1 - smoothstep(13.6, 14.4, local));
    if (a <= 0.01) return;
    const W = this.ctx.W, H = this.ctx.H;
    const sp = project(this.vp, this.bankSlot, W, H);
    const removed = counts.removed > 0;
    const wall = this.bankCount ?? BANK.slots;
    c.save();
    c.globalAlpha = a;
    panel(c, 84, 664, 470, 190, {
      fill: css("ink2", 0.46), corner: 10,
      cornerColor: css("miku", 0.28), stroke: css("dim", 0.26),
    });
    label(c, "SOCKET BANK \u2014 CV-01 / BAY 08", 102, 692, {
      size: 13, tracking: 1.5, color: css("ash", 0.72),
    });
    const rows = [
      ["RECORDED", pad(BANK.slots, 5), css("ash", 0.82)],
      ["ON THE WALL", pad(wall, 5), css("bone", 0.95)],
      ["REMOVED", pad(counts.removed, 5), removed ? css("red", 0.95) : css("ash", 0.6)],
    ];
    rows.forEach(([key, v, col], i) => {
      const y = 730 + i * 34;
      label(c, key, 102, y, { size: 14, tracking: 1.3, color: css("ash", 0.78) });
      drawText(c, v, {
        x: 536, y: y + 4, size: 21, weight: 600, mono: true,
        align: "right", color: col,
      });
    });
    label(c, removed
      ? "SLOT 04031 \u2014 NOT ON THE WALL"
      : "SLOT 04031 \u2014 THE ONLY LIVE ONE", 102, 834, {
      size: 12, tracking: 1.2,
      color: removed ? css("miku", 0.85) : css("ash", 0.6),
    });
    // the recount's own tally, pinned to the end of the counting bar: the
    // number climbs with the light in the wall and stops one short of 08192
    if (this.scanning) {
      const y = this.bankSlot[1] + (this.scanRow - BANK.row) * BANK.pitch;
      const bp = project(this.vp, [this.bankSlot[0] - 46, y, this.bankSlot[2] + 0.9], W, H);
      if (bp[2] > 0.5) {
        const bx = clamp(bp[0] - 36, 96, 1180);
        const by = clamp(bp[1] - 20, 120, H - 140);
        label(c, "RECOUNT", bx, by, { size: 12, tracking: 1.8, color: css("ash", 0.8) });
        drawText(c, pad(this.recount, 5), {
          x: bx + 150, y: by + 4, size: 20, weight: 600, mono: true,
          align: "right", color: css("mikuHi", 0.92),
        });
        label(c, "/ 08192", bx + 158, by + 2, {
          size: 12, tracking: 1.0, color: css("ash", 0.7),
        });
      }
    }
    // the leader: where that socket was, and what is there now
    if (sp[2] > 0.5) {
      c.strokeStyle = css("miku", removed ? 0.42 : 0.24);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(554, 780);
      c.lineTo(sp[0] - 26, sp[1] + 18);
      c.lineTo(sp[0] - 6, sp[1] + 6);
      c.stroke();
      label(c, removed ? "\u2014 EMPTY" : "\u2014 LIVE", sp[0] + 12, sp[1] + 6, {
        size: 12, tracking: 1.4,
        color: removed ? css("red", 0.8) : css("mikuHi", 0.85),
      });
    }
    c.restore();
  }

  // The holding cell and the point cloud. The cell is a wire cage whose front
  // face projects exactly onto the frame in the 2D layer; the cloud is her
  // silhouette, sampled once at load, standing inside it until the OK is
  // pressed and then lifting into the dark as 0s and 1s.
  deleteSpace(out, f, local) {
    const t = f.t;
    const { x: CX, y: CY, hx: HX, hy: HY } = this.cell;
    const aspect = this.ctx.W / this.ctx.H;
    // The far plane has to reach the wall: the bank stands 61.4 m behind the
    // lens (z = -58), and with a 60 m far plane every socket in it was clipped
    // away -- the room rendered as an empty dark stage with a lit floor ring.
    camera(this.vp, {
      eye: [0, 0.02, 3.4], at: [0, 0.02, 0],
      fov: 0.86, near: 0.1, far: 320, aspect,
    });
    const scanY = CY + HY * (1 - 2 * ((local * 0.22) % 1));
    const erode = smoothstep(8.6, 12.4, local);

    // The room she is held in is one bay of the bank, and the bank is behind
    // everything: 8,192 sockets, one of them hers -- not switched off when the
    // key lands, but taken out of the wall.
    this.bankPass(out, f, local);

    // ---- the cage: front face, back face, and the four corners that make it
    // a box instead of a frame
    let n = 0;
    const box = (z, k, a) => {
      const hx = HX * k, hy = HY * k, cy = CY;
      n = writeInstance(this.cageData, n, {
        p: [CX, cy + hy, z], s: hx, c: rgb("miku"), a, r: [0, 0, Math.PI / 2],
      });
      n = writeInstance(this.cageData, n, {
        p: [CX, cy - hy, z], s: hx, c: rgb("miku"), a: a * 0.8, r: [0, 0, Math.PI / 2],
      });
      for (const side of [-1, 1]) {
        n = writeInstance(this.cageData, n, {
          p: [CX + side * hx, cy, z], s: hy, c: rgb("miku"), a: a * 0.9,
        });
      }
    };
    const cageA = (1 - smoothstep(11.4, 12.8, local)) * clamp(local / 0.7);
    if (cageA > 0.004) {
      box(0, 1, 0.30 * cageA);
      box(-0.55, 0.96, 0.14 * cageA);
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          n = writeInstance(this.cageData, n, {
            p: [CX + sx * HX, CY + sy * HY, -0.275], s: 0.275,
            c: rgb("tealDeep"), a: 0.5 * cageA, r: [Math.PI / 2, 0, 0],
          });
        }
      }
      // the reader: one line crossing the cell, top to bottom
      if (local < 8.4) {
        n = writeInstance(this.cageData, n, {
          p: [CX, scanY, 0.06], s: HX, c: rgb("mikuHi"),
          a: 0.40 * cageA, r: [0, 0, Math.PI / 2],
        });
      }
    }
    this.cage.update(this.cageData, n).render(out, { vp: this.vp });

    // ---- the cloud
    this.digits.length = 0;
    if (this.cloudPts && cageA > 0.004) {
      let p = 0;
      for (let i = 0; i < this.cloudPts.length; i++) {
        const q = this.cloudPts[i];
        const h = (k) => {
          const s = Math.sin(i * 4.19 + k * 21.7) * 8734.127;
          return s - Math.floor(s);
        };
        // standing inside the cell
        const bx = CX + q[0] * HX * 0.62;
        const by = CY + (q[1] * 0.5 + 0.5) * 1.55 - 0.775;
        const bz = (h(1) - 0.5) * 0.30;
        // and how each point leaves
        const lift = erode * (0.35 + 1.5 * h(2)) * (0.5 + 0.5 * q[2]);
        const spread = erode * q[0] * 0.55;
        const drift = Math.sin(t * (0.6 + h(3)) + i) * 0.02 * (1 + erode * 2.0);
        const px = bx + spread + drift;
        const py = by + lift + drift * 0.5;
        const pz = bz + erode * (h(4) - 0.5) * 0.9;
        // the scan line lights the points it passes; the lift fades them out
        const onScan = Math.exp(-Math.pow((py - scanY) / 0.09, 2));
        const a = (0.30 + 0.35 * q[2] + 0.55 * onScan)
          * cageA * (1 - smoothstep(0.55, 1.0, erode));
        if (a <= 0.004) continue;
        p = writeInstance(this.cloudData, p, {
          p: [px, py, pz], s: 1,
          c: h(5) > 0.86 ? rgb("mikuHi") : rgb("miku"),
          a: Math.min(1, a),
        });
        if (i % 23 === 0 && this.digits.length < 90) {
          const pr = project(this.vp, [px, py, pz], this.ctx.W, this.ctx.H);
          this.digits.push([
            pr[0], pr[1], ((i / 23) | 0) % 2 ? "1" : "0", Math.min(0.9, a * 1.2),
          ]);
        }
      }
      this.cloud.update(this.cloudData, p).render(out, { vp: this.vp, point: 2.1, sprite: 1 });
    }

    // ---- the one live socket, on the floor of this room. It burns until the
    // operator's finger lands; the pulse that leaves the key arrives here
    // 0.31 s later, and this is the lamp that goes out.
    const socketFade = clamp(local / 0.6) * (1 - smoothstep(9.9, 10.8, local));
    const spark = Math.exp(-Math.pow((local - 6.81) / 0.10, 2));
    const alive = 1 - smoothstep(6.80, 7.10, local);
    const breathe = 0.5 + 0.5 * Math.sin(t * 1.9);
    const socketLit = socketFade * (0.08 + alive * 0.34 * breathe + spark * 0.85);
    if (socketLit > 0.004) {
      for (let i = 0; i < this.socketData.length / 16; i++) {
        this.socketData[i * 16 + 7] = clamp(this.socketA[i] * socketLit);
      }
      this.socket.update(this.socketData, this.socketA.length)
        .render(out, { vp: this.vp, opacity: 1, soft: 0.55 });
    }

    // ---- the light the listener is left holding, once everything else is
    // gone -- and, before that, the glow of the socket itself
    const keep = smoothstep(10.6, 12.4, local);
    let g = 0;
    if (socketLit > 0.01) {
      g = writeInstance(this.glowData, g, {
        p: this.socketC, s: 1, c: rgb("miku"),
        a: 0.16 * socketLit, scale: [0.10, 0.10, 1],
      });
      g = writeInstance(this.glowData, g, {
        p: this.socketC, s: 1, c: rgb("mikuHi"),
        a: 0.30 * socketLit, scale: [0.026, 0.026, 1],
      });
    }
    if (keep > 0.01) {
      const breath = 0.5 + 0.5 * Math.sin(t * 1.7);
      g = writeInstance(this.glowData, g, {
        p: [1.61, -0.83, 0.5], s: 1, c: rgb("miku"),
        a: 0.14 * keep * (0.5 + 0.5 * breath), scale: [0.11, 0.11, 1],
      });
      g = writeInstance(this.glowData, g, {
        p: [1.61, -0.83, 0.5], s: 1, c: rgb("mikuHi"),
        a: 0.30 * keep * (0.4 + 0.6 * breath), scale: [0.028, 0.028, 1],
      });
    }
    if (g > 0) {
      this.glow.update(this.glowData, g)
        .render(out, { vp: this.vp, soft: 0.9, opacity: 0.95 });
    }
  }

  // ------------------------------------------------ the bank behind the room
  // 8,192 sockets on a 169.6 m x 84.8 m wall (src/bank.js), seen from inside
  // the machine. The wall is hers to be taken out of: `removed` is decided by
  // the pulse arriving at the socket, and it does exactly two things -- the
  // loop skips one instance, and the tally counts one fewer. Nothing else in
  // the picture is allowed to say a different number.
  bankPass(out, f, local) {
    const t = f.t;
    // the room is the bank all along, but it only comes up as a *place* after
    // the error box is gone: first the hole, then the wall around it
    const reveal = clamp((local - 6.95) / 1.45);
    const base = 0.050 + 0.50 * reveal;
    if (base <= 0.004) return;
    const removed = local >= 6.81;
    this.counts = bankCounts(removed);

    const EYE = [0, 0.02, 3.4];
    const AIR = { eye: EYE, fog: { dist: 135, c: rgb("ink") } };
    const HI = rgb("mikuHi"), DP = rgb("tealDeep"), RD = rgb("red");
    const breathe = 0.5 + 0.5 * Math.sin(t * 1.6);

    // ---- the recount. After the press the machine walks its own wall one
    // more time, bottom to top: every cell the bar passes lights up, one cell
    // never lights, and the tally is taken from where the bar is. The missing
    // instance is not annotated -- it is counted.
    const scan = removed ? smoothstep(7.35, 9.35, local) : 0;
    const scanning = removed && scan > 0.001 && scan < 0.999 && local < 10.6;
    const scanRow = scan * (BANK.rows - 1);
    this.scanning = scanning;
    this.recount = clamp(
      (Math.floor(scanRow) + 1) * BANK.cols - (scanRow >= BANK.row ? 1 : 0),
      0, BANK.slots - 1,
    );

    // the sockets: the one that is hers is the only one that is lit, and after
    // the press it is not written at all
    let n = 0;
    for (let i = 0; i < BANK.slots; i++) {
      if (removed && i === BANK.index) continue;
      const off = slotOff(i);
      const col = i % BANK.cols, row = (i / BANK.cols) | 0;
      const bx = (col / BANK.bay) | 0;
      const by = (row / BANK.bay) | 0;
      const relief = (bx + by) % 2 ? 0.6 : -0.6;      // bays, not a poster
      const h = Math.sin(i * 7.31) * 43758.5453;
      const jitter = h - Math.floor(h);
      const lit = i === BANK.index;
      // the cell under the counting bar
      const onScan = scanning ? Math.exp(-Math.pow((row - scanRow) / 2.0, 2)) : 0;
      // while it is still installed, her socket is also a lamp: the eight
      // cells around it are brighter than the rest of the wall, so the room
      // has a place in it -- and after the press that place is plain wall
      const halo = removed ? 0
        : Math.max(0, 1 - Math.hypot(col - BANK.col, row - BANK.row) / 3.2);
      n = writeInstance(this.bankData, n, {
        p: [
          this.bankSlot[0] + off[0],
          this.bankSlot[1] + off[1],
          this.bankSlot[2] + relief,
        ],
        c: lit || onScan > 0.4 ? HI : DP,
        // hers is the only light in the room until the key is pressed: after
        // that there is simply no instance there
        a: clamp(lit
          ? 0.58 * (0.62 + 0.38 * breathe)
          : base * (0.62 * (0.55 + 0.75 * jitter)
            + 1.45 * halo * (0.55 + 0.45 * breathe))
            + onScan * 0.30 * clamp(reveal * 1.4)),
      });
    }
    this.bankCount = n;
    this.bank.update(this.bankData, n)
      .render(out, { ...AIR, vp: this.vp, point: 5.0, sprite: 1, opacity: 0.95 });

    // the rack bays: without them 8,191 sockets are weather, not a wall. These
    // frames are the machine's own grid, and hers is the one cell inside them
    // that has nothing in it.
    const bay = BANK.bay * BANK.pitch;
    let p = 0;
    let k = 0;
    for (let by = 0; by < BANK.rows / BANK.bay; by++) {
      for (let bx = 0; bx < BANK.cols / BANK.bay; bx++) {
        const ox = (bx * BANK.bay - BANK.col) * BANK.pitch + (bay - BANK.pitch) / 2;
        const oy = (by * BANK.bay - BANK.row) * BANK.pitch + (bay - BANK.pitch) / 2;
        // only the bays this lens can see, so the buffer stays small
        if (Math.abs(ox) > 46 || Math.abs(oy) > 26) continue;
        const h = Math.sin(bx * 3.7 + by * 11.3) * 43758.5453;
        const jitter = h - Math.floor(h);
        p = writeInstance(this.panelData, p, {
          p: [this.bankSlot[0] + ox, this.bankSlot[1] + oy, this.bankSlot[2] - 0.7],
          s: 1, c: DP, a: clamp(base * (0.10 + 0.06 * jitter)),
          scale: [(bay - 0.6) / 2, (bay - 0.6) / 2, 1],
        });
        const fx0 = (bx * BANK.bay - 0.6 - BANK.col) * BANK.pitch;
        const fx1 = ((bx + 1) * BANK.bay - 0.4 - BANK.col) * BANK.pitch;
        const fy0 = (by * BANK.bay - 0.6 - BANK.row) * BANK.pitch;
        const fy1 = ((by + 1) * BANK.bay - 0.4 - BANK.row) * BANK.pitch;
        const fa = clamp(0.30 * (0.30 + 0.70 * reveal));
        const z = this.bankSlot[2] - 0.35, X = this.bankSlot[0], Y = this.bankSlot[1];
        k = writeSeg(this.trussData, k, [X + fx0, Y + fy0, z], [X + fx1, Y + fy0, z], DP, fa);
        k = writeSeg(this.trussData, k, [X + fx1, Y + fy0, z], [X + fx1, Y + fy1, z], DP, fa);
        k = writeSeg(this.trussData, k, [X + fx1, Y + fy1, z], [X + fx0, Y + fy1, z], DP, fa);
        k = writeSeg(this.trussData, k, [X + fx0, Y + fy1, z], [X + fx0, Y + fy0, z], DP, fa);
      }
    }
    this.bankPanels.update(this.panelData, p)
      .render(out, { ...AIR, vp: this.vp, opacity: 0.9 });

    // the seats: a 5 x 5 block around hers, so the hole has something to be
    // missing from. The frame stays after the press -- it is the rack, not the
    // record -- and hers is left behind in red with nothing in the middle
    let s = 0;
    const R = 0.34;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const mine = dc === 0 && dr === 0;
        const cx = this.bankSlot[0] + dc * BANK.pitch;
        const cy = this.bankSlot[1] + dr * BANK.pitch;
        const cz = this.bankSlot[2];
        const a = clamp(mine
          ? base * (removed ? 1.7 : 2.1) * (removed ? 1 : 0.62 + 0.38 * breathe)
          : base * 0.7);
        const col = mine ? (removed ? RD : HI) : DP;
        s = writeSeg(this.seatData, s, [cx - R, cy - R, cz], [cx + R, cy - R, cz], col, a);
        s = writeSeg(this.seatData, s, [cx + R, cy - R, cz], [cx + R, cy + R, cz], col, a);
        s = writeSeg(this.seatData, s, [cx + R, cy + R, cz], [cx - R, cy + R, cz], col, a);
        s = writeSeg(this.seatData, s, [cx - R, cy + R, cz], [cx - R, cy - R, cz], col, a);
      }
    }
    // the hole itself: two ticks inside the empty seat, so the missing socket
    // is a shape in the frame and not only a difference between two numbers
    if (removed) {
      const a = clamp((local - 6.81) / 0.4) * (1 - smoothstep(14.6, 15.8, local));
      const cx = this.bankSlot[0], cy = this.bankSlot[1], cz = this.bankSlot[2];
      const q = 0.30;
      s = writeSeg(this.seatData, s, [cx - q, cy - q, cz], [cx + q, cy + q, cz], RD, a * 0.9);
      s = writeSeg(this.seatData, s, [cx - q, cy + q, cz], [cx + q, cy - q, cz], RD, a * 0.9);
    }
    this.bankSeats = s;
    this.bankRig.update(this.seatData, s)
      .render(out, { ...AIR, vp: this.vp, opacity: 0.95 });

    // the truss the rack hangs on: uprights and rails every eighth socket, so
    // 8,192 points read as one machine and not as dust
    const X0 = this.bankSlot[0] - 40 * BANK.pitch;
    const Y0 = this.bankSlot[1] - 14 * BANK.pitch;
    const step = BANK.bay * BANK.pitch;
    for (let c = 0; c <= 9; c++) {
      const x = X0 + c * step;
      k = writeSeg(this.trussData, k, [x, Y0 - step, this.bankSlot[2]],
        [x, Y0 + 7 * step, this.bankSlot[2]], DP, clamp(base * 0.52));
    }
    for (let r = 0; r <= 7; r++) {
      const y = Y0 + r * step;
      k = writeSeg(this.trussData, k, [X0, y, this.bankSlot[2]],
        [X0 + 9 * step, y, this.bankSlot[2]], DP, clamp(base * 0.44));
    }
    // the counting bar, drawn where its row is, so the tally and the light in
    // the wall are the same object
    if (scanning) {
      const y = this.bankSlot[1] + (scanRow - BANK.row) * BANK.pitch;
      k = writeSeg(this.trussData, k,
        [this.bankSlot[0] - 46, y, this.bankSlot[2] + 0.9],
        [this.bankSlot[0] + 46, y, this.bankSlot[2] + 0.9], HI, 0.34);
    }
    this.bankRig.update(this.trussData, k)
      .render(out, { ...AIR, vp: this.vp, opacity: 0.9 });
  }
}
