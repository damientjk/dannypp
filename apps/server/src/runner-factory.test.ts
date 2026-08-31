import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { createRunner } from "./runner-factory.js";
import { MockCodexRunner } from "./mock-runner.js";

describe("createRunner", () => {
  it("returns a MockCodexRunner when RUNTIME_PROVIDER=mock", () => {
    const config = loadConfig({
      RUNTIME_PROVIDER: "mock",
      ARK_API_KEY: "test-key",
      ARK_MODEL: "ep-test",
      NODE_ENV: "test",
    });
    const runner = createRunner(config);
    expect(runner).toBeInstanceOf(MockCodexRunner);
  });

  it("resolves a run instantly with a deterministic result", async () => {
    const runner = new MockCodexRunner();
    const result = await runner.run({
      agentId: "a1",
      workspacePath: "/tmp/does-not-matter",
      prompt: "say hello",
      threadId: null,
    });
    expect(result.output).toContain("say hello");
    expect(result.threadId).toBe("mock-thread-id");
    expect(await runner.isAvailable()).toBe(true);
  });
});
