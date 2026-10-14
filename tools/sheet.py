#!/usr/bin/env python
"""Tile QA stills into one contact sheet: python tools/sheet.py out/qa out/qa/sheet.png"""

import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.image as mpimg
import matplotlib.pyplot as plt


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "out/qa"
    dest = sys.argv[2] if len(sys.argv) > 2 else os.path.join(src, "sheet.png")
    cols = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    files = sorted(f for f in os.listdir(src) if f.endswith(".png") and "sheet" not in f and f != "boot-fail.png")
    if not files:
        sys.exit("no pngs in " + src)
    rows = (len(files) + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 6.6, rows * 3.9), facecolor="#111")
    axes = axes.reshape(-1) if hasattr(axes, "reshape") else [axes]
    for i, f in enumerate(files):
        ax = axes[i]
        ax.imshow(mpimg.imread(os.path.join(src, f)))
        ax.set_title(f.replace(".png", "").replace("t", "t="), fontsize=9, color="#bbb")
        ax.axis("off")
    for j in range(len(files), len(axes)):
        axes[j].axis("off")
    plt.tight_layout(pad=0.6)
    plt.savefig(dest, dpi=70, facecolor="#111")
    print("wrote", dest, "(%d frames)" % len(files))


if __name__ == "__main__":
    main()
