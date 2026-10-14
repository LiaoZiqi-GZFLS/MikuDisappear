// Transport, scrubbing, chapters, keyboard, fullscreen. No render logic.

import { timecode } from "./type.js";

export class Player {
  constructor({ audio, duration, chapters }) {
    this.audio = audio;
    this.duration = duration;
    this.chapters = chapters;
    this.t = 0;
    this.playing = false;
    this.silent = false;       // true when the audio file is unavailable
    this._last = performance.now();
    this.el = {
      play: document.getElementById("play"),
      playPath: document.getElementById("play-path"),
      time: document.getElementById("time"),
      dur: document.getElementById("dur"),
      scrub: document.getElementById("scrub"),
      fill: document.getElementById("scrub-fill"),
      head: document.getElementById("scrub-head"),
      ticks: document.getElementById("scrub-ticks"),
      label: document.getElementById("scrub-label"),
      chapterLabel: document.getElementById("chapter-label"),
      chapters: document.getElementById("chapters"),
      chaptersBtn: document.getElementById("chapters-btn"),
      qualityBtn: document.getElementById("quality-btn"),
      fullBtn: document.getElementById("full-btn"),
      cleanBtn: document.getElementById("clean-btn"),
      cornerTitle: document.getElementById("corner-title"),
    };
    this.buildChapters();
    this.bind();
    this.el.dur.textContent = timecode(duration);
    this.el.cornerTitle.classList.add("show");
  }

  buildChapters() {
    const ticks = this.el.ticks;
    const list = this.el.chapters;
    this.chapters.forEach((c, i) => {
      const i2 = document.createElement("i");
      i2.style.left = `${(c.t0 / this.duration) * 100}%`;
      if (i % 4 === 0) i2.classList.add("hot");
      ticks.appendChild(i2);
      const b = document.createElement("button");
      b.innerHTML = `${c.name}<span>${timecode(c.t0, false)}</span>`;
      b.addEventListener("click", () => {
        this.seek(c.t0 + 0.001);
        this.el.chapters.hidden = true;
      });
      list.appendChild(b);
    });
  }

  bind() {
    const e = this.el;
    e.play.addEventListener("click", () => this.toggle());
    e.fullBtn.addEventListener("click", () => this.fullscreen());
    e.chaptersBtn.addEventListener("click", () => { e.chapters.hidden = !e.chapters.hidden; });
    e.cleanBtn.addEventListener("click", () => document.body.classList.toggle("clean"));
    e.scrub.addEventListener("pointerdown", (ev) => {
      this.scrubbing = true;
      e.scrub.setPointerCapture(ev.pointerId);
      this.scrubTo(ev);
    });
    e.scrub.addEventListener("pointermove", (ev) => {
      const r = e.scrub.getBoundingClientRect();
      const u = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      e.label.style.left = `${u * 100}%`;
      e.label.textContent = this.chapterNameAt(u * this.duration);
      if (this.scrubbing) this.scrubTo(ev);
    });
    e.scrub.addEventListener("pointerup", (ev) => {
      this.scrubbing = false;
      e.scrub.releasePointerCapture(ev.pointerId);
    });
    window.addEventListener("keydown", (ev) => {
      if (ev.target instanceof HTMLInputElement) return;
      const k = ev.key;
      if (k === " ") { ev.preventDefault(); this.toggle(); }
      else if (k === "ArrowLeft") this.step(ev.shiftKey ? -30 : -5);
      else if (k === "ArrowRight") this.step(ev.shiftKey ? 30 : 5);
      else if (k === ",") this.step(-1 / 60);
      else if (k === ".") this.step(1 / 60);
      else if (k === "h" || k === "H") this.toggleHud?.();
      else if (k === "f" || k === "F") this.fullscreen();
      else if (k === "c" || k === "C") document.body.classList.toggle("clean");
      else if (k >= "1" && k <= "9") {
        const c = this.chapters[Math.min(this.chapters.length - 1, parseInt(k, 10) - 1)];
        if (c) this.seek(c.t0 + 0.001);
      }
    });
    document.addEventListener("fullscreenchange", () => {
      this.el.fullBtn.textContent = document.fullscreenElement ? "退出" : "全屏";
    });
  }

  chapterNameAt(t) {
    let c = this.chapters[0];
    for (const x of this.chapters) if (t >= x.t0) c = x;
    return c ? c.name : "";
  }

  scrubTo(ev) {
    const r = this.el.scrub.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    this.seek(u * this.duration);
  }

  fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.getElementById("stage-wrap").requestFullscreen?.();
  }

  setQualityLabel(scale) {
    this.el.qualityBtn.textContent = `画质 ${scale}×`;
  }

  async play() {
    this.playing = true;
    this.el.playPath.setAttribute("d", "M7 5h4v14H7zm6 0h4v14h-4z");
    if (!this.silent && this.audio) {
      try {
        this.audio.currentTime = this.t;
        await this.audio.play();
      } catch {
        this.silent = true;
      }
    }
    this._last = performance.now();
  }

  pause() {
    this.playing = false;
    this.el.playPath.setAttribute("d", "M8 5v14l11-7z");
    if (this.audio) this.audio.pause();
    this.syncAudio();
  }

  toggle() { return this.playing ? this.pause() : this.play(); }

  seek(t) {
    this.t = Math.max(0, Math.min(this.duration, t));
    if (this.audio) this.audio.currentTime = this.t;
    this._last = performance.now();
    this.refresh();
  }

  step(dt) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.seek(this.t + dt);
  }

  syncAudio() {
    if (!this.silent && this.audio && Math.abs(this.audio.currentTime - this.t) > 0.05) {
      this.audio.currentTime = this.t;
    }
  }

  // advance the clock; returns the current time
  update() {
    const now = performance.now();
    if (this.playing) {
      if (!this.silent && this.audio && this.audio.readyState >= 2 && !this.audio.paused) {
        this.t = this.audio.currentTime;
        if (this.t >= this.duration - 0.02) this.pause();
      } else {
        this.t += (now - this._last) / 1000;
        if (this.t >= this.duration) {
          this.t = this.duration;
          this.pause();
        }
      }
    }
    this._last = now;
    this.refresh();
    return this.t;
  }

  refresh() {
    const e = this.el;
    const u = this.duration ? this.t / this.duration : 0;
    e.fill.style.width = `${u * 100}%`;
    e.head.style.left = `${u * 100}%`;
    e.time.firstChild.textContent = timecode(this.t) + " ";
    const name = this.chapterNameAt(this.t);
    e.chapterLabel.textContent = name;
    this.el.cornerTitle.classList.toggle("show", this.t < 26 && this.t > 3);
    for (const [i, b] of [...e.chapters.querySelectorAll("button")].entries()) {
      b.classList.toggle("active", i === this.chapters.findIndex((c) => c.name === name));
    }
  }
}
