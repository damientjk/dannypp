# Agent Pixel World — Design

Status: Approved. Owner: Person 4 (frontend/viz), per `TEAM_PLAN.md` §3.

## 1. Purpose

`TEAM_PLAN.md` assigns Person 4 an interactive visualization that renders the
team's real identity/authorization middleware — an agent (robot) entering a
protected resource (a house), a guard (the PDP) permitting or denying, a
keycard (capability) being revoked. This spec is that visualization,
reskinned as a small Pokémon-style top-down pixel world using the
`moderninteriors-win` tileset, with rooms standing in for the houses/resource
namespaces in the plan's mapping table.

It is **not** a new deployable and **not** a new decision-maker: per the
plan's hard rule #3, this view only ever renders decisions made by the real
backend PDP. It never decides `permit`/`deny` itself.

## 2. Where it lives

Inside the existing `apps/web` app — one Vite dev server, one port, same
session/login as the CRUD dashboard. `App.tsx` gains a top-level view toggle
(`"dashboard" | "world"`); everything else lives under a new `src/world/`
directory so it doesn't collide with the existing dashboard code.

This was chosen over a second Vite app/package to keep one dev server, one
`npm run dev`, and no second CORS/session-token wiring to maintain — cheapest
option that still reads as a distinct interface to a user.

## 3. Closing the known frontend gaps

`docs/API_CONTRACT.md` calls out two gaps that block anything session-based
from working in the browser today. The World view needs both immediately
(for the User A / User B switcher), so this spec closes them:

- `apps/web/src/api.ts`: add `x-session-token` header support (parallel to
  the existing `Authorization: Bearer` shared-token gate, not a replacement
  for it) plus `login` and `me` calls against `POST /api/auth/login` and
  `GET /api/auth/me`.
- `apps/web/src/types.ts`: add `ownerId: string` to `Agent`, matching the
  backend type.

## 4. The Day-2 seam

The real `PolicyDecisionPoint` (`apps/server/src/policy/pdp.ts`) is currently
a placeholder that always permits; `capability/`, `resources/`, and `audit/`
modules don't exist in the backend yet — they're Day 2 work owned by
teammates on the policy/capability tracks.

Rather than hardcode a fake permit/deny, one function owns the decision call:

```ts
// apps/web/src/world/decision.ts
async function decideRoomEntry(req: PolicyRequestLike): Promise<PolicyDecision>
```

`PolicyRequestLike` and the returned `PolicyDecision` mirror the backend's
real `PolicyRequest`/`PolicyDecision` types in `apps/server/src/types.ts`
(`{ effect: "permit" | "deny", reason, requestId, decidedAt }`). Today the
function body is an in-memory mock (an agent may enter only its owner's
house). When the real endpoint lands, the body becomes a `fetch` call and
nothing downstream changes, because every consumer (door animation, event
log) only ever depends on the `PolicyDecision` shape, not on how it was
produced.

The agent roster itself is **not** mocked — it calls the real
`GET /api/agents` today, so agents created in the existing dashboard appear
in the world immediately.

## 5. Rendering engine

Hand-rolled Canvas 2D — no game-engine dependency:

- One `<canvas>`, a `requestAnimationFrame` game loop, a fixed tile grid.
- Sprites sliced by source-rect from the `moderninteriors-win` PNG sheets
  (16/32/48px variants).
- **Asset manifest**: a single table mapping logical keys
  (`"character.default"`, `"room.house-a.floor"`, ...) to file paths. A key
  with no file yet renders a placeholder rectangle + label instead of
  failing, so hand-picked textures/rejection art can be dropped in later as a
  path swap only.
- Walk-cycle frame animation (swap source-rect column by elapsed time) and
  smooth tile-to-tile position tweening — both driven by the same game loop,
  standard technique, no library needed for a single small overworld scene.

## 6. World content & demo flow

- A small map with at least **House A** and **House B** as distinct rooms
  built from the Interiors tileset — the direct reskin of the plan's
  house-per-owner metaphor.
- Agents from the real roster spawn in a common area and idle-wander.
  Directing one at a house calls `decideRoomEntry`:
  - `permit` → walks in, door/tile flashes green.
  - `deny` → bounces off, flashes red.
- Activity panel: backed by the real `GET /api/agents/:id/runs` and
  `/messages` endpoints (already implemented) for what the agent is actually
  doing, plus a client-side ring buffer of room-entry decisions
  (`requestId`/`effect`/`reason`) shaped so it can be swapped for the real
  audit-log endpoint's response later without changing its consumers.
- Revocation: a UI action flips the mock capability's `revokedAt`, so the
  same agent's next entry attempt denies — demonstrates the revoke story
  ahead of real capability issuance landing.

## 7. Testing

One smoke test: the world view renders and calls `decideRoomEntry`, agents
from a mocked `GET /api/agents` response appear. Not testing animation
pixels. Per the plan, correctness of `permit`/`deny` itself is proven by
Person 5's backend-facing tests, not this view.

## 8. Explicitly deferred (user's own words: "I can add the additional changes in the future")

- Final texture/sprite selection and folder layout for rejection/other
  animations — hand-picked by the user later; the asset manifest's
  placeholder fallback covers this gap in the meantime.
- Swapping `decideRoomEntry` and the audit panel to the real Day-2 endpoints
  once teammates ship them.
- Anything beyond a single common area + two houses (more rooms, richer
  pathing/AI) — out of scope for the first version.
- Two details promised elsewhere in this doc were not actually built: §5's
  placeholder-asset "rectangle + label" renders as a bare rectangle with no
  label text, and §6's permit door/tile flash-green visual was never
  implemented (only the deny/denied-bounce color change exists).

## 9. Amendment 2026-08-28: PixiJS rendering engine (surgical reuse)

Supersedes §5. The user asked to fork the room-rendering visuals from
`github.com/chaitanyagiri/munder-difflin` (MIT), an unrelated Electron app,
after sharing a screenshot of its office-floor UI as the target look. That
repo's own office/task logic is out of scope — only four generic,
office-agnostic rendering modules are reused, verbatim aside from one
additive method:

- `TiledMapRenderer.ts` — parses a Tiled JSON map, builds floor/wall tile
  layers as sprites, derives a walkability grid + named spawn points/zones.
- `Camera.ts` — vendored for parity but **not wired up**: our map is small
  enough (22×13 tiles, 704×416px) to render at 1:1 with no panning needed.
  `ponytail:` this is a deliberate scope cut, not an oversight — add
  Camera.fitToScreen/focusOn if the map grows past one screen.
- `pathfinding.ts` — plain BFS `findPath`, zero modifications.
- `CharacterSprite.ts` — verbatim except one additive `setTint(color)`
  method (not in the original) so the existing deny-bounce red-flash
  affordance survives the switch from placeholder circles to real sprites.

This **revises the §5 "no new dependency" constraint**: `pixi.js@^8.5.1` is
added as a real runtime dependency of `apps/web`. Canvas 2D drawing
(`WorldCanvas.tsx`'s manual `drawImage`/pattern-fill code) is replaced
entirely; `apps/web/src/world/map.ts` and `assets.ts` (and their tests) are
deleted, replaced by a Tiled JSON map + composited tileset PNG (hand-built
from `moderninteriors-win` tiles) parsed at runtime by `TiledMapRenderer`.

Everything in §2, §3, §4, and §6 is unchanged: same view toggle, same
session wiring, same `decideRoomEntry` seam, same permit/deny/revoke demo
flow. `WorldView.tsx`'s orchestration and `decision.ts` are untouched — only
the rendering layer and `agentSim.ts`'s movement tween (straight-line →
multi-waypoint path-following, using `findPath`) change.

Character animation: only one real character frame exists
(`character.default`, an idle-down crop). `CharacterSprite` expects a
`Texture[][]` frame grid (3 direction rows × up to 3 columns); every cell is
filled with that same single texture, so direction-flip (`left`/`right`
mirroring) is real but frame-cycling is a visual no-op — real walk-cycle art
stays deferred per §8, unchanged.
