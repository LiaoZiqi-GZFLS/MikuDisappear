#!/usr/bin/env python
"""Turn a real image into the film's ASCII portrait data.

The renderer never sees a bitmap: this tool samples the picture on a glyph
grid and writes characters + palette codes, which src/ascii.js prints with the
shipped monospace font. That keeps the film's rule intact (every frame is
drawn from code) while the portrait itself comes from a real photograph or
illustration.

  python tools/ascii-import.py assets/ref/miku.png data/ascii/miku-face.json \
      --crop 0.28,0.02,0.72,0.62 --cols 132 --background auto --gamma 0.95

Options
  --crop l,t,r,b   normalised box of the source to sample (default: whole image)
  --cols N         grid columns; rows follow the monospace cell aspect (0.6)
  --ramp "..."     density ramp, sparse -> dense
  --gamma G        tone curve applied before sampling
  --contrast C     sigmoid contrast around the mid grey
  --black/--white  input levels, 0..1
  --background     auto | none | black | white  (auto cuts edge-connected flats)
  --bg-thresh T    how close to the background colour counts as background
  --min-density D  drop cells darker than D (keeps the glyph field readable)
"""

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The film's palette. Anything the image contains is snapped to one of these,
# so the portrait belongs to the same world as the rest of the picture.
PALETTE = [
    ("miku", (0x39, 0xC5, 0xBB)),
    ("mikuHi", (0x9F, 0xF4, 0xE8)),
    ("tealDeep", (0x0D, 0x3D, 0x40)),
    ("bone", (0xEE, 0xF1, 0xEC)),
    ("ash", (0x9D, 0xAB, 0xB1)),
    ("dim", (0x6B, 0x7A, 0x82)),
    ("slate", (0x16, 0x1D, 0x23)),
    ("ink2", (0x0B, 0x0F, 0x14)),
    ("red", (0xFF, 0x2F, 0x3C)),
    ("amber", (0xF0, 0xA9, 0x4E)),
    ("leek", (0x8E, 0xD1, 0x4A)),
]
PALETTE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

DEFAULT_RAMP = " .,:;-=+*#%@"


def load(path, crop, blur):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    if crop:
        l, t, r, b = crop
        img = img.crop((int(l * w), int(t * h), int(r * w), int(b * h)))
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    return img


def sample_grid(img, cols, ramps):
    """Average the source over each glyph cell, keeping colour and luminance."""
    w, h = img.size
    cell_aspect = 0.6                      # IBM Plex Mono advance / line height
    rows = max(8, int(round(cols * cell_aspect * (h / w))))
    arr = np.asarray(img).astype(np.float32) / 255.0
    # box-average the source down to the grid (area filter = correct sampling)
    resample = getattr(Image, "Resampling", Image).BOX
    small = np.asarray(
        Image.fromarray((arr * 255).astype(np.uint8)).resize((cols, rows), resample)
    ).astype(np.float32) / 255.0
    lum = 0.2126 * small[:, :, 0] + 0.7152 * small[:, :, 1] + 0.0722 * small[:, :, 2]
    return small, lum, rows


def cut_background(arr, lum, mode, thresh):
    """Return a boolean mask of cells that belong to the subject."""
    if mode == "none":
        return np.ones_like(lum, dtype=bool)
    if mode in ("black", "white"):
        flat = (lum < thresh) if mode == "black" else (lum > 1 - thresh)
    else:
        # auto: the most common border colour is the background; anything close
        # to it *and* connected to the border is cut.
        border = np.concatenate([
            arr[0, :, :], arr[-1, :, :], arr[:, 0, :], arr[:, -1, :],
        ])
        # quantise the border to 16 levels to find the dominant flat colour
        q = np.round(border * 15).astype(int)
        keys, counts = np.unique(q, axis=0, return_counts=True)
        bg = keys[np.argmax(counts)] / 15.0
        dist = np.linalg.norm(arr - bg, axis=2)
        flat = dist < thresh
    mask = ~flat
    # keep only the flat region that touches the border; holes inside stay
    reach = np.zeros_like(mask, dtype=bool)
    reach[0, :] = ~mask[0, :]
    reach[-1, :] = ~mask[-1, :]
    reach[:, 0] = ~mask[:, 0]
    reach[:, -1] = ~mask[:, -1]
    for _ in range(400):
        grown = reach.copy()
        grown[1:, :] |= reach[:-1, :]
        grown[:-1, :] |= reach[1:, :]
        grown[:, 1:] |= reach[:, :-1]
        grown[:, :-1] |= reach[:, 1:]
        grown &= ~mask
        if grown.sum() == reach.sum():
            break
        reach = grown
    return mask | ~flat & ~reach


def to_palette(arr):
    """Snap every cell to the film palette, return letter grid + rgb."""
    pal = np.array([c for _, c in PALETTE], dtype=np.float32) / 255.0
    h, w, _ = arr.shape
    flat = arr.reshape(-1, 3)
    # weight hue more than absolute brightness: teal must stay teal
    mx = flat.max(axis=1, keepdims=True)
    mn = flat.min(axis=1, keepdims=True)
    sat = mx - mn
    f_norm = flat / np.maximum(mx, 1e-4)
    p_norm = pal / np.maximum(pal.max(axis=1, keepdims=True), 1e-4)
    d = np.linalg.norm(f_norm[:, None, :] - p_norm[None, :, :], axis=2) * 1.6
    d += np.abs(flat.mean(axis=1)[:, None] - pal.mean(axis=1)[None, :]) * 0.8
    d -= sat * 0.25
    idx = np.argmin(d, axis=1)
    return idx.reshape(h, w)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--crop", default=None)
    ap.add_argument("--cols", type=int, default=120)
    ap.add_argument("--ramp", default=DEFAULT_RAMP)
    ap.add_argument("--gamma", type=float, default=1.0)
    ap.add_argument("--contrast", type=float, default=1.0)
    ap.add_argument("--black", type=float, default=0.0)
    ap.add_argument("--white", type=float, default=1.0)
    ap.add_argument("--background", default="auto",
                    choices=["auto", "none", "black", "white"])
    ap.add_argument("--bg-thresh", type=float, default=0.18)
    ap.add_argument("--min-density", type=float, default=0.0)
    ap.add_argument("--blur", type=float, default=0.0)
    ap.add_argument("--invert", action="store_true")
    ap.add_argument("--note", default="")
    ap.add_argument("--debug-png", default=None,
                    help="write the sampled grid back as a small PNG for tuning")
    a = ap.parse_args()

    crop = None
    if a.crop:
        crop = tuple(float(v) for v in a.crop.split(","))
        if len(crop) != 4:
            sys.exit("--crop needs l,t,r,b")

    img = load(a.src, crop, a.blur)
    arr, lum, rows = sample_grid(img, a.cols, a.ramp)

    # levels + tone
    lum = np.clip((lum - a.black) / max(1e-4, a.white - a.black), 0, 1)
    if a.invert:
        lum = 1.0 - lum
    lum = np.power(lum, a.gamma)
    if a.contrast != 1.0:
        lum = 1.0 / (1.0 + np.exp(-(lum - 0.5) * 4.0 * a.contrast))
        lum = (lum - lum.min()) / max(1e-4, lum.max() - lum.min())

    keep = cut_background(arr, lum, a.background, a.bg_thresh)
    pal_idx = to_palette(arr)

    ramp = a.ramp
    n = len(ramp) - 1
    idx = np.clip(np.round(lum * n).astype(int), 0, n)
    idx[lum < a.min_density] = 0
    idx[~keep] = 0

    chars = ["".join(ramp[v] for v in row) for row in idx]
    colors = ["".join(PALETTE_LETTERS[v] for v in row) for row in pal_idx]

    total = sum(1 for r in chars for c in r if c != " ")
    data = {
        "source": os.path.basename(a.src),
        "note": a.note,
        "cols": a.cols,
        "rows": rows,
        "cellAspect": 0.6,
        "ramp": ramp,
        "palette": {PALETTE_LETTERS[i]: PALETTE[i][0] for i in range(len(PALETTE))},
        "chars": chars,
        "colors": colors,
        "coverage": round(total / (a.cols * rows), 4),
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print("%s  %dx%d cells, %d glyphs (%.0f%% covered), %.1f KB"
          % (a.out, a.cols, rows, total, 100 * data["coverage"],
             os.path.getsize(a.out) / 1024))

    if a.debug_png:
        # what the sampler actually sees: palette colour x tone, background cut
        pal = np.array([PALETTE[i][1] for i in range(len(PALETTE))], dtype=np.float32) / 255.0
        rgb = pal[pal_idx] * lum[:, :, None]
        rgb[~keep] = 0.0
        img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
        scale = max(2, 640 // max(1, a.cols))
        # the glyph cell is 0.6 as wide as it is tall: keep the debug honest
        img = img.resize((a.cols * scale, int(round(rows * scale / 0.6))),
                         getattr(Image, "Resampling", Image).NEAREST)
        os.makedirs(os.path.dirname(os.path.abspath(a.debug_png)), exist_ok=True)
        img.save(a.debug_png)
        print("debug  %s" % a.debug_png)


if __name__ == "__main__":
    main()
