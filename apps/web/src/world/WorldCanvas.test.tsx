import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorldAgent } from "./types";
import { WorldCanvas } from "./WorldCanvas";
import { buildWorldMap } from "./mapBuilder";
import { listFolderRooms } from "./folders";

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

const rooms = listFolderRooms();

async function makeRenderer() {
  const { TiledMapRenderer } = await import("./engine/TiledMapRenderer");
  const { Texture } = await import("pixi.js");
  return new TiledMapRenderer(buildWorldMap(rooms), [Texture.WHITE]);
}

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
    status: "idle",
    currentRoom: "common",
    progress: 1,
    pendingEffect: null,
    pendingRoom: null,
    path: [],
    pathIndex: 0,
    waitTicks: 0,
    ...overrides,
  };
}

describe("WorldCanvas", () => {
  it("renders a canvas and reports ticked frames", async () => {
    const renderer = await makeRenderer();
    const onFrame = vi.fn();
    const { container, unmount } = render(
      <WorldCanvas
        renderer={renderer}
        rooms={rooms}
        agents={[agent()]}
        onFrame={onFrame}
      />,
    );

    expect(container.querySelector('[data-testid="world-canvas"]')).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(onFrame).toHaveBeenCalled();
    const [lastCallArg] = onFrame.mock.calls[onFrame.mock.calls.length - 1];
    expect(lastCallArg).toHaveLength(1);

    unmount();
  });

  it("sizes the canvas to the generated map rather than a fixed constant", async () => {
    const renderer = await makeRenderer();
    const { container, unmount } = render(
      <WorldCanvas renderer={renderer} rooms={rooms} agents={[]} onFrame={vi.fn()} />,
    );

    const canvas = container.querySelector<HTMLCanvasElement>(
      '[data-testid="world-canvas"]',
    );
    expect(canvas!.width).toBe(renderer.width * renderer.tileSize);
    expect(canvas!.height).toBe(renderer.height * renderer.tileSize);

    unmount();
  });
});
