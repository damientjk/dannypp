#!/usr/bin/env python3
"""Composite the world's tileset from moderninteriors-win art: 7 room floor
textures, 1 wall block (3D-shaded), 1 desk/computer prop, 1 decorative rug,
a 2-tile window pair, and 1 potted plant — all cropped directly from the
source sheets (the wall gets a synthesized coping shade, see shade_wall).
One-off asset build — re-run only if the source art or tile choices change.

Usage: python3 generate-world-tileset.py
"""
from pathlib import Path
from PIL import Image

REPO_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "moderninteriors-win").is_dir())
MODERNINTERIORS = REPO_ROOT / "moderninteriors-win"
WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"

TILE = 32

ROOM_BUILDER = MODERNINTERIORS / "1_Interiors" / "32x32" / "Room_Builder_32x32.png"
THEME_SORTER = MODERNINTERIORS / "1_Interiors" / "32x32" / "Theme_Sorter_32x32"
BATHROOM = THEME_SORTER / "3_Bathroom_32x32.png"
CLOTHING_STORE = THEME_SORTER / "21_Clothing_Store_32x32.png"
GENERIC = THEME_SORTER / "1_Generic_32x32.png"
LIVING_ROOM = THEME_SORTER / "2_LivingRoom_32x32.png"

# (source sheet, col, row) — each verified visually (Step 2): cropped, scaled
# up, and read back to confirm a clean, distinct texture rather than a grid
# separator/label row or a fragment of a neighboring multi-tile object. The
# Room_Builder sheet packs each floor swatch as an (odd, even) row pair where
# the odd row is a label/margin row (mostly white) — the even row below it is
# the actual flat texture, which is what every FLOOR_TILES entry below uses.
WALL_TILE = (ROOM_BUILDER, 7, 2)
# Task 10 fix: 3 of these 4 texture-row crops (auth-module, billing,
# living-room) landed on the LEFT edge column of their swatch's texture
# block, which — unlike kitchen/deploy-config's crops — picks up a 1-2px
# dark navy border baked into the source swatch card. Invisible in the
# isolated tileset strip (adjacent tiles are the same border color pattern),
# but glaring once a room repeats the same floor gid across many cells: it
# reads as a full grid of seams across the floor instead of one uniform
# texture (found via the Step 4 in-app screenshot, confirmed via a pixel
# scan of tileset.png). Fixed by shifting one column right into the same
# swatch block's clean interior (verified border-free on all 4 edges, same
# fill color, via a full-edge pixel scan) — same technique as Task 2's own
# fix round, not a new floor color. Hallway and database resisted the same
# fix (their swatch blocks are narrower, each row individually bordered —
# see task-10-report.md) and are flagged there as a known remaining defect
# rather than force a change without the same confidence.
FLOOR_TILES = [
    (ROOM_BUILDER, 16, 26),  # hallway — warm brown
    (ROOM_BUILDER, 5, 15),   # auth-module — neutral grey (was col 4: bordered)
    (ROOM_BUILDER, 30, 54),  # kitchen — orange
    (ROOM_BUILDER, 0, 24),   # database — pale tan
    (ROOM_BUILDER, 16, 43),  # billing — rose/mauve (was col 15: bordered)
    (ROOM_BUILDER, 5, 35),   # living-room — light wood tan (was col 4: bordered)
    (ROOM_BUILDER, 24, 55),  # deploy-config — warm gold wood
]
# Desk+monitor: Room_Builder's own (3,4)/Interiors (3,4) coordinates land
# mid-object (a monitor top fused with an unrelated green tile below it).
# The Generic sheet's monitor+desk sprite (col 6, row 0) looked like a
# fix, but its true alpha bounds run y=20-95px — a ~2.3-tile-tall reception
# desk, not a single-tile object; any 32px crop of it is necessarily a
# fragment (confirmed via per-row alpha-channel scan). Theme_Sorter's
# Clothing_Store sheet has a standalone checkout-computer sprite (monitor
# screen + keyboard/base) at (3,32) that is genuinely single-tile: its alpha
# bbox is x[6-27] y[8-29] within its 32x32 cell (margin on all four edges,
# confirmed via alpha-channel scan), and the same sprite also appears
# embedded in two multi-tile counter assemblies elsewhere on the same
# sheet — confirming it's an intentional standalone unit, not an accidental
# slice. Grid-aligned, so it uses crop_tile() like every other tile.
DESK_TILE = (CLOTHING_STORE, 3, 32)
RUG_TILE = (BATHROOM, 0, 3)  # small mat — Interiors (7,16) turned out to be a mid-object slice of a multi-tile area rug

# Task 10 additions. Real search performed (contact-sheet crops of each
# candidate, read back at scale) across Conference_Hall, Television_Studio,
# Generic, Condominium, Classroom_and_library, and Jail before picking these:
#
# Window: every window graphic in this pack — Room_Builder's own
# windowed-wall block at (19-23, 7-8), Generic's 4-pane window at (5,9)-
# (6,10), its big sky window at (8, 8-9) — is authored 2 tiles TALL (verified
# via per-tile alpha bbox scans), because a real window is taller than this
# pack's 1-tile-thick wall ring. Our rooms' wall ring is only 1 tile thick,
# so a 2-tall window can't be placed without bleeding into interior floor.
# Generic's small window at (5,8)-(6,8) is the one exception: it is authored
# exactly 1 tile TALL and 2 tiles WIDE (a horizontal transom window), so it
# splits cleanly into two single-tile gids that reconstruct the complete,
# non-fragmentary source graphic when placed side by side — no synthesis,
# still a direct crop, just used as an intentional adjacent pair.
WINDOW_LEFT_TILE = (GENERIC, 5, 8)
WINDOW_RIGHT_TILE = (GENERIC, 6, 8)

# Plant: LivingRoom's potted topiary trees at (10-11,0-1) and Generic's palm
# at (13-14,25-27) are multi-tile (confirmed via alpha bbox scans — content
# straddles tile boundaries on all sides). LivingRoom (0,5) is a small potted
# fern that is genuinely single-tile: bbox (4,12,28,32), margin on every
# edge, nothing touching a border — a clean, complete object.
PLANT_TILE = (LIVING_ROOM, 0, 5)


def crop_tile(sheet_cache, source_path, col, row):
    if source_path not in sheet_cache:
        sheet_cache[source_path] = Image.open(source_path).convert("RGBA")
    sheet = sheet_cache[source_path]
    return sheet.crop((col * TILE, row * TILE, col * TILE + TILE, row * TILE + TILE))


def shade_wall(tile):
    """Give the flat Room_Builder wall block a 3D-look coping: a lighter
    highlight band along its top edge and a darker shadow band along its
    bottom, so it reads as a wall with height instead of a flat swatch.

    moderninteriors-win ships a pre-shaded "3d_walls" wall set, but only as
    a 16x16-resolution subfile (Room_Builder_subfiles/Room_Builder_3d_walls
    _16x16.png) with no 32x32 counterpart — confirmed by listing every
    32x32 sheet in the pack and scanning Room_Builder_32x32's full wall row
    (row 0-4, all ~76 columns): every color variant there is a flat, single-
    shade autotile block (verified via a vertical pixel sample down the
    current wall tile — uniform color, no gradient). So the highlight/shadow
    band is synthesized here rather than found, using the same base wall
    texture Task 2 already picked.
    """
    shaded = tile.copy()
    px = shaded.load()
    w, h = shaded.size
    top_band, bottom_band = 7, 5
    for y in range(h):
        if y < top_band:
            factor = 1.18
        elif y >= h - bottom_band:
            factor = 0.72
        else:
            continue
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            px[x, y] = (min(255, int(r * factor)), min(255, int(g * factor)), min(255, int(b * factor)), a)
    return shaded


def main() -> None:
    sheet_cache = {}
    tiles = [Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))]  # gid 0: blank
    for source_path, col, row in FLOOR_TILES:
        tiles.append(crop_tile(sheet_cache, source_path, col, row))
    wall_tile = shade_wall(crop_tile(sheet_cache, *WALL_TILE))
    tiles.append(wall_tile)
    tiles.append(crop_tile(sheet_cache, *DESK_TILE))
    tiles.append(crop_tile(sheet_cache, *RUG_TILE))
    # Both window crops are only opaque in their bottom ~45% (rows 16-29 of
    # their 32x32 cell) — placing the raw crop directly into the wall ring
    # replaces the wall tile outright, so the transparent 55% shows nothing
    # behind it: a floating window over a gash into the void. Composite each
    # crop onto its own COPY of the shaded wall tile instead, so the wall's
    # own texture/shading shows through the window crop's transparent rows.
    tiles.append(Image.alpha_composite(wall_tile.copy(), crop_tile(sheet_cache, *WINDOW_LEFT_TILE)))
    tiles.append(Image.alpha_composite(wall_tile.copy(), crop_tile(sheet_cache, *WINDOW_RIGHT_TILE)))
    tiles.append(crop_tile(sheet_cache, *PLANT_TILE))

    sheet = Image.new("RGBA", (TILE * len(tiles), TILE), (0, 0, 0, 0))
    for i, tile in enumerate(tiles):
        sheet.paste(tile, (i * TILE, 0))

    out_path = WORLD_ASSETS / "tileset.png"
    sheet.save(out_path)
    print(f"wrote {out_path} ({sheet.size[0]}x{sheet.size[1]}, {len(tiles)} tiles)")


if __name__ == "__main__":
    main()
