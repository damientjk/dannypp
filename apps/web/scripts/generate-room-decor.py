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
from PIL import Image, ImageDraw, ImageStat

sys.path.insert(0, str(Path(__file__).resolve().parent))
from room_layout import TILE, ROOM_W, ROOM_H, CAP_H, ROOMS, DESKS, EQUIPMENT, DECOR, AMBIENT, room_y0

REPO_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "moderninteriors-win").is_dir())
MODERNINTERIORS = REPO_ROOT / "moderninteriors-win"
WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"
EQUIPMENT_SRC_DIR = "3_Animated_objects/32x32/spritesheets"
# Same two sheets generate-world-tileset.py picks a room's FLOOR_GID crop
# from -- reused here so the wall-border overlay's floor tiling (below) is
# pixel-identical to the real floor layer underneath it.
FLOORS_SHEET = MODERNINTERIORS / "1_Interiors" / "32x32" / "Room_Bulder_subfiles_32x32" / "Room_Builder_Floors_32x32.png"
ROOM_BUILDER = MODERNINTERIORS / "1_Interiors" / "32x32" / "Room_Builder_32x32.png"
# Same sheet generate-world-tileset.py crops for each room's real wall GID --
# reused here (read-only) so build_wall_border_overlay()'s flat side-wall
# color is sampled from each room's own wall body rather than hand-picked.
WALLS_SHEET = MODERNINTERIORS / "1_Interiors" / "32x32" / "Room_Bulder_subfiles_32x32" / "Room_Builder_Walls_32x32.png"

# Shading strength for build_wall_shade()'s corner wedge, as a black-overlay
# alpha. Originally 40 (~0.84x), sourced from sampling moderninteriors-win/
# 6_Home_Designs/Shooting_Range_Designs/32x32/
# Shooting_Range_Design_layer_1_32x32.png, whose side wall reads
# (119,109,105) against a (138,133,129) back wall. That value was tuned
# against a background that was partly the pale trim stripe Task 9 removed
# from the cap tile (see the plan's Amendment 4) -- at this game's actual
# on-screen scale, against the now-uniform mid-tone wall, 40 read as a barely
# perceptible gradient rather than a legible corner cut (confirmed by
# pixel-sampling a live screenshot). Bumped to 80 (~0.69x -- compositing
# black at alpha a scales a pixel by (1 - a/255)), re-verified the same way:
# the wedge reads as a clearly darker diagonal against the plain wall at
# normal viewing scale.
WALL_SHADE = 80

ROOM_BY_ID = {r["id"]: r for r in ROOMS}


def room_origin(room):
    """Interior (col 0, row 0) in absolute map tiles. Same footprint math as
    generate-world-map.py's exterior_rect() -- both call room_layout.room_y0
    so the two can't drift apart."""
    x0 = room["x0"]
    return x0 + 1, room_y0(room) + 1


def floor_crop_for(room):
    """The exact same (sheet, col, row) crop generate-world-tileset.py uses
    to build this room's FLOOR_GID tile -- reused so the border overlay's
    tiled floor lines up pixel-for-pixel with the real floor layer beneath
    it (no double-texture seam at the overlay's inner edge)."""
    sheet_name, col, row = room["floor"]
    sheet_path = FLOORS_SHEET if sheet_name == "Room_Builder_Floors" else ROOM_BUILDER
    sheet = Image.open(sheet_path).convert("RGBA")
    return sheet.crop((col * TILE, row * TILE, col * TILE + TILE, row * TILE + TILE))


# Width (px) of the flat-color band left visible at each side wall's true
# outer edge once build_wall_border_overlay()'s floor tiling covers the
# rest of the wall ring. 16, not Task 10's 6 -- three independent
# pixel-measurements against the actual reference art (Gym/Shooting Range/
# Museum, see task-11-brief.md) all found the reference's side wall is
# exactly half its 32px wall tile, constant along the whole wall. The front
# wall gets no band at all (see build_wall_border_overlay's docstring), so
# this constant is side-wall-only -- no separate front constant needed.
SIDE_STRIP = 16


def wall_body_color(room):
    """Average RGB of the room's own base wall tile: Room_Builder_Walls_32x32.png,
    column 1 (Task 10's fix for the sheet's dark seam column), row
    room["wall"] * 2 + 1 -- the exact crop generate-world-tileset.py already
    uses for this room's real wall GID. Sampled programmatically
    (ImageStat mean over the RGB channels) rather than 6 hand-picked colors,
    per the task brief -- the reference's side walls read as one flat,
    solid, single color, so a per-room average of that room's own wall
    texture is the natural stand-in."""
    sheet = Image.open(WALLS_SHEET).convert("RGB")
    row = room["wall"] * 2 + 1
    tile = sheet.crop((TILE, row * TILE, TILE * 2, row * TILE + TILE))
    r, g, b = ImageStat.Stat(tile).mean
    return (round(r), round(g), round(b), 255)


def build_wall_border_overlay(room, floor_crop):
    """Per-room decor overlay that makes the wall ring read as a thin,
    flat-colored side-wall border plus a wall-free front (door) wall,
    matching the reference art's own treatment (see task-11-brief.md):
    floor_crop tiled across the room's full ROOM_W x ROOM_H outer footprint
    (this covers the wall ring's own busy per-theme texture everywhere,
    including the front wall -- floor now runs to the true outer edge
    there, same as the reference's near-absent front wall), with a
    SIDE_STRIP-px flat solid-color band painted back in at the true left
    and right edges, sampled per-room from wall_body_color().

    That side band deliberately runs the room's *full* height, front row
    included -- not just the interior rows -- so the bottom corners (side
    meets front) come out as a plain square overlap of two rectangles, no
    diagonal or special-casing needed, matching the reference's plain
    bottom corners (contrast the back wall's own separate mitered top
    corners from Tasks 7-9, untouched here).

    One exception carved out of the mask: the back wall -- the wall
    opposite the door, which carries the window pair and, for top-row
    rooms, the cap + corner-wedge treatment Tasks 7-9 already built and the
    user confirmed looks right -- is excluded entirely (its whole row left
    fully transparent). This task must not touch that wall for any room.
    """
    w, h = ROOM_W * TILE, ROOM_H * TILE
    img = Image.new("RGBA", (w, h))
    for y in range(0, h, TILE):
        for x in range(0, w, TILE):
            img.paste(floor_crop, (x, y))

    d_img = ImageDraw.Draw(img)
    color = wall_body_color(room)
    d_img.rectangle([0, 0, SIDE_STRIP - 1, h - 1], fill=color)
    d_img.rectangle([w - SIDE_STRIP, 0, w - 1, h - 1], fill=color)

    mask = Image.new("L", (w, h), 255)
    d_mask = ImageDraw.Draw(mask)

    # Back wall: top row for a top-row room (farthest from the hallway,
    # where the door isn't), bottom row for a bottom-row room -- mirrors
    # door_tile()'s own door_y = y1 if top else y0 in generate-world-map.py.
    # This wins over the side-color paint above regardless of what's under
    # it: the mask is applied last, so the back wall row stays fully
    # transparent (real wall + cap/wedge shows through) even through the
    # small overlap where the side bands cross it.
    back_on_top = room["row"] == "top"
    if back_on_top:
        d_mask.rectangle([0, 0, w - 1, TILE - 1], fill=0)
    else:
        d_mask.rectangle([0, h - TILE, w - 1, h - 1], fill=0)

    img.putalpha(mask)
    return img


def copy_asset(src_rel: str, dest_rel: str, crop: tuple[int, int, int, int] | None = None) -> None:
    src = MODERNINTERIORS / src_rel
    dest = WORLD_ASSETS / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if crop is None:
        shutil.copyfile(src, dest)
    else:
        Image.open(src).convert("RGBA").crop(crop).save(dest)


def build_wall_shade() -> Image.Image:
    """A plain mitered corner cut at the two top corners of a top-row room's
    back wall -- the only 3D cue this room gets. No side-wall darkening, no
    floor shadow: those were tried in an earlier pass and read as too much
    (the target is the restraint of moderninteriors-win/6_Home_Designs/
    Gym_Designs/32x32/Gym_layer_1_32x32.png, not a full lighting pass).

    Measured directly off that Gym reference (confirmed by sampling pixels,
    not re-derived from the plan's secondhand description): the room's own
    content starts at image pixel (14,12); its corner wedge is 2px wide at
    the very top and widens by 2px roughly every 6px of height, reaching 18px
    (~56% of its 32px tile) right at the wall/floor seam 50px down. A
    mid-wall column (x=200) hits that same wall/floor seam at the same row,
    so the wedge is a flat color swap within the wall's existing footprint,
    not a resize -- the reference just fills it with the side wall's own
    flat (119,109,105) vs. the back wall's textured (138,133,129).

    This game has no separate flat-vs-textured material to swap in (Task 3
    gives every side of a room the same texture), so the swap is approximated
    with a flat WALL_SHADE darken instead -- same technique and same alpha
    Task 7 used, just now confined to this small wedge instead of the whole
    side wall and floor. The 18px/32px-tile ratio carries over unchanged
    (this game's tiles are also 32px); the height is stretched from the
    reference's ~50px (1.6 tiles) to this game's whole CAP_H+1 = 2-tile back
    wall (64px), so the slope is closer to 1:4 here than the reference's
    ~1:3, which is expected -- the reference's back wall isn't a whole
    number of tiles tall to begin with, ours is.

    Room-independent (it is pure black at a fixed alpha, not a texture), so
    every top-row room reuses the identical image -- callers still write one
    copy per room to keep decor/<room-id>/ self-contained."""
    w = ROOM_W * TILE
    back_h = (CAP_H + 1) * TILE   # cap rows + the room's own back-wall row
    max_w = round(TILE * 18 / 32)  # ~56% of a tile, measured off the Gym reference
    mask = Image.new("L", (w, back_h), 0)
    d = ImageDraw.Draw(mask)

    # Widths are kept even so the diagonal steps in 2px units like the pack's
    # own art rather than as a 1px staircase.
    for y in range(back_h):
        ww = 2 + 2 * round((max_w - 2) * y / (back_h - 1) / 2)
        d.rectangle([0, y, ww - 1, y], fill=WALL_SHADE)
        d.rectangle([w - ww, y, w - 1, y], fill=WALL_SHADE)

    out = Image.new("RGBA", (w, back_h), (0, 0, 0, 0))
    out.putalpha(mask)
    return out


def main() -> None:
    decor_entries = []
    equipment_entries = []

    for room in ROOMS:
        ox, oy = room_origin(room)
        room_id = room["id"]

        # Corner-cut overlay, top-row rooms only. Anchored on the room's own
        # left wall column and its topmost cap row, and only as tall as the
        # cap row(s) plus the back-wall ring row it draws over -- side walls
        # and the floor below are untouched. Emitted first so every other
        # decor item in this room draws on top of it. Bottom-row rooms get
        # nothing: no cap rows to cover and no wall facing away from the
        # camera.
        if room["row"] == "top":
            shade_rel = f"decor/{room_id}/wall-shade.png"
            (WORLD_ASSETS / shade_rel).parent.mkdir(parents=True, exist_ok=True)
            build_wall_shade().save(WORLD_ASSETS / shade_rel)
            decor_entries.append({
                "image": shade_rel,
                "x": (ox - 1) * TILE,
                "y": (room_y0(room) - CAP_H) * TILE,
            })

        # Thin-border wall overlay, every room. Covers the room's ordinary
        # ROOM_W x ROOM_H exterior footprint (wall ring included) -- it
        # doesn't extend into the cap rows above, so it can't touch or
        # overlap the wall-shade corner wedge just emitted above (that
        # wedge's own footprint is the cap row(s) plus this room's back-wall
        # ring row, which this overlay excludes -- see
        # build_wall_border_overlay's docstring).
        border_rel = f"decor/{room_id}/wall-border.png"
        (WORLD_ASSETS / border_rel).parent.mkdir(parents=True, exist_ok=True)
        build_wall_border_overlay(room, floor_crop_for(room)).save(WORLD_ASSETS / border_rel)
        decor_entries.append({
            "image": border_rel,
            "x": room["x0"] * TILE,
            "y": room_y0(room) * TILE,
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
