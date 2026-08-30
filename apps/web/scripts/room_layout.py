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
        # wall -- see this plan's wall-covering note.
        dict(col=1, row=-1, dest="trophy-left.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_147.png"),
        dict(col=7, row=-1, dest="trophy-right.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_147.png"),
        dict(col=4, row=-1, dest="basketball-hoop.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_76.png"),
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
    # Redesign per the user's mockup: mirrors and the yoga mat are dropped
    # (not part of the ask); dumbbell rack and a mat-flooring stand-in stay,
    # plus the user's own 2-piece bicycle-machine crop. _167 is a shelf rack
    # lined with individual dumbbells (_166, right next to it, is a
    # barbell-storage rack instead -- smooth bars, no dumbbell heads). _195
    # is a 64x32 checkered foam mat tile -- the flattest/darkest mat-like
    # item in the folder (neighbours _196/_197 are the same shape in a
    # woven-rug texture, read as a doormat) -- reused here as a "black
    # flooring" stand-in since no true solid-black floor crop exists
    # anywhere in the pack. The bikes (repo-root/gym bicycle/, 48px-tier
    # source, scale=2/3 down to this game's 32px tiles) are the user's own
    # isolated 2-piece pick -- no bicycle-machine sprite exists in the pack
    # itself (confirmed against the full 209-file Singles folder and the
    # animated-spritesheet list).
    #
    # Billing is a "bottom" row room (row="bottom" in ROOMS), so its capped
    # tall wall is on the door side (row 0) and its plain back wall is row 5
    # (room_origin()'s y0 = HEIGHT - ROOM_H for bottom rooms plus
    # door_tile()'s door_y = y0 for them, in generate-world-map.py). None of
    # this room's items sit at row=0, so no wall-covering row offset
    # applies. black-mat sits at row=5 against the plain back wall; the
    # dumbbell rack and both bikes sit at row=1, near the door and clear of
    # the punching bag/treadmill equipment occupying desks (3,3)/(5,3)
    # (Task 6) at row 3.
    "billing": [
        dict(col=1, row=1, dest="dumbbell-rack.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/8_Gym_Singles_32x32/Gym_Singles_32x32_167.png"),
        dict(col=1, row=5, dest="black-mat.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/8_Gym_Singles_32x32/Gym_Singles_32x32_195.png"),
        dict(col=5, row=1, dest="bike-1.png",
             src=REPO_ROOT / "gym bicycle" / "Gym_Singles_48x48_93.png", scale=2/3),
        dict(col=7, row=1, dest="bike-2.png",
             src=REPO_ROOT / "gym bicycle" / "Gym_Singles_48x48_94.png", scale=2/3),
    ],
    # Re-themed per the user's new mockup: plain living room (sofa, TV,
    # coffee table, rug) -> game room (arcade machines, TV+console, a
    # 3-seat sofa facing the screen). No pool table exists anywhere in the
    # pack (checked 2_Living_Room_Singles_32x32, 26_Condominium_Singles_32x32,
    # 14_Basement_Singles_32x32, 13_Conference_Hall_Singles_32x32,
    # 23_Television_and_Film_Studio_SIngles_32x32, 6_Music_and_Sport_32x32)
    # -- a 3rd arcade machine fills that spot instead. No true multi-seat
    # sofa/couch exists anywhere either (same folders, plus a
    # dimension-based scan of every multi-tile file in Basement) -- the
    # user isolated their own 3-piece modular sofa crop (left arm / middle /
    # right arm) from the pack's 48px-per-tile sheet (repo-root/sofa/,
    # scale=2/3 down to this game's 32px tiles).
    #
    # living-room is a bottom-row room, so row 0 is its capped DOOR-facing
    # wall (not the back wall) -- see room_y0()'s comment. Arcade machines
    # line that entrance wall at row=-1 (wall-covering, same convention as
    # every other room's row=-1/row=0 items). The three machines are placed
    # edge-to-edge (col 1/3/5, each 64px = 2 tiles wide) reading as one
    # arcade row; tv-console sits at row=1/col=7, flush against the right
    # wall. The sofa's three 32x64 (post-scale) segments sit at row=4,
    # col 6/7/8 -- edge-to-edge like the arcades, flush against the right
    # wall and the room's plain south wall (opposite the door), facing
    # north toward the TV.
    "living-room": [
        dict(col=1, row=-1, dest="arcade-1.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/14_Basement_Singles_32x32/Basement_Singles_32x32_208.png"),
        dict(col=3, row=-1, dest="arcade-2.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/14_Basement_Singles_32x32/Basement_Singles_32x32_209.png"),
        dict(col=5, row=-1, dest="arcade-3.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/14_Basement_Singles_32x32/Basement_Singles_32x32_208.png"),
        dict(col=7, row=1, dest="tv-console.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/14_Basement_Singles_32x32/Basement_Singles_32x32_194.png"),
        dict(col=6, row=4, dest="sofa-left.png",
             src=REPO_ROOT / "sofa" / "Basement_Singles_48x48_51.png", scale=2/3),
        dict(col=7, row=4, dest="sofa-mid.png",
             src=REPO_ROOT / "sofa" / "Basement_Singles_48x48_52.png", scale=2/3),
        dict(col=8, row=4, dest="sofa-right.png",
             src=REPO_ROOT / "sofa" / "Basement_Singles_48x48_53.png", scale=2/3),
    ],
    # 6_Music_and_Sport_Singles_32x32/ (same folder Task 8 searched) has no
    # standalone stool/crate Singles file either -- it's the same
    # never-split piano-stool row Task 8 already found and partly used
    # (analytics/seat.png took the red-topped one at crop x144-177). The row
    # has two other color variants at x16-49 (orange-trimmed legs) and
    # x80-113 (plain grey legs), both confirmed via pixel bounding-box scan
    # (34x26, identical shape to the already-shipped seat.png), so this room
    # uses those two instead of reusing analytics' exact stool.
    #
    # Plants reuse the Living_Room_Singles_32x32 folder like every other
    # room (auth-module, analytics, database all found their plant(s)
    # there): _15 is a distinct succulent-in-a-pot (not previously used,
    # for variety) and _16 is the round leafy plant auth-module/analytics
    # already used (reused per the brief's "if convenient"). Both are
    # 32x64 (1x2 tiles), so col=1/col=7, row=4 is the same flush-to-back-
    # wall flanking placement every other room already settled on. Plant-
    # right was moved off the brief's draft (7,1) to (7,4): at row=1 it
    # would sit directly beside crate-2 (6,1), whose 34px-wide crop bleeds
    # 2px past its own tile into col 7 -- the same clipping the analytics
    # task's comment flagged as worth avoiding for a placed object, not just
    # empty space.
    "deploy-config": [
        dict(col=2, row=2, dest="crate-1.png",
             src="1_Interiors/32x32/Theme_Sorter_32x32/6_Music_and_sport_32x32.png",
             crop=(16, 142, 50, 168)),
        dict(col=6, row=1, dest="crate-2.png",
             src="1_Interiors/32x32/Theme_Sorter_32x32/6_Music_and_sport_32x32.png",
             crop=(80, 142, 114, 168)),
        dict(col=1, row=4, dest="plant-left.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/Living_Room_Singles_32x32_15.png"),
        dict(col=7, row=4, dest="plant-right.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/Living_Room_Singles_32x32_16.png"),
    ],
}

# Always-animating props not gated on any desk occupancy (col, row, dest,
# src, frames, room_id). Empty until Task 7 adds Library's ambient candle.
AMBIENT = [
    dict(room_id="auth-module", col=7, row=5, dest="animated_wall_candle_32x32.png",
         src="3_Animated_objects/32x32/spritesheets/animated_wall_candle_32x32.png", frames=3),
    dict(room_id="billing", col=3, row=1, dest="animated_treadmill_2_32x32.png",
         src="3_Animated_objects/32x32/spritesheets/animated_treadmill_32x32.png", frames=3),
]
