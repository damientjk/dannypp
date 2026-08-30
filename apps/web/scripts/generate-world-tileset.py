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
WALLS_SHEET = MODERNINTERIORS / "1_Interiors" / "32x32" / "Room_Bulder_subfiles_32x32" / "Room_Builder_Walls_32x32.png"
GENERIC = MODERNINTERIORS / "1_Interiors" / "32x32" / "Theme_Sorter_32x32" / "1_Generic_32x32.png"

# Unchanged from the original tileset -- same verified-working crops.
HALLWAY_TILE = (ROOM_BUILDER, 16, 26)
WINDOW_LEFT_TILE = (GENERIC, 5, 8)
WINDOW_RIGHT_TILE = (GENERIC, 6, 8)


def crop_tile(cache, path, col, row):
    if path not in cache:
        cache[path] = Image.open(path).convert("RGBA")
    sheet = cache[path]
    return sheet.crop((col * TILE, row * TILE, col * TILE + TILE, row * TILE + TILE))


def main() -> None:
    cache = {}
    tiles = [Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))]  # gid 0: blank
    tiles.append(crop_tile(cache, *HALLWAY_TILE))              # gid 1
    for room in ROOMS:                                         # gids 2-7, in ROOMS order
        sheet_name, col, row = room["floor"]
        sheet_path = FLOORS_SHEET if sheet_name == "Room_Builder_Floors" else ROOM_BUILDER
        tiles.append(crop_tile(cache, sheet_path, col, row))
    # Per-room wall: cap + base cropped from a real 2-row wall block in
    # Room_Builder_Walls_32x32.png (column 0, rows 2*wall/2*wall+1 -- see
    # room_layout.ROOMS' "wall" field), replacing the old single shared
    # tile + synthetic gradient. Appended in ROOMS order, 4 tiles per room
    # (cap, base, base+window-left, base+window-right) -- generate-world-map.py's
    # CAP_GID/BASE_GID/WINDOW_LEFT_GID/WINDOW_RIGHT_GID assume this exact order.
    for room in ROOMS:
        # Cap and base are now the SAME crop (row 2*wall+1, the plain wall
        # body -- not row 2*wall, which carries a pale decorative trim
        # stripe in its top ~12px meant for an interior wall segment, not
        # the outermost edge of this game's wall stack; see this file's
        # own history / the plan's Amendment 4 for how that was found).
        base_tile = crop_tile(cache, WALLS_SHEET, 0, room["wall"] * 2 + 1)
        cap_tile = base_tile.copy()
        tiles.append(cap_tile)
        tiles.append(base_tile)
        tiles.append(Image.alpha_composite(base_tile.copy(), crop_tile(cache, *WINDOW_LEFT_TILE)))
        tiles.append(Image.alpha_composite(base_tile.copy(), crop_tile(cache, *WINDOW_RIGHT_TILE)))

    sheet = Image.new("RGBA", (TILE * len(tiles), TILE), (0, 0, 0, 0))
    for i, tile in enumerate(tiles):
        sheet.paste(tile, (i * TILE, 0))

    out_path = WORLD_ASSETS / "tileset.png"
    sheet.save(out_path)
    print(f"wrote {out_path} ({sheet.size[0]}x{sheet.size[1]}, {len(tiles)} tiles)")


if __name__ == "__main__":
    main()
