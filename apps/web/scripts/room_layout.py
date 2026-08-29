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
    # 6_Music_and_Sport_32x32's Singles folder turned out to be almost
    # entirely music-classroom gear (pianos, guitars, drum kits, harps) plus
    # sports memorabilia (medals, trophy statues) -- no ping-pong/foosball
    # table and no chair exist as Singles files (see task-8-report.md for the
    # exhaustive search). The two-trophy-shelf items and the sports ball did
    # turn up clean as Singles files, so those are copied whole; the seat is
    # cropped from the category's composite sheet (a piano-stool row that
    # never got split into Singles, same lesson as Task 7's bookshelf); the
    # ping-pong table comes from 14_Basement_Singles_32x32, which has a
    # proper top-down table-tennis sprite with a net.
    "analytics": [
        dict(col=1, row=0, dest="trophy-left.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_157.png"),
        dict(col=7, row=0, dest="trophy-right.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_158.png"),
        # Matches desk index 0 (desk-analytics-1) exactly -- this table IS
        # that desk's visual reskin, same pattern as auth-module's reading
        # desks. The Singles file is 80x128 (2.5x4 tiles, taller than the
        # brief's "~2 tiles wide" guess), so it reaches down to row 5 (the
        # interior's last row) and its left edge sits at col 3. The seat
        # below was moved off col=3 to col=1 (brief draft had (3,3), which
        # the table's real footprint -- cols 3-5, rows 2-5 -- would have
        # swallowed; even col=2 clips the table's left edge by 2px since the
        # 34px-wide seat crop rounds up to a 2-tile-wide footprint) so it
        # sits clearly beside the table instead of under or clipping it.
        dict(col=3, row=2, dest="ping-pong.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/14_Basement_Singles_32x32/Basement_Singles_32x32_242.png"),
        dict(col=1, row=3, dest="seat.png",
             src="1_Interiors/32x32/Theme_Sorter_32x32/6_Music_and_sport_32x32.png",
             crop=(144, 142, 178, 168)),
        dict(col=1, row=4, dest="pennant.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_79.png"),
        dict(col=7, row=4, dest="plant.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/Living_Room_Singles_32x32_16.png"),
    ],
    # 20_Japanese_Interiors_Singles_32x32/ has a shoji screen, several
    # kotatsu-style low tables, and two distinct potted bonsai as clean
    # Singles files. It does NOT have a plain flat floor cushion (zabuton)
    # -- the only cushion-shaped Singles items are either an L-backed
    # zaisu chair or a stacked pile of round poufs -- but the category's
    # composite sheet (20_Japanese_interiors_32x32.png, note lowercase
    # "interiors" in that filename vs. the Singles folder's capitalized
    # one) has a clean row of 5 flat square cushions that never got split
    # out, same lesson as Tasks 7/8's cropped items (see task-9-report.md).
    # _61 and _62 (the two shoji files) are byte-identical, so shoji-right
    # just reuses _61 rather than copying a pointless duplicate under a
    # different source name.
    "database": [
        dict(col=1, row=0, dest="shoji-left.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/20_Japanese_Interiors_Singles_32x32/Japanese_Interiors_Singles_32x32_61.png"),
        dict(col=7, row=0, dest="shoji-right.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/20_Japanese_Interiors_Singles_32x32/Japanese_Interiors_Singles_32x32_61.png"),
        # Matches desk index 0 (desk-database-1) exactly, same pattern as
        # auth-module's reading desks and analytics's ping-pong table --
        # this IS that desk's visual reskin. 64x64 (2x2 tiles), so it
        # occupies cols 3-4 / rows 2-3 and leaves desk index 1 at (5,2)
        # (the animated incense burner, a single 32x32 tile) untouched.
        dict(col=3, row=2, dest="chabudai.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/20_Japanese_Interiors_Singles_32x32/Japanese_Interiors_Singles_32x32_51.png"),
        # Cropped from the composite sheet, not a Singles file -- see the
        # block comment above. Both are 26x24px, well inside a single
        # tile. Placed at col 2 / col 5 (not the brief's draft col
        # 3/col 5) so neither sits under the chabudai's own cols 3-4
        # footprint; each lands directly beside one of the table's two
        # front corners instead.
        dict(col=2, row=3, dest="cushion-1.png",
             src="1_Interiors/32x32/Theme_Sorter_32x32/20_Japanese_interiors_32x32.png",
             crop=(354, 404, 380, 428)),
        dict(col=5, row=3, dest="cushion-2.png",
             src="1_Interiors/32x32/Theme_Sorter_32x32/20_Japanese_interiors_32x32.png",
             crop=(450, 404, 476, 428)),
        dict(col=1, row=4, dest="bonsai-left.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/20_Japanese_Interiors_Singles_32x32/Japanese_Interiors_Singles_32x32_56.png"),
        dict(col=7, row=4, dest="bonsai-right.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/20_Japanese_Interiors_Singles_32x32/Japanese_Interiors_Singles_32x32_57.png"),
    ],
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
