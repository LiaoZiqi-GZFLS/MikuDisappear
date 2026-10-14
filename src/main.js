// Boot, render loop, export hooks.

import { loadData } from "./analysis.js";
import { Engine, resolveTimeline } from "./engine.js";
import { CHAPTER_NAMES, FILM_TAIL, TIMELINE_SPEC } from "./timeline.js";
import { filmHud } from "./hud.js";
import { loadFonts } from "./type.js";
import { Player } from "./player.js";
import SCENES from "./scenes/index.js";

const params = new URLSearchParams(location.search);
const SONG_FILE = "\u521d\u97f3\u30df\u30af,cosMo@\u66b4\u8d70P - \u521d\u97f3\u30df\u30af\u306e\u6d88\u5931.mp3";
const loadLine = document.getElementById("load-line");
const veil = document.getElementById("veil");
const startBtn = document.getElementById("start-btn");
const canvas = document.getElementById("stage");

const say = (s) => { loadLine.textContent = s; };
const nextTick = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  say("读取节拍与歌词分析…");
  const data = await loadData("./data");
  await nextTick();
  say("载入排版字体…");
  await loadFonts("./assets/fonts");
  await nextTick();
  say("编译渲染管线…");
  const scale = Math.max(1, Math.min(3, Number(params.get("scale") || 1)));
  const engine = new Engine(canvas, data, {
    scale,
    hud: params.get("hud") !== "0",
  });
  engine.register(SCENES);
  const timeline = resolveTimeline(TIMELINE_SPEC, data);
  engine.setTimeline(timeline);
  engine.hud = filmHud;
  await engine.preload();

  const chapters = timeline.map((e) => ({
    id: e.id,
    name: CHAPTER_NAMES[e.id] || e.id,
    t0: e.t0,
    t1: e.t1,
  }));

  // The film is longer than the song: the closing credits run in silence.
  const filmDuration = data.duration + FILM_TAIL;
  const audio = new Audio(encodeURI("./" + SONG_FILE));
  audio.preload = "auto";
  const player = new Player({ audio, duration: filmDuration, chapters });
  player.setQualityLabel(scale);
  player.toggleHud = () => { engine.hudOn = !engine.hudOn; };
  player.el.qualityBtn.addEventListener("click", () => {
    const next = scale === 1 ? 2 : 1;
    const p = new URLSearchParams(location.search);
    p.set("scale", String(next));
    p.set("t", player.t.toFixed(3));
    location.search = p.toString();
  });

  let dirty = true;
  const markDirty = () => { dirty = true; };
  player.el.scrub.addEventListener("pointerup", markDirty);
  window.addEventListener("resize", markDirty);

  const tParam = params.get("t");
  if (tParam != null) player.seek(Number(tParam));
  if (params.get("ui") === "0") document.body.classList.add("clean");
  if (tParam != null || params.get("veil") === "0") veil.classList.add("gone");
  else startBtn.hidden = false;
  if (params.get("veil") === "0") veil.style.display = "none";

  const wasPlaying = () => player.playing;
  const loop = () => {
    requestAnimationFrame(loop);
    const t = player.update();
    if (wasPlaying() || dirty || params.get("loop") === "1") {
      dirty = false;
      try {
        engine.render(t);
      } catch (err) {
        console.error(err);
      }
    }
  };
  requestAnimationFrame(loop);

  startBtn.addEventListener("click", async () => {
    veil.classList.add("gone");
    await player.play();
  });

  audio.addEventListener("error", () => {
    player.silent = true;
    say("音频无法加载：画面将以静音时钟播放（把 MP3 放在项目根目录即可）。");
  });

  // Deterministic frame access for the offline renderer / QA scripts.
  window.__mv = {
    ready: true,
    engine,
    player,
    features: data,
    duration: filmDuration,
    chapters,
    renderFrame(t, hud = true) {
      const keep = engine.hudOn;
      engine.hudOn = hud;
      engine.render(t);
      engine.hudOn = keep;
    },
    seek(t) { player.seek(t); },
    play() { return player.play(); },
    pause() { player.pause(); },
  };
  say("就绪");
  document.body.dataset.ready = "1";
}

boot().catch((err) => {
  console.error(err);
  say("启动失败：" + err.message);
});
