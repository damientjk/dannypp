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
