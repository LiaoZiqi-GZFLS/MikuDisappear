// Audit how much the frame actually moves, chapter by chapter.
//
//   node tools/camera-report.mjs          # table
//   node tools/camera-report.mjs --middle # only the lyric chapters
//   node tools/camera-report.mjs --check  # regression gate
//
// The language this gate protects: a shot may move slowly for its whole
// length (a phrase-scale push, pull or drift), but the frame may never jump
// between neighbouring frames. The two columns that matter are the last two:
// `per-frame` is what the eye reads as a stutter or a strobe. A deliberate
// per-line re-composition (`step: "line"`, used in overdrive) is the one place
// where a single, isolated jump is allowed, and only at a lyric boundary.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildShots, camAt } from "../src/camera.js";
import { resolveTimeline } from "../src/engine.js";
import { TIMELINE_SPEC } from "../src/timeline.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "data/analysis.json"), "utf8"));
const lines = JSON.parse(fs.readFileSync(path.join(ROOT, "data/lyrics.json"), "utf8")).lines;
const F = { lines, sections: analysis.sections, duration: analysis.duration };
const timeline = resolveTimeline(TIMELINE_SPEC, F);
const table = buildShots(F, timeline);
const onlyMiddle = process.argv.includes("--middle");
const MIDDLE = new Set([
  "resonance", "garble", "memory", "countdown", "brake",
  "overdrive", "plea", "beg", "erode", "compress", "final",
]);

const lineIndexAt = (t) => {
  let idx = 0;
  for (let i = 0; i < lines.length; i++) if (t >= lines[i].start) idx = i;
  return idx;
};

// A loud, realistic frame: the kick is firing and the lyric counter is where
// it really is, so a per-line re-composition is measured, not hidden.
const frameAt = (t) => {
  const beat = Math.floor(t / 0.25) + t * 0;
  return {
    kick: 0.9, snare: 0.4, vox: 0.6,
    beat, beatPhase: (t / 0.25) % 1, bar: beat / 4,
    lineIndex: lineIndexAt(t), F,
  };
};

// Movement budget per chapter class. `pan`/`zoom`/`roll` cap the whole-chapter
// spread (how far the frame travels); `dPan`/`dZoom` cap the largest step
// between two neighbouring frames at 30 fps (how fast it moves).
function budgetFor(id) {
  if (id === "wake" || id === "brake") {
    return { pan: 90, zoom: 0.26, roll: 2.6, dPan: 16, dZoom: 0.05 };
  }
  if (id === "overdrive") {
    // the only chapter allowed per-line re-composition
    return { pan: 80, zoom: 0.09, roll: 2.0, dPan: 14, dZoom: 0.03 };
  }
  if (id === "boot" || id === "birth" || id === "final" || id === "lastwords") {
    return { pan: 70, zoom: 0.12, roll: 2.0, dPan: 6, dZoom: 0.03 };
  }
  return { pan: 45, zoom: 0.075, roll: 1.2, dPan: 5, dZoom: 0.03 };
}

console.log("chapter      pan x      pan y      zoom            roll     step    per-frame 30fps");
const fails = [];
for (const e of timeline) {
  if (onlyMiddle && !MIDDLE.has(e.id)) continue;
  const x = [1e9, -1e9], y = [1e9, -1e9], z = [1e9, -1e9], r = [1e9, -1e9];
  const B = (a, v) => { a[0] = Math.min(a[0], v); a[1] = Math.max(a[1], v); };
  // the "per-frame" column is the thing that actually reads as strobing: a
  // 4 Hz zoom pulse shows up here as a large delta between neighbouring frames
  let dPan = 0, dZoom = 0, prev = null, step = "-";
  for (let t = e.t0; t < e.t1; t += 1 / 30) {
    const c = camAt(table, e, t, frameAt(t));
    B(x, c.x); B(y, c.y); B(z, c.z); B(r, c.r);
    if (c.step) step = c.step;
    if (prev) {
      dPan = Math.max(dPan, Math.abs(c.x - prev.x) * 1920, Math.abs(c.y - prev.y) * 1080);
      dZoom = Math.max(dZoom, Math.abs(c.z - prev.z));
    }
    prev = c;
  }
  const sp = (a) => a[1] - a[0];
  const px = (v) => (v * 1920).toFixed(1).padStart(5);
  console.log(
    e.id.padEnd(12),
    `${px(sp(x))}px  ${px(sp(y))}px  ${z[0].toFixed(3)}–${z[1].toFixed(3)}  ${sp(r).toFixed(2).padStart(5)}°  ` +
    `${step.padEnd(6)}  ${dPan.toFixed(2)}px ${(dZoom * 100).toFixed(3)}%`,
  );

  const budget = budgetFor(e.id);
  const over = [];
  if (sp(x) * 1920 > budget.pan) over.push(`pan x ${(sp(x) * 1920).toFixed(1)}px`);
  if (sp(y) * 1080 > budget.pan) over.push(`pan y ${(sp(y) * 1080).toFixed(1)}px`);
  if (sp(z) > budget.zoom) over.push(`zoom ${sp(z).toFixed(3)}`);
  if (sp(r) > budget.roll) over.push(`roll ${sp(r).toFixed(2)}°`);
  if (dZoom > budget.dZoom) over.push(`per-frame zoom ${(dZoom * 100).toFixed(2)}%`);
  if (dPan > budget.dPan) over.push(`per-frame pan ${dPan.toFixed(1)}px`);
  if (over.length) fails.push(`${e.id}: ${over.join(", ")}`);
}

if (process.argv.includes("--check")) {
  if (fails.length) {
    console.log("\nCAMERA BUDGET EXCEEDED");
    for (const f of fails) console.log("  " + f);
    process.exit(1);
  }
  console.log("\ncamera budget ok");
}
