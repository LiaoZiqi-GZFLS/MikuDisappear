// 2:19.7 - "I want to sing". One button, one cable, and the wall it hangs on:
// 8,192 sockets, 8,191 of them already answered, and hers still lit.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import { clamp, label, machineChrome, panel, smoothstep, tickRule, wave } from "../kit.js";
import { dissolveDots, motifLabel, singer, soundRing } from "../motifs.js";
import { beatAt } from "../semantics.js";
import { CamRig, Stage3D, camera, mat4, project, rgb, writeInstance } from "../gl3d.js";
import { BANK, BAYS_X, BAYS_Y } from "../bank.js";
import { CIRCUIT, buildRun, pulseAt, pulsePhase, runOf, writeSeg } from "../circuit.js";
import { draw as drawText } from "../type.js";
import { audioU, layer, line } from "./util.js";

const FRAG = `
uniform float uT;
uniform float uVocal;
uniform float uRms;
uniform float uAlive;    // 1 early, 0 gone
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 col = C_INK;
  float breathe = 0.5 + 0.5 * sin(uT * 0.9);
  col += C_TEAL_DEEP * exp(-pow(length(p * vec2(0.6, 1.0)) * 2.6, 2.0)) * (0.05 + 0.12 * breathe * uAlive);
  col += C_MIKU * 0.05 * uVocal * exp(-pow((uv.y - 0.5) * 9.0, 2.0)) * uAlive;
  col += C_MIKU_HI * 0.02 * uRms * exp(-pow((uv.y - 0.5) * 40.0, 2.0)) * uAlive;
  col *= 0.94 + 0.10 * uAlive;
  fragColor = vec4(col, 1.0);
}`;

const TAU = Math.PI * 2;

// The whole chapter lives in one unit of space: the button's own. Its 1.32 m
// face is 1.20 units across, so one unit is 1.1044 m and she (1.70 m tall)
// stands 1.54 units high.
const UNIT_M = 1.1044;

// Behind the button it is not a widget, it is a wall: 128 columns 1.325 m
// apart (169.6 m) by 64 rows (84.8 m) -- 8,192 sockets. 8,191 of them have
// been answered and are dark. The one that is still lit is on the end of a
// 77 m cable, and the chapter is the length of that cable. The wall's own
// numbers come from src/bank.js, because two other chapters name the same
// wall -- and in the last one it loses a socket for real.
const Q_COLS = BANK.cols, Q_ROWS = BANK.rows;
const Q_PITCH = BANK.pitch;                       // units between sockets (1.325 m)
const Q_Z = -70;                                  // the wall is 77.3 m behind the button
const Q_X0 = -((Q_COLS - 1) / 2) * Q_PITCH;
const Q_Y0 = -27.8;                               // row 0 sits below the button
const Q_SLOTS = BANK.slots;                       // 8192
const Q_LIT = BANK.index;                         // ... and hers is SLOT 04031
const WALL_W = Q_COLS * Q_PITCH;                  // 153.6 units = 169.6 m
const WALL_H = Q_ROWS * Q_PITCH;                  // 76.8 units = 84.8 m
const BAY = BANK.bay;                             // sockets per rack bay
const SCAN_LO = -5, SCAN_HI = Q_ROWS + 5;         // the bar enters and leaves the frame
const CABLE_SEGS = CIRCUIT.segs;
const AIR_HALL = 120;                             // metres at which the wall's air saturates
const qX = (col) => Q_X0 + col * Q_PITCH;
const qY = (row) => Q_Y0 + row * Q_PITCH;
const CELL = 0.34;                                // half-size of one socket cell (units)
const STRUCT_SEGS = 200;                          // static machine segments in the hall
const hash1 = (i) => { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };

export default class Plea extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "plea");
    this.want = null;
    this.mou = null;

    // The thing she is asking for is an object, not a widget: a giant round
    // button hung in the void, big enough that walking up to it means
    // something. Two rings of light, a bezel of ticks, a press plate that
    // breathes -- and nothing else in the room until the lens pulls back.
    this.vp = mat4();
    this.ring = new Stage3D(ctx, "segment");
    this.disc = new Stage3D(ctx, "rect");
    this.ringData = new Float32Array(176 * 16);
    this.discData = new Float32Array(4 * 16);
    this.btn = null;
    this.rev = 0;

    // The room behind the button. It is built as a machine: 128 rack bays
    // (16 x 8), a truss of uprights and rails, 8,192 sockets -- 8,191 dark --
    // one read head that walks the rows, and the cable that ties her socket to
    // the button she has not pressed.
    this.panels = new Stage3D(ctx, "rect");
    this.bayFrames = new Stage3D(ctx, "quad");
    this.grid = new Stage3D(ctx, "segment");
    this.struct = new Stage3D(ctx, "segment");
    this.wall = new Stage3D(ctx, "quad");
    this.lit = new Stage3D(ctx, "point");
    this.headFill = new Stage3D(ctx, "rect");
    this.trolley = new Stage3D(ctx, "segment");
    this.bar = new Stage3D(ctx, "segment");
    this.haze = new Stage3D(ctx, "rect");
    this.cable = new Stage3D(ctx, "segment");
    this.marks = new Stage3D(ctx, "segment");
    this.dust = new Stage3D(ctx, "point");

    this.panelData = new Float32Array(BAYS_X * BAYS_Y * 16);
    this.panelRow = new Uint8Array(BAYS_X * BAYS_Y);
    this.bayFrameData = new Float32Array(BAYS_X * BAYS_Y * 16);
    this.gridData = new Float32Array(40 * 16);
    this.gridKey = new Int16Array(40);            // the row/column that lights it
    this.gridBase = new Float32Array(40);         // ... and how bright it sits at rest
    this.gridCount = 0;
    this.structData = new Float32Array(STRUCT_SEGS * 16);
    this.structKey = new Int16Array(STRUCT_SEGS); // the row the head crosses it on (-1 = never)
    this.structBase = new Float32Array(STRUCT_SEGS);
    this.structCount = 0;
    this.wallData = new Float32Array(Q_SLOTS * 16);
    this.headData = new Float32Array(4 * Q_COLS * 16);
    this.trolleyData = new Float32Array(28 * 16);
    this.litData = new Float32Array(2 * 16);
    this.barData = new Float32Array(3 * 16);
    this.hazeData = new Float32Array(2 * 16);
    this.cableData = new Float32Array(7 * CABLE_SEGS * 16);
    this.cableU = new Float32Array(7 * CABLE_SEGS);
    this.cableCore = new Uint8Array(7 * CABLE_SEGS);
    this.cableCount = 0;
    this.cableRun = null;
    this.markData = new Float32Array(26 * 16);
    this.dustData = new Float32Array(36 * 16);
    this.dustSeed = [];

    // One move, in the same grammar `resonance` uses: the lens sits 1 m from a
    // 1.32 m button and does not move for ten seconds; then, while she keeps
    // asking, it withdraws -- 58 m of travel in 6.4 s -- until the button is a
    // lens flare in frame centre and the whole wall is in the frame with it:
    // 169.6 m wide, 84.8 m tall, 8,192 sockets, one of them lit. The button is
    // human scale, the wall is not, and the move is the distance between them.
    // After 16 s the lens does not move at all: nothing else happens here.
    // u = local / 23 s: hold to 9.6 s, reveal from 9.6 s to 16.0 s, hold after.
    this.rig = new CamRig([
      { u: 0.00, ease: "smooth",
        eye: [-0.73, 0.31, 4.2], at: [-0.71, 0.28, 0], fov: 0.62, roll: 0 },
      { u: 0.42, ease: "smooth",
        eye: [-0.70, 0.34, 4.25], at: [-0.68, 0.30, 0], fov: 0.62, roll: 0 },
      { u: 0.70, ease: "smooth",
        eye: [2.8, 3.0, 62.0], at: [1.2, 6.0, -70], fov: 0.74, roll: 0 },
      { u: 1.00, ease: "lin",
        eye: [2.8, 3.0, 62.0], at: [1.2, 6.0, -70], fov: 0.74, roll: 0 },
    ]);

    // Every socket on the wall, written once as a *cell*, not a dot: 0.75 m of
    // socket on a 1.325 m pitch. A frame only touches its colour and alpha --
    // and the reading the head leaves behind is written by the same loop, so
    // the wall's light is always a record of the reading, never decoration.
    for (let i = 0; i < Q_SLOTS; i++) {
      const col = i % Q_COLS, row = (i / Q_COLS) | 0;
      writeInstance(this.wallData, i, {
        p: [qX(col), qY(row), Q_Z], c: rgb("tealDeep"), a: 0,
        scale: [CELL, CELL, 1],
      });
    }

    // The rack bays: without them 8,192 sockets are a starfield, not a wall.
    // Each bay is a panel behind the cells and a frame in front of them, so a
    // bay reads as a box the machine was assembled out of.
    for (let by = 0; by < BAYS_Y; by++) {
      for (let bx = 0; bx < BAYS_X; bx++) {
        const i = by * BAYS_X + bx;
        const c0 = bx * BAY, r0 = by * BAY;
        const cx = qX(c0) + (BAY - 1) * Q_PITCH / 2;
        const cy = qY(r0) + (BAY - 1) * Q_PITCH / 2;
        writeInstance(this.panelData, i, {
          p: [cx, cy, Q_Z - 0.5],
          s: 1, c: rgb("tealDeep"), a: 0,
          scale: [(BAY * Q_PITCH - 0.5) / 2, (BAY * Q_PITCH - 0.5) / 2, 1],
        });
        writeInstance(this.bayFrameData, i, {
          p: [cx, cy, Q_Z + 0.15], s: 1, c: rgb("tealDeep"), a: 0,
          scale: [BAY * Q_PITCH / 2 - 0.05, BAY * Q_PITCH / 2 - 0.05, 1],
        });
        this.panelRow[i] = r0;
      }
    }

    // The truss the sockets hang on: seventeen uprights and ten rails, so the
    // wall reads as one machine and not as a texture.
    {
      const gy0 = qY(0) - 1.4, gy1 = qY(Q_ROWS - 1) + 1.4;
      const gx0 = qX(0) - 1.6, gx1 = qX(Q_COLS - 1) + 1.6;
      const rail = (a, b, key, base) => {
        const i = this.gridCount++;
        this.seg(this.gridData, i, a, b, rgb("tealDeep"), 0);
        this.gridKey[i] = key;
        this.gridBase[i] = base;
      };
      for (let c = 0; c <= Q_COLS - BAY; c += BAY) {
        const main = c % 32 === 0;
        // uprights stay at their own weight: the head walks rows, so only the
        // rails it crosses light up
        rail([qX(c), gy0, Q_Z], [qX(c), gy1, Q_Z], -1, main ? 0.30 : 0.15);
      }
      rail([qX(Q_COLS - 1), gy0, Q_Z], [qX(Q_COLS - 1), gy1, Q_Z], -1, 0.22);
      for (let r = 0; r < Q_ROWS; r += BAY) {
        rail([gx0, qY(r), Q_Z], [gx1, qY(r), Q_Z], r, r % 32 === 0 ? 0.30 : 0.15);
      }
      rail([gx0, gy0, Q_Z], [gx1, gy0, Q_Z], Q_ROWS - 0.5, 0.30);
      rail([gx0, gy1, Q_Z], [gx1, gy1, Q_Z], -1, 0.30);
    }

    // The machine the wall hangs in. The wall's own truss (above) says how it
    // is divided; this says how big it is: a frame around 169.6 m of sockets, a
    // gantry over the top, legs under it, a service walkway standing 13 m in
    // front of the wall -- the one thing in the hall that is *nearer* than the
    // wall, so a lens pulling back has something to move past -- and a
    // dimension rule under it, because this chapter's "8,192" is a measurement
    // before it is a number.
    {
      const x0 = qX(0), x1 = qX(Q_COLS - 1);
      const y0 = qY(0), y1 = qY(Q_ROWS - 1);
      const zW = Q_Z + 0.16;                     // on the wall
      const zK = Q_Z + 12.0;                     // the walkway, 13.3 m in front
      const put = (a, b, key, base, width = 1) => {
        const i = this.structCount++;
        this.seg(this.structData, i, a, b, rgb("tealDeep"), 0, width);
        this.structKey[i] = key;
        this.structBase[i] = base;
      };
      // the frame around the wall
      put([x0 - 1.6, y0 - 1.6, zW], [x1 + 1.6, y0 - 1.6, zW], -1, 0.36, 1.5);
      put([x0 - 1.6, y1 + 1.6, zW], [x1 + 1.6, y1 + 1.6, zW], -1, 0.36, 1.5);
      put([x0 - 1.6, y0 - 1.6, zW], [x0 - 1.6, y1 + 1.6, zW], -1, 0.36, 1.5);
      put([x1 + 1.6, y0 - 1.6, zW], [x1 + 1.6, y1 + 1.6, zW], -1, 0.36, 1.5);
      // the four rank divisions of the wall (32 sockets = 42.4 m)
      for (let c = 0; c <= Q_COLS; c += 32) {
        put([qX(c), y0 - 1.6, zW], [qX(c), y1 + 1.6, zW], -1, 0.30, 1.3);
      }
      for (let r = 0; r <= Q_ROWS; r += 32) {
        put([x0 - 1.6, qY(r), zW], [x1 + 1.6, qY(r), zW], -1, 0.30, 1.3);
      }
      // the gantry over it, with hangers that leave the top of the frame
      const gy = y1 + 5.2;
      put([x0 - 10, gy, zW], [x1 + 10, gy, zW], -1, 0.40, 1.7);
      for (let k = 0; k <= 8; k++) {
        const x = x0 + (k / 8) * (x1 - x0);
        put([x, gy, zW], [x, y1 + 26, zW], -1, 0.22);
        put([x, gy, zW], [x, y1 + 1.6, zW], -1, 0.16);
      }
      // legs under it, leaving the bottom of the frame
      const fy = y0 - 5.2;
      put([x0 - 10, fy, zW], [x1 + 10, fy, zW], -1, 0.34, 1.7);
      for (let k = 0; k <= 8; k++) {
        const x = x0 + (k / 8) * (x1 - x0);
        put([x, fy, zW], [x, y0 - 22, zW], -1, 0.18);
      }
      // the service walkway: deck, two rails, a post every other bay
      const wy = y0 - 2.4;
      put([x0 - 6, wy, zK], [x1 + 6, wy, zK], -1, 0.30, 1.2);
      put([x0 - 6, wy + 2.0, zK], [x1 + 6, wy + 2.0, zK], -1, 0.22, 1.1);
      put([x0 - 6, wy + 3.6, zK], [x1 + 6, wy + 3.6, zK], -1, 0.22, 1.1);
      for (let c = 0; c <= Q_COLS; c += BAY * 2) {
        const x = qX(c);
        put([x, wy, zK], [x, wy + 3.6, zK], -1, 0.22, 1.1);
      }
      // the two masts the read head's trolley rides, so the bar it drags is a
      // bridge between machines and not a light on a surface
      put([x0 - 5.6, y0 - 8, zK], [x0 - 5.6, y1 + 8, zK], -1, 0.30, 1.3);
      put([x1 + 5.6, y0 - 8, zK], [x1 + 5.6, y1 + 8, zK], -1, 0.30, 1.3);
      // the dimension rule: 169.6 m of wall, said in ticks
      const ry = y0 - 11.0;
      put([x0, ry, zW], [x1, ry, zW], -1, 0.24);
      for (let c = 0; c <= Q_COLS; c += BAY) {
        const long = c % 32 === 0;
        put([qX(c), ry - (long ? 1.5 : 0.8), zW],
            [qX(c), ry + (long ? 1.5 : 0.8), zW], -1, long ? 0.34 : 0.18);
      }
    }

    // The cable: one core, six strands, 77 m of it. It hangs just enough to
    // read as a cable and twists just enough to read as manufactured.
    // The recipe is src/circuit.js: this chapter sees the whole run, from the
    // button at u = 0 to her socket at u = 1.
    {
      const p0 = [0.04, -0.02, -0.20], p1 = [qX(63), qY(31), Q_Z + 0.6];
      this.cableRun = runOf({ p0, p3: p1, sag: 1.15, up: [0, 1, 0] });
      this.cableCount = buildRun(this.cableData, 0, this.cableRun, {
        core: rgb("miku"), strand: rgb("tealDeep"),
        uArr: this.cableU, coreArr: this.cableCore,
      });
    }

    // The live socket, marked: it is the only ring on the wall, and the plug
    // is where the cable lands on it.
    {
      const cx = qX(63), cy = qY(31), r = 2.2;
      for (let i = 0; i < 20; i++) {
        const a0 = (i / 20) * TAU, a1 = ((i + 1) / 20) * TAU;
        const x0s = cx + Math.cos(a0) * r, y0s = cy + Math.sin(a0) * r;
        const x1s = cx + Math.cos(a1) * r, y1s = cy + Math.sin(a1) * r;
        const dx = x1s - x0s, dy = y1s - y0s;
        const l = Math.hypot(dx, dy) || 1e-3;
        writeInstance(this.markData, i, {
          p: [(x0s + x1s) / 2, (y0s + y1s) / 2, Q_Z + 0.35],
          c: rgb("miku"), a: 0,
          r: [0, 0, Math.atan2(-dx, dy)], scale: [1, l / 2, 1],
        });
      }
      const plug = [
        [[cx - r, cy - r], [cx + r, cy - r]],
        [[cx + r, cy - r], [cx + r, cy + r]],
        [[cx + r, cy + r], [cx - r, cy + r]],
        [[cx - r, cy + r], [cx - r, cy - r]],
        [[cx + r, cy], [cx + 12, cy + 6]],
      ];
      plug.forEach(([a, b], i) => {
        this.seg(this.markData, 20 + i,
          [a[0], a[1], Q_Z + 0.3], [b[0], b[1], Q_Z + 0.3], rgb("tealDeep"), 0);
      });
    }

    // Dust: only visible because the wall is burning, and the only thing in
    // the room with any depth to it.
    for (let i = 0; i < 36; i++) {
      this.dustSeed.push({
        x: -70 + hash1(i * 5 + 1) * 140,
        y: -30 + hash1(i * 5 + 2) * 80,
        z: -78 + hash1(i * 5 + 3) * 92,
        ph: hash1(i * 5 + 4) * TAU,
        r: hash1(i * 5 + 5),
      });
    }
  }

  async init() {
    const F = this.ctx.features;
    this.want = line(F, "\u6b4c\u3044\u305f\u3044");
    this.mou = line(F, "\u30e2\u30a6");
  }

  // Write a world-space line into a stage's instance array.
  seg(arr, i, a, b, col, alpha, width = 1) {
    return writeSeg(arr, i, a, b, col, alpha, width);
  }

  render(f, out) {
    const t = f.t;
    const local = t - 139.69;
    // she is being taken apart as the render rolls back, but she has to still
    // be standing when the lens has pulled all the way off her: the reveal is
    // hers to lose, and a silhouette nobody can see loses nothing
    const alive = 1 - 0.5 * clamp(local / 21.0);
    this.pass.draw({ dst: out, u: audioU(f, { uAlive: alive }) });
    // The lens is evaluated once, before anything is drawn: every pass in this
    // chapter (wall, cable, read head, button, markings) must be on the same
    // camera, and the air must know where that camera is.
    this.view(f, local);
    const bt = beatAt(f.F, t);
    const bid = bt ? bt.id : "";
    const trying = bid === "want_to_sing";
    this.wallPass(out, f, t, local);
    this.button(out, f, local, trying);

    const c = this.text.ctx;
    this.text.clear();
    const W = this.ctx.W, H = this.ctx.H;
    const rev = this.rev;
    const B = this.btn;

    // She has almost been reduced to a wish: a silhouette beside the button
    // with one hand out toward it, coming apart as the voice runs out. She is
    // drawn at the button's own scale -- 1.70 m beside a 1.32 m face -- so
    // when the lens pulls back, she pulls back with it.
    const hEnd = Math.max(2.576 * B.r, 96);
    const sx = 560 + (B.x - B.r * 1.9 - hEnd * 0.18 - 560) * rev;
    const sy = 1010 + (B.y + B.r * 1.0 - 1010) * rev;
    const sh = 620 + (hEnd - 620) * rev;
    singer(c, sx, sy, sh, {
      t,
      alpha: 0.12 + 0.55 * alive,
      mouth: (0.15 + 0.75 * f.a.vocal) * alive,
      dissolve: clamp(1 - alive) * 0.92,
      crack: 0.30 * clamp(1 - alive),
      reach: trying ? { x: 0.46, y: -0.54 } : null,
      light: 0.15 + 0.55 * alive,
      seed: 9,
    });
    if (trying) {
      for (let i = 0; i < 3; i++) {
        soundRing(c, sx + sh * 0.28, sy - sh * 0.43, ((t * 0.85 + i * 0.33) % 1), {
          alpha: 0.5 * alive, r0: 10, r1: 130 * (sh / 620), rings: 1,
          color: css("mikuHi", 0.5),
        });
      }
    }
    dissolveDots(c, sx, sy - sh * 0.55, sh * 0.62, sh * 0.55, clamp(local / 22.0), {
      alpha: 0.35, count: 30, seed: 9, color: css("miku", 0.5),
    });

    // The button the listener never presses: the type is pinned to the object
    // itself, so "SING" is written where the button actually is -- and when
    // the button is a forty-pixel ring, the type is a name and a leader line.
    const k = clamp(B.r / 95, 0.44, 1);
    c.strokeStyle = css("miku", 0.75);
    c.lineWidth = 2.4 * k;
    c.beginPath();
    c.arc(B.x - B.r * 0.34, B.y, 26 * k, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = css("miku", 0.35 + 0.65 * B.ready);
    c.beginPath();
    c.moveTo(B.x - B.r * 0.34 - 7 * k, B.y - 12 * k);
    c.lineTo(B.x - B.r * 0.34 - 7 * k, B.y + 12 * k);
    c.lineTo(B.x - B.r * 0.34 + 13 * k, B.y);
    c.closePath();
    c.fill();
    label(c, "SING", B.x - B.r * 0.34 + 56 * k, B.y + 13 * k, {
      size: Math.max(17, 38 * k), tracking: 7 * k, color: css("bone", 0.92),
    });
    label(c, "REQUEST NOT ACCEPTED", B.x, B.y + B.r + 44, {
      size: 14, align: "center", tracking: 3, color: css("red", 0.62),
    });

    // The wall's own dimension: the one socket in 8,192 that is still asking,
    // named where it actually is.
    const inn = smoothstep(9.4, 13.2, local);
    const sp = project(this.vp, [qX(63), qY(31), Q_Z + 0.4], W, H);
    if (inn > 0.01 && sp[2] > 0.5) {
      c.save();
      c.globalAlpha = inn;
      // the label lives to the left of the socket, under the lyrics and clear
      // of the machine's own panels: the one clear column this frame has
      const lx = clamp(sp[0] - 300, 90, 820);
      const ly = clamp(sp[1] + 92, 420, H - 178);
      c.strokeStyle = css("miku", 0.42);
      c.lineWidth = 1.1;
      c.beginPath();
      c.moveTo(sp[0] - 14, sp[1] + 12);
      c.lineTo(lx + 272, ly + 16);
      c.lineTo(lx + 256, ly + 16);
      c.stroke();
      label(c, "SLOT 04031 \u2014 STILL LIT", lx, ly, {
        size: 15, tracking: 1.7, color: css("mikuHi", 0.92),
      });
      label(c, "COL 63 \u00b7 ROW 31 \u00b7 OF 08192", lx, ly + 21, {
        size: 12, tracking: 1.2, color: css("ash", 0.7),
      });
      c.restore();
    }

    // The dimension rule is named at both ends. The wall is a measurement
    // before it is a number: 128 sockets across, at 1.325 m each, is 169.6 m,
    // and the hall says so where the ruler actually is.
    if (inn > 0.01) {
      const ry = Q_Y0 - 11.0, zW = Q_Z + 0.16;
      const e0 = project(this.vp, [qX(0), ry, zW], W, H);
      const e1 = project(this.vp, [qX(Q_COLS - 1), ry, zW], W, H);
      if (e0[2] > 0.5 && e1[2] > 0.5) {
        c.save();
        c.globalAlpha = inn * 0.8;
        label(c, "0.0 m", e0[0] - 14, e0[1] - 16, {
          size: 12, align: "right", tracking: 1.2, color: css("ash", 0.7),
        });
        label(c, "169.6 m \u00b7 84.8 m HIGH", e1[0] + 14, e1[1] - 16, {
          size: 12, tracking: 1.2, color: css("ash", 0.7),
        });
        c.restore();
      }
    }

    // The route. This cable is not scenery: it is one run of wire with two
    // ends, and the tag is pinned to the middle of the run so the readout
    // cannot drift off the object it describes. Its far end is the key in the
    // next chapter -- the queue is where the line is registered, not where it
    // stops.
    const routeA = inn * (1 - smoothstep(21.6, 22.6, local));
    if (routeA > 0.01) {
      const p0 = [0.04, -0.02, -0.20], p1 = [qX(63), Q_Y0 + 31 * Q_PITCH, Q_Z + 0.6];
      const u = 0.5;
      const mp = project(this.vp, [
        p0[0] + (p1[0] - p0[0]) * u,
        p0[1] + (p1[1] - p0[1]) * u - Math.sin(u * Math.PI) * 1.15,
        p0[2] + (p1[2] - p0[2]) * u,
      ], W, H);
      if (mp[2] > 0.5) {
        const tx = clamp(mp[0] + 64, 560, 1420), ty = clamp(mp[1] + 46, 420, 800);
        c.save();
        c.globalAlpha = routeA;
        c.strokeStyle = css("miku", 0.40);
        c.lineWidth = 1.1;
        c.beginPath();
        c.moveTo(mp[0] + 8, mp[1] + 6);
        c.lineTo(tx - 10, ty + 16);
        c.stroke();
        label(c, "ROUTE: SLOT 04031 \u2192 KEY OK", tx, ty, {
          size: 14, tracking: 1.4, color: css("mikuHi", 0.9),
        });
        label(c, "ONE RUN \u00b7 077.0 m \u00b7 7 STRAND \u00b7 PULSE 5.26 s", tx, ty + 20, {
          size: 12, tracking: 1.1, color: css("ash", 0.66),
        });
        c.restore();
      }
    }

    // A read head is not a light: it is a bar that walks the rows and counts.
    // Its tally is written on the wall, at the left end of the bar.
    if (local > 11.5 && local < 17.4) {
      const row = this.scanRow(local);
      const bp = project(this.vp, [qX(0) - 2.5, qY(clamp(row, 0, Q_ROWS - 1)), Q_Z + 0.4], W, H);
      if (bp[2] > 0.5) {
        const count = Math.round(clamp((row - SCAN_LO) / (SCAN_HI - SCAN_LO)) * Q_SLOTS);
        const a = smoothstep(11.5, 12.1, local) * (1 - smoothstep(17.0, 17.4, local));
        const bx = clamp(bp[0], 96, 460), by = clamp(bp[1] - 16, 140, H - 170);
        c.save();
        c.globalAlpha = a * 0.92;
        label(c, "READING QUEUE", bx, by, {
          size: 13, tracking: 1.6, color: css("ash", 0.75),
        });
        drawText(c, String(clamp(count, 0, Q_SLOTS)).padStart(5, "0"), {
          x: bx + 210, y: by + 4, size: 22, weight: 600, mono: true,
          align: "right", color: css("bone", 0.9),
        });
        c.restore();
      }
    }

    // The queue: what the wall behind the button is actually counting. She is
    // not asking one machine for one thing; she is standing in a line.
    const qA = smoothstep(10.4, 12.4, local);
    if (qA > 0.01) {
      c.save();
      c.globalAlpha = qA;
      panel(c, 1230, 316, 606, 252, {
        fill: css("ink2", 0.42), corner: 10, cornerColor: css("miku", 0.30),
        stroke: css("dim", 0.26),
      });
      label(c, "REQUEST QUEUE \u2014 SOCKET WALL", 1246, 342, {
        size: 13, tracking: 1.5, color: css("ash", 0.72),
      });
      const qrows = [
        ["REQUESTS ON FILE", "08192", css("bone", 0.9)],
        ["ANSWERED", "08191", css("ash", 0.9)],
        ["ACCEPTED", "00000", css("red", 0.9)],
        ["PENDING", "00001", css("mikuHi", 0.95)],
      ];
      qrows.forEach(([key, v, col], i) => {
        const y = 378 + i * 34;
        label(c, key, 1246, y, { size: 14, tracking: 1.3, color: css("ash", 0.78) });
        drawText(c, v, {
          x: 1820, y: y + 4, size: 21, weight: 600, mono: true,
          align: "right", color: col,
        });
      });
      label(c, "LIVE SOCKET 04031 \u2014 OF 08192", 1246, 514, {
        size: 13, tracking: 1.4, color: css("miku", 0.8),
      });
      c.strokeStyle = css("dim", 0.3);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(1246, 528);
      c.lineTo(1820, 528);
      c.stroke();
      label(c, "WALL 169.6 m \u00d7 84.8 m \u00b7 128 COL \u00d7 64 ROW", 1246, 550, {
        size: 12, tracking: 1.1, color: css("ash", 0.62),
      });
      c.restore();
    }

    const approach = clamp((local - 4.0) / 14.0);
    const px = B.x - B.r - (250 - approach * 190) * k + Math.sin(t * 6.0) * 4;
    const py = B.y + B.r * 0.16 + Math.cos(t * 7.0) * 3;
    c.save();
    c.translate(px, py);
    c.scale(k, k);
    c.fillStyle = css("bone", 0.9);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, 30);
    c.lineTo(8, 22);
    c.lineTo(21, 35);
    c.lineTo(28, 28);
    c.lineTo(15, 15);
    c.lineTo(24, 7);
    c.closePath();
    c.fill();
    c.restore();
    if (rev < 0.4) {
      motifLabel(c, "THE ONE THING SHE ASKS FOR", B.x - B.r - 40, B.y - B.r - 74, {
        color: css("miku", 0.6 * (1 - rev / 0.4) * (1 - inn)),
      });
    }

    // The line itself, small and repeated: it keeps asking. It stays quiet --
    // the room behind the button is the thing this chapter is about, and by
    // the end the sentence is a whisper over a wall of 8,192 sockets.
    const w = this.want;
    if (w) {
      const d = clamp((local - 0.2) / 0.5) * (1 - 0.62 * rev);
      c.save();
      c.globalAlpha = d;
      drawText(c, w.text, {
        x: 960, y: 300, size: 44, weight: 900, align: "center",
        color: css("bone", 0.92), tracking: 5,
      });
      c.restore();
      // echoes, each further away
      for (let i = 1; i <= 4; i++) {
        const tt = local - i * 1.35;
        if (tt < 0) continue;
        const a = Math.max(0, 0.20 - i * 0.035)
          * (1 - smoothstep(0, 1.2, tt % 1.35)) * (1 - 0.62 * rev);
        c.save();
        c.globalAlpha = a;
        drawText(c, i % 2 ? "\u2026\u307e\u3060\u2026" : w.text, {
          x: 1080, y: 300 - i * 46, size: 30 - i * 2, weight: 400, align: "center",
          color: css("miku", 0.85), tracking: 5,
        });
        c.restore();
      }
    }

    // the cursor: the only thing still awake
    const blink = Math.sin(t * 2.6) > -0.2 ? 1 : 0;
    c.save();
    c.globalAlpha = blink * (0.35 + 0.65 * alive);
    c.fillStyle = css("miku", 0.95);
    c.fillRect(940, 470, 40, 6);
    c.restore();

    // the waveform that cannot quite rise: it stays in the corner, small,
    // like the voice it belongs to
    const amp = 0.28 + 0.72 * alive;
    wave(c, f.F, t, {
      x: 96, y: 232, w: 660, h: 64, span: 2.6, lw: 1.8,
      color: css("miku", 0.25 + 0.5 * alive), amp: amp * 0.9,
    });
    c.strokeStyle = css("dim", 0.5);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(96, 264);
    c.lineTo(756, 264);
    c.stroke();

    // the render is being wound backwards
    const pct = 47.0 - local * 1.35;
    label(c, "RENDER", 84, 850, { size: 18, tracking: 2, color: css("ash", 0.9) });
    drawText(c, `${Math.max(0, pct).toFixed(1)} %`, {
      x: 460, y: 858, size: 44, weight: 600, mono: true, align: "right",
      color: css("bone", 0.9),
    });
    label(c, "\u2193 ROLLING BACK", 486, 850, { size: 15, tracking: 1.6, color: css("red", 0.8) });
    tickRule(c, 84, 880, 376, { count: 24, h: 5, major: 4, majorH: 10, color: css("dim", 0.5) });

    // right side: what is left of the voice
    const rows = [
      ["VOICE BANK", "\u6b8b\u5b58", css("amber", 0.9)],
      ["RESONANCE", `${(72 * alive).toFixed(1)} %`, css("bone", 0.85)],
      ["INTENT", alive > 0.15 ? "SING" : "\u2014", css("miku", 0.9)],
      ["ANSWER", "NONE", css("red", 0.85)],
    ];
    // ... and it hands over to the queue the moment the wall arrives: the
    // machine stops reporting on her and starts reporting on the line
    c.save();
    c.globalAlpha = 1 - qA;
    rows.forEach(([key, v, col], i) => {
      // kept clear of the lyrics above and of the button below: the machine's
      // status card lives in the one column this chapter leaves empty
      const y = 620 + i * 46;
      label(c, key, 1400, y, { size: 16, color: css("ash", 0.85), tracking: 1.4 });
      label(c, v, 1836, y, { size: 18, align: "right", color: col, tracking: 1.6 });
    });
    c.restore();

    // the opening words come back at the end of the instrumental
    if (local > 15.0 && this.mou) {
      const a = smoothstep(15.0, 17.0, local) * (1 - smoothstep(21.0, 22.5, local));
      c.save();
      c.globalAlpha = a * 0.55;
      drawText(c, "\u30e2\u30a6\u30fb\u30fb\u3044\u3061\u3069\u30fb\u30c0\u30fb\u30b1\u30fb\u30fb\u30fb", {
        x: 960, y: 200, size: 34, weight: 400, align: "center",
        color: css("ash", 0.9), tracking: 8,
      });
      c.restore();
    }

    machineChrome(c, {
      name: "",
      left: rev > 0.5 ? "QUEUE 08192 \u00b7 ONE UNANSWERED" : "WAITING FOR AN ANSWER",
      right: rev > 0.98 ? "WALL 169.6 \u00d7 84.8 m \u00b7 8,192 SOCKETS" : `IDLE ${local.toFixed(1)} s`,
    });

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    return {
      bloom: 0.6 + 0.3 * alive,
      exposure: 0.92,
      grain: 0.022,
      vignette: 0.72,
      scan: 0.03,
      ca: 0.0012,
      fade: 0.25 * (1 - alive),
    };
  }

  // ---- the queue behind the button. It is not a metaphor: there is a wall,
  // 8,192 sockets on it, a head that walks the rows and counts them out loud,
  // and 8,191 of them are dark because they were answered long ago. The one
  // that is still lit is on the end of her cable, and she still has not
  // pressed it.
  wallPass(out, f, t, local) {
    const inn = smoothstep(9.4, 13.2, local);
    if (inn <= 0.004) return;
    const row = this.scanRow(local);
    const scanOn = local > 11.4 && local < 16.8;
    // What the head has already read stays lit for a moment: the wall's light
    // is a record of the reading, and a record has a tail. By 18.8 s the tail
    // is gone and the wall is 8,191 dark cells and one lit one again.
    const trail = local < 16.2 ? 1 : 1 - clamp((local - 16.2) / 2.6);
    const DEEP = rgb("tealDeep"), MI = rgb("miku"), HI = rgb("mikuHi");
    const breathe = 0.5 + 0.5 * Math.sin(t * 1.8);

    // the bays: the wall's surface, lit only where the head is
    for (let i = 0; i < BAYS_X * BAYS_Y; i++) {
      const o = i * 16;
      const band = scanOn
        ? Math.exp(-Math.pow((this.panelRow[i] + BAY / 2 - row) * 0.16, 2)) : 0;
      // the bays have to survive the grade: a panel is a surface the wall is
      // made of, and tealDeep at a sane alpha simply disappears here
      this.panelData[o + 4] = DEEP[0] + (MI[0] - DEEP[0]) * (0.42 + 0.5 * band);
      this.panelData[o + 5] = DEEP[1] + (MI[1] - DEEP[1]) * (0.42 + 0.5 * band);
      this.panelData[o + 6] = DEEP[2] + (MI[2] - DEEP[2]) * (0.42 + 0.5 * band);
      this.panelData[o + 7] = clamp(
        inn * (0.022 + 0.055 * band) * (0.65 + 0.7 * hash1(i * 3 + 1)),
      );
    }
    this.panels.update(this.panelData, BAYS_X * BAYS_Y)
      .render(out, this.air({ vp: this.vp, opacity: 0.95 }));

    // the truss: it lights the row or column the head is passing
    for (let i = 0; i < this.gridCount; i++) {
      const key = this.gridKey[i];
      const band = scanOn && key >= 0 ? Math.exp(-Math.pow((key - row) * 0.30, 2)) : 0;
      const o = i * 16;
      const k = clamp(0.25 + 0.75 * band);
      this.gridData[o + 4] = DEEP[0] + (MI[0] - DEEP[0]) * k;
      this.gridData[o + 5] = DEEP[1] + (MI[1] - DEEP[1]) * k;
      this.gridData[o + 6] = DEEP[2] + (MI[2] - DEEP[2]) * k;
      this.gridData[o + 7] = clamp(inn * (this.gridBase[i] + 0.42 * band));
    }
    this.grid.update(this.gridData, this.gridCount)
      .render(out, this.air({ vp: this.vp, opacity: 0.92 }));

    // the bay frames: 16 x 8 boxes, drawn in front of the sockets, so the wall
    // is visibly assembled out of 128 bays of 10.6 m
    for (let i = 0; i < BAYS_X * BAYS_Y; i++) {
      const o = i * 16;
      const band = scanOn
        ? Math.exp(-Math.pow((this.panelRow[i] + BAY / 2 - row) * 0.30, 2)) : 0;
      const k = clamp(0.20 + 0.80 * band);
      this.bayFrameData[o + 4] = DEEP[0] + (MI[0] - DEEP[0]) * k;
      this.bayFrameData[o + 5] = DEEP[1] + (MI[1] - DEEP[1]) * k;
      this.bayFrameData[o + 6] = DEEP[2] + (MI[2] - DEEP[2]) * k;
      this.bayFrameData[o + 7] = clamp(inn * (0.20 + 0.34 * band));
    }
    this.bayFrames.update(this.bayFrameData, BAYS_X * BAYS_Y)
      .render(out, this.air({ vp: this.vp, opacity: 0.95 }));

    // the hall the wall stands in: frame, gantry, legs, walkway, masts and the
    // dimension rule. Its rails light with the row the head is on; its
    // uprights keep their own weight, because a machine does not flicker.
    for (let i = 0; i < this.structCount; i++) {
      const key = this.structKey[i];
      const band = scanOn && key >= 0
        ? Math.exp(-Math.pow((key - row) * 0.26, 2)) * (0.55 + 0.45 * trail) : 0;
      const o = i * 16;
      const k = clamp(0.28 + 0.72 * band);
      this.structData[o + 4] = DEEP[0] + (MI[0] - DEEP[0]) * k;
      this.structData[o + 5] = DEEP[1] + (MI[1] - DEEP[1]) * k;
      this.structData[o + 6] = DEEP[2] + (MI[2] - DEEP[2]) * k;
      this.structData[o + 7] = clamp(inn * (this.structBase[i] + 0.34 * band));
    }
    this.struct.update(this.structData, this.structCount)
      .render(out, this.air({ vp: this.vp, opacity: 0.94 }));

    // every socket: a cell, 8,191 of them dark -- and dark still has to be
    // visible, because the point of the wall is that they are there. The head
    // is written into this same loop: the band it sits on, and the tail of
    // rows it has already counted.
    for (let i = 0; i < Q_SLOTS; i++) {
      const o = i * 16;
      if (i === Q_LIT) {
        this.wallData[o + 4] = HI[0];
        this.wallData[o + 5] = HI[1];
        this.wallData[o + 6] = HI[2];
        this.wallData[o + 7] = clamp(inn * (0.62 + 0.30 * breathe));
        continue;
      }
      const r = (i / Q_COLS) | 0;
      const d = row - r;
      const lead = Math.exp(-d * d * 0.55);
      const after = d > 0 ? Math.exp(-d / 6.5) * trail : 0;
      const k = clamp(0.85 * lead + 0.55 * after);
      this.wallData[o + 4] = DEEP[0] + (MI[0] - DEEP[0]) * k;
      this.wallData[o + 5] = DEEP[1] + (MI[1] - DEEP[1]) * k;
      this.wallData[o + 6] = DEEP[2] + (MI[2] - DEEP[2]) * k;
      this.wallData[o + 7] = clamp(
        inn * (0.125 + 0.065 * hash1(i * 7 + 3) + 0.72 * k),
      );
    }
    this.wall.update(this.wallData, Q_SLOTS)
      .render(out, this.air({ vp: this.vp, opacity: 0.95 }));

    // the head itself: the cells inside its band are filled, not just outlined
    if (scanOn) {
      let n = 0;
      const r0 = Math.max(0, Math.floor(row) - 1);
      const r1 = Math.min(Q_ROWS - 1, Math.floor(row) + 2);
      for (let r = r0; r <= r1; r++) {
        const d = r - row;
        const k = Math.exp(-d * d * 0.5);
        for (let col = 0; col < Q_COLS; col++) {
          writeInstance(this.headData, n, {
            p: [qX(col), qY(r), Q_Z + 0.3], c: rgb("mikuHi"),
            a: clamp(inn * (0.06 + 0.30 * k)),
            scale: [CELL * 1.45, CELL * 1.45, 1],
          });
          n++;
        }
      }
      this.headFill.update(this.headData, n)
        .render(out, this.air({ vp: this.vp, opacity: 0.95 }));
    }

    // the read head's trolley: a box that rides the left mast and drags the
    // bar across the wall, 13 m in front of it, so the scan is performed by a
    // machine standing in the room -- not by a light that belongs to a surface
    if (scanOn) {
      const y = qY(clamp(row, 0, Q_ROWS - 1));
      const tx = Q_X0 - 5.6, tz = Q_Z + 12.0;
      const hw = 1.5, hh = 1.15, hd = 1.15;
      const c0 = [tx - hw, y - hh, tz - hd], c1 = [tx + hw, y + hh, tz + hd];
      const corners = [
        [c0[0], c0[1], c0[2]], [c1[0], c0[1], c0[2]],
        [c1[0], c1[1], c0[2]], [c0[0], c1[1], c0[2]],
        [c0[0], c0[1], c1[2]], [c1[0], c0[1], c1[2]],
        [c1[0], c1[1], c1[2]], [c0[0], c1[1], c1[2]],
      ];
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      let q = 0;
      const put = (a, b) => {
        this.seg(this.trolleyData, q++, a, b, rgb("miku"), 0);
      };
      for (const [a, b] of edges) put(corners[a], corners[b]);
      // the arm reaching the wall, and the two braces that carry it
      put([tx + hw, y, tz], [Q_X0 - 1.6, y, Q_Z + 0.7]);
      put([tx + hw, y - hh, tz], [Q_X0 - 1.6, y - 0.35, Q_Z + 0.7]);
      put([tx + hw, y + hh, tz], [Q_X0 - 1.6, y + 0.35, Q_Z + 0.7]);
      const ta = clamp(inn * 0.42);
      for (let i = 0; i < q; i++) this.trolleyData[i * 16 + 7] = ta;
      this.trolley.update(this.trolleyData, q)
        .render(out, this.air({ vp: this.vp, opacity: 0.95 }));
    }

    // the live socket: a ring, a core, and the plug where the cable lands
    const litPulse = 0.55 + 0.45 * breathe;
    writeInstance(this.litData, 0, {
      p: [qX(63), qY(31), Q_Z + 0.5], c: rgb("mikuHi"), a: clamp(inn * litPulse),
    });
    writeInstance(this.litData, 1, {
      p: [qX(63), qY(31), Q_Z + 0.5], c: rgb("miku"), a: clamp(inn * 0.5),
    });
    this.lit.update(this.litData, 2)
      .render(out, this.air({ vp: this.vp, point: 15, sprite: 1, opacity: 0.95 }));

    for (let i = 0; i < 26; i++) {
      const o = i * 16;
      this.markData[o + 7] = clamp(inn * (i < 20 ? 0.44 + 0.5 * litPulse : 0.26 + 0.3 * litPulse));
    }
    this.marks.update(this.markData, 26).render(out, this.air({ vp: this.vp, opacity: 0.95 }));

    // the head's own bar: a horizontal beam the full width of the wall, plus
    // the haze it throws on the bays under it
    if (scanOn) {
      const y = qY(row);
      this.seg(this.barData, 0, [Q_X0 - 4, y, Q_Z + 0.5], [Q_X0 + WALL_W + 4, y, Q_Z + 0.5],
        rgb("mikuHi"), clamp(inn * 0.42));
      this.seg(this.barData, 1, [Q_X0 - 4, y - 0.5, Q_Z + 0.4], [Q_X0 + WALL_W + 4, y - 0.5, Q_Z + 0.4],
        rgb("miku"), clamp(inn * 0.22));
      this.seg(this.barData, 2, [Q_X0 - 4, y + 0.5, Q_Z + 0.4], [Q_X0 + WALL_W + 4, y + 0.5, Q_Z + 0.4],
        rgb("miku"), clamp(inn * 0.22));
      this.bar.update(this.barData, 3).render(out, this.air({ vp: this.vp, opacity: 0.95 }));
      writeInstance(this.hazeData, 0, {
        p: [0, y, Q_Z - 0.1], s: 1, c: rgb("tealDeep"), a: clamp(inn * 0.05),
        scale: [WALL_W / 2 + 2, 1.6, 1],
      });
      this.haze.update(this.hazeData, 1)
        .render(out, this.air({ vp: this.vp, soft: 1, opacity: 0.9 }));
    }

    // the cable: 77 m, and it goes all the way back to the wall. Once every
    // few seconds a request runs down it -- the one she never sends.
    const pu = pulsePhase(t);
    for (let i = 0; i < this.cableCount; i++) {
      const u = this.cableU[i];
      const dash = pulseAt(u, pu);
      const o = i * 16;
      this.cableData[o + 7] = clamp(inn * (this.cableCore[i]
        ? 0.26 + 0.62 * dash
        : 0.045 + 0.04 * Math.sin(t * 1.1 + i * 0.07) + 0.34 * dash));
    }
    this.cable.update(this.cableData, this.cableCount)
      .render(out, this.air({ vp: this.vp, opacity: 0.92 }));

    // dust: the only thing in the room with any depth to it
    let d = 0;
    for (const s of this.dustSeed) {
      const a = inn * (0.035 + 0.075 * s.r)
        * (0.5 + 0.5 * Math.sin(t * 0.5 + s.ph * 3.0));
      if (a <= 0.004) continue;
      d = writeInstance(this.dustData, d, {
        p: [
          s.x + Math.sin(t * 0.13 + s.ph) * 1.6,
          s.y + Math.sin(t * 0.21 + s.ph * 2.0) * 1.1,
          s.z + Math.cos(t * 0.17 + s.ph) * 1.4,
        ],
        c: s.r > 0.6 ? rgb("miku") : rgb("tealDeep"), a: clamp(a),
      });
    }
    this.dust.update(this.dustData, d)
      .render(out, this.air({ vp: this.vp, point: 2.2, sprite: 1, opacity: 0.9 }));
  }

  scanRow(local) {
    return SCAN_LO + (SCAN_HI - SCAN_LO) * clamp((local - 11.5) / 4.5);
  }

  // The button itself, and the lens. Screen position and radius are solved
  // from the same projection the 3D pass uses, so every 2D element in the
  // chapter can be pinned to the object instead of to hard-coded pixels.
  //
  // Shot one: the button fills the void. From 9.6 s the lens pulls back and
  // rises -- 40 m of travel, most of it away from the only two objects in the
  // frame -- and the room behind the button comes up: the cable first, then
  // the wall. From 16.0 s to the end of the chapter it does not move at all.
  // Nothing happens in this chapter, and the camera is the thing that says how
  // big "nothing" is.
  // Evaluate the chapter's 3D operator at local time `local`. The rig owns the
  // pull-back; a slow breathing drift is added while it is held, so the static
  // shot is a hand and not a tripod. Everything downstream reads `this.vp`,
  // `this.eyeNow` and `this.atNow`.
  view(f, local) {
    const t = f.t;
    const rev = smoothstep(9.6, 16.0, local);
    this.rev = rev;
    const cam = this.rig.eval(clamp(local / 23.0, 0, 1), this.ctx.W / this.ctx.H);
    const drift = 1 - rev;
    this.eyeNow = [
      cam.eye[0] + Math.sin(t * 0.13) * 0.030 * drift,
      cam.eye[1] + Math.sin(t * 0.17) * 0.018 * drift,
      cam.eye[2],
    ];
    this.atNow = [
      cam.at[0] + Math.sin(t * 0.13) * 0.030 * drift,
      cam.at[1] + Math.sin(t * 0.17) * 0.018 * drift,
      cam.at[2],
    ];
    camera(this.vp, {
      eye: this.eyeNow, at: this.atNow,
      fov: cam.fov, near: 0.1, far: 400, aspect: this.ctx.W / this.ctx.H,
    });
    return cam;
  }

  // one air for the whole hall; the eye is passed per call so a hand-over
  // render cannot fog this chapter from the other chapter's lens
  air(opts = {}) {
    return { eye: this.eyeNow, fog: { dist: AIR_HALL, c: rgb("ink") }, ...opts };
  }

  button(out, f, local, trying) {
    const t = f.t;
    const alive = 1 - 0.5 * clamp(local / 21.0);
    const breathe = 0.5 + 0.5 * Math.sin(t * ((Math.PI * 2) / 4.2));
    const ready = (trying ? 0.35 + 0.45 * f.vox : 0.12) * (0.35 + 0.65 * alive);
    const rev = this.rev;

    let n = 0;
    const ringPass = (R, seg, color, alpha) => {
      const chord = (Math.PI * 2 * R) / seg;
      for (let i = 0; i < seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        n = writeInstance(this.ringData, n, {
          p: [Math.cos(th) * R, Math.sin(th) * R, 0], s: chord * 0.54,
          c: color, a: alpha, r: [0, 0, th],
        });
      }
    };
    ringPass(0.60, 72, rgb("miku"), (0.26 + 0.42 * ready) * (0.45 + 0.55 * breathe));
    ringPass(0.52, 48, rgb("mikuHi"), 0.12 + 0.24 * ready);
    // the bezel: ticks around the outside, every ninth one longer
    for (let i = 0; i < 36; i++) {
      const th = (i / 36) * Math.PI * 2;
      const long = i % 9 === 0;
      n = writeInstance(this.ringData, n, {
        p: [Math.cos(th) * 0.672, Math.sin(th) * 0.672, 0],
        s: long ? 0.034 : 0.019,
        c: rgb("miku"), a: (long ? 0.34 : 0.16) + 0.14 * ready, r: [0, 0, th],
      });
    }
    // how it floats: three hairlines hanging into the dark
    for (let i = -1; i <= 1; i++) {
      n = writeInstance(this.ringData, n, {
        p: [i * 0.13, -0.90 - Math.abs(i) * 0.10, 0],
        s: 0.30 - Math.abs(i) * 0.06, c: rgb("tealDeep"), a: 0.30,
      });
    }
    this.ring.update(this.ringData, n).render(out, this.air({ vp: this.vp }));

    let d = 0;
    d = writeInstance(this.discData, d, {
      p: [0, 0, -0.02], s: 1, c: rgb("mikuHi"), a: 0.030 + 0.035 * ready,
      scale: [0.90, 0.90, 1],
    });
    d = writeInstance(this.discData, d, {
      p: [0, 0, 0], s: 1, c: rgb("tealDeep"), a: 0.10 + 0.10 * f.a.vocal,
      scale: [0.46, 0.46, 1],
    });
    d = writeInstance(this.discData, d, {
      p: [0, 0, 0.01], s: 1, c: rgb("miku"),
      a: (0.05 + 0.10 * ready) * (0.4 + 0.6 * breathe),
      scale: [0.34, 0.34, 1],
    });
    this.disc.update(this.discData, d)
      .render(out, this.air({ vp: this.vp, soft: 0.85, opacity: 0.95 }));

    const c0 = project(this.vp, [0, 0, 0], this.ctx.W, this.ctx.H);
    const c1 = project(this.vp, [0.60, 0, 0], this.ctx.W, this.ctx.H);
    this.btn = {
      x: c0[0], y: c0[1], r: Math.abs(c1[0] - c0[0]),
      ready, alive, breathe,
    };
  }
}
