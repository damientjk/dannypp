# Room Theming & Enlargement — Design

Status: Approved by user, pending spec review. Extends
`2026-08-28-agent-pixel-world-design.md` (the base pixel-world view) and
`2026-08-28-agent-world-autonomy-and-permissions-design.md` (room/permission
model) — neither is superseded, this only changes what's rendered inside
each room and how big the rooms are.

## 1. Purpose

The world's 6 rooms (`apps/web/src/world/resources.ts`'s `FILE_ROOMS`) are
currently flat-colored boxes (literal solid-color 32×32 swatches, gid 0-7 in
`tileset.png`) with two generic desk icons each. This spec replaces that with
6 distinctly themed rooms built from the `moderninteriors-win` asset pack
(LimeZu "Modern Interiors"), enlarges every room, and replaces the
desk-and-monitor "office" visual with theme-appropriate equipment an agent
visibly operates while `behaviorMode === "working"`.

Themes (one per room, deliberately close in register — no shooting-range/
TV-studio-style clash): **Library, Sports, Japanese, Gym, Music**, and the
existing **Living Room** kept as-is thematically, all read as rooms in one
shared clubhouse.

## 2. Scope & non-goals

In scope: room floor/wall textures, room dimensions, furniture/decor
placement, one new small "equipment animates while occupied" rendering
capability, the asset files that back all of that.

Out of scope / explicitly not touched:

- `agentSim.ts`, `decision.ts` — no change to who can enter which room, how
  desks are claimed, or the `working`/`heading-to-desk`/`roaming`
  `behaviorMode` state machine itself.
- Desk spawn-point IDs (`desk-<room>-1/2`) and `FileRoom.deskIds` /
  `WorldAgent.occupiedDeskId` — kept exactly as named today. Renaming them to
  something like `equipment-*` would ripple through `resources.ts`,
  `map.json`, `agentSim.ts`, and their tests for zero visual gain, since the
  ID is invisible to the user — only what's drawn at that spawn point
  changes.
- The character sprite/animation system (`CharacterSprite.ts`,
  `engineCharacter.ts`). Per that file's own comment, only one real character
  frame exists today (an idle-down placeholder reused for every direction and
  `AnimState`); building custom per-theme character animations (a punching
  pose, a piano-playing pose, ...) would be a real animation-art project this
  pack doesn't supply assets for. "The agent is working" reads through the
  **equipment** animating, not the character.
- Canvas pixel size / retina-scaling plumbing (`WorldCanvas.tsx`'s
  `app.init` resolution/`autoDensity` handling, fixed just before this spec)
  and the `1120px` grid column in `styles.css` — the whole design fits inside
  the existing 1120×640 canvas by reallocating space, not growing it.

## 3. Canvas & room sizing

Current layout (`apps/web/public/world-assets/map.json`): 35×20 tiles
(1120×640px). 6 rooms in a 3×2 grid, each a 7×5 zone, separated by
oversized corridors (6-8 tiles — wider than needed for simple BFS
pathfinding with no agent-to-agent collision, confirmed in
`engine/pathfinding.ts`).

New layout, same 35×20 canvas, corridors cut to 2 tiles (still walkable —
nothing in `pathfinding.ts`/`agentSim.ts` requires wider) and that space
handed to the rooms:

- Width: margin(1) + col(10) + corridor(2) + col(9) + corridor(2) +
  col(10) + margin(1) = 35
- Height: margin(1) + row(8) + corridor(2) + row(8) + margin(1) = 20

Left/right column rooms become **10×8** tiles, the center column **9×8**
(a 1-tile width difference between columns, invisible at 32px/tile — not
worth uneven margins to avoid). That's 80 / 72 tiles versus the original 35
— roughly **2.1-2.3x** the floor area.

Zone table (tile coordinates, matches the `zones` objectgroup shape already
in `map.json`):

| Room | x | y | w | h |
|---|---|---|---|---|
| Auth Module (Library) | 1 | 1 | 10 | 8 |
| Analytics (Sports Den) | 13 | 1 | 9 | 8 |
| Database (Japanese Room) | 24 | 1 | 10 | 8 |
| Billing (Gym) | 1 | 11 | 10 | 8 |
| Living Room | 13 | 11 | 9 | 8 |
| Deploy Config (Music Room) | 24 | 11 | 10 | 8 |

Door spawn points move to each zone's south-wall midpoint:
`(zoneX + floor(w/2), zoneY + h)` — e.g. `auth-module-door` becomes
`(6, 9)`. Exact interior work-spot/decor tile coordinates inside each room
are pinned during implementation against the layout diagrams in §6, not
hand-computed here.

## 4. Rendering approach: freeform decor layer

Three options were considered for placing furniture:

1. **New freeform decor layer (chosen).** A small list of
   `{ image, x, y }` (pixel coordinates, not tile-grid-locked) rendered as
   plain `Sprite`s in a new container above the existing tile layers —
   sourced directly from `Theme_Sorter_Singles_32x32/<category>/*.png`,
   which are already individually cropped to each item's own bounding box.
   Floors and walls stay on the existing Tiled GID tile-layer system, fed by
   a new small tileset PNG assembled from a handful of rows sliced out of
   `Room_Builder_Floors_32x32.png` (480×1280, 15×40 grid) and
   `Room_Builder_Walls_32x32.png` (1024×1280, 32×40 grid) — those are
   already neatly gridded at 32×32, so slicing them the same way
   `tileset.png` is built today is cheap.
2. **Bake everything into the GID tile grid, no renderer changes.**
   Rejected: it would require manually locating and recording every
   furniture item's sub-cell coordinates inside `Interiors_32x32.png`, a
   512×34048px (16×1064-tile) mega-atlas with no index. The pre-cropped
   Singles files exist specifically to avoid this.
3. **True Tiled tile-objects** (arbitrary-size object references instead of
   decomposed grid cells). Rejected as solving a problem this project
   doesn't have — nothing here is hand-authored in Tiled's editor.

`TiledMapRenderer.ts` gains one small addition: a method that takes a list
of decor entries and adds them as sprites to a new container, positioned in
pixel space and layered between `furniture-below` and `furniture-above` (or
above both, per item — a wall-mounted piece like a bookshelf should draw
under a character walking in front of it; a floor piece like a yoga mat can
sit on `furniture-below`). No change to `gidAt`, `textureForGid`, or the
existing tile-layer loop.

## 5. Equipment "working" animation

Each gated room's two desk spawn points keep their existing IDs and their
existing role in `agentSim.ts` (an agent claims one, walks to it, sets
`behaviorMode: "working"`). What's drawn there changes: instead of a
desk+monitor, each work-spot gets a themed **animated equipment sprite**,
using the spritesheets already shipped in
`moderninteriors-win/3_Animated_objects/32x32/spritesheets/` (the matching
`.gif` files are just previews — Pixi drives the loop itself from the PNG
strip, the same way `CharacterSprite` already builds an `AnimatedSprite`
from a frame grid).

Mechanism: an equipment sprite sits on its first frame (idle/off) when its
work-spot is unoccupied, and plays its loop while an agent is parked there
with `behaviorMode === "working"` — a `.play()`/`.gotoAndStop(0)` toggle
checked in the same per-frame loop in `WorldCanvas.tsx` that already updates
each agent's sprite animation and tint every tick. No new game-loop
infrastructure, just one more thing that loop touches per frame.

Confirmed available equipment (all `32x32/spritesheets/`, verified by
opening each file):

- `animated_punching_bag_left_32x32.png` — Gym
- `animated_treadmill_32x32.png` — Gym
- `animated_wall_piano_32x32.png` — Music
- `animated_amplifier_32x32.png` — Music
- `animated_TV_reportage_32x32.png` — Sports
- `animated_incense_burner_4_10_loop_32x32.png` — Japanese

**Known gap:** no plain reading/book animation exists in the pack (only
Halloween-flavored `haunted_bookcase` / `spell_book`, which would clash with
the other rooms' grounded look). The Library room's two work-spots stay
static furniture; the agent uses the existing `read` `AnimState` (already
defined in `CharacterSprite.ts`, currently rendering the same placeholder
frame as everything else — this is consistent with, not a regression from,
the current all-placeholder character animation state). A flickering
`animated_wall_candle_32x32.png` near the door adds ambient motion to the
room without pretending it's the work animation.

## 6. Room-by-room layout

Grid legend: `#` wall, `.` floor, `D` door gap. Diagrams are drawn at each
room's real §3 dimensions (10×8 for Auth Module/Database/Billing/Deploy
Config, 9×8 for Analytics/Living Room) — one character per tile, so column
count and door position match the zone table exactly. Which item goes in
which exact cell is still an implementation call; what's fixed here is the
placement *logic*: equipment against the back wall, seating facing it,
decor flanking the door, an open lane down the middle.

### Auth Module → Library / Study (10×8)
Quiet, guarded-archive register. Floor: warm wood
(`Room_Builder_Floors`). Wall trim: deep green/burgundy accent.
```
##########
#BB....BB#   B = wall-lined bookshelf (Classroom_and_Library singles)
#B......B#
#..R..R..#   R = reading desk, work-spot ×2 (static; agent plays `read`)
#..C..C..#   C = chair
#........#
#.L....L.#   L = potted plant
#####D####
```

### Analytics → Sports Den (9×8)
TV plays game reportage — agent "reviewing footage" doubles as the
analytics wink. Floor: light hardwood/court-style.
```
#########
#T.....T#   T = trophy shelf (Music_and_Sport singles)
#..S....#   S = TV, animated_TV_reportage, work-spot 1
#..C....#   C = seat facing screen
#.....PP#   PP = ping-pong table, work-spot 2 (Music_and_Sport singles)
#.......#
#.L...L.#   L = pennant / plant stand
####D####
```

### Database → Japanese Room (10×8)
Calm, structured — tatami's grid is a light nod to rows/columns, not
leaned on hard. Floor: tatami mat. Wall: shoji panel texture.
```
##########
#WW....WW#   W = shoji screen wall decor (Japanese_Interiors singles)
#........#
#..I..K..#   I = incense burner, animated, work-spot 1; K = chabudai table, work-spot 2
#..C..C..#   C = floor cushion
#........#
#.L....L.#   L = bonsai
#####D####
```

### Billing → Gym (10×8)
Directly under the Library — deliberate calm/energetic contrast down that
column. Floor: dark rubber gym flooring.
```
##########
#mm....mm#   m = wall mirror (Gym singles)
#........#
#..P..T..#   P = punching bag, animated, work-spot 1; T = treadmill, animated, work-spot 2
#.d....y.#   d = dumbbell rack, y = yoga mat
#........#
#........#
#####D####
```

### Deploy Config → Music Room (10×8)
Under the zen Database room — same calm/lively contrast on the right
column. Floor: dark parquet.
```
##########
#.M......#   M = wall piano, animated, work-spot 1
#........#
#.....A..#   A = amplifier, animated, work-spot 2
#..r....r#   r = stool / record crate (Music_and_Sport singles)
#........#
#.L....L.#
#####D####
```

### Living Room (9×8, unprotected, no desks — stays that way)
Floor: rug-over-wood. No equipment — purely a decorative common lounge,
matching its existing `requiresPermission: false, deskIds: []`.
```
#########
#.......#
#..SS...#   SS = TV on stand (Living_Room singles)
#..CC...#   sofa facing it
#....rr.#   coffee table + rug
#.......#
#.L...L.#   L = plant
####D####
```

## 7. Asset pipeline

New files copied (not symlinked — this repo already vendors
`moderninteriors-win` as loose source assets, not a package dependency) into
`apps/web/public/world-assets/`:

- `tileset.png` extended (or a new `tileset-rooms.png` alongside it,
  referenced as a second entry in `map.json`'s `tilesets` array, which
  `TiledMapRenderer` already supports via `tilesetTextures: Texture[]`) with
  one floor + one wall row per theme, sliced from
  `Room_Builder_Floors_32x32.png` / `Room_Builder_Walls_32x32.png`.
- `decor/<theme>/*.png` — the individual Singles PNGs picked per room in
  §6, copied as-is (each already trimmed, a few KB apiece).
- `equipment/*.png` — the 6 animated spritesheets listed in §5, copied
  as-is.
- A small decor manifest (JSON or a TS const, matching the existing
  `map.json` fetch pattern in `engineMap.ts`) mapping each room ID to its
  list of `{ image, x, y }` decor entries and its equipment work-spot
  bindings.

Total added asset weight is small — a few dozen already-cropped PNGs, no
new build tooling, no image processing pipeline (cropping is a one-time
manual/scripted step against files already in the repo).

## 8. Testing / verification

Per `2026-08-28-agent-pixel-world-design.md` §7's precedent (light touch —
this is a visual view, not decision logic):

- Extend `TiledMapRenderer`'s existing tests with one case covering the new
  decor-layer method (a list of entries in, sprites at the right pixel
  positions out).
- Extend `WorldCanvas.test.tsx` / `engineMap.test.ts` fixtures for the new
  35×20 zone coordinates so `isGatedTile` and door/spawn lookups keep
  passing at the new room sizes.
- No pixel-diff / visual-regression testing — verified by running the app
  and looking at it (per repo convention: "For UI or frontend changes,
  start the dev server ... before reporting the task as complete").

## 9. Deferred / follow-up

- Exact tile coordinates for every decor item and floor/wall tile run
  (§6's diagrams are placement *logic*, pinned to real coordinates during
  implementation).
- Which specific numbered Singles file becomes "the bookshelf" / "the
  mirror" / etc. — the Singles folders are unlabeled (just sequential
  numbers), so this requires opening candidates visually during
  implementation, not guessable from filenames alone.
- Any richer equipment-interaction feedback (sound, particle effects) —
  not requested, not in scope.
- Renaming `desk-*` spawn IDs / `deskIds` / `occupiedDeskId` to something
  equipment-flavored — deliberately rejected in §2, noted here in case it's
  revisited later as a pure naming pass.
