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
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from room_layout import TILE, ROOM_W, ROOM_H, CAP_H, ROOMS, DESKS, EQUIPMENT, DECOR, AMBIENT, room_y0

REPO_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "moderninteriors-win").is_dir())
MODERNINTERIORS = REPO_ROOT / "moderninteriors-win"
WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"
EQUIPMENT_SRC_DIR = "3_Animated_objects/32x32/spritesheets"

# Shading strengths for build_wall_shade(), as black-overlay alphas. Both come
# from sampling moderninteriors-win/6_Home_Designs/Shooting_Range_Designs/32x32/
# Shooting_Range_Design_layer_1_32x32.png, whose back wall/side walls/floor are
# flat-shaded exactly this way: its side wall reads (119,109,105) against a
# (138,133,129) back wall (~0.84x), and the floor band hugging the top and left
# walls reads ~141 mean against ~155 further in (~0.91x). Compositing black at
# alpha a scales a pixel by (1 - a/255), so 40 -> 0.843x and 36 -> 0.859x.
# FLOOR_SHADE is a little past the reference's own 0.91x: these rooms' floor
# textures are much busier than the shooting range's near-flat tile, and at
# 0.91x the band disappeared into the plank grain entirely.
WALL_SHADE = 40
FLOOR_SHADE = 36
FLOOR_SHADE_PX = 12   # reference band is 12-14px deep

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


def build_wall_shade() -> Image.Image:
    """A translucent black overlay covering one top-row room's cap rows plus
    its whole footprint, giving the room the flat 3D read the Shooting_Range
    reference design has: darkened side-wall columns, a diagonal corner bevel
    where the back wall's face meets them, and a shadow the top/left/right
    walls cast onto the floor.

    All three come from the same observation: the back wall is the only wall
    the camera sees face-on, so it stays at full brightness and everything
    turning away from the camera loses ~16%. The bevel is that boundary drawn
    honestly -- across the CAP_H+1 tiles of back wall the side wall is seen
    increasingly edge-on, so its darkened face widens from 2px at the very top
    to the full column width at the wall's foot, then just continues at that
    width down the room. Nothing is masked out, so the room's silhouette stays
    a clean rectangle and the bevel meets the side wall below it seamlessly.

    Room-independent (it is pure black at fixed alphas, not a texture), so
    every top-row room reuses the identical image -- callers still write one
    copy per room to keep decor/<room-id>/ self-contained."""
    w, h = ROOM_W * TILE, (CAP_H + ROOM_H) * TILE
    back_h = (CAP_H + 1) * TILE   # cap rows + the room's own back-wall row
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)

    # Side-wall columns, below the back wall: seen fully edge-on.
    d.rectangle([0, back_h, TILE - 1, h - 1], fill=WALL_SHADE)
    d.rectangle([w - TILE, back_h, w - 1, h - 1], fill=WALL_SHADE)
    # The corner bevel: same columns, ramped in over the back wall's height.
    # Widths are kept even so the diagonal steps in 2px units like the pack's
    # own art rather than as a 1px staircase.
    for y in range(back_h):
        ww = 2 + 2 * round((TILE - 2) * y / (back_h - 1) / 2)
        d.rectangle([0, y, ww - 1, y], fill=WALL_SHADE)
        d.rectangle([w - ww, y, w - 1, y], fill=WALL_SHADE)

    # Floor shadow along the interior's top/left/right edges. No bottom edge:
    # that wall faces the camera, so it casts towards the viewer, not into the
    # room (the "red" edge in the user's annotated cave reference).
    ix0, iy0 = TILE, back_h
    ix1, iy1 = w - TILE - 1, h - TILE - 1
    d.rectangle([ix0, iy0, ix1, iy0 + FLOOR_SHADE_PX - 1], fill=FLOOR_SHADE)
    d.rectangle([ix0, iy0, ix0 + FLOOR_SHADE_PX - 1, iy1], fill=FLOOR_SHADE)
    d.rectangle([ix1 - FLOOR_SHADE_PX + 1, iy0, ix1, iy1], fill=FLOOR_SHADE)

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.putalpha(mask)
    return out


def main() -> None:
    decor_entries = []
    equipment_entries = []

    for room in ROOMS:
        ox, oy = room_origin(room)
        room_id = room["id"]

        # Shadow + corner-bevel overlay, top-row rooms only. Anchored on the
        # room's own left wall column and its topmost cap row, so it spans the
        # footprint plus the cap. Emitted first so every other decor item in
        # this room draws on top of it -- furniture sits in the room, not
        # under its shadows. Bottom-row rooms get nothing: no cap rows to
        # cover and no wall facing away from the camera.
        if room["row"] == "top":
            shade_rel = f"decor/{room_id}/wall-shade.png"
            (WORLD_ASSETS / shade_rel).parent.mkdir(parents=True, exist_ok=True)
            build_wall_shade().save(WORLD_ASSETS / shade_rel)
            decor_entries.append({
                "image": shade_rel,
                "x": (ox - 1) * TILE,
                "y": (room_y0(room) - CAP_H) * TILE,
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
