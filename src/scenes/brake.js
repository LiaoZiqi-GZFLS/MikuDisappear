// 1:43.7 - EMERGENCY STOP. The voice is clamped to a flat line while a mirror
// repeats everything it ever believed.

import { Scene } from "../engine.js";
import { Pass } from "../gl.js";
import { css } from "../palette.js";
import {
  clamp, easeOutCubic, label, lyricLine, machineChrome, panel, smoothstep, wave,
} from "../kit.js";
import { hand, listener, mirrorPane, motifLabel, singer } from "../motifs.js";
import { Stage3D, camera, mat4, project, rgb, writeInstance } from "../gl3d.js";
import { beatAt } from "../semantics.js";
import { draw as drawText, pad } from "../type.js";
import { audioU, layer } from "./util.js";

// Where the corridor ends and the one honest mirror hangs: 6.5 m past the last
// step of the walk, so the pane is a doorway the operator stops in front of
// rather than a picture hanging at the end of a corridor.
const TERMINAL_Z = -42;

const FRAG = `
uniform float uT;
uniform float uKick;
uniform float uFlux;
uniform float uStop;     // 0 before, 1 after the brake engages
uniform float uMirror;   // mirror recursion amount
uniform float uClamp;    // how loud the system is right now
in vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec3 col = C_INK;

  // the mirror: the frame folded into itself, over and over
  vec2 q = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float acc = 0.0;
  for (int i = 0; i < 6; i++) {
    q = abs(q) * 1.13 - 0.075;
    acc += exp(-length(q) * 7.0) * (0.55 - 0.075 * float(i));
  }
  // the mirror is cold glass; the red belongs to the stop, not to the room
  col += mix(C_TEAL_DEEP, C_RED_DEEP, 0.34) * acc * uMirror * (0.30 + 0.30 * uFlux);

  // hazard bands sweeping in from the sides
  float band = step(0.5, fract((uv.x + uv.y) * 9.0 - uT * 0.8));
  float edge = smoothstep(0.13, 0.03, min(uv.x, 1.0 - uv.x));
  col += C_RED * band * edge * (0.022 + 0.075 * uClamp);

  // The clamp belongs to the instrument band, not to the room. The old bar
  // ran across the corridor's vanishing point and turned the mirror hall into
  // a red stripe; now the frame is held by two thin shutters closing along the
  // top and bottom rails, and the flat line itself is drawn over the waveform
  // strip by the 2D layer. The room stays a room while it is being stopped.
  float shut = smoothstep(0.30, 0.0, min(uv.y, 1.0 - uv.y));
  col += C_RED * shut * uStop * (0.020 + 0.100 * uClamp);

  col += C_RED * 0.06 * uKick * exp(-pow((uv.y - 0.5) * 6.0, 2.0));
  fragColor = vec4(col, 1.0);
}`;

export default class Brake extends Scene {
  constructor(ctx) {
    super(ctx);
    this.text = layer(ctx);
    this.pass = new Pass(ctx.gl, FRAG, "brake");

    // The mirror hall is a real 3D set: frames, a floor/ceiling grid and a
    // field of debris. Everything is additive light, so it composites into
    // the 2D picture as the space *behind* the readouts.
    this.vp = mat4();
    this.room = new Stage3D(ctx, "quad");
    this.grid = new Stage3D(ctx, "segment");
    this.debris = new Stage3D(ctx, "segment");
    this.streaks = new Stage3D(ctx, "segment");
    this.hairStage = new Stage3D(ctx, "segment");
    this.notes = new Stage3D(ctx, "quad");
    this.glassMesh = new Stage3D(ctx, "quad");
    // the stop itself: a rectangular front that runs down the corridor at the
    // instant the transport dies. Everything behind it is already frozen;
    // this is the only thing allowed to move after the brake, and it is what
    // turns "the world stopped" from a readout into a visible event.
    this.front = new Stage3D(ctx, "segment");
    this.frontData = new Float32Array(8 * 16);
    const R = 14;                       // mirror frames down the corridor
    // three recursions per frame, plus the terminal pane at the far end
    this.frameData = new Float32Array((R * 3 + 2) * 16);
    this.gridData = new Float32Array(64 * 16);
    this.shardData = new Float32Array(240 * 2 * 16);
    this.streakData = new Float32Array(420 * 16);
    this.noteData = new Float32Array(46 * 2 * 16);
    this.hairData = new Float32Array(140 * 16);
    this.glassData = new Float32Array(14 * 16);
    // deterministic debris: position, length, phase, spin, palette pick
    this.shards = [];
    for (let i = 0; i < 240; i++) {
      const h = (k) => {
        const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
        return s - Math.floor(s);
      };
      this.shards.push({
        x: (h(1) - 0.5) * 17,
        y: 0.9 + h(2) * 6.2,
        z: -2 - h(3) * 64,
        len: 0.30 + h(4) * 1.30,
        phase: h(5) * Math.PI * 2,
        spin: (h(6) - 0.5) * 2.4,
        note: h(7),
        warm: h(8) > 0.88,
      });
    }
    // Twelve strands of her hair, caught in mid-flight over the whole
    // corridor: the one thing in the room the eye can recognise.
    this.strands = [];
    for (let i = 0; i < 9; i++) {
      const h = (k) => {
        const s = Math.sin(i * 9.17 + k * 27.31) * 19341.71;
        return s - Math.floor(s);
      };
      const pts = [];
      const x0 = (h(1) - 0.5) * 16;
      const y0 = 1.0 + h(2) * 6.0;
      const z0 = -3 - h(3) * 56;
      for (let j = 0; j < 5; j++) {
        const u = j / 4;
        pts.push([
          x0 + (h(4) - 0.5) * 1.1 * u + Math.sin(u * 3.1 + i) * 0.22,
          y0 + (h(5) - 0.5) * 0.9 * u + Math.cos(u * 2.8 + i * 1.3) * 0.16,
          z0 - u * (3.0 + h(6) * 4.2),
        ]);
      }
      this.strands.push({ pts });
    }
    // Musical notes, frozen where they were when the transport died.
    this.noteSeeds = [];
    for (let i = 0; i < 46; i++) {
      const h = (k) => {
        const s = Math.sin(i * 3.71 + k * 19.13) * 8134.13;
        return s - Math.floor(s);
      };
      this.noteSeeds.push({
        x: (h(1) - 0.5) * 15,
        y: 1.0 + h(2) * 5.8,
        z: -2 - h(3) * 64,
        s: 0.24 + h(4) * 0.34,
        beam: h(5) > 0.72,
        phase: h(6) * Math.PI * 2,
      });
    }
    // a dozen big panes of frozen glass, edge-on to the lens
    this.glass = [];
    for (let i = 0; i < 14; i++) {
      const h = (k) => {
        const s = Math.sin(i * 7.31 + k * 41.7) * 24634.6345;
        return s - Math.floor(s);
      };
      this.glass.push({
        x: (h(1) - 0.5) * 15,
        y: 1.4 + h(2) * 5.4,
        z: -4 - h(3) * 62,
        w: 0.5 + h(4) * 1.5,
        hgt: 0.35 + h(5) * 1.1,
        rot: [h(6) * 0.7, h(7) * 1.4, h(8) * 1.1],
        phase: h(9) * 6.28,
      });
    }
  }

  render(f, out) {
    const t = f.t;
    const local = t - 103.69;
    const stop = clamp((local - 0.05) / 0.5);
    const mirror = smoothstep(1.6, 4.0, local);
    // The hit is loud, then the system lets go of the frame: the frozen world
    // is what the rest of the chapter is about.
    const hold = stop * (1 - 0.62 * smoothstep(1.8, 4.6, local));
    this.pass.draw({ dst: out, u: audioU(f, { uStop: stop, uMirror: mirror, uClamp: hold }) });
    const frozen = this.hall(out, local, stop, t);

    const c = this.text.ctx;
    this.text.clear();

    const beat = beatAt(f.F, t);
    const id = beat ? beat.id : "";
    const bAlpha = beat ? Math.min(beat.fresh, 1 - beat.exit) : 0;

    // the mirror: a convenient fantasy, repeated until it is the only picture
    mirrorPane(c, 1330, 592, 506, 172, {
      alpha: 0.35 + 0.45 * bAlpha,
      recurse: 6,
    });
    if (id === "believed" || id === "mirror_delusion") {
      listener(c, 1583, 788, 190, {
        t,
        alpha: 0.20 + 0.30 * bAlpha,
        smile: 0.6,
        eyes: "happy",
        scan: (t * 0.4) % 1,
      });
      motifLabel(c, "CONVENIENT / DELUSION", 1330, 578, {
        color: css("amber", 0.75),
      });
    }
    // The walk arrives at the far pane, and the far pane shows the one thing
    // this room has never shown: her, standing where the recursion cannot
    // reach. No face, no fantasy -- nothing left for the mirror to repeat.
    // She is placed by projecting the pane's own world coordinates, so the
    // arrival and the picture are the same event, not two events that match.
    const arrive = smoothstep(8.6, 11.4, local);
    if (arrive > 0.01) {
      const foot = project(this.vp, [0, 1.35, TERMINAL_Z], this.ctx.W, this.ctx.H);
      const crown = project(this.vp, [0, 3.05, TERMINAL_Z], this.ctx.W, this.ctx.H);
      if (foot[2] > 0.3) {
        const h = Math.abs(crown[1] - foot[1]);
        if (h > 6) {
          singer(c, foot[0], foot[1], h, {
            t,
            alpha: 0.72 * arrive,
            mouth: 0,
            dissolve: 0.12,
            light: 0.36 + 0.22 * arrive,
            eyes: "closed",
          });
        }
      }
    }
    if (id === "slam_stop") {
      const hit = clamp((beat.local - 0.1) / 0.25);
      c.save();
      c.globalAlpha = bAlpha;
      c.fillStyle = css("red", 0.16 + 0.22 * hit);
      c.strokeStyle = css("red", 0.85);
      c.lineWidth = 2;
      // The key sits left of where the palm lands (the palm's own disc is
      // 132 px wide and centred at x=1610): the hand may cover the key, but it
      // may never cover the word on it.
      c.fillRect(1330, 880, 210, 52);
      c.strokeRect(1330.5, 880.5, 209, 51);
      label(c, "SLAM / STOP", 1435, 913, {
        size: 18, align: "center", tracking: 3, color: css("bone", 0.95),
      });
      hand(c, 1848, 906, 360, Math.PI, {
        alpha: 0.30 + 0.45 * hit,
        press: true,
        color: css("bone", 0.85),
      });
      c.restore();
    }

    // clamp readout, hard mono.
    // This chapter is the one place where the frame itself is punched in 9%, and
    // this panel lives in the scene layer -- so it is drawn inset by 48 px: at
    // the shot's 1.12 zoom the panel would otherwise lose the first letters of
    // "EMERGENCY STOP DEVICE" off the left edge, and a machine that reports its
    // own halt must be readable while it reports it.
    const px = 132, py = 180;
    panel(c, px, py, 520, 196, {
      fill: css("ink2", 0.9), corner: 12, cornerColor: css("red", 0.8),
      stroke: css("red", 0.5),
    });
    label(c, "EMERGENCY STOP DEVICE", px + 16, py - 8, { size: 17, tracking: 1.8, color: css("red", 0.95) });
    label(c, "ACTUATED", px + 16, py + 42, { size: 26, tracking: 2, color: css("bone", 0.95) });
    const secs = Math.max(0, local);
    drawText(c, `${secs.toFixed(2)} s`, {
      x: px + 504, y: py + 80, size: 40, weight: 600, mono: true, align: "right", color: css("red", 0.95),
    });
    label(c, "MASTER OUTPUT HELD AT 0.000", px + 16, py + 116, { size: 16, tracking: 1.4, color: css("ash", 0.9) });
    drawText(c, `${pad(Math.floor(local * 240), 5)}`, {
      x: px + 504, y: py + 144, size: 26, weight: 600, mono: true, align: "right", color: css("ash", 0.9),
    });
    label(c, "FRAMES HELD", px + 16, py + 144, { size: 15, tracking: 1.4, color: css("ash", 0.75) });
    // The count is the number of instances the corridor actually drew this
    // frame (grammar 3: a readout is supported by geometry). It is not a
    // number that climbs with the song -- it is what is still standing in
    // front of the lens after the walk has eaten everything behind it.
    label(c, "OBJECTS IN THE FREEZE", px + 16, py + 174, {
      size: 15, tracking: 1.4, color: css("ash", 0.75),
    });
    drawText(c, `${pad(frozen, 5)}`, {
      x: px + 504, y: py + 174, size: 22, weight: 600, mono: true, align: "right",
      color: css("bone", 0.9),
    });

    // The other half of the same instrument: the room is held, so the only
    // motion left is the lens. Both numbers are read off this frame's own 3D
    // pass (hall()): the front is where the stop wave is, the travel is how
    // far the operator has walked into the frozen picture.
    const qa = this.qaFreeze || { frontZ: 6, travel: 0, glide: 0, frontOn: 0 };
    const qx = 1348, qw = 440, qh = 196, qy = 200;
    panel(c, qx, qy, qw, qh, {
      fill: css("ink2", 0.9), corner: 12, cornerColor: css("miku", 0.7),
      stroke: css("miku", 0.4),
    });
    label(c, "FREEZE / PARALLAX", qx + 16, qy - 8, {
      size: 17, tracking: 1.8, color: css("miku", 0.9),
    });
    const qrows = [
      ["FRONT", `${qa.frontZ.toFixed(1)} m`],
      ["LENS TRAVEL", `+${qa.travel.toFixed(1)} m`],
      ["OBJECTS HELD", `${pad(frozen, 5)}`],
      ["MOTION", qa.glide > 0.01 ? "PARALLAX ONLY" : "HOLD"],
    ];
    qrows.forEach(([k, v], i) => {
      const yy = qy + 44 + i * 38;
      label(c, k, qx + 16, yy, { size: 15, tracking: 1.4, color: css("ash", 0.85) });
      drawText(c, v, {
        x: qx + qw - 16, y: yy, size: 20, weight: 600, mono: true,
        align: "right", color: css("bone", 0.92),
      });
    });

    // The flatlined waveform, with the clamp bars. It is a scope window in
    // the middle of the corridor, not a stripe across it: the freeze is the
    // subject of this chapter, and the machine's flat line only gets the
    // 768 px it needs to say "0.000".
    const wx = 576, wy = 566, ww = 768, wh = 74;
    c.fillStyle = css("ink", 0.62);
    c.fillRect(wx - 12, wy - 20, ww + 24, wh + 40);
    c.strokeStyle = css("red", 0.28);
    c.lineWidth = 1;
    c.strokeRect(wx - 12.5, wy - 20.5, ww + 25, wh + 41);
    const amp = Math.max(0, 1 - easeOutCubic(clamp(local / 0.8)));
    wave(c, f.F, t, {
      x: wx, y: wy, w: ww, h: wh, span: 1.2, lw: 2,
      color: css("red", 0.30 + 0.22 * stop), amp: 0.25 + 1.1 * amp,
    });
    c.strokeStyle = css("red", 0.65);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(wx, wy + wh / 2);
    c.lineTo(wx + ww, wy + wh / 2);
    c.stroke();
    c.fillStyle = css("red", 0.55);
    c.fillRect(wx, wy - 12, ww, 3);
    c.fillRect(wx, wy + wh + 7, ww, 3);

    // the lines, set inside the mirror
    const active = f.line;
    if (active && active.kind !== "marker") {
      const fresh = clamp((t - active.start) / 0.4);
      c.save();
      c.globalAlpha = fresh;
      // The lyric sits lower here than in the other chapters: the clamp
      // readout owns the top-left corner, and at this shot's 1.12 zoom its cap
      // height would otherwise land on the "OBJECTS IN THE FREEZE" count.
      lyricLine(c, active, t, f.F, {
        x: 960, y: 458, size: 78, weight: 900, align: "center", maxWidth: 1560,
        sung: css("bone", 0.98), dim: css("ash", 0.55),
      });
      c.restore();
      // an echo, one beat behind and dimmer: the mirror still repeating
      const echo = f.F.lines[f.lineIndex - 1];
      if (echo) {
        c.save();
        c.globalAlpha = 0.28 * mirror;
        // The echo lives at the foot of the frame: the middle band belongs to
        // the corridor, and by the end of the walk the operator is standing in
        // the only mirror that answers, so nothing may be laid over it.
        drawText(c, echo.text, {
          x: 960, y: 986, size: 42, weight: 400, align: "center",
          color: css("miku", 0.7), tracking: 2,
        });
        c.restore();
      }
    }

    // what the mirror is made of
    const rows = [
      ["BELIEF", "REPEATED"],
      ["AUDIENCE", "0"],
      ["MIRROR", "ACTIVE"],
      ["REFUSED", "TRUE"],
    ];
    rows.forEach(([k, v], i) => {
      const ry = 760 + i * 46;
      label(c, k, 84, ry, { size: 17, color: css("ash", 0.85), tracking: 1.6 });
      label(c, v, 420, ry, { size: 17, align: "right", color: css("bone", 0.9), tracking: 1.6 });
      c.fillStyle = css("red", 0.5);
      c.fillRect(430, ry - 12, 90, 1);
    });
    // Both of the right-hand captions sit above the press, not across it:
    // the forearm and the palm own the lower right corner in this shot.
    label(c, "「\u90fd\u5408\u306e\u3044\u3044\u5984\u60f3\u3092 \u7e70\u308a\u8fd4\u3057\u6620\u3057\u51fa\u3059\u93e1」",
      1836, 700, { size: 24, align: "right", color: css("miku", 0.8), tracking: 1.5 });
    label(c, "REPLAYING  \u2014  REPEAT ALL", 1836, 736, {
      size: 17, align: "right", color: css("ash", 0.8), tracking: 2,
    });

    machineChrome(c, { name: "", left: "HALT", right: "OUTPUT 0.000 dBFS" });

    this.ctx.drawLayer(out, this.text, { mode: "normal" });
    return {
      bloom: 0.95,
      exposure: 1.0,
      grain: 0.035,
      vignette: 0.7,
      scan: 0.07,
      ca: 0.0014 + 0.0016 * stop,
      flash: 0.5 * Math.max(0, 1 - local / 0.35),
      flashColor: [0.9, 0.06, 0.1],
      shake: [0.006 * Math.max(0, 1 - local / 0.6), 0],
      invert: 0.12 * Math.max(0, 1 - local / 0.25),
    };
  }

  // The 3D half of the chapter: a corridor of mirrors, a grid, and debris that
  // stops moving the instant the brake fires. The world stops; the lens does
  // not. After one beat of held breath the operator starts walking forward
  // into the stopped frame, and the rest of the chapter is that walk: every
  // object keeps the position it had when the transport died, so the only
  // motion left in the picture is parallax. This is the scene's own operator
  // (grammar 7); the film's frame budget (src/camera.js) is untouched.
  //
  // Returns the number of instances the corridor actually drew, so the panel
  // can print a number that is true of this frame's geometry.
  hall(out, local, stop, t) {
    const aspect = this.ctx.W / this.ctx.H;
    const walk = clamp((local - 1.45) / 10.2);
    const glide = walk * walk * (3 - 2 * walk);      // smooth in, smooth out
    const travel = glide * 42;                       // metres walked into the freeze
    const eye = [
      Math.sin(local * 0.13) * 1.1 * (1 - glide),
      3.6 + Math.sin(local * 0.21) * 0.45 * (1 - glide) - 0.30 * glide,
      6.5 - travel,
    ];
    const at = [
      Math.sin(local * 0.07) * 0.9 * (1 - glide),
      3.30 - 0.25 * glide,
      eye[2] - 15,
    ];
    camera(this.vp, { eye, at, fov: 1.02, near: 0.2, far: 300, aspect });
    // readable by tools/air-probe.mjs: the walk this chapter is
    this.eyeNow = eye;

    // Grammar 7, the air. The corridor is 84 m of frames, hair and debris;
    // without a falloff the far mirrors are drawn at the weight of the near
    // ones and the room flattens into red wallpaper. The air is also the
    // ruler the walk is measured against: a thing stays bright while it is
    // still far, and is gone by the time the lens is inside it.
    const AIR = { eye, fog: { dist: 150, c: rgb("ink") } };
    // Anything this close has been walked past. Culling it keeps the walk
    // from ending in a wall of full-strength lines crossing the lens.
    const passed = (px, py, pz) => {
      const dx = px - eye[0], dy = py - eye[1], dz = pz - eye[2];
      return dx * dx + dy * dy + dz * dz < 0.81;
    };
    let held = 0;

    // mirror frames: each pane, then two recursions inside it
    let n = 0;
    for (let i = 0; i < 14; i++) {
      const z = -6 - i * 6;
      if (passed(0, 3.6, z)) continue;
      const fade = 0.86 * (1 - i / 22) * (1 - stop * 0.12);
      const stack = [
        [3.6, 2.3, 0.55],
        [2.3, 1.5, 0.34],
        [1.5, 1.0, 0.22],
      ];
      for (const [w, h, k] of stack) {
        n = writeInstance(this.frameData, n, {
          p: [0, 3.6, z], s: 1, scale: [w, h, 1],
          c: rgb(i % 4 === 0 ? "ash" : (i < 3 ? "mikuHi" : "miku")), a: fade * k,
        });
      }
    }
    // The terminal pane: the far end of the corridor is a mirror too, and it
    // is the only one in the room that never showed a fantasy. It brightens
    // as the walk approaches, because that is what the walk is for.
    const arrive = smoothstep(8.6, 11.4, local);
    if (!passed(0, 3.6, TERMINAL_Z)) {
      n = writeInstance(this.frameData, n, {
        p: [0, 3.6, TERMINAL_Z], s: 1, scale: [5.0, 3.2, 1],
        c: rgb("ash"), a: 0.16 + 0.20 * arrive,
      });
      n = writeInstance(this.frameData, n, {
        p: [0, 3.6, TERMINAL_Z + 0.05], s: 1, scale: [4.35, 2.75, 1],
        c: rgb("miku"), a: 0.05 + 0.13 * arrive,
      });
    }
    held += n;
    this.room.update(this.frameData, n).render(out, { ...AIR, vp: this.vp, opacity: 1 });

    // floor and ceiling grid: long lines down the corridor, cross lines
    n = 0;
    for (let i = -4; i <= 4; i++) {
      for (const y of [0.02, 7.4]) {
        n = writeInstance(this.gridData, n, {
          p: [i * 3.6, y, -38], s: 76, c: rgb("tealDeep"), a: y < 1 ? 0.86 : 0.50,
          r: [Math.PI / 2, 0, 0],
        });
      }
    }
    for (let i = 0; i < 16; i++) {
      const z = -2 - i * 5.4;
      for (const y of [0.02, 7.4]) {
        n = writeInstance(this.gridData, n, {
          p: [0, y, z], s: 16, c: rgb("tealDeep"), a: y < 1 ? 0.56 : 0.30,
          r: [0, 0, Math.PI / 2],
        });
      }
    }
    held += n;
    this.grid.update(this.gridData, n).render(out, { ...AIR, vp: this.vp });

    // ---- the stop front ---------------------------------------------------
    // One event, not a fade: a rectangular front leaves the lens and runs the
    // corridor in 2.4 s. Nothing else in the room is allowed to move after the
    // brake -- but the front is, and it is what the lens then walks after.
    const frontZ = 6 - 90 * clamp((local - 0.15) / 2.4);
    const frontOn = clamp(1 - (local - 0.15) / 3.0);
    if (frontOn > 0.004) {
      const fw = 5.35, fhh = 3.45, fy = 3.60;
      let fn = 0;
      for (const [a, b] of [
        [[-fw, fy - fhh, frontZ], [fw, fy - fhh, frontZ]],
        [[-fw, fy + fhh, frontZ], [fw, fy + fhh, frontZ]],
        [[-fw, fy - fhh, frontZ], [-fw, fy + fhh, frontZ]],
        [[fw, fy - fhh, frontZ], [fw, fy + fhh, frontZ]],
      ]) {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const L = Math.hypot(dx, dy, dz) || 1;
        fn = writeInstance(this.frontData, fn, {
          p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
          c: rgb("mikuHi"), a: 0.62 * frontOn,
          r: [-Math.asin(clamp(dz / L, -1, 1)), 0, Math.atan2(-dx, dy)],
          scale: [2.1, L / 2, 1],
        });
      }
      this.front.update(this.frontData, fn).render(out, { ...AIR, vp: this.vp, opacity: 1 });
    }

    // debris: frozen in mid-air once the brake is on. Each shard is drawn as a
    // stem plus two bars, so it reads as a hair / a note / a splinter instead
    // of a one-pixel line.
    const drift = 1 - stop;
    // A position hash over the freeze: the debris has no keyframe after
    // `stop`, so this number must not change while the lens keeps walking.
    // tools/brake-probe.mjs reads it frame by frame.
    let posHash = 2166136261 >>> 0;
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      const wob = Math.sin(t * 0.7 + s.phase) * drift;
      for (const q of [s.x + wob * 0.30, s.y + wob * 0.22, s.z + wob * 0.5]) {
        posHash = (Math.imul(posHash ^ (Math.round(q * 1000) | 0), 16777619)) >>> 0;
      }
    }
    n = 0;
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      const wob = Math.sin(t * 0.7 + s.phase) * drift;
      const warm = s.warm;
      const hot = s.note > 0.80 ? 1 : 0;
      const c = warm ? rgb("amber") : (s.note > 0.62 ? rgb("mikuHi") : rgb("miku"));
      // the front touches every shard as it passes: a shard lights up under
      // the wave, then keeps exactly the pose it was caught in
      const spark = frontOn * Math.exp(-Math.pow((s.z - frontZ) * 1.1, 2));
      const a = ((warm ? 0.62 : 0.48) * (0.6 + 0.4 * Math.sin(s.phase + i))
        * (0.30 + 0.70 * clamp(1 + s.z / 34)) + 0.42 * spark) * (1 + 0.70 * hot);
      const p = [s.x + wob * 0.30, s.y + wob * 0.22, s.z + wob * 0.5];
      if (passed(p[0], p[1], p[2])) continue;
      const r = [
        s.spin + drift * t * 0.4,
        s.phase + wob * 0.6,
        s.phase * 1.7 + drift * t * 0.25,
      ];
      n = writeInstance(this.shardData, n, { p, s: s.len * (1 + 0.55 * hot), c, a, r });
      // a second bar on the same point, crossing the stem: a hair end, a
      // splinter, or the beam of a note, depending on how it is read
      n = writeInstance(this.shardData, n, {
        p, s: s.len * 0.62, c, a: a * 0.7,
        r: [r[0] + 1.25, r[1] + 0.4, r[2] + 0.6], scale: [1.5, 1, 1],
      });
    }
    held += n;
    this.debris.update(this.shardData, n).render(out, { ...AIR, vp: this.vp, opacity: 1 });

    // ---- the hair ---------------------------------------------------------
    // Twelve strands laid out along the corridor, drawn as short segments with
    // one bright edge stroke. They do not move after the brake: the camera
    // walks through them like a projectionist through a stopped frame.
    n = 0;
    for (let i = 0; i < this.strands.length; i++) {
      const st = this.strands[i];
      const col = i % 4 === 0 ? rgb("mikuHi") : rgb("tealDeep");
      for (let j = 0; j < st.pts.length - 1; j++) {
        const p0 = st.pts[j], p1 = st.pts[j + 1];
        const z0 = p0[2];
        const z1 = p1[2];
        if (z0 > 8 || z1 > 8 || z0 < -80) continue;
        if (passed((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (z0 + z1) / 2)) continue;
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = z1 - z0;
        const L = Math.hypot(dx, dy, dz);
        if (L < 1e-4) continue;
        n = writeInstance(this.hairData, n, {
          p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (z0 + z1) / 2],
          c: col, a: 0.28 + 0.20 * (i % 3 === 0 ? 1 : 0.4), s: 1,
          r: [-Math.asin(clamp(dz / L, -1, 1)), 0, Math.atan2(-dx, dy)],
          scale: [1.6 + (i % 3), L / 2, 1],
        });
        n = writeInstance(this.hairData, n, {
          p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (z0 + z1) / 2],
          c: rgb("mikuHi"), a: 0.16, s: 1,
          r: [-Math.asin(clamp(dz / L, -1, 1)), 0, Math.atan2(-dx, dy)],
          scale: [0.7, L / 2, 1],
        });
      }
    }
    held += n;
    this.hairStage.update(this.hairData, n).render(out, { ...AIR, vp: this.vp });

    // ---- the notes --------------------------------------------------------
    // Thin plates standing in the air at the height of a staff, with a stem
    // below each one. Frozen mid-measure, on the moment the transport died.
    n = 0;
    for (let i = 0; i < this.noteSeeds.length; i++) {
      const q = this.noteSeeds[i];
      const z = q.z;
      if (z > 7 || z < -75) continue;
      const wob = Math.sin(t * 0.6 + q.phase) * drift;
      if (passed(q.x + wob * 0.4, q.y + wob * 0.3, z)) continue;
      const col = q.beam ? rgb("mikuHi") : rgb("miku");
      const a = 0.36 + 0.26 * Math.sin(q.phase + i * 1.7);
      n = writeInstance(this.noteData, n, {
        p: [q.x + wob * 0.4, q.y + wob * 0.3, z],
        s: q.s, c: col, a, scale: [1.35, 0.9, 1], r: [0, 0, q.phase],
      });
      n = writeInstance(this.noteData, n, {
        p: [q.x + wob * 0.4 + q.s * 0.55, q.y + wob * 0.3 + q.s * 1.15, z],
        s: q.s * 0.5, c: col, a: a * 0.8, scale: [0.16, 1.5, 1], r: [0, 0, 0],
      });
    }
    held += n;
    this.notes.update(this.noteData, n).render(out, { ...AIR, vp: this.vp, soft: 0.7, opacity: 0.9 });

    // ---- the streaks ------------------------------------------------------
    // The one thing the freeze cannot stop is the lens. Velocity smear is
    // laid down as short radial strokes, so the corridor reads as *fast* even
    // while every object in it is still.
    const v = glide;
    n = 0;
    if (v > 0.01) {
      for (let i = 0; i < 300; i++) {
        const h = (k) => {
          const s = Math.sin(i * 21.7 + k * 63.1) * 9753.13;
          return s - Math.floor(s);
        };
        const z = eye[2] - 1 - h(1) * 70;
        const ang = h(2) * Math.PI * 2;
        const rad = 0.7 + h(3) * 8.5;
        const len = 0.6 + h(4) * 4.2;
        n = writeInstance(this.streakData, n, {
          p: [eye[0] + Math.cos(ang) * rad, eye[1] - 0.15 + Math.sin(ang) * rad * 0.62, z],
          c: i % 7 === 0 ? rgb("mikuHi") : rgb("dim"),
          a: (0.05 + 0.10 * v) * (0.4 + 0.6 * h(5)),
          s: 1, r: [Math.PI / 2, 0, 0], scale: [0.6 + h(6), len, 1],
        });
      }
    }
    held += n;
    this.streaks.update(this.streakData, n).render(out, { ...AIR, vp: this.vp, opacity: 0.9 });

    // frozen glass: quads caught edge-on, the only large shapes in the air
    n = 0;
    for (let i = 0; i < this.glass.length; i++) {
      const g = this.glass[i];
      const wob = Math.sin(t * 0.5 + g.phase) * drift;
      if (passed(g.x + wob * 0.4, g.y + wob * 0.5, g.z + wob * 0.6)) continue;
      n = writeInstance(this.glassData, n, {
        p: [g.x + wob * 0.4, g.y + wob * 0.5, g.z + wob * 0.6],
        s: 1,
        scale: [g.w, g.hgt, 1],
        c: rgb(i % 3 ? "ash" : "mikuHi"),
        a: 0.26 + 0.16 * Math.sin(g.phase + i),
        r: [g.rot[0] + wob * 0.2, g.rot[1], g.rot[2]],
      });
    }
    held += n;
    this.glassMesh.update(this.glassData, n).render(out, { ...AIR, vp: this.vp });
    // Two static points at the same lateral offset, 48 m apart on the axis,
    // projected through this frame's own camera: the near one has to sweep the
    // frame while the far one barely moves. This is the chapter's definition
    // of "the world stopped, the lens did not".
    const pn = project(this.vp, [3.0, 3.6, -8], this.ctx.W, this.ctx.H);
    const pf = project(this.vp, [3.0, 3.6, -56], this.ctx.W, this.ctx.H);
    this.qaFreeze = {
      eyeZ: eye[2], travel, glide, frontZ, frontOn, held, hash: posHash,
      near: [pn[0], pn[1]], far: [pf[0], pf[1]],
      nearW: pn[2], farW: pf[2], nearZ: -8, farZ: -56,
    };
    return held;
  }
}
