#!/usr/bin/env python3
"""Mosaic a folder of unlabeled Theme_Sorter_Singles PNGs into one labeled
contact sheet, so a person can eyeball which numbered file is which. Each
source PNG keeps its own aspect ratio (Singles are pre-trimmed to each
item's own bounding box, not a uniform grid) but is thumbnailed onto a fixed
cell and labeled with the tail of its filename.

Usage:
  python3 asset_contact_sheet.py <folder> <out.png> [--start N] [--count N] [--cols N]

Example:
  python3 asset_contact_sheet.py \\
    "../../moderninteriors-win/1_Interiors/32x32/Theme_Sorter_Singles_32x32/5_Classroom_and_Library_Singles_32x32" \\
    /tmp/library_0-59.png --start 0 --count 60
"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw

CELL = 96
LABEL_H = 14


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("folder")
    p.add_argument("out")
    p.add_argument("--start", type=int, default=0)
    p.add_argument("--count", type=int, default=100)
    p.add_argument("--cols", type=int, default=10)
    args = p.parse_args()

    files = sorted(Path(args.folder).glob("*.png"), key=lambda f: f.name)
    chunk = files[args.start : args.start + args.count]
    if not chunk:
        print(f"no files in range {args.start}-{args.start + args.count} (folder has {len(files)})")
        return

    cols = args.cols
    rows = (len(chunk) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * CELL, rows * (CELL + LABEL_H)), (30, 30, 30, 255))
    draw = ImageDraw.Draw(sheet)
    for i, f in enumerate(chunk):
        img = Image.open(f).convert("RGBA")
        img.thumbnail((CELL - 8, CELL - 8))
        col, row = i % cols, i // cols
        x, y = col * CELL, row * (CELL + LABEL_H)
        sheet.paste(img, (x + 4, y + 4), img)
        draw.text((x + 2, y + CELL), f.stem, fill=(255, 255, 0, 255))
    sheet.save(args.out)
    print(f"wrote {args.out}: files {args.start}-{args.start + len(chunk) - 1} of {len(files)}")


if __name__ == "__main__":
    main()
