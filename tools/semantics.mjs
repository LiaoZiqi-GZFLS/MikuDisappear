// Lyric -> picture audit.
//
//   node tools/semantics.mjs            # coverage table
//   node tools/semantics.mjs --quiet    # exit non-zero if any line is unmapped
//
// The film is allowed to be abstract, but every lyric must resolve to a beat
// in src/semantics.js. This keeps the picture accountable to the words.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BEATS, findBeat } from "../src/semantics.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const lyrics = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "lyrics.json"), "utf8"),
).lines;

const quiet = process.argv.includes("--quiet");
const rows = lyrics.map((line, i) => ({ i, line, beat: findBeat(line.text) }));
const missing = rows.filter((r) => !r.beat);
const counts = new Map();
for (const r of rows) {
  if (!r.beat) continue;
  counts.set(r.beat.motif, (counts.get(r.beat.motif) || 0) + 1);
}

if (!quiet) {
  console.log("LYRIC -> PICTURE\n");
  for (const r of rows) {
    const b = r.beat;
    const head = `${String(r.i).padStart(3)}  ${r.line.start.toFixed(2).padStart(7)}s  `;
    if (!b) {
      console.log(`${head}UNMAPPED  ${r.line.text}`);
      continue;
    }
    console.log(`${head}${b.id.padEnd(20)} ${b.motif.padEnd(16)} ${r.line.text}`);
  }
  console.log("\nmotifs");
  for (const [motif, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${motif.padEnd(18)} ${String(n).padStart(3)}`);
  }
}

const orphanBeats = BEATS.filter(
  (b) => !lyrics.some((line) => findBeat(line.text) === b),
);
console.log(
  `\n${rows.length - missing.length}/${rows.length} lines mapped, ` +
  `${counts.size} motifs, ${orphanBeats.length} unused beats`,
);
if (missing.length) {
  console.log("unmapped:");
  for (const r of missing) console.log(`  ${r.i}  ${r.line.text}`);
}
if (orphanBeats.length && !quiet) {
  console.log("unused beats:");
  for (const b of orphanBeats) console.log(`  ${b.id} (${b.needle})`);
}
process.exit(missing.length ? 1 : 0);
