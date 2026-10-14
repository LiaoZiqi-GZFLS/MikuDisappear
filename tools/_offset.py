#!/usr/bin/env python
"""How far ahead of the recording does the LRC run, by section?"""

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyze as A

x = A.decode(A.SONG)
mag = A.stft_mag(x)
freqs = np.fft.rfftfreq(A.NFFT, 1.0 / A.SR)
vox = A.norm(A.spectral_flux(mag, freqs, A.BANDS["vox"]))
full = A.norm(A.spectral_flux(mag))
lyrics = json.load(open(os.path.join(A.DATA, "lyrics.json"), encoding="utf-8"))["lines"]

offs = np.arange(-0.36, 0.3601, 0.01)


def best_offset(sel, env, key="start"):
    curve = []
    for off in offs:
        s, n = 0.0, 0
        for l in sel:
            i = int((l[key] + off) * A.FPS)
            if 0 <= i < len(env):
                s += env[i]
                n += 1
        curve.append(s / max(n, 1))
    curve = np.array(curve)
    k = int(np.argmax(curve))
    return offs[k], curve[k], curve[np.argmin(np.abs(offs))]


groups = [
    ("all lines", [l for l in lyrics if l["kind"] == "line"]),
    ("fast verses (25-42, 121-140, 225-256)", [l for l in lyrics if l["kind"] == "line"
                                               and (25 < l["start"] < 42 or 121 < l["start"] < 140
                                                    or 225 < l["start"] < 256)]),
    ("chorus (73-104, 177-209)", [l for l in lyrics if l["kind"] == "line"
                                  and (73 < l["start"] < 104 or 177 < l["start"] < 209)]),
    ("spoken (58-73, 139-177, 209-225)", [l for l in lyrics if l["kind"] in ("line", "spoken")
                                          and (58 < l["start"] < 73 or 139 < l["start"] < 177
                                               or 209 < l["start"] < 225)]),
]
for name, sel in groups:
    off, peak, zero = best_offset(sel, vox, "start")
    off2, peak2, zero2 = best_offset(sel, vox, "lrcT")
    print("%-38s n=%2d  snapped peak %+.2f (%.3f)   from LRC peak %+.2f (%.3f)"
          % (name, len(sel), off, peak, off2, peak2))

# same, using the broadband envelope
for name, sel in groups[:2]:
    off, peak, zero = best_offset(sel, full)
    print("  [broadband] %-26s peak %+.2f s (%.3f vs %.3f)" % (name, off, peak, zero))
