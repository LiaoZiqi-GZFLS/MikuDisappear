#!/usr/bin/env python
"""Build the shipped webfont subsets.

Collects every character that can appear on screen (lyrics, source strings,
HTML) and subsets three OFL families down to just those glyphs:

  Noto Sans JP VF  -> assets/fonts/noto-jp-{400,700,900}.woff2
  Noto Serif JP VF -> assets/fonts/noto-serif-jp-600.woff2   (the elegy voice)
  IBM Plex Mono    -> assets/fonts/plex-mono-{400,600}.woff2

Source fonts: C:\\Windows\\Fonts\\NotoSansJP-VF.ttf and NotoSerifJP-VF.ttf (OFL),
plus the TTFs fetched into assets/fonts/src (OFL). All licences are shipped
alongside the subsets.
"""

import glob
import json
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.subset import Options, Subsetter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "fonts")
SRC = os.path.join(OUT, "src")
NOTO_VF = r"C:\Windows\Fonts\NotoSansJP-VF.ttf"
NOTO_SERIF_VF = r"C:\Windows\Fonts\NotoSerifJP-VF.ttf"

EXTRA = (
    " !\"#$%&'()*+,-./0123456789:;<=>?@"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`"
    "abcdefghijklmnopqrstuvwxyz{|}~"
    "\u00a1\u00a7\u00a9\u00ae\u00b0\u00b1\u00b7\u00d7\u00f7"
    "\u2010\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u2030\u2039\u203a\u2044"
    "\u2190\u2191\u2192\u2193\u2194\u2195\u21d2\u21d4"
    "\u2200\u2202\u2211\u221a\u221e\u2220\u222b\u2248\u2260\u2261\u2264\u2265"
    "\u25a0\u25a1\u25b2\u25b3\u25bc\u25bd\u25c6\u25cb\u25cf\u25ef\u2605\u2606"
    "\u266a\u266b\u2713\u2715\u2717\u2756\u3000\u3001\u3002"
    "\u300c\u300d\u300e\u300f\u3010\u3011\u301c\u30fb\u30fc\u309b\u309c"
    "\u2192\u21d2\u00b7\u00b0\u2601\u2602\u2603\u26a0\ufe0e\ufeff"
)


def collect():
    chars = set(EXTRA)
    with open(os.path.join(ROOT, "data", "lyrics.json"), encoding="utf-8") as fh:
        for line in json.load(fh)["lines"]:
            chars.update(line["text"])
    patterns = [
        os.path.join(ROOT, "src", "**", "*.js"),
        os.path.join(ROOT, "index.html"),
        os.path.join(ROOT, "tools", "*.mjs"),
    ]
    keep = []
    for pat in patterns:
        for path in glob.glob(pat, recursive=True):
            with open(path, encoding="utf-8", errors="ignore") as fh:
                keep.append(fh.read())
    blob = "\n".join(keep)
    for ch in blob:
        if ord(ch) > 127 or 32 <= ord(ch) < 127:
            chars.add(ch)
    chars.discard("\n")
    chars.discard("\t")
    chars.discard("\u3000")          # ideographic space: keep it, drop only if unused
    chars.add("\u3000")
    return "".join(sorted(chars))


def subset(src, dest, text, wght=None):
    font = TTFont(src)
    if wght is not None:
        font = instancer.instantiateVariableFont(font, {"wght": wght}, inplace=False)
    opts = Options()
    opts.flavor = "woff2"
    opts.layout_features = ["kern", "liga", "clig", "calt", "ccmp", "locl", "mark", "mkmk", "curs"]
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    opts.name_legacy = False
    opts.notdef_outline = True
    opts.recalc_bounds = True
    sub = Subsetter(options=opts)
    sub.populate(text=text)
    sub.subset(font)
    font.save(dest)
    print("%-34s %6.1f KB" % (os.path.basename(dest), os.path.getsize(dest) / 1024))


def main():
    os.makedirs(OUT, exist_ok=True)
    text = collect()
    print("subset charset: %d characters" % len(text))
    if not os.path.exists(NOTO_VF):
        sys.exit("missing %s" % NOTO_VF)
    for w, name in ((400, "noto-jp-400.woff2"), (700, "noto-jp-700.woff2"), (900, "noto-jp-900.woff2")):
        subset(NOTO_VF, os.path.join(OUT, name), text, w)
    if os.path.exists(NOTO_SERIF_VF):
        subset(NOTO_SERIF_VF, os.path.join(OUT, "noto-serif-jp-600.woff2"), text, 600)
    else:
        print("skip noto-serif-jp-600.woff2 (missing %s)" % NOTO_SERIF_VF)
    mono = os.path.join(SRC, "IBMPlexMono-Regular.ttf")
    if not os.path.exists(mono):
        mono = os.path.join(OUT, "_plex.tmp")
    for src, name in ((mono, "plex-mono-400.woff2"),
                      (os.path.join(SRC, "IBMPlexMono-SemiBold.ttf"), "plex-mono-600.woff2")):
        if os.path.exists(src):
            subset(src, os.path.join(OUT, name), text)
        else:
            print("skip %s (missing %s)" % (name, src))


if __name__ == "__main__":
    main()
