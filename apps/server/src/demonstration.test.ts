/**
 * DEMONSTRATION SUITE -- the backend half.
 *
 * Written to be read out loud in front of a judge. Every test name is a claim
 * and every body is the evidence for it. Three claims are on trial:
 *
 *   1. The decision is really made here, against real files, in the data path.
 *   2. A human can revoke access and the very next attempt changes outcome.
 *   3. Every decision is recorded, attributed, and isolated per human.
 *
 * Plus the folder story: the namespace behind the rooms is a real directory
 * you can add to, nest, and edit, and the guard follows what you put there.
 *
 * Run it with:  npm run test -w @launchpad/server
 * The companion frontend suite is apps/web/src/world/demonstration.test.ts.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { AgentService } from "./agent-service.js";
import { CapabilityStore } from "./capability/store.js";
import { pdp } from "./policy/pdp.js";
import { createResourceAccessGate } from "./resources/access.js";
import { ResourceStore } from "./resources/store.js";

const service = {
  listAgents: () => [],
  systemInfo: async () => ({}),
} as unknown as AgentService;

const AGENT_OF_A = "11111111-1111-4111-8111-111111111111";

/** An id that is well-formed but cannot exist: an Agent carrying no keycard. */
const NO_KEYCARD = "00000000-0000-0000-0000-000000000000";

interface RecordedEntry {
  humanId: string;
  agentId: string;
  action: string;
  resource: string;
  effect: string;
  reason: string;
}

const roots: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function makeWorld() {
  const root = await mkdtemp(path.join(tmpdir(), "launchpad-demo-"));
  roots.push(root);

  const resourceRoot = path.join(root, "resources");
  const resources = new ResourceStore(resourceRoot);
  await resources.initialize();
  const capabilities = new CapabilityStore();
  const recorded: RecordedEntry[] = [];
  const audit = {
    append: async (entry: RecordedEntry) => {
      recorded.push(entry);
      return entry;
    },
  };
  const gate = createResourceAccessGate({ pdp, resources, capabilities, audit });
  const app = await createApp(
    loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
    service,
    { capabilities, resources, gate, audit },
  );
  apps.push(app);
  return { app, capabilities, resources, recorded, resourceRoot };
}

async function signIn(app: FastifyInstance, userId: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { userId, password },
  });
  return response.json().sessionToken as string;
}

/** An Agent walking up to a door with a keycard in hand. */
async function agentAsksFor(app: FastifyInstance, uri: string, capabilityId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/resources/read",
    payload: { uri, capabilityId },
  });
  return {
    status: response.statusCode,
    decision: response.json().decision as { effect: string; reason: string },
    body: response.json() as { content?: string },
  };
}

describe("CLAIM 1: the decision happens in the backend, against real files", () => {
  it("lets an Agent read its own owner's file, and hands back the real contents", async () => {
    const { app, capabilities } = await makeWorld();
    const keycard = capabilities.issueNamespaceRead(
      { kind: "agent", id: "agent:" + AGENT_OF_A, agentId: AGENT_OF_A, ownerId: "user-a" },
      "run-1",
    );

    const result = await agentAsksFor(app, "res://user-a/secret-recipe.txt", keycard.id);

    expect(result.status).toBe(200);
    expect(result.decision.effect).toBe("permit");
    // Proof it touched the filesystem rather than returning a canned "ok".
    expect(result.body.content).toContain("SECRET-RECIPE-42");
  });

  it("REFUSES User A's Agent when it reaches for User B's file", async () => {
    // This is the proof the brief asks for, in one assertion.
    const { app, capabilities } = await makeWorld();
    const keycard = capabilities.issueNamespaceRead(
      { kind: "agent", id: "agent:" + AGENT_OF_A, agentId: AGENT_OF_A, ownerId: "user-a" },
      "run-1",
    );

    const result = await agentAsksFor(app, "res://user-b/tax-return.txt", keycard.id);

    expect(result.status).toBe(403);
    expect(result.decision.reason).toBe("out-of-scope");
    // And B's secret is nowhere in the refusal.
    expect(JSON.stringify(result.body)).not.toContain("SECRET-TAX-99");
  });

  it("refuses an Agent carrying no keycard at all", async () => {
    const { app } = await makeWorld();

    const result = await agentAsksFor(app, "res://user-a/notes.md", NO_KEYCARD);

    expect(result.status).toBe(403);
    expect(result.decision.reason).toBe("capability-unknown");
  });

  it("cannot be tricked by a traversing path dressed up as the owner's own", async () => {
    const { app, capabilities } = await makeWorld();
    const keycard = capabilities.issueNamespaceRead(
      { kind: "agent", id: "agent:" + AGENT_OF_A, agentId: AGENT_OF_A, ownerId: "user-a" },
      "run-1",
    );

    const result = await agentAsksFor(
      app,
      "res://user-a/../user-b/tax-return.txt",
      keycard.id,
    );

    expect(result.status).toBe(403);
    expect(result.decision.reason).toBe("resource-unknown");
  });

  it("refuses to mint a keycard for somebody else's house in the first place", async () => {
    const { app } = await makeWorld();
    const tokenA = await signIn(app, "user-a", "demo-a");

    const response = await app.inject({
      method: "POST",
      url: "/api/capabilities",
      headers: { "x-session-token": tokenA },
      payload: { agentId: AGENT_OF_A, scope: "read:res://user-b/*" },
    });

    // Isolation is enforced at issue time as well as at read time.
    expect(response.statusCode).toBe(400);
  });
});

describe("CLAIM 2: a human can revoke, and execution changes immediately", () => {
  it("permits, then refuses the identical request once the keycard is shredded", async () => {
    const { app, capabilities } = await makeWorld();
    const tokenA = await signIn(app, "user-a", "demo-a");
    const issued = await app.inject({
      method: "POST",
      url: "/api/capabilities",
      headers: { "x-session-token": tokenA },
      payload: { agentId: AGENT_OF_A },
    });
    const keycardId = issued.json().capability.id as string;

    const before = await agentAsksFor(app, "res://user-a/notes.md", keycardId);
    expect(before.decision.effect).toBe("permit");

    await app.inject({
      method: "POST",
      url: `/api/capabilities/${keycardId}/revoke`,
      headers: { "x-session-token": tokenA },
    });

    // Byte-for-byte the same request as `before`. Only the permission changed.
    const after = await agentAsksFor(app, "res://user-a/notes.md", keycardId);
    expect(after.status).toBe(403);
    expect(after.decision.reason).toBe("capability-revoked");
  });

  it("refuses an expired keycard without anyone having to intervene", async () => {
    const { app } = await makeWorld();
    const tokenA = await signIn(app, "user-a", "demo-a");
    const issued = await app.inject({
      method: "POST",
      url: "/api/capabilities",
      headers: { "x-session-token": tokenA },
      payload: { agentId: AGENT_OF_A, ttlMs: -1 },
    });

    const result = await agentAsksFor(
      app,
      "res://user-a/notes.md",
      issued.json().capability.id,
    );

    expect(result.decision.reason).toBe("capability-expired");
  });

  it("lets only the owner shred a keycard", async () => {
    const { app } = await makeWorld();
    const tokenA = await signIn(app, "user-a", "demo-a");
    const tokenB = await signIn(app, "user-b", "demo-b");
    const issued = await app.inject({
      method: "POST",
      url: "/api/capabilities",
      headers: { "x-session-token": tokenA },
      payload: { agentId: AGENT_OF_A },
    });
    const keycardId = issued.json().capability.id as string;

    const byB = await app.inject({
      method: "POST",
      url: `/api/capabilities/${keycardId}/revoke`,
      headers: { "x-session-token": tokenB },
    });

    // Revocation is itself an authorization decision, not bookkeeping.
    expect(byB.statusCode).toBe(403);
  });
});

describe("CLAIM 3: every decision is recorded, attributed and isolated", () => {
  it("writes down the refusals, not only the successes", async () => {
    const { app, capabilities, recorded } = await makeWorld();
    const keycard = capabilities.issueNamespaceRead(
      { kind: "agent", id: "agent:" + AGENT_OF_A, agentId: AGENT_OF_A, ownerId: "user-a" },
      "run-1",
    );

    await agentAsksFor(app, "res://user-a/notes.md", keycard.id);
    await agentAsksFor(app, "res://user-b/tax-return.txt", keycard.id);

    const effects = recorded.map((entry) => entry.effect);
    expect(effects).toContain("permit");
    expect(effects).toContain("deny");
  });

  it("names the human an Agent was acting for", async () => {
    const { app, capabilities, recorded } = await makeWorld();
    const keycard = capabilities.issueNamespaceRead(
      { kind: "agent", id: "agent:" + AGENT_OF_A, agentId: AGENT_OF_A, ownerId: "user-a" },
      "run-1",
    );

    await agentAsksFor(app, "res://user-a/notes.md", keycard.id);

    expect(recorded.at(-1)).toMatchObject({
      humanId: "user-a",
      agentId: AGENT_OF_A,
      action: "resource:read",
      resource: "res://user-a/notes.md",
    });
  });

  it("shows each human their own decisions and nobody else's", async () => {
    const { app } = await makeWorld();
    const tokenA = await signIn(app, "user-a", "demo-a");
    const tokenB = await signIn(app, "user-b", "demo-b");

    // B goes looking at A's namespace and is refused.
    await app.inject({
      url: "/api/resources/content?uri=res%3A%2F%2Fuser-a%2Fnotes.md",
      headers: { "x-session-token": tokenB },
    });

    const trailOfA = await app.inject({
      url: "/api/audit",
      headers: { "x-session-token": tokenA },
    });

    // A's audit view must not contain B's attempt: the log is isolated the
    // same way the resources are.
    expect(JSON.stringify(trailOfA.json())).not.toContain('"humanId":"user-b"');
  });
});

describe("FOLDERS: the namespace is a real directory you control", () => {
  it("guards a file you drop in, with no code change and no restart", async () => {
    const { app, resourceRoot, capabilities } = await makeWorld();
    await writeFile(
      path.join(resourceRoot, "user-a", "quarterly-report.md"),
      "# Q3 (fake demo data)\n",
      "utf8",
    );
    const keycard = capabilities.issueNamespaceRead(
      { kind: "agent", id: "agent:" + AGENT_OF_A, agentId: AGENT_OF_A, ownerId: "user-a" },
      "run-1",
    );

    const tokenA = await signIn(app, "user-a", "demo-a");
    const listing = await app.inject({
      url: "/api/resources",
      headers: { "x-session-token": tokenA },
    });
    const uris = listing.json().resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain("res://user-a/quarterly-report.md");

    // And it is genuinely behind the guard, not merely listed.
    const allowed = await agentAsksFor(app, "res://user-a/quarterly-report.md", keycard.id);
    expect(allowed.decision.effect).toBe("permit");
    const refused = await agentAsksFor(app, "res://user-a/quarterly-report.md", NO_KEYCARD);
    expect(refused.decision.reason).toBe("capability-unknown");
  });

  it("finds files nested in folders, and never offers a folder as a file", async () => {
    const { app, resourceRoot } = await makeWorld();
    await mkdir(path.join(resourceRoot, "user-a", "reports", "2026"), { recursive: true });
    await writeFile(
      path.join(resourceRoot, "user-a", "reports", "2026", "august.md"),
      "# August (fake demo data)\n",
      "utf8",
    );

    const tokenA = await signIn(app, "user-a", "demo-a");
    const listing = await app.inject({
      url: "/api/resources",
      headers: { "x-session-token": tokenA },
    });
    const uris = listing.json().resources.map((r: { uri: string }) => r.uri);

    expect(uris).toContain("res://user-a/reports/2026/august.md");
    expect(uris).not.toContain("res://user-a/reports");
    expect(uris).not.toContain("res://user-a/reports/2026");
  });

  it("tells you which filenames it had to refuse instead of dropping them silently", async () => {
    const { app, resourceRoot } = await makeWorld();
    await writeFile(path.join(resourceRoot, "user-a", "my notes.txt"), "x\n", "utf8");
    await writeFile(path.join(resourceRoot, "user-a", ".env.local"), "x\n", "utf8");

    const tokenA = await signIn(app, "user-a", "demo-a");
    const listing = await app.inject({
      url: "/api/resources",
      headers: { "x-session-token": tokenA },
    });

    // Names outside the URI grammar are reported, so "where did my file go?"
    // has an answer on screen rather than in a maintainer's head.
    expect(listing.json().skipped).toContain("user-a/my notes.txt");
    expect(listing.json().skipped).toContain("user-a/.env.local");
  });

  it("keeps one owner's folder out of another owner's listing-to-read path", async () => {
    const { app, resourceRoot } = await makeWorld();
    await mkdir(path.join(resourceRoot, "user-b", "private"), { recursive: true });
    await writeFile(
      path.join(resourceRoot, "user-b", "private", "diary.md"),
      "SECRET-DIARY (fake demo data)\n",
      "utf8",
    );

    const tokenA = await signIn(app, "user-a", "demo-a");
    // A can SEE that B's file exists -- the world has to draw both houses --
    const listing = await app.inject({
      url: "/api/resources",
      headers: { "x-session-token": tokenA },
    });
    expect(JSON.stringify(listing.json())).toContain("res://user-b/private/diary.md");
    // -- but cannot read a word of it.
    const read = await app.inject({
      url: "/api/resources/content?uri=res%3A%2F%2Fuser-b%2Fprivate%2Fdiary.md",
      headers: { "x-session-token": tokenA },
    });
    expect(read.statusCode).toBe(403);
    expect(read.body).not.toContain("SECRET-DIARY");
  });
});
