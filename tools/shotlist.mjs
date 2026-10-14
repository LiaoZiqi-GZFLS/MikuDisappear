// Generate docs/镜头表.md from the code that actually drives the film.
//
//   node tools/shotlist.mjs            # write the document
//   node tools/shotlist.mjs --print    # stdout only
//
// The camera table lives in src/camera.js and the lyric readings live in
// src/semantics.js, so the document can never drift away from the edit.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTimeline } from "../src/engine.js";
import { CHAPTER_NAMES, TIMELINE_SPEC } from "../src/timeline.js";
import { SHOT_SPEC, buildShots } from "../src/camera.js";
import { BEATS, findBeat } from "../src/semantics.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "data/analysis.json"), "utf8"));
const lyrics = JSON.parse(fs.readFileSync(path.join(ROOT, "data/lyrics.json"), "utf8")).lines;
const F = { lines: lyrics, sections: analysis.sections, duration: analysis.duration };
const timeline = resolveTimeline(TIMELINE_SPEC, F);
const shots = buildShots(F, timeline);

const tc = (t) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
};

// Describe a camera move the way a shot list would.
function move(a, b, s) {
  const out = [];
  const dz = b.z - a.z;
  if (Math.abs(dz) > 0.008) out.push(`${dz > 0 ? "推入" : "拉远"} ${a.z.toFixed(2)}→${b.z.toFixed(2)}`);
  const dx = b.x - a.x;
  if (Math.abs(dx) > 0.004) out.push(`${dx > 0 ? "右移" : "左移"} ${Math.abs(dx).toFixed(3)}`);
  const dy = b.y - a.y;
  if (Math.abs(dy) > 0.004) out.push(`${dy > 0 ? "下摇" : "上摇"} ${Math.abs(dy).toFixed(3)}`);
  const dr = b.r - a.r;
  if (Math.abs(dr) > 0.05) out.push(`${dr > 0 ? "顺时针" : "逆时针"}侧倾 ${Math.abs(dr).toFixed(2)}°`);
  if (Math.abs(dz) <= 0.008 && Math.abs(dx) <= 0.004 && Math.abs(dy) <= 0.004) out.push("固定机位");
  if (s.step === "bar") out.push("每小节轻微重构");
  if (s.step === "line") out.push("每句轻微重构");
  if ((s.shake ?? 0) > 0.8) out.push("撞击抖动");
  const h = s.h ?? 0;
  if (h >= 1.2) out.push("手持");
  else if (h <= 0.15) out.push("无呼吸");
  return out.join("、");
}

let md = `# 镜头表 / SHOT LIST

> 本文件由 \`node tools/shotlist.mjs\` 生成。
> 镜头数据来自 [src/camera.js](../src/camera.js)，歌词语义来自 [src/semantics.js](../src/semantics.js)，
> 章节边界来自 [src/timeline.js](../src/timeline.js)。改代码后重新生成即可，文档与成片永远一致。

全片 ${tc(0)}–${tc(timeline[timeline.length - 1].t1)}，${timeline.length} 章，${[...shots.values()].reduce((n, s) => n + s.length, 0)} 个镜头。

`;

timeline.forEach((entry, i) => {
  const name = CHAPTER_NAMES[entry.id] || entry.id;
  md += `## ${String(i + 1).padStart(2, "0")} · ${entry.id} · ${name} · ${tc(entry.t0)}–${tc(entry.t1)}\n\n`;
  const list = shots.get(entry.id) || [];
  md += "| # | 时间 | 镜头运动 | 导演意图 |\n|---:|---|---|---|\n";
  list.forEach((s, k) => {
    md += `| ${k + 1} | ${tc(s.t0)}–${tc(s.t1)} | ${move(s.a, s.b, s)} | ${s.note || ""} |\n`;
  });
  md += "\n";
});

md += `## 歌词 → 画面

每一句歌词都必须在画面里有一件事要做：一个语义 beat、一个可复用的母题，
以及一句"这句到底在说什么"。审计命令：\`node tools/semantics.mjs --quiet\`。

| # | 时间 | 歌词 | 语义 beat | 母题 | 这句在说什么 |
|---:|---|---|---|---|---|
`;
lyrics.forEach((l, i) => {
  const b = findBeat(l.text);
  const text = l.text.replace(/\|/g, "\\|");
  md += `| ${i} | ${tc(l.start)} | ${text} | ${b ? b.id : "—"} | ${b ? b.motif : "—"} | ${b ? b.note : "未映射"} |\n`;
});
md += `
未使用的 beat：${BEATS.filter((b) => !lyrics.some((l) => findBeat(l.text) === b)).length} 个。
`;

if (process.argv.includes("--print")) {
  process.stdout.write(md);
} else {
  const out = path.join(ROOT, "docs/镜头表.md");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md, "utf8");
  console.log(`wrote ${out} (${md.length} chars)`);
}
