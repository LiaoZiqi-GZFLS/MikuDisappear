// Shared bits for scene modules.

import { Layer2D } from "../layer.js";
import { W, H } from "../engine.js";

export function layer(ctx, opts = {}) {
  return new Layer2D(ctx.gl, W, H, { scale: ctx.scale, ...opts });
}

// Uniform block every scene can hand to its shader; unused names are ignored.
export function audioU(f, extra = {}) {
  return {
    uT: f.t,
    uRes: [W, H],
    uRms: f.a.rms,
    uLow: f.a.low,
    uMid: f.a.mid,
    uHigh: f.a.high,
    uVocal: f.a.vocal,
    uFlux: f.a.flux,
    uCentroid: f.a.centroid,
    uKick: f.kick,
    uSnare: f.snare,
    uHat: f.hat,
    uVox: f.vox,
    uPulse: f.pulse,
    uBeat: f.beatPhase,
    uBar: f.barPhase,
    uLocal: f.lt,
    uProg: f.p,
    ...extra,
  };
}

// A line of the song, resolved by content (never by hard-coded time).
export function line(F, needle) {
  const l = F.lines.find((x) => x.text.includes(needle));
  if (!l) throw new Error(`lyric not found: ${needle}`);
  return l;
}

export function lines(F, ...needles) {
  return needles.map((n) => line(F, n));
}

// The song repeats some markers (the emergency stop fires twice); scenes that
// need the later occurrence ask for it explicitly.
export function lastLine(F, needle) {
  const hits = F.lines.filter((x) => x.text.includes(needle));
  if (!hits.length) throw new Error(`lyric not found: ${needle}`);
  return hits[hits.length - 1];
}
