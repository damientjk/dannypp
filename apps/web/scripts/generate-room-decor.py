#!/usr/bin/env python3
"""Emit public/world-assets/room-decor.json (freeform pixel-positioned
decor + animated equipment, consumed by src/world/roomDecor.ts) and copy
every source PNG it references from moderninteriors-win into
public/world-assets/{decor,equipment}/.

Re-run any time room_layout.py's DESKS/EQUIPMENT/DECOR/AMBIENT change, or its
ROOMS[].floor, ROOMS[].wall, CAP_H, or room_y0() -- this script also derives
the wall-border/wall-shade overlays from those.

Usage: python3 generate-room-decor.py
"""
import json
import shutil
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageStat

sys.path.insert(0, str(Path(__file__).resolve().parent))
from room_layout import (
    TILE, ROOM_W, ROOM_H, CAP_H, ROOMS, DESKS, EQUIPMENT, DECOR, AMBIENT,
    room_y0, wall_crop_box,
)

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
# alpha (compositing black at alpha a scales a pixel by (1 - a/255)). 80
# (~0.69x) reads as a clearly darker diagonal against the plain wall at
# normal viewing scale -- tuned by pixel-sampling a live screenshot; see git
# log / the plan doc for how earlier values were ruled out.
WALL_SHADE = 80

# Task 13 polish, applied to build_wall_border_overlay()'s side bands only:
# a subtle vertical gradient across the band's fill (GRADIENT_SHADE, top to
# bottom) plus a thin dark outline at the band's inner edge (OUTLINE_SHADE,
# OUTLINE_PX wide). Same black-composite technique as WALL_SHADE above
# (compositing black at alpha a scales a pixel by (1 - a/255)), but the
# gradient's alpha is kept far below WALL_SHADE's 80 -- this is meant to
# read as a soft hint of depth, not a visible stripe (checked against a live
# screenshot; this plan has twice had to walk back an effect shipped too
# strong, see Amendment 8). The outline can afford to be stronger since it's
# only OUTLINE_PX wide rather than spanning the whole band.
GRADIENT_SHADE = 20
OUTLINE_SHADE = 110
OUTLINE_PX = 2

ROOM_BY_ID = {r["id"]: r for r in ROOMS}


def _darken(color, alpha):
    """Darken an RGB(A) 4-tuple by compositing black at the given alpha --
    same math WALL_SHADE relies on elsewhere in this file."""
    r, g, b = color[:3]
    scale = 1 - alpha / 255
    return (round(r * scale), round(g * scale), round(b * scale), 255)


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
    """Average RGB of the room's own base wall tile -- room_layout.wall_crop_box
    owns the exact crop (the same box generate-world-tileset.py uses for this
    room's real wall GID). Sampled programmatically (ImageStat mean over the
    RGB channels) rather than 6 hand-picked colors, per the task brief -- the
    reference's side walls read as one flat, solid, single color, so a
    per-room average of that room's own wall texture is the natural
    stand-in."""
    sheet = Image.open(WALLS_SHEET).convert("RGB")
    tile = sheet.crop(wall_crop_box(room))
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
    and right edges, sampled per-room from wall_body_color(). Task 13 layers
    two more effects onto that band's fill: a subtle vertical gradient
    (GRADIENT_SHADE, lighter at the top and darkening toward the floor) and,
    on top of it, a thin dark outline at the band's inner edge
    (OUTLINE_SHADE/OUTLINE_PX) so the band reads as a defined wall shape
    rather than a flat color blending into the tiled floor.

    That side band deliberately runs the room's *full* height, front row
    included -- not just the interior rows -- so the bottom corners (side
    meets front) come out as a plain square overlap of two rectangles, no
    diagonal or special-casing needed, matching the reference's plain
    bottom corners (contrast the back wall's own separate mitered top
    corners from Tasks 7-9, untouched here).

    One exception carved out of the mask: the room's own room_y0 row -- the
    row that now always carries the wall-cap + corner-wedge treatment (Task
    12 extends this to every room, not just top-row rooms; see
    build_wall_shade()) -- is excluded entirely (its whole row left fully
    transparent). This task must not touch that wall for any room.
    """
    w, h = ROOM_W * TILE, ROOM_H * TILE
    img = Image.new("RGBA", (w, h))
    for y in range(0, h, TILE):
        for x in range(0, w, TILE):
            img.paste(floor_crop, (x, y))

    d_img = ImageDraw.Draw(img)
    color = wall_body_color(room)

    # Vertical gradient across each side band: lighter (true wall_body_color,
    # no darkening) at the top, darkening toward the bottom as a subtle hint
    # of the wall meeting the floor. Drawn one row at a time since PIL has no
    # built-in linear-gradient fill.
    for y in range(h):
        shade = round(GRADIENT_SHADE * y / (h - 1))
        row_color = _darken(color, shade)
        d_img.rectangle([0, y, SIDE_STRIP - 1, y], fill=row_color)
        d_img.rectangle([w - SIDE_STRIP, y, w - 1, y], fill=row_color)

    # Thin dark outline at each band's inner edge (where the flat band meets
    # the tiled floor), painted over the gradient above.
    outline_color = _darken(color, OUTLINE_SHADE)
    d_img.rectangle([SIDE_STRIP - OUTLINE_PX, 0, SIDE_STRIP - 1, h - 1], fill=outline_color)
    d_img.rectangle([w - SIDE_STRIP, 0, w - SIDE_STRIP + OUTLINE_PX - 1, h - 1], fill=outline_color)

    mask = Image.new("L", (w, h), 255)
    d_mask = ImageDraw.Draw(mask)

    # room_y0(room)'s own row is always image row 0 (room_y0 is defined as
    # the exterior rect's top-left corner -- see room_layout.room_y0's
    # docstring), for every room, top or bottom. This wins over the
    # side-color paint above regardless of what's under it: the mask is
    # applied last, so this row stays fully transparent (real wall +
    # cap/wedge shows through) even through the small overlap where the side
    # bands cross it.
    d_mask.rectangle([0, 0, w - 1, TILE - 1], fill=0)

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
    """A plain mitered corner cut at the two top corners of the wall that
    sits above a room's own room_y0 row (a top-row room's back wall; a
    bottom-row room's door wall) -- the only 3D cue this room gets. No
    side-wall darkening, no floor shadow -- the target is the restraint of
    moderninteriors-win/6_Home_Designs/Gym_Designs/32x32/
    Gym_layer_1_32x32.png, not a full lighting pass.

    Wedge shape measured directly off that Gym reference by pixel-sampling:
    2px wide at the top, widening by 2px roughly every 6px of height, to 18px
    (~56% of a 32px tile) at the wall/floor seam 50px down. That ratio
    carries over unchanged (this game's tiles are also 32px); the height is
    stretched from the reference's ~50px to this game's whole CAP_H+1 =
    2-tile back wall (64px). Approximated here as a flat WALL_SHADE darken,
    since this game's walls are one texture throughout rather than the
    reference's separate flat-vs-textured materials.

    Room-independent (it is pure black at a fixed alpha, not a texture), so
    every room reuses the identical image -- callers still write one copy
    per room to keep decor/<room-id>/ self-contained."""
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

        # Corner-cut overlay, every room. Anchored on the room's own left
        # wall column and its topmost cap row, and only as tall as the cap
        # row(s) plus the room_y0 ring row it draws over -- side walls and
        # the floor below are untouched. Emitted first so every other decor
        # item in this room draws on top of it. Same wedge image for every
        # room (build_wall_shade() is room-independent); only its placement
        # (keyed off room_y0(room), which is already asymmetric per room)
        # differs.
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
        # wedge's own footprint is the cap row(s) plus this room's room_y0
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
