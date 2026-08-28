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
  // Imported inside the factory: vi.mock is hoisted above module imports.
  const { TiledMapRenderer } = await import("./engine/TiledMapRenderer");
  const { Texture } = await import("pixi.js");
  const { buildWorldMap } = await import("./mapBuilder");
  const { listFolderRooms } = await import("./folders");
  const renderer = new TiledMapRenderer(buildWorldMap(listFolderRooms()), [Texture.WHITE]);
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

/** Fast enough that a test does not sit through the real roam cadence. */
const FAST_ROAM_MS = 10;

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

  async function login(roamIntervalMs = FAST_ROAM_MS) {
    render(<WorldView roamIntervalMs={roamIntervalMs} />);
    await waitFor(() => {
      const button = screen.getByText("Log in as User A").closest("button");
      expect(button?.disabled).toBe(false);
    });
    fireEvent.click(screen.getByText("Log in as User A"));
    await screen.findByText("Robot A");
  }

  it("shows only the agents owned by the signed-in human", async () => {
    vi.mocked(api.listAgents).mockResolvedValue({
      agents: [AGENT_A, { ...AGENT_A, id: "agent-2", ownerId: "user-b", name: "Robot B" }],
    });

    await login();

    expect(screen.queryByText("Robot B")).toBeNull();
  });

  it("roams on its own and permits a folder its owner owns", async () => {
    await login();

    await waitFor(() => expect(screen.getAllByText("ALLOWED").length).toBeGreaterThan(0), {
      timeout: 4000,
    });
  });

  it("blocks a folder belonging to a different owner", async () => {
    await login();

    await waitFor(() => expect(screen.getAllByText("BLOCKED").length).toBeGreaterThan(0), {
      timeout: 4000,
    });
  });

  it("names the folder and the file each decision was about", async () => {
    await login();

    // The mock tree gives user-a a notes/ folder holding today.md.
    await waitFor(() => expect(screen.getAllByText("notes/").length).toBeGreaterThan(0), {
      timeout: 4000,
    });
  });

  it("blocks every further attempt once the keycard is shredded", async () => {
    await login();
    await waitFor(() => expect(screen.getAllByText("ALLOWED").length).toBeGreaterThan(0), {
      timeout: 4000,
    });

    // The first agent is selected on login, and the name now also appears in
    // the log, so re-selecting by text would be ambiguous.
    fireEvent.click(screen.getByText(/Shred this agent/));

    await waitFor(
      () => {
        const reasons = screen.getAllByText("capability revoked");
        expect(reasons.length).toBeGreaterThan(0);
      },
      { timeout: 4000 },
    );
  });

  it("stops issuing new attempts while roaming is paused", async () => {
    await login();
    await waitFor(() => expect(screen.getAllByText(/ALLOWED|BLOCKED/).length).toBeGreaterThan(0), {
      timeout: 4000,
    });

    fireEvent.click(screen.getByText("Pause roaming"));
    const settled = screen.getAllByText(/ALLOWED|BLOCKED/).length;

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(screen.getAllByText(/ALLOWED|BLOCKED/).length).toBe(settled);
    expect(screen.getByText("Resume roaming")).toBeTruthy();
  });
});
