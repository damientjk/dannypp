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

/** `capabilityWaitMs` defaults to 0 so tests about staging itself stay instant;
 *  the wait has its own test below. */
async function makeService(runner: AgentRunner, capabilityWaitMs = 0) {
  const root = await mkdtemp(path.join(tmpdir(), "launchpad-run-"));
  roots.push(root);
  const config = loadConfig({
    NODE_ENV: "test",
    APP_DATA_DIR: path.join(root, "data"),
    AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
    CODEX_HOME: path.join(root, "codex"),
    ARK_API_KEY: "test-key-value",
    ARK_MODEL: "ep-test",
    CAPABILITY_WAIT_MS: String(capabilityWaitMs),
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

/** The owner handing this Agent a keycard, exactly as the UI's grant does. */
function grant(agentId: string, ownerId: string, scope: string): void {
  capabilityStore.issue({
    agentPrincipal: { kind: "agent", id: "agent:" + agentId, agentId, ownerId },
    scope,
  });
}

describe("a Run sees exactly what its keycard opens", () => {
  it("stages ONLY the file the keycard names, and says what it withheld", async () => {
    // Least privilege, proved physically: a keycard for one file leaves the
    // owner's other two out of the workspace entirely. The run also has to
    // report which it was -- a withheld file is simply absent, so the Agent
    // reports "no such file" and cannot tell refusal from non-existence.
    const runner = new ObservingRunner();
    const { service } = await makeService(runner);
    const caller = callerFor("user-a");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Reader" });
    grant(agent.id, "user-a", "read:res://user-a/secret-recipe.txt");

    const { run } = await service.sendMessage(caller, agent.id, "read the recipe");
    await expect
      .poll(async () => (await service.getRun(caller, run.id)).status)
      .toBe("completed");

    expect(runner.sawInbox).toEqual(["secret-recipe.txt"]);

    const finished = await service.getRun(caller, run.id);
    expect(finished.stagedResources).toEqual(["secret-recipe.txt"]);
    // A count, not a list: the withheld set is "everything you did not grant".
    expect(finished.withheldCount).toBe(2);
  });

  it("stages the owner's resources and nobody else's", async () => {
    const runner = new ObservingRunner();
    const { service } = await makeService(runner);
    const caller = callerFor("user-a");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Reader" });
    grant(agent.id, "user-a", "read:res://user-a/*");

    const { run } = await service.sendMessage(caller, agent.id, "read my notes");
    await expect
      .poll(async () => (await service.getRun(caller, run.id)).status)
      .toBe("completed");

    // User A's three resources, and neither of User B's.
    expect(runner.sawInbox).toEqual([
      "analytics-summary.md",
      "notes.md",
      "secret-recipe.txt",
    ]);
  });

  it("leaves nothing staged after the run finishes", async () => {
    // If a staged file survives the run, the next run reads a resource its own
    // keycard may no longer open -- which is exactly how a revocation demo
    // silently becomes a lie.
    const runner = new ObservingRunner();
    const { service } = await makeService(runner);
    const caller = callerFor("user-a");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Reader" });
    grant(agent.id, "user-a", "read:res://user-a/*");

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
    grant(agent.id, "user-a", "read:res://user-a/*");

    const first = await service.sendMessage(caller, agent.id, "first run");
    await expect
      .poll(async () => (await service.getRun(caller, first.run.id)).status)
      .toBe("completed");
    expect(runner.sawInbox).toEqual([
      "analytics-summary.md",
      "notes.md",
      "secret-recipe.txt",
    ]);

    // The owner shreds every keycard this Agent holds -- the grant AND the
    // execution keycard, which is what suspends it for the next run.
    const shredded = capabilityStore.revokeAllForAgent(agent.id, "user-a");
    expect(shredded.length).toBeGreaterThan(0);

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

  // The whole point of the World's request -> grant exchange: staging is the
  // only moment a resource can physically reach the workspace, so a grant that
  // lands after it would change nothing about the run that provoked it.
  it("waits for a mid-run grant, then stages what it opens", async () => {
    const runner = new ObservingRunner();
    const { service } = await makeService(runner, 5_000);
    const caller = callerFor("user-a");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Reader" });

    // No keycard at all when the run starts.
    const { run } = await service.sendMessage(caller, agent.id, "read the recipe");
    await expect.poll(async () => (await service.getRun(caller, run.id)).status).toBe("running");
    expect(runner.sawInbox).toBe("missing");

    // The owner says yes while the Agent is still waiting at the door.
    grant(agent.id, "user-a", "read:res://user-a/secret-recipe.txt");

    await expect
      .poll(async () => (await service.getRun(caller, run.id)).status, { timeout: 10_000 })
      .toBe("completed");
    expect(runner.sawInbox).toEqual(["secret-recipe.txt"]);
  });

  // Launching the model after an explicit refusal spends a real API call to
  // reach a foregone conclusion, and reports it as a missing file rather than
  // as the refusal it was.
  it("fails the run immediately when the owner refuses, without calling the model", async () => {
    const runner = new ObservingRunner();
    const { service } = await makeService(runner, 10_000);
    const caller = callerFor("user-a");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Reader" });

    const { run } = await service.sendMessage(caller, agent.id, "read the recipe");
    await expect.poll(async () => (await service.getRun(caller, run.id)).status).toBe("running");

    await service.denyCapabilityRequest(caller, agent.id);

    await expect
      .poll(async () => (await service.getRun(caller, run.id)).status, { timeout: 10_000 })
      .toBe("failed");

    const failed = await service.getRun(caller, run.id);
    expect(failed.error).toContain("owner refused access");
    // The model was never invoked.
    expect(runner.sawInbox).toBe("missing");
    // And the owner was never asked. A refusal that arrives this quickly is a
    // decision already made -- prompting for a keycard in the meantime offers
    // a choice that was never available.
    expect(failed.awaitingCapability).toBe(false);
  });

  // Ownership alone is not the permission: with no grant, nothing is staged.
  // And a timeout is not a refusal -- nobody said no, so unlike the test above
  // the run COMPLETES, free to attempt whatever needs no resource at all.
  it("gives up waiting and runs with an empty inbox if nobody grants", async () => {
    const runner = new ObservingRunner();
    const { service } = await makeService(runner, 750);
    const caller = callerFor("user-a");
    const agent = await service.createAgent({ ownerId: "user-a", name: "Reader" });

    const { run } = await service.sendMessage(caller, agent.id, "read the recipe");
    await expect
      .poll(async () => (await service.getRun(caller, run.id)).status, { timeout: 10_000 })
      .toBe("completed");

    expect(runner.sawInbox).toBe("missing");
  });

  it("still runs normally for an agent whose keycard was never revoked", async () => {
    const runner = new ObservingRunner();
    const { service } = await makeService(runner);
    const caller = callerFor("user-b");
    const agent = await service.createAgent({ ownerId: "user-b", name: "B's agent" });
    grant(agent.id, "user-b", "read:res://user-b/*");

    const { run } = await service.sendMessage(caller, agent.id, "go");
    await expect
      .poll(async () => (await service.getRun(caller, run.id)).status)
      .toBe("completed");

    expect(runner.sawInbox).toEqual(["notes.md", "tax-return.txt"]);
  });
});
