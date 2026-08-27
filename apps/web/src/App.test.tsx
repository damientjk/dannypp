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
