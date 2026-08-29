# Room Theming & Enlargement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the world's 6 flat-colored rooms into 6 distinctly themed, ~2.5x-larger rooms (Library, Sports Den, Japanese Room, Gym, Music Room, Living Room) built from the `moderninteriors-win` asset pack, with agents visibly "working" by operating theme-appropriate animated equipment instead of sitting at a generic desk.

**Architecture:** Two existing Python/PIL generator scripts (`apps/web/scripts/generate-world-map.py`, `generate-world-tileset.py`) already produce `map.json`/`tileset.png` from source art — this plan extends them (bigger rooms, real floor textures) rather than hand-editing their JSON/PNG output. A new third script (`generate-room-decor.py`) emits a freeform decor/equipment manifest (`room-decor.json`) that a new small rendering capability (`TiledMapRenderer.addDecorLayer`, `EquipmentSprite`) consumes at runtime to place furniture and toggle equipment animation on agent occupancy. All three scripts share one data module (`room_layout.py`) so room geometry, desk positions, and decor never drift apart across files.

**Tech Stack:** Python 3 + Pillow (already used by the existing generator scripts; invoke via `py`, not `python3`, on this machine — `python3` resolves to a broken Windows Store stub), TypeScript + pixi.js v8 (existing frontend stack, no new dependencies), Vitest (existing test runner).

**Spec:** `docs/superpowers/specs/2026-08-29-room-theming-design.md`

## Global Constraints

- No new npm or pip dependencies — everything here is stdlib Python, Pillow (already used), or pixi.js APIs already used elsewhere in this codebase.
- Canvas pixel size stays 1120×640 (35×20 tiles @ 32px) — do not touch `WorldCanvas.tsx`'s `width={1120} height={640}` props, its `app.init` resolution/`autoDensity` block, or `styles.css`'s `1120px` grid column.
- `desk-<room>-1`/`desk-<room>-2` spawn-point IDs, `FileRoom.deskIds`, and `WorldAgent.occupiedDeskId` are never renamed — `apps/web/src/world/resources.ts`, `agentSim.ts`, and `decision.ts` are not modified by this plan at all.
- The character sprite/animation system (`CharacterSprite.ts`, `engineCharacter.ts`) is not modified — "the agent is working" reads through the equipment prop animating, not a new character pose.
- Every generated file (`map.json`, `tileset.png`, `room-decor.json`, the copied decor/equipment PNGs) is produced by running a script in `apps/web/scripts/`, never hand-edited directly — re-running a script after editing `room_layout.py` must reproduce the same output.

---

## Two deliberate refinements beyond the written spec

The spec's §3 sizing table and §6 room diagrams were approximate by design (§9 explicitly deferred exact tile coordinates to implementation). Working out the real generator scripts during planning (Task 2) surfaced two places where this plan lands on something better than the spec's literal numbers — flagged here rather than silently substituted:

- **Room size**: the spec's table gave uneven 10×8/9×8 footprints. The real `generate-world-map.py` has zero outer margin and treats the gaps between same-row rooms as non-walkable cosmetic filler (not real corridor width) — reworking the math against that actual structure yields a **uniform 11×8 footprint (9×6 interior)** for all 6 rooms, which is both bigger (9×6=54 interior tiles vs. the spec's ~42-48) and simpler to implement/verify than uneven columns. This was dry-run against the real map generator during planning (Task 2's code was actually executed, not just written) and the zone/door coordinates it produces were checked by hand.
- **Walls**: the spec's §6 diagrams mentioned per-theme wall trim colors. This plan reuses the single existing shaded wall texture for every room (Task 2) and carries the theme entirely through the floor texture + decor layer instead. Reason: the original tileset script's own comments show real trial-and-error was needed to avoid border artifacts when picking texture crops (see its Task-10 history); doing that verification 6 more times for walls that are mostly occluded by decor anyway wasn't worth the risk for a purely cosmetic trim. Floors (the far more visible surface) still get 6 real, individually verified textures.

---

## File structure

New files:
- `apps/web/scripts/room_layout.py` — shared room geometry, desk positions, floor picks, equipment bindings, decor entries. The single source of truth every other script imports from.
- `apps/web/scripts/generate-room-decor.py` — emits `room-decor.json`, copies the source PNGs it references into `public/world-assets/{decor,equipment}/`.
- `apps/web/scripts/asset_contact_sheet.py` — dev tool: mosaics an unlabeled `Theme_Sorter_Singles` folder into one labeled image so a person can identify which numbered file is which.
- `apps/web/src/world/engine/EquipmentSprite.ts` + `EquipmentSprite.test.ts` — animated equipment prop, mirrors `CharacterSprite`'s container+`AnimatedSprite` pattern.
- `apps/web/src/world/roomDecor.ts` — types + fetch loader for `room-decor.json`, mirrors `engineMap.ts`'s `loadWorldMap` pattern.
- `apps/web/public/world-assets/room-decor.json`, `apps/web/public/world-assets/decor/<room-id>/*.png`, `apps/web/public/world-assets/equipment/*.png` — generated output, not hand-written.

Modified files:
- `apps/web/scripts/generate-world-map.py` — bigger uniform room footprint, themed floor GIDs, desk spawn points sourced from `room_layout.py` instead of a generic symmetric formula, drops the old desk/rug/plant furniture-below painting (superseded by the decor layer).
- `apps/web/scripts/generate-world-tileset.py` — 6 new themed floor crops replace the 7 old flat-color swatches; drops the now-unused desk/rug/plant crops.
- `apps/web/src/world/engine/TiledMapRenderer.ts` — one new method, `addDecorLayer`.
- `apps/web/src/world/WorldCanvas.tsx` — loads `room-decor.json`, builds decor sprites + `EquipmentSprite` instances at setup, toggles equipment animation each tick based on which spawn points are occupied by a `working` agent.
- `apps/web/src/world/engineMap.test.ts` — one new test for `addDecorLayer`.
- `apps/web/src/world/WorldCanvas.test.tsx` — mocks `./roomDecor`, one new smoke test.

Regenerated (not hand-edited): `apps/web/public/world-assets/map.json`, `apps/web/public/world-assets/tileset.png`.

---

### Task 1: Room layout data module

**Files:**
- Create: `apps/web/scripts/room_layout.py`

**Interfaces:**
- Produces: `TILE=32`, `WIDTH=35`, `HEIGHT=20`, `ROOM_W=11`, `ROOM_H=8`, `GAP=1`, `HALLWAY_H=4` (ints); `ROOMS: list[dict]` with keys `id, owner, row, x0, theme, floor` where `floor` is `(sheet_name, col, row)`; `DESKS: dict[str, list[tuple[int,int]]]` mapping room id → interior-relative `(col, row)` offsets (0-8, 0-5), in `desk-<id>-1`, `desk-<id>-2`, ... order. Every later task (`generate-world-map.py`, `generate-room-decor.py`) imports these names directly.

- [ ] **Step 1: Write the file**

```python
# apps/web/scripts/room_layout.py
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
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `py -c "import sys; sys.path.insert(0,'apps/web/scripts'); import room_layout; print(len(room_layout.ROOMS), room_layout.DESKS['billing'])"`
Expected: `6 [(3, 3), (5, 3)]`

- [ ] **Step 3: Commit**

```bash
git add apps/web/scripts/room_layout.py
git commit -m "feat(world): add shared room-layout data module"
```

---

### Task 2: Resize rooms & apply themed floors

**Files:**
- Modify: `apps/web/scripts/generate-world-map.py` (full rewrite of its body — same structure as today, new constants/source)
- Modify: `apps/web/scripts/generate-world-tileset.py` (full rewrite of its body)
- Regenerate: `apps/web/public/world-assets/map.json`, `apps/web/public/world-assets/tileset.png`

**Interfaces:**
- Consumes: `room_layout.{TILE,WIDTH,HEIGHT,ROOM_W,ROOM_H,GAP,HALLWAY_H,ROOMS,DESKS}` (Task 1).
- Produces: `map.json` with a `tilesets[0]` of `columns: 11, tilecount: 11`; a `zones` objectgroup with 6 entries at `(x_tile, y_tile, 9, 6)` per room; `spawn-points` including every `desk-<room>-N` and `<room>-door`. `tileset.png` at `352x32` (11 tiles). No later task depends on exact pixel content of either file, only on the zone/spawn-point shapes just described (already true today, per `resources.ts`/`agentSim.ts`).

This task was fully dry-run against the real `moderninteriors-win` art during planning (output verified visually) — the code below is the exact, verified version, not a first draft.

- [ ] **Step 1: Replace generate-world-map.py**

```python
#!/usr/bin/env python3
"""Author the world's Tiled JSON map: 6 themed rooms (2 owned by each user,
1 common), connected by a central hallway. Uniform 11x8 outer footprint per
room (9x6 walkable interior) -- up from the original 9x7 footprint (7x5
interior), by narrowing the cosmetic between-room gaps and the hallway (see
room_layout.py's docstring for the exact tile math). Desk spawn points come
from room_layout.DESKS so this file and generate-room-decor.py can't drift
apart on where a "desk-<room>-N" spawn point actually is.

Floors are no longer flat per-room colors -- each room's floor GID is a real
texture crop (see generate-world-tileset.py), picked per theme in
room_layout.ROOMS. Furniture (desks, equipment, decor) is no longer painted
as tilemap GIDs at all -- see generate-room-decor.py and
TiledMapRenderer.addDecorLayer, which place it as freeform pixel-positioned
sprites instead.

Usage: python3 generate-world-map.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from room_layout import WIDTH, HEIGHT, TILE, ROOM_W, ROOM_H, GAP, HALLWAY_H, ROOMS, DESKS

WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"

GID_BLANK = 0
GID_HALLWAY = 1
GID_WALL = 8
GID_WINDOW_LEFT = 9
GID_WINDOW_RIGHT = 10
# Room floor GIDs: ROOMS[0]'s floor is gid 2, ROOMS[1]'s is gid 3, etc.
# generate-world-tileset.py builds its tile strip in this exact same ROOMS
# order, so the two files can't drift apart.
FLOOR_GID = {room["id"]: i + 2 for i, room in enumerate(ROOMS)}


def exterior_rect(room):
    x0 = room["x0"]
    x1 = x0 + ROOM_W - 1
    if room["row"] == "top":
        y0, y1 = 0, ROOM_H - 1
    else:
        y0, y1 = HEIGHT - ROOM_H, HEIGHT - 1
    return x0, y0, x1, y1


def door_tile(room):
    x0, y0, x1, y1 = exterior_rect(room)
    door_x = x0 + ROOM_W // 2
    door_y = y1 if room["row"] == "top" else y0
    return door_x, door_y


def rect_cells(x0, y0, x1, y1):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            yield x, y


def is_ring(x, y, x0, y0, x1, y1):
    return x in (x0, x1) or y in (y0, y1)


def build_layer(fill):
    data = [GID_BLANK] * (WIDTH * HEIGHT)
    for (x, y), gid in fill.items():
        data[y * WIDTH + x] = gid
    return data


def main() -> None:
    floor_fill, walls_fill, collision_fill = {}, {}, {}

    for room in ROOMS:
        x0, y0, x1, y1 = exterior_rect(room)
        door = door_tile(room)
        floor_gid = FLOOR_GID[room["id"]]
        for x, y in rect_cells(x0, y0, x1, y1):
            if (x, y) == door:
                floor_fill[(x, y)] = floor_gid
                continue
            if is_ring(x, y, x0, y0, x1, y1):
                walls_fill[(x, y)] = GID_WALL
                collision_fill[(x, y)] = GID_WALL
            else:
                floor_fill[(x, y)] = floor_gid

        # Window pair on the wall opposite the door.
        window_y = y1 if room["row"] == "bottom" else y0
        window_x0 = x0 + ROOM_W // 2 - 1
        walls_fill[(window_x0, window_y)] = GID_WINDOW_LEFT
        walls_fill[(window_x0 + 1, window_y)] = GID_WINDOW_RIGHT

    # Gaps between same-row rooms: floored (hallway texture) but blocked --
    # cosmetic filler only. Agents only ever cross between columns via the
    # hallway strip below/above, never through these gaps.
    for row_y0, row_y1 in ((0, ROOM_H - 1), (HEIGHT - ROOM_H, HEIGHT - 1)):
        gap_x0 = ROOM_W
        for _ in range(2):
            for x in range(gap_x0, gap_x0 + GAP):
                for y in range(row_y0, row_y1 + 1):
                    floor_fill[(x, y)] = GID_HALLWAY
                    collision_fill[(x, y)] = GID_WALL
            gap_x0 += GAP + ROOM_W

    # Hallway: fully open floor, full width, no walls.
    hallway_y0, hallway_y1 = ROOM_H, HEIGHT - ROOM_H - 1
    for x, y in rect_cells(0, hallway_y0, WIDTH - 1, hallway_y1):
        floor_fill[(x, y)] = GID_HALLWAY

    def tile_obj(name, x, y):
        return {"name": name, "x": x * TILE, "y": y * TILE}

    def zone_obj(room):
        x0, y0, x1, y1 = exterior_rect(room)
        return {
            "name": room["id"],
            "x": (x0 + 1) * TILE,
            "y": (y0 + 1) * TILE,
            "width": (ROOM_W - 2) * TILE,
            "height": (ROOM_H - 2) * TILE,
        }

    spawn_objects = [tile_obj("common", 17, 9)]
    for room in ROOMS:
        door_x, door_y = door_tile(room)
        spawn_objects.append(tile_obj(f"{room['id']}-door", door_x, door_y))
        x0, y0, _, _ = exterior_rect(room)
        for i, (col, row) in enumerate(DESKS.get(room["id"], []), start=1):
            spawn_objects.append(tile_obj(f"desk-{room['id']}-{i}", x0 + 1 + col, y0 + 1 + row))

    tiled_map = {
        "width": WIDTH,
        "height": HEIGHT,
        "tilewidth": TILE,
        "tileheight": TILE,
        "tilesets": [
            {
                "firstgid": 0,
                "image": "tileset.png",
                "columns": 11,
                "tilewidth": TILE,
                "tileheight": TILE,
                "tilecount": 11,
            }
        ],
        "layers": [
            {"name": "floor", "type": "tilelayer", "data": build_layer(floor_fill)},
            {"name": "walls", "type": "tilelayer", "data": build_layer(walls_fill)},
            {"name": "collision", "type": "tilelayer", "data": build_layer(collision_fill)},
            {"name": "spawn-points", "type": "objectgroup", "objects": spawn_objects},
            {"name": "zones", "type": "objectgroup", "objects": [zone_obj(r) for r in ROOMS]},
        ],
    }

    out_path = WORLD_ASSETS / "map.json"
    out_path.write_text(json.dumps(tiled_map, indent=2))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Replace generate-world-tileset.py**

```python
#!/usr/bin/env python3
"""Composite the world's tileset: 1 hallway floor + 6 themed room floors +
1 wall block (3D-shaded) + a 2-tile window pair -- all cropped from
moderninteriors-win. Room furniture no longer lives here; see
generate-room-decor.py for the freeform decor/equipment sprites this
tileset used to carry as GIDs (desk, rug, plant).

Usage: python3 generate-world-tileset.py
"""
import sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from room_layout import ROOMS

REPO_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "moderninteriors-win").is_dir())
MODERNINTERIORS = REPO_ROOT / "moderninteriors-win"
WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"

TILE = 32
ROOM_BUILDER = MODERNINTERIORS / "1_Interiors" / "32x32" / "Room_Builder_32x32.png"
FLOORS_SHEET = MODERNINTERIORS / "1_Interiors" / "32x32" / "Room_Bulder_subfiles_32x32" / "Room_Builder_Floors_32x32.png"
GENERIC = MODERNINTERIORS / "1_Interiors" / "32x32" / "Theme_Sorter_32x32" / "1_Generic_32x32.png"

# Unchanged from the original tileset -- same verified-working crops.
HALLWAY_TILE = (ROOM_BUILDER, 16, 26)
WALL_TILE = (ROOM_BUILDER, 7, 2)
WINDOW_LEFT_TILE = (GENERIC, 5, 8)
WINDOW_RIGHT_TILE = (GENERIC, 6, 8)


def crop_tile(cache, path, col, row):
    if path not in cache:
        cache[path] = Image.open(path).convert("RGBA")
    sheet = cache[path]
    return sheet.crop((col * TILE, row * TILE, col * TILE + TILE, row * TILE + TILE))


def shade_wall(tile):
    """Synthesized highlight/shadow coping band so the flat Room_Builder
    wall block reads as a wall with height. Unchanged from the original
    script -- see its docstring for why this is synthesized rather than
    found (no 32x32 pre-shaded wall set exists in the pack)."""
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
    cache = {}
    tiles = [Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))]  # gid 0: blank
    tiles.append(crop_tile(cache, *HALLWAY_TILE))              # gid 1
    for room in ROOMS:                                         # gids 2-7, in ROOMS order
        sheet_name, col, row = room["floor"]
        sheet_path = FLOORS_SHEET if sheet_name == "Room_Builder_Floors" else ROOM_BUILDER
        tiles.append(crop_tile(cache, sheet_path, col, row))
    wall_tile = shade_wall(crop_tile(cache, *WALL_TILE))
    tiles.append(wall_tile)                                    # gid 8
    tiles.append(Image.alpha_composite(wall_tile.copy(), crop_tile(cache, *WINDOW_LEFT_TILE)))   # gid 9
    tiles.append(Image.alpha_composite(wall_tile.copy(), crop_tile(cache, *WINDOW_RIGHT_TILE)))  # gid 10

    sheet = Image.new("RGBA", (TILE * len(tiles), TILE), (0, 0, 0, 0))
    for i, tile in enumerate(tiles):
        sheet.paste(tile, (i * TILE, 0))

    out_path = WORLD_ASSETS / "tileset.png"
    sheet.save(out_path)
    print(f"wrote {out_path} ({sheet.size[0]}x{sheet.size[1]}, {len(tiles)} tiles)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Regenerate and sanity-check**

Run:
```bash
cd apps/web/scripts
py generate-world-map.py
py generate-world-tileset.py
py -c "
import json
m = json.load(open('../public/world-assets/map.json'))
assert m['tilesets'][0]['tilecount'] == 11
zones = {z['name']: (z['x']//32, z['y']//32, z['width']//32, z['height']//32) for z in m['layers'][-1]['objects']}
assert zones['auth-module'] == (1, 1, 9, 6), zones
assert zones['deploy-config'] == (25, 13, 9, 6), zones
print('OK', zones)
"
```
Expected: prints `wrote ...map.json`, `wrote ...tileset.png (352x32, 11 tiles)`, then `OK {...}` with all 6 zones at width 9 / height 6.

- [ ] **Step 4: Run the existing test suite**

Run: `cd apps/web && npm test`
Expected: all existing tests still pass — `engineMap.test.ts` and `WorldCanvas.test.tsx` use synthetic fixture maps, not the real `map.json`, so they're insulated from this resize (confirmed during planning by reading both files).

- [ ] **Step 5: Visual check**

Run: `cd apps/web && npm run dev`, open the app, sign in, go to the World view.
Expected: 6 visibly bigger rooms, each with a distinct floor texture (matches the corridor/gap narrowing — same overall canvas size, no layout scroll/overflow). Desks/furniture will look empty — that's expected, decor lands in Task 6 onward.

- [ ] **Step 6: Commit**

```bash
git add apps/web/scripts/generate-world-map.py apps/web/scripts/generate-world-tileset.py apps/web/public/world-assets/map.json apps/web/public/world-assets/tileset.png
git commit -m "feat(world): enlarge rooms and give each a themed floor texture"
```

---

### Task 3: EquipmentSprite

**Files:**
- Create: `apps/web/src/world/engine/EquipmentSprite.ts`
- Test: `apps/web/src/world/engine/EquipmentSprite.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure pixi.js).
- Produces: `class EquipmentSprite { constructor(sheet: Texture, frameCount: number); readonly container: Container; setPosition(x: number, y: number): void; setWorking(working: boolean): void; destroy(): void }`. `WorldCanvas.tsx` (Task 6) constructs one per animated equipment entry and calls `setWorking` every tick.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/world/engine/EquipmentSprite.test.ts
import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { EquipmentSprite } from "./EquipmentSprite";

describe("EquipmentSprite", () => {
  it("constructs without a renderer and exposes a container", () => {
    const sprite = new EquipmentSprite(Texture.WHITE, 4);
    expect(sprite.container.children.length).toBeGreaterThan(0);
    sprite.destroy();
  });

  it("does not throw when toggled working on/off, including repeat calls", () => {
    const sprite = new EquipmentSprite(Texture.WHITE, 4);
    expect(() => {
      sprite.setWorking(true);
      sprite.setWorking(true); // no-op path when state doesn't change
      sprite.setWorking(false);
      sprite.setWorking(false);
    }).not.toThrow();
    sprite.destroy();
  });

  it("positions its container", () => {
    const sprite = new EquipmentSprite(Texture.WHITE, 4);
    sprite.setPosition(64, 96);
    expect(sprite.container.x).toBe(64);
    expect(sprite.container.y).toBe(96);
    sprite.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/world/engine/EquipmentSprite.test.ts`
Expected: FAIL — `Cannot find module './EquipmentSprite'`

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/src/world/engine/EquipmentSprite.ts
// Animated equipment prop (punching bag, treadmill, piano, ...) that plays
// its spritesheet loop while a work-spot is occupied, and holds on frame 0
// otherwise. Mirrors CharacterSprite's container+AnimatedSprite pattern,
// but there's no direction/multi-anim grid here -- just one row-0 loop per
// prop, sliced the same way TiledMapRenderer.textureForGid crops a GID.

import { AnimatedSprite, Container, Rectangle, Texture } from "pixi.js";

const FRAME_SIZE = 32;

export class EquipmentSprite {
  readonly container: Container;
  private sprite: AnimatedSprite;
  private working = false;

  constructor(sheet: Texture, frameCount: number) {
    const frames: Texture[] = [];
    for (let i = 0; i < frameCount; i++) {
      frames.push(
        new Texture({ source: sheet.source, frame: new Rectangle(i * FRAME_SIZE, 0, FRAME_SIZE, FRAME_SIZE) }),
      );
    }
    this.container = new Container();
    this.sprite = new AnimatedSprite(frames);
    this.sprite.animationSpeed = 0.15;
    this.sprite.gotoAndStop(0);
    this.container.addChild(this.sprite);
  }

  setPosition(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  /** Plays the loop while occupied; holds frame 0 the rest of the time. A
   *  no-op when called with the state it's already in, so WorldCanvas's
   *  per-frame tick can call this unconditionally without restarting the
   *  animation every frame. */
  setWorking(working: boolean): void {
    if (working === this.working) return;
    this.working = working;
    if (working) this.sprite.play();
    else this.sprite.gotoAndStop(0);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/world/engine/EquipmentSprite.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/world/engine/EquipmentSprite.ts apps/web/src/world/engine/EquipmentSprite.test.ts
git commit -m "feat(world): add EquipmentSprite for animated equipment props"
```

---

### Task 4: Decor layer on TiledMapRenderer

**Files:**
- Modify: `apps/web/src/world/engine/TiledMapRenderer.ts`
- Modify: `apps/web/src/world/engineMap.test.ts`

**Interfaces:**
- Consumes: nothing new (existing `Container`, `Sprite` already imported in `TiledMapRenderer.ts`).
- Produces: `addDecorLayer(items: Container[]): void` on `TiledMapRenderer`. `WorldCanvas.tsx` (Task 6) calls this once at setup with every decor `Sprite` and every `EquipmentSprite.container` combined into one array.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/world/engineMap.test.ts` (add `Sprite` to the existing `pixi.js` import on line 1):

```typescript
import { Sprite, Texture } from "pixi.js";
```

```typescript
  it("layers decor above the tile grid but below characters", () => {
    const renderer = new TiledMapRenderer(fixtureMap(), [Texture.WHITE]);
    const prop = new Sprite(Texture.WHITE);
    renderer.addDecorLayer([prop]);

    const root = renderer.getContainer();
    const decorIndex = root.children.findIndex((c) => c.label === "decor");
    const charIndex = root.getChildIndex(renderer.getCharacterContainer());

    expect(decorIndex).toBeGreaterThan(-1);
    expect(decorIndex).toBeLessThan(charIndex);
    expect(root.children[decorIndex].children).toContain(prop);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/world/engineMap.test.ts`
Expected: FAIL — `renderer.addDecorLayer is not a function`

- [ ] **Step 3: Add the method**

In `apps/web/src/world/engine/TiledMapRenderer.ts`, add after `getAllZones()` (around line 103):

```typescript
  /** Freeform pixel-positioned props (furniture, equipment) layered above
   *  the tile grid but below every character, so an agent walking past a
   *  room's decor always draws in front of it. Unlike the GID tile layers,
   *  entries here aren't grid-locked -- each Container sits at whatever
   *  pixel position its caller already set on it (see WorldCanvas.tsx,
   *  which builds these from room-decor.json's pixel coordinates). */
  addDecorLayer(items: Container[]): void {
    const layer = new Container();
    layer.label = "decor";
    for (const item of items) layer.addChild(item);
    const charIndex = this.rootContainer.getChildIndex(this.characterContainer);
    this.rootContainer.addChildAt(layer, charIndex);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/world/engineMap.test.ts`
Expected: PASS (3 tests — 2 existing + the new one)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/world/engine/TiledMapRenderer.ts apps/web/src/world/engineMap.test.ts
git commit -m "feat(world): add TiledMapRenderer.addDecorLayer"
```

---

### Task 5: Asset contact-sheet tool

**Files:**
- Create: `apps/web/scripts/asset_contact_sheet.py`

**Interfaces:**
- Consumes: nothing (standalone dev tool).
- Produces: a runnable CLI (`py asset_contact_sheet.py <folder> <out.png> [--start N] [--count N] [--cols N]`) that Tasks 7-12 invoke to identify specific files in the unlabeled `Theme_Sorter_Singles_32x32` category folders (each just numbered `*_N.png` files with no metadata — confirmed during brainstorming, see spec §9).

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
"""Mosaic a folder of unlabeled Theme_Sorter_Singles PNGs into one labeled
contact sheet, so a person can eyeball which numbered file is which. Each
source PNG keeps its own aspect ratio (Singles are pre-trimmed to each
item's own bounding box, not a uniform grid) but is thumbnailed onto a fixed
cell and labeled with the tail of its filename.

Usage:
  python3 asset_contact_sheet.py <folder> <out.png> [--start N] [--count N] [--cols N]

Example:
  python3 asset_contact_sheet.py \\
    "../../moderninteriors-win/1_Interiors/32x32/Theme_Sorter_Singles_32x32/5_Classroom_and_Library_Singles_32x32" \\
    /tmp/library_0-59.png --start 0 --count 60
"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw

CELL = 96
LABEL_H = 14


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("folder")
    p.add_argument("out")
    p.add_argument("--start", type=int, default=0)
    p.add_argument("--count", type=int, default=100)
    p.add_argument("--cols", type=int, default=10)
    args = p.parse_args()

    files = sorted(Path(args.folder).glob("*.png"), key=lambda f: f.name)
    chunk = files[args.start : args.start + args.count]
    if not chunk:
        print(f"no files in range {args.start}-{args.start + args.count} (folder has {len(files)})")
        return

    cols = args.cols
    rows = (len(chunk) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * CELL, rows * (CELL + LABEL_H)), (30, 30, 30, 255))
    draw = ImageDraw.Draw(sheet)
    for i, f in enumerate(chunk):
        img = Image.open(f).convert("RGBA")
        img.thumbnail((CELL - 8, CELL - 8))
        col, row = i % cols, i // cols
        x, y = col * CELL, row * (CELL + LABEL_H)
        sheet.paste(img, (x + 4, y + 4), img)
        draw.text((x + 2, y + CELL), f.stem, fill=(255, 255, 0, 255))
    sheet.save(args.out)
    print(f"wrote {args.out}: files {args.start}-{args.start + len(chunk) - 1} of {len(files)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify it runs against a real Singles folder**

Run:
```bash
cd apps/web/scripts
py asset_contact_sheet.py "../../../moderninteriors-win/1_Interiors/32x32/Theme_Sorter_Singles_32x32/5_Classroom_and_Library_Singles_32x32" /tmp/library_check.png --start 0 --count 20
```
Expected: `wrote /tmp/library_check.png: files 0-19 of 249`, and opening the file shows a 10x2 grid of thumbnails with yellow filename labels.

- [ ] **Step 3: Commit**

```bash
git add apps/web/scripts/asset_contact_sheet.py
git commit -m "feat(world): add contact-sheet tool for browsing unlabeled asset folders"
```

---

### Task 6: Room-decor data pipeline & wire into rendering

This is the task where equipment starts actually animating. Decor lists stay empty for now — Tasks 7-12 fill them in room by room.

**Files:**
- Modify: `apps/web/scripts/room_layout.py` (append `EQUIPMENT`, `DECOR`, `AMBIENT`)
- Create: `apps/web/scripts/generate-room-decor.py`
- Create: `apps/web/src/world/roomDecor.ts`
- Modify: `apps/web/src/world/WorldCanvas.tsx`
- Modify: `apps/web/src/world/WorldCanvas.test.tsx`
- Regenerate: `apps/web/public/world-assets/room-decor.json`, `apps/web/public/world-assets/equipment/*.png`

**Interfaces:**
- Consumes: `room_layout.{ROOMS,DESKS}` (Task 1), `TiledMapRenderer.addDecorLayer` (Task 4), `EquipmentSprite` (Task 3).
- Produces: `RoomDecor` type + `loadRoomDecor(): Promise<RoomDecor>` from `roomDecor.ts`, consumed only by `WorldCanvas.tsx`. `room_layout.EQUIPMENT: dict[tuple[str,int], tuple[str,int]]` (room id + desk index → spritesheet filename + frame count) and `room_layout.DECOR: dict[str, list[dict]]` / `AMBIENT: list[dict]`, consumed by `generate-room-decor.py` and extended by Tasks 7-12.

- [ ] **Step 1: Append equipment/decor data to room_layout.py**

Add to the end of `apps/web/scripts/room_layout.py`:

```python
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
    "auth-module": [],
    "analytics": [],
    "database": [],
    "billing": [],
    "living-room": [],
    "deploy-config": [],
}

# Always-animating props not gated on any desk occupancy (col, row, dest,
# src, frames, room_id). Empty until Task 7 adds Library's ambient candle.
AMBIENT = []
```

- [ ] **Step 2: Write generate-room-decor.py**

```python
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from room_layout import TILE, HEIGHT, ROOM_H, ROOMS, DESKS, EQUIPMENT, DECOR, AMBIENT

REPO_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "moderninteriors-win").is_dir())
MODERNINTERIORS = REPO_ROOT / "moderninteriors-win"
WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"
EQUIPMENT_SRC_DIR = "3_Animated_objects/32x32/spritesheets"

ROOM_BY_ID = {r["id"]: r for r in ROOMS}


def room_origin(room):
    """Interior (col 0, row 0) in absolute map tiles. Same footprint math as
    generate-world-map.py's exterior_rect() -- kept in sync by both files
    importing ROOM_H/HEIGHT from room_layout instead of hardcoding them."""
    x0 = room["x0"]
    y0 = 0 if room["row"] == "top" else HEIGHT - ROOM_H
    return x0 + 1, y0 + 1


def copy_asset(src_rel: str, dest_rel: str) -> None:
    src = MODERNINTERIORS / src_rel
    dest = WORLD_ASSETS / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)


def main() -> None:
    decor_entries = []
    equipment_entries = []

    for room in ROOMS:
        ox, oy = room_origin(room)
        room_id = room["id"]

        for item in DECOR.get(room_id, []):
            dest_rel = f"decor/{room_id}/{item['dest']}"
            copy_asset(item["src"], dest_rel)
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
```

- [ ] **Step 3: Run it and verify the equipment-only manifest**

Run:
```bash
cd apps/web/scripts
py generate-room-decor.py
py -c "
import json
d = json.load(open('../public/world-assets/room-decor.json'))
assert len(d['decor']) == 0
assert len(d['equipment']) == 6, d['equipment']
names = sorted(e['image'] for e in d['equipment'])
print(names)
"
ls ../public/world-assets/equipment/
```
Expected: prints `wrote ...room-decor.json: 0 decor, 6 equipment`, then the 6 equipment image paths, then 6 real PNG files listed in `equipment/`.

- [ ] **Step 4: Write roomDecor.ts**

```typescript
// apps/web/src/world/roomDecor.ts
// Types + loader for room-decor.json (see apps/web/scripts/generate-room-decor.py),
// the freeform pixel-positioned furniture/equipment manifest. Mirrors
// engineMap.ts's loadWorldMap fetch pattern.

export interface DecorEntry {
  /** Path relative to /world-assets/, e.g. "decor/auth-module/bookshelf.png". */
  image: string;
  x: number;
  y: number;
}

export interface EquipmentEntry {
  /** Path relative to /world-assets/, under equipment/. */
  image: string;
  /** Frame count in row 0 of the spritesheet (see EquipmentSprite). */
  frames: number;
  x: number;
  y: number;
  /** desk-<room>-N spawn point this prop's animation is gated on, matching
   *  WorldAgent.occupiedDeskId -- or null for a prop that just animates
   *  continuously regardless of occupancy (e.g. an ambient candle). */
  spawnPoint: string | null;
}

export interface RoomDecor {
  decor: DecorEntry[];
  equipment: EquipmentEntry[];
}

export async function loadRoomDecor(): Promise<RoomDecor> {
  const res = await fetch("/world-assets/room-decor.json");
  return res.json() as Promise<RoomDecor>;
}
```

- [ ] **Step 5: Wire loading + toggling into WorldCanvas.tsx**

Add imports (top of file, alongside the existing ones):

```typescript
import { Application, Assets, Container, Graphics, Sprite, Text } from "pixi.js";
import { EquipmentSprite } from "./engine/EquipmentSprite";
import { loadRoomDecor } from "./roomDecor";
```

(`Sprite` is new in the `pixi.js` import; the rest of that line stays as-is.)

Inside the `useEffect`, declare the equipment map alongside the other `let`s near the top (after `const spritesRef = ...` is out of scope here — this goes inside the effect body, near `let lastTime: number | null = null;`):

```typescript
    const equipmentSprites = new Map<string, EquipmentSprite>();
```

Change the setup `Promise.all` to also load the decor manifest:

```typescript
        const [loadedRenderer, loadedCharacterTexture, roomDecor] = await Promise.all([
          loadWorldMap(),
          Assets.load("/world-assets/characters/default.png"),
          loadRoomDecor(),
        ]);
```

After `renderer.getContainer().addChild(buildRoomOverlay(renderer));`'s try/catch block (still inside the async IIFE, before `requestAnimationFrame(tick);`), add:

```typescript
        const imagePaths = [
          ...new Set([...roomDecor.decor.map((d) => d.image), ...roomDecor.equipment.map((e) => e.image)]),
        ];
        const textures = await Promise.all(imagePaths.map((p) => Assets.load(`/world-assets/${p}`)));
        const textureByPath = new Map(imagePaths.map((p, i) => [p, textures[i]]));

        const decorSprites: Container[] = roomDecor.decor.map((entry) => {
          const sprite = new Sprite(textureByPath.get(entry.image));
          sprite.position.set(entry.x, entry.y);
          return sprite;
        });

        const equipmentContainers: Container[] = roomDecor.equipment.map((entry) => {
          const es = new EquipmentSprite(textureByPath.get(entry.image)!, entry.frames);
          es.setPosition(entry.x, entry.y);
          if (entry.spawnPoint === null) es.setWorking(true); // ambient: always animating
          else equipmentSprites.set(entry.spawnPoint, es);
          return es.container;
        });

        renderer.addDecorLayer([...decorSprites, ...equipmentContainers]);
```

In `tick()`, right after `const next = pausedRef.current ? ... : ...;` and its `onFrameRef.current(next)` call, before the agent-sprite loop, add the equipment occupancy toggle:

```typescript
      const workingSpawnPoints = new Set(
        next
          .filter((a) => a.behaviorMode === "working" && a.occupiedDeskId)
          .map((a) => a.occupiedDeskId as string),
      );
      for (const [spawnPoint, es] of equipmentSprites) {
        es.setWorking(workingSpawnPoints.has(spawnPoint));
      }
```

In the `return () => { ... }` cleanup at the end of the effect, add equipment cleanup alongside the existing character-sprite cleanup:

```typescript
      for (const es of equipmentSprites.values()) es.destroy();
```

- [ ] **Step 6: Update WorldCanvas.test.tsx**

Add a mock for the new module (alongside the existing `vi.mock("./engineMap", ...)` block):

```typescript
vi.mock("./roomDecor", () => ({
  loadRoomDecor: vi.fn().mockResolvedValue({ decor: [], equipment: [] }),
}));
```

Add the import needed to reconfigure it per-test, alongside the existing top-of-file imports:

```typescript
import { loadRoomDecor } from "./roomDecor";
```

Add a new test inside `describe("WorldCanvas", ...)`:

```typescript
  it("loads equipment entries and keeps ticking without throwing", async () => {
    vi.mocked(loadRoomDecor).mockResolvedValueOnce({
      decor: [{ image: "decor/auth-module/bookshelf.png", x: 64, y: 32 }],
      equipment: [
        {
          image: "equipment/animated_punching_bag_left_32x32.png",
          frames: 12,
          x: 128,
          y: 96,
          spawnPoint: "desk-billing-1",
        },
      ],
    });
    const onFrame = vi.fn();
    const { unmount } = render(<WorldCanvas agents={[agent()]} onFrame={onFrame} />);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onFrame).toHaveBeenCalled();

    unmount();
  });
```

- [ ] **Step 7: Run the full test suite**

Run: `cd apps/web && npm test`
Expected: all tests pass, including the 2 pre-existing `WorldCanvas` tests (proving the new `loadRoomDecor` mock didn't break the default equipment-free path) and the new one.

- [ ] **Step 8: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Visual check**

Run: `cd apps/web && npm run dev`, open the World view.
Expected: Billing room's two desk spawn points now show a punching bag and a treadmill; Analytics shows a TV; Database shows an incense burner; Deploy Config shows a piano and an amplifier. All sit idle (frame 0) until an agent is routed there and `behaviorMode` becomes `working`, at which point that spot's prop starts animating. (Triggering `working` mode requires an agent actually visiting that room's desk — use the existing task-routing flow, or watch roaming agents get auto-assigned over time.)

- [ ] **Step 10: Commit**

```bash
git add apps/web/scripts/room_layout.py apps/web/scripts/generate-room-decor.py apps/web/src/world/roomDecor.ts apps/web/src/world/WorldCanvas.tsx apps/web/src/world/WorldCanvas.test.tsx apps/web/public/world-assets/room-decor.json apps/web/public/world-assets/equipment/
git commit -m "feat(world): animate equipment while its desk is occupied"
```

---

### Task 7: Auth Module → Library / Study decor

**Files:**
- Modify: `apps/web/scripts/room_layout.py` (fill `DECOR["auth-module"]`, append to `AMBIENT`)
- Regenerate: `apps/web/public/world-assets/room-decor.json`, `apps/web/public/world-assets/decor/auth-module/*.png`, `apps/web/public/world-assets/equipment/animated_wall_candle_32x32.png`

**Interfaces:**
- Consumes: `generate-room-decor.py` (Task 6), `asset_contact_sheet.py` (Task 5).
- Produces: nothing new consumed by later tasks — each room task is independent once Task 6 lands.

- [ ] **Step 1: Generate a contact sheet of the Library category**

```bash
cd apps/web/scripts
py asset_contact_sheet.py \
  "../../../moderninteriors-win/1_Interiors/32x32/Theme_Sorter_Singles_32x32/5_Classroom_and_Library_Singles_32x32" \
  /tmp/library.png --start 0 --count 100
```
Open `/tmp/library.png` (or re-run with `--start 100` for the remaining files, up to 249 total) and find:
- A freestanding wooden bookshelf/bookcase, filled with books, roughly 1 tile wide and taller than it is wide.
- A study desk or reading table, plain, roughly 1 tile.
- A simple chair.
- A potted plant (or reuse Task 6's general plant search across `2_Living_Room_Singles_32x32` if the Library folder has none).

Note the exact filename of each match.

- [ ] **Step 2: Add the entries to room_layout.py**

Replace `"auth-module": []` in `DECOR` with (substituting the real filenames found in Step 1 for the `<...>` placeholders):

```python
    "auth-module": [
        dict(col=1, row=0, dest="bookshelf-left.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/5_Classroom_and_Library_Singles_32x32/<bookshelf file>"),
        dict(col=7, row=0, dest="bookshelf-right.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/5_Classroom_and_Library_Singles_32x32/<bookshelf file>"),
        dict(col=3, row=2, dest="reading-desk-1.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/5_Classroom_and_Library_Singles_32x32/<desk file>"),
        dict(col=5, row=2, dest="reading-desk-2.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/5_Classroom_and_Library_Singles_32x32/<desk file>"),
        dict(col=3, row=3, dest="chair-1.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/5_Classroom_and_Library_Singles_32x32/<chair file>"),
        dict(col=5, row=3, dest="chair-2.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/5_Classroom_and_Library_Singles_32x32/<chair file>"),
        dict(col=1, row=4, dest="plant.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/<plant file>"),
    ],
```

Note: `reading-desk-1`/`-2` sit at the exact tile of `desk-auth-module-1`/`-2` (see `room_layout.DESKS["auth-module"]`, `(3,2)` and `(5,2)`) — this is deliberate. Per the design spec §5's disclosed gap, no reading/book animation exists in the pack, so these two desks stay plain decor; the agent's own `working` pose (not an animated prop) is what shows work happening there.

Append to `AMBIENT`:

```python
AMBIENT = [
    dict(room_id="auth-module", col=7, row=5, dest="animated_wall_candle_32x32.png",
         src="3_Animated_objects/32x32/spritesheets/animated_wall_candle_32x32.png", frames=3),
]
```

- [ ] **Step 3: Regenerate and verify**

```bash
cd apps/web/scripts
py generate-room-decor.py
py -c "
import json
d = json.load(open('../public/world-assets/room-decor.json'))
assert len(d['decor']) == 6, len(d['decor'])
assert any(e['image'].endswith('animated_wall_candle_32x32.png') for e in d['equipment'])
print('OK')
"
ls ../public/world-assets/decor/auth-module/
```
Expected: `OK`, and 6 PNG files listed under `decor/auth-module/`.

- [ ] **Step 4: Run the test suite**

Run: `cd apps/web && npm test`
Expected: all pass (this task touches only data + generated assets, no source files under test).

- [ ] **Step 5: Visual check**

Run: `cd apps/web && npm run dev`, open the World view, look at Auth Module.
Expected: bookshelves along the back wall, two reading desks with chairs, a plant, a flickering candle near the door — reads as a small library, not a random pile of props.

- [ ] **Step 6: Commit**

```bash
git add apps/web/scripts/room_layout.py apps/web/public/world-assets/room-decor.json apps/web/public/world-assets/decor/auth-module/ apps/web/public/world-assets/equipment/animated_wall_candle_32x32.png
git commit -m "feat(world): furnish Auth Module as a library/study"
```

---

### Task 8: Analytics → Sports Den decor

**Files:**
- Modify: `apps/web/scripts/room_layout.py` (fill `DECOR["analytics"]`)
- Regenerate: `apps/web/public/world-assets/room-decor.json`, `apps/web/public/world-assets/decor/analytics/*.png`

**Interfaces:** same shape as Task 7, independent of it.

- [ ] **Step 1: Generate a contact sheet of the Music_and_Sport category**

```bash
cd apps/web/scripts
py asset_contact_sheet.py \
  "../../../moderninteriors-win/1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32" \
  /tmp/sport.png --start 0 --count 100
```
(Re-run with `--start 100` for the rest, up to 164 total.) Find:
- A trophy shelf/case (2 needed, or reuse the same file twice).
- A single seat/chair facing the TV spot.
- A ping-pong or foosball table, roughly 2 tiles wide.
- A sports-themed pennant, ball, or similar small accent (2 needed, or one reused).

- [ ] **Step 2: Add the entries to room_layout.py**

`DESKS["analytics"] = [(3,2), (6,3)]`: index 0 → `desk-analytics-1` at `(3,2)`, index 1 → `desk-analytics-2` at `(6,3)`. Task 6's `EQUIPMENT[("analytics", 1)]` binds the animated TV to index 1, i.e. `(6,3)` — so the ping-pong table (static) belongs at index 0's position, `(3,2)`.

```python
    "analytics": [
        dict(col=1, row=0, dest="trophy-left.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/<trophy file>"),
        dict(col=7, row=0, dest="trophy-right.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/<trophy file>"),
        dict(col=3, row=2, dest="ping-pong.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/<ping-pong file>"),
        dict(col=3, row=3, dest="seat.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/<seat file>"),
        dict(col=1, row=4, dest="pennant.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/<pennant file>"),
        dict(col=7, row=4, dest="plant.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/<plant file>"),
    ],
```

- [ ] **Step 3: Regenerate and verify**

```bash
cd apps/web/scripts
py generate-room-decor.py
py -c "
import json
d = json.load(open('../public/world-assets/room-decor.json'))
assert sum(1 for e in d['decor'] if 'analytics' in e['image']) == 6
print('OK')
"
```

- [ ] **Step 4: Run the test suite**

Run: `cd apps/web && npm test`
Expected: all pass.

- [ ] **Step 5: Visual check**

Run: `cd apps/web && npm run dev`, look at Analytics.
Expected: trophies on the back wall, TV at the desk-2 spot (animates when occupied), ping-pong table at desk-1, seat facing it, pennant + plant.

- [ ] **Step 6: Commit**

```bash
git add apps/web/scripts/room_layout.py apps/web/public/world-assets/room-decor.json apps/web/public/world-assets/decor/analytics/
git commit -m "feat(world): furnish Analytics as a sports den"
```

---

### Task 9: Database → Japanese Room decor

**Files:**
- Modify: `apps/web/scripts/room_layout.py` (fill `DECOR["database"]`)
- Regenerate: `apps/web/public/world-assets/room-decor.json`, `apps/web/public/world-assets/decor/database/*.png`

**Interfaces:** same shape as Task 7, independent of it.

- [ ] **Step 1: Generate a contact sheet of the Japanese Interiors category**

```bash
cd apps/web/scripts
py asset_contact_sheet.py \
  "../../../moderninteriors-win/1_Interiors/32x32/Theme_Sorter_Singles_32x32/20_Japanese_Interiors_Singles_32x32" \
  /tmp/japanese.png --start 0 --count 100
```
Find:
- A shoji screen / paper wall panel (2 needed, or reuse one twice).
- A low table (chabudai) — this is the desk-2 (`(5,2)`) piece.
- A floor cushion (2 needed).
- A bonsai or small potted plant (2 needed, or reuse).

`DESKS["database"] = [(3,2), (5,2)]`: index 0 → `desk-database-1` at `(3,2)`, index 1 → `desk-database-2` at `(5,2)`. Task 6's `EQUIPMENT[("database", 1)]` binds the animated incense burner to index 1, i.e. `(5,2)` — so the chabudai (static) belongs at index 0's position, `(3,2)`.

- [ ] **Step 2: Add the entries to room_layout.py**

```python
    "database": [
        dict(col=1, row=0, dest="shoji-left.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/20_Japanese_Interiors_Singles_32x32/<shoji file>"),
        dict(col=7, row=0, dest="shoji-right.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/20_Japanese_Interiors_Singles_32x32/<shoji file>"),
        dict(col=3, row=2, dest="chabudai.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/20_Japanese_Interiors_Singles_32x32/<table file>"),
        dict(col=3, row=3, dest="cushion-1.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/20_Japanese_Interiors_Singles_32x32/<cushion file>"),
        dict(col=5, row=3, dest="cushion-2.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/20_Japanese_Interiors_Singles_32x32/<cushion file>"),
        dict(col=1, row=4, dest="bonsai-left.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/20_Japanese_Interiors_Singles_32x32/<bonsai file>"),
        dict(col=7, row=4, dest="bonsai-right.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/20_Japanese_Interiors_Singles_32x32/<bonsai file>"),
    ],
```

- [ ] **Step 3: Regenerate and verify**

```bash
cd apps/web/scripts
py generate-room-decor.py
py -c "
import json
d = json.load(open('../public/world-assets/room-decor.json'))
assert sum(1 for e in d['decor'] if 'database' in e['image']) == 7
print('OK')
"
```

- [ ] **Step 4: Run the test suite**

Run: `cd apps/web && npm test`
Expected: all pass.

- [ ] **Step 5: Visual check**

Run: `cd apps/web && npm run dev`, look at Database.
Expected: shoji panels on the back wall, chabudai + incense burner (animates when occupied) with cushions, bonsai in both front corners — reads as a calm tea/zen room.

- [ ] **Step 6: Commit**

```bash
git add apps/web/scripts/room_layout.py apps/web/public/world-assets/room-decor.json apps/web/public/world-assets/decor/database/
git commit -m "feat(world): furnish Database as a Japanese room"
```

---

### Task 10: Billing → Gym decor

**Files:**
- Modify: `apps/web/scripts/room_layout.py` (fill `DECOR["billing"]`)
- Regenerate: `apps/web/public/world-assets/room-decor.json`, `apps/web/public/world-assets/decor/billing/*.png`

**Interfaces:** same shape as Task 7, independent of it.

- [ ] **Step 1: Generate a contact sheet of the Gym category**

```bash
cd apps/web/scripts
py asset_contact_sheet.py \
  "../../../moderninteriors-win/1_Interiors/32x32/Theme_Sorter_Singles_32x32/8_Gym_Singles_32x32" \
  /tmp/gym.png --start 0 --count 100
```
Find:
- A wall mirror (2 needed, or reuse one twice).
- A dumbbell rack.
- A yoga mat.

`EQUIPMENT[("billing", 0)]` and `[("billing", 1)]` (Task 6) already bind the punching bag and treadmill to `DESKS["billing"]`'s two entries `(3,3)` and `(5,3)` — those spots are NOT part of this task's decor list, they're already animating from Task 6.

- [ ] **Step 2: Add the entries to room_layout.py**

```python
    "billing": [
        dict(col=1, row=5, dest="mirror-left.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/8_Gym_Singles_32x32/<mirror file>"),
        dict(col=7, row=5, dest="mirror-right.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/8_Gym_Singles_32x32/<mirror file>"),
        dict(col=1, row=1, dest="dumbbell-rack.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/8_Gym_Singles_32x32/<dumbbell rack file>"),
        dict(col=7, row=1, dest="yoga-mat.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/8_Gym_Singles_32x32/<yoga mat file>"),
    ],
```

(Billing is a bottom-row room — its back wall is `row=5`, not `row=0`; see `room_layout.py`'s `AMBIENT`/spec §6 "back_row" note. Mirrors go on the back wall, dumbbell rack and yoga mat sit up near the door at `row=1`, clear of the punching bag/treadmill at `row=3`.)

- [ ] **Step 3: Regenerate and verify**

```bash
cd apps/web/scripts
py generate-room-decor.py
py -c "
import json
d = json.load(open('../public/world-assets/room-decor.json'))
assert sum(1 for e in d['decor'] if 'billing' in e['image']) == 4
print('OK')
"
```

- [ ] **Step 4: Run the test suite**

Run: `cd apps/web && npm test`
Expected: all pass.

- [ ] **Step 5: Visual check**

Run: `cd apps/web && npm run dev`, look at Billing.
Expected: mirrors on the back wall, punching bag + treadmill mid-room (animate when occupied), dumbbell rack and yoga mat near the door.

- [ ] **Step 6: Commit**

```bash
git add apps/web/scripts/room_layout.py apps/web/public/world-assets/room-decor.json apps/web/public/world-assets/decor/billing/
git commit -m "feat(world): furnish Billing as a gym"
```

---

### Task 11: Deploy Config → Music Room decor

**Files:**
- Modify: `apps/web/scripts/room_layout.py` (fill `DECOR["deploy-config"]`)
- Regenerate: `apps/web/public/world-assets/room-decor.json`, `apps/web/public/world-assets/decor/deploy-config/*.png`

**Interfaces:** same shape as Task 7, independent of it.

- [ ] **Step 1: Generate a contact sheet of the Music_and_Sport category**

```bash
cd apps/web/scripts
py asset_contact_sheet.py \
  "../../../moderninteriors-win/1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32" \
  /tmp/music.png --start 0 --count 100
```
(Same folder as Task 8 — you already have `/tmp/sport.png` from that task and can reuse it instead of regenerating.) Find:
- A stool or record crate (2 needed, or reuse one twice).
- A potted plant (2 needed, reuse from earlier tasks' finds if convenient).

`EQUIPMENT[("deploy-config", 0)]` and `[("deploy-config", 1)]` (Task 6) already bind the wall piano and amplifier to `DESKS["deploy-config"]`'s two entries `(2,4)` and `(6,3)`.

- [ ] **Step 2: Add the entries to room_layout.py**

```python
    "deploy-config": [
        dict(col=2, row=2, dest="crate-1.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/<stool/crate file>"),
        dict(col=6, row=1, dest="crate-2.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/<stool/crate file>"),
        dict(col=1, row=4, dest="plant-left.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/<plant file>"),
        dict(col=7, row=1, dest="plant-right.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/<plant file>"),
    ],
```

- [ ] **Step 3: Regenerate and verify**

```bash
cd apps/web/scripts
py generate-room-decor.py
py -c "
import json
d = json.load(open('../public/world-assets/room-decor.json'))
assert sum(1 for e in d['decor'] if 'deploy-config' in e['image']) == 4
print('OK')
"
```

- [ ] **Step 4: Run the test suite**

Run: `cd apps/web && npm test`
Expected: all pass.

- [ ] **Step 5: Visual check**

Run: `cd apps/web && npm run dev`, look at Deploy Config.
Expected: piano + amplifier (animate when occupied), stools/crates, plants — reads as a small music room.

- [ ] **Step 6: Commit**

```bash
git add apps/web/scripts/room_layout.py apps/web/public/world-assets/room-decor.json apps/web/public/world-assets/decor/deploy-config/
git commit -m "feat(world): furnish Deploy Config as a music room"
```

---

### Task 12: Living Room decor

**Files:**
- Modify: `apps/web/scripts/room_layout.py` (fill `DECOR["living-room"]`)
- Regenerate: `apps/web/public/world-assets/room-decor.json`, `apps/web/public/world-assets/decor/living-room/*.png`

**Interfaces:** same shape as Task 7, independent of it. No `EQUIPMENT` entries exist for this room (it has no desks) — every item here is plain decor.

- [ ] **Step 1: Generate a contact sheet of the Living Room category**

```bash
cd apps/web/scripts
py asset_contact_sheet.py \
  "../../../moderninteriors-win/1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32" \
  /tmp/living.png --start 0 --count 100
```
Find:
- A TV on a stand, roughly 2 tiles wide.
- A sofa, roughly 2 tiles wide, facing the TV.
- A coffee table.
- A rug (or reuse a floor-pattern piece if the folder has one that reads as a rug on top of the floor texture).
- A potted plant (2 needed, or reuse).

- [ ] **Step 2: Add the entries to room_layout.py**

```python
    "living-room": [
        dict(col=3, row=5, dest="tv.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/<TV file>"),
        dict(col=3, row=4, dest="sofa.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/<sofa file>"),
        dict(col=4, row=3, dest="coffee-table.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/<table file>"),
        dict(col=4, row=2, dest="rug.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/<rug file>"),
        dict(col=1, row=1, dest="plant-left.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/<plant file>"),
        dict(col=7, row=1, dest="plant-right.png", src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/<plant file>"),
    ],
```

(Living Room is a bottom-row room — back wall at `row=5`, door at `row=0`; TV/sofa/table/rug form one cluster near the back wall, plants flank the door.)

- [ ] **Step 3: Regenerate and verify**

```bash
cd apps/web/scripts
py generate-room-decor.py
py -c "
import json
d = json.load(open('../public/world-assets/room-decor.json'))
assert sum(1 for e in d['decor'] if 'living-room' in e['image']) == 6
total_decor = sum(1 for r in ('auth-module','analytics','database','billing','living-room','deploy-config')
                   for e in d['decor'] if r in e['image'])
assert total_decor == len(d['decor'])
print('OK', len(d['decor']), 'decor,', len(d['equipment']), 'equipment')
"
```
Expected: `OK 33 decor, 7 equipment` (6+6+7+4+6+4 decor across the 6 rooms, 6 desk-bound + 1 ambient candle).

- [ ] **Step 4: Run the full test suite**

Run: `cd apps/web && npm test && npm run typecheck`
Expected: all pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/room_layout.py apps/web/public/world-assets/room-decor.json apps/web/public/world-assets/decor/living-room/
git commit -m "feat(world): furnish the Living Room as a cozy common lounge"
```

---

### Task 13: Full-world visual verification

No file changes — this is a manual pass confirming the whole feature reads correctly together, per this repo's convention of verifying UI changes in a real browser before calling the work done.

- [ ] **Step 1: Start the app**

Run: `cd apps/web && npm run dev`, open the app, sign in, go to the World view.

- [ ] **Step 2: Confirm canvas size is unchanged**

Expected: the World panel's overall size/layout looks the same as before this feature (no scrollbar, no overflow) — only the rooms inside got bigger, per this plan's Global Constraints.

- [ ] **Step 3: Confirm all 6 rooms read as distinct, intentional spaces**

Walk (or wait for roaming agents to visit) each of the 6 rooms. Expected per room:
- **Auth Module**: library — bookshelves, 2 reading desks + chairs, candle flicker near the door.
- **Analytics**: sports den — trophies, TV (animates when an agent works there), ping-pong table.
- **Database**: Japanese room — shoji panels, chabudai + incense burner (animates when occupied), cushions, bonsai.
- **Billing**: gym — mirrors, punching bag + treadmill (animate when occupied), dumbbell rack, yoga mat.
- **Deploy Config**: music room — piano + amplifier (animate when occupied), stools/crates.
- **Living Room**: cozy lounge — sofa, TV, coffee table, rug, plants, no equipment.

- [ ] **Step 4: Confirm the equipment toggle actually works end-to-end**

Route or wait for an agent to reach a desk with animated equipment (e.g. Billing). Expected: the punching bag/treadmill/etc. sits still until the agent settles into `working` mode there, then starts animating; when the agent leaves, it stops.

- [ ] **Step 5: Confirm nothing else regressed**

Check that room entry permission (keycard) behavior, the security log, and agent pausing/roaming still work as before — this plan never touched `decision.ts`, `agentSim.ts`, or `resources.ts`, so this should be a quick confirmation, not a real risk area.

- [ ] **Step 6: Report findings**

If everything in Steps 2-5 checks out, the feature is done — no commit needed for this task (it's verification-only). If something looks wrong, note which room/step and file a follow-up rather than silently patching mid-verification.

---

## Notes on things intentionally left loose

Every `<... file>` placeholder in Tasks 7-12's `room_layout.py` snippets is a genuine unknown that cannot be resolved without visually inspecting an unlabeled folder of 100-250 numbered PNGs (confirmed during brainstorming — the asset pack ships zero metadata beyond a sequential number, and this is the same situation the original `generate-world-tileset.py` author already solved for the desk/rug/window/plant picks, using this exact search-crop-verify methodology). Each task gives the exact folder, the exact tool invocation, and the exact visual criteria — the only thing deferred to execution time is copying a filename off a contact-sheet image into the code, not any design decision.
