#!/usr/bin/env python3
"""Composite the world's 5-tile Tiled tileset from moderninteriors-win art
plus the already-cropped floor textures. One-off asset build — re-run only
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
WALL_TILE_COL, WALL_TILE_ROW = 7, 2  # solid tan wall block, verified visually

FLOOR_SOURCES = [
    WORLD_ASSETS / "rooms" / "common-floor.png",
    WORLD_ASSETS / "rooms" / "house-a-floor.png",
    WORLD_ASSETS / "rooms" / "house-b-floor.png",
]


def main() -> None:
    room_builder = Image.open(ROOM_BUILDER).convert("RGBA")
    wall_tile = room_builder.crop((
        WALL_TILE_COL * TILE,
        WALL_TILE_ROW * TILE,
        WALL_TILE_COL * TILE + TILE,
        WALL_TILE_ROW * TILE + TILE,
    ))

    tiles = [Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))]  # gid 0 unused/blank
    for path in FLOOR_SOURCES:
        tiles.append(Image.open(path).convert("RGBA"))
    tiles.append(wall_tile)

    sheet = Image.new("RGBA", (TILE * len(tiles), TILE), (0, 0, 0, 0))
    for i, tile in enumerate(tiles):
        sheet.paste(tile, (i * TILE, 0))

    out_path = WORLD_ASSETS / "tileset.png"
    sheet.save(out_path)
    print(f"wrote {out_path} ({sheet.size[0]}x{sheet.size[1]}, {len(tiles)} tiles)")


if __name__ == "__main__":
    main()
