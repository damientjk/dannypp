#!/usr/bin/env python3
"""Author the world's Tiled JSON map: 6 themed rooms (2 owned by each user,
1 common), connected by a central hallway. Uniform 11x8 outer footprint per
room (9x6 walkable interior) -- up from the original 9x7 footprint (7x5
interior), by narrowing the cosmetic between-room gaps and the hallway (see
room_layout.py's docstring for the exact tile math). Desk spawn points come
from room_layout.DESKS so this file and generate-room-decor.py can't drift
apart on where a "desk-<room>-N" spawn point actually is.

Floors are no longer flat per-room colors -- each room's floor GID is a real
texture crop (see generate-world-tileset.py), picked per theme in
room_layout.ROOMS. Furniture (desks, equipment, decor) is no longer painted
as tilemap GIDs at all -- see generate-room-decor.py and
TiledMapRenderer.addDecorLayer, which place it as freeform pixel-positioned
sprites instead.

Usage: python3 generate-world-map.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from room_layout import WIDTH, HEIGHT, TILE, ROOM_W, ROOM_H, GAP, HALLWAY_H, CAP_H, ROOMS, DESKS, room_y0

WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"

GID_BLANK = 0
GID_HALLWAY = 1
# Room floor GIDs: ROOMS[0]'s floor is gid 2, ROOMS[1]'s is gid 3, etc.
# generate-world-tileset.py builds its tile strip in this exact same ROOMS
# order, so the two files can't drift apart.
FLOOR_GID = {room["id"]: i + 2 for i, room in enumerate(ROOMS)}

# Wall GIDs: 4 consecutive tiles per room (cap, base, base+window-left,
# base+window-right), starting right after the floor tiles, in the same
# ROOMS order as FLOOR_GID above. generate-world-tileset.py appends tiles in
# this exact order so the two files can't drift apart.
_WALL_GID_BASE = 2 + len(ROOMS)
CAP_GID = {room["id"]: _WALL_GID_BASE + 4 * i for i, room in enumerate(ROOMS)}
BASE_GID = {room["id"]: _WALL_GID_BASE + 4 * i + 1 for i, room in enumerate(ROOMS)}
WINDOW_LEFT_GID = {room["id"]: _WALL_GID_BASE + 4 * i + 2 for i, room in enumerate(ROOMS)}
WINDOW_RIGHT_GID = {room["id"]: _WALL_GID_BASE + 4 * i + 3 for i, room in enumerate(ROOMS)}
TILE_COUNT = _WALL_GID_BASE + 4 * len(ROOMS)
# The collision layer only checks "nonzero == blocked" (see engineMap.test.ts
# / agentSim.test.ts, which use arbitrary nonzero values for the same
# reason) -- this marks the cosmetic between-room gap columns as blocked
# without needing a real per-room wall GID there.
GID_BLOCKED = 1


def exterior_rect(room):
    x0 = room["x0"]
    x1 = x0 + ROOM_W - 1
    y0 = room_y0(room)
    y1 = y0 + ROOM_H - 1
    return x0, y0, x1, y1


def cap_rows(room):
    """The CAP_H extra wall-cap rows just above every room's own room_y0 row
    -- for top-row rooms that's their back wall (opposite the door, where the
    window sits); for bottom-row rooms it's their door wall (facing the
    hallway). Returned nearest-to-farthest from the room (cap_ys[0] is
    immediately adjacent to room_y0)."""
    x0, y0, x1, y1 = exterior_rect(room)
    return x0, [y0 - 1 - i for i in range(CAP_H)], x1


def door_tile(room):
    x0, y0, x1, y1 = exterior_rect(room)
    door_x = x0 + ROOM_W // 2
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
    floor_fill, walls_fill, collision_fill = {}, {}, {}

    for room in ROOMS:
        x0, y0, x1, y1 = exterior_rect(room)
        door = door_tile(room)
        floor_gid = FLOOR_GID[room["id"]]
        base_gid = BASE_GID[room["id"]]
        for x, y in rect_cells(x0, y0, x1, y1):
            if (x, y) == door:
                floor_fill[(x, y)] = floor_gid
                continue
            if is_ring(x, y, x0, y0, x1, y1):
                walls_fill[(x, y)] = base_gid
                collision_fill[(x, y)] = base_gid
            else:
                floor_fill[(x, y)] = floor_gid

        # Window pair on the wall opposite the door.
        window_y = y1 if room["row"] == "bottom" else y0
        window_x0 = x0 + ROOM_W // 2 - 1
        walls_fill[(window_x0, window_y)] = WINDOW_LEFT_GID[room["id"]]
        walls_fill[(window_x0 + 1, window_y)] = WINDOW_RIGHT_GID[room["id"]]

        # Wall-cap rows: the wall above this room's own room_y0 row grown
        # CAP_H tiles taller, outside the room's own footprint, for visual
        # depth (and, above this, room for the shadow/corner-bevel overlay
        # generate-room-decor.py paints over it). For bottom-row rooms this
        # cap sits on the SAME side as the door (door_y == room_y0(room)),
        # unlike top-row rooms where the two are on opposite sides -- so the
        # door's own x-column is left as floor through every cap row too,
        # mirroring exactly how the room's own wall ring already skips
        # walls_fill/collision_fill at the door cell, so agents can walk
        # hallway -> cap-row gap -> door -> room interior uninterrupted.
        cap_x0, cap_ys, cap_x1 = cap_rows(room)
        cap_gid = CAP_GID[room["id"]]
        door_x, door_y = door
        door_on_cap_side = door_y == y0
        for cap_y in cap_ys:
            for x in range(cap_x0, cap_x1 + 1):
                if door_on_cap_side and x == door_x:
                    floor_fill[(x, cap_y)] = floor_gid
                    continue
                walls_fill[(x, cap_y)] = cap_gid
                collision_fill[(x, cap_y)] = cap_gid

    # Gaps between same-row rooms: floored (hallway texture) but blocked --
    # cosmetic filler only. Agents only ever cross between columns via the
    # hallway strip below/above, never through these gaps.
    # Row bands, matching room_layout.room_y0's now-symmetric structure: the
    # top band is the CAP_H cap rows plus the top room (rows
    # 0 .. CAP_H+ROOM_H-1 == 0..8), the bottom band is the bottom room's own
    # CAP_H cap rows plus the room (rows HEIGHT-CAP_H-ROOM_H .. HEIGHT-1 ==
    # 13..21). Hand-verified against HEIGHT=22: both bands are CAP_H+ROOM_H=9
    # rows, and neither overlaps the hallway band below.
    for row_y0, row_y1 in ((0, CAP_H + ROOM_H - 1), (HEIGHT - CAP_H - ROOM_H, HEIGHT - 1)):
        gap_x0 = ROOM_W
        for _ in range(2):
            for x in range(gap_x0, gap_x0 + GAP):
                for y in range(row_y0, row_y1 + 1):
                    floor_fill[(x, y)] = GID_HALLWAY
                    collision_fill[(x, y)] = GID_BLOCKED
            gap_x0 += GAP + ROOM_W

    # Hallway: fully open floor, full width, no walls. Both the top and
    # bottom room rows now push the hallway in from their own cap row, so
    # hallway_y1 must back off by CAP_H too (not just ROOM_H) -- otherwise
    # this loop's floor_fill would paint straight over the bottom room's new
    # cap row (row 13) with hallway texture, corrupting it. Hand-verified
    # against HEIGHT=22: hallway_y0=9, hallway_y1=22-1-8-1=12 (4 rows,
    # matching HALLWAY_H), landing exactly between the two cap rows (0, 13).
    hallway_y0, hallway_y1 = CAP_H + ROOM_H, HEIGHT - CAP_H - ROOM_H - 1
    for x, y in rect_cells(0, hallway_y0, WIDTH - 1, hallway_y1):
        floor_fill[(x, y)] = GID_HALLWAY

    def tile_obj(name, x, y):
        return {"name": name, "x": x * TILE, "y": y * TILE}

    def zone_obj(room):
        x0, y0, x1, y1 = exterior_rect(room)
        return {
            "name": room["id"],
            "x": (x0 + 1) * TILE,
            "y": (y0 + 1) * TILE,
            "width": (ROOM_W - 2) * TILE,
            "height": (ROOM_H - 2) * TILE,
        }

    # Derived from hallway_y0, not from ROOM_H: the cap rows push the hallway
    # down, and agentSim spawns every agent on this tile, so it has to land on
    # real walkable hallway floor rather than a room's wall ring.
    spawn_objects = [tile_obj("common", WIDTH // 2, hallway_y0 + HALLWAY_H // 2)]
    for room in ROOMS:
        door_x, door_y = door_tile(room)
        spawn_objects.append(tile_obj(f"{room['id']}-door", door_x, door_y))
        x0, y0, _, _ = exterior_rect(room)
        for i, (col, row) in enumerate(DESKS.get(room["id"], []), start=1):
            spawn_objects.append(tile_obj(f"desk-{room['id']}-{i}", x0 + 1 + col, y0 + 1 + row))

    tiled_map = {
        "width": WIDTH,
        "height": HEIGHT,
        "tilewidth": TILE,
        "tileheight": TILE,
        "tilesets": [
            {
                "firstgid": 0,
                "image": "tileset.png",
                "columns": TILE_COUNT,
                "tilewidth": TILE,
                "tileheight": TILE,
                "tilecount": TILE_COUNT,
            }
        ],
        "layers": [
            {"name": "floor", "type": "tilelayer", "data": build_layer(floor_fill)},
            {"name": "walls", "type": "tilelayer", "data": build_layer(walls_fill)},
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
