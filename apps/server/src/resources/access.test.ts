import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentPrincipal,
  HumanPrincipal,
  PolicyDecisionPoint,
} from "../types.js";
import { pdp } from "../policy/pdp.js";
import { agentPrincipalFor, CapabilityStore } from "../capability/store.js";
import { createResourceAccessGate } from "./access.js";
import { stagingRoot } from "./staging.js";
import { ResourceStore } from "./store.js";

const cleanup: string[] = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    const target = cleanup.pop();
    if (target) await rm(target, { recursive: true, force: true });
  }
});

async function makeFixture(policy: PolicyDecisionPoint = pdp) {
  const root = await mkdtemp(path.join(tmpdir(), "launchpad-gate-"));
  const workspace = await mkdtemp(path.join(tmpdir(), "launchpad-ws-"));
  cleanup.push(root, workspace);

  const resources = new ResourceStore(root);
  await resources.initialize();
  const capabilities = new CapabilityStore();
  const gate = createResourceAccessGate({ pdp: policy, resources, capabilities });

  const agentOfA: AgentPrincipal = {
    kind: "agent",
    id: "agent:agent-1",
    agentId: "agent-1",
    ownerId: "user-a",
  };

  return { resources, capabilities, gate, workspace, agentOfA };
}

describe("resource access gate -- the enforcement point", () => {
  it("permits and stages user A's resource for user A's agent", async () => {
    const fixture = await makeFixture();
    const capability = fixture.capabilities.issueNamespaceRead(fixture.agentOfA, "run-1");

    const result = await fixture.gate.access({
      principal: fixture.agentOfA,
      action: "read",
      resourceUri: "res://user-a/secret-recipe.txt",
      requestId: "req-1",
      capabilityId: capability.id,
      workspacePath: fixture.workspace,
    });

    expect(result.effect).toBe("permit");
    if (result.effect !== "permit") return;
    expect(result.content).toContain("SECRET-RECIPE-42");
    expect(result.stagedPath).toBe(
      path.join(fixture.workspace, "inbox", "secret-recipe.txt"),
    );
    expect(await readdir(stagingRoot(fixture.workspace))).toEqual([
      "secret-recipe.txt",
    ]);
  });

  it("DENIES user A's agent reading user B, and stages nothing", async () => {
    const fixture = await makeFixture();
    const capability = fixture.capabilities.issueNamespaceRead(fixture.agentOfA, "run-1");

    const result = await fixture.gate.access({
      principal: fixture.agentOfA,
      action: "read",
      resourceUri: "res://user-b/tax-return.txt",
      requestId: "req-2",
      capabilityId: capability.id,
      workspacePath: fixture.workspace,
    });

    expect(result.effect).toBe("deny");
    expect(result.decision.reason).toBe("out-of-scope");
    // No file was written: the Agent has literally nothing to read.
    await expect(readdir(stagingRoot(fixture.workspace))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("changes the outcome of the very next access after revocation", async () => {
    // This is the "execution changes after revocation" evidence, at unit level.
    const fixture = await makeFixture();
    const capability = fixture.capabilities.issueNamespaceRead(fixture.agentOfA, "run-1");

    const before = await fixture.gate.access({
      principal: fixture.agentOfA,
      action: "read",
      resourceUri: "res://user-a/secret-recipe.txt",
      requestId: "req-before",
      capabilityId: capability.id,
      workspacePath: fixture.workspace,
    });
    expect(before.effect).toBe("permit");

    await fixture.gate.clear(fixture.workspace);
    fixture.capabilities.revoke(capability.id, "user-a");

    const after = await fixture.gate.access({
      principal: fixture.agentOfA,
      action: "read",
      resourceUri: "res://user-a/secret-recipe.txt",
      requestId: "req-after",
      capabilityId: capability.id,
      workspacePath: fixture.workspace,
    });

    expect(after.effect).toBe("deny");
    expect(after.decision.reason).toBe("capability-revoked");
    await expect(readdir(stagingRoot(fixture.workspace))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("denies an expired capability", async () => {
    const fixture = await makeFixture();
    const capability = fixture.capabilities.issue({
      agentPrincipal: fixture.agentOfA,
      scope: "read:res://user-a/*",
      ttlMs: -1,
    });

    const result = await fixture.gate.access({
      principal: fixture.agentOfA,
      action: "read",
      resourceUri: "res://user-a/notes.md",
      requestId: "req-3",
      capabilityId: capability.id,
    });

    expect(result.decision.reason).toBe("capability-expired");
  });

  it("denies a malformed resource without consulting the PDP", async () => {
    let consulted = false;
    const spyPdp: PolicyDecisionPoint = {
      async decide(request) {
        consulted = true;
        return pdp.decide(request);
      },
    };
    const fixture = await makeFixture(spyPdp);

    const result = await fixture.gate.access({
      principal: fixture.agentOfA,
      action: "read",
      resourceUri: "res://user-a/../user-b/tax-return.txt",
      requestId: "req-4",
    });

    expect(result.decision.reason).toBe("resource-unknown");
    expect(consulted).toBe(false);
  });

  it("permits a human reading their own namespace with no capability", async () => {
    const fixture = await makeFixture();
    const humanA: HumanPrincipal = {
      kind: "human",
      id: "user-a",
      displayName: "User A",
    };

    const result = await fixture.gate.access({
      principal: humanA,
      action: "read",
      resourceUri: "res://user-a/notes.md",
      requestId: "req-5",
    });

    expect(result.effect).toBe("permit");
  });

  it("writes only under a write-scoped capability", async () => {
    const fixture = await makeFixture();
    const readOnly = fixture.capabilities.issueNamespaceRead(fixture.agentOfA, "run-1");

    const denied = await fixture.gate.access({
      principal: fixture.agentOfA,
      action: "write",
      resourceUri: "res://user-a/notes.md",
      requestId: "req-6",
      capabilityId: readOnly.id,
      content: "tampered\n",
    });
    expect(denied.decision.reason).toBe("action-not-in-scope");
    // The denial must not have written anything.
    expect(await fixture.resources.read("res://user-a/notes.md")).not.toContain(
      "tampered",
    );

    const writable = fixture.capabilities.issue({
      agentPrincipal: fixture.agentOfA,
      scope: "read,write:res://user-a/notes.md",
    });
    const permitted = await fixture.gate.access({
      principal: fixture.agentOfA,
      action: "write",
      resourceUri: "res://user-a/notes.md",
      requestId: "req-7",
      capabilityId: writable.id,
      content: "approved\n",
    });
    expect(permitted.effect).toBe("permit");
    expect(await fixture.resources.read("res://user-a/notes.md")).toBe("approved\n");
  });

  it("derives the agent principal from the capability it was minted for", async () => {
    const fixture = await makeFixture();
    const capability = fixture.capabilities.issueNamespaceRead(fixture.agentOfA, "run-1");
    expect(agentPrincipalFor(capability)).toEqual(fixture.agentOfA);
  });
});

describe("default-deny when the guard itself fails", () => {
  it("denies when the PDP throws", async () => {
    const brokenPdp: PolicyDecisionPoint = {
      async decide() {
        throw new Error("PDP exploded");
      },
    };
    const fixture = await makeFixture(brokenPdp);
    const capability = fixture.capabilities.issueNamespaceRead(fixture.agentOfA, "run-1");

    const result = await fixture.gate.access({
      principal: fixture.agentOfA,
      action: "read",
      resourceUri: "res://user-a/secret-recipe.txt",
      requestId: "req-8",
      capabilityId: capability.id,
      workspacePath: fixture.workspace,
    });

    expect(result.effect).toBe("deny");
    expect(result.decision.reason).toBe("policy-error");
    await expect(readdir(stagingRoot(fixture.workspace))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("denies when the PDP returns something that is not a decision", async () => {
    const nonsensePdp = {
      async decide() {
        return { nonsense: true };
      },
    } as unknown as PolicyDecisionPoint;
    const fixture = await makeFixture(nonsensePdp);
    const capability = fixture.capabilities.issueNamespaceRead(fixture.agentOfA, "run-1");

    const result = await fixture.gate.access({
      principal: fixture.agentOfA,
      action: "read",
      resourceUri: "res://user-a/notes.md",
      requestId: "req-9",
      capabilityId: capability.id,
    });

    expect(result.effect).toBe("deny");
    expect(result.decision.reason).toBe("policy-error");
  });

  it("denies when the PDP never returns, rather than hanging the run", async () => {
    // A PDP that resolves to undefined is the realistic shape of a partially
    // implemented decide(). It must read as a denial, not as a permit.
    const emptyPdp = {
      async decide() {
        return undefined;
      },
    } as unknown as PolicyDecisionPoint;
    const fixture = await makeFixture(emptyPdp);

    const result = await fixture.gate.access({
      principal: fixture.agentOfA,
      action: "read",
      resourceUri: "res://user-a/notes.md",
      requestId: "req-10",
    });

    expect(result.decision.reason).toBe("policy-error");
  });
});
