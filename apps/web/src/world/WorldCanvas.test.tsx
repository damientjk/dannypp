import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorldAgent } from "./types";
import { WorldCanvas } from "./WorldCanvas";
import { loadRoomDecor } from "./roomDecor";

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
      addDecorLayer: vi.fn(),
    }),
  };
});

vi.mock("./roomDecor", () => ({
  loadRoomDecor: vi.fn().mockResolvedValue({ decor: [], equipment: [] }),
}));

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
    restAnim: null,
    restUntil: 0,
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
    // Pin the dice above REST_CHANCE so the agent always chooses to walk
    // (a real roll can start a multi-second read/phone pause instead).
    const dice = vi.spyOn(Math, "random").mockReturnValue(0.9);
    const onFrame = vi.fn();
    const { unmount } = render(<WorldCanvas agents={[agent()]} onFrame={onFrame} />);

    await new Promise((resolve) => setTimeout(resolve, 80));
    const calls = onFrame.mock.calls;
    const last = calls[calls.length - 1][0] as WorldAgent[];
    // An agent with progress:1 and no path, left alone for several frames,
    // should have been given a fresh roam path by advanceBehavior.
    expect(last[0].path.length).toBeGreaterThan(0);

    dice.mockRestore();
    unmount();
  });

  it("loads equipment entries and keeps ticking without throwing", async () => {
    vi.mocked(loadRoomDecor).mockResolvedValueOnce({
      decor: [{ image: "decor/auth-module/bookshelf.png", x: 64, y: 32 }],
      equipment: [
        {
          image: "equipment/animated_punching_bag_left_32x32.png",
          frames: 12,
          x: 128,
          y: 96,
          spawnPoints: ["desk-billing-1"],
        },
      ],
    });
    const onFrame = vi.fn();
    const { unmount } = render(<WorldCanvas agents={[agent()]} onFrame={onFrame} />);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onFrame).toHaveBeenCalled();

    unmount();
  });
});
