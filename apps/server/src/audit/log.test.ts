import { mkdtemp, appendFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLog } from "./log.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeLog(): Promise<AuditLog> {
  const root = await mkdtemp(path.join(tmpdir(), "audit-test-"));
  temporaryDirectories.push(root);
  const log = new AuditLog(path.join(root, "audit.jsonl"));
  await log.initialize();
  return log;
}

describe("AuditLog", () => {
  it("appends and lists entries most-recent-first", async () => {
    const log = await makeLog();
    await log.append({
      requestId: "r1",
      decidedAt: new Date().toISOString(),
      humanId: "user-a",
      agentId: "agent-1",
      principalKind: "human",
      action: "agent:read",
      resource: "agent:user-a:agent-1",
      effect: "permit",
      reason: "owner-match",
    });
    await log.append({
      requestId: "r2",
      decidedAt: new Date().toISOString(),
      humanId: "user-b",
      agentId: "agent-1",
      principalKind: "human",
      action: "agent:read",
      resource: "agent:user-a:agent-1",
      effect: "deny",
      reason: "not-owner",
    });
    const entries = await log.list();
    expect(entries.map((entry) => entry.requestId)).toEqual(["r2", "r1"]);
  });

  it("scopes listForHuman to only that human's entries", async () => {
    const log = await makeLog();
    await log.append({
      requestId: "r1",
      decidedAt: new Date().toISOString(),
      humanId: "user-a",
      agentId: "agent-1",
      principalKind: "human",
      action: "agent:read",
      resource: "agent:user-a:agent-1",
      effect: "permit",
      reason: "owner-match",
    });
    await log.append({
      requestId: "r2",
      decidedAt: new Date().toISOString(),
      humanId: "user-b",
      agentId: "agent-2",
      principalKind: "human",
      action: "agent:read",
      resource: "agent:user-b:agent-2",
      effect: "permit",
      reason: "owner-match",
    });
    const forA = await log.listForHuman("user-a");
    expect(forA).toHaveLength(1);
    expect(forA[0]?.requestId).toBe("r1");
  });

  it("tolerates a torn trailing line instead of failing to read", async () => {
    const log = await makeLog();
    await log.append({
      requestId: "r1",
      decidedAt: new Date().toISOString(),
      humanId: "user-a",
      agentId: "agent-1",
      principalKind: "human",
      action: "agent:read",
      resource: "agent:user-a:agent-1",
      effect: "permit",
      reason: "owner-match",
    });
    await appendFile((log as unknown as { filePath: string }).filePath, '{"id":"broken"', "utf8");
    const entries = await log.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.requestId).toBe("r1");
  });
});
