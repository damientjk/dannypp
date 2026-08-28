import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { AgentService } from "./agent-service.js";
import type { AgentPrincipal } from "./types.js";
import { CapabilityStore } from "./capability/store.js";
import { pdp } from "./policy/pdp.js";
import { createResourceAccessGate } from "./resources/access.js";
import { ResourceStore } from "./resources/store.js";

const service = {
  listAgents: () => [],
  systemInfo: async () => ({}),
} as unknown as AgentService;

const AGENT_ID = "11111111-1111-4111-8111-111111111111";

const agentOfA: AgentPrincipal = {
  kind: "agent",
  id: "agent:" + AGENT_ID,
  agentId: AGENT_ID,
  ownerId: "user-a",
};

const roots: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function makeApp() {
  const root = await mkdtemp(path.join(tmpdir(), "launchpad-routes-"));
  roots.push(root);

  const resources = new ResourceStore(path.join(root, "resources"));
  await resources.initialize();
  const capabilities = new CapabilityStore();
  const gate = createResourceAccessGate({
    pdp: pdp,
    resources,
    capabilities,
  });

  const app = await createApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }), service, {
    capabilities,
    resources,
    gate,
  });
  apps.push(app);
  return { app, capabilities, resources };
}

async function login(app: FastifyInstance, userId: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { userId, password },
  });
  expect(response.statusCode).toBe(200);
  return response.json().sessionToken as string;
}

describe("capability routes", () => {
  it("requires a session", async () => {
    const { app } = await makeApp();
    expect((await app.inject({ url: "/api/capabilities" })).statusCode).toBe(401);
  });

  it("lists only the signed-in user's own capabilities", async () => {
    const { app, capabilities } = await makeApp();
    capabilities.issueForRun(agentOfA, "run-1");
    capabilities.issueForRun(
      { kind: "agent", id: "agent:other", agentId: AGENT_ID, ownerId: "user-b" },
      "run-2",
    );

    const tokenA = await login(app, "user-a", "demo-a");
    const response = await app.inject({
      url: "/api/capabilities",
      headers: { "x-session-token": tokenA },
    });

    const body = response.json();
    expect(body.capabilities).toHaveLength(1);
    expect(body.capabilities[0].ownerId).toBe("user-a");
  });

  it("lets the owner shred their keycard and returns the updated record", async () => {
    const { app, capabilities } = await makeApp();
    const capability = capabilities.issueForRun(agentOfA, "run-1");
    const tokenA = await login(app, "user-a", "demo-a");

    const response = await app.inject({
      method: "POST",
      url: "/api/capabilities/" + capability.id + "/revoke",
      headers: { "x-session-token": tokenA },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().capability.revokedAt).not.toBeNull();
    expect(response.json().capability.revokedBy).toBe("user-a");
    expect(capabilities.validate(capability.id).valid).toBe(false);
  });

  it("REFUSES user B shredding user A's keycard", async () => {
    // Revocation is itself an authorization decision, not bookkeeping.
    const { app, capabilities } = await makeApp();
    const capability = capabilities.issueForRun(agentOfA, "run-1");
    const tokenB = await login(app, "user-b", "demo-b");

    const response = await app.inject({
      method: "POST",
      url: "/api/capabilities/" + capability.id + "/revoke",
      headers: { "x-session-token": tokenB },
    });

    expect(response.statusCode).toBe(403);
    expect(capabilities.validate(capability.id).valid).toBe(true);
  });

  it("mints a keycard scoped to the caller's own namespace", async () => {
    const { app } = await makeApp();
    const tokenA = await login(app, "user-a", "demo-a");

    const response = await app.inject({
      method: "POST",
      url: "/api/capabilities",
      headers: { "x-session-token": tokenA },
      payload: { agentId: AGENT_ID },
    });

    expect(response.statusCode).toBe(201);
    const capability = response.json().capability;
    expect(capability.ownerId).toBe("user-a");
    expect(capability.scope).toBe("read:res://user-a/*");
  });

  it("REFUSES to mint a keycard for the other user's namespace", async () => {
    // The owner comes from the session, so a forged scope cannot widen it.
    const { app } = await makeApp();
    const tokenA = await login(app, "user-a", "demo-a");

    const response = await app.inject({
      method: "POST",
      url: "/api/capabilities",
      headers: { "x-session-token": tokenA },
      payload: { agentId: AGENT_ID, scope: "read:res://user-b/*" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/Refusing to issue/);
  });

  it("refuses a malformed scope", async () => {
    const { app } = await makeApp();
    const tokenA = await login(app, "user-a", "demo-a");
    const response = await app.inject({
      method: "POST",
      url: "/api/capabilities",
      headers: { "x-session-token": tokenA },
      payload: { agentId: AGENT_ID, scope: "read:res://user-a/../user-b/*" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("404s an unknown capability", async () => {
    const { app } = await makeApp();
    const tokenA = await login(app, "user-a", "demo-a");
    const response = await app.inject({
      method: "POST",
      url: "/api/capabilities/22222222-2222-4222-8222-222222222222/revoke",
      headers: { "x-session-token": tokenA },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("resource routes -- the agent read path", () => {
  it("permits a read of the owner's resource and returns the decision", async () => {
    const { app, capabilities } = await makeApp();
    const capability = capabilities.issueForRun(agentOfA, "run-1");

    const response = await app.inject({
      method: "POST",
      url: "/api/resources/read",
      payload: {
        uri: "res://user-a/secret-recipe.txt",
        capabilityId: capability.id,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.decision.effect).toBe("permit");
    expect(body.content).toContain("SECRET-RECIPE-42");
  });

  it("DENIES user A's agent reading user B -- the blessed proof, over HTTP", async () => {
    const { app, capabilities } = await makeApp();
    const capability = capabilities.issueForRun(agentOfA, "run-1");

    const response = await app.inject({
      method: "POST",
      url: "/api/resources/read",
      payload: {
        uri: "res://user-b/tax-return.txt",
        capabilityId: capability.id,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.decision.effect).toBe("deny");
    expect(body.decision.reason).toBe("out-of-scope");
    expect(JSON.stringify(body)).not.toContain("SECRET-TAX-99");
  });

  it("denies the same read once the keycard is shredded", async () => {
    const { app, capabilities } = await makeApp();
    const capability = capabilities.issueForRun(agentOfA, "run-1");
    const payload = {
      uri: "res://user-a/secret-recipe.txt",
      capabilityId: capability.id,
    };

    const before = await app.inject({
      method: "POST",
      url: "/api/resources/read",
      payload,
    });
    expect(before.statusCode).toBe(200);

    const tokenA = await login(app, "user-a", "demo-a");
    await app.inject({
      method: "POST",
      url: "/api/capabilities/" + capability.id + "/revoke",
      headers: { "x-session-token": tokenA },
    });

    const after = await app.inject({
      method: "POST",
      url: "/api/resources/read",
      payload,
    });
    expect(after.statusCode).toBe(403);
    expect(after.json().decision.reason).toBe("capability-revoked");
  });

  it("denies an unknown capability without leaking whether the resource exists", async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/resources/read",
      payload: {
        uri: "res://user-b/tax-return.txt",
        capabilityId: "33333333-3333-4333-8333-333333333333",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().decision.reason).toBe("capability-unknown");
  });

  it("denies an expired keycard", async () => {
    const { app } = await makeApp();
    const tokenA = await login(app, "user-a", "demo-a");
    const issued = await app.inject({
      method: "POST",
      url: "/api/capabilities",
      headers: { "x-session-token": tokenA },
      payload: { agentId: AGENT_ID, ttlMs: -1 },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/resources/read",
      payload: {
        uri: "res://user-a/notes.md",
        capabilityId: issued.json().capability.id,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().decision.reason).toBe("capability-expired");
  });

  it("rejects a traversing URI", async () => {
    const { app, capabilities } = await makeApp();
    const capability = capabilities.issueForRun(agentOfA, "run-1");

    const response = await app.inject({
      method: "POST",
      url: "/api/resources/read",
      payload: {
        uri: "res://user-a/../user-b/tax-return.txt",
        capabilityId: capability.id,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().decision.reason).toBe("resource-unknown");
  });
});

describe("resource routes -- the human read path", () => {
  it("lets a human read their own namespace", async () => {
    const { app } = await makeApp();
    const tokenA = await login(app, "user-a", "demo-a");
    const response = await app.inject({
      url: "/api/resources/content?uri=res%3A%2F%2Fuser-a%2Fnotes.md",
      headers: { "x-session-token": tokenA },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().decision.effect).toBe("permit");
  });

  it("stops a human reading the other user's namespace", async () => {
    const { app } = await makeApp();
    const tokenA = await login(app, "user-a", "demo-a");
    const response = await app.inject({
      url: "/api/resources/content?uri=res%3A%2F%2Fuser-b%2Ftax-return.txt",
      headers: { "x-session-token": tokenA },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().decision.reason).toBe("out-of-scope");
  });

  it("lists both namespaces as metadata without exposing contents", async () => {
    const { app } = await makeApp();
    const tokenA = await login(app, "user-a", "demo-a");
    const response = await app.inject({
      url: "/api/resources",
      headers: { "x-session-token": tokenA },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.resources).toHaveLength(4);
    // The frontend needs to draw both houses; it must not receive what is inside.
    expect(JSON.stringify(body)).not.toContain("SECRET-TAX-99");
    expect(JSON.stringify(body)).not.toContain("SECRET-RECIPE-42");
  });
});
