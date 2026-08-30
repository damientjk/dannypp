#!/usr/bin/env python3
"""Emit public/world-assets/room-decor.json (freeform pixel-positioned
decor + animated equipment, consumed by src/world/roomDecor.ts) and copy
every source PNG it references from moderninteriors-win into
public/world-assets/{decor,equipment}/.

Re-run any time room_layout.py's DESKS/EQUIPMENT/DECOR/AMBIENT change, or its
ROOMS[].floor, ROOMS[].wall, CAP_H, DOOR_COL, or room_y0() -- this script also
derives the wall-border/wall-shade overlays from those.

Usage: python3 generate-room-decor.py
"""
import json
import shutil
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageStat

sys.path.insert(0, str(Path(__file__).resolve().parent))
from room_layout import (
    TILE, ROOM_W, ROOM_H, CAP_H, DOOR_COL, ROOMS, DESKS, EQUIPMENT, DECOR, AMBIENT,
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

# Wall frame, measured off the two reference designs the user pointed at
# (6_Home_Designs/Gym_Designs/48x48/Gym_2_layer_1_48x48.png for the bottom
# row, TV_Studio_Designs/48x48/Tv_Studio_Design_layer_1_48x48.png for the
# top row -- both 3x upscales of the pack's 16px art, so every run below was
# read at 48px and scaled by 2/3 to this game's 32px tiles). Every wall shows
# its top face as a WHITE band inside a LINE-px NAVY outline -- FACE_SIDE
# wide along the side walls, FACE_END along the back and front walls -- with
# a second LINE-px outline where that face meets the wall body. The side
# walls' body is a flat SIDE_STRIP band; the front wall has no body at all
# (its top face is the whole wall, FRONT_H tall); the back wall's body is
# whatever is left of the (CAP_H + 1)-tile stack after the top face and the
# floor-seam outline (50px, matching the reference's 25 native px).
NAVY = (58, 58, 80, 255)
WHITE = (248, 248, 248, 255)
LINE = 2
FACE_SIDE = 10
FACE_END = 8
SIDE_STRIP = 16
FRONT_H = LINE + FACE_END + LINE
# The side wall (face + body + all three outlines) must fill its ring tile
# exactly -- the floor layer underneath starts at the next tile.
assert LINE + FACE_SIDE + LINE + SIDE_STRIP + LINE == TILE

# Side walls sit ~15% darker than the back wall in both references (Gym_2:
# (119,109,105) against (140,135,131); TV studio: (141,146,163) against
# (169,172,188)) -- compositing black at alpha a scales a pixel by
# (1 - a/255), so 40 is that ratio. This is also what makes the corner wedge
# visible at all on a flat wall like analytics's, where an undarkened
# average would be the wall's own color.
SIDE_SHADE = 40
# Subtle vertical gradient down the side walls' body (Task 13, a polish the
# user asked for on top of the reference's genuinely flat band), ramping
# from 0 at the floor seam to GRADIENT_SHADE at the front wall. Kept far
# below anything that reads as a stripe -- this plan has twice had to walk
# back an effect shipped too strong, see Amendment 8.
GRADIENT_SHADE = 20

ROOM_BY_ID = {r["id"]: r for r in ROOMS}


def _darken(color, alpha):
    """Darken an RGB(A) 4-tuple by compositing black at the given alpha --
    the math SIDE_SHADE and GRADIENT_SHADE are expressed in."""
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


def side_wall_color(room):
    """The flat color of a room's side walls (and of the corner wedges,
    which are those walls turning the corner): wall_body_color darkened by
    SIDE_SHADE."""
    return _darken(wall_body_color(room), SIDE_SHADE)


def build_wall_border_overlay(room, floor_crop):
    """Per-room overlay covering the room's cap row(s) plus its ROOM_W x
    ROOM_H footprint, drawing the reference's wall frame over the map's
    plain wall-ring tiles (measurements: the NAVY/WHITE/... constants):

    - every wall's top face (NAVY | WHITE | NAVY) around all four sides,
      the inner outlines running full-length so they cross at the corners
      the way the pack's own corners do;
    - the side walls' flat SIDE_STRIP body (side_wall_color, with the Task
      13 gradient) from the floor seam down to the front wall, edged with a
      NAVY line where it meets the floor;
    - the back wall's body left transparent so the real textured wall tiles
      (and build_wall_shade()'s corner wedges) show through, with a NAVY
      floor-seam line under it;
    - floor_crop tiled over the front ring row above its top face, since the
      reference's front wall is nothing but that face;
    - the doorway: a one-tile opening at DOOR_COL cut clean through
      whichever wall the door is in (the front face for top-row rooms, the
      whole tall wall for bottom-row rooms -- the same rule as
      generate-world-map.door_tile), edged with NAVY jambs, the room's own
      floor running out through it.
    """
    w, h = ROOM_W * TILE, (CAP_H + ROOM_H) * TILE
    back_h = (CAP_H + 1) * TILE
    face_end = LINE + FACE_END              # inner edge of the back/front top face
    face_side = LINE + FACE_SIDE            # inner edge of a side top face
    body_x = face_side + LINE               # where a side wall's body starts
    edge_x = body_x + SIDE_STRIP            # NAVY line where that body meets the floor
    seam = back_h - LINE                    # NAVY line under the back wall's body
    front = h - FRONT_H                     # top of the front wall's face
    color = side_wall_color(room)

    img = Image.new("RGBA", (w, h))
    for y in range(0, h, TILE):
        for x in range(0, w, TILE):
            img.paste(floor_crop, (x, y))
    d = ImageDraw.Draw(img)

    # Side wall bodies, one row at a time for the gradient (PIL has no
    # linear-gradient fill).
    for y in range(seam, front):
        row_color = _darken(color, round(GRADIENT_SHADE * (y - seam) / (front - 1 - seam)))
        d.rectangle([body_x, y, edge_x - 1, y], fill=row_color)
        d.rectangle([w - edge_x, y, w - body_x - 1, y], fill=row_color)

    # Top faces: WHITE bands, the outer NAVY outline, then the inner
    # outlines (full-length, so they cross at the corners).
    d.rectangle([0, 0, w - 1, face_end - 1], fill=WHITE)
    d.rectangle([0, h - face_end, w - 1, h - 1], fill=WHITE)
    d.rectangle([0, 0, face_side - 1, h - 1], fill=WHITE)
    d.rectangle([w - face_side, 0, w - 1, h - 1], fill=WHITE)
    d.rectangle([0, 0, w - 1, h - 1], outline=NAVY, width=LINE)
    d.rectangle([face_side, 0, body_x - 1, h - 1], fill=NAVY)
    d.rectangle([w - body_x, 0, w - face_side - 1, h - 1], fill=NAVY)
    d.rectangle([0, face_end, w - 1, face_end + LINE - 1], fill=NAVY)
    d.rectangle([0, front, w - 1, front + LINE - 1], fill=NAVY)

    # Floor outline: the seam under the back wall's body, and the side
    # bodies' inner edges down to the front wall.
    d.rectangle([edge_x, seam, w - edge_x - 1, seam + LINE - 1], fill=NAVY)
    d.rectangle([edge_x, seam, edge_x + LINE - 1, front - 1], fill=NAVY)
    d.rectangle([w - edge_x - LINE, seam, w - edge_x - 1, front - 1], fill=NAVY)

    # Back wall body: transparent, the map's own wall tiles show through.
    d.rectangle([body_x, face_end + LINE, w - body_x - 1, seam - 1], fill=(0, 0, 0, 0))

    # Doorway.
    dx0, dx1 = DOOR_COL * TILE, (DOOR_COL + 1) * TILE
    if room["row"] == "bottom":
        # Through the tall wall: the map already floors this column (see
        # generate-world-map.py's cap-row loop), so open it up and add the
        # jambs, which run the wall's full height down to the seam.
        d.rectangle([dx0, 0, dx1 - 1, seam + LINE - 1], fill=(0, 0, 0, 0))
        d.rectangle([dx0 - LINE, 0, dx0 - 1, seam + LINE - 1], fill=NAVY)
        d.rectangle([dx1, 0, dx1 + LINE - 1, seam + LINE - 1], fill=NAVY)
    else:
        # Through the front face: floor runs out over it, jambs either side.
        img.paste(floor_crop, (dx0, h - TILE))
        d.rectangle([dx0 - LINE, front, dx0 - 1, h - 1], fill=NAVY)
        d.rectangle([dx1, front, dx1 + LINE - 1, h - 1], fill=NAVY)

    return img


def copy_asset(
    src_rel: str, dest_rel: str,
    crop: tuple[int, int, int, int] | None = None, scale: float = 1.0,
) -> None:
    # src_rel may be an absolute Path (e.g. REPO_ROOT / "bookshelf" / "x.png")
    # for the four user-supplied crops living outside moderninteriors-win at
    # its 48px-per-tile scale -- pathlib's / operator returns an absolute RHS
    # unchanged, so MODERNINTERIORS / src_rel resolves correctly either way.
    src = MODERNINTERIORS / src_rel
    dest = WORLD_ASSETS / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if crop is None and scale == 1.0:
        shutil.copyfile(src, dest)
        return
    img = Image.open(src).convert("RGBA")
    if crop is not None:
        img = img.crop(crop)
    if scale != 1.0:
        w, h = img.size
        img = img.resize((round(w * scale), round(h * scale)), Image.NEAREST)
    img.save(dest)


def build_wall_shade(room) -> Image.Image:
    """The tall wall's two mitered top corners: the flat side wall carrying
    on up as a wedge that tapers from LINE px wide at the wall's top face to
    the full SIDE_STRIP at the floor seam, in the side wall's own color with
    no outline on the diagonal -- exactly how both references draw their
    corners (Gym_2: 1 native px at the top widening to the side wall's full
    8, in 1px steps -- 2px here). Replaces the earlier black-alpha
    darkening, which read as shading on the back wall rather than as the
    side wall turning the corner.

    Sized to the wall stack (cap row(s) + the room's own room_y0 row) and
    anchored on the room's left wall column; build_wall_border_overlay()
    leaves that wall's body transparent so this shows through it."""
    w = ROOM_W * TILE
    back_h = (CAP_H + 1) * TILE
    top = LINE + FACE_END + LINE            # first row of wall body, under the top face
    bottom = back_h - LINE                  # floor-seam outline
    body_x = LINE + FACE_SIDE + LINE
    color = side_wall_color(room)
    out = Image.new("RGBA", (w, back_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    for y in range(top, bottom):
        # Even widths, so the diagonal steps in 2px units like the pack's art.
        ww = LINE + 2 * round((SIDE_STRIP - LINE) * (y - top) / (bottom - 1 - top) / 2)
        d.rectangle([body_x, y, body_x + ww - 1, y], fill=color)
        d.rectangle([w - body_x - ww, y, w - body_x - 1, y], fill=color)
    return out


def main() -> None:
    decor_entries = []
    equipment_entries = []

    for room in ROOMS:
        ox, oy = room_origin(room)
        room_id = room["id"]

        # Corner wedges on the tall wall (cap row(s) + the room's own
        # room_y0 row), anchored on the room's left wall column. Emitted
        # first so everything else in this room draws on top of it.
        shade_rel = f"decor/{room_id}/wall-shade.png"
        (WORLD_ASSETS / shade_rel).parent.mkdir(parents=True, exist_ok=True)
        build_wall_shade(room).save(WORLD_ASSETS / shade_rel)
        decor_entries.append({
            "image": shade_rel,
            "x": (ox - 1) * TILE,
            "y": (room_y0(room) - CAP_H) * TILE,
        })

        # Wall frame, every room: covers the cap row(s) plus the room's
        # ROOM_W x ROOM_H footprint, i.e. the same top-left as the wedges
        # above. Its tall-wall body is transparent, so the wedges (and the
        # real wall tiles) show through.
        border_rel = f"decor/{room_id}/wall-border.png"
        (WORLD_ASSETS / border_rel).parent.mkdir(parents=True, exist_ok=True)
        build_wall_border_overlay(room, floor_crop_for(room)).save(WORLD_ASSETS / border_rel)
        decor_entries.append({
            "image": border_rel,
            "x": room["x0"] * TILE,
            "y": (room_y0(room) - CAP_H) * TILE,
        })

        for item in DECOR.get(room_id, []):
            dest_rel = f"decor/{room_id}/{item['dest']}"
            copy_asset(item["src"], dest_rel, item.get("crop"), item.get("scale", 1.0))
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
