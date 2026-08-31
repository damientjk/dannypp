import type { AgentRunner, RunnerRequest, RunnerResult } from "./types.js";

// Deterministic in-process stand-in for CodexRunner/ContainerCodexRunner,
// selected via RUNTIME_PROVIDER=mock. Used by the qa/bouncer test harness so
// the ownership/audit suite runs fast and without Ark credentials or a
// container engine, while still exercising the real HTTP -> AgentService ->
// PDP -> AuditLog path end to end.
export class MockCodexRunner implements AgentRunner {
  async run(request: RunnerRequest): Promise<RunnerResult> {
    return {
      output: `mock completion for prompt: ${request.prompt}`,
      threadId: request.threadId ?? "mock-thread-id",
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
    };
  }

  async cancel(): Promise<boolean> {
    return true;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
