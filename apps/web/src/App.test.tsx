import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    denyCapability: vi.fn().mockResolvedValue({ denied: true }),
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

// Root-relative fetch, no origin under Node -- see WorldView.test.tsx.
vi.mock("./world/roomDecor", () => ({
  loadRoomDecor: vi.fn().mockResolvedValue({ decor: [], equipment: [] }),
}));

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

  // A Run held at the authorization gate is not "Codex working" -- it is
  // waiting on a decision only the owner can make, in a view they are not
  // looking at.
  it("tells the owner when a run is waiting on their permission", async () => {
    const RUN = {
      id: "run-1",
      agentId: AGENT_A.id,
      status: "running" as const,
      // Names the file, so the room (and therefore the scope) is resolved
      // from the task rather than falling back to the agent's home room.
      prompt: "head -n 1 inbox/secret-recipe.txt",
      output: null,
      error: null,
      usage: null,
      awaitingCapability: true,
      withheldCount: 0,
      stagedResources: [],
      createdAt: new Date().toISOString(),
    };
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [AGENT_A] });
    vi.mocked(api.runs).mockResolvedValue({ runs: [RUN] });

    render(<App />);
    fireEvent.click((await screen.findAllByText(AGENT_A.name))[0]!);

    await screen.findByText("waiting for your permission");
    expect(screen.queryByText(/Codex is reading, editing/)).toBeNull();

    // Deciding happens in the World, where the room the Agent is standing at
    // is visible. This panel's job is to say a decision is waiting, and to get
    // the owner there.
    expect(screen.queryByText("Grant keycard")).toBeNull();
    expect(screen.queryByText("Refuse")).toBeNull();

    fireEvent.click(screen.getByText("Go to World view"));
    await screen.findByText("Enter the world");
  });

  // A refused file is simply absent from the workspace, so the Agent reports
  // "No such file or directory" -- which reads as "it does not exist" rather
  // than "you were not allowed to see it". Only the gate knows the difference.
  it("says a completed run was refused, not that the file was missing", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [AGENT_A] });
    vi.mocked(api.runs).mockResolvedValue({
      runs: [
        {
          id: "run-2",
          agentId: AGENT_A.id,
          status: "completed" as const,
          prompt: "read the recipe",
          output: "head: cannot open 'inbox/secret-recipe.txt'",
          error: null,
          usage: null,
          awaitingCapability: false,
          withheldCount: 3,
          stagedResources: [],
          createdAt: new Date().toISOString(),
        },
      ],
    });

    render(<App />);
    fireEvent.click((await screen.findAllByText(AGENT_A.name))[0]!);

    await screen.findByText("Nothing reached the workspace");
    await screen.findByText(/No keycard covers any of your 3 files/);
    // The panel reports on staging, which only ever considers the owner's own
    // namespace -- it must not claim to explain output it cannot see.
    expect(screen.queryByText(/reported the file as missing/)).toBeNull();
  });

  // Refusals alongside a successful read are least privilege working, not a
  // failure -- the earlier copy told the owner to "grant a keycard and run
  // again" underneath a run that had just returned the file they asked for.
  it("frames refusals as least privilege when the run got what it asked for", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({ agents: [AGENT_A] });
    vi.mocked(api.runs).mockResolvedValue({
      runs: [
        {
          id: "run-3",
          agentId: AGENT_A.id,
          status: "completed" as const,
          prompt: "read the recipe",
          output: "SECRET-RECIPE-42",
          error: null,
          usage: null,
          awaitingCapability: false,
          withheldCount: 2,
          stagedResources: ["secret-recipe.txt"],
          createdAt: new Date().toISOString(),
        },
      ],
    });

    render(<App />);
    fireEvent.click((await screen.findAllByText(AGENT_A.name))[0]!);

    await screen.findByText("Only what you granted reached the workspace");
    await screen.findByText("secret-recipe.txt");
    // The heading carries it. A count of files nobody asked for is noise, and
    // "everything you did not grant" was never going to be a list.
    expect(screen.queryByText(/in your namespace/)).toBeNull();
  });

  // Unmounting the World tore down its Pixi app, its poll and every agent's
  // position, so re-opening it mid-run dropped everyone back on a spawn tile
  // and asked you to enter the world again.
  it("keeps the world mounted in the background instead of respawning it", async () => {
    render(<App />);
    await screen.findByText("Create Agent");

    fireEvent.click(screen.getByText("World"));
    fireEvent.click(await screen.findByText("Enter the world"));
    const canvas = await screen.findByTestId("world-canvas");

    fireEvent.click(screen.getByText("← Dashboard"));
    await screen.findByText("Create Agent");

    // The very same node, never torn down and rebuilt.
    expect(screen.getByTestId("world-canvas")).toBe(canvas);
    fireEvent.click(screen.getByText("World"));
    expect(screen.getByTestId("world-canvas")).toBe(canvas);
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

    // The raw API message is unactionable on its own, so the dashboard leads
    // with the way in instead of repeating it -- and instead of offering to
    // create an Agent, which would only route the visitor into another 401.
    await screen.findByText("Sign in to manage your Agents.");
    expect(screen.queryByText("Sign in required")).toBeNull();
    expect(screen.queryByText("Your runtime is ready for an Agent.")).toBeNull();
    expect(screen.queryAllByText(AGENT_A.name)).toHaveLength(0);

    fireEvent.click(screen.getByText("Go to the World"));
    await screen.findByText("Enter the world");

    fireEvent.click(screen.getByText("← Dashboard"));
    // The name renders in both the sidebar row and the detail heading.
    await screen.findAllByText(AGENT_A.name);
    expect(screen.queryByText("Sign in to manage your Agents.")).toBeNull();
  });
});
