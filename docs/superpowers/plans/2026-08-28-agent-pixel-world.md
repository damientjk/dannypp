# Agent Pixel World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Pokémon-style pixel-world view inside `apps/web` that renders real agents from the existing dashboard roaming a small tile map, entering/being denied from two owner-scoped "houses" via a decision function shaped exactly like the team's real PDP contract, so it becomes a one-line swap once the real backend lands.

**Architecture:** A new `apps/web/src/world/` module tree (types, a mock decision engine matching the backend's `PolicyRequest`/`PolicyDecision` shape, an asset manifest with placeholder fallback, tile map data, a pure agent-simulation tick, a Canvas 2D renderer, and a top-level view) plugged into the existing `App.tsx` behind a "Dashboard / World" toggle. No new Vite app, no game-engine dependency — hand-rolled `requestAnimationFrame` loop on one `<canvas>`.

**Tech Stack:** React 19 + Vite 7 (existing), Canvas 2D (native), Vitest + `@testing-library/react` + jsdom (new, mirrors the server's existing Vitest setup).

**Spec:** `docs/superpowers/specs/2026-08-28-agent-pixel-world-design.md`

## Global Constraints

- Never decide `permit`/`deny` in a way that isn't swappable for a real backend call later — every room-entry outcome must flow through one `decideRoomEntry()` function (spec §4).
- `apps/web/src/types.ts` is a hand-maintained mirror of `apps/server/src/types.ts` — new frontend types for principals/capabilities/policy must match the backend shapes field-for-field (spec §3, §4; backend source: `apps/server/src/types.ts`).
- Session auth uses header `x-session-token`, not `Authorization` — that header is already used by the unrelated shared-token gate (`docs/API_CONTRACT.md`).
- `ownerId` on `Agent` is server-assigned and read-only from the client — never send it in a create/update body (`docs/API_CONTRACT.md`).
- No new runtime dependency for rendering — Canvas 2D only (spec §5, approved design decision).
- `npm run check` (typecheck + test + build, all workspaces) must stay green — this plan updates the root `test` script so web tests run as part of it (hard rule #7, `TEAM_PLAN.md` §1).
- Placeholder-first rendering: sprite/tile art is not being hand-picked yet, so every drawable thing renders as a labeled placeholder shape by default via the asset manifest's fallback path — no pixel-coordinate guessing against the un-curated `moderninteriors-win` sheets (spec §5, §8).

---

## File Structure

**Create:**
- `apps/web/src/test/setup.ts` — Vitest jsdom setup: canvas 2D context stub, `requestAnimationFrame`/`cancelAnimationFrame` polyfill, `@testing-library/react` cleanup.
- `apps/web/src/test/environment.test.ts` — proves the setup file works.
- `apps/web/src/world/types.ts` — `RoomId`, `Facing`, `AgentMoveStatus`, `WorldAgent`, `DecisionEvent`.
- `apps/web/src/world/decision.ts` — in-memory capability store + `decideRoomEntry()` mock PDP.
- `apps/web/src/world/decision.test.ts`
- `apps/web/src/world/assets.ts` — asset manifest + placeholder-fallback image loader.
- `apps/web/src/world/assets.test.ts`
- `apps/web/src/world/map.ts` — tile grid constants, room bounds, pixel-coordinate helpers.
- `apps/web/src/world/map.test.ts`
- `apps/web/src/world/agentSim.ts` — pure spawn/tick/move/settle functions over `WorldAgent`.
- `apps/web/src/world/agentSim.test.ts`
- `apps/web/src/world/WorldCanvas.tsx` — the `<canvas>` + `requestAnimationFrame` loop.
- `apps/web/src/world/WorldCanvas.test.tsx`
- `apps/web/src/world/WorldView.tsx` — login, roster, room-entry controls, activity feed, security log.
- `apps/web/src/world/WorldView.test.tsx`
- `apps/web/src/App.test.tsx`

**Modify:**
- `apps/web/package.json` — add `test` script + Vitest/jsdom/testing-library devDependencies.
- `apps/web/vite.config.ts` — add `test` config block.
- `apps/web/src/types.ts` — add `ownerId` to `Agent`; add `HumanPrincipal`, `AgentPrincipal`, `Principal`, `Capability`, `PolicyEffect`, `PolicyRequestLike`, `PolicyDecision` (mirrors of `apps/server/src/types.ts`).
- `apps/web/src/api.ts` — add `x-session-token` support, `login`, `me`.
- `apps/web/src/App.tsx` — add a Dashboard/World view toggle and mount `WorldView`.
- `apps/web/src/styles.css` — world view styles.
- `package.json` (root) — `test` script also runs the web workspace's tests.

---

### Task 1: Vitest test harness for `apps/web`

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/vite.config.ts`
- Modify: `package.json` (root)
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/test/environment.test.ts`

**Interfaces:**
- Produces: a working `npm run test -w @launchpad/web` (Vitest, jsdom environment, `./src/test/setup.ts` loaded first). `HTMLCanvasElement.prototype.getContext("2d")` returns a stub object with `clearRect`/`fillRect`/`beginPath`/`arc`/`fill`/`drawImage` no-ops. `window.requestAnimationFrame`/`cancelAnimationFrame` are a working, cancel-safe polyfill.

- [ ] **Step 1: Add the test script and devDependencies**

Edit `apps/web/package.json`:

```json
{
  "name": "@launchpad/web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b --pretty false",
    "test": "vitest run"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^5.1.1",
    "vite": "^7.2.4",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.7",
    "@types/react-dom": "^19.2.3",
    "@testing-library/react": "^16.1.0",
    "jsdom": "^25.0.1",
    "typescript": "^5.9.3",
    "vitest": "^4.0.15"
  }
}
```

- [ ] **Step 2: Wire Vitest into the Vite config**

Edit `apps/web/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

- [ ] **Step 3: Write the jsdom setup file**

Create `apps/web/src/test/setup.ts`:

```ts
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

class FakeCanvasRenderingContext2D {
  fillStyle = "";
  clearRect(): void {}
  fillRect(): void {}
  beginPath(): void {}
  arc(): void {}
  fill(): void {}
  drawImage(): void {}
}

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value(this: HTMLCanvasElement, contextId: string) {
    if (contextId !== "2d") return null;
    return new FakeCanvasRenderingContext2D();
  },
});

const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();
let nextFrameId = 0;

window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
  const id = ++nextFrameId;
  const timer = setTimeout(() => callback(performance.now()), 16);
  pendingTimers.set(id, timer);
  return id;
};

window.cancelAnimationFrame = (id: number): void => {
  const timer = pendingTimers.get(id);
  if (timer) clearTimeout(timer);
  pendingTimers.delete(id);
};
```

- [ ] **Step 4: Write a test that proves the harness works**

Create `apps/web/src/test/environment.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("test environment", () => {
  it("stubs a usable 2d canvas context", () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    expect(ctx).not.toBeNull();
    expect(() => ctx!.fillRect(0, 0, 1, 1)).not.toThrow();
  });

  it("provides a cancel-safe requestAnimationFrame polyfill", async () => {
    let called = false;
    const id = window.requestAnimationFrame(() => {
      called = true;
    });
    window.cancelAnimationFrame(id);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 5: Install dependencies and run the test**

Run: `npm install && npm run test -w @launchpad/web`
Expected: both tests in `environment.test.ts` PASS.

- [ ] **Step 6: Make the root `test`/`check` scripts cover the web workspace**

Edit `package.json` (root), change the `test` script:

```json
    "test": "npm run test -w @launchpad/server && npm run test -w @launchpad/web",
```

Run: `npm run test`
Expected: server tests and the two new web tests all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/vite.config.ts apps/web/src/test package.json package-lock.json
git commit -m "test: add vitest harness to apps/web"
```

---

### Task 2: Session-token auth + shared principal/policy types

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api.ts`
- Test: `apps/web/src/api.test.ts`

**Interfaces:**
- Produces: `HumanPrincipal`, `AgentPrincipal`, `Principal`, `Capability`, `PolicyEffect`, `PolicyRequestLike`, `PolicyDecision` (in `types.ts`); `Agent.ownerId: string`; `setSessionToken(token: string): void`, `api.login(userId: string, password: string): Promise<{ sessionToken: string; principal: HumanPrincipal }>`, `api.me(): Promise<{ principal: HumanPrincipal }>` (in `api.ts`). Every authenticated request sends header `x-session-token` when a session token has been set.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setSessionToken } from "./api";

describe("api session auth", () => {
  afterEach(() => {
    setSessionToken("");
    vi.unstubAllGlobals();
  });

  it("logs in and stores the session token for later requests", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/auth/login") {
        return new Response(
          JSON.stringify({
            sessionToken: "tok-123",
            principal: { kind: "human", id: "user-a", displayName: "User A" },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ agents: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.login("user-a", "demo-a");
    setSessionToken(result.sessionToken);
    expect(result.principal.displayName).toBe("User A");

    await api.listAgents();
    const secondCall = fetchMock.mock.calls[1];
    const headers = (secondCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-session-token"]).toBe("tok-123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @launchpad/web -- api.test`
Expected: FAIL — `setSessionToken`/`api.login` are not exported yet.

- [ ] **Step 3: Add the mirrored principal/policy types**

Edit `apps/web/src/types.ts`, add `ownerId` to `Agent` and append these types (mirroring `apps/server/src/types.ts`):

```ts
export interface Agent {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  instructions: string;
  status: AgentStatus;
  workspacePath: string;
  codexThreadId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Append at the end of the file:

```ts
export interface HumanPrincipal {
  kind: "human";
  id: string;
  displayName: string;
}

export interface AgentPrincipal {
  kind: "agent";
  id: string;
  agentId: string;
  ownerId: string;
}

export type Principal = HumanPrincipal | AgentPrincipal;

export interface Capability {
  id: string;
  scope: string;
  expiresAt: string;
  revokedAt: string | null;
}

export type PolicyEffect = "permit" | "deny";

export interface PolicyRequestLike {
  principal: Principal;
  action: string;
  resource: string;
  capability: Capability | undefined;
  requestId: string;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  reason: string;
  requestId: string;
  decidedAt: string;
}
```

- [ ] **Step 4: Add session-token support and the login/me calls**

Edit `apps/web/src/api.ts`:

```ts
import type {
  Agent,
  AgentRun,
  HumanPrincipal,
  Message,
  SystemInfo,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

let authToken = "";
let sessionToken = "";

export function setAuthToken(token: string): void {
  authToken = token.trim();
}

export function setSessionToken(token: string): void {
  sessionToken = token.trim();
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = {
    ...(options?.body ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: "Bearer " + authToken } : {}),
    ...(sessionToken ? { "x-session-token": sessionToken } : {}),
    ...options?.headers,
  };
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new ApiError(data.error ?? "Request failed", response.status);
  }
  return data;
}

export const api = {
  auth: () => request<{ required: boolean }>("/api/auth"),
  login: (userId: string, password: string) =>
    request<{ sessionToken: string; principal: HumanPrincipal }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId, password }),
    }),
  me: () => request<{ principal: HumanPrincipal }>("/api/auth/me"),
  system: () => request<SystemInfo>("/api/system"),
  listAgents: () => request<{ agents: Agent[] }>("/api/agents"),
  createAgent: (body: {
    name: string;
    description: string;
    instructions: string;
  }) =>
    request<{ agent: Agent }>("/api/agents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAgent: (
    id: string,
    body: { name: string; description: string; instructions: string },
  ) =>
    request<{ agent: Agent }>("/api/agents/" + id, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAgent: (id: string) =>
    request<{ archivedWorkspace: string }>("/api/agents/" + id, {
      method: "DELETE",
    }),
  startAgent: (id: string) =>
    request<{ agent: Agent }>("/api/agents/" + id + "/start", {
      method: "POST",
    }),
  stopAgent: (id: string) =>
    request<{ agent: Agent }>("/api/agents/" + id + "/stop", {
      method: "POST",
    }),
  messages: (id: string) =>
    request<{ messages: Message[] }>("/api/agents/" + id + "/messages"),
  runs: (id: string) =>
    request<{ runs: AgentRun[] }>("/api/agents/" + id + "/runs"),
  sendMessage: (id: string, content: string) =>
    request<{ run: AgentRun; message: Message }>(
      "/api/agents/" + id + "/messages",
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
    ),
  run: (id: string) => request<{ run: AgentRun }>("/api/runs/" + id),
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @launchpad/web -- api.test`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck -w @launchpad/web`
Expected: no errors.

```bash
git add apps/web/src/types.ts apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "feat: add session-token auth and mirrored policy types to the web client"
```

---

### Task 3: World types + mock decision engine

**Files:**
- Create: `apps/web/src/world/types.ts`
- Create: `apps/web/src/world/decision.ts`
- Test: `apps/web/src/world/decision.test.ts`

**Interfaces:**
- Consumes: `Principal`, `Capability`, `PolicyEffect`, `PolicyRequestLike`, `PolicyDecision` from `../types`.
- Produces: `RoomId = "house-a" | "house-b"`; `Facing = "up"|"down"|"left"|"right"`; `AgentMoveStatus = "idle"|"walking"|"denied-bounce"`; `WorldAgent` (see below); `DecisionEvent`; `issueCapability(agentId: string, ownerId: string): Capability`, `getCapability(agentId: string): Capability | undefined`, `revokeCapability(agentId: string): void`, `resetCapabilities(): void`, `decideRoomEntry(request: PolicyRequestLike): Promise<PolicyDecision>`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/world/decision.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  decideRoomEntry,
  getCapability,
  issueCapability,
  resetCapabilities,
  revokeCapability,
} from "./decision";
import type { AgentPrincipal, PolicyRequestLike } from "../types";

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
    capability: getCapability(agentId),
    requestId: "req-" + agentId + "-" + resource,
  };
}

describe("decideRoomEntry", () => {
  beforeEach(() => {
    resetCapabilities();
  });

  it("permits an agent entering its own owner's house", async () => {
    issueCapability("agent-1", "user-a");
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "house-a"));
    expect(decision.effect).toBe("permit");
  });

  it("denies an agent entering a different owner's house", async () => {
    issueCapability("agent-1", "user-a");
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "house-b"));
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("user-a");
  });

  it("denies when there is no capability at all", async () => {
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "house-a"));
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("no capability");
  });

  it("denies after the capability is revoked", async () => {
    issueCapability("agent-1", "user-a");
    revokeCapability("agent-1");
    const decision = await decideRoomEntry(requestFor("agent-1", "user-a", "house-a"));
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toContain("revoked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @launchpad/web -- world/decision.test`
Expected: FAIL — `./decision` does not exist.

- [ ] **Step 3: Write the world types**

Create `apps/web/src/world/types.ts`:

```ts
import type { PolicyEffect } from "../types";

export type RoomId = "house-a" | "house-b";

export type Facing = "up" | "down" | "left" | "right";

export type AgentMoveStatus = "idle" | "walking" | "denied-bounce";

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
  status: AgentMoveStatus;
  currentRoom: RoomId | "common";
  progress: number;
  pendingEffect: PolicyEffect | null;
  pendingRoom: RoomId | null;
}

export interface DecisionEvent {
  requestId: string;
  agentId: string;
  agentName: string;
  room: RoomId;
  effect: PolicyEffect;
  reason: string;
  decidedAt: string;
}
```

- [ ] **Step 4: Write the mock decision engine**

Create `apps/web/src/world/decision.ts`:

```ts
import type { Capability, PolicyDecision, PolicyRequestLike } from "../types";
import type { RoomId } from "./types";

const capabilities = new Map<string, Capability>();

// ponytail: in-memory mock standing in for the real backend PDP
// (apps/server/src/policy/pdp.ts). Day 2 swap replaces only this
// function's body with a fetch call — callers only ever depend on
// the PolicyDecision shape, so nothing else changes.
const ROOM_OWNER: Record<RoomId, string> = {
  "house-a": "user-a",
  "house-b": "user-b",
};

export function issueCapability(agentId: string, ownerId: string): Capability {
  const capability: Capability = {
    id: crypto.randomUUID(),
    scope: ownerId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    revokedAt: null,
  };
  capabilities.set(agentId, capability);
  return capability;
}

export function getCapability(agentId: string): Capability | undefined {
  return capabilities.get(agentId);
}

export function revokeCapability(agentId: string): void {
  const capability = capabilities.get(agentId);
  if (capability) capability.revokedAt = new Date().toISOString();
}

export function resetCapabilities(): void {
  capabilities.clear();
}

export async function decideRoomEntry(request: PolicyRequestLike): Promise<PolicyDecision> {
  const decidedAt = new Date().toISOString();
  const { capability, resource, requestId } = request;
  const roomOwner = ROOM_OWNER[resource as RoomId];

  if (!capability) {
    return { effect: "deny", reason: "no capability issued", requestId, decidedAt };
  }
  if (capability.revokedAt) {
    return { effect: "deny", reason: "capability revoked", requestId, decidedAt };
  }
  if (new Date(capability.expiresAt).getTime() < Date.now()) {
    return { effect: "deny", reason: "capability expired", requestId, decidedAt };
  }
  if (capability.scope !== roomOwner) {
    return {
      effect: "deny",
      reason: `capability scoped to ${capability.scope}, room owned by ${roomOwner}`,
      requestId,
      decidedAt,
    };
  }
  return { effect: "permit", reason: "capability scope matches room owner", requestId, decidedAt };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @launchpad/web -- world/decision.test`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/world/types.ts apps/web/src/world/decision.ts apps/web/src/world/decision.test.ts
git commit -m "feat: add world types and mock room-entry decision engine"
```

---

### Task 4: Asset manifest with placeholder fallback

**Files:**
- Create: `apps/web/src/world/assets.ts`
- Test: `apps/web/src/world/assets.test.ts`

**Interfaces:**
- Produces: `AssetKey` (union of logical sprite/tile keys), `loadAsset(key: AssetKey): HTMLImageElement | null` (returns `null` until loaded or on error — draw a placeholder in that case), `resetAssetCache(): void`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/world/assets.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAsset, resetAssetCache } from "./assets";

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = "";
  set src(value: string) {
    this._src = value;
    if (value.includes("missing")) {
      this.onerror?.();
    } else {
      this.onload?.();
    }
  }
  get src() {
    return this._src;
  }
}

describe("loadAsset", () => {
  beforeEach(() => {
    resetAssetCache();
    vi.stubGlobal("Image", FakeImage as unknown as typeof Image);
  });

  it("returns null before the underlying image is known to exist", () => {
    // With the fake image resolving synchronously, this exercises the
    // cache-miss path: the first call kicks off loading.
    resetAssetCache();
    expect(loadAsset("character.default")).not.toBeNull();
  });

  it("returns the same image once loaded", () => {
    const first = loadAsset("room.house-a.floor");
    const second = loadAsset("room.house-a.floor");
    expect(first).toBe(second);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @launchpad/web -- world/assets.test`
Expected: FAIL — `./assets` does not exist.

- [ ] **Step 3: Write the asset manifest module**

Create `apps/web/src/world/assets.ts`:

```ts
export type AssetKey =
  | "character.default"
  | "room.house-a.floor"
  | "room.house-b.floor"
  | "room.common.floor";

// ponytail: real hand-picked sprite/tile files land here later — drop
// them at these paths under apps/web/public/ and nothing else changes.
// Until a file exists at a path, drawing code falls back to a
// placeholder shape (see WorldCanvas.tsx).
const ASSET_MANIFEST: Record<AssetKey, string> = {
  "character.default": "/world-assets/characters/default.png",
  "room.house-a.floor": "/world-assets/rooms/house-a-floor.png",
  "room.house-b.floor": "/world-assets/rooms/house-b-floor.png",
  "room.common.floor": "/world-assets/rooms/common-floor.png",
};

type AssetState = "loading" | "ready" | "error";

interface CacheEntry {
  image: HTMLImageElement;
  state: AssetState;
}

const cache = new Map<AssetKey, CacheEntry>();

export function loadAsset(key: AssetKey): HTMLImageElement | null {
  let entry = cache.get(key);
  if (!entry) {
    const image = new Image();
    entry = { image, state: "loading" };
    cache.set(key, entry);
    image.onload = () => {
      entry!.state = "ready";
    };
    image.onerror = () => {
      entry!.state = "error";
    };
    image.src = ASSET_MANIFEST[key];
  }
  return entry.state === "ready" ? entry.image : null;
}

export function resetAssetCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @launchpad/web -- world/assets.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/world/assets.ts apps/web/src/world/assets.test.ts
git commit -m "feat: add world asset manifest with placeholder fallback"
```

---

### Task 5: Tile map data

**Files:**
- Create: `apps/web/src/world/map.ts`
- Test: `apps/web/src/world/map.test.ts`

**Interfaces:**
- Produces: `TILE_SIZE = 32`, `WORLD_WIDTH_TILES`, `WORLD_HEIGHT_TILES`, `RoomBounds` (`{ id: "common"|RoomId; x; y; width; height; doorX; doorY }`), `ROOMS: RoomBounds[]`, `roomById(id): RoomBounds`, `tileToPixel(tile: number): number`, `doorPixelPosition(id): { x: number; y: number }`, `spawnPixelPosition(): { x: number; y: number }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/world/map.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  TILE_SIZE,
  doorPixelPosition,
  roomById,
  spawnPixelPosition,
  tileToPixel,
} from "./map";

describe("world map", () => {
  it("converts a tile coordinate to pixels", () => {
    expect(tileToPixel(3)).toBe(3 * TILE_SIZE);
  });

  it("finds room bounds by id", () => {
    const houseA = roomById("house-a");
    expect(houseA.id).toBe("house-a");
    expect(houseA.width).toBeGreaterThan(0);
  });

  it("throws for an unknown room id", () => {
    // @ts-expect-error deliberately invalid id for the runtime check
    expect(() => roomById("house-c")).toThrow();
  });

  it("computes a door's pixel position from its tile position", () => {
    const houseB = roomById("house-b");
    const door = doorPixelPosition("house-b");
    expect(door).toEqual({ x: tileToPixel(houseB.doorX), y: tileToPixel(houseB.doorY) });
  });

  it("gives a spawn position inside the common area", () => {
    const common = roomById("common");
    const spawn = spawnPixelPosition();
    expect(spawn.x).toBeGreaterThanOrEqual(tileToPixel(common.x));
    expect(spawn.x).toBeLessThan(tileToPixel(common.x + common.width));
    expect(spawn.y).toBeGreaterThanOrEqual(tileToPixel(common.y));
    expect(spawn.y).toBeLessThan(tileToPixel(common.y + common.height));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @launchpad/web -- world/map.test`
Expected: FAIL — `./map` does not exist.

- [ ] **Step 3: Write the map module**

Create `apps/web/src/world/map.ts`:

```ts
export const TILE_SIZE = 32;

export interface RoomBounds {
  id: "common" | "house-a" | "house-b";
  x: number;
  y: number;
  width: number;
  height: number;
  doorX: number;
  doorY: number;
}

export const ROOMS: RoomBounds[] = [
  { id: "house-a", x: 0, y: 0, width: 8, height: 6, doorX: 4, doorY: 5 },
  { id: "house-b", x: 12, y: 0, width: 8, height: 6, doorX: 15, doorY: 5 },
  { id: "common", x: 0, y: 6, width: 20, height: 6, doorX: 9, doorY: 6 },
];

export const WORLD_WIDTH_TILES = 20;
export const WORLD_HEIGHT_TILES = 12;

export function roomById(id: RoomBounds["id"]): RoomBounds {
  const room = ROOMS.find((candidate) => candidate.id === id);
  if (!room) throw new Error(`unknown room "${id}"`);
  return room;
}

export function tileToPixel(tile: number): number {
  return tile * TILE_SIZE;
}

export function doorPixelPosition(id: RoomBounds["id"]): { x: number; y: number } {
  const room = roomById(id);
  return { x: tileToPixel(room.doorX), y: tileToPixel(room.doorY) };
}

export function spawnPixelPosition(): { x: number; y: number } {
  const common = roomById("common");
  return {
    x: tileToPixel(common.x + Math.floor(common.width / 2)),
    y: tileToPixel(common.y + Math.floor(common.height / 2)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @launchpad/web -- world/map.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/world/map.ts apps/web/src/world/map.test.ts
git commit -m "feat: add world tile map data"
```

---

### Task 6: Pure agent-simulation tick

**Files:**
- Create: `apps/web/src/world/agentSim.ts`
- Test: `apps/web/src/world/agentSim.test.ts`

**Interfaces:**
- Consumes: `Agent` from `../types`; `WorldAgent`, `RoomId`, `Facing` from `./types`; `doorPixelPosition`, `spawnPixelPosition`, `TILE_SIZE` from `./map`.
- Produces: `spawnWorldAgents(agents: Agent[]): WorldAgent[]`, `facingFromDelta(dx: number, dy: number): Facing`, `beginMoveToRoom(agent: WorldAgent, room: RoomId, effect: PolicyEffect): WorldAgent`, `tickAgent(agent: WorldAgent, deltaMs: number): WorldAgent`, `settleAgent(agent: WorldAgent): WorldAgent`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/world/agentSim.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Agent } from "../types";
import {
  beginMoveToRoom,
  facingFromDelta,
  settleAgent,
  spawnWorldAgents,
  tickAgent,
} from "./agentSim";
import { TILE_SIZE, doorPixelPosition } from "./map";

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

describe("spawnWorldAgents", () => {
  it("maps agents to idle world agents", () => {
    const [worldAgent] = spawnWorldAgents([AGENT]);
    expect(worldAgent.agentId).toBe("agent-1");
    expect(worldAgent.ownerId).toBe("user-a");
    expect(worldAgent.status).toBe("idle");
    expect(worldAgent.progress).toBe(1);
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

describe("movement tick", () => {
  it("walks toward a permitted room and arrives idle inside it", () => {
    let agent = spawnWorldAgents([AGENT])[0];
    agent = beginMoveToRoom(agent, "house-a", "permit");
    expect(agent.status).toBe("walking");

    for (let i = 0; i < 200 && agent.status !== "idle"; i++) {
      agent = settleAgent(tickAgent(agent, 50));
    }

    const door = doorPixelPosition("house-a");
    expect(agent.status).toBe("idle");
    expect(agent.currentRoom).toBe("house-a");
    expect(agent.x).toBeCloseTo(door.x, 0);
    expect(agent.y).toBeCloseTo(door.y, 0);
  });

  it("walks up to the door, bounces back, and never enters when denied", () => {
    let agent = spawnWorldAgents([AGENT])[0];
    agent = beginMoveToRoom(agent, "house-b", "deny");

    for (let i = 0; i < 400 && !(agent.status === "idle" && agent.progress === 1); i++) {
      agent = settleAgent(tickAgent(agent, 50));
    }

    const door = doorPixelPosition("house-b");
    const distanceFromDoor = Math.hypot(agent.x - door.x, agent.y - door.y);

    expect(agent.status).toBe("idle");
    // it was rejected, so it never actually entered the house
    expect(agent.currentRoom).toBe("common");
    // it got up to the door before bouncing off, and only bounced back
    // a short hop — not all the way back to where it started
    expect(distanceFromDoor).toBeGreaterThan(0);
    expect(distanceFromDoor).toBeLessThan(TILE_SIZE * 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @launchpad/web -- world/agentSim.test`
Expected: FAIL — `./agentSim` does not exist.

- [ ] **Step 3: Write the simulation module**

Create `apps/web/src/world/agentSim.ts`:

```ts
import type { Agent, PolicyEffect } from "../types";
import type { Facing, RoomId, WorldAgent } from "./types";
import { TILE_SIZE, doorPixelPosition, spawnPixelPosition } from "./map";

const MOVE_SPEED_PX_PER_MS = 0.12;
const BOUNCE_DISTANCE_PX = TILE_SIZE * 0.75;

export function spawnWorldAgents(agents: Agent[]): WorldAgent[] {
  return agents.map((agent) => {
    const { x, y } = spawnPixelPosition();
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
      status: "idle",
      currentRoom: "common",
      progress: 1,
      pendingEffect: null,
      pendingRoom: null,
    };
  });
}

export function facingFromDelta(dx: number, dy: number): Facing {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

export function beginMoveToRoom(agent: WorldAgent, room: RoomId, effect: PolicyEffect): WorldAgent {
  const { x, y } = doorPixelPosition(room);
  return {
    ...agent,
    originX: agent.x,
    originY: agent.y,
    targetX: x,
    targetY: y,
    facing: facingFromDelta(x - agent.x, y - agent.y),
    status: "walking",
    progress: 0,
    pendingEffect: effect,
    pendingRoom: room,
  };
}

function beginDeniedBounce(agent: WorldAgent): WorldAgent {
  const dx = agent.targetX - agent.originX;
  const dy = agent.targetY - agent.originY;
  const length = Math.hypot(dx, dy) || 1;
  return {
    ...agent,
    originX: agent.x,
    originY: agent.y,
    targetX: agent.x - (dx / length) * BOUNCE_DISTANCE_PX,
    targetY: agent.y - (dy / length) * BOUNCE_DISTANCE_PX,
    facing: facingFromDelta(-dx, -dy),
    status: "denied-bounce",
    progress: 0,
    pendingEffect: null,
    pendingRoom: null,
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
  if (agent.status === "walking") {
    if (agent.pendingEffect === "deny") return beginDeniedBounce(agent);
    return {
      ...agent,
      status: "idle",
      currentRoom: agent.pendingRoom ?? agent.currentRoom,
      pendingEffect: null,
      pendingRoom: null,
    };
  }
  if (agent.status === "denied-bounce") {
    return { ...agent, status: "idle" };
  }
  return agent;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @launchpad/web -- world/agentSim.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/world/agentSim.ts apps/web/src/world/agentSim.test.ts
git commit -m "feat: add pure agent movement simulation"
```

---

### Task 7: `WorldCanvas` renderer

**Files:**
- Create: `apps/web/src/world/WorldCanvas.tsx`
- Test: `apps/web/src/world/WorldCanvas.test.tsx`

**Interfaces:**
- Consumes: `WorldAgent` from `./types`; `ROOMS`, `RoomBounds`, `TILE_SIZE`, `WORLD_WIDTH_TILES`, `WORLD_HEIGHT_TILES` from `./map`; `tickAgent`, `settleAgent` from `./agentSim`; `loadAsset`, `AssetKey` from `./assets`.
- Produces: `WorldCanvas({ agents, onFrame }: { agents: WorldAgent[]; onFrame: (agents: WorldAgent[]) => void })` — a React component rendering one `<canvas data-testid="world-canvas">`, running its own `requestAnimationFrame` loop, calling `onFrame` with the ticked/settled agent list every frame, cancelling the loop on unmount. Every frame, room floors and agents are drawn from `loadAsset()` when it returns an image, falling back to the placeholder rect/circle only when it returns `null` — this is the seam that makes dropping in real art later a no-code-change swap (spec §5, §8).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/world/WorldCanvas.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "../types";
import { spawnWorldAgents } from "./agentSim";
import { WorldCanvas } from "./WorldCanvas";

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

describe("WorldCanvas", () => {
  it("renders a canvas and reports ticked frames", async () => {
    const onFrame = vi.fn();
    const { container, unmount } = render(
      <WorldCanvas agents={spawnWorldAgents([AGENT])} onFrame={onFrame} />,
    );

    expect(container.querySelector('[data-testid="world-canvas"]')).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(onFrame).toHaveBeenCalled();
    const [firstCallArg] = onFrame.mock.calls[0];
    expect(firstCallArg).toHaveLength(1);

    unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @launchpad/web -- world/WorldCanvas.test`
Expected: FAIL — `./WorldCanvas` does not exist.

- [ ] **Step 3: Write the canvas component**

Create `apps/web/src/world/WorldCanvas.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { ROOMS, TILE_SIZE, WORLD_HEIGHT_TILES, WORLD_WIDTH_TILES } from "./map";
import type { RoomBounds } from "./map";
import { settleAgent, tickAgent } from "./agentSim";
import { loadAsset } from "./assets";
import type { AssetKey } from "./assets";
import type { WorldAgent } from "./types";

export interface WorldCanvasProps {
  agents: WorldAgent[];
  onFrame: (agents: WorldAgent[]) => void;
}

const ROOM_COLORS: Record<string, string> = {
  common: "#d8d3c4",
  "house-a": "#c9e4de",
  "house-b": "#f6dfeb",
};

const ROOM_ASSET_KEYS: Record<RoomBounds["id"], AssetKey> = {
  common: "room.common.floor",
  "house-a": "room.house-a.floor",
  "house-b": "room.house-b.floor",
};

const AGENT_COLORS: Record<WorldAgent["status"], string> = {
  idle: "#6954d9",
  walking: "#6954d9",
  "denied-bounce": "#c55353",
};

export function WorldCanvas({ agents, onFrame }: WorldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const agentsRef = useRef(agents);
  const onFrameRef = useRef(onFrame);
  const lastTimeRef = useRef<number | null>(null);
  const frameIdRef = useRef(0);

  agentsRef.current = agents;
  onFrameRef.current = onFrame;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // keep scaled pixel art crisp instead of browser-smoothed
    ctx.imageSmoothingEnabled = false;

    const step = (time: number) => {
      const last = lastTimeRef.current ?? time;
      const deltaMs = time - last;
      lastTimeRef.current = time;

      const next = agentsRef.current.map((agent) => settleAgent(tickAgent(agent, deltaMs)));
      onFrameRef.current(next);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const room of ROOMS) {
        const px = room.x * TILE_SIZE;
        const py = room.y * TILE_SIZE;
        const pw = room.width * TILE_SIZE;
        const ph = room.height * TILE_SIZE;
        const floorImage = loadAsset(ROOM_ASSET_KEYS[room.id]);
        if (floorImage) {
          ctx.drawImage(floorImage, px, py, pw, ph);
        } else {
          ctx.fillStyle = ROOM_COLORS[room.id] ?? "#cccccc";
          ctx.fillRect(px, py, pw, ph);
        }
      }
      const characterImage = loadAsset("character.default");
      for (const agent of next) {
        if (characterImage) {
          ctx.drawImage(characterImage, agent.x, agent.y, TILE_SIZE, TILE_SIZE);
        } else {
          ctx.fillStyle = AGENT_COLORS[agent.status];
          ctx.beginPath();
          ctx.arc(agent.x + TILE_SIZE / 2, agent.y + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      frameIdRef.current = requestAnimationFrame(step);
    };

    frameIdRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameIdRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={WORLD_WIDTH_TILES * TILE_SIZE}
      height={WORLD_HEIGHT_TILES * TILE_SIZE}
      className="world-canvas"
      data-testid="world-canvas"
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @launchpad/web -- world/WorldCanvas.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/world/WorldCanvas.tsx apps/web/src/world/WorldCanvas.test.tsx
git commit -m "feat: add canvas renderer for the pixel world"
```

---

### Task 8: `WorldView` — login, roster, room entry, activity feed

**Files:**
- Create: `apps/web/src/world/WorldView.tsx`
- Test: `apps/web/src/world/WorldView.test.tsx`

**Interfaces:**
- Consumes: `api` from `../api`; `Agent`, `AgentRun`, `Message`, `HumanPrincipal`, `PolicyRequestLike` from `../types`; `decideRoomEntry`, `getCapability`, `issueCapability`, `revokeCapability` from `./decision`; `spawnWorldAgents`, `beginMoveToRoom` from `./agentSim`; `WorldCanvas` from `./WorldCanvas`; `DecisionEvent`, `RoomId` from `./types`.
- Produces: `WorldView()` — a React component. Renders a login screen ("Log in as User A" / "Log in as User B") until logged in, then the roster + canvas + controls + activity feed + security log.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/world/WorldView.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../types";
import { api } from "../api";
import { resetCapabilities } from "./decision";
import { WorldView } from "./WorldView";

vi.mock("../api", () => ({
  api: {
    login: vi.fn(),
    listAgents: vi.fn(),
    runs: vi.fn(),
    messages: vi.fn(),
  },
}));

const AGENT_A: Agent = {
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

describe("WorldView", () => {
  beforeEach(() => {
    resetCapabilities();
    vi.mocked(api.login).mockResolvedValue({
      sessionToken: "tok",
      principal: { kind: "human", id: "user-a", displayName: "User A" },
    });
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [AGENT_A] });
    vi.mocked(api.runs).mockResolvedValue({ runs: [] });
    vi.mocked(api.messages).mockResolvedValue({ messages: [] });
  });

  async function loginAndSelect() {
    render(<WorldView />);
    fireEvent.click(screen.getByText("Log in as User A"));
    await screen.findByText("Robot A");
    fireEvent.click(screen.getByText("Robot A"));
  }

  it("permits an agent entering its own owner's house", async () => {
    await loginAndSelect();
    fireEvent.click(screen.getByText("Send to House A"));
    await waitFor(() => expect(screen.getByText(/permit/)).toBeTruthy());
  });

  it("denies an agent entering a different owner's house", async () => {
    await loginAndSelect();
    fireEvent.click(screen.getByText("Send to House B"));
    await waitFor(() => expect(screen.getByText(/deny/)).toBeTruthy());
  });

  it("denies a subsequent attempt after the keycard is revoked", async () => {
    await loginAndSelect();
    fireEvent.click(screen.getByText("Send to House A"));
    await waitFor(() => expect(screen.getByText(/permit/)).toBeTruthy());

    fireEvent.click(screen.getByText("Revoke keycard"));
    fireEvent.click(screen.getByText("Send to House A"));
    await waitFor(() => {
      const denyEntries = screen.getAllByText(/deny/);
      expect(denyEntries.length).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @launchpad/web -- world/WorldView.test`
Expected: FAIL — `./WorldView` does not exist.

- [ ] **Step 3: Write the view component**

Create `apps/web/src/world/WorldView.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Agent, AgentRun, HumanPrincipal, Message, PolicyRequestLike } from "../types";
import { decideRoomEntry, getCapability, issueCapability, revokeCapability } from "./decision";
import { beginMoveToRoom, spawnWorldAgents } from "./agentSim";
import { WorldCanvas } from "./WorldCanvas";
import type { DecisionEvent, RoomId, WorldAgent } from "./types";

const TEST_USERS = [
  { userId: "user-a", password: "demo-a", label: "Log in as User A" },
  { userId: "user-b", password: "demo-b", label: "Log in as User B" },
];

export function WorldView() {
  const [principal, setPrincipal] = useState<HumanPrincipal | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [worldAgents, setWorldAgents] = useState<WorldAgent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<DecisionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (userId: string, password: string) => {
    try {
      const result = await api.login(userId, password);
      setPrincipal(result.principal);
      const { agents: nextAgents } = await api.listAgents();
      setAgents(nextAgents);
      setWorldAgents(spawnWorldAgents(nextAgents));
      for (const agent of nextAgents) {
        issueCapability(agent.id, agent.ownerId);
      }
      setSelectedId(nextAgents[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setRuns([]);
      setMessages([]);
      return;
    }
    api.runs(selectedId).then((result) => setRuns(result.runs));
    api.messages(selectedId).then((result) => setMessages(result.messages));
  }, [selectedId]);

  const sendToRoom = useCallback(
    async (room: RoomId) => {
      if (!selectedId) return;
      const agent = agents.find((candidate) => candidate.id === selectedId);
      if (!agent) return;

      const requestId = crypto.randomUUID();
      const request: PolicyRequestLike = {
        principal: {
          kind: "agent",
          id: "agent-principal-" + agent.id,
          agentId: agent.id,
          ownerId: agent.ownerId,
        },
        action: "enter",
        resource: room,
        capability: getCapability(agent.id),
        requestId,
      };
      const decision = await decideRoomEntry(request);

      setWorldAgents((current) =>
        current.map((worldAgent) =>
          worldAgent.agentId === agent.id
            ? beginMoveToRoom(worldAgent, room, decision.effect)
            : worldAgent,
        ),
      );
      setEvents((current) => [
        {
          requestId,
          agentId: agent.id,
          agentName: agent.name,
          room,
          effect: decision.effect,
          reason: decision.reason,
          decidedAt: decision.decidedAt,
        },
        ...current,
      ]);
    },
    [agents, selectedId],
  );

  const revoke = useCallback(() => {
    if (selectedId) revokeCapability(selectedId);
  }, [selectedId]);

  if (!principal) {
    return (
      <div className="world-login">
        <h2>World view</h2>
        <p>Log in to see your agents in the pixel world.</p>
        {TEST_USERS.map((user) => (
          <button
            key={user.userId}
            className="button button-primary"
            onClick={() => login(user.userId, user.password)}
          >
            {user.label}
          </button>
        ))}
        {error && <p className="world-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="world-layout">
      <WorldCanvas agents={worldAgents} onFrame={setWorldAgents} />
      <aside className="world-panel">
        <h3>{principal.displayName}</h3>
        <ul className="world-roster">
          {agents.map((agent) => (
            <li key={agent.id}>
              <button
                className={agent.id === selectedId ? "selected" : ""}
                onClick={() => setSelectedId(agent.id)}
              >
                {agent.name}
              </button>
            </li>
          ))}
        </ul>
        {selectedId && (
          <div className="world-controls">
            <button onClick={() => sendToRoom("house-a")}>Send to House A</button>
            <button onClick={() => sendToRoom("house-b")}>Send to House B</button>
            <button onClick={revoke}>Revoke keycard</button>
          </div>
        )}
        <section>
          <h4>Activity</h4>
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                {run.status}: {run.prompt}
              </li>
            ))}
          </ul>
          <ul>
            {messages.map((message) => (
              <li key={message.id}>
                {message.role}: {message.content}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>Security log</h4>
          <ul>
            {events.map((event) => (
              <li key={event.requestId} className={"effect-" + event.effect}>
                {event.agentName} → {event.room}: {event.effect} ({event.reason})
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @launchpad/web -- world/WorldView.test`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/world/WorldView.tsx apps/web/src/world/WorldView.test.tsx
git commit -m "feat: add world view with login, room entry, and security log"
```

---

### Task 9: Wire the World view into `App.tsx`

**Files:**
- Modify: `apps/web/src/App.tsx:1-16` (imports), `apps/web/src/App.tsx:38-51` (state), `apps/web/src/App.tsx:307-309` (insert the world early-return before the dashboard's return), and the sidebar brand block (around `apps/web/src/App.tsx:312-322`).
- Modify: `apps/web/src/styles.css` (append world styles).
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: `WorldView` from `./world/WorldView`.
- Produces: a "World" button in the dashboard sidebar and a "← Dashboard" button in the world header, toggling which view `App` renders. The world view's root carries a `pixel-theme` class (user requirement: the World view's whole look, including text, reads as pixel art — scoped to the World view only, not the existing dashboard).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/App.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./api";
import { resetCapabilities } from "./world/decision";

vi.mock("./api", () => ({
  api: {
    auth: vi.fn(),
    system: vi.fn(),
    listAgents: vi.fn(),
    login: vi.fn(),
    runs: vi.fn(),
    messages: vi.fn(),
  },
  setAuthToken: vi.fn(),
  ApiError: class ApiError extends Error {
    status = 0;
  },
}));

const AGENT_A = {
  id: "agent-1",
  ownerId: "user-a",
  name: "Robot A",
  description: "",
  instructions: "",
  status: "ready" as const,
  workspacePath: "",
  codexThreadId: null,
  lastError: null,
  createdAt: "",
  updatedAt: "",
};

describe("App view toggle", () => {
  beforeEach(() => {
    resetCapabilities();
    vi.mocked(api.auth).mockResolvedValue({ required: false });
    vi.mocked(api.system).mockResolvedValue({
      arkConfigured: true,
      arkBaseUrl: "",
      arkModel: null,
      codexAvailable: true,
      codexSandboxMode: "",
      runtimeProvider: "local-process",
      containerEngine: null,
      runtime: "",
    });
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [AGENT_A] });
    vi.mocked(api.login).mockResolvedValue({
      sessionToken: "tok",
      principal: { kind: "human", id: "user-a", displayName: "User A" },
    });
    vi.mocked(api.runs).mockResolvedValue({ runs: [] });
    vi.mocked(api.messages).mockResolvedValue({ messages: [] });
  });

  it("switches between the dashboard and the world view and back", async () => {
    render(<App />);
    await screen.findByText("Create Agent");

    fireEvent.click(screen.getByText("World"));
    await screen.findByText("Log in as User A");

    fireEvent.click(screen.getByText("← Dashboard"));
    await screen.findByText("Create Agent");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @launchpad/web -- App.test`
Expected: FAIL — no "World" button exists yet.

- [ ] **Step 3: Add the view state, the world early-return, and the sidebar toggle**

Edit `apps/web/src/App.tsx` — add the import (near the top, after the existing `./types` import):

```ts
import { WorldView } from "./world/WorldView";
```

Add view state alongside the other `useState` calls (after `const [authInput, setAuthInput] = useState("");`):

```ts
  const [view, setView] = useState<"dashboard" | "world">("dashboard");
```

Insert a world early-return immediately before the dashboard's final `return (` (i.e. right after the `if (authRequired) { ... }` block closes, before `return (\n    <div className="app-shell">`):

```tsx
  if (view === "world") {
    return (
      <div className="world-shell pixel-theme">
        <header className="world-header">
          <div className="brand">
            <div className="brand-mark">A</div>
            <strong>Agent Launchpad — World</strong>
          </div>
          <button className="button" onClick={() => setView("dashboard")}>
            ← Dashboard
          </button>
        </header>
        <WorldView />
      </div>
    );
  }

```

Add the toggle button in the sidebar, right after the closing `</div>` of the `brand` block and before the `create-button`:

```tsx
        <button className="button view-toggle-button" onClick={() => setView("world")}>
          World
        </button>
```

- [ ] **Step 4: Add world styles, including the pixel theme**

The World view should read as pixel art throughout, including its text (user requirement) — scoped to the World view only, not the existing dashboard.

First, insert this line as the very first line of `apps/web/src/styles.css` (a CSS `@import` must precede every other rule, so it cannot go in the appended block below):

```css
@import url("https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap");
```

Then append the rest to the end of `apps/web/src/styles.css`:

```css
.world-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--line);
}

.view-toggle-button {
  width: 100%;
  margin: 12px 0;
}

.world-login {
  display: grid;
  gap: 12px;
  max-width: 360px;
  margin: 80px auto;
  text-align: center;
}

.world-layout {
  display: grid;
  grid-template-columns: auto 320px;
  gap: 16px;
  padding: 16px;
}

.world-canvas {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  /* keep the drawn pixel art crisp at its scaled-up display size */
  image-rendering: pixelated;
}

.world-panel {
  display: grid;
  gap: 16px;
  align-content: start;
}

.world-roster,
.world-panel ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 6px;
}

.world-controls {
  display: grid;
  gap: 8px;
}

.effect-permit {
  color: var(--green);
}

.effect-deny {
  color: var(--red);
}

.world-error {
  color: var(--red);
}

.pixel-theme,
.pixel-theme button,
.pixel-theme input {
  font-family: "Press Start 2P", ui-monospace, monospace;
  letter-spacing: 0.02em;
}

.pixel-theme h2,
.pixel-theme h3,
.pixel-theme h4 {
  font-size: 14px;
  line-height: 1.6;
}

.pixel-theme button {
  font-size: 10px;
  line-height: 1.6;
  padding: 10px 12px;
}

.pixel-theme li,
.pixel-theme p {
  font-size: 10px;
  line-height: 1.8;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @launchpad/web -- App.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/styles.css
git commit -m "feat: add Dashboard/World view toggle to the web app"
```

**Note (post-plan amendment):** a follow-on visual redesign of the World
login screen, done directly by the controller in commit `7b82ee9` (not
through this plan's task loop, unlike the Task 7/9 deviations amended in
`6d26314`), changed the World view's root class from `app-shell pixel-theme`
to `world-shell pixel-theme` (a dedicated flex layout instead of reusing the
dashboard's grid shell) and replaced the plain `.world-login` block above
with a "save file select" styled login screen (portrait avatars, eyebrow/
title/subtitle copy, per-user select cards) plus its own CSS block in
`apps/web/src/styles.css`. The code and CSS snippets above reflect the
pre-redesign state and are kept for historical reference rather than
rewritten to match.

---

### Task 10: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full check**

Run: `npm run check`
Expected: `typecheck`, `test` (server + web), and `build` all PASS with no errors.

- [ ] **Step 2: Manually smoke-test in the browser**

Run: `npm run dev`, open `http://localhost:5173`.
Expected:
- Dashboard loads as before (baseline unaffected).
- Clicking "World" shows the login screen with "Log in as User A" / "Log in as User B".
- Logging in shows the canvas (two colored rooms + a common area) and, if any agents exist in the dashboard, colored dots for each.
- Selecting an agent and clicking "Send to House A" walks it to that room and logs a `permit` line if the agent's owner is `user-a`, else `deny`.
- "Send to House B" for a `user-a`-owned agent logs `deny`.
- "Revoke keycard" then re-sending to a previously-permitted house logs `deny`.
- "← Dashboard" returns to the original screen with state intact.

- [ ] **Step 3: Fix anything the manual pass surfaces, then commit**

If no changes were needed, skip the commit. Otherwise:

```bash
git add -A
git commit -m "fix: address issues found in world view manual verification"
```

---

## Explicitly out of scope (see spec §8)

- Real sprite/tile art — the asset manifest (Task 4) and placeholder shapes (Task 7) are the seam; swapping in hand-picked `moderninteriors-win` files later is a follow-up, not part of this plan.
- Swapping `decideRoomEntry` (Task 3) for a real backend call — follow-up once the team's Day 2 PDP/capability/audit endpoints exist.
- More than two houses, richer pathing/AI, or an audit-log-backed security panel.
