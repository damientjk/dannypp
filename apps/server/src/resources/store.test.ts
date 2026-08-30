import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResourceStore } from "./store.js";

const temporaryRoots: string[] = [];

async function makeStore(): Promise<ResourceStore> {
  const root = await mkdtemp(path.join(tmpdir(), "launchpad-resources-"));
  temporaryRoots.push(root);
  const store = new ResourceStore(root);
  await store.initialize();
  return store;
}

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("resource seeding", () => {
  it("creates both users' namespaces with fake demo content", async () => {
    const store = await makeStore();
    const all = await store.list();

    expect(all.map((ref) => ref.uri)).toEqual([
      "res://user-a/notes.md",
      "res://user-a/secret-recipe.txt",
      "res://user-b/notes.md",
      "res://user-b/tax-return.txt",
    ]);
  });

  it("marks the seeded secrets as fake, so demo output is safe to publish", async () => {
    const store = await makeStore();
    expect(await store.read("res://user-a/secret-recipe.txt")).toContain(
      "fake demo data",
    );
    expect(await store.read("res://user-b/tax-return.txt")).toContain(
      "fake demo data",
    );
  });

  it("does not overwrite an edited resource on a second boot", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-resources-"));
    temporaryRoots.push(root);

    const first = new ResourceStore(root);
    await first.initialize();
    await first.write("res://user-a/notes.md", "edited by the demo\n");

    const second = new ResourceStore(root);
    await second.initialize();

    expect(await second.read("res://user-a/notes.md")).toBe("edited by the demo\n");
  });

  it("lists only one owner when asked", async () => {
    const store = await makeStore();
    const refs = await store.list("user-b");
    expect(refs).toHaveLength(2);
    expect(refs.every((ref) => ref.ownerId === "user-b")).toBe(true);
  });
});

describe("resource reads and writes", () => {
  it("round-trips a write", async () => {
    const store = await makeStore();
    await store.write("res://user-a/notes.md", "hello\n");
    expect(await store.read("res://user-a/notes.md")).toBe("hello\n");
  });

  it("leaves no .tmp file behind after a write", async () => {
    const store = await makeStore();
    await store.write("res://user-a/notes.md", "hello\n");
    const names = (await store.list("user-a")).map((ref) => ref.name);
    expect(names.some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("reports existence", async () => {
    const store = await makeStore();
    expect(await store.exists("res://user-a/notes.md")).toBe(true);
    expect(await store.exists("res://user-a/ghost.md")).toBe(false);
    expect(await store.exists("res://user-a/../user-b/notes.md")).toBe(false);
  });
});

describe("resource store isolation", () => {
  it("rejects an unknown owner", async () => {
    const store = await makeStore();
    expect(store.parse("res://user-c/notes.md")).toBeNull();
    expect(store.ownerOf("res://user-c/notes.md")).toBeNull();
  });

  it("rejects traversal before it reaches the filesystem", async () => {
    const store = await makeStore();
    expect(store.parse("res://user-a/../user-b/tax-return.txt")).toBeNull();
    await expect(
      store.read("res://user-a/../user-b/tax-return.txt"),
    ).rejects.toThrow(/Unknown resource/);
  });

  it("never reads outside the data root", async () => {
    const store = await makeStore();
    await expect(store.read("res://user-a/../../../etc/passwd")).rejects.toThrow();
  });

  it("keeps the two namespaces in separate directories on disk", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-resources-"));
    temporaryRoots.push(root);
    const store = new ResourceStore(root);
    await store.initialize();

    const aOnDisk = await readFile(
      path.join(root, "user-a", "secret-recipe.txt"),
      "utf8",
    );
    expect(aOnDisk).toContain("SECRET-RECIPE-42");
    // User B's directory must not contain user A's content.
    const bNotes = await readFile(path.join(root, "user-b", "notes.md"), "utf8");
    expect(bNotes).not.toContain("SECRET-RECIPE-42");
  });
});
