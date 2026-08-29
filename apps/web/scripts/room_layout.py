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
