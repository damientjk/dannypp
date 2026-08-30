import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api, ApiError } from "./api";
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
  setSessionToken: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status = 0,
    ) {
      super(message);
    }
  },
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

vi.mock("./world/engineMap", async () => {
  const { TiledMapRenderer } = await import("./world/engine/TiledMapRenderer");
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
    await screen.findByText("Enter the world");

    fireEvent.click(screen.getByText("← Dashboard"));
    await screen.findByText("Create Agent");
  });

  // Signing in happens inside the World, and the session token lives in the API
  // client rather than in React state, so returning to the dashboard has to
  // refetch. Without that, the dashboard keeps the empty list from the
  // unauthenticated fetch on mount until the user happens to create an Agent.
  it("points an unauthenticated visitor at the World, then reloads on return", async () => {
    vi.mocked(api.listAgents)
      .mockRejectedValueOnce(new ApiError("Sign in required", 401))
      .mockResolvedValue({ agents: [AGENT_A] });

    render(<App />);

    // The raw API message is unactionable on its own, so the dashboard names
    // the way in instead of repeating it.
    await screen.findByText("You are not signed in");
    expect(screen.queryByText("Sign in required")).toBeNull();
    expect(screen.queryAllByText(AGENT_A.name)).toHaveLength(0);

    fireEvent.click(screen.getByText("Go to the World"));
    await screen.findByText("Enter the world");

    fireEvent.click(screen.getByText("← Dashboard"));
    // The name renders in both the sidebar row and the detail heading.
    await screen.findAllByText(AGENT_A.name);
    expect(screen.queryByText("You are not signed in")).toBeNull();
  });
});
