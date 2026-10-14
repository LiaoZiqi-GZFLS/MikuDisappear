// Removes the throwaway artifacts this project generates while working:
// QA stills, test frame sequences and preview clips. Run with --dry to list.
//
//   node tools/clean.mjs --dry
//   node tools/clean.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dry = process.argv.includes("--dry");
const KEEP = new Set([
  "miku-no-shoushitsu_mv_1080p30.mp4",
  "clip-emergency-stop.mp4",
  "verify",
]);

const targets = [];
const outDir = path.join(ROOT, "out");

function walk(dir, rel = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const top = r.split("/")[0];
      if (KEEP.has(top)) continue;
      walk(full, r);
      targets.push(full);
    } else if (!KEEP.has(r.split("/")[0])) {
      targets.push(full);
    }
  }
}

if (fs.existsSync(outDir)) walk(outDir);

// one-off development probes and the truncated font download
for (const rel of [
  "tools/_diag.py", "tools/_plot.py", "tools/_grid.py", "tools/_accent.py",
  "tools/_beats.png", "tools/_dbgtext.mjs", "tools/_dbglayer.mjs",
  "tools/_playtest.mjs", "tools/__pycache__",
  "src/scenes/_stub.js",
  "assets/fonts/IBMPlexMono-Regular.ttf",
]) {
  const full = path.join(ROOT, rel);
  if (fs.existsSync(full)) targets.push(full);
}

const sorted = targets.filter((p) => p.startsWith(ROOT)).sort((a, b) => b.length - a.length);
let bytes = 0;
for (const p of sorted) {
  try {
    const st = fs.statSync(p);
    bytes += st.isFile() ? st.size : 0;
    console.log((dry ? "[dry] " : "rm    ") + path.relative(ROOT, p).replace(/\\/g, "/"));
    if (!dry) fs.rmSync(p, { recursive: true, force: true });
  } catch { /* already gone */ }
}
console.log(`${dry ? "would remove" : "removed"} ${sorted.length} items, ${(bytes / 1e6).toFixed(1)} MB`);
