import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearStaging, stageResource, stagingRoot } from "./staging.js";
import type { ResourceRef } from "./store.js";

const workspaces: string[] = [];

async function makeWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), "launchpad-workspace-"));
  workspaces.push(workspace);
  return workspace;
}

afterEach(async () => {
  while (workspaces.length > 0) {
    const workspace = workspaces.pop();
    if (workspace) await rm(workspace, { recursive: true, force: true });
  }
});

const recipe: ResourceRef = {
  uri: "res://user-a/secret-recipe.txt",
  ownerId: "user-a",
  name: "secret-recipe.txt",
};

describe("staging", () => {
  it("writes the resource where the Agent will see it", async () => {
    const workspace = await makeWorkspace();
    const staged = await stageResource(workspace, recipe, "cocoa\n");

    expect(staged).toBe(path.join(workspace, "inbox", "secret-recipe.txt"));
    expect(await readFile(staged, "utf8")).toBe("cocoa\n");
  });

  it("creates nested directories for a nested resource name", async () => {
    const workspace = await makeWorkspace();
    const nested: ResourceRef = {
      uri: "res://user-a/reports/q1.md",
      ownerId: "user-a",
      name: "reports/q1.md",
    };
    const staged = await stageResource(workspace, nested, "q1\n");
    expect(await readFile(staged, "utf8")).toBe("q1\n");
  });

  it("refuses to stage outside the inbox", async () => {
    const workspace = await makeWorkspace();
    const escaping: ResourceRef = {
      uri: "res://user-a/x",
      ownerId: "user-a",
      name: "../../escaped.txt",
    };
    await expect(stageResource(workspace, escaping, "nope")).rejects.toThrow(
      /Refusing to stage outside the inbox/,
    );
  });
});

describe("clearStaging", () => {
  it("REMOVES a staged resource -- the revocation demo depends on this", async () => {
    // Without this, a resource staged by a permitted run is still sitting in
    // the workspace on the next run. The post-revocation attempt would then
    // still succeed and the whole revocation story would be false, while every
    // other test carried on passing.
    const workspace = await makeWorkspace();
    await stageResource(workspace, recipe, "cocoa\n");

    await clearStaging(workspace);

    await expect(readdir(stagingRoot(workspace))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("is safe when nothing was ever staged", async () => {
    const workspace = await makeWorkspace();
    await expect(clearStaging(workspace)).resolves.toBeUndefined();
  });

  it("is safe to call twice", async () => {
    const workspace = await makeWorkspace();
    await stageResource(workspace, recipe, "cocoa\n");
    await clearStaging(workspace);
    await expect(clearStaging(workspace)).resolves.toBeUndefined();
  });

  it("leaves the rest of the workspace untouched", async () => {
    const workspace = await makeWorkspace();
    await stageResource(workspace, recipe, "cocoa\n");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(workspace, "AGENTS.md"), "instructions\n", "utf8");

    await clearStaging(workspace);

    expect(await readdir(workspace)).toEqual(["AGENTS.md"]);
  });
});
