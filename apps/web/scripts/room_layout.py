"""Single source of truth for the world's room geometry, desk positions,
floor textures, and decor. generate-world-map.py, generate-world-tileset.py,
and generate-room-decor.py all import from here so they can't drift apart on
where e.g. "desk-billing-1" actually is.

Room footprint is uniform: every room is ROOM_W x ROOM_H tiles including its
1-tile wall ring, giving a (ROOM_W-2) x (ROOM_H-2) walkable interior. Verified
math (apps/web/scripts/room_layout.py's own constants, see the design spec
§3): 3 room columns + 2 GAP-wide cosmetic gaps span the 35-wide canvas
exactly (11+1+11+1+11=35); 2 room rows + 1 HALLWAY_H-tall real corridor span
the 20-tall canvas exactly (8+4+8=20).
"""

TILE = 32
WIDTH, HEIGHT = 35, 20
ROOM_W, ROOM_H = 11, 8    # outer footprint incl. 1-tile wall ring
GAP = 1                    # cosmetic filler between same-row room columns (blocked, not a real path)
HALLWAY_H = 4               # real walkable plaza between the two room rows

# id, owner (None = unprotected/common), row ("top"/"bottom"), x0 (left
# column of the outer footprint), theme (used only for decor-file naming),
# floor = (sheet_name, col, row) crop out of Room_Builder_Floors_32x32.png.
# Every floor pick below was cropped, scaled up, and read back to confirm
# (see the implementation plan's Task 2 for the verification transcript).
ROOMS = [
    dict(id="auth-module", owner="user-a", row="top", x0=0, theme="library",
         floor=("Room_Builder_Floors", 0, 13)),   # warm honey-gold wood plank
    dict(id="analytics", owner="user-a", row="top", x0=12, theme="sports",
         floor=("Room_Builder_Floors", 5, 12)),   # light cream-tan wood, court-like
    dict(id="database", owner="user-b", row="top", x0=24, theme="japanese",
         floor=("Room_Builder_Floors", 1, 15)),   # muted sage-grey woven mat texture
    dict(id="billing", owner="user-a", row="bottom", x0=0, theme="gym",
         floor=("Room_Builder_Floors", 13, 17)),  # grey stone/rubber-flooring texture
    dict(id="living-room", owner=None, row="bottom", x0=12, theme="living-room",
         floor=("Room_Builder_Floors", 5, 13)),   # warm tan-brown wood
    dict(id="deploy-config", owner="user-b", row="bottom", x0=24, theme="music",
         floor=("Room_Builder_Floors", 6, 23)),   # reddish-brown varied wood plank
]

# Interior-relative (col 0-8, row 0-5) desk spawn positions, in
# desk-<id>-1/-2/... order. living-room has none -- it's the one
# unprotected, deskless common room (FILE_ROOMS.deskIds == []).
DESKS = {
    "auth-module": [(3, 2), (5, 2)],
    "analytics": [(3, 2), (6, 3)],
    "database": [(3, 2), (5, 2)],
    "billing": [(3, 3), (5, 3)],
    "deploy-config": [(2, 4), (6, 3)],
}

# Which desk index (0-based) in DESKS gets an animated equipment sprite, and
# its spritesheet (filename only, under
# moderninteriors-win/3_Animated_objects/32x32/spritesheets/) + row-0 frame
# count (verified via PNG dimensions during planning: width/32).
#
# Desks not listed here still work exactly the same in agentSim.ts --
# behaviorMode still flips to "working" -- they just don't get an animated
# prop. No plain "sit and use" equivalent exists in the pack for
# analytics-desk-1 (ping-pong table) or database-desk-1 (chabudai table);
# auth-module's two reading desks are the disclosed Library gap from the
# design spec §5 (no non-Halloween reading/book animation exists at all).
# Those three become static DECOR entries instead -- see Tasks 7, 8, 9.
EQUIPMENT = {
    ("billing", 0): ("animated_punching_bag_left_32x32.png", 12),
    ("billing", 1): ("animated_treadmill_32x32.png", 9),
    ("analytics", 1): ("animated_TV_reportage_32x32.png", 72),
    ("database", 1): ("animated_incense_burner_4_10_loop_32x32.png", 13),
    ("deploy-config", 0): ("animated_wall_piano_32x32.png", 16),
    ("deploy-config", 1): ("animated_amplifier_32x32.png", 3),
}

# Static (non-animated) decor per room. Each entry: col, row
# (interior-relative, 0-8 / 0-5), dest (filename under
# decor/<room-id>/), src (path relative to moderninteriors-win/). Filled in
# incrementally, one room at a time, by Tasks 7-12 -- each entry's src is
# found via scripts/asset_contact_sheet.py, since the Theme_Sorter_Singles
# folders carry no metadata beyond a sequential number.
DECOR = {
    # bookshelf-left/right and reading-desk-1/2 are cropped straight out of
    # the category's full (non-Singles) composite sheet -- the
    # Theme_Sorter_Singles_32x32/5_Classroom_and_Library_Singles_32x32/
    # folder the design spec assumed turned out to be a band/music
    # classroom set with no bookshelf, desk, or chair singles at all (see
    # task-7-report.md). Both desk crops already include their integrated
    # bench seat, so no separate chair item is needed here.
    "auth-module": [
        # col=0/col=6, not the original col=1/col=7: this bookshelf is a
        # 3x3-tile object (the Singles-folder substitute it replaces was
        # only 1x2), so the old columns either overlapped
        # reading-desk-1 at (3,2) or ran past the interior's right edge
        # (col 8 max) into the wall. Corner placement flanking the desks
        # avoids both and reads as a reading nook between two shelves.
        dict(col=0, row=0, dest="bookshelf-left.png",
             src="1_Interiors/32x32/Theme_Sorter_32x32/5_Classroom_and_library_32x32.png",
             crop=(0, 416, 96, 512)),
        dict(col=6, row=0, dest="bookshelf-right.png",
             src="1_Interiors/32x32/Theme_Sorter_32x32/5_Classroom_and_library_32x32.png",
             crop=(0, 416, 96, 512)),
        dict(col=3, row=2, dest="reading-desk-1.png",
             src="1_Interiors/32x32/Theme_Sorter_32x32/5_Classroom_and_library_32x32.png",
             crop=(160, 32, 192, 96)),
        dict(col=5, row=2, dest="reading-desk-2.png",
             src="1_Interiors/32x32/Theme_Sorter_32x32/5_Classroom_and_library_32x32.png",
             crop=(64, 32, 96, 96)),
        dict(col=1, row=4, dest="plant.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/Living_Room_Singles_32x32_16.png"),
    ],
    "analytics": [],
    "database": [],
    "billing": [],
    "living-room": [],
    "deploy-config": [],
}

# Always-animating props not gated on any desk occupancy (col, row, dest,
# src, frames, room_id). Empty until Task 7 adds Library's ambient candle.
AMBIENT = [
    dict(room_id="auth-module", col=7, row=5, dest="animated_wall_candle_32x32.png",
         src="3_Animated_objects/32x32/spritesheets/animated_wall_candle_32x32.png", frames=3),
]
