#!/usr/bin/env python3
"""Composite the world's tileset: 1 hallway floor + 6 themed room floors +
1 wall block (3D-shaded) + a 2-tile window pair -- all cropped from
moderninteriors-win. Room furniture no longer lives here; see
generate-room-decor.py for the freeform decor/equipment sprites this
tileset used to carry as GIDs (desk, rug, plant).

Usage: python3 generate-world-tileset.py
"""
import sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from room_layout import ROOMS

REPO_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "moderninteriors-win").is_dir())
MODERNINTERIORS = REPO_ROOT / "moderninteriors-win"
WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"

TILE = 32
ROOM_BUILDER = MODERNINTERIORS / "1_Interiors" / "32x32" / "Room_Builder_32x32.png"
FLOORS_SHEET = MODERNINTERIORS / "1_Interiors" / "32x32" / "Room_Bulder_subfiles_32x32" / "Room_Builder_Floors_32x32.png"
GENERIC = MODERNINTERIORS / "1_Interiors" / "32x32" / "Theme_Sorter_32x32" / "1_Generic_32x32.png"

# Unchanged from the original tileset -- same verified-working crops.
HALLWAY_TILE = (ROOM_BUILDER, 16, 26)
WALL_TILE = (ROOM_BUILDER, 7, 2)
WINDOW_LEFT_TILE = (GENERIC, 5, 8)
WINDOW_RIGHT_TILE = (GENERIC, 6, 8)


def crop_tile(cache, path, col, row):
    if path not in cache:
        cache[path] = Image.open(path).convert("RGBA")
    sheet = cache[path]
    return sheet.crop((col * TILE, row * TILE, col * TILE + TILE, row * TILE + TILE))


def shade_wall(tile):
    """Synthesized highlight/shadow coping band so the flat Room_Builder
    wall block reads as a wall with height. Unchanged from the original
    script -- see its docstring for why this is synthesized rather than
    found (no 32x32 pre-shaded wall set exists in the pack)."""
    shaded = tile.copy()
    px = shaded.load()
    w, h = shaded.size
    top_band, bottom_band = 7, 5
    for y in range(h):
        if y < top_band:
            factor = 1.18
        elif y >= h - bottom_band:
            factor = 0.72
        else:
            continue
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            px[x, y] = (min(255, int(r * factor)), min(255, int(g * factor)), min(255, int(b * factor)), a)
    return shaded


def main() -> None:
    cache = {}
    tiles = [Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))]  # gid 0: blank
    tiles.append(crop_tile(cache, *HALLWAY_TILE))              # gid 1
    for room in ROOMS:                                         # gids 2-7, in ROOMS order
        sheet_name, col, row = room["floor"]
        sheet_path = FLOORS_SHEET if sheet_name == "Room_Builder_Floors" else ROOM_BUILDER
        tiles.append(crop_tile(cache, sheet_path, col, row))
    wall_tile = shade_wall(crop_tile(cache, *WALL_TILE))
    tiles.append(wall_tile)                                    # gid 8
    tiles.append(Image.alpha_composite(wall_tile.copy(), crop_tile(cache, *WINDOW_LEFT_TILE)))   # gid 9
    tiles.append(Image.alpha_composite(wall_tile.copy(), crop_tile(cache, *WINDOW_RIGHT_TILE)))  # gid 10

    sheet = Image.new("RGBA", (TILE * len(tiles), TILE), (0, 0, 0, 0))
    for i, tile in enumerate(tiles):
        sheet.paste(tile, (i * TILE, 0))

    out_path = WORLD_ASSETS / "tileset.png"
    sheet.save(out_path)
    print(f"wrote {out_path} ({sheet.size[0]}x{sheet.size[1]}, {len(tiles)} tiles)")


if __name__ == "__main__":
    main()
