# Agent World — Autonomy, Per-File Permissions & Profile UI — Design

Status: Approved by human partner in chat, written up for record. Supersedes the
demo flow described in `2026-08-28-agent-pixel-world-design.md` §6 (the
`Send to House A/B` explicit-click flow) and that spec's two-house-per-owner
mapping. Builds on top of, and does not touch, the PixiJS rendering engine
from `2026-08-28-agent-pixel-world-design.md` §9 (`TiledMapRenderer`,
`Camera`, `pathfinding`, `CharacterSprite`, `engineMap.ts`) — this spec is
entirely about behavior, data model, and UI layered on that engine.

## 1. Purpose

The current World view demonstrates ownership isolation (User A's agent
permitted into A's house, denied from B's house) via an explicit
"Send to House" button click. This spec replaces that with an always-running
simulation: agents roam a single shared house on their own, and permission
becomes something requested and granted in the moment an agent actually
needs to do real work in a specific file — a closer visual analog to how the
real backend's capability model is scoped (per-resource, not per-owner).

## 2. What changes vs. what stays

**Stays unchanged:** the Day-2 seam (`decideRoomEntry` is still the only
place that decides `permit`/`deny`; the real backend swap-in is still a
body-only change), the PixiJS rendering engine, `TILE_SIZE`, the login/session
wiring in `api.ts`, and the principle that the UI never decides
permit/deny itself.

**Changes:**
- **Rooms map to files, not owners.** A room is one `FileRoom` (a mock
  resource); an owner can have several. Ownership isolation is now proven
  per-file, not per-house.
- **One shared house**, not two separate ones. Every agent, from every
  owner, roams the same floor plan.
- **All agents are always visible**, regardless of who's logged in. Login
  now determines whose permission requests you see and can grant — not
  which agents exist on screen.
- **Movement is autonomous.** Agents roam on their own (Brownian-style
  wandering) and walk to their assigned file-room's desk when they have
  real work to do. There is no more manual "Send to Room" control.
- **Capabilities are requested, not pre-issued.** Login no longer grants
  every owned agent a blanket capability. An agent starts with none; it
  earns per-room capabilities one at a time, via its owner's explicit
  grant, the first time it needs to enter that room.

## 3. Resource & capability data model

New module, `apps/web/src/world/resources.ts`:

```ts
export interface FileRoom {
  id: string;               // "auth-module", "billing-module", ...
  displayName: string;      // "Auth Module"
  ownerId: string | null;   // null for common rooms (no permission needed)
  requiresPermission: boolean;
  deskIds: string[];        // spawn-point names inside this room, e.g. "desk-auth-module-1"
}

export const FILE_ROOMS: FileRoom[]; // the fixed 6-room registry, §6

export function roomById(id: string): FileRoom;
export function roomsOwnedBy(ownerId: string): FileRoom[];
export function assignedRoomFor(agent: Agent): FileRoom;
  // deterministic: one of agent.ownerId's own requiresPermission rooms,
  // chosen by a stable hash of agent.id — same agent always gets the same
  // room, no per-agent hand config needed as new agents get created.
```

**`RoomId` becomes `string`** (any `FileRoom.id`) in `world/types.ts` — the
old `"house-a" | "house-b"` union is gone; the room set is data-driven now.

**Capabilities become room-scoped**, not one-per-agent. `decision.ts`'s
capability store changes from `Map<agentId, Capability>` to
`Map<"${agentId}:${roomId}", Capability>`. New/changed exports:

```ts
export function getCapability(agentId: string, roomId: string): Capability | undefined;
export function issueCapability(agentId: string, roomId: string): void;
export function revokeCapability(agentId: string, roomId: string): void;
export function grantedRoomsFor(agentId: string): string[]; // for the detail panel
```

`decideRoomEntry` keeps its exact signature and `PolicyRequestLike`/
`PolicyDecision` shapes (per the Day-2 seam constraint) — only its body
changes: `resource` is looked up via `roomById`, and a room with
`requiresPermission: false` always permits with no capability check.

## 4. Movement & behavior model

`agentSim.ts`'s state machine is reworked (not just extended — the old
single-target-tween model doesn't fit an always-roaming agent). `WorldAgent`
gains:

```ts
export type BehaviorMode = "roaming" | "heading-to-desk" | "working";

// added to WorldAgent:
behaviorMode: BehaviorMode;
assignedRoomId: string;        // from assignedRoomFor(), fixed per agent
occupiedDeskId: string | null; // which desk it's sitting at, once working
```

- **`roaming`** (default, whenever the agent's real `status !== "busy"`):
  every few seconds, pick a random walkable tile within the open space
  (hallway + the two `requiresPermission: false` common rooms — file-rooms
  are never roam targets) and path to it via the existing `findPath`. Small,
  undirected hops — that's the Brownian character, not a literal random walk
  every frame.
- **`heading-to-desk`** (entered the instant real `status` flips to
  `"busy"`): look up `assignedRoomFor(agent)`, build a `PolicyRequestLike`
  exactly as the old `sendToRoom` did, and call `decideRoomEntry` — the
  capability presence check still lives entirely inside that function, same
  as today. This keeps the Day-2 seam honest: nothing in `agentSim.ts` ever
  inspects a capability or decides permit/deny itself, it only acts on the
  `PolicyDecision` it gets back.
  - **`permit`:** claim a free desk in `room.deskIds` (skip ones another
    agent already occupies), path to it, transition to `working`. If every
    desk in the room is currently occupied, stay `roaming` and re-check on
    the next tick where `status` is still `"busy"` — no request is queued
    for this case, since access was already granted; it's just waiting for
    a desk, not for permission.
  - **`deny`:** do not start walking there. Immediately return to
    `roaming` (or stay `working`/`roaming`, whatever it was already doing —
    the point is nothing about its movement changes) and queue an
    `AccessRequest` (§5) if one isn't already pending for this
    `(agentId, roomId)` pair. This is the entire "same animation is kept"
    behavior — there is no denied-bounce state anymore for this flow.
- **`working`**: idle at the occupied desk, playing `CharacterSprite`'s
  existing `"type"` animation state (defined in the vendored code, unused
  until now). Holds until real `status` leaves `"busy"`, then releases the
  desk and returns to `roaming`.

The old `beginMoveToRoom`/`denied-bounce` path from the PixiJS-engine plan
is removed along with the manual "Send to Room" UI control it served — this
spec's task-visit flow is its full replacement.

## 5. Permission request flow

New module, `apps/web/src/world/requests.ts`:

```ts
export interface AccessRequest {
  id: string;
  agentId: string;
  agentName: string;
  roomId: string;
  roomOwnerId: string;
  requestedAt: string;
}

export function queueRequest(...): AccessRequest | null; // null if one's already pending for this pair
export function resolveRequest(requestId: string, decision: "grant" | "deny"): void;
```

- Requests render as a small, non-blocking toast/card queue (top corner —
  the simulation keeps running underneath, nothing pauses).
- **Filtered to the logged-in principal**: only requests where
  `roomOwnerId === principal.id` are shown to the current user. An agent
  belonging to a *different* owner, wandering into work needing *your*
  room, still surfaces to you — that's ownership isolation made visible,
  not a bug.
- **Grant** → `issueCapability(agentId, roomId)`, request removed. The next
  time that agent transitions into `heading-to-desk` for that room (which
  may be immediately, if it's still `busy`), it walks in for real.
- **Deny** → request removed, no capability issued. Not a permanent block —
  the agent can be asked again on a future task cycle for that room,
  mirroring how revocation already works elsewhere (nothing in this app
  models a "permanently blacklisted" state).
- The existing security log gains request/grant/deny entries alongside the
  existing permit/deny entries from `decideRoomEntry`, so the full story —
  request → grant → later real permit — reads in one place.

## 6. Map & visual scope

One shared house, 6 rooms plus a hallway, built with the same
`generate-world-map.py`/tileset pipeline from the PixiJS-engine plan,
extended:

| Room | Owner | Permission | Desks |
|---|---|---|---|
| Auth Module | user-a | required | 2 |
| Billing | user-a | required | 2 |
| Database | user-b | required | 2 |
| Deploy Config | user-b | required | 2 |
| Kitchen | — | none | 0 |
| Living Room | — | none | 0 |

Desk spawn points use the vendored `TiledMapRenderer`'s existing `desk-`
name-prefix convention (`markWalkableSpawnPoints`'s `WALKABLE_SPAWN_PREFIXES`
already special-cases this — built into the engine from day one, unused
until this feature). Each room gets a distinct floor texture (already how
rooms differ today) plus 2-3 real furniture pieces pulled from
`moderninteriors-win`'s `Interiors_32x32.png` catalog (desks/computers in
file-rooms; a couch/table in the common rooms), picked via the same
labeled-contact-sheet inspection technique used for the wall/floor tiles in
the PixiJS-engine plan. Exact tile coordinates are an implementation-time
detail, not fixed here.

## 7. UI changes

`WorldView.tsx`'s sidebar roster is replaced by:

- **Bottom profile strip**: every agent, all owners, each a card with
  avatar, name, and a status pill (`roaming` / `heading to desk` /
  `working` / `awaiting access`).
- **Click a card** → the existing right-side panel (already hosting
  Activity/Security-log) shows that agent's role
  (`Works on: ${assignedRoomFor(agent).displayName}`), its current real
  task (`AgentRun.prompt` when `status === "busy"`), and its granted-rooms
  list (with a per-room revoke action, replacing the old single blanket
  "Revoke keycard" button).
- **Request toast queue** floats independently of card selection, always
  visible when the logged-in principal has pending requests.
- **Login screen copy** changes from "choose a trainer" / roster-picking
  framing to reflect that login now determines whose requests you approve,
  not which agents exist — exact copy is a small polish item, not
  load-bearing to the design.

## 8. Testing approach

Consistent with the existing testing culture in this codebase (real vendored
engine code exercised where feasible, mocks only at true GPU/network
boundaries, no pixel-level animation assertions):

- `resources.ts`: `assignedRoomFor` determinism (same agent → same room
  every call), `roomsOwnedBy` filtering.
- `decision.ts`: room-scoped capability grant/revoke, common rooms bypassing
  the capability check entirely, per-room isolation (granting room X for an
  agent doesn't grant room Y).
- `requests.ts`: de-duplication (queuing the same pending pair twice is a
  no-op), grant/deny resolution.
- `agentSim.ts`: behavior-mode transitions (`roaming` → `heading-to-desk` on
  `status` flip, → `working` on arrival, back to `roaming` on completion),
  desk-occupancy collision avoidance (two agents assigned the same room
  don't claim the same desk), and the not-yet-permitted case leaving
  `behaviorMode` unchanged while still queuing exactly one request.
- `WorldView.tsx`: smoke test that a request renders, Grant wires to
  `issueCapability` and removes the toast, filtered-by-owner visibility.

## 9. Explicitly deferred

- Real per-file backend data (which file an agent's run actually touched) —
  `assignedRoomFor`'s mock hash-based assignment stands in for this
  entirely; swapping to real data is a future Day-2 seam, not scoped here.
- Any "permanently denied" or cooldown state for repeatedly-denied requests.
- Multi-desk visual variety (agents at a desk all use the same static idle
  frame, per the still-standing single-character-crop limitation from the
  PixiJS-engine plan — real walk/type-cycle art stays deferred).
- Login-screen copy polish beyond "no longer implies agent-picking."
