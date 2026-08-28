import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "../types";
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
  // `getContainer`/`getCharacterContainer` return real pixi.js `Container`s
  // in production (TiledMapRenderer). Plain `{ addChild: vi.fn() }` stubs
  // don't compose with the real `Container` that the mocked `Application`
  // uses for `app.stage` (real `Container.addChild` calls `child.emit(...)`
  // internally, which a plain object lacks) — so return real Containers
  // here too, keeping the mock at the GPU/network boundary only.
  const actual = await vi.importActual<typeof import("pixi.js")>("pixi.js");
  const rootContainer = new actual.Container();
  const characterContainer = new actual.Container();
  return {
    TILE_SIZE: 32,
    loadWorldMap: vi.fn().mockResolvedValue({
      width: 22,
      height: 13,
      tileSize: 32,
      getContainer: () => rootContainer,
      getCharacterContainer: () => characterContainer,
      getSpawnPoint: () => ({ x: 0, y: 0 }),
      tileToPixel: (x: number, y: number) => ({ x: x * 32, y: y * 32 }),
    }),
  };
});

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

function agent(overrides: Partial<WorldAgent> = {}): WorldAgent {
  return {
    agentId: AGENT.id,
    ownerId: AGENT.ownerId,
    name: AGENT.name,
    x: 0,
    y: 0,
    originX: 0,
    originY: 0,
    targetX: 0,
    targetY: 0,
    facing: "down",
    status: "idle",
    currentRoom: "common",
    progress: 1,
    pendingEffect: null,
    pendingRoom: null,
    path: [],
    pathIndex: 0,
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
});
