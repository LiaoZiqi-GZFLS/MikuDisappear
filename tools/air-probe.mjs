// Probe: render one chapter's frames and report pixel brightness and the
// scene's own camera state, so a broken 3D pass can be told from a dark one.
//
//   node tools/air-probe.mjs --times 42,45,48 --out out/probe-air

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const EDGE = process.env.MV_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = path.resolve(opt("out", "out/probe-air"));
const times = (opt("times", "42,45,48,51,53,55,56.5")).split(",").map(Number);
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(e.message));

await page.goto("http://localhost:5173/?ui=0&veil=0&hud=0&scale=1", { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

for (const t of times) {
  const info = await page.evaluate(async (tt) => {
    const mv = window.__mv;
    mv.renderFrame(tt, false);
    const e = mv.engine;
    // the chapter containing tt, from the engine's own resolved timeline
    const entry = e.timeline.find((x) => tt >= x.t0 && tt < x.t1);
    const scene = entry ? e.scenes.get(entry.scene) : null;
    const c = document.getElementById("stage");
    const gl = c.getContext("webgl2");
    const px = new Uint8Array(4 * 64 * 64);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, max = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
      sum += l;
      if (l > max) max = l;
    }
    return {
      t: tt,
      sceneId: entry ? entry.scene : "?",
      corner: [px[0], px[1], px[2]],
      avg: +(sum / (px.length / 4)).toFixed(2),
      max,
      eye: scene && scene.eyeNow ? scene.eyeNow.map((v) => +v.toFixed(1)) : null,
      // `rig` is a CamRig only in some chapters; elsewhere it is a Stage3D
      // (overdrive's pantograph), which has no eye to report.
      rigEye: scene && scene.rig && scene.rig.eye
        ? scene.rig.eye.map((v) => +v.toFixed(1)) : null,
      probe: scene && scene.qaProbe ? {
        A: scene.qaProbe.A.map((v) => +v.toFixed(1)),
        B: scene.qaProbe.B.map((v) => +v.toFixed(1)),
      } : null,
      // the scene's own 3D operator, sampled in its own frame (see the
      // "scene camera" budget note in docs/制作日志.md)
      cam: scene && scene.lastCam ? {
        eye: scene.lastCam.eye.map((v) => +v.toFixed(2)),
        at: scene.lastCam.at.map((v) => +v.toFixed(2)),
        fov: +scene.lastCam.fov.toFixed(3),
      } : null,
      vp: scene && scene.vp ? Array.from(scene.vp).map((v) => +v.toFixed(3)) : null,
    };
  }, t);
  console.log(JSON.stringify(info));
  const file = path.join(OUT, `t${t.toFixed(2).padStart(7, "0")}.png`);
  await page.screenshot({ path: file });
}
if (problems.length) console.log("problems:", [...new Set(problems)].slice(0, 6));
else console.log("no browser errors");
await browser.close();
