#!/usr/bin/env python3
"""Composite the world's 11-tile tileset from moderninteriors-win art: 7 room
floor textures, 1 wall block, 1 desk/computer prop, 1 decorative rug — all
cropped directly from the source sheets. One-off asset build — re-run only
if the source art or tile choices change.

Usage: python3 generate-world-tileset.py
"""
from pathlib import Path
from PIL import Image

REPO_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "moderninteriors-win").is_dir())
MODERNINTERIORS = REPO_ROOT / "moderninteriors-win"
WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"

TILE = 32

ROOM_BUILDER = MODERNINTERIORS / "1_Interiors" / "32x32" / "Room_Builder_32x32.png"
THEME_SORTER = MODERNINTERIORS / "1_Interiors" / "32x32" / "Theme_Sorter_32x32"
GENERIC = THEME_SORTER / "1_Generic_32x32.png"
BATHROOM = THEME_SORTER / "3_Bathroom_32x32.png"

# (source sheet, col, row) — each verified visually (Step 2): cropped, scaled
# up, and read back to confirm a clean, distinct texture rather than a grid
# separator/label row or a fragment of a neighboring multi-tile object. The
# Room_Builder sheet packs each floor swatch as an (odd, even) row pair where
# the odd row is a label/margin row (mostly white) — the even row below it is
# the actual flat texture, which is what every FLOOR_TILES entry below uses.
WALL_TILE = (ROOM_BUILDER, 7, 2)
FLOOR_TILES = [
    (ROOM_BUILDER, 16, 26),  # hallway — warm brown
    (ROOM_BUILDER, 4, 15),   # auth-module — neutral grey
    (ROOM_BUILDER, 30, 54),  # kitchen — orange
    (ROOM_BUILDER, 0, 24),   # database — pale tan
    (ROOM_BUILDER, 15, 43),  # billing — rose/mauve
    (ROOM_BUILDER, 4, 35),   # living-room — light wood tan
    (ROOM_BUILDER, 24, 55),  # deploy-config — warm gold wood
]
# Desk+monitor: Room_Builder's own (3,4)/Interiors (3,4) coordinates land
# mid-object (a monitor top fused with an unrelated green tile below it), so
# this uses Theme_Sorter's Generic sheet instead. The clean sprite there
# isn't grid-aligned to its row — it sits 20px into row 1's cell — so it's
# cropped by exact pixel box rather than the col/row grid helper.
DESK_SHEET = GENERIC
DESK_BOX = (6 * TILE, 20, 6 * TILE + TILE, 20 + TILE)  # computer + desk, pixel-exact crop
RUG_TILE = (BATHROOM, 0, 3)  # small mat — Interiors (7,16) turned out to be a mid-object slice of a multi-tile area rug


def crop_tile(sheet_cache, source_path, col, row):
    if source_path not in sheet_cache:
        sheet_cache[source_path] = Image.open(source_path).convert("RGBA")
    sheet = sheet_cache[source_path]
    return sheet.crop((col * TILE, row * TILE, col * TILE + TILE, row * TILE + TILE))


def crop_box(sheet_cache, source_path, box):
    if source_path not in sheet_cache:
        sheet_cache[source_path] = Image.open(source_path).convert("RGBA")
    return sheet_cache[source_path].crop(box)


def main() -> None:
    sheet_cache = {}
    tiles = [Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))]  # gid 0: blank
    for source_path, col, row in FLOOR_TILES:
        tiles.append(crop_tile(sheet_cache, source_path, col, row))
    tiles.append(crop_tile(sheet_cache, *WALL_TILE))
    tiles.append(crop_box(sheet_cache, DESK_SHEET, DESK_BOX))
    tiles.append(crop_tile(sheet_cache, *RUG_TILE))

    sheet = Image.new("RGBA", (TILE * len(tiles), TILE), (0, 0, 0, 0))
    for i, tile in enumerate(tiles):
        sheet.paste(tile, (i * TILE, 0))

    out_path = WORLD_ASSETS / "tileset.png"
    sheet.save(out_path)
    print(f"wrote {out_path} ({sheet.size[0]}x{sheet.size[1]}, {len(tiles)} tiles)")


if __name__ == "__main__":
    main()
