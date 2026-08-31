"""Single source of truth for the world's room geometry, desk positions,
floor textures, and decor. generate-world-map.py, generate-world-tileset.py,
and generate-room-decor.py all import from here so they can't drift apart on
where e.g. "desk-billing-1" actually is.

Room footprint is uniform: every room is ROOM_W x ROOM_H tiles including its
1-tile wall ring, giving a (ROOM_W-2) x (ROOM_H-2) walkable interior. Verified
math (apps/web/scripts/room_layout.py's own constants, see the design spec
§3): 3 room columns + 2 GAP-wide cosmetic gaps span the 35-wide canvas
exactly (11+1+11+1+11=35); the vertical stack is symmetric -- both room rows
get their own CAP_H cap row -- see CAP_H.
"""

from pathlib import Path

REPO_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "moderninteriors-win").is_dir())

TILE = 32
WIDTH, HEIGHT = 35, 22
ROOM_W, ROOM_H = 11, 8    # outer footprint incl. 1-tile wall ring
GAP = 1                    # cosmetic filler between same-row room columns (blocked, not a real path)
HALLWAY_H = 4               # real walkable plaza between the two room rows
# Extra wall-cap rows immediately above whichever wall sits above a room's own
# floor -- the wall that faces away from that room's own interior, giving a
# CAP_H+1 = 2-tile-tall wall stack there (measured off
# moderninteriors-win/6_Home_Designs/Shooting_Range_Designs -- its back wall is
# 50px ~= 1.6 tiles). For top-row rooms that's their back wall (opposite the
# door); for bottom-row rooms it's their door wall (facing the hallway) --
# both happen to be the room's own room_y0 row, which is what cap_rows() in
# generate-world-map.py actually keys off.
CAP_H = 1
# Door column relative to a room's x0: the exact middle of the 11-wide
# footprint. Shared by generate-world-map.py's door_tile() (which decides
# which wall it punches through) and generate-room-decor.py's wall overlay
# (which draws the opening) so the two can't drift apart.
DOOR_COL = ROOM_W // 2

assert ROOM_W * 3 + GAP * 2 == WIDTH
# Vertical stack, top to bottom: [cap + top room] + [hallway] + [cap + bottom room].
assert CAP_H + ROOM_H + HALLWAY_H + CAP_H + ROOM_H == HEIGHT

def room_y0(room):
    """Absolute y of the room's exterior rect's top-left corner. Shared by
    generate-world-map.py's exterior_rect() and generate-room-decor.py's
    room_origin() so the two can't drift on where the cap rows shifted rooms
    to. Symmetric: both row's rooms get a dedicated CAP_H-row cap carved out
    of HEIGHT, immediately above the room's own footprint -- there is no
    gap. Top-row rooms sit CAP_H rows down from the map's top edge, with
    their cap row(s) filling that space above them. Bottom-row rooms sit
    flush against the map's bottom edge, with their cap row(s) sitting
    between the hallway and the room (row 13 in the current 22-row layout) --
    the same structure as the top row's cap, just mirrored. (A prior,
    asymmetric version of this function shipped a real bug -- see Task 5 --
    so keep this description precise if the geometry changes again.)"""
    return CAP_H if room["row"] == "top" else HEIGHT - ROOM_H


def wall_crop_box(room, tile=TILE):
    """Crop box (left, top, right, bottom) for a room's wall tile in
    Room_Builder_Walls_32x32.png: column 1 (not 0 -- column 0 carries a 2px
    dark seam baked into its left edge), row room["wall"]*2+1 (the plain
    wall body, not the decorative-trim row above it at 2*wall). Shared by
    generate-world-tileset.py's per-room wall build and
    generate-room-decor.py's wall_body_color() so the two crops can't drift
    apart."""
    row = room["wall"] * 2 + 1
    return (tile, row * tile, tile * 2, row * tile + tile)

# id, owner (None = unprotected/common), row ("top"/"bottom"), x0 (left
# column of the outer footprint), theme (used only for decor-file naming),
# floor = (sheet_name, col, row) crop out of Room_Builder_Floors_32x32.png.
# Every floor pick below was cropped, scaled up, and read back to confirm
# (see the implementation plan's Task 2 for the verification transcript).
ROOMS = [
    dict(id="auth-module", owner="user-a", row="top", x0=0, theme="library",
         floor=("Room_Builder_Floors", 0, 13), wall=13),   # tan vertical wood-plank paneling
    dict(id="analytics", owner="user-a", row="top", x0=12, theme="sports",
         floor=("Room_Builder_Floors", 5, 12), wall=2),    # flat painted grey, gymnasium wall
    dict(id="database", owner="user-b", row="top", x0=24, theme="japanese",
         floor=("Room_Builder_Floors", 1, 15), wall=16),   # muted mauve-grey, washi-paper-adjacent
    dict(id="billing", owner="user-a", row="bottom", x0=0, theme="gym",
         floor=("Room_Builder_Floors", 13, 17), wall=15),  # grey stone/concrete texture
    dict(id="living-room", owner=None, row="bottom", x0=12, theme="living-room",
         floor=("Room_Builder_Floors", 5, 13), wall=14),   # horizontal warm-tan wood plank
    dict(id="deploy-config", owner="user-b", row="bottom", x0=24, theme="music",
         floor=("Room_Builder_Floors", 6, 23), wall=12),   # dusty rose-brown, matches warm floor
]

# Catches a room silently placed out of bounds -- build_layer() in
# generate-world-map.py has no bounds check and would otherwise silently
# wrap a too-far room's cells into the next map row instead of erroring.
assert len(ROOMS) == 6
assert all(r["x0"] + ROOM_W <= WIDTH for r in ROOMS)

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
    # billing desk-1/desk-2 equipment removed (fix round, 2026-08-31):
    # the animated punching-bag/treadmill sprites had a user-reported
    # "keeps appearing and disappearing" bug in the desk-occupancy-gated
    # animation toggle. Controller ruling: pull both bindings so those two
    # desks fall back to the same no-animation path every other unlisted
    # desk already uses (agentSim.ts still flips behaviorMode to "working"
    # -- see the comment below), and cover the same visual spots with
    # plain static DECOR entries instead (see DECOR["billing"]) until the
    # underlying animation bug is fixed properly. DESKS["billing"] is
    # unchanged -- agents still route to and work at (3,3)/(5,3).
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
    # Neither the bookshelf nor the desks are composite-sheet crops anymore
    # (see task-7-report.md for why that was ever the fallback: the
    # Theme_Sorter_Singles_32x32/5_Classroom_and_Library_Singles_32x32/
    # folder the design spec assumed turned out to be a band/music classroom
    # set with no bookshelf, desk, or chair singles at all). The bookshelf is
    # now the user's own isolated custom crop (see its dict comment below);
    # the desks are real "table with book" Singles files from Library/ (see
    # their dict comment below) -- no separate chair item is needed since
    # each table's own art already reads as a complete desk.
    "auth-module": [
        # User-isolated 2-piece crop (repo-root/bookshelf/, 48px-tier source,
        # scale=2/3 down to this game's 32px tiles) -- no bookshelf-with-books
        # sprite exists anywhere in moderninteriors-win itself (8 folders
        # checked during design). row=-1 (not 0) so the shelf's top overlaps
        # this room's tall back wall (row 0 is auth-module's capped wall,
        # since it's a top-row room) instead of sitting flush below it -- see
        # this plan's "wall-covering effect" note.
        dict(col=1, row=-1, dest="bookshelf-left-a.png",
             src=REPO_ROOT / "bookshelf" / "Classroom_and_Library_Singles_48x48_74.png", scale=2/3),
        dict(col=3, row=-1, dest="bookshelf-left-b.png",
             src=REPO_ROOT / "bookshelf" / "Classroom_and_Library_Singles_48x48_75.png", scale=2/3),
        dict(col=5, row=-1, dest="bookshelf-right-a.png",
             src=REPO_ROOT / "bookshelf" / "Classroom_and_Library_Singles_48x48_74.png", scale=2/3),
        dict(col=7, row=-1, dest="bookshelf-right-b.png",
             src=REPO_ROOT / "bookshelf" / "Classroom_and_Library_Singles_48x48_75.png", scale=2/3),
        # User-isolated "table with a book" Singles files (repo-root/Library/,
        # native 32px scale -- no crop/scale needed), replacing the old
        # composite-sheet desk crop per the user's mockup.
        dict(col=3, row=2, dest="table-book-1.png",
             src=REPO_ROOT / "Library" / "Classroom_and_Library_Singles_Shadowless_32x32_5.png"),
        dict(col=5, row=2, dest="table-book-2.png",
             src=REPO_ROOT / "Library" / "Classroom_and_Library_Singles_Shadowless_32x32_7.png"),
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
        # Fix round 3: full rebuild from the user's reorganized Sports Room/
        # folder. Verified every file myself before use -- "trophy.png" and
        # "trophy 2.png" turned out to be byte-identical to the old
        # Music_and_Sport_Singles_32x32_157/158.png two-person scene this
        # room already used and dropped (not a trophy at all -- the same
        # "people flanking a table" render, just relabeled). Did NOT use
        # them as a trophy cluster; col=1 (top-left, row=-1) stays empty
        # pending real trophy art, same as fix round 2. Flagged in the
        # report for the coordinator/user to resolve.
        #
        # hoop.png/basketball.png are byte-identical to this room's already-
        # correct existing assets (_76/_79) -- re-sourced to Sports Room/
        # per the fix request anyway, positions unchanged (col=4, row=-1
        # and col=4, row=1 respectively; hoop's 48px height only reaches
        # row -0.5, so row=1 keeps clear daylight, as established in fix
        # round 2).
        dict(col=4, row=-1, dest="basketball-hoop.png",
             src=REPO_ROOT / "Sports Room" / "hoop.png"),
        dict(col=4, row=1, dest="basketball.png",
             src=REPO_ROOT / "Sports Room" / "basketball.png"),
        # racket 1.png (32x32) -- used ONCE, not duplicated into a pair.
        # This is the same file fix round 2 used twice as "racquet-1"/
        # "racquet-2" (then read as "a pair of crossed paddles"); this
        # round's request re-describes it as "a single racquet/paddle" and
        # explicitly leaves the 1-vs-2 call to me. Placed once, beside the
        # table, since duplicating a single-item asset into a fake pair
        # was the thing that needed correcting last round in the first
        # place.
        dict(col=3, row=1, dest="racket.png",
             src=REPO_ROOT / "Sports Room" / "racket 1.png"),
        # table tennis table.png (80x128, real 2.5x4-tile footprint --
        # this room's largest item by far). Placement forced by geometry,
        # not aesthetics: this item's 4-tile height means ANY vertical
        # position spans rows 2 AND 3 (both desks' rows) in this 6-row
        # interior -- proven by checking all 3 tile-aligned Y options, see
        # report. That leaves column placement as the only lever, and the
        # only column gap wide enough for 80px (96px clear at col=0-2,
        # avoiding desk-analytics-1's col=3 and desk-analytics-2's col=6)
        # is the left side, not literally "the middle" the request asked
        # for -- there's no collision-free way to center an item this
        # size between two desks 3 columns apart in a 9-column room.
        # row=0 is legitimate floor here (database's old shoji screens
        # used it too), not the wall itself.
        dict(col=0, row=0, dest="table-tennis-table.png",
             src=REPO_ROOT / "Sports Room" / "table tennis table.png"),
        # plant.png: kept at its last-committed position (col=1, row=4),
        # NOT the (col=0, row=3) this line had picked up from an unrelated
        # concurrent edit (a "2-tile front wall" comment, apparently a
        # side effect of the other session's jail-cell work landing inside
        # this room's block too). Reverted deliberately, not just left
        # alone: (0,3) makes the table above geometrically unplaceable
        # anywhere in this room (proven -- every Y position's clear x-gap
        # tops out at 64px against the table's 80px need once col=0 is
        # blocked), while (1,4) leaves a clean 96px gap. This fix request's
        # own "plant: unchanged, keep as-is" reads as relative to this
        # room's last commit, not a same-named line another room's task
        # happened to also touch. Flagged in the report.
        dict(col=1, row=4, dest="plant.png",
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
    # Fix round (2026-08-31): full redo with the user's own "Gym Room/"
    # photo-real asset set (repo-root/Gym Room/, native 32px scale -- no
    # crop/scale needed, all dims verified by hand against the file names).
    # The old Theme_Sorter dumbbell-rack/mat crop and the isolated bike pair
    # are gone; the punching bag and treadmill (formerly the two
    # EQUIPMENT-bound animated sprites at desk-billing-1/-2, pulled above
    # after a user-reported "keeps appearing and disappearing" animation
    # bug) are now plain static DECOR at those same two desk spots instead.
    #
    # Billing is a "bottom" row room, so row 0 is the door-facing capped
    # wall and row 5 is the plain back wall.
    #
    # The floor patch (6x 32x32 tiles, assembled 3-wide x 2-tall per the
    # user's own file names) anchors its top-left at col=0/row=4 and is
    # listed FIRST so everything else in this block draws on top of it.
    # Dumbbell rack (64x64, 2x2) sits at col=0/row=4 too, exactly covering
    # the mat's left two columns (rows 4-5, flush with the back wall). Yoga
    # ball (64x64, 2x2) sits on the mat's exposed right corner at col=2/
    # row=4, also flush with the back wall. All three unchanged by the
    # second fix round below -- not part of that request.
    #
    # Second fix round (2026-08-31, third): the user reviewed a live
    # screenshot and asked for a pure repositioning pass -- same 5 items
    # (now 2 punching bags, so 6), same assets, new spots. Two punching
    # bags (32x96, 1x3 tiles each, same source file reused for both) move
    # to the top-left, and one treadmill (64x96, 2x3) to the top-right,
    # both at row=-1 so their top overlaps the door-side wall -- the same
    # wall-covering trick auth-module's bookshelf and analytics's trophies
    # already use, just the first time it's used in a room where that same
    # wall also carries the door. DOOR_COL is an absolute offset from a
    # room's own x0 (col x0+DOOR_COL); billing's x0=0 so the door sits at
    # absolute col 5, i.e. interior-relative col 4 (interior col 0 ==
    # absolute x0+1). Every row=-1 item here was checked against that
    # column: punching bags at col=1/col=2 and the treadmill at col=7 all
    # clear it with room to spare.
    #
    # Bench press (64x96, 2x3) takes over the treadmill's old mid-room slot
    # at col=5/row=1 once the treadmill vacates it for the top-right wall
    # spot. Machine press (64x80, 2x2.5) moves to col=7/row=3, directly
    # below the new treadmill's column (7-8) but starting at y=96 -- the
    # treadmill's row=-1 footprint ends at y=64, so there's a full 32px of
    # clearance before machine press begins; also clear of bench press
    # (adjacent columns, touching at x=224 but not overlapping).
    #
    # Third fix round (2026-08-31, fourth): two more positioning tweaks from
    # a live screenshot review, both pure row moves, no asset/column
    # changes.
    #
    # Dumbbell rack (64x64, 2x2) moved from row=4 to row=3: at row=4 its
    # footprint exactly coincided with the mat's own rows 4-5, so the rack
    # read as flatly stamped across the whole mat rather than clearly
    # standing on it. At row=3 its BASE (bottom tile, row=4) still lands on
    # the mat's front row -- same "floor-under-rack" stacking as before,
    # still intentional -- while its top tile (row=3) rises into open floor
    # above the mat, giving it a visible "standing on the mat's edge" read.
    # Row 5 (the mat's back row) is now fully exposed/visible, no longer
    # hidden under the rack.
    #
    # Punching bags (32x96, 1x3 each) moved from row=-1 to row=-2 -- one
    # tile further onto the wall, per the request. CAP_H=1 means the wall
    # stack is CAP_H+1=2 tiles tall (interior-relative rows -2 and -1), so
    # row=-2 is the wall stack's own top-most row -- the bags' top edge
    # (y=row*32=-64) lands exactly flush with the top of that 2-tile stack,
    # zero overflow past it. Their base moves from row=1 to row=0 -- still
    # a real interior floor row, not out of bounds, so they stay grounded
    # rather than floating disconnected from the floor. Columns (1, 2)
    # unchanged, so they're still clear of the door (interior col=4) and
    # of the treadmill (col=7, untouched by this round).
    #
    # All 13 entries re-checked pairwise after both moves (same exclusions
    # as before for the deliberate floor-under-rack/floor-under-ball
    # stacking): none collide with each other, none overlap the door
    # column, none overflow past the wall stack's top or the interior's
    # right/back edges.
    "billing": [
        dict(col=0, row=4, dest="floor-top-left.png",
             src=REPO_ROOT / "Gym Room" / "floor top left.png"),
        dict(col=1, row=4, dest="floor-top-middle.png",
             src=REPO_ROOT / "Gym Room" / "floor top middle.png"),
        dict(col=2, row=4, dest="floor-top-right.png",
             src=REPO_ROOT / "Gym Room" / "floor top right.png"),
        dict(col=0, row=5, dest="floor-bottom-left.png",
             src=REPO_ROOT / "Gym Room" / "floor bottom left.png"),
        dict(col=1, row=5, dest="floor-bottom-middle.png",
             src=REPO_ROOT / "Gym Room" / "floor bottom middle.png"),
        dict(col=2, row=5, dest="floor-bottom-right.png",
             src=REPO_ROOT / "Gym Room" / "floor bottom right.png"),
        dict(col=0, row=3, dest="dumbbell-rack.png",
             src=REPO_ROOT / "Gym Room" / "Dumbbell rack.png"),
        dict(col=2, row=4, dest="yoga-ball.png",
             src=REPO_ROOT / "Gym Room" / "Yoga ball, put this near the flooring.png"),
        dict(col=1, row=-2, dest="punching-bag-1.png",
             src=REPO_ROOT / "Gym Room" / "Punching bag.png"),
        dict(col=2, row=-2, dest="punching-bag-2.png",
             src=REPO_ROOT / "Gym Room" / "Punching bag.png"),
        dict(col=7, row=-1, dest="treadmill.png",
             src=REPO_ROOT / "Gym Room" / "Threadmill.png"),
        dict(col=5, row=1, dest="bench-press.png",
             src=REPO_ROOT / "Gym Room" / "Bench press (replace bicycles).png"),
        dict(col=7, row=3, dest="machine-press.png",
             src=REPO_ROOT / "Gym Room" / "Machine Press(replace bicycles).png"),
    ],
    # Re-themed per the user's new mockup: plain living room (sofa, TV,
    # coffee table, rug) -> game room (arcade machines, TV+console, a
    # 3-seat sofa facing the screen). No pool table exists anywhere in the
    # pack (checked 2_Living_Room_Singles_32x32, 26_Condominium_Singles_32x32,
    # 14_Basement_Singles_32x32, 13_Conference_Hall_Singles_32x32,
    # 23_Television_and_Film_Studio_SIngles_32x32, 6_Music_and_Sport_32x32).
    # No true multi-seat sofa/couch exists anywhere either (same folders,
    # plus a dimension-based scan of every multi-tile file in Basement) --
    # the user isolated their own 3-piece modular sofa crop (left arm /
    # middle / right arm) from the pack's 48px-per-tile sheet
    # (repo-root/sofa/, scale=2/3 down to this game's 32px tiles).
    #
    # The arcade machines went through several rounds: the first pick
    # (Basement_Singles_32x32_208/_209) turned out to be armchairs, so the
    # user isolated their own 2-piece crop instead. That crop's folder later
    # got a full refresh (rm -rf + re-copy) to add several more custom
    # pieces below, which silently deleted the old
    # Basement_Singles_Shadowless_32x32_218/_219.png files this dict used to
    # reference by name -- breaking generate-room-decor.py for every room
    # until fixed. Re-pointed at the refreshed folder's renamed files
    # ("arcade machine 1/2.png", same cabinets, re-viewed to confirm) --
    # position (col=1/col=2, row=-1) deliberately left untouched this round.
    #
    # living-room is a bottom-row room, so row 0 is its capped DOOR-facing
    # wall (not the back wall) -- see room_y0()'s comment. The door punches
    # through that wall at DOOR_COL (room-relative), which is interior col
    # 4 (DOOR_COL=5 minus the 1-tile wall ring) -- see door_tile() in
    # generate-world-map.py, i.e. absolute pixel span [544, 576). Arcade
    # col=1/col=2 (pixel [448, 512)) sit edge-to-edge, a full empty column
    # short of the door span. Both sit at row=-1 (wall-covering, same
    # convention as every other room's row=-1/row=0 items) -- their 80px
    # height pokes ~48px below the floor line by design, same as every
    # other room's row=-1 decor (bookshelf, trophies, shoji), not a bug.
    #
    # tv-console (previously one single-piece sprite, sitting flush and
    # "cut off" at the interior's right edge) is now the user's real 2-piece
    # "tv console left/right.png" (64x80 each, 128px/4 tiles combined) --
    # moved up to row=-1 alongside the arcades, per this round's request.
    # cols 5-8 (pixel [576, 704)) is the *entire* remaining right-side gap
    # between the door (ends at 576) and the interior's right edge (704) --
    # exactly 128px, so the combined unit necessarily lands flush on both
    # ends (col=5 touches the door span, col=8's right edge is exactly 704).
    # This is a forced fit, not a repeat of the old "sloppy zero-margin"
    # bug: there is no spare column to shift into without either replugging
    # the door or overflowing the wall, and unlike the old single-piece
    # sprite (which had zero transparent padding on its right edge),
    # "tv console right.png"'s own bbox already ends 4px short of its
    # canvas edge, so the visible art itself doesn't touch the wall line
    # even though the canvas does.
    #
    # Sofa: asked to move "up to touch the wall" this round. Checked the
    # numbers first, per the fix request's own instruction -- row=-1 has no
    # room left (arcade fills cols 1-2, tv-console fills cols 5-8, only
    # single-tile col=0/col=3 gaps remain on either side of the door, and
    # the sofa is 3 tiles/96px wide). row=0 doesn't actually solve this
    # either: row=-1 items are 80px tall, so they poke 48px past the floor
    # seam into row=0's own pixel band (y 480-528 overlaps their y
    # 448-528), and the only column gaps clear of both arcade and tv-console
    # at that band are the same single-tile col=0/col=3 slivers -- still not
    # 3 tiles. The sofa can only safely clear both existing items once its
    # own y-range starts at or past y=528 (arcade/tv-console's bottom edge)
    # -- the lowest integer row giving that is row=2 (y=544, a clean 16px
    # gap below them). Kept it at cols 6-8 (unchanged from every prior
    # round) so it still sits directly under tv-console -- now genuinely
    # closer to the wall than its old row=4, just not literally touching
    # it, which the numbers don't support without overlapping the arcade
    # or tv-console. All three segments are flipped vertically
    # (flip=True, Image.FLIP_TOP_BOTTOM) as of this round -- the reviewer
    # found the un-flipped sprite's striped cushion bands (its backrest, by
    # the pack's own art convention) were on top, seat slab on the bottom,
    # meaning the seat faced south (away from the TV) before the flip. Not
    # independently re-confirmed with a screenshot this round (browser
    # unavailable) -- flip applied on the reviewer's structural read, not
    # verified live.
    #
    # Pool table + balls: "middle-left, avoid the door column." A 3-tile/
    # 96px table at cols 1-3 (the brief's own suggested area) would abut the
    # sofa's new home if it re-used cols 3-4 the way an initial pass tried
    # -- but more importantly, checking the numbers first (same rule as
    # everywhere else in this file) showed cols 1-3 leaves zero room for the
    # snack cluster below it (see that entry's comment). Shifted to cols
    # 0-2 instead -- flush against the interior's own left edge, clear of
    # the door, and (crucially) leaves col=3 entirely free for the snack
    # cluster to use. row=2 is forced, not chosen: row=1 would overlap the
    # arcade's cols 1-2 footprint (which reaches down to y=528, past
    # row=1's y=512 start), and row=3 overflows the interior's bottom edge
    # (576+112=688 > 672) -- row=2 (y=544, bottom y=656) is the only
    # integer row that clears both. Balls sit at col=1/row=3, centered over
    # the table's middle column and fully within its 544-656 y-span --
    # listed after the table in this array so it draws on top, the one
    # deliberate overlap in this room (same convention as the original
    # design's rug-under-sofa).
    #
    # Snack table + 2 chairs: "bottom-right, row 4-5." snack-table.png
    # (64px) + chair-right.png (48px, the source file is literally named
    # "chari right.png", a typo -- kept in `src` since that's the real
    # filename on disk, fixed in `dest`) sit edge-to-edge at cols 5-8
    # (x 576-688, 16px inside the interior's right edge at 704), row=4 --
    # unavoidably col=4/door-adjacent on their left side, but that's fine
    # for the same reason as before: row=4 is 4 tiles south of the actual
    # doorway (y 608-672 vs. the door's own y 416-480), decor doesn't gate
    # movement, and nothing here reads as blocking the entrance.
    #
    # chair-reversed.png used to flank the table on the immediate left at
    # this same row (col=3/row=4, touching the table) -- a fix round moved
    # it per the user's marked-up screenshot, wanting it out of that tight
    # flanking spot. The dot pointed roughly south of the table/chair-right
    # gap, but row=5 was checked first (per this fix's own instruction to
    # verify, not assume) and genuinely overflows: y=640, +64px height =
    # 704, 32px past the interior's own bottom edge (672) -- there is no
    # row=5 room in this room at all, confirmed, not assumed. With south
    # off the table, col=3 is still the only fully clear column in this
    # part of the room (immediately west of the door, one tile east of the
    # pool table) -- moved there but to row=2 instead of row=4, so it's
    # no longer touching the table (previously flush at x=576; now a full
    # row separates their y-ranges, x=[512,576) vs the snack cluster's own
    # y=[608,672)) and sits in the same open floor band as the pool table
    # and sofa rather than pinned to the room's very back row. This is a
    # shift *north*, not literally "down" -- flagged here and in the fix
    # report, since south genuinely isn't available and "toward the open
    # floor, decoupled from flanking the table" was the closest honest
    # reading of a hand-drawn, non-exact instruction once the real numbers
    # ruled out the literal one.
    "living-room": [
        dict(col=1, row=-1, dest="arcade-1.png",
             src=REPO_ROOT / "arcade" / "arcade machine 1.png"),
        dict(col=2, row=-1, dest="arcade-2.png",
             src=REPO_ROOT / "arcade" / "arcade machine 2.png"),
        dict(col=5, row=-1, dest="tv-console-left.png",
             src=REPO_ROOT / "arcade" / "tv console left.png"),
        dict(col=7, row=-1, dest="tv-console-right.png",
             src=REPO_ROOT / "arcade" / "tv console right.png"),
        dict(col=0, row=2, dest="pool-table.png",
             src=REPO_ROOT / "arcade" / "pool table.png"),
        dict(col=1, row=3, dest="pool-balls.png",
             src=REPO_ROOT / "arcade" / "pool balls.png"),
        dict(col=6, row=2, dest="sofa-left.png",
             src=REPO_ROOT / "sofa" / "Basement_Singles_48x48_51.png", scale=2/3, flip=True),
        dict(col=7, row=2, dest="sofa-mid.png",
             src=REPO_ROOT / "sofa" / "Basement_Singles_48x48_52.png", scale=2/3, flip=True),
        dict(col=8, row=2, dest="sofa-right.png",
             src=REPO_ROOT / "sofa" / "Basement_Singles_48x48_53.png", scale=2/3, flip=True),
        dict(col=3, row=2, dest="chair-reversed.png",
             src=REPO_ROOT / "arcade" / "chair reversed.png"),
        dict(col=5, row=4, dest="snack-table.png",
             src=REPO_ROOT / "arcade" / "snack table.png"),
        dict(col=7, row=4, dest="chair-right.png",
             src=REPO_ROOT / "arcade" / "chari right.png"),
    ],
    # Fix round: swapped in the user's fresh Music/ crops (repo-root/Music/,
    # native 32px-tier -- no scale needed) over the original picks, piano and
    # amplifier still EQUIPMENT-bound to desk-1/desk-2 and untouched. Every
    # Music/ file was viewed before use, since two of the coordinator's
    # guesses about them turned out wrong:
    # - _39.png is NOT "a full kit with a musician playing it" -- it's
    #   pixel-identical (0 differing px after scaling) to the drums/ folder's
    #   old 48px-tier drum-kit crop, just supplied at native 32px-tier
    #   resolution instead. Same swap for _40.png vs the old drum-stand crop
    #   -- both now source straight from Music/ with no scale=2/3 hack.
    # - _40.png was re-flagged as "possibly a character figure" -- looked
    #   again close up: it's a jagged gold cymbal-burst over blue stand
    #   tubing, same palette as _39's kit, no humanoid silhouette. Kept as
    #   the kit's hi-hat/cymbal stand.
    # - _63.png ("ambiguous, could be a stool") is actually a second,
    #   straight-pole microphone stand (companion to _64's boom stand) --
    #   not a stool, not used here since one mic stand is enough, flagged in
    #   the report for the coordinator.
    # - _4.png is a market/shop stall (canopy + counter) as guessed --
    #   architecture-scale and thematically wrong for a room prop, dropped.
    # _51.png (existing guitar-electric) is byte-identical to Music/_51.png,
    # so its src stays pointed at the original moderninteriors-win path.
    # No acoustic-guitar file exists in the new set, so guitar-acoustic is
    # replaced with _52.png, a second (red) electric guitar variant, per the
    # coordinator's note.
    #
    # Every item's real pixel footprint re-checked against the 9x6 interior
    # and DESKS["deploy-config"]'s two EQUIPMENT sprites (piano desk-1 (2,4)
    # 32x64; amplifier desk-2 (6,3) 32x64) -- the new, taller/wider speaker
    # cabinets (_43 is 32x80, not 32x32) no longer leave room to stack a
    # guitar underneath in the same column like the previous layout did, so
    # the two electric guitars moved outward to col=0/col=8 (previously
    # unused) instead of col=1/col=7, and the new mic-stand took col=7's
    # freed-up lower half (row=4, below speaker-2, clear of the amplifier).
    "deploy-config": [
        dict(col=1, row=2, dest="speaker-1.png",
             src=REPO_ROOT / "Music" / "Music_and_Sport_Singles_32x32_43.png"),
        dict(col=7, row=2, dest="speaker-2.png",
             src=REPO_ROOT / "Music" / "Music_and_Sport_Singles_32x32_44.png"),
        dict(col=0, row=2, dest="guitar-electric.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_51.png"),
        dict(col=8, row=2, dest="guitar-electric-2.png",
             src=REPO_ROOT / "Music" / "Music_and_Sport_Singles_32x32_52.png"),
        dict(col=4, row=4, dest="drum-kit.png",
             src=REPO_ROOT / "Music" / "Music_and_Sport_Singles_32x32_39.png"),
        dict(col=3, row=4, dest="drum-stand.png",
             src=REPO_ROOT / "Music" / "Music_and_Sport_Singles_32x32_40.png"),
        dict(col=7, row=4, dest="mic-stand.png",
             src=REPO_ROOT / "Music" / "Music_and_Sport_Singles_32x32_64.png"),
    ],
}

# Always-animating props not gated on any desk occupancy (col, row, dest,
# src, frames, room_id). Empty until Task 7 adds Library's ambient candle.
AMBIENT = [
    dict(room_id="auth-module", col=7, row=5, dest="animated_wall_candle_32x32.png",
         src="3_Animated_objects/32x32/spritesheets/animated_wall_candle_32x32.png", frames=3),
    # billing's second-treadmill ambient entry (added in a prior fix round)
    # was removed here per the same controller ruling that pulled the
    # EQUIPMENT bindings above -- see that comment.
]
