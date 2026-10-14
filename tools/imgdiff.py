#!/usr/bin/env python
"""Pixel-wise comparison of two folders of same-named PNGs.

The film's regression evidence is "which frames changed", not "it looks the
same". This tool answers that question the only way that is cheap and honest:
mean absolute difference per channel, on frames rendered at identical
viewports.

  python tools/imgdiff.py out/qa-18ch-v15cmp out/qa-18ch-step58
  python tools/imgdiff.py a b --max 0.5      # non-zero exit above the bar
  python tools/imgdiff.py a.png b.png

Prints one line per pair: MAD, max channel difference and the fraction of
pixels that differ at all. Pairs whose MAD is 0.0000 printed as `same`.
"""

import os
import sys

import numpy as np
from PIL import Image


def load(path):
    im = Image.open(path).convert("RGB")
    return np.asarray(im, dtype=np.int16)


def one(a_path, b_path, label):
    a, b = load(a_path), load(b_path)
    if a.shape != b.shape:
        print("  FAIL %-28s shape %s vs %s" % (label, a.shape, b.shape))
        return False, None
    d = np.abs(a - b)
    mad = float(d.mean())
    mx = int(d.max())
    moved = float((d.max(axis=2) > 0).mean())
    tag = "same" if mx == 0 else ("~" if mad < 0.05 else "**")
    print("  %s %-28s MAD %8.4f  max %4d  changed %6.3f%%"
          % (tag, label, mad, mx, moved * 100.0))
    return mx == 0, mad


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    bar = None
    if "--max" in sys.argv:
        bar = float(sys.argv[sys.argv.index("--max") + 1])

    if len(args) != 2:
        print(__doc__)
        return 2

    a, b = args
    pairs = []
    if os.path.isdir(a) and os.path.isdir(b):
        names = sorted(set(os.listdir(a)) & set(os.listdir(b)))
        names = [n for n in names if n.lower().endswith(".png")]
        if not names:
            print("no shared PNGs in %s and %s" % (a, b))
            return 2
        pairs = [(os.path.join(a, n), os.path.join(b, n), n) for n in names]
    else:
        pairs = [(a, b, os.path.basename(a))]

    same, worst, bad = 0, 0.0, 0
    for p, q, label in pairs:
        identical, mad = one(p, q, label)
        if identical:
            same += 1
        if mad is not None:
            worst = max(worst, mad)
            if bar is not None and mad > bar:
                bad += 1

    print("%d pairs, %d identical, worst MAD %.4f" % (len(pairs), same, worst))
    if bar is not None and bad:
        print("imgdiff FAILED (%d over %.4f)" % (bad, bar))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
