// Loads the offline analysis and exposes it as a small feature API.
// Everything here is a pure function of song time.

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function fetchBin(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.arrayBuffer();
}

export async function loadData(base = "./data") {
  const [analysis, lyrics, env, wave, spec] = await Promise.all([
    fetchJSON(`${base}/analysis.json`),
    fetchJSON(`${base}/lyrics.json`),
    fetchBin(`${base}/env.bin`),
    fetchBin(`${base}/wave.bin`),
    fetchBin(`${base}/spec.bin`),
  ]);
  return new Features(analysis, lyrics.lines, env, wave, spec);
}

export const CH = { rms: 0, low: 1, mid: 2, high: 3, vocal: 4, flux: 5, centroid: 6 };
const SPEC_BANDS = 64;

export class Features {
  constructor(analysis, lines, envBuf, waveBuf, specBuf) {
    this.a = analysis;
    this.lines = lines;
    this.duration = analysis.duration;
    this.env = new Float32Array(envBuf);
    this.envFrames = this.env.length / analysis.channels.length;
    this.envFps = analysis.fps;
    this.wave = new Int8Array(waveBuf);
    this.waveFps = analysis.waveFps;
    this.spec = new Uint8Array(specBuf);
    this.specBands = SPEC_BANDS;
    this.specFps = analysis.specFps;
    this.beats = analysis.beats;
    this.downbeats = analysis.downbeats;
    this.beatPeriod = analysis.beatPeriod;
    this.beatPhase = analysis.beatPhase;
    this.accents = analysis.accents;
    this.accentChannels = analysis.accentChannels;
    this.sections = analysis.sections;
    this.tempoCurve = analysis.tempoCurve;
    this.bpm = analysis.bpm;

    this.events = {};
    for (const k in analysis.events) {
      const list = analysis.events[k];
      this.events[k] = {
        t: Float32Array.from(list, (e) => e[0]),
        w: Float32Array.from(list, (e) => e[1]),
      };
    }
    this._tmp = { rms: 0, low: 0, mid: 0, high: 0, vocal: 0, flux: 0, centroid: 0 };
  }

  // ------------------------------------------------------------- envelopes
  envAt(channel, t) {
    const ch = typeof channel === "string" ? CH[channel] : channel;
    const n = this.envFrames;
    const x = Math.max(0, Math.min(n - 1.001, t * this.envFps));
    const i = x | 0;
    const f = x - i;
    const c = this.a.channels.length;
    const a = this.env[i * c + ch];
    const b = this.env[Math.min(i + 1, n - 1) * c + ch];
    return a + (b - a) * f;
  }

  // All seven channels in one call: `out` is reused to avoid allocation.
  frame(t, out = this._tmp) {
    out.rms = this.envAt("rms", t);
    out.low = this.envAt("low", t);
    out.mid = this.envAt("mid", t);
    out.high = this.envAt("high", t);
    out.vocal = this.envAt("vocal", t);
    out.flux = this.envAt("flux", t);
    out.centroid = this.envAt("centroid", t);
    return out;
  }

  // Envelope smeared over `win` seconds ending at t (cheap energy average).
  envAvg(channel, t, win = 0.3) {
    const step = Math.max(1, Math.round(win * this.envFps / 8));
    let s = 0, n = 0;
    for (let i = 8; i >= 0; i--) {
      const tt = t - (win * i) / 8;
      if (tt < 0) continue;
      s += this.envAt(channel, tt);
      n++;
    }
    return n ? s / n : 0;
  }

  // ------------------------------------------------------------- waveform
  waveAt(t) {
    const n = this.wave.length / 2;
    const i = Math.max(0, Math.min(n - 1, Math.round(t * this.waveFps)));
    return [this.wave[i * 2] / 127, this.wave[i * 2 + 1] / 127];
  }

  // n min/max pairs covering [t0, t1); returns {lo, hi} Float32Arrays
  waveSlice(t0, t1, n, lo, hi) {
    lo = lo || new Float32Array(n);
    hi = hi || new Float32Array(n);
    const total = this.wave.length / 2;
    const steps = Math.max(1, Math.round((t1 - t0) * this.waveFps));
    for (let i = 0; i < n; i++) {
      const a = t0 + ((t1 - t0) * i) / n;
      const b = t0 + ((t1 - t0) * (i + 1)) / n;
      let ia = Math.round(a * this.waveFps);
      let ib = Math.round(b * this.waveFps);
      ia = Math.max(0, Math.min(total - 1, ia));
      ib = Math.max(ia + 1, Math.min(total, ib));
      let mn = 127, mx = -128;
      const stride = Math.max(1, Math.floor((ib - ia) / 8));
      for (let k = ia; k < ib; k += stride) {
        const v0 = this.wave[k * 2], v1 = this.wave[k * 2 + 1];
        if (v0 < mn) mn = v0;
        if (v1 > mx) mx = v1;
      }
      lo[i] = mn / 127;
      hi[i] = mx / 127;
    }
    void steps;
    return { lo, hi };
  }

  // --------------------------------------------------------- spectrogram
  specAt(band, t) {
    const frames = this.spec.length / this.specBands;
    const i = Math.max(0, Math.min(frames - 1, Math.round(t * this.specFps)));
    return this.spec[i * this.specBands + Math.max(0, Math.min(this.specBands - 1, band))] / 255;
  }

  // `n` columns of `bands` rows covering [t0, t1)
  specSlice(t0, t1, n, bands, out) {
    out = out || new Float32Array(n * bands);
    const frames = this.spec.length / this.specBands;
    for (let i = 0; i < n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      const f = Math.max(0, Math.min(frames - 1, Math.round(t * this.specFps)));
      for (let b = 0; b < bands; b++) {
        const src = Math.min(this.specBands - 1, Math.round((b / (bands - 1)) * (this.specBands - 1)));
        out[i * bands + b] = this.spec[f * this.specBands + src] / 255;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- beat
  beatAt(t) {
    return (t - this.beatPhase) / this.beatPeriod;
  }

  barAt(t) {
    return this.beatAt(t) / 4;
  }

  beatTime(i) {
    return this.beatPhase + i * this.beatPeriod;
  }

  nearestBeat(t) {
    return Math.round(this.beatAt(t));
  }

  beatPhaseFrac(t) {
    return this.beatAt(t) - Math.floor(this.beatAt(t));
  }

  barPhaseFrac(t) {
    const b = this.barAt(t);
    return b - Math.floor(b);
  }

  accent(i, channel) {
    const row = this.accents[Math.max(0, Math.min(this.accents.length - 1, i))];
    if (!row) return 0;
    const k = this.accentChannels.indexOf(channel);
    return k < 0 ? 0 : row[k];
  }

  tempoAt(t) {
    const c = this.tempoCurve;
    if (!c.length) return this.bpm;
    let best = c[0][1];
    for (let i = 0; i < c.length; i++) {
      if (c[i][0] <= t) best = c[i][1];
      else break;
    }
    return best;
  }

  // -------------------------------------------------------------- events
  // Index of the last event at or before t (binary search), -1 if none.
  lastEvent(kind, t) {
    const e = this.events[kind];
    if (!e) return -1;
    const arr = e.t;
    let lo = 0, hi = arr.length - 1, res = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= t) { res = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return res;
  }

  // Decaying impulse from the most recent event: hit('kick', t, 0.09)
  hit(kind, t, halfLife = 0.08) {
    const i = this.lastEvent(kind, t);
    if (i < 0) return 0;
    const e = this.events[kind];
    const dt = t - e.t[i];
    return e.w[i] * Math.exp(-dt / halfLife);
  }

  hitAny(t, halfLife = 0.08) {
    return Math.max(this.hit("kick", t, halfLife * 1.3),
                    this.hit("snare", t, halfLife),
                    this.hit("vox", t, halfLife * 0.7));
  }

  eventsBetween(kind, t0, t1) {
    const e = this.events[kind];
    const out = [];
    if (!e) return out;
    for (let i = 0; i < e.t.length; i++) {
      if (e.t[i] >= t0 && e.t[i] < t1) out.push({ t: e.t[i], w: e.w[i] });
      if (e.t[i] >= t1) break;
    }
    return out;
  }

  // -------------------------------------------------------------- lyrics
  lineIndexAt(t) {
    let res = -1;
    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i].start <= t) res = i;
      else break;
    }
    return res;
  }

  // The line that should be on screen: the current one, or the one that just
  // finished if we are in a gap.
  activeLine(t) {
    const i = this.lineIndexAt(t);
    if (i < 0) return null;
    const l = this.lines[i];
    return t <= l.end + 0.35 ? l : null;
  }

  linesBetween(t0, t1) {
    return this.lines.filter((l) => l.start >= t0 && l.start < t1);
  }

  // 0..1 for character j of `line` (using its per-character onset times)
  charProgress(line, j, t) {
    if (!line || !line.ct || !line.ct.length) return 0;
    const k = Math.max(0, Math.min(line.ct.length - 1, j));
    const start = line.ct[k];
    const end = line.ct[Math.min(line.ct.length - 1, k + 1)] || line.end;
    const span = Math.max(0.04, end - start);
    return Math.max(0, Math.min(1, (t - start) / span));
  }

  // how far the line itself has been sung, 0..1
  lineProgress(line, t) {
    if (!line) return 0;
    return Math.max(0, Math.min(1, (t - line.start) / Math.max(0.05, line.end - line.start)));
  }

  sectionAt(t) {
    let s = this.sections[0];
    for (const sec of this.sections) {
      if (t >= sec.t) s = sec;
      else break;
    }
    return s;
  }
}
