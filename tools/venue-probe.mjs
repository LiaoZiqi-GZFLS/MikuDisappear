// One-off probe: where does the bowl actually land on screen?
//   node tools/venue-probe.mjs --times 232,245,262 --scene final
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf("--" + n);
  return i >= 0 ? args[i + 1] : d;
};
const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = opt("port", "5173");
const times = (opt("times", "232,245,262")).split(",").map(Number);
const scene = opt("scene", "final");
const skip = (opt("skip", "") || "").split(",").filter(Boolean);
const OUT = opt("out", "");

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0&hud=0`, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

for (const t of times) {
  const info = await page.evaluate(async ({ tt, sceneName, skipList }) => {
    const mv = window.__mv;
    mv.renderFrame(tt, false);
    const s = mv.engine.scenes.get(sceneName).stadium;
    for (const name of skipList) {
      if (typeof s[name] === "function") s[name] = () => {};
    }
    if (skipList.length) mv.renderFrame(tt, false);
    const { project } = await import("/src/gl3d.js");
    const W = 1920, H = 1080;
    const rows = [0, 8, 16, 24, 31];
    const out = {
      total: s.total,
      counts: Array.from(s.counts).slice(0, 3).concat(Array.from(s.counts).slice(-1)),
      rowPix: rows.map((r) => +s.rowPix[r].toFixed(2)),
      litRows: s.litRows,
      cols: {},
    };
    const put = (name, p) => {
      const q = project(s.vp, p, W, H);
      out.cols[name] = [+q[0].toFixed(0), +q[1].toFixed(0), +q[2].toFixed(1)];
    };
    for (const r of rows) {
      const i = Math.floor(s.counts[r] / 2);
      const c = s.seat(r, i);
      put(`c${r}`, [c.x, c.y + 2.0, c.z]);
      const e = s.seat(r, 0);
      put(`l${r}`, [e.x, e.y + 2.0, e.z]);
      const e2 = s.seat(r, s.counts[r] - 1);
      put(`r${r}`, [e2.x, e2.y + 2.0, e2.z]);
    }
    put("stage", [0, 3, -6]);
    put("screenTL", [-15, 11.4, -15.5]);
    put("screenBR", [15, 1.8, -15.5]);
    return out;
  }, { tt: t, sceneName: scene, skipList: skip });
  console.log(`t=${t}`, JSON.stringify(info));
  if (OUT) await page.screenshot({ path: `${OUT}/probe-${t}.png` });
}
await browser.close();
