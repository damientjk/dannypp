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
