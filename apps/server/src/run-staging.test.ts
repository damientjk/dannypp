/**
 * End-to-end: does the middleware actually change what an Agent Run can see?
 *
 * These are the tests that decide whether the demo is real. Everything else
 * proves a decision was made; these prove the decision had a physical
 * consequence in the Agent's workspace.
 */

import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "./agent-service.js";
import { AuditLog } from "./audit/log.js";
import { capabilityStore } from "./capability/store.js";
import { loadConfig } from "./config.js";
import type { CallerContext } from "./policy/pep.js";
import { pdp } from "./policy/pdp.js";
import { createResourceAccessGate } from "./resources/access.js";
import { ResourceStore } from "./resources/store.js";
import { stagingRoot } from "./resources/staging.js";
import { JsonStore } from "./store.js";
import type { AgentRunner, RunnerRequest, RunnerResult } from "./types.js";
import { WorkspaceManager } from "./workspace.js";

const roots: string[] = [];

afterEach(async () => {
  capabilityStore.clear();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function callerFor(userId: string): CallerContext {
  return {
    principal: { kind: "human", id: userId, displayName: userId },
    requestId: randomUUID(),
  };
}

/** Records what the workspace looked like at the moment the model ran. */
class ObservingRunner implements AgentRunner {
  public sawInbox: string[] | "missing" = "missing";
  async run(request: RunnerRequest): Promise<RunnerResult> {
    try {
      this.sawInbox = (await readdir(stagingRoot(request.workspacePath))).sort();
    } catch {
      this.sawInbox = "missing";
    }
    return { output: "done", threadId: "t", usage: null };
  }
  async cancel(): Promise<boolean> {
    return false;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

async function makeService(runner: AgentRunner) {
  const root = await mkdtemp(path.join(tmpdir(), "launchpad-run-"));
  roots.push(root);
  const config = loadConfig({
    NODE_ENV: "test",
    APP_DATA_DIR: path.join(root, "data"),
    AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
    CODEX_HOME: path.join(root, "codex"),
    ARK_API_KEY: "test-key-value",
    ARK_MODEL: "ep-test",
  });
  const resources = new ResourceStore(path.join(root, "data", "resources"));
  await resources.initialize();
  const gate = createResourceAccessGate({
    pdp,
    resources,
    capabilities: capabilityStore,
  });
  const audit = new AuditLog(path.join(root, "data", "audit.jsonl"));
  await audit.initialize();
  const service = new AgentService(
    config,
    new JsonStore(path.join(root, "data", "db.json")),
    new WorkspaceManager(path.join(root, "workspaces")),
    runner,
    audit,
    { gate, resources },
  );
  await service.initialize();
  return { service, root };
}

describe("a Run sees exactly what its keycard opens", () => {
  it("stages the owner's resources and nobody else's", async () => {
    const runner = new ObservingRunner();
    const { service } = await makeService(runner);
    const caller = callerFor("user-a");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Reader" });

    const { run } = await service.sendMessage(caller, agent.id, "read my notes");
    await expect
      .poll(async () => (await service.getRun(caller, run.id)).status)
      .toBe("completed");

    // User A's two resources, and neither of User B's.
    expect(runner.sawInbox).toEqual(["notes.md", "secret-recipe.txt"]);
  });

  it("leaves nothing staged after the run finishes", async () => {
    // If a staged file survives the run, the next run reads a resource its own
    // keycard may no longer open -- which is exactly how a revocation demo
    // silently becomes a lie.
    const runner = new ObservingRunner();
    const { service } = await makeService(runner);
    const caller = callerFor("user-a");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Reader" });

    const { run } = await service.sendMessage(caller, agent.id, "go");
    await expect
      .poll(async () => (await service.getRun(caller, run.id)).status)
      .toBe("completed");

    const staged = await readdir(stagingRoot(agent.workspacePath)).catch(() => []);
    expect(staged).toEqual([]);
  });

  it("REVOCATION changes execution: the next run is denied and stages nothing", async () => {
    // The headline demo moment, proved against a real Run.
    const runner = new ObservingRunner();
    const { service } = await makeService(runner);
    const caller = callerFor("user-a");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Reader" });

    const first = await service.sendMessage(caller, agent.id, "first run");
    await expect
      .poll(async () => (await service.getRun(caller, first.run.id)).status)
      .toBe("completed");
    expect(runner.sawInbox).toEqual(["notes.md", "secret-recipe.txt"]);

    // The owner shreds the keycard the run was issued.
    const issued = capabilityStore.list({ agentId: agent.id });
    expect(issued.length).toBeGreaterThan(0);
    const target = issued[0];
    if (!target) throw new Error("expected an issued capability");
    capabilityStore.revoke(target.id, "user-a");

    runner.sawInbox = "missing";
    const second = await service.sendMessage(caller, agent.id, "second run");
    await expect
      .poll(async () => (await service.getRun(caller, second.run.id)).status)
      .toBe("failed");

    const failed = await service.getRun(caller, second.run.id);
    expect(failed.error).toContain("capability-revoked");
    // The model was never invoked, so it saw nothing at all.
    expect(runner.sawInbox).toBe("missing");
    const staged = await readdir(stagingRoot(agent.workspacePath)).catch(() => []);
    expect(staged).toEqual([]);
  });

  it("still runs normally for an agent whose keycard was never revoked", async () => {
    const runner = new ObservingRunner();
    const { service } = await makeService(runner);
    const caller = callerFor("user-b");
    const agent = await service.createAgent({ ownerId: "user-b", name: "B's agent" });

    const { run } = await service.sendMessage(caller, agent.id, "go");
    await expect
      .poll(async () => (await service.getRun(caller, run.id)).status)
      .toBe("completed");

    expect(runner.sawInbox).toEqual(["notes.md", "tax-return.txt"]);
  });
});
