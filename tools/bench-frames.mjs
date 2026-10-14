// Where does an export actually spend its time?
//
//   node tools/bench-frames.mjs --n 20
//
// Compares the ways a frame can leave the page: PNG, JPEG, raw WebGL pixels,
// and a Playwright screenshot. Run this before optimising ffmpeg — on most
// machines the encoder is a rounding error next to the browser's PNG encode
// and the base64 transfer.

import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf("--" + n);
  return i >= 0 ? args[i + 1] : d;
};
const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = opt("port", "5173");
const N = Number(opt("n", 20));
const T0 = Number(opt("from", 100));

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0&hud=1&scale=1`, { waitUntil: "load" });
await page.waitForSelector("body[data-ready='1']", { timeout: 120000, state: "attached" });
await page.addScriptTag({
  content: `
    window.__bench = {
      raw(step) {
        const t = ${T0} + step / 30;
        window.__mv.renderFrame(t, true);
        const c = document.getElementById("stage");
        const gl = c.getContext("webgl2");
        const px = new Uint8Array(c.width * c.height * 4);
        gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
        // base64 in chunks: String.fromCharCode.apply dies on 8 MB
        let s = "";
        const CH = 0x8000;
        for (let i = 0; i < px.length; i += CH) {
          s += String.fromCharCode.apply(null, px.subarray(i, i + CH));
        }
        return btoa(s).length;
      },
      async codec(config) {
        if (typeof VideoEncoder === "undefined") return { ok: false, why: "no WebCodecs" };
        const support = await VideoEncoder.isConfigSupported(config).catch((e) => ({ supported: false, error: String(e) }));
        return { ok: !!support.supported, support: support.config || null, why: support.error || "" };
      },
      async encode(config, frames) {
        // canvas -> VideoFrame -> VideoEncoder, hardware preferred: the frame
        // never has to be copied out of the page as pixels at all
        let bytes = 0, chunks = 0, key = 0;
        const enc = new VideoEncoder({
          output: (chunk) => { bytes += chunk.byteLength; chunks++; if (chunk.type === "key") key++; },
          error: (e) => { throw e; },
        });
        enc.configure(config);
        const c = document.getElementById("stage");
        const t0 = performance.now();
        for (let i = 0; i < frames; i++) {
          window.__mv.renderFrame(100 + i / 30, true);
          const vf = new VideoFrame(c, { timestamp: Math.round((i / 30) * 1e6), duration: 33333 });
          enc.encode(vf, { keyFrame: i % 60 === 0 });
          vf.close();
        }
        await enc.flush();
        enc.close();
        const ms = performance.now() - t0;
        return { ms, bytes, chunks, key, mbps: (bytes * 8) / (ms / 1000) / 1e6 };
      },
    };
  `,
});

const bench = async (name, fn) => {
  await fn(0);                       // warm up
  const t = Date.now();
  for (let i = 0; i < N; i++) await fn(i);
  const ms = (Date.now() - t) / N;
  console.log(`${name.padEnd(30)} ${ms.toFixed(1).padStart(6)} ms/frame   ${(1000 / ms).toFixed(1)} fps`);
  return ms;
};

const renderOnly = await bench("renderFrame()", (i) =>
  page.evaluate((t) => { window.__mv.renderFrame(t, true); }, T0 + i / 30));

const png = await bench("render + toDataURL(png)", (i) =>
  page.evaluate((t) => {
    window.__mv.renderFrame(t, true);
    return document.getElementById("stage").toDataURL("image/png").length;
  }, T0 + i / 30));

const jpg = await bench("render + toDataURL(jpeg .95)", (i) =>
  page.evaluate((t) => {
    window.__mv.renderFrame(t, true);
    return document.getElementById("stage").toDataURL("image/jpeg", 0.95).length;
  }, T0 + i / 30));

const raw = await bench("render + readPixels + base64", (i) =>
  page.evaluate((s) => window.__bench.raw(s), i));

const shot = await bench("page.screenshot(png clip)", async (i) => {
  await page.evaluate((t) => window.__mv.renderFrame(t, true), T0 + i / 30);
  await page.screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 }, type: "png" });
});

// ---------------------------------------------------------------- WebCodecs
const CANDIDATES = [
  ["avc1.640028", "h264"],
  ["avc1.4d0032", "h264"],
  ["hvc1.1.6.L120.90", "hevc"],
  ["av01.0.08M.08", "av1"],
];
console.log("\nWebCodecs hardware encoders");
let best = null;
for (const [codec] of CANDIDATES) {
  const config = {
    codec, width: 1920, height: 1080, bitrate: 45_000_000, framerate: 30,
    bitrateMode: "variable", latencyMode: "quality",
    hardwareAcceleration: "prefer-hardware",
    avc: { format: "annexb" },
  };
  const r = await page.evaluate((c) => window.__bench.codec(c), config);
  console.log(`  ${codec.padEnd(20)} ${r.ok ? "supported" : "NO " + (r.why || "")}`);
  if (r.ok && !best) best = { codec, config };
}
if (best) {
  const r = await page.evaluate(([c, n]) => window.__bench.encode(c, n), [best.config, N]);
  console.log(`\n  encode ${best.codec}: ${(r.ms / N).toFixed(1)} ms/frame  ` +
    `${(1000 * N) / r.ms} fps  ${(r.bytes / N / 1024).toFixed(0)} KB/frame  ` +
    `${r.mbps.toFixed(1)} Mbps  (${r.key} keyframes)`);
  console.log(`  total pipeline with WebCodecs ≈ ${((r.ms / N) + 0.5).toFixed(1)} ms/frame ` +
    `(vs ${png.toFixed(1)} ms with PNG)`);

  // rate-control variants: a master wants ~40 Mbps, not 110
  console.log("\n  rate control (20 frames each)");
  for (const [label, over] of [
    ["vbr 40M quality", { bitrate: 40_000_000, bitrateMode: "variable", latencyMode: "quality" }],
    ["vbr 20M quality", { bitrate: 20_000_000, bitrateMode: "variable", latencyMode: "quality" }],
    ["cbr 40M quality", { bitrate: 40_000_000, bitrateMode: "constant", latencyMode: "quality" }],
    ["quantizer quality", { bitrateMode: "quantizer", latencyMode: "quality" }],
  ]) {
    const cfg = { ...best.config, ...over };
    const ok = await page.evaluate((c) => window.__bench.codec(c), cfg);
    if (!ok.ok) { console.log(`    ${label.padEnd(18)} not supported`); continue; }
    const rr = await page.evaluate(([c, n]) => window.__bench.encode(c, n), [cfg, N]);
    console.log(`    ${label.padEnd(18)} ${(rr.ms / N).toFixed(1)} ms/frame  ` +
      `${(rr.bytes / N / 1024).toFixed(0)} KB/frame  ${rr.mbps.toFixed(1)} Mbps`);
  }
}

const overhead = (ms) => `  (+${(ms - renderOnly).toFixed(1)} ms over render)`;
console.log("\nframe extraction cost" + overhead(png));
console.log(`  png ${(png - renderOnly).toFixed(1)} ms · jpeg ${(jpg - renderOnly).toFixed(1)} ms · ` +
  `raw ${(raw - renderOnly).toFixed(1)} ms · screenshot ${(shot - renderOnly).toFixed(1)} ms`);
await browser.close();
