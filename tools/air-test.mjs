// Offline check of the camera rig's matrix maths (no browser): build the same
// way CamRig does and print a projected wire, so a black frame can be told
// from a bad matrix in one second.
//
//   node tools/air-test.mjs

import { ASPECT, CamRig, project } from "../src/gl3d.js";

const rig = new CamRig([
  { u: 0, ease: "lin", eye: [-291.6, 13, -1.8], at: [-243, 8.9, -26.1], fov: 1.02, roll: 0 },
  { u: 1, ease: "lin", eye: [35, 28.9, -81.9], at: [35.5, 20.2, -96.9], fov: 1.04, roll: 0.4 },
]);
const W = 1920, H = 1080;
for (const u of [0, 0.5, 1]) {
  const s = rig.eval(u, ASPECT);
  const A = project(rig.vp, [-320, 8.4, -26], W, H);
  const B = project(rig.vp, [46, 1.6, -96], W, H);
  console.log(u.toFixed(1), "eye", s.eye.map((v) => v.toFixed(1)).join(","));
  console.log("  A", A.map((v) => v.toFixed(1)).join(","), " B", B.map((v) => v.toFixed(1)).join(","));
}
