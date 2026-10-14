#!/usr/bin/env python
"""Offline analysis for the "Hatsune Miku no Shoushitsu" code MV.

The track is a rigid 240 BPM grid (quarter = 0.25 s, bar = 1.0 s); this script
measures that grid instead of assuming it, then derives the data the renderer
needs:

  data/analysis.json  grid, beats, per-beat accents, events, sections
  data/env.bin        float32 frames x 7 band envelopes (100 fps)
  data/lyrics.json    lyric lines with character times snapped to onsets

Requires numpy + scipy; ffmpeg does the decoding.
"""

import json
import os
import re
import subprocess
import sys

import numpy as np
from scipy.ndimage import maximum_filter1d, uniform_filter1d

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
STEM = "\u521d\u97f3\u30df\u30af,cosMo@\u66b4\u8d70P - \u521d\u97f3\u30df\u30af\u306e\u6d88\u5931"
SONG = os.path.join(ROOT, STEM + ".mp3")
LRC = os.path.join(ROOT, STEM + ".lrc")

SR = 22050          # analysis sample rate
HOP = 220           # -> ~100 frames per second
NFFT = 2048
FPS = SR / HOP
ENV_CHANNELS = ["rms", "low", "mid", "high", "vocal", "flux", "centroid"]

BANDS = {                      # name -> (lo, hi) Hz for flux-based event detection
    "kick": (35, 130),
    "snare": (180, 1200),
    "hat": (6000, 11000),
    "vox": (300, 3400),
}


# ---------------------------------------------------------------- decoding
def decode(path):
    raw = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", path,
        "-f", "f32le", "-ac", "1", "-ar", str(SR), "-",
    ])
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def stft_mag(x):
    n = 1 + (len(x) - NFFT) // HOP
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(n)[:, None]
    frames = x[idx] * np.hanning(NFFT)[None, :]
    return np.abs(np.fft.rfft(frames, axis=1)).T.astype(np.float32)   # (bins, frames)


def norm(v, lo_pct=5.0, hi_pct=97.0, ceil=1.5):
    lo, hi = np.percentile(v, lo_pct), np.percentile(v, hi_pct)
    if hi - lo < 1e-9:
        return np.zeros_like(v)
    return np.clip((v - lo) / (hi - lo), 0.0, ceil).astype(np.float32)


def spectral_flux(mag, freqs=None, band=None):
    if band is not None:
        m = (freqs >= band[0]) & (freqs < band[1])
        mag = mag[m]
    logmag = np.log1p(mag * 40.0)
    d = np.diff(logmag, axis=1, prepend=logmag[:, :1])
    flux = np.maximum(d, 0).sum(axis=0)
    return np.maximum(flux - 0.85 * uniform_filter1d(flux, 45, mode="nearest"), 0.0)


def local_peak(v, win, thr_rel):
    mx = maximum_filter1d(v, win)
    return (v >= mx - 1e-12) & (v > thr_rel * max(np.percentile(v, 99.0), 1e-9))


def peaks(env, t0, t1, thr, min_gap=0.055, floor=0.0):
    """Peak pick -> [(time, strength)] inside [t0, t1)."""
    a, b = max(0, int(t0 * FPS)), min(len(env), int(t1 * FPS))
    loc = local_peak(env, 5, thr)
    out = []
    for i in np.nonzero(loc[a:b])[0] + a:
        if env[i] < floor:
            continue
        t = i / FPS
        if out and t - out[-1][0] < min_gap:
            if env[i] > out[-1][1]:
                out[-1] = (t, float(env[i]))
        else:
            out.append((t, float(env[i])))
    return out


# ---------------------------------------------------------------- grid
def circ_fit(times, weights, p_lo, p_hi, step):
    """Best period/phase by circular concentration of the given event times."""
    best = (-1.0, p_lo, 0.0)
    for p in np.arange(p_lo, p_hi, step):
        u = times / p
        c = float(np.sum(weights * np.cos(2 * np.pi * u)))
        s = float(np.sum(weights * np.sin(2 * np.pi * u)))
        r = float(np.hypot(c, s) / (np.sum(weights) + 1e-12))
        if r > best[0]:
            ph = (np.arctan2(s, c) / (2 * np.pi) * p) % p
            best = (r, float(p), float(ph))
    return best


def measure_grid(flux, duration):
    """Find the quarter-note grid; returns (period, phase, bpm, concentration)."""
    pk = peaks(flux, 24.0, min(duration - 4, 268.0), 0.20, 0.055, floor=0.0)
    strong = [(t, w) for t, w in pk if w > 0.35]
    if len(strong) < 50:
        strong = pk
    ts = np.array([t for t, _ in strong])
    ws = np.array([w for _, w in strong])
    r, p, ph = circ_fit(ts, ws, 0.22, 0.28, 2e-6)
    for cand in (0.25, 0.5 / 3, 0.5 / 4, 0.5 / 5):      # snap to a clean grid
        if abs(p - cand) / cand < 0.004:
            p = cand
            break
    r2, p2, ph2 = circ_fit(ts, ws, p - 0.0006, p + 0.0006, 1e-6)
    if r2 >= r:
        p, ph = p2, ph2
    return p, ph, 60.0 / p, max(r, r2)


def measure_downbeat(kick_env, grid_phase, period, duration, lyric_times):
    """4/4: the kick alternates on beats 1 and 3, so compare those two slots.

    A pure drum pattern is symmetric, so the LRC phrase starts (which land on
    bar lines) break the tie; the kick accent is only a fallback.
    """
    beats = np.arange(grid_phase, duration, period)
    scores = []
    for slot in range(4):
        idx = np.round(beats[slot::4] * FPS).astype(int)
        idx = idx[(idx >= 0) & (idx < len(kick_env))]
        scores.append(float(np.mean(kick_env[idx])) if len(idx) else 0.0)
    lt = np.array([t for t in lyric_times if 24.0 < t < 268.0])
    bar = 4 * period
    if len(lt) >= 8:
        z = np.exp(2j * np.pi * lt / bar)
        lyric_phase = float(np.angle(z.mean()) / (2 * np.pi) * bar) % bar
        lyric_conc = float(abs(z.mean()))
    else:
        lyric_phase, lyric_conc = 0.0, 0.0
    best = int(np.argmax(scores[::2]) * 2)      # stronger kick of the two kick slots
    return best, [round(s, 4) for s in scores], round(lyric_phase, 3), round(lyric_conc, 3)


# ---------------------------------------------------------------- lyrics
LRC_RE = re.compile(r"^\[(\d+):(\d+)[.:](\d+)\](.*)$")


def parse_lrc(path):
    rows = []
    with open(path, "r", encoding="utf-8") as fh:
        for raw in fh:
            m = LRC_RE.match(raw.strip())
            if not m:
                continue
            mm, ss, cs, text = m.groups()
            t = int(mm) * 60 + int(ss) + int(cs) / (10 ** len(cs))
            rows.append((round(t, 3), text.strip()))
    return rows


def classify(text):
    if not text:
        return "gap"
    if text.startswith("---") and text.endswith("---"):
        return "marker"
    if text[0] in "\uff1c<":
        return "title"
    if text[0] == "\u300c":
        return "spoken"
    return "line"


def build_lyrics(rows, vocal_flux):
    items = [{"t": t, "text": text, "kind": classify(text)} for t, text in rows]

    rates = []
    for a, b in zip(items, items[1:]):
        if a["kind"] in ("line", "spoken") and b["kind"] != "gap":
            dt = b["t"] - a["t"]
            n = len(re.sub(r"\s+", "", a["text"]))
            if 0.4 < dt < 3.5 and n >= 3:
                rates.append(n / dt)
    cps = float(np.median(rates)) if rates else 8.0

    core = [it for it in items if it["kind"] != "gap"]

    # Hand-typed LRC files run a little ahead of (or behind) the recording, and
    # the offset is not the same in every section. Snap each line's start onto
    # its own first vocal onset instead of shifting the whole file.
    offs = np.arange(-0.35, 0.3501, 0.01)

    def onset_score(t0, off, win=0.03):
        """Strength of the vocal attack at t0+off (a ~3 frame peak)."""
        a = int((t0 + off) * FPS)
        b = int((t0 + off + win) * FPS)
        if a < 0 or b > len(vocal_flux) or b <= a:
            return 0.0
        return float(vocal_flux[a:b].max())

    snapped = 0
    for it in core:
        base = onset_score(it["t"], 0.0)
        scores = np.array([onset_score(it["t"], float(o)) for o in offs])
        best = float(scores.max())
        # Prefer a strong attack close to the written time: an equally loud
        # attack half a beat away is the next syllable, not the line start.
        strong = np.nonzero(scores >= 0.65 * best)[0]
        best_off = float(offs[strong[np.argmin(np.abs(offs[strong]))]]) if len(strong) else 0.0
        # only accept a move that actually finds more voice
        if best > base * 1.12 + 1e-6:
            it["offset"] = round(best_off, 3)
            snapped += 1
        else:
            it["offset"] = 0.0
        it["start"] = round(it["t"] + it["offset"], 3)
        it["lrcT"] = it["t"]

    vocal_floor = float(np.percentile(vocal_flux, 55.0)) * 0.5
    for i, it in enumerate(core):
        nxt = core[i + 1]["start"] if i + 1 < len(core) else it["start"] + 4.0
        n = max(1, len(re.sub(r"\s+", "", it["text"])))
        if nxt - it["start"] <= 3.5:
            end = nxt
        else:
            # A line followed by a long gap is a held note: start from the
            # characters-per-second estimate and then follow the vocal
            # envelope for as long as the voice is still producing sound.
            est = it["start"] + float(np.clip(n / max(cps, 1.0) + 0.35, 0.7, 6.0))
            limit = min(nxt, it["start"] + 9.0)
            a, b = int(est * FPS), int(limit * FPS)
            last = est
            if b > a:
                seg = vocal_flux[a:b]
                thr = max(vocal_floor, float(np.percentile(seg, 60.0)) * 0.35)
                silent = 0
                for k, v in enumerate(seg):
                    if v > thr:
                        last = (a + k) / FPS
                        silent = 0
                    else:
                        silent += 1
                        if silent > int(0.45 * FPS):
                            break
            end = min(last + 0.35, limit)
        it["end"] = round(min(end, it["start"] + 8.0), 3)

    for it in core:
        text = it["text"]
        chars = [i for i, ch in enumerate(text) if not ch.isspace()]
        if not chars:
            it["ci"], it["ct"] = [], []
            continue
        pk = peaks(vocal_flux, it["start"] - 0.03, it["end"] + 0.10, 0.10, 0.055)
        times = []
        if len(pk) >= 2:
            for j in range(len(chars)):
                u = j / max(1, len(chars) - 1)
                times.append(pk[int(round(u * (len(pk) - 1)))][0])
        else:
            span = max(0.25, it["end"] - it["start"])
            for j in range(len(chars)):
                u = j / max(1, len(chars) - 1)
                times.append(it["start"] + u * span * 0.92)
        it["ci"] = chars
        it["ct"] = [round(max(it["start"], min(it["end"], x)), 3) for x in times]
    return core, round(cps, 3), snapped


# ---------------------------------------------------------------- main
def main():
    if not os.path.exists(SONG):
        sys.exit("song not found: %s" % SONG)
    os.makedirs(DATA, exist_ok=True)

    x = decode(SONG)
    duration = len(x) / SR
    mag = stft_mag(x)
    freqs = np.fft.rfftfreq(NFFT, 1.0 / SR)
    nf = mag.shape[1]
    print("decoded %.2fs, %d frames @ %.0f fps" % (duration, nf, FPS))

    rms_sig = np.sqrt(uniform_filter1d(x ** 2, int(SR * 0.04), mode="nearest"))
    rms = np.interp(np.arange(nf) / FPS, np.arange(len(rms_sig)) / SR, rms_sig)

    low = norm(mag[(freqs >= 25) & (freqs < 160)].sum(axis=0))
    mid = norm(mag[(freqs >= 160) & (freqs < 2000)].sum(axis=0))
    high = norm(mag[(freqs >= 2000) & (freqs < 9000)].sum(axis=0))
    vocal = norm(mag[(freqs >= 300) & (freqs < 3400)].sum(axis=0))
    cen = norm((mag * freqs[:, None]).sum(axis=0) / (mag.sum(axis=0) + 1e-9))
    flux = norm(spectral_flux(mag))

    band_env = {name: norm(spectral_flux(mag, freqs, b)) for name, b in BANDS.items()}

    period, phase, bpm, conc = measure_grid(flux, duration)
    print("grid: period %.5fs (%.2f BPM) phase %.4fs  concentration %.3f"
          % (period, bpm, phase, conc))

    rows = parse_lrc(LRC)
    lyric_times = [t for t, txt in rows if classify(txt) == "line"]
    slot, slot_scores, lyric_phase, lyric_conc = measure_downbeat(
        band_env["kick"], phase, period, duration, lyric_times)
    print("downbeat slot %d of 4 (kick %s; lyric bars at %.2f, conc %.2f)"
          % (slot, slot_scores, lyric_phase, lyric_conc))

    phase = float(phase + slot * period)          # beat 0 is now a downbeat
    beats = np.arange(phase, duration, period)
    downbeats = beats[::4]

    accents = []
    for b in beats:
        i = min(int(round(b * FPS)), nf - 1)
        accents.append([round(float(band_env[n][i]), 3) for n in BANDS])

    events = {}
    for name, env in band_env.items():
        thr = 0.36 if name == "hat" else 0.30
        pk = peaks(env, 0.0, duration, thr, 0.05, floor=0.22)
        events[name] = [[round(t, 3), round(w, 3)] for t, w in pk]
        print("  events %-5s %d" % (name, len(pk)))

    tempo_curve = []
    for t0 in np.arange(0.0, max(0.1, duration - 8.0), 4.0):
        a, b = int(t0 * FPS), int((t0 + 8.0) * FPS)
        pk = peaks(flux[a:b], 0.0, 8.0, 0.2, 0.05)
        if len(pk) < 20:
            tempo_curve.append([round(t0 + 4.0, 2), 240.0])
            continue
        ts = np.array([t for t, _ in pk])
        r, p, _ = circ_fit(ts, np.ones_like(ts), 0.24, 0.26, 5e-5)
        tempo_curve.append([round(t0 + 4.0, 2), round(60.0 / p, 2) if r > 0.15 else round(bpm, 2)])

    env = np.stack([norm(rms), low, mid, high, vocal, flux, cen]).astype("<f4")
    env.tofile(os.path.join(DATA, "env.bin"))

    # real waveform (min/max pairs at 200 fps) for scopes and ribbons
    blk = int(round(SR / 200))
    wave_fps = SR / blk          # 200.4545...: the real rate of the stored pairs
    n_blk = len(x) // blk
    w = x[:n_blk * blk].reshape(n_blk, blk)
    wmin = np.clip(w.min(axis=1) * 114.0, -127, 127).astype(np.int8)
    wmax = np.clip(w.max(axis=1) * 114.0, -127, 127).astype(np.int8)
    np.stack([wmin, wmax], axis=1).tofile(os.path.join(DATA, "wave.bin"))

    # log-spaced spectrogram, 64 bands x 100 fps, 8 bit (time major)
    edges = np.geomspace(45.0, 11000.0, 65)
    spec = np.empty((64, nf), dtype=np.float32)
    for i in range(64):
        m = (freqs >= edges[i]) & (freqs < edges[i + 1])
        spec[i] = np.log1p(mag[m].mean(axis=0) * 26.0) if m.any() else 0.0
    floor = spec.min(axis=1, keepdims=True)
    ceil = np.percentile(spec, 99.6, axis=1, keepdims=True)
    spec = np.clip((spec - floor) / np.maximum(ceil - floor, 1e-6), 0.0, 1.0)
    (spec.T * 255.0).astype(np.uint8).tofile(os.path.join(DATA, "spec.bin"))

    lyrics, cps, snapped = build_lyrics(rows, band_env["vox"])
    print("lyrics: %d lines, median %.2f chars/s, %d line starts snapped to the voice"
          % (len(lyrics), cps, snapped))
    resid = np.array([beats[np.argmin(np.abs(beats - it["t"]))] - it["t"]
                      for it in lyrics if it["kind"] == "line"])
    print("line start offset vs grid: median %+.3fs, |p90| %.3fs"
          % (float(np.median(resid)), float(np.percentile(np.abs(resid), 90))))

    raw_sections = [
        ("boot", 0.0), ("wake", 22.03), ("birth", 25.44), ("resonance", 41.74),
        ("garble", 58.0), ("memory", 73.42), ("countdown", 90.1), ("brake", 103.42),
        ("overdrive", 117.87), ("plea", 139.32), ("beg", 162.22), ("erode", 177.48),
        ("compress", 209.6), ("final", 225.49), ("lastwords", 256.3), ("error", 274.0),
    ]
    sections = []
    for name, t in raw_sections:
        k = int(np.argmin(np.abs(downbeats - t)))
        sections.append({"id": name, "t": round(float(downbeats[k]), 3)})

    analysis = {
        "duration": round(duration, 3),
        "fps": FPS, "sr": SR, "hop": HOP,
        "waveFps": wave_fps, "specBands": 64, "specFps": round(FPS, 3),
        "bpm": round(bpm, 3), "beatPeriod": round(period, 5),
        "beatPhase": round(phase, 4), "beatConcentration": round(conc, 3),
        "beats": [round(float(b), 3) for b in beats],
        "downbeats": [round(float(b), 3) for b in downbeats],
        "accents": accents,
        "accentChannels": list(BANDS.keys()),
        "events": events,
        "tempoCurve": tempo_curve,
        "sections": sections,
        "channels": ENV_CHANNELS,
        "charsPerSecond": cps,
    }
    with open(os.path.join(DATA, "analysis.json"), "w", encoding="utf-8") as fh:
        json.dump(analysis, fh, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATA, "lyrics.json"), "w", encoding="utf-8") as fh:
        json.dump({"lines": lyrics}, fh, ensure_ascii=False, separators=(",", ":"))
    print("wrote data/analysis.json, data/env.bin, data/lyrics.json")


if __name__ == "__main__":
    main()
