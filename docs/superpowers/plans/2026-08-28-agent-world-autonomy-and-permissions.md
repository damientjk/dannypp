# Agent World — Autonomy, Per-File Permissions & Profile UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual "Send to Room" click flow with autonomous agents that roam a shared six-room house, walk to their assigned file-room's desk when they have real work, and trigger an owner-facing grant/deny popup the first time they need a room they don't yet have access to.

**Architecture:** A new mock resource registry (`resources.ts`) replaces the old two-house model with six `FileRoom`s (four permission-gated, two common). `decision.ts`'s capability store becomes room-scoped. A new `requests.ts` module holds a pending-access-request queue. `agentSim.ts`'s movement state machine is reworked around a `BehaviorMode` (`roaming` / `heading-to-desk` / `working`) driven by each agent's real `status` field, polled continuously. `WorldView.tsx` gains the async orchestration that watches status changes and drives the whole flow, plus a bottom profile strip and per-agent detail panel replacing the old sidebar roster.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, PixiJS (already in place), Python 3 + Pillow (asset authoring, one-off).

**Spec:** `docs/superpowers/specs/2026-08-28-agent-world-autonomy-and-permissions-design.md`.

## Global Constraints

- The Day-2 seam is unconditional: `decideRoomEntry`'s signature (`(request: PolicyRequestLike) => Promise<PolicyDecision>`) never changes, and it remains the *only* place that inspects a capability or decides `permit`/`deny`. No other file — not `agentSim.ts`, not `WorldView.tsx` — ever reads a `Capability` directly.
- `RoomId` and `AgentMoveStatus` (both in `apps/web/src/world/types.ts`) are deleted in this plan. Room ids are plain `string`s (any `FileRoom.id` from `resources.ts`). Movement state is inferred from `progress`/`behaviorMode`, not a separate status enum.
- The old two-house map (`22×13` tiles, `house-a`/`house-b`) is replaced entirely by a new six-room, two-row house (`35×20` tiles). `apps/web/public/world-assets/tileset.png` and `map.json` are regenerated from scratch, not amended.
- Capabilities are room-scoped: `issueCapability`/`getCapability`/`revokeCapability` all take `(agentId, roomId)`, not `(agentId, ownerId)`.
- Every new/modified TypeScript file must pass `npm run --workspace apps/web typecheck` and `npm run --workspace apps/web test` before a task is considered done. As in the prior plan on this branch, a required-signature change can leave callers in *later* tasks red until those tasks land — each task's own steps say exactly which errors are expected and which task clears them.
- `moderninteriors-win` lives outside this repo, at `<repo-root>/moderninteriors-win` (a sibling of `apps/`) — the asset scripts must resolve this path by searching upward for it, not by a hardcoded parent-directory count (this was Important Finding #4 from the prior plan's final review; do not reintroduce that bug).

---

### Task 1: `resources.ts` — the FileRoom registry

**Files:**
- Create: `apps/web/src/world/resources.ts`
- Create: `apps/web/src/world/resources.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2-8): `FileRoom` interface, `FILE_ROOMS: FileRoom[]` (the fixed 6-room list below), `roomById(id: string): FileRoom`, `roomsOwnedBy(ownerId: string): FileRoom[]` (permission-gated rooms only), `assignedRoomFor(agent: Agent): FileRoom | null`, `isGatedTile(renderer: TiledMapRenderer, x: number, y: number): boolean`.

The six rooms (exact ids and desk names — Task 2's map generator must produce spawn points with these exact names, and Task 5's `agentSim.ts` reads `deskIds` directly):

| id | displayName | ownerId | requiresPermission | deskIds |
|---|---|---|---|---|
| `auth-module` | Auth Module | `user-a` | true | `desk-auth-module-1`, `desk-auth-module-2` |
| `billing` | Billing | `user-a` | true | `desk-billing-1`, `desk-billing-2` |
| `database` | Database | `user-b` | true | `desk-database-1`, `desk-database-2` |
| `deploy-config` | Deploy Config | `user-b` | true | `desk-deploy-config-1`, `desk-deploy-config-2` |
| `kitchen` | Kitchen | `null` | false | (none) |
| `living-room` | Living Room | `null` | false | (none) |

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/world/resources.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Agent } from "../types";
import { FILE_ROOMS, assignedRoomFor, roomById, roomsOwnedBy } from "./resources";

function agentFor(id: string, ownerId: string): Agent {
  return {
    id,
    ownerId,
    name: id,
    description: "",
    instructions: "",
    status: "ready",
    workspacePath: "",
    codexThreadId: null,
    lastError: null,
    createdAt: "",
    updatedAt: "",
  };
}

describe("FILE_ROOMS", () => {
  it("has exactly the 6 rooms with the expected owners and permission flags", () => {
    const byId = Object.fromEntries(FILE_ROOMS.map((r) => [r.id, r]));
    expect(Object.keys(byId).sort()).toEqual(
      ["auth-module", "billing", "database", "deploy-config", "kitchen", "living-room"].sort(),
    );
    expect(byId["auth-module"].ownerId).toBe("user-a");
    expect(byId["auth-module"].requiresPermission).toBe(true);
    expect(byId["kitchen"].ownerId).toBeNull();
    expect(byId["kitchen"].requiresPermission).toBe(false);
    expect(byId["kitchen"].deskIds).toEqual([]);
  });
});

describe("roomById", () => {
  it("returns the matching room", () => {
    expect(roomById("billing").displayName).toBe("Billing");
  });

  it("throws for an unknown id", () => {
    expect(() => roomById("nonexistent")).toThrow();
  });
});

describe("roomsOwnedBy", () => {
  it("returns only permission-gated rooms owned by the given owner", () => {
    const rooms = roomsOwnedBy("user-a");
    expect(rooms.map((r) => r.id).sort()).toEqual(["auth-module", "billing"]);
  });

  it("returns an empty array for an owner with no rooms", () => {
    expect(roomsOwnedBy("user-nobody")).toEqual([]);
  });
});

describe("assignedRoomFor", () => {
  it("is deterministic — the same agent always gets the same room", () => {
    const agent = agentFor("agent-42", "user-a");
    const first = assignedRoomFor(agent);
    const second = assignedRoomFor(agent);
    expect(first).not.toBeNull();
    expect(first!.id).toBe(second!.id);
  });

  it("only assigns rooms owned by the agent's own owner", () => {
    const agent = agentFor("agent-1", "user-b");
    const room = assignedRoomFor(agent);
    expect(room).not.toBeNull();
    expect(["database", "deploy-config"]).toContain(room!.id);
  });

  it("returns null for an owner with no rooms", () => {
    const agent = agentFor("agent-1", "user-nobody");
    expect(assignedRoomFor(agent)).toBeNull();
  });
});
```

Run: `npm test --workspace apps/web -- resources`
Expected: FAIL (`resources.ts` doesn't exist yet).

- [ ] **Step 2: Implement `resources.ts`**

Create `apps/web/src/world/resources.ts`:

```ts
import type { Agent } from "../types";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";

export interface FileRoom {
  id: string;
  displayName: string;
  ownerId: string | null;
  requiresPermission: boolean;
  deskIds: string[];
}

export const FILE_ROOMS: FileRoom[] = [
  {
    id: "auth-module",
    displayName: "Auth Module",
    ownerId: "user-a",
    requiresPermission: true,
    deskIds: ["desk-auth-module-1", "desk-auth-module-2"],
  },
  {
    id: "billing",
    displayName: "Billing",
    ownerId: "user-a",
    requiresPermission: true,
    deskIds: ["desk-billing-1", "desk-billing-2"],
  },
  {
    id: "database",
    displayName: "Database",
    ownerId: "user-b",
    requiresPermission: true,
    deskIds: ["desk-database-1", "desk-database-2"],
  },
  {
    id: "deploy-config",
    displayName: "Deploy Config",
    ownerId: "user-b",
    requiresPermission: true,
    deskIds: ["desk-deploy-config-1", "desk-deploy-config-2"],
  },
  {
    id: "kitchen",
    displayName: "Kitchen",
    ownerId: null,
    requiresPermission: false,
    deskIds: [],
  },
  {
    id: "living-room",
    displayName: "Living Room",
    ownerId: null,
    requiresPermission: false,
    deskIds: [],
  },
];

export function roomById(id: string): FileRoom {
  const room = FILE_ROOMS.find((candidate) => candidate.id === id);
  if (!room) throw new Error(`unknown room "${id}"`);
  return room;
}

export function roomsOwnedBy(ownerId: string): FileRoom[] {
  return FILE_ROOMS.filter((room) => room.ownerId === ownerId && room.requiresPermission);
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Deterministic mock job assignment: the same agent always maps to the same
 *  one of its owner's permission-gated rooms. Stands in for real per-file
 *  workspace data, which doesn't exist in the backend today (see spec §9). */
export function assignedRoomFor(agent: Agent): FileRoom | null {
  const owned = roomsOwnedBy(agent.ownerId);
  if (owned.length === 0) return null;
  return owned[hashString(agent.id) % owned.length];
}

/** True if the tile falls inside a permission-gated room's zone — used to
 *  keep free-roam wandering out of file-rooms entirely (spec §4). */
export function isGatedTile(renderer: TiledMapRenderer, x: number, y: number): boolean {
  for (const room of FILE_ROOMS) {
    if (!room.requiresPermission) continue;
    const zone = renderer.getZone(room.id);
    if (!zone) continue;
    if (x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 3: Run the tests**

Run: `npm test --workspace apps/web -- resources`
Expected: 8 passed.

- [ ] **Step 4: Typecheck and commit**

Run: `npm run --workspace apps/web typecheck`
Expected: no errors (this task adds a standalone file nothing else references yet).

```bash
git add apps/web/src/world/resources.ts apps/web/src/world/resources.test.ts
git commit -m "feat(world): add the FileRoom resource registry"
```

---

### Task 2: Author the six-room house map + tileset

**Files:**
- Modify: `apps/web/scripts/generate-world-tileset.py` (full rewrite)
- Modify: `apps/web/scripts/generate-world-map.py` (full rewrite)
- Modify: `apps/web/public/world-assets/tileset.png` (regenerated output)
- Modify: `apps/web/public/world-assets/map.json` (regenerated output)

**Interfaces:**
- Produces (consumed by Task 5-8 via `engineMap.ts`'s already-existing `loadWorldMap()`, unchanged by this task): a `35×20` tile map. Named spawn points: `common` (hallway center), `<room-id>-door` for each of the 6 rooms, `desk-<room-id>-1`/`desk-<room-id>-2` for each of the 4 permission-gated rooms — these exact names are what Task 1's `FILE_ROOMS.deskIds` and Task 5's `agentSim.ts` look up via `renderer.getSpawnPoint(...)`. Named zones: one per room (id matches `FileRoom.id`), consumed by Task 1's `isGatedTile`.

Layout (`TILE=32`, `WIDTH=35`, `HEIGHT=20`): two rows of three rooms, each room a `9×7` exterior block with a door on the wall facing the hallway, connected by one open hallway spanning the full width. Room `x0` (west edge) and row placement:

| Room | x0 | Row | Owner |
|---|---|---|---|
| Auth Module | 0 | top (`y0-6`, door south) | user-a |
| Kitchen | 13 | top | — |
| Database | 26 | top | user-b |
| Billing | 0 | bottom (`y13-19`, door north) | user-a |
| Living Room | 13 | bottom | — |
| Deploy Config | 26 | bottom | user-b |

Gaps between rooms at `x9-12` and `x22-25` (both rows) are unfloored and collision-blocked. The hallway spans `y7-12`, full width, fully open. Each permission-gated room gets 2 desks with a decorative desk/computer sprite; each common room gets 1 decorative rug sprite.

Tileset (11 tiles, `352×32px`, `columns=11`, `firstgid=1`): gid 0 blank, 1 hallway floor, 2 auth-module floor, 3 kitchen floor, 4 database floor, 5 billing floor, 6 living-room floor, 7 deploy-config floor, 8 wall, 9 desk/computer, 10 rug. Floor/wall tiles come from `moderninteriors-win/1_Interiors/32x32/Room_Builder_32x32.png`; the desk and rug come from `moderninteriors-win/1_Interiors/32x32/Interiors_32x32.png` — both already visually verified at the exact coordinates below (labeled contact-sheet inspection, same method as the prior plan's Task 2).

- [ ] **Step 1: Rewrite the tileset-composition script**

Replace the full contents of `apps/web/scripts/generate-world-tileset.py`:

```python
#!/usr/bin/env python3
"""Composite the world's 11-tile tileset from moderninteriors-win art: 7 room
floor textures, 1 wall block, 1 desk/computer prop, 1 decorative rug — all
cropped directly from the source sheets. One-off asset build — re-run only
if the source art or tile choices change.

Usage: python3 generate-world-tileset.py
"""
from pathlib import Path
from PIL import Image

REPO_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "moderninteriors-win").is_dir())
MODERNINTERIORS = REPO_ROOT / "moderninteriors-win"
WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"

TILE = 32

ROOM_BUILDER = MODERNINTERIORS / "1_Interiors" / "32x32" / "Room_Builder_32x32.png"
INTERIORS = MODERNINTERIORS / "1_Interiors" / "32x32" / "Interiors_32x32.png"

# (source sheet, col, row) — verified visually via a labeled contact sheet.
WALL_TILE = (ROOM_BUILDER, 7, 2)
FLOOR_TILES = [
    (ROOM_BUILDER, 11, 25),  # hallway — solid brown
    (ROOM_BUILDER, 0, 15),   # auth-module — solid grey
    (ROOM_BUILDER, 11, 17),  # kitchen — orange brick/tile
    (ROOM_BUILDER, 0, 20),   # database — solid tan
    (ROOM_BUILDER, 11, 23),  # billing — pink/mauve stripe
    (ROOM_BUILDER, 11, 11),  # living-room — wood plank
    (ROOM_BUILDER, 11, 28),  # deploy-config — brown wood plank
]
DESK_TILE = (INTERIORS, 3, 4)  # desk + computer monitor
RUG_TILE = (INTERIORS, 7, 16)  # decorative rug


def crop_tile(sheet_cache, source_path, col, row):
    if source_path not in sheet_cache:
        sheet_cache[source_path] = Image.open(source_path).convert("RGBA")
    sheet = sheet_cache[source_path]
    return sheet.crop((col * TILE, row * TILE, col * TILE + TILE, row * TILE + TILE))


def main() -> None:
    sheet_cache = {}
    tiles = [Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))]  # gid 0: blank
    for source_path, col, row in FLOOR_TILES:
        tiles.append(crop_tile(sheet_cache, source_path, col, row))
    tiles.append(crop_tile(sheet_cache, *WALL_TILE))
    tiles.append(crop_tile(sheet_cache, *DESK_TILE))
    tiles.append(crop_tile(sheet_cache, *RUG_TILE))

    sheet = Image.new("RGBA", (TILE * len(tiles), TILE), (0, 0, 0, 0))
    for i, tile in enumerate(tiles):
        sheet.paste(tile, (i * TILE, 0))

    out_path = WORLD_ASSETS / "tileset.png"
    sheet.save(out_path)
    print(f"wrote {out_path} ({sheet.size[0]}x{sheet.size[1]}, {len(tiles)} tiles)")


if __name__ == "__main__":
    main()
```

Run: `python3 apps/web/scripts/generate-world-tileset.py`
Expected: prints `wrote .../tileset.png (352x32, 11 tiles)`.

- [ ] **Step 2: Verify the tileset visually**

Use the Read tool on `apps/web/public/world-assets/tileset.png`. Expected: 11 distinct 32×32 tiles left to right — transparent, then 7 visually distinct floor textures, then a tan wall block, then a small desk/computer icon, then a rug pattern. If any floor pair reads as too similar at a glance, or the desk/rug crop looks wrong, open the source sheet at that tile's coordinates (e.g. `Interiors_32x32.png` at 32px grid `(3,4)`) to confirm before adjusting the coordinate and re-running.

- [ ] **Step 3: Rewrite the map-authoring script**

Replace the full contents of `apps/web/scripts/generate-world-map.py`:

```python
#!/usr/bin/env python3
"""Author the world's Tiled JSON map: a two-row house, 6 rooms (2 owned by
each user, 2 common/no-permission), a central hallway connecting all of
them, and 2 desk spawn points per owned room. One-off asset build — re-run
only if the room layout changes.

Grid (35 wide x 20 tall, TILE=32px):
  Row 1 (y 0-6): Auth Module (x 0-8, door south at 4,6) | Kitchen (x 13-21,
    door south at 17,6) | Database (x 26-34, door south at 30,6)
  Hallway: y 7-12, full width, fully open
  Row 2 (y 13-19): Billing (x 0-8, door north at 4,13) | Living Room
    (x 13-21, door north at 17,13) | Deploy Config (x 26-34, door north
    at 30,13)
  Gaps between rooms in both rows (x 9-12, x 22-25): unfloored, blocked.

Usage: python3 generate-world-map.py
"""
import json
from pathlib import Path

WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"

WIDTH, HEIGHT, TILE = 35, 20, 32
ROOM_WIDTH, ROOM_HEIGHT = 9, 7

GID_BLANK = 0
GID_HALLWAY = 1
GID_AUTH_MODULE = 2
GID_KITCHEN = 3
GID_DATABASE = 4
GID_BILLING = 5
GID_LIVING_ROOM = 6
GID_DEPLOY_CONFIG = 7
GID_WALL = 8
GID_DESK = 9
GID_RUG = 10

ROOMS = [
    dict(id="auth-module", floor=GID_AUTH_MODULE, owner="user-a", row="top", x0=0),
    dict(id="kitchen", floor=GID_KITCHEN, owner=None, row="top", x0=13),
    dict(id="database", floor=GID_DATABASE, owner="user-b", row="top", x0=26),
    dict(id="billing", floor=GID_BILLING, owner="user-a", row="bottom", x0=0),
    dict(id="living-room", floor=GID_LIVING_ROOM, owner=None, row="bottom", x0=13),
    dict(id="deploy-config", floor=GID_DEPLOY_CONFIG, owner="user-b", row="bottom", x0=26),
]


def exterior_rect(room):
    x0 = room["x0"]
    x1 = x0 + ROOM_WIDTH - 1
    if room["row"] == "top":
        y0, y1 = 0, ROOM_HEIGHT - 1
    else:
        y0, y1 = HEIGHT - ROOM_HEIGHT, HEIGHT - 1
    return x0, y0, x1, y1


def door_tile(room):
    x0, y0, x1, y1 = exterior_rect(room)
    door_x = x0 + ROOM_WIDTH // 2
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
    floor_fill, walls_fill, collision_fill, furniture_fill = {}, {}, {}, {}

    for room in ROOMS:
        x0, y0, x1, y1 = exterior_rect(room)
        door = door_tile(room)
        for x, y in rect_cells(x0, y0, x1, y1):
            if (x, y) == door:
                floor_fill[(x, y)] = room["floor"]
                continue
            if is_ring(x, y, x0, y0, x1, y1):
                walls_fill[(x, y)] = GID_WALL
                collision_fill[(x, y)] = GID_WALL
            else:
                floor_fill[(x, y)] = room["floor"]

    # Gaps between rooms, full height of each room row: unfloored, blocked.
    for row_y0, row_y1 in ((0, ROOM_HEIGHT - 1), (HEIGHT - ROOM_HEIGHT, HEIGHT - 1)):
        for gap_x0, gap_x1 in ((9, 12), (22, 25)):
            for x in range(gap_x0, gap_x1 + 1):
                for y in range(row_y0, row_y1 + 1):
                    collision_fill[(x, y)] = GID_WALL

    # Hallway: fully open floor, full width, no walls.
    hallway_y0, hallway_y1 = ROOM_HEIGHT, HEIGHT - ROOM_HEIGHT - 1
    for x, y in rect_cells(0, hallway_y0, WIDTH - 1, hallway_y1):
        floor_fill[(x, y)] = GID_HALLWAY

    # Desks: 2 per owned room, centered in its interior, with a matching
    # furniture-below sprite so a desk+computer is visibly there.
    desk_objects = []
    for room in ROOMS:
        if room["owner"] is None:
            continue
        x0, y0, x1, y1 = exterior_rect(room)
        desk_y = (y0 + y1) // 2
        for i, desk_x in enumerate((x0 + 2, x1 - 2), start=1):
            name = f"desk-{room['id']}-{i}"
            desk_objects.append((name, desk_x, desk_y))
            furniture_fill[(desk_x, desk_y)] = GID_DESK

    # Rugs: one decorative tile centered in each common room.
    for room in ROOMS:
        if room["owner"] is not None:
            continue
        x0, y0, x1, y1 = exterior_rect(room)
        furniture_fill[((x0 + x1) // 2, (y0 + y1) // 2)] = GID_RUG

    def tile_obj(name, x, y):
        return {"name": name, "x": x * TILE, "y": y * TILE}

    def zone_obj(room):
        x0, y0, x1, y1 = exterior_rect(room)
        return {
            "name": room["id"],
            "x": (x0 + 1) * TILE,
            "y": (y0 + 1) * TILE,
            "width": (ROOM_WIDTH - 2) * TILE,
            "height": (ROOM_HEIGHT - 2) * TILE,
        }

    spawn_objects = [tile_obj("common", 17, 9)]
    for room in ROOMS:
        door_x, door_y = door_tile(room)
        spawn_objects.append(tile_obj(f"{room['id']}-door", door_x, door_y))
    for name, x, y in desk_objects:
        spawn_objects.append(tile_obj(name, x, y))

    tiled_map = {
        "width": WIDTH,
        "height": HEIGHT,
        "tilewidth": TILE,
        "tileheight": TILE,
        "tilesets": [
            {
                "firstgid": 1,
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
            {"name": "furniture-below", "type": "tilelayer", "data": build_layer(furniture_fill)},
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

Run: `python3 apps/web/scripts/generate-world-map.py`
Expected: prints `wrote .../map.json`.

- [ ] **Step 4: Sanity-check the generated map**

Run: `python3 -c "import json; m = json.load(open('apps/web/public/world-assets/map.json')); print(m['width'], m['height']); print(sorted(o['name'] for l in m['layers'] if l['type']=='objectgroup' and l['name']=='spawn-points' for o in l['objects']))"`
Expected: `35 20` then a sorted list of 15 names: `auth-module-door`, `billing-door`, `common`, `database-door`, `deploy-config-door`, `desk-auth-module-1`, `desk-auth-module-2`, `desk-billing-1`, `desk-billing-2`, `desk-database-1`, `desk-database-2`, `desk-deploy-config-1`, `desk-deploy-config-2`, `kitchen-door`, `living-room-door`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/generate-world-tileset.py apps/web/scripts/generate-world-map.py apps/web/public/world-assets/tileset.png apps/web/public/world-assets/map.json
git commit -m "feat(world): author the six-room house map + tileset"
```

---

### Task 3: Room-scoped capabilities in `decision.ts`

**Files:**
- Modify: `apps/web/src/world/decision.ts` (full rewrite)
- Modify: `apps/web/src/world/decision.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `roomById` from `./resources` (Task 1).
- Produces (consumed by Tasks 5, 7): `issueCapability(agentId: string, roomId: string): Capability`, `getCapability(agentId: string, roomId: string): Capability | undefined`, `revokeCapability(agentId: string, roomId: string): void`, `grantedRoomsFor(agentId: string): string[]` (all room ids with a currently-valid, non-revoked, non-expired capability for that agent), `resetCapabilities(): void` (unchanged), `newId(): string` (unchanged), `decideRoomEntry(request: PolicyRequestLike): Promise<PolicyDecision>` (signature unchanged — this is the Day-2 seam).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `apps/web/src/world/decision.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentPrincipal, PolicyRequestLike } from "../types";
import {
  decideRoomEntry,
  getCapability,
  grantedRoomsFor,
  issueCapability,
  resetCapabilities,
  revokeCapability,
} from "./decision";

function requestFor(agentId: string, ownerId: string, resource: string): PolicyRequestLike {
  const principal: AgentPrincipal = {
    kind: "agent",
    id: "agent-principal-" + agentId,
    agentId,
    ownerId,
  };
  return {
    principal,
    action: "enter",
    resource,
    capability: getCapability(agentId, resource),
    requestId: "req-" + agentId + "-" + resource,
  };
}

describe("decideRoomEntry", () => {
  beforeEach(() => {
    resetCapabilities();
  });

  it("permits entry to a common room with no capability at all", async () => {
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "kitchen"));
    expect(decision.effect).toBe("permit");
  });

  it("permits a room the agent was granted", async () => {
    issueCapability("agent-1", "auth-module");
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "auth-module"));
    expect(decision.effect).toBe("permit");
  });

  it("denies a permission-gated room with no capability", async () => {
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "auth-module"));
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("no capability");
  });

  it("granting one room does not grant a different room for the same agent", async () => {
    issueCapability("agent-1", "auth-module");
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "billing"));
    expect(decision.effect).toBe("deny");
  });

  it("granting a room for one agent does not grant it for a different agent", async () => {
    issueCapability("agent-1", "auth-module");
    const decision = await decideRoomEntry(requestFor("agent-2", "user-a", "auth-module"));
    expect(decision.effect).toBe("deny");
  });

  it("denies after the capability is revoked", async () => {
    issueCapability("agent-1", "auth-module");
    revokeCapability("agent-1", "auth-module");
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "auth-module"));
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("revoked");
  });

  it("denies when the capability has expired", async () => {
    issueCapability("agent-1", "auth-module");
    const capability = getCapability("agent-1", "auth-module");
    capability!.expiresAt = new Date(Date.now() - 1000).toISOString();
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "auth-module"));
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("expired");
  });

  it("denies when a request is built with a capability scoped to a different room than it requests", async () => {
    // Every real caller looks up the capability via getCapability(agentId,
    // resource), which by construction can only ever return a capability
    // whose scope already equals resource — so this branch is otherwise
    // unreachable through normal usage. It's still real defensive-in-depth
    // PDP behavior (never trust that a caller's capability lookup matched
    // its own resource field), so it needs its own direct test: build the
    // request by hand instead of through requestFor's automatic lookup.
    const mismatched = issueCapability("agent-1", "auth-module");
    const request: PolicyRequestLike = {
      principal: { kind: "agent", id: "agent-principal-agent-1", agentId: "agent-1", ownerId: "user-a" },
      action: "enter",
      resource: "billing",
      capability: mismatched,
      requestId: "req-mismatch",
    };
    const decision = await decideRoomEntry(request);
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("scoped to auth-module");
  });
});

describe("grantedRoomsFor", () => {
  beforeEach(() => {
    resetCapabilities();
  });

  it("lists only currently-valid granted rooms for the given agent", () => {
    issueCapability("agent-1", "auth-module");
    issueCapability("agent-1", "billing");
    issueCapability("agent-2", "database");
    revokeCapability("agent-1", "billing");
    expect(grantedRoomsFor("agent-1")).toEqual(["auth-module"]);
    expect(grantedRoomsFor("agent-2")).toEqual(["database"]);
  });
});
```

Run: `npm test --workspace apps/web -- decision`
Expected: FAIL (current `decideRoomEntry`/`getCapability`/etc. still use the old `(agentId, ownerId)` shape and the old `RoomId` union).

- [ ] **Step 2: Rewrite `decision.ts`**

Replace the full contents of `apps/web/src/world/decision.ts`:

```ts
import type { Capability, PolicyDecision, PolicyRequestLike } from "../types";
import { roomById } from "./resources";

const capabilities = new Map<string, Capability>();

// crypto.randomUUID is secure-context-only (undefined on plain HTTP for
// anything but localhost) — `npm run dev` binds 0.0.0.0 for LAN demo access,
// so fall back to a non-cryptographic id there.
export const newId = () =>
  crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function capabilityKey(agentId: string, roomId: string): string {
  return `${agentId}:${roomId}`;
}

// ponytail: in-memory mock standing in for the real backend PDP
// (apps/server/src/policy/pdp.ts). Day 2 swap replaces only decideRoomEntry's
// body with a fetch call — callers only ever depend on the PolicyDecision
// shape, so nothing else changes.
export function issueCapability(agentId: string, roomId: string): Capability {
  const capability: Capability = {
    id: newId(),
    scope: roomId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    revokedAt: null,
  };
  capabilities.set(capabilityKey(agentId, roomId), capability);
  return capability;
}

export function getCapability(agentId: string, roomId: string): Capability | undefined {
  return capabilities.get(capabilityKey(agentId, roomId));
}

export function revokeCapability(agentId: string, roomId: string): void {
  const capability = capabilities.get(capabilityKey(agentId, roomId));
  if (capability) capability.revokedAt = new Date().toISOString();
}

export function grantedRoomsFor(agentId: string): string[] {
  const prefix = `${agentId}:`;
  const now = Date.now();
  const rooms: string[] = [];
  for (const [mapKey, capability] of capabilities) {
    if (!mapKey.startsWith(prefix)) continue;
    if (capability.revokedAt) continue;
    if (new Date(capability.expiresAt).getTime() < now) continue;
    rooms.push(mapKey.slice(prefix.length));
  }
  return rooms;
}

export function resetCapabilities(): void {
  capabilities.clear();
}

export async function decideRoomEntry(request: PolicyRequestLike): Promise<PolicyDecision> {
  const decidedAt = new Date().toISOString();
  const { capability, resource, requestId } = request;
  const room = roomById(resource);

  if (!room.requiresPermission) {
    return { effect: "permit", reason: "no permission required for this room", requestId, decidedAt };
  }
  if (!capability) {
    return { effect: "deny", reason: "no capability issued", requestId, decidedAt };
  }
  if (capability.revokedAt) {
    return { effect: "deny", reason: "capability revoked", requestId, decidedAt };
  }
  if (new Date(capability.expiresAt).getTime() < Date.now()) {
    return { effect: "deny", reason: "capability expired", requestId, decidedAt };
  }
  if (capability.scope !== resource) {
    return {
      effect: "deny",
      reason: `capability scoped to ${capability.scope}, not ${resource}`,
      requestId,
      decidedAt,
    };
  }
  return { effect: "permit", reason: "capability scope matches requested room", requestId, decidedAt };
}
```

- [ ] **Step 3: Run the tests**

Run: `npm test --workspace apps/web -- decision`
Expected: 9 passed.

(8 in `decideRoomEntry`'s describe block, 1 in `grantedRoomsFor`'s.)

- [ ] **Step 4: Typecheck**

Run: `npm run --workspace apps/web typecheck`
Expected: errors ONLY in files this task doesn't touch that still call the old `(agentId, ownerId)` capability signature or reference the deleted `RoomId` type — specifically `apps/web/src/world/agentSim.ts`, `agentSim.test.ts`, `WorldView.tsx`, `WorldView.test.tsx`, and possibly `WorldCanvas.test.tsx`. Those are fixed in Tasks 5-8. If typecheck reports errors inside `decision.ts`/`decision.test.ts`/`resources.ts` themselves, that's a real bug in this task — fix it before committing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/world/decision.ts apps/web/src/world/decision.test.ts
git commit -m "feat(world): make capabilities room-scoped"
```

---

### Task 4: `requests.ts` — the pending access-request queue

**Files:**
- Create: `apps/web/src/world/requests.ts`
- Create: `apps/web/src/world/requests.test.ts`

**Interfaces:**
- Consumes: `newId` from `./decision` (Task 3).
- Produces (consumed by Task 7): `AccessRequest` interface (`{ id, agentId, agentName, roomId, roomOwnerId, requestedAt }`), `queueRequest(params: { agentId: string; agentName: string; roomId: string; roomOwnerId: string }): AccessRequest | null` (returns `null`, queues nothing, if a request for that exact `(agentId, roomId)` pair is already pending), `hasPendingRequest(agentId: string, roomId: string): boolean`, `pendingRequestsFor(ownerId: string): AccessRequest[]`, `resolveRequest(requestId: string): void`, `resetRequests(): void`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/world/requests.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  hasPendingRequest,
  pendingRequestsFor,
  queueRequest,
  resetRequests,
  resolveRequest,
} from "./requests";

describe("requests", () => {
  beforeEach(() => {
    resetRequests();
  });

  it("queues a new request and reports it pending", () => {
    const request = queueRequest({
      agentId: "agent-1",
      agentName: "Robot A",
      roomId: "auth-module",
      roomOwnerId: "user-a",
    });
    expect(request).not.toBeNull();
    expect(hasPendingRequest("agent-1", "auth-module")).toBe(true);
  });

  it("does not queue a duplicate for the same agent+room pair", () => {
    queueRequest({ agentId: "agent-1", agentName: "Robot A", roomId: "auth-module", roomOwnerId: "user-a" });
    const second = queueRequest({
      agentId: "agent-1",
      agentName: "Robot A",
      roomId: "auth-module",
      roomOwnerId: "user-a",
    });
    expect(second).toBeNull();
  });

  it("queues a separate request for the same agent and a different room", () => {
    queueRequest({ agentId: "agent-1", agentName: "Robot A", roomId: "auth-module", roomOwnerId: "user-a" });
    const second = queueRequest({
      agentId: "agent-1",
      agentName: "Robot A",
      roomId: "billing",
      roomOwnerId: "user-a",
    });
    expect(second).not.toBeNull();
  });

  it("filters pending requests by room owner", () => {
    queueRequest({ agentId: "agent-1", agentName: "Robot A", roomId: "auth-module", roomOwnerId: "user-a" });
    queueRequest({ agentId: "agent-2", agentName: "Robot B", roomId: "database", roomOwnerId: "user-b" });
    expect(pendingRequestsFor("user-a").map((r) => r.roomId)).toEqual(["auth-module"]);
    expect(pendingRequestsFor("user-b").map((r) => r.roomId)).toEqual(["database"]);
  });

  it("removes a request on resolve", () => {
    const request = queueRequest({
      agentId: "agent-1",
      agentName: "Robot A",
      roomId: "auth-module",
      roomOwnerId: "user-a",
    });
    resolveRequest(request!.id);
    expect(hasPendingRequest("agent-1", "auth-module")).toBe(false);
    expect(pendingRequestsFor("user-a")).toEqual([]);
  });
});
```

Run: `npm test --workspace apps/web -- requests`
Expected: FAIL (`requests.ts` doesn't exist yet).

- [ ] **Step 2: Implement `requests.ts`**

Create `apps/web/src/world/requests.ts`:

```ts
import { newId } from "./decision";

export interface AccessRequest {
  id: string;
  agentId: string;
  agentName: string;
  roomId: string;
  roomOwnerId: string;
  requestedAt: string;
}

let pending: AccessRequest[] = [];

export function queueRequest(params: {
  agentId: string;
  agentName: string;
  roomId: string;
  roomOwnerId: string;
}): AccessRequest | null {
  if (hasPendingRequest(params.agentId, params.roomId)) return null;
  const request: AccessRequest = {
    id: newId(),
    agentId: params.agentId,
    agentName: params.agentName,
    roomId: params.roomId,
    roomOwnerId: params.roomOwnerId,
    requestedAt: new Date().toISOString(),
  };
  pending = [...pending, request];
  return request;
}

export function hasPendingRequest(agentId: string, roomId: string): boolean {
  return pending.some((request) => request.agentId === agentId && request.roomId === roomId);
}

export function pendingRequestsFor(ownerId: string): AccessRequest[] {
  return pending.filter((request) => request.roomOwnerId === ownerId);
}

export function resolveRequest(requestId: string): void {
  pending = pending.filter((request) => request.id !== requestId);
}

export function resetRequests(): void {
  pending = [];
}
```

- [ ] **Step 3: Run the tests**

Run: `npm test --workspace apps/web -- requests`
Expected: 5 passed.

- [ ] **Step 4: Typecheck and commit**

Run: `npm run --workspace apps/web typecheck`
Expected: same error set as after Task 3 (this task's own new files are clean; nothing else references `requests.ts` yet).

```bash
git add apps/web/src/world/requests.ts apps/web/src/world/requests.test.ts
git commit -m "feat(world): add the pending access-request queue"
```

---

### Task 5: `types.ts` + `agentSim.ts` — the behavior-mode movement rework

This is the largest task in the plan: it replaces the click-triggered single-target tween with a continuous `roaming` / `heading-to-desk` / `working` state machine.

**Files:**
- Modify: `apps/web/src/world/types.ts` (full rewrite)
- Modify: `apps/web/src/world/agentSim.ts` (full rewrite)
- Modify: `apps/web/src/world/agentSim.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `assignedRoomFor`, `isGatedTile`, `FileRoom` from `./resources` (Task 1); `findPath` from `./engine/pathfinding`, `TiledMapRenderer` from `./engine/TiledMapRenderer` (both pre-existing, unchanged).
- Produces (consumed by Tasks 6, 7): `BehaviorMode = "roaming" | "heading-to-desk" | "working"`. `WorldAgent` (new shape, see Step 1). `spawnWorldAgents(agents: Agent[], renderer: TiledMapRenderer): WorldAgent[]`. `facingFromDelta(dx: number, dy: number): Facing` (unchanged). `tickAgent(agent: WorldAgent, deltaMs: number): WorldAgent` (unchanged signature/logic — pure tween interpolation). `settleAgent(agent: WorldAgent): WorldAgent` (unchanged signature; behavior-mode-aware on path completion). `advanceBehavior(agent: WorldAgent, renderer: TiledMapRenderer): WorldAgent` (new — picks a fresh free-roam waypoint when idle and still `roaming`). `beginHeadingToDesk(agent: WorldAgent, room: FileRoom, occupiedDeskIds: Set<string>, renderer: TiledMapRenderer): WorldAgent | null` (new — returns `null` if every desk in the room is currently occupied; caller keeps the agent roaming and retries later). `endWorking(agent: WorldAgent): WorldAgent` (new — releases the desk, returns to roaming).

- [ ] **Step 1: Rewrite `types.ts`**

Replace the full contents of `apps/web/src/world/types.ts`:

```ts
import type { PolicyEffect } from "../types";

export type Facing = "up" | "down" | "left" | "right";
export type BehaviorMode = "roaming" | "heading-to-desk" | "working";

export interface WorldAgent {
  agentId: string;
  ownerId: string;
  name: string;
  x: number;
  y: number;
  originX: number;
  originY: number;
  targetX: number;
  targetY: number;
  facing: Facing;
  progress: number;
  path: Array<{ x: number; y: number }>;
  pathIndex: number;
  behaviorMode: BehaviorMode;
  assignedRoomId: string | null;
  occupiedDeskId: string | null;
}

export interface DecisionEvent {
  requestId: string;
  agentId: string;
  agentName: string;
  room: string;
  effect: PolicyEffect;
  reason: string;
  decidedAt: string;
}
```

Note what's gone versus the prior plan's shape: `AgentMoveStatus`, `RoomId`, `currentRoom`, `pendingEffect`, `pendingRoom` are all deleted. "Currently mid-tween" is now `progress < 1` (no separate status field needed); "which room, if any" is `assignedRoomId` (fixed per agent, not a per-move target).

- [ ] **Step 2: Write the failing tests**

Replace the full contents of `apps/web/src/world/agentSim.test.ts`:

```ts
import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { Agent } from "../types";
import { TiledMapRenderer } from "./engine/TiledMapRenderer";
import type { TiledMap } from "./engine/TiledMapRenderer";
import { TILE_SIZE } from "./engineMap";
import { roomById } from "./resources";
import {
  advanceBehavior,
  beginHeadingToDesk,
  endWorking,
  facingFromDelta,
  settleAgent,
  spawnWorldAgents,
  tickAgent,
} from "./agentSim";

const AGENT: Agent = {
  id: "agent-1",
  ownerId: "user-a",
  name: "Robot A",
  description: "",
  instructions: "",
  status: "ready",
  workspacePath: "",
  codexThreadId: null,
  lastError: null,
  createdAt: "",
  updatedAt: "",
};

// A 10x3 map: an open corridor along row y=2 (the "hallway"), a walled
// "auth-module" room (interior x=1..7, y=0) with a door gap at (4,1) and
// a zone covering that interior, and two desks inside it. Small enough to
// hand-verify, big enough to force multi-waypoint paths and real roam
// wandering within the corridor only.
function testRenderer(): TiledMapRenderer {
  const width = 10;
  const height = 3;
  const floor = new Array(width * height).fill(1);
  const collision = new Array(width * height).fill(0);
  for (let x = 0; x < width; x++) {
    if (x !== 4) collision[1 * width + x] = 8;
  }
  const mapData: TiledMap = {
    width,
    height,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    tilesets: [{ firstgid: 1, columns: 11, tilewidth: TILE_SIZE, tileheight: TILE_SIZE, tilecount: 11 }],
    layers: [
      { name: "floor", type: "tilelayer", data: floor },
      { name: "collision", type: "tilelayer", data: collision },
      {
        name: "spawn-points",
        type: "objectgroup",
        objects: [
          { name: "common", x: 1 * TILE_SIZE, y: 2 * TILE_SIZE },
          { name: "auth-module-door", x: 4 * TILE_SIZE, y: 1 * TILE_SIZE },
          { name: "desk-auth-module-1", x: 2 * TILE_SIZE, y: 0 },
          { name: "desk-auth-module-2", x: 6 * TILE_SIZE, y: 0 },
        ],
      },
      {
        name: "zones",
        type: "objectgroup",
        objects: [{ name: "auth-module", x: 1 * TILE_SIZE, y: 0, width: 7 * TILE_SIZE, height: 1 * TILE_SIZE }],
      },
    ],
  };
  return new TiledMapRenderer(mapData, [Texture.WHITE]);
}

describe("spawnWorldAgents", () => {
  it("spawns roaming at the common spawn point with an assigned room and no desk", () => {
    const renderer = testRenderer();
    const [agent] = spawnWorldAgents([AGENT], renderer);
    expect(agent.x).toBe(1 * TILE_SIZE);
    expect(agent.y).toBe(2 * TILE_SIZE);
    expect(agent.behaviorMode).toBe("roaming");
    expect(agent.assignedRoomId).toBe("auth-module");
    expect(agent.occupiedDeskId).toBeNull();
  });

  it("spawns multiple agents at visibly different positions", () => {
    const renderer = testRenderer();
    const [first, second] = spawnWorldAgents([AGENT, { ...AGENT, id: "agent-2" }], renderer);
    expect(first.x).not.toBe(second.x);
  });

  it("leaves assignedRoomId null for an agent whose owner has no rooms", () => {
    const renderer = testRenderer();
    const [agent] = spawnWorldAgents([{ ...AGENT, ownerId: "user-nobody" }], renderer);
    expect(agent.assignedRoomId).toBeNull();
  });
});

describe("facingFromDelta", () => {
  it("picks the dominant axis", () => {
    expect(facingFromDelta(10, 1)).toBe("right");
    expect(facingFromDelta(-10, 1)).toBe("left");
    expect(facingFromDelta(1, 10)).toBe("down");
    expect(facingFromDelta(1, -10)).toBe("up");
  });
});

function runToRest(agent: import("./types").WorldAgent, guardMax = 1000) {
  let guard = 0;
  while (agent.progress < 1 || agent.path.length > 0) {
    agent = settleAgent(tickAgent(agent, 50));
    guard += 1;
    if (guard >= guardMax) break;
  }
  return { agent, guard };
}

describe("advanceBehavior", () => {
  it("picks a new roam waypoint and starts walking when idle and roaming", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    agent = advanceBehavior(agent, renderer);
    expect(agent.path.length).toBeGreaterThan(0);
  });

  it("never routes a roam waypoint through the gated auth-module zone", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    for (let i = 0; i < 50; i++) {
      agent = advanceBehavior({ ...agent, path: [], pathIndex: 0, progress: 1 }, renderer);
      for (const point of agent.path) {
        const tile = renderer.pixelToTile(point.x, point.y);
        expect(tile.y).not.toBe(0); // auth-module's interior row
      }
    }
  });

  it("does nothing when the agent is heading to a desk or working", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    agent = { ...agent, behaviorMode: "working" };
    const result = advanceBehavior(agent, renderer);
    expect(result).toBe(agent);
  });
});

describe("beginHeadingToDesk", () => {
  it("walks to a free desk and settles into working", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    const room = roomById("auth-module");
    const started = beginHeadingToDesk(agent, room, new Set(), renderer);
    expect(started).not.toBeNull();
    agent = started!;
    expect(agent.behaviorMode).toBe("heading-to-desk");
    expect(agent.occupiedDeskId).toBe("desk-auth-module-1");

    const { agent: settled, guard } = runToRest(agent);
    expect(guard).toBeLessThan(1000);
    expect(settled.behaviorMode).toBe("working");
    expect(settled.x).toBe(2 * TILE_SIZE);
    expect(settled.y).toBe(0);
  });

  it("picks the second desk when the first is occupied", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    const room = roomById("auth-module");
    const started = beginHeadingToDesk(agent, room, new Set(["desk-auth-module-1"]), renderer);
    expect(started!.occupiedDeskId).toBe("desk-auth-module-2");
  });

  it("returns null when every desk is occupied", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    const room = roomById("auth-module");
    const started = beginHeadingToDesk(
      agent,
      room,
      new Set(["desk-auth-module-1", "desk-auth-module-2"]),
      renderer,
    );
    expect(started).toBeNull();
  });
});

describe("endWorking", () => {
  it("releases the desk and returns to roaming", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    agent = beginHeadingToDesk(agent, roomById("auth-module"), new Set(), renderer)!;
    agent = runToRest(agent).agent;
    expect(agent.behaviorMode).toBe("working");

    agent = endWorking(agent);
    expect(agent.behaviorMode).toBe("roaming");
    expect(agent.occupiedDeskId).toBeNull();
  });
});
```

Run: `npm test --workspace apps/web -- agentSim`
Expected: FAIL (`advanceBehavior`, `beginHeadingToDesk`, `endWorking` don't exist yet; `spawnWorldAgents`'s current output shape doesn't have `behaviorMode`/`assignedRoomId`/`occupiedDeskId`).

- [ ] **Step 3: Rewrite `agentSim.ts`**

Replace the full contents of `apps/web/src/world/agentSim.ts`:

```ts
import type { Agent } from "../types";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import { findPath } from "./engine/pathfinding";
import { assignedRoomFor, isGatedTile } from "./resources";
import type { FileRoom } from "./resources";
import type { Facing, WorldAgent } from "./types";

const MOVE_SPEED_PX_PER_MS = 0.12;
const ROAM_RADIUS_TILES = 4;
const ROAM_PICK_ATTEMPTS = 20;

export function spawnWorldAgents(agents: Agent[], renderer: TiledMapRenderer): WorldAgent[] {
  const spawnTile = renderer.getSpawnPoint("common") ?? { x: 0, y: 0 };
  return agents.map((agent, index) => {
    const { x, y } = renderer.tileToPixel(spawnTile.x + index, spawnTile.y);
    return {
      agentId: agent.id,
      ownerId: agent.ownerId,
      name: agent.name,
      x,
      y,
      originX: x,
      originY: y,
      targetX: x,
      targetY: y,
      facing: "down",
      progress: 1,
      path: [],
      pathIndex: 0,
      behaviorMode: "roaming",
      assignedRoomId: assignedRoomFor(agent)?.id ?? null,
      occupiedDeskId: null,
    };
  });
}

export function facingFromDelta(dx: number, dy: number): Facing {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

function walkableAdapter(renderer: TiledMapRenderer) {
  return {
    width: renderer.width,
    height: renderer.height,
    isWalkable: (x: number, y: number) => renderer.isWalkable(x, y),
  };
}

function openRoamAdapter(renderer: TiledMapRenderer) {
  return {
    width: renderer.width,
    height: renderer.height,
    isWalkable: (x: number, y: number) => renderer.isWalkable(x, y) && !isGatedTile(renderer, x, y),
  };
}

function pathWaypoints(
  renderer: TiledMapRenderer,
  agent: WorldAgent,
  goalTile: { x: number; y: number },
  adapter: ReturnType<typeof walkableAdapter>,
): Array<{ x: number; y: number }> {
  const startTile = renderer.pixelToTile(agent.x, agent.y);
  const tileHops = findPath(adapter, startTile, goalTile) ?? [];
  return [{ x: agent.x, y: agent.y }, ...tileHops.map((tile) => renderer.tileToPixel(tile.x, tile.y))];
}

function beginPath(agent: WorldAgent, waypoints: Array<{ x: number; y: number }>): WorldAgent {
  const first = waypoints[0];
  const next = waypoints[1] ?? first;
  return {
    ...agent,
    originX: first.x,
    originY: first.y,
    targetX: next.x,
    targetY: next.y,
    facing: facingFromDelta(next.x - first.x, next.y - first.y),
    progress: 0,
    path: waypoints,
    pathIndex: 0,
  };
}

/** Only re-picks a roam target when idle (no path left to walk) and still
 *  meant to be roaming — heading-to-desk/working agents are untouched;
 *  their transitions are driven by settleAgent or by the caller's async
 *  task-visit orchestration (decideRoomEntry can't run inside a
 *  synchronous per-frame function). */
export function advanceBehavior(agent: WorldAgent, renderer: TiledMapRenderer): WorldAgent {
  if (agent.behaviorMode !== "roaming" || agent.path.length > 0) return agent;

  const adapter = openRoamAdapter(renderer);
  const startTile = renderer.pixelToTile(agent.x, agent.y);
  for (let attempt = 0; attempt < ROAM_PICK_ATTEMPTS; attempt++) {
    const dx = Math.floor(Math.random() * (ROAM_RADIUS_TILES * 2 + 1)) - ROAM_RADIUS_TILES;
    const dy = Math.floor(Math.random() * (ROAM_RADIUS_TILES * 2 + 1)) - ROAM_RADIUS_TILES;
    const candidate = { x: startTile.x + dx, y: startTile.y + dy };
    if (!adapter.isWalkable(candidate.x, candidate.y)) continue;
    const waypoints = pathWaypoints(renderer, agent, candidate, adapter);
    if (waypoints.length <= 1) continue; // start === goal or unreachable; try another candidate
    return beginPath(agent, waypoints);
  }
  return agent; // nothing new to wander to this cycle; retry next frame
}

export function beginHeadingToDesk(
  agent: WorldAgent,
  room: FileRoom,
  occupiedDeskIds: Set<string>,
  renderer: TiledMapRenderer,
): WorldAgent | null {
  const freeDeskId = room.deskIds.find((id) => !occupiedDeskIds.has(id));
  if (!freeDeskId) return null;
  const deskTile = renderer.getSpawnPoint(freeDeskId);
  if (!deskTile) return null;

  const waypoints = pathWaypoints(renderer, agent, deskTile, walkableAdapter(renderer));
  return {
    ...beginPath(agent, waypoints),
    behaviorMode: "heading-to-desk",
    occupiedDeskId: freeDeskId,
  };
}

export function endWorking(agent: WorldAgent): WorldAgent {
  return {
    ...agent,
    behaviorMode: "roaming",
    occupiedDeskId: null,
    path: [],
    pathIndex: 0,
  };
}

export function tickAgent(agent: WorldAgent, deltaMs: number): WorldAgent {
  if (agent.progress >= 1) return agent;
  const distance = Math.hypot(agent.targetX - agent.originX, agent.targetY - agent.originY) || 1;
  const step = (MOVE_SPEED_PX_PER_MS * deltaMs) / distance;
  const progress = Math.min(1, agent.progress + step);
  return {
    ...agent,
    progress,
    x: agent.originX + (agent.targetX - agent.originX) * progress,
    y: agent.originY + (agent.targetY - agent.originY) * progress,
  };
}

export function settleAgent(agent: WorldAgent): WorldAgent {
  if (agent.progress < 1) return agent;

  const nextIndex = agent.pathIndex + 1;
  if (nextIndex < agent.path.length - 1) {
    const from = agent.path[nextIndex];
    const to = agent.path[nextIndex + 1];
    return {
      ...agent,
      pathIndex: nextIndex,
      originX: from.x,
      originY: from.y,
      targetX: to.x,
      targetY: to.y,
      facing: facingFromDelta(to.x - from.x, to.y - from.y),
      progress: 0,
    };
  }

  if (agent.path.length === 0) return agent; // already at rest, nothing to settle

  if (agent.behaviorMode === "heading-to-desk") {
    return { ...agent, behaviorMode: "working", path: [], pathIndex: 0 };
  }
  return { ...agent, path: [], pathIndex: 0 };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace apps/web -- agentSim`
Expected: 10 passed.

- [ ] **Step 5: Typecheck**

Run: `npm run --workspace apps/web typecheck`
Expected: errors ONLY in `apps/web/src/world/WorldCanvas.tsx`, `WorldCanvas.test.tsx`, `WorldView.tsx`, `WorldView.test.tsx` — all reference the deleted `AgentMoveStatus`/`RoomId` types or the old `WorldAgent` shape (`status`, `currentRoom`, `pendingEffect`, `pendingRoom`) or call the deleted `beginMoveToRoom`. Fixed in Tasks 6-8. If typecheck reports errors inside `agentSim.ts`/`agentSim.test.ts`/`types.ts` themselves, that's a real bug in this task — fix it before committing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/world/types.ts apps/web/src/world/agentSim.ts apps/web/src/world/agentSim.test.ts
git commit -m "feat(world): rework agent movement around roam/desk/work behavior modes"
```

---

### Task 6: `WorldCanvas.tsx` — drive rendering off `behaviorMode`, drop deny-tint, add the roam tick, resize to the new map

**Files:**
- Modify: `apps/web/src/world/WorldCanvas.tsx`
- Modify: `apps/web/src/world/WorldCanvas.test.tsx`

**Interfaces:**
- Consumes: `advanceBehavior`, `settleAgent`, `tickAgent` from `./agentSim` (Task 5); `WorldAgent` from `./types` (Task 5, new shape). `WorldCanvasProps` stays `{ agents: WorldAgent[]; onFrame: (agents: WorldAgent[]) => void }` — unchanged prop contract, so `WorldView.tsx` (Tasks 7-8) doesn't need to know anything about this component's internals beyond the shape of `WorldAgent` it already gets from `agentSim.ts`.

`WorldCanvas` previously only called `settleAgent(tickAgent(agent, deltaMs))` each frame — that's still correct for tween progression, but now the tick loop must ALSO call `advanceBehavior(...)` afterward so roaming agents keep picking new waypoints once they arrive somewhere (`advanceBehavior` needs the `TiledMapRenderer`, which this component already loads and holds in its `renderer` closure variable).

- [ ] **Step 1: Update the test**

Replace the full contents of `apps/web/src/world/WorldCanvas.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorldAgent } from "./types";
import { WorldCanvas } from "./WorldCanvas";

vi.mock("pixi.js", async () => {
  const actual = await vi.importActual<typeof import("pixi.js")>("pixi.js");
  return {
    ...actual,
    Application: class {
      canvas = document.createElement("canvas");
      stage = new actual.Container();
      ticker = { add: vi.fn(), remove: vi.fn() };
      async init() {}
      destroy() {}
    },
    Assets: { load: vi.fn().mockResolvedValue(actual.Texture.WHITE) },
  };
});

vi.mock("./engineMap", async () => {
  const actual = await vi.importActual<typeof import("pixi.js")>("pixi.js");
  const rootContainer = new actual.Container();
  const characterContainer = new actual.Container();
  return {
    TILE_SIZE: 32,
    loadWorldMap: vi.fn().mockResolvedValue({
      width: 35,
      height: 20,
      tileSize: 32,
      getContainer: () => rootContainer,
      getCharacterContainer: () => characterContainer,
      getSpawnPoint: () => ({ x: 0, y: 0 }),
      getZone: () => undefined,
      tileToPixel: (x: number, y: number) => ({ x: x * 32, y: y * 32 }),
      pixelToTile: (x: number, y: number) => ({ x: Math.floor(x / 32), y: Math.floor(y / 32) }),
      isWalkable: () => true,
    }),
  };
});

function agent(overrides: Partial<WorldAgent> = {}): WorldAgent {
  return {
    agentId: "agent-1",
    ownerId: "user-a",
    name: "Robot A",
    x: 0,
    y: 0,
    originX: 0,
    originY: 0,
    targetX: 0,
    targetY: 0,
    facing: "down",
    progress: 1,
    path: [],
    pathIndex: 0,
    behaviorMode: "roaming",
    assignedRoomId: "auth-module",
    occupiedDeskId: null,
    ...overrides,
  };
}

describe("WorldCanvas", () => {
  it("renders a canvas and reports ticked frames", async () => {
    const onFrame = vi.fn();
    const { container, unmount } = render(<WorldCanvas agents={[agent()]} onFrame={onFrame} />);

    expect(container.querySelector('[data-testid="world-canvas"]')).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onFrame).toHaveBeenCalled();
    const [firstCallArg] = onFrame.mock.calls[onFrame.mock.calls.length - 1];
    expect(firstCallArg).toHaveLength(1);

    unmount();
  });

  it("keeps roaming agents moving on their own (advanceBehavior picks a target)", async () => {
    const onFrame = vi.fn();
    const { unmount } = render(<WorldCanvas agents={[agent()]} onFrame={onFrame} />);

    await new Promise((resolve) => setTimeout(resolve, 80));
    const calls = onFrame.mock.calls;
    const last = calls[calls.length - 1][0] as WorldAgent[];
    // An agent with progress:1 and no path, left alone for several frames,
    // should have been given a fresh roam path by advanceBehavior.
    expect(last[0].path.length).toBeGreaterThan(0);

    unmount();
  });
});
```

- [ ] **Step 2: Rewrite `WorldCanvas.tsx`**

Replace the full contents of `apps/web/src/world/WorldCanvas.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { Application, Assets } from "pixi.js";
import type { Texture } from "pixi.js";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import { CharacterSprite } from "./engine/CharacterSprite";
import { buildCharacterFrames } from "./engineCharacter";
import { loadWorldMap } from "./engineMap";
import { advanceBehavior, settleAgent, tickAgent } from "./agentSim";
import type { WorldAgent } from "./types";

export interface WorldCanvasProps {
  agents: WorldAgent[];
  onFrame: (agents: WorldAgent[]) => void;
}

export function WorldCanvas({ agents, onFrame }: WorldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const agentsRef = useRef(agents);
  const onFrameRef = useRef(onFrame);
  const spritesRef = useRef(new Map<string, CharacterSprite>());

  agentsRef.current = agents;
  onFrameRef.current = onFrame;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let app: Application | null = null;
    let renderer: TiledMapRenderer | null = null;
    let characterTexture: Texture | null = null;
    let lastTime: number | null = null;

    const tick = (time: number) => {
      if (disposed || !renderer) return;
      const last = lastTime ?? time;
      const deltaMs = time - last;
      lastTime = time;

      const next = agentsRef.current.map((agent) =>
        advanceBehavior(settleAgent(tickAgent(agent, deltaMs)), renderer!),
      );
      onFrameRef.current(next);

      const seen = new Set<string>();
      for (const agent of next) {
        seen.add(agent.agentId);
        let sprite = spritesRef.current.get(agent.agentId);
        if (!sprite) {
          sprite = new CharacterSprite(buildCharacterFrames(characterTexture!));
          renderer.getCharacterContainer().addChild(sprite.container);
          spritesRef.current.set(agent.agentId, sprite);
        }
        sprite.setPosition(agent.x + 16, agent.y + 32);
        const isMoving = agent.progress < 1;
        const anim = agent.behaviorMode === "working" ? "type" : isMoving ? "walk" : "idle";
        sprite.setAnimation(anim, agent.facing);
      }
      for (const [id, sprite] of spritesRef.current) {
        if (!seen.has(id)) {
          sprite.destroy();
          spritesRef.current.delete(id);
        }
      }

      requestAnimationFrame(tick);
    };

    (async () => {
      try {
        const [loadedRenderer, loadedCharacterTexture] = await Promise.all([
          loadWorldMap(),
          Assets.load("/world-assets/characters/default.png"),
        ]);
        if (disposed) return;

        renderer = loadedRenderer;
        characterTexture = loadedCharacterTexture;

        app = new Application();
        await app.init({
          canvas,
          width: renderer.width * renderer.tileSize,
          height: renderer.height * renderer.tileSize,
          backgroundAlpha: 0,
          antialias: false,
        });
        if (disposed) {
          app.destroy();
          return;
        }
        app.stage.addChild(renderer.getContainer());

        requestAnimationFrame(tick);
      } catch (err) {
        console.error("WorldCanvas failed to initialize:", err);
      }
    })();

    return () => {
      disposed = true;
      for (const sprite of spritesRef.current.values()) sprite.destroy();
      spritesRef.current.clear();
      app?.destroy();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="world-canvas"
      data-testid="world-canvas"
      width={1120}
      height={640}
    />
  );
}
```

Two changes from the prior version beyond the behavior-mode rework: `advanceBehavior(..., renderer!)` is chained after `settleAgent` every frame (the `!` is safe — `tick` bails out at its top if `renderer` is `null`, so by the time this line runs it's always assigned), and the `DENY_TINT`/`setTint` calls are gone entirely — there's no more denied-bounce animation in this feature, so nothing needs tinting (`CharacterSprite.setTint` itself stays in `engine/CharacterSprite.ts`, unused for now; that's fine, it's vendored code, not code this task owns).

- [ ] **Step 3: Run the tests**

Run: `npm test --workspace apps/web -- WorldCanvas`
Expected: 2 passed.

- [ ] **Step 4: Typecheck**

Run: `npm run --workspace apps/web typecheck`
Expected: errors ONLY in `apps/web/src/world/WorldView.tsx` and `WorldView.test.tsx` (still reference the old `WorldAgent` shape and deleted `agentSim.ts` exports). Fixed in Tasks 7-8. If typecheck reports errors inside `WorldCanvas.tsx`/`.test.tsx` themselves, that's a real bug in this task — fix it before committing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/world/WorldCanvas.tsx apps/web/src/world/WorldCanvas.test.tsx
git commit -m "feat(world): drive WorldCanvas rendering off behaviorMode"
```

---

### Task 7: `WorldView.tsx` — status polling, task-visit orchestration, and the new UI

This is the second-largest task: it replaces the manual "Send to Room"/"Revoke keycard" controls with continuous agent-status polling, the async grant/deny orchestration, a bottom agent strip, and a detail panel. It's kept as one task (behavior wiring and UI together) rather than split, because splitting would mean writing throwaway intermediate markup only to replace it in the very next task.

**Files:**
- Modify: `apps/web/src/world/WorldView.tsx` (full rewrite)
- Modify: `apps/web/src/world/WorldView.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `spawnWorldAgents`, `beginHeadingToDesk`, `endWorking` from `./agentSim` (Task 5); `decideRoomEntry`, `getCapability`, `issueCapability`, `revokeCapability`, `grantedRoomsFor`, `newId` from `./decision` (Task 3); `AccessRequest`, `hasPendingRequest`, `pendingRequestsFor`, `queueRequest`, `resolveRequest` from `./requests` (Task 4); `roomById` from `./resources` (Task 1); `loadWorldMap` from `./engineMap`, `WorldCanvas` (Task 6) — all pre-existing/unchanged beyond their own tasks.
- Produces: no other file consumes `WorldView.tsx`'s exports beyond the existing `<WorldView />` default usage from `App.tsx` (untouched by this plan).

**Interpretation call, stated explicitly (this is a judgment call, not directly specified by the spec):** the spec says "all agents, all owners, always visible" and that login determines whose requests you grant — it doesn't explicitly say whether the login *gate* itself (must be logged in as someone to see the world at all) is removed. This plan keeps the existing structural gate: you must log in as User A or User B to see the world, but once logged in as either, you see every agent from every owner roaming, and only your own rooms' requests reach you. If this reads wrong once you see it running, that's a one-line change (drop the `if (!principal) return <login-screen>` branch) — flag it rather than silently changing scope mid-task.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `apps/web/src/world/WorldView.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../types";
import { api } from "../api";
import { FILE_ROOMS } from "./resources";
import { issueCapability, resetCapabilities } from "./decision";
import { resetRequests } from "./requests";
import { WorldView } from "./WorldView";

vi.mock("../api", () => ({
  api: {
    login: vi.fn(),
    listAgents: vi.fn(),
    runs: vi.fn(),
    messages: vi.fn(),
  },
  setSessionToken: vi.fn(),
}));

vi.mock("pixi.js", async () => {
  const actual = await vi.importActual<typeof import("pixi.js")>("pixi.js");
  return {
    ...actual,
    Application: class {
      canvas = document.createElement("canvas");
      stage = new actual.Container();
      async init() {}
      destroy() {}
    },
    Assets: { load: vi.fn().mockResolvedValue(actual.Texture.WHITE) },
  };
});

// Every room has a door + zone; the 4 owned rooms also get 2 desks each —
// enough for assignedRoomFor (real, unmocked resources.ts) to resolve
// correctly for an agent owned by either user-a or user-b.
vi.mock("./engineMap", async () => {
  const { TiledMapRenderer } = await import("./engine/TiledMapRenderer");
  const { Texture } = await import("pixi.js");
  const TILE = 32;
  const spawnObjects: Array<{ name: string; x: number; y: number }> = [{ name: "common", x: TILE, y: TILE }];
  const zoneObjects: Array<{ name: string; x: number; y: number; width: number; height: number }> = [];
  const { FILE_ROOMS: rooms } = await import("./resources");
  rooms.forEach((room, index) => {
    const doorX = (5 + index * 3) * TILE;
    spawnObjects.push({ name: `${room.id}-door`, x: doorX, y: TILE });
    zoneObjects.push({ name: room.id, x: doorX, y: 0, width: 2 * TILE, height: 2 * TILE });
    room.deskIds.forEach((deskId, deskIndex) => {
      spawnObjects.push({ name: deskId, x: doorX + deskIndex * TILE, y: 0 });
    });
  });
  const width = 40;
  const height = 10;
  const mapData = {
    width,
    height,
    tilewidth: TILE,
    tileheight: TILE,
    tilesets: [{ firstgid: 1, columns: 11, tilewidth: TILE, tileheight: TILE, tilecount: 11 }],
    layers: [
      { name: "floor", type: "tilelayer" as const, data: new Array(width * height).fill(1) },
      { name: "collision", type: "tilelayer" as const, data: new Array(width * height).fill(0) },
      { name: "spawn-points", type: "objectgroup" as const, objects: spawnObjects },
      { name: "zones", type: "objectgroup" as const, objects: zoneObjects },
    ],
  };
  const renderer = new TiledMapRenderer(mapData, [Texture.WHITE]);
  return {
    TILE_SIZE: 32,
    loadWorldMap: vi.fn().mockResolvedValue(renderer),
  };
});

const AGENT_A: Agent = {
  id: "agent-a",
  ownerId: "user-a",
  name: "Robot A",
  description: "",
  instructions: "",
  status: "ready",
  workspacePath: "",
  codexThreadId: null,
  lastError: null,
  createdAt: "",
  updatedAt: "",
};

function agentAssignedRoom(agentId: string, ownerId: string) {
  const owned = FILE_ROOMS.filter((r) => r.ownerId === ownerId && r.requiresPermission);
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  return owned[hash % owned.length];
}

describe("WorldView", () => {
  beforeEach(() => {
    resetCapabilities();
    resetRequests();
    vi.mocked(api.login).mockResolvedValue({
      sessionToken: "tok",
      principal: { kind: "human", id: "user-a", displayName: "User A" },
    });
    vi.mocked(api.runs).mockResolvedValue({ runs: [] });
    vi.mocked(api.messages).mockResolvedValue({ messages: [] });
  });

  async function login() {
    render(<WorldView />);
    fireEvent.click(await screen.findByText("Log in as User A"));
    await screen.findByText("Robot A");
  }

  it("shows every agent from every owner once logged in", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({
      agents: [AGENT_A, { ...AGENT_A, id: "agent-b", ownerId: "user-b", name: "Robot B" }],
    });
    await login();
    expect(await screen.findByText("Robot B")).toBeTruthy();
  });

  it("logs a permit and moves the agent off roaming when it already has a capability for its assigned room", async () => {
    const room = agentAssignedRoom(AGENT_A.id, AGENT_A.ownerId);
    issueCapability(AGENT_A.id, room.id);
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [{ ...AGENT_A, status: "busy" }] });

    await login();

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`${AGENT_A.name} → ${room.displayName}: permit`))).toBeTruthy();
    });
  });

  it("queues a request toast when the agent has no capability yet, and Grant resolves it", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [{ ...AGENT_A, status: "busy" }] });

    await login();

    const room = agentAssignedRoom(AGENT_A.id, AGENT_A.ownerId);
    const toastText = await screen.findByText(new RegExp(`wants access to ${room.displayName}`));
    expect(toastText).toBeTruthy();

    fireEvent.click(screen.getByText("Grant"));
    await waitFor(() => {
      expect(screen.queryByText(new RegExp(`wants access to ${room.displayName}`))).toBeNull();
    });
  });
});
```

Run: `npm test --workspace apps/web -- WorldView`
Expected: FAIL (current `WorldView.tsx` still imports the deleted `beginMoveToRoom`, `RoomId`, and calls `getCapability`/`issueCapability`/`revokeCapability` with the old one-argument shape).

- [ ] **Step 2: Rewrite `WorldView.tsx`**

Replace the full contents of `apps/web/src/world/WorldView.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { api, setSessionToken } from "../api";
import type { Agent, AgentRun, HumanPrincipal, Message, PolicyRequestLike } from "../types";
import { beginHeadingToDesk, endWorking, spawnWorldAgents } from "./agentSim";
import {
  decideRoomEntry,
  getCapability,
  grantedRoomsFor,
  issueCapability,
  newId,
  revokeCapability,
} from "./decision";
import { WorldCanvas } from "./WorldCanvas";
import { loadWorldMap } from "./engineMap";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import type { AccessRequest } from "./requests";
import { hasPendingRequest, pendingRequestsFor, queueRequest, resolveRequest } from "./requests";
import { roomById } from "./resources";
import type { DecisionEvent, WorldAgent } from "./types";

const TEST_USERS = [
  { userId: "user-a", password: "demo-a", label: "Log in as User A" },
  { userId: "user-b", password: "demo-b", label: "Log in as User B" },
];

const AGENT_POLL_MS = 3000;

export function WorldView() {
  const [principal, setPrincipal] = useState<HumanPrincipal | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [worldAgents, setWorldAgents] = useState<WorldAgent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<DecisionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapRenderer, setMapRenderer] = useState<TiledMapRenderer | null>(null);
  const [, setRequestVersion] = useState(0);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const worldAgentsRef = useRef<WorldAgent[]>([]);
  worldAgentsRef.current = worldAgents;

  useEffect(() => {
    let cancelled = false;
    loadWorldMap()
      .then((renderer) => {
        if (!cancelled) setMapRenderer(renderer);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            "Failed to load the world map" + (err instanceof Error ? `: ${err.message}` : ""),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (userId: string, password: string) => {
    if (!mapRenderer) {
      setError("World map is still loading — try again in a moment.");
      return;
    }
    try {
      const result = await api.login(userId, password);
      setSessionToken(result.sessionToken);
      setPrincipal(result.principal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }, [mapRenderer]);

  // Poll every agent's real status — this is what drives task-visits: an
  // agent only walks to its desk (or triggers a request) when its real
  // backend status flips to "busy".
  useEffect(() => {
    if (!principal) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { agents: nextAgents } = await api.listAgents();
        if (!cancelled) setAgents(nextAgents);
      } catch {
        // transient poll failure; try again next interval
      }
    };
    poll();
    const interval = setInterval(poll, AGENT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [principal]);

  // Keep worldAgents in sync with the polled roster: spawn newcomers,
  // drop agents that disappeared, leave everyone else's position/behavior
  // untouched (a naive full respawn every poll would visibly reset
  // everyone's position every 3s).
  useEffect(() => {
    if (!mapRenderer) return;
    setWorldAgents((current) => {
      const currentIds = new Set(current.map((wa) => wa.agentId));
      const nextIds = new Set(agents.map((a) => a.id));
      const kept = current.filter((wa) => nextIds.has(wa.agentId));
      const newAgents = agents.filter((a) => !currentIds.has(a.id));
      if (newAgents.length === 0) return kept.length === current.length ? current : kept;
      return [...kept, ...spawnWorldAgents(newAgents, mapRenderer)];
    });
  }, [agents, mapRenderer]);

  // The task-visit orchestration: for every agent that's really busy and
  // still just roaming, ask the seam whether it may enter its assigned
  // room. Permit -> walk to a desk. Deny -> queue an access request; the
  // agent's movement is left completely alone either way (spec §4 — "same
  // animation is kept"). For agents that stopped being busy while working,
  // release the desk back to roaming.
  useEffect(() => {
    if (!mapRenderer) return;
    let cancelled = false;

    (async () => {
      for (const agent of agents) {
        if (cancelled) return;
        const worldAgent = worldAgentsRef.current.find((wa) => wa.agentId === agent.id);
        if (!worldAgent || !worldAgent.assignedRoomId) continue;

        const isBusy = agent.status === "busy";
        if (isBusy && worldAgent.behaviorMode === "roaming") {
          if (hasPendingRequest(agent.id, worldAgent.assignedRoomId)) continue;
          const room = roomById(worldAgent.assignedRoomId);
          const requestId = newId();
          const request: PolicyRequestLike = {
            principal: {
              kind: "agent",
              id: "agent-principal-" + agent.id,
              agentId: agent.id,
              ownerId: agent.ownerId,
            },
            action: "enter",
            resource: room.id,
            capability: getCapability(agent.id, room.id),
            requestId,
          };
          const decision = await decideRoomEntry(request);
          if (cancelled) return;

          setEvents((current) => [
            {
              requestId,
              agentId: agent.id,
              agentName: agent.name,
              room: room.id,
              effect: decision.effect,
              reason: decision.reason,
              decidedAt: decision.decidedAt,
            },
            ...current,
          ]);

          if (decision.effect === "permit") {
            const occupied = new Set(
              worldAgentsRef.current.filter((wa) => wa.occupiedDeskId).map((wa) => wa.occupiedDeskId!),
            );
            setWorldAgents((current) =>
              current.map((wa) =>
                wa.agentId === agent.id ? beginHeadingToDesk(wa, room, occupied, mapRenderer) ?? wa : wa,
              ),
            );
          } else {
            queueRequest({
              agentId: agent.id,
              agentName: agent.name,
              roomId: room.id,
              roomOwnerId: room.ownerId!,
            });
            setRequestVersion((v) => v + 1);
          }
        } else if (!isBusy && worldAgent.behaviorMode === "working") {
          setWorldAgents((current) =>
            current.map((wa) => (wa.agentId === agent.id ? endWorking(wa) : wa)),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agents, mapRenderer]);

  useEffect(() => {
    if (!selectedId) {
      setRuns([]);
      setMessages([]);
      return;
    }
    api
      .runs(selectedId)
      .then((result) => {
        if (selectedIdRef.current === selectedId) setRuns(result.runs);
      })
      .catch(() => {});
    api
      .messages(selectedId)
      .then((result) => {
        if (selectedIdRef.current === selectedId) setMessages(result.messages);
      })
      .catch(() => {});
  }, [selectedId]);

  const grantRequest = useCallback((request: AccessRequest) => {
    issueCapability(request.agentId, request.roomId);
    resolveRequest(request.id);
    setRequestVersion((v) => v + 1);
  }, []);

  const denyRequest = useCallback((request: AccessRequest) => {
    resolveRequest(request.id);
    setRequestVersion((v) => v + 1);
  }, []);

  const revokeRoom = useCallback((agentId: string, roomId: string) => {
    revokeCapability(agentId, roomId);
    setRequestVersion((v) => v + 1);
  }, []);

  if (!principal) {
    return (
      <div className="world-login">
        <div className="world-title-box">
          <p className="world-eyebrow">SIGN IN</p>
          <h2 className="world-title">Agent Pixel World</h2>
          <p className="world-subtitle">log in to grant or receive access requests for your rooms</p>
        </div>
        <div className="world-select-grid">
          {TEST_USERS.map((user, index) => (
            <button
              key={user.userId}
              className={"world-select-card " + (index === 0 ? "world-select-card-a" : "world-select-card-b")}
              onClick={() => login(user.userId, user.password)}
              disabled={!mapRenderer}
            >
              <span className="world-select-portrait" aria-hidden="true">
                <span className="world-select-eye" />
                <span className="world-select-eye" />
                <span className="world-select-mouth" />
              </span>
              <span className="world-select-label">{user.label}</span>
              <span className="world-select-cursor" aria-hidden="true">
                ►
              </span>
            </button>
          ))}
        </div>
        {error && <p className="world-title-error">▋ {error}</p>}
      </div>
    );
  }

  const selectedAgent = agents.find((agent) => agent.id === selectedId) ?? null;
  const selectedWorldAgent = worldAgents.find((wa) => wa.agentId === selectedId) ?? null;
  const selectedRoom = selectedWorldAgent?.assignedRoomId ? roomById(selectedWorldAgent.assignedRoomId) : null;
  const selectedGrantedRooms = selectedAgent ? grantedRoomsFor(selectedAgent.id) : [];
  const activeRun = runs.find((run) => run.status === "running" || run.status === "queued") ?? null;
  const myRequests = pendingRequestsFor(principal.id);

  return (
    <div className="world-layout">
      <div className="world-canvas-wrap">
        <WorldCanvas agents={worldAgents} onFrame={setWorldAgents} />
      </div>
      <aside className="world-panel">
        <h3>{principal.displayName}</h3>
        {selectedAgent ? (
          <div className="world-detail-panel">
            <h4>{selectedAgent.name}</h4>
            <p className="world-detail-role">
              {selectedRoom ? `Works on: ${selectedRoom.displayName}` : "No assigned room"}
            </p>
            <p className="world-detail-task">
              {selectedAgent.status === "busy" && activeRun ? activeRun.prompt : "Idle"}
            </p>
            <h5>Granted rooms</h5>
            {selectedGrantedRooms.length === 0 ? (
              <p className="world-detail-empty">None yet</p>
            ) : (
              <ul className="world-granted-rooms">
                {selectedGrantedRooms.map((roomId) => (
                  <li key={roomId}>
                    {roomById(roomId).displayName}
                    <button onClick={() => revokeRoom(selectedAgent.id, roomId)}>Revoke</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="world-detail-empty">Select an agent below</p>
        )}
        <section>
          <h4>Security log</h4>
          <ul>
            {events.map((event) => (
              <li key={event.requestId} className={"effect-" + event.effect}>
                {event.agentName} → {roomById(event.room).displayName}: {event.effect} ({event.reason})
              </li>
            ))}
          </ul>
        </section>
      </aside>
      <div className="world-request-toasts">
        {myRequests.map((request) => (
          <div key={request.id} className="world-request-toast">
            <p>
              {request.agentName} wants access to {roomById(request.roomId).displayName}
            </p>
            <div className="world-request-actions">
              <button onClick={() => grantRequest(request)}>Grant</button>
              <button onClick={() => denyRequest(request)}>Deny</button>
            </div>
          </div>
        ))}
      </div>
      <div className="world-agent-strip">
        {agents.map((agent) => {
          const worldAgent = worldAgents.find((wa) => wa.agentId === agent.id);
          const modeLabel =
            worldAgent?.behaviorMode === "working"
              ? "working"
              : worldAgent?.behaviorMode === "heading-to-desk"
                ? "heading to desk"
                : "roaming";
          return (
            <button
              key={agent.id}
              className={"world-agent-card " + (agent.id === selectedId ? "selected" : "")}
              onClick={() => setSelectedId(agent.id)}
            >
              <span className="world-agent-avatar" aria-hidden="true">
                {agent.name.charAt(0)}
              </span>
              <span className="world-agent-name">{agent.name}</span>
              <span className="world-agent-status-pill">{modeLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run the tests**

Run: `npm test --workspace apps/web -- WorldView`
Expected: 3 passed.

- [ ] **Step 4: Run the full suite**

Run: `npm test --workspace apps/web`
Expected: all tests pass, including `App.test.tsx` — it mounts `WorldView` via the "World" nav toggle, and already mocks `pixi.js` from the prior plan. Read `apps/web/src/App.test.tsx` first: if it does NOT already mock `./world/engineMap` (check for a `vi.mock("./world/engineMap", ...)` block), add one matching this task's `WorldView.test.tsx` mock (same structure, adjust the relative import path — `App.test.tsx` lives one directory up from `world/`, so the mock target is `"./world/engineMap"` and the dynamic imports inside it become `"./world/engine/TiledMapRenderer"` and `"./world/resources"`). If it already has a working mock from the prior plan, leave it — just confirm it still passes with the new `WorldView.tsx`.

- [ ] **Step 5: Typecheck**

Run: `npm run --workspace apps/web typecheck`
Expected: no errors — this is the last task in the plan with pending cross-task fixes, so the project must be fully clean from here on.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/world/WorldView.tsx apps/web/src/world/WorldView.test.tsx apps/web/src/App.test.tsx
git commit -m "feat(world): poll agent status, orchestrate task-visits, rebuild the roster UI"
```

(Include `apps/web/src/App.test.tsx` in the commit only if Step 4 required changing it.)

---

### Task 8: `styles.css` — bottom agent strip, detail panel, request toasts

**Files:**
- Modify: `apps/web/src/styles.css`

**Interfaces:** none (pure styling; every class name below is already emitted by Task 7's JSX — `world-canvas-wrap`, `world-detail-panel`, `world-detail-role`, `world-detail-task`, `world-detail-empty`, `world-granted-rooms`, `world-request-toasts`, `world-request-toast`, `world-request-actions`, `world-agent-strip`, `world-agent-card`, `world-agent-avatar`, `world-agent-name`, `world-agent-status-pill`).

- [ ] **Step 1: Update `.world-layout` for the new bottom strip and wider canvas**

The existing `.world-layout` (`apps/web/src/styles.css`, currently around line 1345) is a 2-column grid (`auto 320px`) sized for the old `704×416` canvas and sidebar-only panel. Replace its rule and the block immediately after it (the `@media (max-width: 900px)` block, `.world-canvas`, and `.world-panel` rules) with:

```css
.world-layout {
  flex: 1;
  display: grid;
  grid-template-columns: auto 320px;
  grid-template-rows: auto auto;
  gap: 16px;
  padding: 16px;
  position: relative;
}

@media (max-width: 1200px) {
  .world-layout {
    grid-template-columns: 1fr;
  }
}

.world-canvas-wrap {
  overflow-x: auto;
  max-width: 100%;
  grid-column: 1;
  grid-row: 1;
}

@media (max-width: 1200px) {
  .world-canvas-wrap {
    grid-column: 1;
  }
}

.world-canvas {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  /* keep the drawn pixel art crisp at its scaled-up display size */
  image-rendering: pixelated;
  display: block;
}

.world-panel {
  display: grid;
  gap: 16px;
  align-content: start;
  grid-column: 2;
  grid-row: 1;
}

@media (max-width: 1200px) {
  .world-panel {
    grid-column: 1;
    grid-row: 2;
  }
}

.world-agent-strip {
  grid-column: 1 / -1;
  grid-row: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

@media (max-width: 1200px) {
  .world-agent-strip {
    grid-row: 3;
  }
}
```

- [ ] **Step 2: Add the agent-card, detail-panel, and request-toast rules**

Find the existing `.world-roster,` / `.world-panel ul` and `.world-controls` rules (just after the block from Step 1) and add these new rules immediately after them, before `.effect-permit`:

```css
.world-agent-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  cursor: pointer;
  min-width: 96px;
}

.world-agent-card.selected {
  border-color: var(--pw-a, #ff6b5e);
  border-width: 2px;
}

.world-agent-avatar {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--line);
  font-weight: 700;
}

.world-agent-name {
  font-size: 0.9em;
  font-weight: 600;
}

.world-agent-status-pill {
  font-size: 0.75em;
  color: var(--muted, #666);
  text-transform: uppercase;
}

.world-detail-panel {
  display: grid;
  gap: 6px;
}

.world-detail-role,
.world-detail-task {
  margin: 0;
}

.world-detail-empty {
  color: var(--muted, #666);
  font-style: italic;
}

.world-granted-rooms {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 6px;
}

.world-granted-rooms li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.world-request-toasts {
  position: absolute;
  top: 16px;
  right: 16px;
  display: grid;
  gap: 8px;
  max-width: 280px;
  z-index: 10;
}

.world-request-toast {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.world-request-toast p {
  margin: 0 0 8px;
}

.world-request-actions {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 3: Manual visual check**

Run `npm run dev`, log in as User A, and confirm: the canvas is scrollable rather than overflowing the page if the window is narrower than ~1470px; the bottom strip shows every agent (both owners); clicking a card shows the detail panel; the request-toast area sits in the top-right corner without shifting the rest of the layout when a toast appears. Fix any visibly broken spacing before moving on — this step has no automated test, it's a real look.

- [ ] **Step 4: Full suite + typecheck one more time, then commit**

Run: `npm run --workspace apps/web typecheck && npm test --workspace apps/web`
Expected: all green (CSS changes don't affect either, this just confirms nothing else drifted).

```bash
git add apps/web/src/styles.css
git commit -m "style(world): bottom agent strip, detail panel, request toasts"
```

---

### Task 9: Manual verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full test suite + typecheck, clean tree**

Run: `npm run --workspace apps/web typecheck && npm test --workspace apps/web`
Expected: all green.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev` (repo root)
Expected: Vite dev server starts.

- [ ] **Step 3: Trigger a real busy status and watch the full flow**

The demo needs a real agent to actually go `"busy"` to see anything move beyond idle roaming. From the Dashboard view, start a run on an existing agent (or create one first) — while it's running, its `status` becomes `"busy"`, which the World view's poll picks up within `AGENT_POLL_MS` (3s).

Via Playwright MCP tools: log in to the World view as whichever user owns that agent, confirm agents are wandering the hallway/common rooms on their own (Brownian-ish, not razor-straight lines, never crossing into a file-room's interior on their own). Start a run on the busy agent's underlying `Agent` from the Dashboard, switch back to World, and within a few seconds confirm one of:
- **No capability yet:** a request toast appears in the top-right ("`<agent>` wants access to `<room>`"). Click Grant — the toast disappears, and the agent (on its next detected busy-and-roaming tick, which may already have passed — re-trigger a new run if needed) walks to a free desk and plays the "type" animation while busy.
- **Already granted** (grant it once, then start a second run): the agent walks straight to its desk with no toast at all.

Click the agent's card in the bottom strip; confirm the detail panel shows its assigned room, its current task (the real run prompt), and its granted-rooms list with a working Revoke button.

Check `browser_console_messages` after each step for errors.

- [ ] **Step 4: Report findings, fix any real bugs found, re-verify**

If the manual pass surfaces a bug, fix it directly (this task has no dedicated files of its own — any fix belongs to whichever task's files it touches) and re-run Steps 1-3 until clean.

---

## Self-review notes (already applied above; kept here as the record this skill's Self-Review step requires)

- **Spec coverage:** §3 (resource/capability model) → Tasks 1, 3. §4 (roam + task-visit behavior) → Task 5, wired into rendering by Task 6. §5 (request flow) → Task 4, orchestrated by Task 7. §6 (map/visual scope, exact room table) → Task 2. §7 (UI) → Tasks 7-8. §8 (testing approach) → each task's own test file, matching the spec's per-module breakdown exactly. §9 (explicitly deferred: real per-file data, cooldown/permanent-deny state, multi-desk visual variety, login-copy polish beyond the one line already changed) — none of these have a task, correctly, since they're out of scope by the spec's own words.
- **Placeholder scan:** no TBD/TODO; every step carries real code, a real command, or (Task 8 Step 3, Task 9) an explicit manual-check procedure with a stated expected outcome.
- **Type consistency:** `WorldAgent`'s new shape (Task 5) is used identically in Task 6 (`WorldCanvas.tsx`, reading `behaviorMode`/`progress`/`facing`) and Task 7 (`WorldView.tsx`, reading `behaviorMode`/`assignedRoomId`/`occupiedDeskId`) — no field name drifts between them. `FileRoom` (Task 1) is consumed with the same field names (`id`, `displayName`, `ownerId`, `requiresPermission`, `deskIds`) everywhere it's used (Tasks 3, 5, 7). Capability functions' `(agentId, roomId)` argument order (Task 3) matches every call site (Tasks 5's tests, Task 7). `AccessRequest`'s field names (Task 4) match Task 7's toast rendering exactly (`agentName`, `roomId`, `roomOwnerId`).
