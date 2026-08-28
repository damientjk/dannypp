import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "./agent-service.js";
import { AuditLog } from "./audit/log.js";
import { loadConfig } from "./config.js";
import type { CallerContext } from "./policy/pep.js";
import { JsonStore } from "./store.js";
import type { AgentRunner, RunnerRequest, RunnerResult } from "./types.js";
import { WorkspaceManager } from "./workspace.js";

function callerFor(userId: string): CallerContext {
  return { principal: { kind: "human", id: userId, displayName: userId }, requestId: randomUUID() };
}

class FakeRunner implements AgentRunner {
  async run(request: RunnerRequest): Promise<RunnerResult> {
    return {
      output: "Completed: " + request.prompt,
      threadId: request.threadId ?? "fake-thread",
      usage: { inputTokens: 12, outputTokens: 5 },
    };
  }
  async cancel(): Promise<boolean> {
    return false;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makeService(runner: AgentRunner = new FakeRunner()): Promise<AgentService> {
  const root = await mkdtemp(path.join(tmpdir(), "launchpad-test-"));
  temporaryDirectories.push(root);
  const config = loadConfig({
    NODE_ENV: "test",
    APP_DATA_DIR: path.join(root, "data"),
    AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
    CODEX_HOME: path.join(root, "codex"),
    ARK_API_KEY: "test-key",
    ARK_MODEL: "ep-test",
  });
  const audit = new AuditLog(path.join(root, "data", "audit.jsonl"));
  await audit.initialize();
  const service = new AgentService(
    config,
    new JsonStore(path.join(root, "data", "db.json")),
    new WorkspaceManager(path.join(root, "workspaces")),
    runner,
    audit,
  );
  await service.initialize();
  return service;
}

describe("Agent lifecycle", () => {
  it("creates, updates, stops, starts and deletes an Agent", async () => {
    const service = await makeService();
    const caller = callerFor("user-a");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Builder" });
    expect(service.listAgents(caller)).toHaveLength(1);
    expect(
      (await service.updateAgent(caller, agent.id, { description: "Builds apps" })).description,
    ).toBe("Builds apps");
    expect((await service.stopAgent(caller, agent.id)).status).toBe("stopped");
    expect((await service.startAgent(caller, agent.id)).status).toBe("ready");
    await service.deleteAgent(caller, agent.id);
    expect(service.listAgents(caller)).toHaveLength(0);
  });

  it("persists a playground conversation", async () => {
    const service = await makeService();
    const caller = callerFor("user-a");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Coder" });
    const { run } = await service.sendMessage(caller, agent.id, "write hello world");
    await expect.poll(async () => (await service.getRun(caller, run.id)).status).toBe("completed");
    const messages = await service.getMessages(caller, agent.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content).toContain("write hello world");
    expect((await service.getAgent(caller, agent.id)).codexThreadId).toBe("fake-thread");
  });

  it("denies a non-owner from reading, editing, or messaging another user's agent", async () => {
    const service = await makeService();
    const owner = callerFor("user-a");
    const intruder = callerFor("user-b");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Isolated" });

    await expect(service.getAgent(intruder, agent.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.updateAgent(intruder, agent.id, { name: "hijacked" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.sendMessage(intruder, agent.id, "leak secrets")).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(await service.getAgent(owner, agent.id)).toBeTruthy();
  });

  it("atomically accepts only one concurrent run per Agent", async () => {
    let finish!: (result: RunnerResult) => void;
    const pending = new Promise<RunnerResult>((resolve) => {
      finish = resolve;
    });
    const runner: AgentRunner = {
      run: () => pending,
      cancel: async () => false,
      isAvailable: async () => true,
    };
    const service = await makeService(runner);
    const caller = callerFor("user-a");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Concurrent" });
    const attempts = await Promise.allSettled([
      service.sendMessage(caller, agent.id, "first"),
      service.sendMessage(caller, agent.id, "second"),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({ reason: { statusCode: 409 } });
    expect(await service.getMessages(caller, agent.id)).toHaveLength(1);

    finish({ output: "done", threadId: "thread", usage: null });
    const accepted = attempts.find((attempt) => attempt.status === "fulfilled");
    if (accepted?.status === "fulfilled") {
      await expect
        .poll(async () => (await service.getRun(caller, accepted.value.run.id)).status)
        .toBe("completed");
    }
  });

  it("does not let start reset a busy Agent and admit a second run", async () => {
    let finish!: (result: RunnerResult) => void;
    const pending = new Promise<RunnerResult>((resolve) => {
      finish = resolve;
    });
    const service = await makeService({
      run: () => pending,
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const caller = callerFor("user-a");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Busy" });
    const { run } = await service.sendMessage(caller, agent.id, "first");

    await expect(service.startAgent(caller, agent.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.sendMessage(caller, agent.id, "second")).rejects.toMatchObject({
      statusCode: 409,
    });

    finish({ output: "done", threadId: "thread", usage: null });
    await expect.poll(async () => (await service.getRun(caller, run.id)).status).toBe("completed");
  });
});
