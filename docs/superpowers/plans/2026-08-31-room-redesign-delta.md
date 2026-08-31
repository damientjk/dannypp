# Room Redesign Delta — Mockup-Driven Furniture Pass

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** This branch (`room-theming-world`) already has a complete, committed room-theming implementation (`2026-08-29-room-theming.md`, all 13 tasks) plus a follow-on 3D-wall-rendering pass (`2026-08-30-3d-walls.md`). The user has since provided hand-drawn color-coded mockups for 5 of the 6 rooms specifying a *different* furniture layout than what's currently built. This plan replaces the `DECOR`/`AMBIENT` content for those 5 rooms in place — it does not touch the underlying infrastructure (`EquipmentSprite`, `TiledMapRenderer.addDecorLayer`, `roomDecor.ts`, `WorldCanvas.tsx`, the wall-border/wall-shade system) or the Database/Japanese room, which the user explicitly confirmed stays exactly as built.

**Context you need that isn't in this file's tasks:**
- `apps/web/scripts/room_layout.py` defines `ROOMS`, `DESKS`, `EQUIPMENT`, `DECOR`, `AMBIENT`, `CAP_H=1`, `room_y0()`. Interior tiles are col 0-8 / row 0-5. **Every room's interior row 0 is the side with the tall, capped wall** (2 tiles visually tall: a cap row + the wall-ring row, both above the interior) — for top-row rooms (auth-module, analytics) that's the back wall opposite the door; for bottom-row rooms (billing, living-room, deploy-config) that's the *door*-facing wall, not the back wall. Row 5 is always the plain, flat, non-capped wall.
- `apps/web/scripts/generate-room-decor.py`'s `copy_asset(src_rel, dest_rel, crop=None)` copies/crops a file from `moderninteriors-win/` into `public/world-assets/`. Task 1 below adds a `scale` parameter to it.
- Four assets the user isolated by hand live at the **repo root** (sibling to `moderninteriors-win/`, NOT inside it), cropped from the pack's 48px-per-tile sheets instead of its native 32px tier: `bookshelf/`, `sofa/`, `drums/`, `gym bicycle/`. These need the new `scale=2/3` path through `copy_asset`.
- **Wall-covering effect:** the user pointed at a screenshot of the current (soon-to-be-replaced) Auth Module and asked that furniture placed against a room's tall/capped wall visually *cover* it (overlap the wall graphic), not sit flush below it, for a 3D layered look. Mechanically: `generate-room-decor.py`'s `main()` emits each room's `wall-shade.png`/`wall-border.png` *before* its `DECOR` items, and PIXI draws later-added children on top — so a `DECOR` item with a **negative row** (e.g. `row=-1`) draws its top portion over the wall graphic instead of starting flush at the floor line. This plan uses `row=-1` for every item placed against a row-0 tall wall; if it looks like too much or too little overlap once visible in the browser, nudge by ±1 and note the change in your report, don't treat it as a spec deviation.
- **Ruling (ball sprite):** no round ball/sports-ball sprite exists anywhere in `8_Gym_Singles_32x32` (9 candidate files individually checked at full resolution: kettlebells, dumbbells, weight plates, mats — no ball) or `6_Music_and_Sport_32x32` (checked earlier in this project). Task 3 drops the "balls" decor item rather than substituting something that doesn't read as a ball.

## Global Constraints

- Do not modify `docs/superpowers/plans/2026-08-29-room-theming.md` or `2026-08-30-3d-walls.md` — they document already-shipped work.
- Do not modify `DECOR["database"]`, `EQUIPMENT`, `DESKS`, `ROOMS`, or any wall/floor/tileset code — only the five `DECOR[...]` lists named below, `AMBIENT`, and `copy_asset`'s signature.
- Every source reference outside the four user-supplied folders must be a real, filename-verified path under `moderninteriors-win/` — no `<placeholder>` files. If a task brief below still shows one, resolve it with `apps/web/scripts/asset_contact_sheet.py` against the named folder before writing the entry, confirmed by viewing the actual PNG (not just the contact-sheet thumbnail — this project has repeatedly been burned trusting low-res montages over the real file).
- After every task: `cd apps/web/scripts && py generate-room-decor.py`, then `cd apps/web && npm test` — both must pass before committing.

---

### Task 1: Add scale support to copy_asset, and REPO_ROOT to room_layout.py

**Files:**
- Modify: `apps/web/scripts/generate-room-decor.py`
- Modify: `apps/web/scripts/room_layout.py`

**Interfaces:**
- Produces: `copy_asset(src_rel: str, dest_rel: str, crop: tuple[int,int,int,int] | None = None, scale: float = 1.0) -> None`. Tasks 2 and 4-6 pass `scale=2/3` for the four user-supplied 48px-tier assets; every other existing call site is unaffected (default `scale=1.0` preserves current behavior exactly).
- Produces: a `REPO_ROOT` name importable from `room_layout` (or usable directly in its own `DECOR` literals — your call how you expose it, see Step 0). Tasks 2 and 4-6 write `DECOR` entries referencing `REPO_ROOT / "bookshelf" / "..."` etc. directly inside `room_layout.py`, so `REPO_ROOT` must resolve correctly from that file specifically (not borrowed from `generate-room-decor.py`, which is a different file with its own `__file__`).

- [ ] **Step 0: Add REPO_ROOT to room_layout.py**

`room_layout.py` currently has zero imports — it's pure data. Add, near the top of the file (before `TILE = 32`):

```python
from pathlib import Path

REPO_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "moderninteriors-win").is_dir())
```

This is the same resolution `generate-room-decor.py` and `generate-world-tileset.py` already use — matching it here means `room_layout.py` can reference `REPO_ROOT / "bookshelf" / "...png"` etc. directly inside its own `DECOR` dict literals in Tasks 2 and 4-6, rather than those tasks having to invent their own path-construction scheme.

- [ ] **Step 1: Extend copy_asset**

Replace the existing `copy_asset` (currently):
```python
def copy_asset(src_rel: str, dest_rel: str, crop: tuple[int, int, int, int] | None = None) -> None:
    src = MODERNINTERIORS / src_rel
    dest = WORLD_ASSETS / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if crop is None:
        shutil.copyfile(src, dest)
    else:
        Image.open(src).convert("RGBA").crop(crop).save(dest)
```
with:
```python
def copy_asset(
    src_rel: str, dest_rel: str,
    crop: tuple[int, int, int, int] | None = None, scale: float = 1.0,
) -> None:
    # src_rel may be an absolute Path (e.g. REPO_ROOT / "bookshelf" / "x.png")
    # for the four user-supplied crops living outside moderninteriors-win at
    # its 48px-per-tile scale -- pathlib's / operator returns an absolute RHS
    # unchanged, so MODERNINTERIORS / src_rel resolves correctly either way.
    src = MODERNINTERIORS / src_rel
    dest = WORLD_ASSETS / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if crop is None and scale == 1.0:
        shutil.copyfile(src, dest)
        return
    img = Image.open(src).convert("RGBA")
    if crop is not None:
        img = img.crop(crop)
    if scale != 1.0:
        w, h = img.size
        img = img.resize((round(w * scale), round(h * scale)), Image.NEAREST)
    img.save(dest)
```

Update the one call site inside `main()`'s `DECOR` loop from `copy_asset(item["src"], dest_rel, item.get("crop"))` to `copy_asset(item["src"], dest_rel, item.get("crop"), item.get("scale", 1.0))`.

- [ ] **Step 2: Verify nothing else broke**

Run: `cd apps/web/scripts && py -c "import room_layout; print(room_layout.REPO_ROOT)"` — expect it to print this repo's root path (the directory containing `moderninteriors-win/`), not an error. Then run `py generate-room-decor.py` — expect the same decor/equipment counts as before this change (this task doesn't touch any `DECOR` content yet, only adds an unused-so-far `REPO_ROOT` name and an unused-so-far `scale` parameter).

- [ ] **Step 3: Commit**

```bash
git add apps/web/scripts/generate-room-decor.py apps/web/scripts/room_layout.py
git commit -m "feat(world): add scale support to copy_asset and REPO_ROOT to room_layout"
```

---

### Task 2: Library — replace DECOR["auth-module"]

**Files:**
- Modify: `apps/web/scripts/room_layout.py`

**Interfaces:**
- Consumes: Task 1's `copy_asset` scale support.

**What's changing and why:** the current bookshelf (`bookshelf-left.png`/`bookshelf-right.png`, cropped from the composite sheet) is replaced with the user's own 2-piece isolated crop. The current `reading-desk-1`/`reading-desk-2` crops (from the same composite sheet, each already including an integrated bench seat) are kept as-is — they match the user's "tables w/ books" ask and there's no better alternative in the pack. Chairs are dropped (not part of the user's ask). Plant and the ambient candle are unchanged.

- [ ] **Step 1: Replace the DECOR entry**

Replace the current `"auth-module": [...]` block in `DECOR` with:

```python
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
        dict(col=3, row=2, dest="reading-desk-1.png",
             src="1_Interiors/32x32/Theme_Sorter_32x32/5_Classroom_and_library_32x32.png",
             crop=(160, 32, 192, 96)),
        dict(col=5, row=2, dest="reading-desk-2.png",
             src="1_Interiors/32x32/Theme_Sorter_32x32/5_Classroom_and_library_32x32.png",
             crop=(64, 32, 96, 96)),
        dict(col=1, row=4, dest="plant.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/2_Living_Room_Singles_32x32/Living_Room_Singles_32x32_16.png"),
    ],
```

`REPO_ROOT` is already defined near the top of `generate-room-decor.py` — this file (`room_layout.py`) needs `from pathlib import Path` and a matching `REPO_ROOT` if it doesn't already resolve one; check the top of the file first and reuse whatever's there rather than adding a second definition.

Do not touch `AMBIENT`'s existing `auth-module` candle entry.

- [ ] **Step 2: Regenerate and check**

```bash
cd apps/web/scripts
py generate-room-decor.py
ls ../public/world-assets/decor/auth-module/
```
Expected: 7 files (`bookshelf-left-a.png`, `bookshelf-left-b.png`, `bookshelf-right-a.png`, `bookshelf-right-b.png`, `reading-desk-1.png`, `reading-desk-2.png`, `plant.png`), each a real non-empty PNG. Open `bookshelf-left-a.png` and confirm it's ~64x96px (96x144 source × 2/3), not 96x144 (i.e. confirm the resize actually applied).

- [ ] **Step 3: Run the test suite**

Run: `cd apps/web && npm test` — expect all pass (no source files under test changed).

- [ ] **Step 4: Visual check**

Run: `cd apps/web && npm run dev`, open the World view, look at Auth Module. Expected: two bookshelf clusters whose tops overlap/cover the back wall (compare against the reference screenshot from this session), two reading-desk-with-book tables at the existing desk spots, a plant, candle flicker near the door. If the wall overlap looks off, adjust `row` by ±1 for the four bookshelf entries only and re-run Step 2.

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/room_layout.py apps/web/public/world-assets/room-decor.json apps/web/public/world-assets/decor/auth-module/
git commit -m "feat(world): re-furnish Auth Module library per the new mockup"
```

---

### Task 3: Sports Den — replace DECOR["analytics"]

**Files:**
- Modify: `apps/web/scripts/room_layout.py`

**What's changing and why:** drops the ping-pong table, seat, and pennant (not part of the user's ask: trophies / table-tennis-table / basketball hoop / balls); no ping-pong table exists anywhere in the pack either way (checked in the original 2026-08-29 design and reconfirmed this session). Adds a real basketball hoop. Balls are dropped per this plan's ruling above (no ball sprite exists). `desk-analytics-1` (interior `(3,2)`) becomes a plain, undecorated desk — same "not every desk needs a prop" pattern the current Library implementation already uses for its two reading desks. `desk-analytics-2` keeps its existing `EQUIPMENT`-bound animated TV, untouched.

- [ ] **Step 1: Replace the DECOR entry**

```python
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
```

Before writing this, verify `Music_and_Sport_Singles_32x32_147.png` (trophy) and `_76.png` (basketball hoop) actually look like a trophy and a basketball hoop respectively — both were confirmed at full resolution during this session's design pass, but confirm again since you're the one committing it.

- [ ] **Step 2: Regenerate and check**

```bash
cd apps/web/scripts
py generate-room-decor.py
ls ../public/world-assets/decor/analytics/
```
Expected: 4 files.

- [ ] **Step 3: Run the test suite**

Run: `cd apps/web && npm test` — expect all pass.

- [ ] **Step 4: Visual check**

Run: `cd apps/web && npm run dev`, look at Analytics. Expected: trophies + basketball hoop overlapping the back wall, desk-2 spot has the TV (animates when occupied), desk-1 is a plain desk, a plant. No ping-pong table, no balls.

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/room_layout.py apps/web/public/world-assets/room-decor.json apps/web/public/world-assets/decor/analytics/
git commit -m "feat(world): re-furnish Analytics sports den per the new mockup"
```

---

### Task 4: Gym — replace DECOR["billing"] and add a second treadmill

**Files:**
- Modify: `apps/web/scripts/room_layout.py`

**What's changing and why:** drops mirrors and the yoga mat (not part of the user's ask: punching bag / treadmills / dumbbell rack / black flooring / bicycle machines). No true black floor tile or bicycle-machine sprite exists anywhere in the pack (both confirmed absent this session, and the bike gap re-confirmed against the full 209-file `8_Gym_Singles_32x32` folder plus the complete animated-spritesheet list) — the user isolated their own 2-piece bike pick (two distinct machine designs, not a composite pair) from the pack's 48px-per-tile sheet. `EQUIPMENT`-bound punching bag (`desk-billing-1`) and treadmill (`desk-billing-2`) are untouched. Billing is a bottom-row room, so its capped tall wall is on the *door* side (row 0), and its flat back wall is row 5 — neither the dumbbell rack nor the bikes sit at row 0 in this design, so no wall-covering row offset applies here.

- [ ] **Step 1: Replace the DECOR entry**

```python
    "billing": [
        dict(col=1, row=1, dest="dumbbell-rack.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/8_Gym_Singles_32x32/Gym_Singles_32x32_167.png"),
        dict(col=1, row=5, dest="black-mat.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/8_Gym_Singles_32x32/Gym_Singles_32x32_195.png"),
        dict(col=6, row=1, dest="bike-1.png",
             src=REPO_ROOT / "gym bicycle" / "Gym_Singles_48x48_93.png", scale=2/3),
        dict(col=8, row=1, dest="bike-2.png",
             src=REPO_ROOT / "gym bicycle" / "Gym_Singles_48x48_94.png", scale=2/3),
    ],
```

`Gym_Singles_32x32_167.png` (dumbbell rack) and `_195.png` (a checkered foam mat, the flattest/darkest mat-like item in the folder — stand-in for "black flooring", since no true solid-black floor crop exists) are the current implementation's own already-verified picks for these exact concepts — reused here rather than re-searched, since the user's ask for these two items (dumbbell rack, a floor-mat treatment) didn't change, only the layout around them did. Verify both still look right before committing (open them directly).

- [ ] **Step 2: Append to AMBIENT**

Add one entry to the existing `AMBIENT` list (don't remove or duplicate the auth-module candle already there):

```python
    dict(room_id="billing", col=3, row=1, dest="animated_treadmill_2_32x32.png",
         src="3_Animated_objects/32x32/spritesheets/animated_treadmill_32x32.png", frames=3),
```

This is a second, always-animating treadmill (visual bulk, not gated on desk occupancy, unlike the `EQUIPMENT`-bound one at `desk-billing-2`) reusing the same sprite as the existing equipment-bound treadmill.

- [ ] **Step 3: Regenerate and check**

```bash
cd apps/web/scripts
py generate-room-decor.py
ls ../public/world-assets/decor/billing/
```
Expected: 4 decor files, plus confirm `animated_treadmill_2_32x32.png` now appears under `../public/world-assets/equipment/`.

- [ ] **Step 4: Run the test suite**

Run: `cd apps/web && npm test` — expect all pass.

- [ ] **Step 5: Visual check**

Run: `cd apps/web && npm run dev`, look at Billing. Expected: punching bag + treadmill mid-room (animate when occupied), a second always-animating treadmill near the door, dumbbell rack near the door, a dark mat patch on the back wall, two distinct bicycle machines.

- [ ] **Step 6: Commit**

```bash
git add apps/web/scripts/room_layout.py apps/web/public/world-assets/room-decor.json apps/web/public/world-assets/decor/billing/ apps/web/public/world-assets/equipment/animated_treadmill_2_32x32.png
git commit -m "feat(world): re-furnish Billing gym per the new mockup"
```

---

### Task 5: Game Room — replace DECOR["living-room"] (re-theme from plain living room)

**Files:**
- Modify: `apps/web/scripts/room_layout.py`

**What's changing and why:** this room is being re-themed entirely, from a plain living room (sofa, TV, coffee table, rug) into a game room (arcade machines, pool table, TV+console, sofa facing the TV). No pool table exists anywhere in the pack (checked `2_Living_Room_Singles_32x32`, `26_Condominium_Singles_32x32`, `14_Basement_Singles_32x32`, `13_Conference_Hall_Singles_32x32`, `23_Television_and_Film_Studio_SIngles_32x32`, `6_Music_and_Sport_32x32` — a 3rd arcade machine fills that spot instead. No true multi-seat sofa/couch exists anywhere either (same folders, plus a dimension-based scan of every multi-tile file in Basement) — the user isolated their own 3-piece modular sofa crop (left arm / middle / right arm) from the pack's 48px-per-tile sheet. Living-room is a bottom-row room with no desks and no `EQUIPMENT` entries — unaffected by this task.

- [ ] **Step 1: Replace the DECOR entry**

```python
    "living-room": [
        # row=-1: living-room is a bottom-row room, so row 0 is its capped
        # DOOR-facing wall (not the back wall) -- see this plan's
        # wall-covering note. Arcade machines line the entrance wall.
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
```

The sofa cluster (row 4, south of the TV at row 1) is meant to face north toward the TV. Verify visually in Step 4 — if the three segments look like they're facing the wrong way (backs to the TV instead of fronts), flip each with `img.transpose(Image.FLIP_TOP_BOTTOM)` right before the resize step in `copy_asset`, scoped to just these three entries (e.g. via a `flip` key checked the same way `crop`/`scale` are) — that's a visual-check fix to make now, not a re-plan.

- [ ] **Step 2: Regenerate and check**

```bash
cd apps/web/scripts
py generate-room-decor.py
ls ../public/world-assets/decor/living-room/
```
Expected: 7 files.

- [ ] **Step 3: Run the test suite**

Run: `cd apps/web && npm test` — expect all pass.

- [ ] **Step 4: Visual check**

Run: `cd apps/web && npm run dev`, look at the room labeled Living Room (still called that in code/UI — only its furniture theme changed, this task doesn't rename the room). Expected: 3 arcade machines overlapping the entrance wall, a TV+console cluster, a 3-segment sofa reading as one continuous couch facing the TV. Fix the sofa's facing direction here if needed (see Step 1's note).

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/room_layout.py apps/web/public/world-assets/room-decor.json apps/web/public/world-assets/decor/living-room/
git commit -m "feat(world): re-theme the Living Room as a game room per the new mockup"
```

---

### Task 6: Music Room — replace DECOR["deploy-config"]

**Files:**
- Modify: `apps/web/scripts/room_layout.py`

**What's changing and why:** drops crates/plants (not part of the user's ask: piano / speakers / guitars / drums). Piano stays exactly as already built — the user explicitly confirmed they want the interactive/animated wall piano (already `EQUIPMENT`-bound to `desk-deploy-config-1`) over a static freestanding one, so `EQUIPMENT` is untouched by this task. Adds real speakers and both guitar types (verified at full resolution this session). Drums are the user's own 2-piece isolated crop (kit body + hi-hat stand, red color variant) from the pack's 48px-per-tile sheet — no standalone multi-piece drum kit exists anywhere in the pack without a fused character sprite baked in (confirmed this session).

- [ ] **Step 1: Replace the DECOR entry**

```python
    "deploy-config": [
        dict(col=1, row=2, dest="speaker-1.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_34.png"),
        dict(col=7, row=2, dest="speaker-2.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_34.png"),
        dict(col=1, row=4, dest="guitar-electric.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_51.png"),
        dict(col=7, row=4, dest="guitar-acoustic.png",
             src="1_Interiors/32x32/Theme_Sorter_Singles_32x32/6_Music_and_Sport_32x32/Music_and_Sport_Singles_32x32_45.png"),
        dict(col=4, row=4, dest="drum-kit.png",
             src=REPO_ROOT / "drums" / "Music_and_Sport_Singles_48x48_39.png", scale=2/3),
        dict(col=6, row=4, dest="drum-stand.png",
             src=REPO_ROOT / "drums" / "Music_and_Sport_Singles_48x48_40.png", scale=2/3),
    ],
```

Deploy-config is a bottom-row room; none of these sit at row 0, so no wall-covering offset applies here.

- [ ] **Step 2: Regenerate and check**

```bash
cd apps/web/scripts
py generate-room-decor.py
ls ../public/world-assets/decor/deploy-config/
```
Expected: 6 files.

- [ ] **Step 3: Run the test suite**

Run: `cd apps/web && npm test` — expect all pass.

- [ ] **Step 4: Visual check**

Run: `cd apps/web && npm run dev`, look at Deploy Config. Expected: piano + amplifier (animate when occupied, unchanged from before), 2 speakers, electric + acoustic guitar, a drum kit + hi-hat stand cluster.

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/room_layout.py apps/web/public/world-assets/room-decor.json apps/web/public/world-assets/decor/deploy-config/
git commit -m "feat(world): re-furnish Deploy Config music room per the new mockup"
```

---

### Task 7: Full-world visual verification

No file changes — a manual pass confirming the whole feature reads correctly together. Not dispatched to a subagent; the controller performs this directly after Task 6's review closes.

- [ ] **Step 1:** `cd apps/web && npm run dev`, open the World view, walk/wait through all 6 rooms.
- [ ] **Step 2:** Confirm Database/Japanese is untouched (no visual regression from this plan's changes to sibling rooms).
- [ ] **Step 3:** Confirm every wall-covering item (Library bookshelves, Sports trophies/hoop, Game Room arcade machines) actually reads as overlapping its wall, not floating in the middle of the floor or clipped through it.
- [ ] **Step 4:** Confirm equipment animation still toggles correctly on agent occupancy in every room that has it (Analytics TV, Billing punching bag/treadmill, Database incense burner, Deploy Config piano/amplifier) and that the two always-animating ambient props (Library candle, Billing's second treadmill) animate continuously regardless of occupancy.
- [ ] **Step 5:** Confirm nothing outside `apps/web/scripts/room_layout.py`, `generate-room-decor.py`, and the regenerated `room-decor.json`/decor PNGs changed — `git diff --stat` against this plan's start should show no surprise files.
