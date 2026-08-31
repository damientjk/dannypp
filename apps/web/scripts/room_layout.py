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
        # row=-1: analytics is a top-row room, so row 0 is its capped back
        # wall -- see this plan's wall-covering note. Fix round 2: _67 (used
        # as "trophy" in fix round 1) is actually a pair of crossed
        # table-tennis paddles/racquets, confirmed against the real in-game
        # render -- renamed and consolidated into one paired cluster on the
        # right (col=6/7) instead of duplicated at both corners. col=1
        # (top-left) is deliberately left empty -- real trophy + table
        # assets are coming in a follow-up fix round once isolated.
        dict(col=6, row=-1, dest="racquet-1.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/14_Basement_Singles_32x32/Basement_Singles_32x32_67.png"),
        dict(col=7, row=-1, dest="racquet-2.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/14_Basement_Singles_32x32/Basement_Singles_32x32_67.png"),
        dict(col=4, row=-1, dest="basketball-hoop.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_76.png"),
        # Floor items, fix round. Basketball (32x32, 1x1 footprint) sits on
        # the floor under the hoop -- hoop's own footprint (32x48) only
        # reaches to row -0.5, so row=1 leaves clear daylight between them.
        dict(col=4, row=1, dest="basketball.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_79.png"),
        # Table-tennis scene (64x96, 2x3-tile footprint: cols 1-2, rows
        # 1-3). Moved to row=1 from the fix request's suggested row=2 --
        # row=2 would have put the footprint's rows 2-4 squarely over the
        # plant's tile at (col=1, row=4) below. row=1 (rows 1-3) clears the
        # plant, desk-analytics-1 (3,2), desk-analytics-2 (6,3), and the
        # basketball (4,1) -- checked all four pairwise, no overlap, and
        # rows 1-3 stay inside the 0-5 interior row range.
        dict(col=1, row=1, dest="table-tennis.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_157.png"),
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
    # wall and row 5 is the plain back wall -- nothing here sits at row 0.
    # Punching bag (32x96, 1x3 tiles) anchors at row=1 so its base (bottom
    # tile) lands on row 3 -- desk-billing-1's row -- matching where the
    # equipment sprite used to stand. Treadmill (64x96, 2x3 tiles) does the
    # same for desk-billing-2 at row=1 -- also base-row-3.
    #
    # The floor patch (6x 32x32 tiles, assembled 3-wide x 2-tall per the
    # user's own file names) anchors its top-left at col=0/row=4 and is
    # listed FIRST so everything else in this block draws on top of it.
    # Dumbbell rack (64x64, 2x2) sits at col=0/row=4 too, exactly covering
    # the mat's left two columns (rows 4-5, flush with the back wall -- one
    # row earlier than the wall itself, same "anchor at ROOM_H-2 not -1"
    # rule Task 9's mirror comment already documented, so the rack's own
    # bottom edge lands on row 5 instead of overshooting past it). Yoga
    # ball (64x64, 2x2 -- also fix-round-verified size, not the icon-sized
    # ball the name suggests) sits on the mat's exposed right corner at
    # col=2/row=4: the fix request's own suggested row=5 was checked
    # numerically and overflows the interior by a full tile (y ends at 224
    # against a 192 bound) -- the same class of bug this file's own mirror
    # comment already flagged once before -- so it's moved to row=4 to land
    # flush instead, same fix as the rack.
    #
    # Bench press (64x96, 2x3) at col=7/row=3 was checked against the
    # fix request's own claimed "7+2=9, exactly flush" math: confirmed
    # correct both horizontally (x ends at 288, the exact interior right
    # edge) and vertically (y ends at 192, the exact back-wall edge) --
    # zero overflow either axis.
    #
    # Machine press (64x80, 2x2.5) had no prescribed slot -- the fix
    # request asked for the numbers to be worked out from scratch. Checked
    # every other item's actual pixel range first (col*32..+width,
    # row*32..+height): the only genuinely free 2-tile-wide gap left in
    # rows 1-5 is x:[128,192) starting at y=128 (row=4), i.e. col=4/row=4 --
    # everywhere else in reach either collides with the treadmill's row 1-3
    # footprint or the mat/rack/ball block. That slot's bottom edge (y=208)
    # overhangs the back wall by 16px (half a tile), which is the same
    # "small intended overlap into the wall" every >1-tile item here
    # already does deliberately, just deeper because 80px doesn't divide
    # evenly into 32px tiles. Verified this is the only viable placement --
    # row=3 (which would give zero overflow) has no 64px-wide clear x-range
    # at all, since it would clip the treadmill on one side and the
    # mat/rack block on the other.
    #
    # All 12 entries checked pairwise for overlap (excluding the
    # deliberate floor-under-rack and floor-under-ball stacking, both
    # intentional -- floor is listed first specifically so those two
    # render on top of it): none collide with each other, none touch row 0.
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
        dict(col=0, row=4, dest="dumbbell-rack.png",
             src=REPO_ROOT / "Gym Room" / "Dumbbell rack.png"),
        dict(col=2, row=4, dest="yoga-ball.png",
             src=REPO_ROOT / "Gym Room" / "Yoga ball, put this near the flooring.png"),
        dict(col=3, row=1, dest="punching-bag.png",
             src=REPO_ROOT / "Gym Room" / "Punching bag.png"),
        dict(col=5, row=1, dest="treadmill.png",
             src=REPO_ROOT / "Gym Room" / "Threadmill.png"),
        dict(col=7, row=3, dest="bench-press.png",
             src=REPO_ROOT / "Gym Room" / "Bench press (replace bicycles).png"),
        dict(col=4, row=4, dest="machine-press.png",
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
    # The arcade machines went through two rounds: the first pick
    # (Basement_Singles_32x32_208/_209) turned out to be armchairs, not
    # arcade cabinets -- no real arcade-cabinet sprite exists anywhere in
    # the pack itself, so the user isolated their own 2-piece crop instead
    # (repo-root/arcade/, native 32x80 -- 1 tile wide, 2.5 tall, no scale
    # needed). Only 2 machines now (one per file), not 3 -- the pack-search
    # for a 3rd item (e.g. a pool table) came up empty, and the user said
    # to use both real cabinets, not stretch to a 3rd slot.
    #
    # living-room is a bottom-row room, so row 0 is its capped DOOR-facing
    # wall (not the back wall) -- see room_y0()'s comment. The door punches
    # through that wall at DOOR_COL (room-relative), which is interior col
    # 4 (DOOR_COL=5 minus the 1-tile wall ring) -- see door_tile() in
    # generate-world-map.py, i.e. absolute pixel span [544, 576). The
    # armchair-era arcade slots (col 0/2/5, each 2 tiles wide) don't carry
    # over to these 1-tile-wide cabinets -- recomputed from scratch: col=1
    # (pixel [448, 480)) and col=6 (pixel [608, 640)) each cover exactly
    # one interior column, both clear of col 4's door span, of each other,
    # and of tv-console (col=7, pixel [640, 704)) with a full empty column
    # (col 5 or col 3) of breathing room on both sides of the door instead
    # of a flush fit. Both sit at row=-1 (wall-covering, same convention as
    # every other room's row=-1/row=0 items) -- their 80px height pokes
    # ~48px below the floor line by design, the same "front foot on the
    # floor, cabinet back behind the wall line" look every other room's
    # row=-1 decor already has (bookshelf, trophies, shoji), not a bug.
    # tv-console sits at row=1/col=7 (pixel x [640,704), y [512,592)),
    # flush against the right wall -- outside the row=-1 wall band entirely
    # (which ends at y=480), so it isn't clipping the wall either. The
    # sofa's three 32x64 (post-scale) segments sit at row=4, col 6/7/8
    # (pixel y [608,672)) -- edge-to-edge, flush against the right wall and
    # the room's plain south wall (opposite the door, interior bottom edge
    # is also y=672), facing north toward the TV. None of tv-console's or
    # the sofa's edges were found overflowing or clipping when rechecked
    # against the interior bounds this round.
    "living-room": [
        dict(col=1, row=-1, dest="arcade-1.png",
             src=REPO_ROOT / "arcade" / "Basement_Singles_Shadowless_32x32_218.png"),
        dict(col=6, row=-1, dest="arcade-2.png",
             src=REPO_ROOT / "arcade" / "Basement_Singles_Shadowless_32x32_219.png"),
        dict(col=7, row=1, dest="tv-console.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/14_Basement_Singles_32x32/Basement_Singles_32x32_194.png"),
        dict(col=6, row=4, dest="sofa-left.png",
             src=REPO_ROOT / "sofa" / "Basement_Singles_48x48_51.png", scale=2/3),
        dict(col=7, row=4, dest="sofa-mid.png",
             src=REPO_ROOT / "sofa" / "Basement_Singles_48x48_52.png", scale=2/3),
        dict(col=8, row=4, dest="sofa-right.png",
             src=REPO_ROOT / "sofa" / "Basement_Singles_48x48_53.png", scale=2/3),
    ],
    # Real speakers + both guitar types from 6_Music_and_Sport_Singles_32x32,
    # replacing the old crate/plant filler (dropped per the user's mockup --
    # piano and amplifier are EQUIPMENT-bound to desk-1/desk-2 and untouched
    # by this task). Drums are the user's own 2-piece isolated crop
    # (repo-root/drums/, 48px-tier source, scale=2/3) -- no standalone
    # multi-piece drum kit exists anywhere in the pack without a fused
    # character sprite baked in.
    #
    # All six items' real pixel footprints were checked against the 9x6
    # interior and against DESKS["deploy-config"]'s two EQUIPMENT sprites
    # (piano at desk-1 (2,4), 32x64; amplifier at desk-2 (6,3), 32x64) before
    # shipping -- two placements had to move off their original draft:
    # - Both guitars (32x80, 2.5 tiles tall) overflowed the floor by 16px at
    #   row=4, so they sit at row=3 instead (flush under the row=2 speakers,
    #   no gap, still clear of the floor).
    # - drum-stand was drafted at col=6 (right next to drum-kit), but the
    #   amplifier's sprite is 64px/2-tiles tall and occupies col=6 across
    #   both row=3 and row=4, so anything at col=6/row=4 collides with its
    #   lower half. Moved to col=3 (drum-kit's left side, between it and the
    #   piano) instead -- same cluster, mirrored.
    "deploy-config": [
        dict(col=1, row=2, dest="speaker-1.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_34.png"),
        dict(col=7, row=2, dest="speaker-2.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_34.png"),
        dict(col=1, row=3, dest="guitar-electric.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_51.png"),
        dict(col=7, row=3, dest="guitar-acoustic.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_45.png"),
        dict(col=4, row=4, dest="drum-kit.png",
             src=REPO_ROOT / "drums" / "Music_and_Sport_Singles_48x48_39.png", scale=2/3),
        dict(col=3, row=4, dest="drum-stand.png",
             src=REPO_ROOT / "drums" / "Music_and_Sport_Singles_48x48_40.png", scale=2/3),
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
