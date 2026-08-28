#!/usr/bin/env python3
"""Author the world's Tiled JSON map: a two-row house, 6 rooms (2 owned by
each user, 2 common/no-permission), a central hallway connecting all of
them, and 2 desk spawn points per owned room. One-off asset build — re-run
only if the room layout changes.

Grid (35 wide x 20 tall, TILE=32px):
  Row 1 (y 0-6): Auth Module (x 0-8, door south at 4,6) | Kitchen (x 13-21,
    door south at 17,6) | Database (x 26-34, door south at 30,6)
  Hallway: y 7-12, full width, fully open
  Row 2 (y 13-19): Billing (x 0-8, door north at 4,13) | Living Room
    (x 13-21, door north at 17,13) | Deploy Config (x 26-34, door north
    at 30,13)
  Gaps between rooms in both rows (x 9-12, x 22-25): unfloored, blocked.

Usage: python3 generate-world-map.py
"""
import json
from pathlib import Path

WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"

WIDTH, HEIGHT, TILE = 35, 20, 32
ROOM_WIDTH, ROOM_HEIGHT = 9, 7

GID_BLANK = 0
GID_HALLWAY = 1
GID_AUTH_MODULE = 2
GID_KITCHEN = 3
GID_DATABASE = 4
GID_BILLING = 5
GID_LIVING_ROOM = 6
GID_DEPLOY_CONFIG = 7
GID_WALL = 8
GID_DESK = 9
GID_RUG = 10

ROOMS = [
    dict(id="auth-module", floor=GID_AUTH_MODULE, owner="user-a", row="top", x0=0),
    dict(id="kitchen", floor=GID_KITCHEN, owner=None, row="top", x0=13),
    dict(id="database", floor=GID_DATABASE, owner="user-b", row="top", x0=26),
    dict(id="billing", floor=GID_BILLING, owner="user-a", row="bottom", x0=0),
    dict(id="living-room", floor=GID_LIVING_ROOM, owner=None, row="bottom", x0=13),
    dict(id="deploy-config", floor=GID_DEPLOY_CONFIG, owner="user-b", row="bottom", x0=26),
]


def exterior_rect(room):
    x0 = room["x0"]
    x1 = x0 + ROOM_WIDTH - 1
    if room["row"] == "top":
        y0, y1 = 0, ROOM_HEIGHT - 1
    else:
        y0, y1 = HEIGHT - ROOM_HEIGHT, HEIGHT - 1
    return x0, y0, x1, y1


def door_tile(room):
    x0, y0, x1, y1 = exterior_rect(room)
    door_x = x0 + ROOM_WIDTH // 2
    door_y = y1 if room["row"] == "top" else y0
    return door_x, door_y


def rect_cells(x0, y0, x1, y1):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            yield x, y


def is_ring(x, y, x0, y0, x1, y1):
    return x in (x0, x1) or y in (y0, y1)


def build_layer(fill):
    data = [GID_BLANK] * (WIDTH * HEIGHT)
    for (x, y), gid in fill.items():
        data[y * WIDTH + x] = gid
    return data


def main() -> None:
    floor_fill, walls_fill, collision_fill, furniture_fill = {}, {}, {}, {}

    for room in ROOMS:
        x0, y0, x1, y1 = exterior_rect(room)
        door = door_tile(room)
        for x, y in rect_cells(x0, y0, x1, y1):
            if (x, y) == door:
                floor_fill[(x, y)] = room["floor"]
                continue
            if is_ring(x, y, x0, y0, x1, y1):
                walls_fill[(x, y)] = GID_WALL
                collision_fill[(x, y)] = GID_WALL
            else:
                floor_fill[(x, y)] = room["floor"]

    # Gaps between rooms, full height of each room row: unfloored, blocked.
    for row_y0, row_y1 in ((0, ROOM_HEIGHT - 1), (HEIGHT - ROOM_HEIGHT, HEIGHT - 1)):
        for gap_x0, gap_x1 in ((9, 12), (22, 25)):
            for x in range(gap_x0, gap_x1 + 1):
                for y in range(row_y0, row_y1 + 1):
                    collision_fill[(x, y)] = GID_WALL

    # Hallway: fully open floor, full width, no walls.
    hallway_y0, hallway_y1 = ROOM_HEIGHT, HEIGHT - ROOM_HEIGHT - 1
    for x, y in rect_cells(0, hallway_y0, WIDTH - 1, hallway_y1):
        floor_fill[(x, y)] = GID_HALLWAY

    # Desks: 2 per owned room, centered in its interior, with a matching
    # furniture-below sprite so a desk+computer is visibly there.
    desk_objects = []
    for room in ROOMS:
        if room["owner"] is None:
            continue
        x0, y0, x1, y1 = exterior_rect(room)
        desk_y = (y0 + y1) // 2
        for i, desk_x in enumerate((x0 + 2, x1 - 2), start=1):
            name = f"desk-{room['id']}-{i}"
            desk_objects.append((name, desk_x, desk_y))
            furniture_fill[(desk_x, desk_y)] = GID_DESK

    # Rugs: one decorative tile centered in each common room.
    for room in ROOMS:
        if room["owner"] is not None:
            continue
        x0, y0, x1, y1 = exterior_rect(room)
        furniture_fill[((x0 + x1) // 2, (y0 + y1) // 2)] = GID_RUG

    def tile_obj(name, x, y):
        return {"name": name, "x": x * TILE, "y": y * TILE}

    def zone_obj(room):
        x0, y0, x1, y1 = exterior_rect(room)
        return {
            "name": room["id"],
            "x": (x0 + 1) * TILE,
            "y": (y0 + 1) * TILE,
            "width": (ROOM_WIDTH - 2) * TILE,
            "height": (ROOM_HEIGHT - 2) * TILE,
        }

    spawn_objects = [tile_obj("common", 17, 9)]
    for room in ROOMS:
        door_x, door_y = door_tile(room)
        spawn_objects.append(tile_obj(f"{room['id']}-door", door_x, door_y))
    for name, x, y in desk_objects:
        spawn_objects.append(tile_obj(name, x, y))

    tiled_map = {
        "width": WIDTH,
        "height": HEIGHT,
        "tilewidth": TILE,
        "tileheight": TILE,
        "tilesets": [
            {
                "firstgid": 1,
                "image": "tileset.png",
                "columns": 11,
                "tilewidth": TILE,
                "tileheight": TILE,
                "tilecount": 11,
            }
        ],
        "layers": [
            {"name": "floor", "type": "tilelayer", "data": build_layer(floor_fill)},
            {"name": "walls", "type": "tilelayer", "data": build_layer(walls_fill)},
            {"name": "furniture-below", "type": "tilelayer", "data": build_layer(furniture_fill)},
            {"name": "collision", "type": "tilelayer", "data": build_layer(collision_fill)},
            {"name": "spawn-points", "type": "objectgroup", "objects": spawn_objects},
            {"name": "zones", "type": "objectgroup", "objects": [zone_obj(r) for r in ROOMS]},
        ],
    }

    out_path = WORLD_ASSETS / "map.json"
    out_path.write_text(json.dumps(tiled_map, indent=2))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
