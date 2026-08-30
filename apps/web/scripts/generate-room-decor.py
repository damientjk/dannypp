#!/usr/bin/env python3
"""Emit public/world-assets/room-decor.json (freeform pixel-positioned
decor + animated equipment, consumed by src/world/roomDecor.ts) and copy
every source PNG it references from moderninteriors-win into
public/world-assets/{decor,equipment}/.

Re-run any time room_layout.py's DESKS/EQUIPMENT/DECOR/AMBIENT change.

Usage: python3 generate-room-decor.py
"""
import json
import shutil
import sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from room_layout import TILE, ROOM_W, ROOM_H, CAP_H, ROOMS, DESKS, EQUIPMENT, DECOR, AMBIENT, room_y0

REPO_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "moderninteriors-win").is_dir())
MODERNINTERIORS = REPO_ROOT / "moderninteriors-win"
WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"
EQUIPMENT_SRC_DIR = "3_Animated_objects/32x32/spritesheets"

WALLS_3D_SHEET = "1_Interiors/32x32/Room_Bulder_subfiles_32x32/Room_Builder_3d_walls_32x32.png"
# Crops inside one colorway block of that sheet, relative to the block's own
# origin (room_layout.ROOMS' "gable" field). The sheet is a packed atlas of
# loose pieces, not assembled walls, so these three were pinned down by
# exact-pixel-matching the pack's own Museum_room_3 home design -- which uses
# this same 3-tile-tall 3D back wall -- against the sheet: its left/right
# corner columns land at these two offsets in every block. LEFT/RIGHT are the
# tapered corner wedges; MID is the block's plain wall column with the 2px
# dark atlas outline trimmed off each side so repeats of it tile seamlessly.
GABLE_LEFT = (32, 32, 64, 128)
GABLE_RIGHT = (192, 32, 224, 128)
GABLE_MID = (2, 0, 30, 96)

ROOM_BY_ID = {r["id"]: r for r in ROOMS}


def room_origin(room):
    """Interior (col 0, row 0) in absolute map tiles. Same footprint math as
    generate-world-map.py's exterior_rect() -- both call room_layout.room_y0
    so the two can't drift apart."""
    x0 = room["x0"]
    return x0 + 1, room_y0(room) + 1


def copy_asset(src_rel: str, dest_rel: str, crop: tuple[int, int, int, int] | None = None) -> None:
    src = MODERNINTERIORS / src_rel
    dest = WORLD_ASSETS / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if crop is None:
        shutil.copyfile(src, dest)
    else:
        Image.open(src).convert("RGBA").crop(crop).save(dest)


def build_gable(room) -> Image.Image:
    """The room's back-wall cornice: a 3D-perspective wall band ROOM_W tiles
    wide and CAP_H tiles tall, whose two ends taper into corner wedges so the
    cap rows read as one tall wall receding into the screen instead of the
    flat texture repeated CAP_H times.

    The source composition is only 8 tiles wide against an 11-tile wall, so
    the straight middle is tiled across the ROOM_W-2 columns between the two
    corners rather than stretched -- resizing would soften the pixel art's
    hard edges. Bottom-row rooms get it flipped: their back wall is the
    map's bottom edge, so the white top trim has to face outward there too."""
    bx, by = room["gable"]
    sheet = Image.open(MODERNINTERIORS / WALLS_3D_SHEET).convert("RGBA")

    def piece(box):
        return sheet.crop((bx + box[0], by + box[1], bx + box[2], by + box[3]))

    width = ROOM_W * TILE
    out = Image.new("RGBA", (width, CAP_H * TILE), (0, 0, 0, 0))
    mid = piece(GABLE_MID)
    for x in range(TILE, width - TILE, mid.width):
        out.paste(mid, (x, 0))
    out.paste(piece(GABLE_LEFT), (0, 0))
    out.paste(piece(GABLE_RIGHT), (width - TILE, 0))
    return out if room["row"] == "top" else out.transpose(Image.FLIP_TOP_BOTTOM)


def main() -> None:
    decor_entries = []
    equipment_entries = []

    for room in ROOMS:
        ox, oy = room_origin(room)
        room_id = room["id"]

        # Cap-row cornice. col=-1 is the room's own left wall column and the
        # negative/overflow row lands in the CAP_H rows outside the footprint
        # (above for a top-row room, below for a bottom-row one) -- decor
        # draws over the wall tile layer, so this covers the flat cap tiles.
        gable_rel = f"decor/{room_id}/gable.png"
        (WORLD_ASSETS / gable_rel).parent.mkdir(parents=True, exist_ok=True)
        build_gable(room).save(WORLD_ASSETS / gable_rel)
        gable_row = -(CAP_H + 1) if room["row"] == "top" else ROOM_H - 1
        decor_entries.append({
            "image": gable_rel,
            "x": (ox - 1) * TILE,
            "y": (oy + gable_row) * TILE,
        })

        for item in DECOR.get(room_id, []):
            dest_rel = f"decor/{room_id}/{item['dest']}"
            copy_asset(item["src"], dest_rel, item.get("crop"))
            decor_entries.append({
                "image": dest_rel,
                "x": (ox + item["col"]) * TILE,
                "y": (oy + item["row"]) * TILE,
            })

        desks = DESKS.get(room_id, [])
        for i, (col, row) in enumerate(desks):
            binding = EQUIPMENT.get((room_id, i))
            if binding is None:
                continue
            src_name, frames = binding
            sheet_path = MODERNINTERIORS / EQUIPMENT_SRC_DIR / src_name
            sheet_width = Image.open(sheet_path).width
            assert sheet_width == frames * 32, (
                f"{src_name}: {sheet_width}px sheet is not {frames} x 32px frames"
            )
            dest_rel = f"equipment/{src_name}"
            copy_asset(f"{EQUIPMENT_SRC_DIR}/{src_name}", dest_rel)
            equipment_entries.append({
                "image": dest_rel,
                "frames": frames,
                "x": (ox + col) * TILE,
                "y": (oy + row) * TILE,
                "spawnPoint": f"desk-{room_id}-{i + 1}",
            })

    for item in AMBIENT:
        ox, oy = room_origin(ROOM_BY_ID[item["room_id"]])
        dest_rel = f"equipment/{item['dest']}"
        copy_asset(item["src"], dest_rel)
        equipment_entries.append({
            "image": dest_rel,
            "frames": item["frames"],
            "x": (ox + item["col"]) * TILE,
            "y": (oy + item["row"]) * TILE,
            "spawnPoint": None,
        })

    out = {"decor": decor_entries, "equipment": equipment_entries}
    out_path = WORLD_ASSETS / "room-decor.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"wrote {out_path}: {len(decor_entries)} decor, {len(equipment_entries)} equipment")


if __name__ == "__main__":
    main()
