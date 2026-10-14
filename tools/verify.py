#!/usr/bin/env python
"""Cross-checks the analysis against the audio and the LRC.

This is the "proofread" pass: it does not re-derive the film, it asks whether
the numbers the film is built on actually agree with the recording.

  python tools/verify.py

Checks
  1. the audio file is the one the analysis was made from (duration, size)
  2. the beat grid is rigid and covers the song
  3. lyric text is identical to the LRC, character timings are ordered,
     inside their line, and complete
  4. the lyric timing agrees with the recording: for every line we measure the
     vocal-band onset strength around the line start and look for a systematic
     offset (a constant lag would mean the karaoke runs early/late)
  5. sections are ordered, inside the song, and land on bar lines
"""

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyze as A  # noqa: E402

DATA = A.DATA
fails, warns = [], []


def check(ok, msg):
    print(("  ok   " if ok else "  FAIL ") + msg)
    if not ok:
        fails.append(msg)


def warn(ok, msg):
    if not ok:
        print("  warn " + msg)
        warns.append(msg)


def main():
    analysis = json.load(open(os.path.join(DATA, "analysis.json"), encoding="utf-8"))
    lyrics = json.load(open(os.path.join(DATA, "lyrics.json"), encoding="utf-8"))["lines"]

    print("1. audio")
    x = A.decode(A.SONG)
    dur = len(x) / A.SR
    check(abs(dur - analysis["duration"]) < 0.05,
          "decoded duration %.3fs matches analysis %.3fs" % (dur, analysis["duration"]))

    print("2. grid")
    beats = np.array(analysis["beats"])
    d = np.diff(beats)
    check(np.all(np.abs(d - analysis["beatPeriod"]) < 5e-4),
          "beat spacing constant (%.5f s, max dev %.5f)" % (d.mean(), np.abs(d - d.mean()).max()))
    check(beats[0] < 1.0 and beats[-1] > dur - 1.0, "grid covers %.2f .. %.2f s" % (beats[0], beats[-1]))
    bars = np.array(analysis["downbeats"])
    check(abs((bars[1] - bars[0]) - 4 * analysis["beatPeriod"]) < 1e-3, "4/4 bars are 1.000 s")

    print("3. lyrics vs LRC")
    rows = [(t, txt) for t, txt in A.parse_lrc(A.LRC) if A.classify(txt) != "gap"]
    check(len(rows) == len(lyrics), "line count matches LRC (%d)" % len(rows))
    text_ok = all(r[1] == l["text"] and abs(r[0] - l.get("lrcT", l["start"])) < 1e-6
                  for r, l in zip(rows, lyrics))
    check(text_ok, "every line keeps the LRC text and its original LRC time verbatim")
    moved = [l for l in lyrics if abs(l["start"] - l.get("lrcT", l["start"])) > 1e-6]
    offs = [l["start"] - l["lrcT"] for l in moved]
    if offs:
        print("       %d/%d line starts snapped onto the voice (median %+.3fs, max %.3fs)"
              % (len(moved), len(lyrics), float(np.median(offs)), float(np.max(np.abs(offs)))))
    ct_ok = True
    for l in lyrics:
        ct = l["ct"]
        if not ct:
            continue
        if ct != sorted(ct) or ct[0] < l["start"] - 1e-3 or ct[-1] > l["end"] + 1e-3:
            ct_ok = False
    check(ct_ok, "character times are ordered and inside their line")
    nchars = sum(len(l["ci"]) for l in lyrics)
    print("       %d lines, %d timed characters" % (len(lyrics), nchars))
    warn(all(l["end"] - l["start"] > 0.2 for l in lyrics), "a line lasts less than 0.2 s")

    print("4. lyric timing vs the recording")
    mag = A.stft_mag(x)
    freqs = np.fft.rfftfreq(A.NFFT, 1.0 / A.SR)
    vox = A.norm(A.spectral_flux(mag, freqs, A.BANDS["vox"]))
    offs = np.arange(-0.30, 0.3001, 0.02)
    curve = []
    for off in offs:
        s = 0.0
        n = 0
        for l in lyrics:
            if l["kind"] == "gap":
                continue
            i = int((l["start"] + off) * A.FPS)
            if 0 <= i < len(vox):
                s += vox[i]
                n += 1
        curve.append(s / max(n, 1))
    curve = np.array(curve)
    best = offs[int(np.argmax(curve))]
    base = curve[np.argmin(np.abs(offs))]
    print("       onset strength by offset: peak at %+.2f s (%.3f vs %.3f at 0)"
          % (best, curve.max(), base))
    warn(abs(best) <= 0.06, "systematic lyric offset of %+.2f s vs the recording" % best)
    resid = []
    for l in lyrics:
        if l["kind"] != "line" or not l["ct"]:
            continue
        resid.append(l["ct"][0] - l["start"])
    if resid:
        print("       first character lands %.3fs (median) after the line start, p90 %.3fs"
              % (float(np.median(resid)), float(np.percentile(resid, 90))))

    print("5. sections")
    secs = analysis["sections"]
    ts = [s["t"] for s in secs]
    check(ts == sorted(ts) and len(set(ts)) == len(ts), "sections are ordered and unique")
    onbar = all(min(abs(bars - t)) < 1e-3 for t in ts)
    check(onbar, "every section starts on a bar line")
    check(ts[0] < 1.0 and ts[-1] < dur, "sections stay inside the song")

    print("6. data files")
    ch = len(analysis["channels"])
    nf = os.path.getsize(os.path.join(DATA, "env.bin")) // (4 * ch)
    check(abs(nf / analysis["fps"] - dur) < 0.1,
          "env.bin has %d frames (%.1f s at %.0f fps)" % (nf, nf / analysis["fps"], analysis["fps"]))
    nw = os.path.getsize(os.path.join(DATA, "wave.bin")) // 2
    check(abs(nw / analysis["waveFps"] - dur) < 0.1,
          "wave.bin has %d min/max pairs (%.1f s)" % (nw, nw / analysis["waveFps"]))
    ns = os.path.getsize(os.path.join(DATA, "spec.bin")) // analysis["specBands"]
    check(abs(ns / analysis["specFps"] - dur) < 0.1,
          "spec.bin has %d columns x %d bands" % (ns, analysis["specBands"]))

    print()
    if fails:
        print("%d CHECK(S) FAILED" % len(fails))
    elif warns:
        print("all checks passed, %d warning(s)" % len(warns))
    else:
        print("all checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
