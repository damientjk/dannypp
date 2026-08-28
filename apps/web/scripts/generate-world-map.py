#!/usr/bin/env python3
"""Author the world's Tiled JSON map: two walled houses (with one door-gap
each) connected by an open common corridor along the bottom. One-off asset
build — re-run only if the room layout changes.

Grid (22 wide x 13 tall, TILE=32px):
  House A exterior rect: x 0-8,  y 0-6 (interior floor x 1-7,  y 1-5; door gap x 4, y 6)
  House B exterior rect: x 13-21, y 0-6 (interior floor x 14-20, y 1-5; door gap x 17, y 6)
  Gap between houses (x 9-12, y 0-6): unfloored, marked non-walkable
  Common corridor: x 0-21, y 7-12, fully open floor

Usage: python3 generate-world-map.py
"""
import json
from pathlib import Path

WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"

WIDTH, HEIGHT, TILE = 22, 13, 32

GID_BLANK = 0
GID_COMMON_FLOOR = 1
GID_HOUSE_A_FLOOR = 2
GID_HOUSE_B_FLOOR = 3
GID_WALL = 4


def rect_cells(x0, y0, x1, y1):
    """Inclusive tile coordinates in the [x0,x1] x [y0,y1] rect."""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            yield x, y


def is_ring(x, y, x0, y0, x1, y1):
    return x in (x0, x1) or y in (y0, y1)


def build_layer(fill):
    """fill: dict[(x,y)] -> gid, sparse; everything else is GID_BLANK."""
    data = [GID_BLANK] * (WIDTH * HEIGHT)
    for (x, y), gid in fill.items():
        data[y * WIDTH + x] = gid
    return data


def main() -> None:
    house_a = (0, 0, 8, 6)  # x0,y0,x1,y1 exterior rect
    house_b = (13, 0, 21, 6)
    house_a_door = (4, 6)
    house_b_door = (17, 6)

    floor_fill = {}
    walls_fill = {}
    collision_fill = {}

    # House interiors + wall rings (ring minus the door-gap tile).
    for (x0, y0, x1, y1), door, floor_gid in (
        (house_a, house_a_door, GID_HOUSE_A_FLOOR),
        (house_b, house_b_door, GID_HOUSE_B_FLOOR),
    ):
        for x, y in rect_cells(x0, y0, x1, y1):
            if (x, y) == door:
                floor_fill[(x, y)] = floor_gid
                continue
            if is_ring(x, y, x0, y0, x1, y1):
                walls_fill[(x, y)] = GID_WALL
                collision_fill[(x, y)] = GID_WALL
            else:
                floor_fill[(x, y)] = floor_gid

    # Gap between the two houses (x 9-12, y 0-6): no floor, blocked.
    for x in range(9, 13):
        for y in range(0, 7):
            collision_fill[(x, y)] = GID_WALL

    # Common corridor: fully open floor, no walls.
    for x, y in rect_cells(0, 7, WIDTH - 1, HEIGHT - 1):
        floor_fill[(x, y)] = GID_COMMON_FLOOR

    def tile_obj(name, x, y):
        return {"name": name, "x": x * TILE, "y": y * TILE}

    def zone_obj(name, x0, y0, x1, y1):
        return {
            "name": name,
            "x": x0 * TILE,
            "y": y0 * TILE,
            "width": (x1 - x0 + 1) * TILE,
            "height": (y1 - y0 + 1) * TILE,
        }

    tiled_map = {
        "width": WIDTH,
        "height": HEIGHT,
        "tilewidth": TILE,
        "tileheight": TILE,
        "tilesets": [
            {
                "firstgid": 1,
                "image": "tileset.png",
                "columns": 5,
                "tilewidth": TILE,
                "tileheight": TILE,
                "tilecount": 5,
            }
        ],
        "layers": [
            {"name": "floor", "type": "tilelayer", "data": build_layer(floor_fill)},
            {"name": "walls", "type": "tilelayer", "data": build_layer(walls_fill)},
            {"name": "collision", "type": "tilelayer", "data": build_layer(collision_fill)},
            {
                "name": "spawn-points",
                "type": "objectgroup",
                "objects": [
                    tile_obj("common", 10, 9),
                    tile_obj("house-a-door", *house_a_door),
                    tile_obj("house-b-door", *house_b_door),
                ],
            },
            {
                "name": "zones",
                "type": "objectgroup",
                "objects": [
                    zone_obj("house-a", 1, 1, 7, 5),
                    zone_obj("house-b", 14, 1, 20, 5),
                    zone_obj("common", 0, 7, WIDTH - 1, HEIGHT - 1),
                ],
            },
        ],
    }

    out_path = WORLD_ASSETS / "map.json"
    out_path.write_text(json.dumps(tiled_map, indent=2))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
