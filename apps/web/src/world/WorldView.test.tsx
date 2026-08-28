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

vi.mock("./engineMap", async () => {
  const { TiledMapRenderer } = await import("./engine/TiledMapRenderer");
  const { Texture } = await import("pixi.js");
  const width = 6;
  const height = 3;
  const mapData = {
    width,
    height,
    tilewidth: 32,
    tileheight: 32,
    tilesets: [{ firstgid: 1, columns: 5, tilewidth: 32, tileheight: 32, tilecount: 5 }],
    layers: [
      { name: "floor", type: "tilelayer" as const, data: new Array(width * height).fill(1) },
      { name: "collision", type: "tilelayer" as const, data: new Array(width * height).fill(0) },
      {
        name: "spawn-points",
        type: "objectgroup" as const,
        objects: [
          { name: "common", x: 32, y: 32 },
          { name: "house-a-door", x: 0, y: 0 },
          { name: "house-b-door", x: 5 * 32, y: 0 },
        ],
      },
      { name: "zones", type: "objectgroup" as const, objects: [] },
    ],
  };
  const renderer = new TiledMapRenderer(mapData, [Texture.WHITE]);
  return {
    TILE_SIZE: 32,
    loadWorldMap: vi.fn().mockResolvedValue(renderer),
  };
});

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
    await waitFor(() => {
      const button = screen.getByText("Log in as User A").closest("button");
      expect(button?.disabled).toBe(false);
    });
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
