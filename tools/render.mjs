// Offline export: renders every frame through the same code the player runs.
//
//   node tools/render.mjs --out out/mv.mp4                    full film
//   node tools/render.mjs --from 103 --to 118 --out clip.mp4  one passage
//   node tools/render.mjs --frames out/f --from 30 --to 32    PNG sequence
//
// Two pipelines, both bit-for-bit identical in the *picture* (the frames come
// from the same renderFrame(t)); they differ in how a frame leaves the page:
//
//   webcodecs  canvas → VideoFrame → VideoEncoder (hardware, e.g. NVENC) →
//              Annex-B stream → ffmpeg muxes it with the audio (-c:v copy).
//              ~17 ms/frame on an RTX 50-series machine.
//   png        canvas → PNG → base64 → ffmpeg decodes PNG → x264/NVENC.
//              ~90 ms/frame, because the browser's PNG encoder is the
//              bottleneck, not the video encoder.
//
// `--pipeline auto` (the default) uses webcodecs when the browser exposes a
// hardware H.264 encoder and falls back to the PNG path otherwise.
//
// Encoding knobs
//   webcodecs:  --bitrate 40   (Mbps, VBR quality mode; 40 ≈ 60 Mbps actual
//                                on this content — use 6 for a web copy)
//               --codec avc1.640028 | av01.0.08M.08
//               --key 2        (seconds between keyframes)
//   png:        --encoder auto|libx264|h264_nvenc|hevc_nvenc|av1_nvenc
//               --quality N    (libx264 CRF, default 16 · NVENC CQ, default 19)
//               --preset X     (x264 preset, or NVENC p1..p7)
//
// libx264 is the only fully reproducible encoder (hardware encoders are
// driver-specific), so keep a PNG+libx264 master when bit-exactness matters.
//
// Start `node server.mjs 5173` first (or pass --port).

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf("--" + n);
  return i >= 0 ? args[i + 1] : d;
};
const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = opt("port", "5173");
const FPS = Number(opt("fps", 30));
const SCALE = Number(opt("scale", 1));
// Defaults come from the page itself (window.__mv.duration = song + tail), so
// the exporter never has to be told where the film now ends.
const DURATION_OPT = opt("duration", null);
const FROM = Number(opt("from", 0));
const TO_OPT = opt("to", null);
const OUT = path.resolve(opt("out", "out/mv.mp4"));
const FRAME_DIR = opt("frames", null);
const HUD = opt("hud", "1") === "1";

// pipeline / encoder options
const PIPELINE = opt("pipeline", "auto");            // auto | webcodecs | png
const CODEC = opt("codec", "avc1.640028");           // webcodecs codec string
const BITRATE = Number(opt("bitrate", 40)) * 1e6;    // webcodecs target, bps
const KEY = Number(opt("key", 2)) * FPS;             // frames between keyframes
const ENCODER_OPT = opt("encoder", "auto");          // png pipeline
const CRF = opt("crf", opt("quality", null));        // libx264 CRF / NVENC CQ
const PRESET_OPT = opt("preset", null);

const SONG = path.resolve(
  "\u521d\u97f3\u30df\u30af,cosMo@\u66b4\u8d70P - \u521d\u97f3\u30df\u30af\u306e\u6d88\u5931.mp3");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (FRAME_DIR) fs.mkdirSync(FRAME_DIR, { recursive: true });

// ---------------------------------------------------------- cpu/gpu encoders
function hasEncoder(name) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
  return !r.error && new RegExp(`\\b${name}\\b`).test(r.stdout || "");
}

function pickEncoder() {
  if (ENCODER_OPT !== "auto") return ENCODER_OPT;
  for (const name of ["h264_nvenc", "h264_qsv", "h264_amf"]) {
    if (hasEncoder(name)) return name;
  }
  return "libx264";
}

function encoderArgs(encoder) {
  const quality = CRF ?? (encoder.startsWith("lib") ? 16 : 19);
  switch (encoder) {
    case "libx264":
      return ["-c:v", "libx264", "-preset", PRESET_OPT || "medium",
        "-crf", String(quality), "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
    case "h264_nvenc":
      return ["-c:v", "h264_nvenc", "-preset", PRESET_OPT || "p6", "-tune", "hq",
        "-rc", "vbr", "-cq", String(quality), "-b:v", "0",
        "-bf", "3", "-b_ref_mode", "middle",
        "-spatial-aq", "1", "-temporal-aq", "1", "-multipass", "fullres",
        "-rc-lookahead", "32", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
    case "hevc_nvenc":
      return ["-c:v", "hevc_nvenc", "-preset", PRESET_OPT || "p6", "-tune", "hq",
        "-rc", "vbr", "-cq", String(quality), "-b:v", "0",
        "-bf", "3", "-b_ref_mode", "middle", "-spatial-aq", "1",
        "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
    case "av1_nvenc":
      return ["-c:v", "av1_nvenc", "-preset", PRESET_OPT || "p6", "-tune", "hq",
        "-rc", "vbr", "-cq", String(quality), "-b:v", "0",
        "-spatial-aq", "1", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
    default:
      return ["-c:v", encoder, "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  }
}

// ------------------------------------------------------------------- browser
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0&hud=${HUD ? 1 : 0}&scale=${SCALE}`, {
  waitUntil: "load",
  timeout: 60000,
});
await page.waitForSelector("body[data-ready='1']", { timeout: 120000, state: "attached" });

const pageDuration = await page.evaluate(() => window.__mv.duration);
const DURATION = DURATION_OPT != null ? Number(DURATION_OPT) : pageDuration;
const TO = TO_OPT != null ? Number(TO_OPT) : DURATION;
const total = Math.max(1, Math.round((TO - FROM) * FPS));

// Ask the page what it can encode before deciding on a pipeline.
let canWebCodecs = false;
if (!FRAME_DIR && PIPELINE !== "png") {
  canWebCodecs = await page.evaluate(async ({ codec, fps, bitrate }) => {
    if (typeof VideoEncoder === "undefined") return false;
    try {
      const s = await VideoEncoder.isConfigSupported({
        codec, width: 1920, height: 1080, framerate: fps, bitrate,
        bitrateMode: "variable", latencyMode: "quality",
        hardwareAcceleration: "prefer-hardware", avc: { format: "annexb" },
      });
      return !!s.supported;
    } catch { return false; }
  }, { codec: CODEC, fps: FPS, bitrate: BITRATE });
}
const useWebCodecs = canWebCodecs;
if (PIPELINE === "webcodecs" && !useWebCodecs) {
  console.error("webcodecs pipeline requested but no hardware encoder is available");
  await browser.close();
  process.exit(1);
}

console.log(`ready — ${total} frames at ${FPS} fps (${FROM}s → ${TO}s), ` +
  `pipeline ${FRAME_DIR ? "png files" : useWebCodecs ? "webcodecs" : "png"}`);

// ------------------------------------------------------------------- ffmpeg
let ff;
if (!FRAME_DIR && useWebCodecs) {
  // The browser already encoded: ffmpeg only muxes the Annex-B stream + audio.
  // No `-shortest` here: an elementary H.264 stream carries no timestamps, and
  // ffmpeg's shortest-output logic would then drop the audio track entirely.
  ff = spawn("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-fflags", "+genpts", "-f", "h264", "-framerate", String(FPS), "-i", "-",
    "-ss", String(FROM), "-i", SONG, "-t", String(TO - FROM),
    "-c:v", "copy", "-c:a", "aac", "-b:a", "320k",
    "-movflags", "+faststart", OUT,
  ], { stdio: ["pipe", "inherit", "inherit"] });
} else if (!FRAME_DIR) {
  const encoder = pickEncoder();
  console.log(`encoder: ${encoder}${encoder === "libx264" ? " (cpu)" : " (hardware)"}`);
  ff = spawn("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-ss", String(FROM), "-i", SONG, "-t", String(TO - FROM),
    ...encoderArgs(encoder),
    // apad + shortest: the credits tail is longer than the song, so the audio
    // is padded with silence instead of cutting the picture short.
    "-af", "apad", "-c:a", "aac", "-b:a", "320k", "-shortest", OUT,
  ], { stdio: ["pipe", "inherit", "inherit"] });
}
if (ff) {
  ff.on("close", (code) => {
    if (code === 0) console.log("wrote", OUT);
    else console.error("ffmpeg exited", code);
  });
}

const wall0 = Date.now();

if (useWebCodecs) {
  // ------------------------------------------------------ webcodecs pipeline
  let bytes = 0;
  await page.exposeBinding("__pushChunk", async (_src, chunk) => {
    const buf = Buffer.from(chunk);
    bytes += buf.length;
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  });

  const progress = page.evaluate(async ({ from, fps, total, codec, bitrate, key }) => {
    const canvas = document.getElementById("stage");
    const config = {
      codec, width: 1920, height: 1080, framerate: fps, bitrate,
      bitrateMode: "variable", latencyMode: "quality",
      hardwareAcceleration: "prefer-hardware", avc: { format: "annexb" },
    };
    let error = null;
    let done = 0;
    const enc = new VideoEncoder({
      output: async (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        await window.__pushChunk(data);
      },
      error: (e) => { error = String(e && e.message || e); },
    });
    enc.configure(config);
    for (let i = 0; i < total; i++) {
      window.__mv.renderFrame(from + i / fps, true);
      const vf = new VideoFrame(canvas, {
        timestamp: Math.round((i / fps) * 1e6),
        duration: Math.round(1e6 / fps),
      });
      enc.encode(vf, { keyFrame: i % key === 0 });
      vf.close();
      done = i + 1;
      window.__progress = done;
      // keep the encoder queue shallow so the pipe stays the only buffer
      while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
      if (error) throw new Error(error);
    }
    await enc.flush();
    enc.close();
    return done;
  }, { from: FROM, fps: FPS, total, codec: CODEC, bitrate: BITRATE, key: KEY });

  const tick = setInterval(async () => {
    try {
      const i = await page.evaluate(() => window.__progress || 0);
      const done = i / total;
      const secs = (Date.now() - wall0) / 1000;
      process.stdout.write(`\r${(done * 100).toFixed(1)}%  frame ${i}/${total}  ` +
        `eta ${((secs / Math.max(done, 1e-3) - secs) / 60).toFixed(1)} min   `);
    } catch { /* page busy */ }
  }, 2000);

  await progress;
  clearInterval(tick);
  console.log(`\r100.0%  frame ${total}/${total}                    `);
  console.log(`stream: ${(bytes / 1e6).toFixed(1)} MB, ` +
    `${(bytes / total / 1024).toFixed(0)} KB/frame, ` +
    `${((bytes * 8) / ((Date.now() - wall0) / 1000) / 1e6).toFixed(1)} Mbps`);
} else {
  // ------------------------------------------------------------ png pipeline
  for (let i = 0; i < total; i++) {
    const t = FROM + i / FPS;
    const dataUrl = await page.evaluate(
      (tt) => { window.__mv.renderFrame(tt, true); return document.getElementById("stage").toDataURL("image/png"); },
      t,
    );
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    if (FRAME_DIR) {
      fs.writeFileSync(path.join(FRAME_DIR, `f${String(i).padStart(6, "0")}.png`), buf);
    } else if (!ff.stdin.write(buf)) {
      await new Promise((r) => ff.stdin.once("drain", r));
    }
    if (i % 10 === 0 || i === total - 1) {
      const done = (i + 1) / total;
      const secs = (Date.now() - wall0) / 1000;
      process.stdout.write(`\r${(done * 100).toFixed(1)}%  frame ${i + 1}/${total}  ` +
        `eta ${((secs / done - secs) / 60).toFixed(1)} min   `);
    }
  }
  console.log("");
}

const wall = (Date.now() - wall0) / 1000;
console.log(`timing: wall ${wall.toFixed(1)}s (${(total / wall).toFixed(2)} fps out)`);
if (ff) {
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
}
await browser.close();
