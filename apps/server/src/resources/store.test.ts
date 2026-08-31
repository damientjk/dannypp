import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResourceStore } from "./store.js";

const temporaryRoots: string[] = [];

async function makeStore(): Promise<ResourceStore> {
  return (await makeStoreAt()).store;
}

/** Same store, but the root comes back too so a test can plant files in it. */
async function makeStoreAt(): Promise<{ store: ResourceStore; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "launchpad-resources-"));
  temporaryRoots.push(root);
  const store = new ResourceStore(root);
  await store.initialize();
  return { store, root };
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
      "res://user-a/analytics-summary.md",
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

describe("listing a namespace backed by a real folder", () => {
  it("finds files inside subdirectories", async () => {
    const { store, root } = await makeStoreAt();
    await mkdir(path.join(root, "user-a", "project", "src"), { recursive: true });
    await writeFile(path.join(root, "user-a", "project", "src", "index.ts"), "x\n");

    const uris = (await store.list("user-a")).map((ref) => ref.uri);

    expect(uris).toContain("res://user-a/project/src/index.ts");
  });

  it("never lists a directory as if it were a resource", async () => {
    const { store, root } = await makeStoreAt();
    await mkdir(path.join(root, "user-a", "project"), { recursive: true });
    await writeFile(path.join(root, "user-a", "project", "notes.md"), "x\n");

    const uris = (await store.list("user-a")).map((ref) => ref.uri);

    // Advertising the directory produces a URI that `read` can only fail on.
    expect(uris).not.toContain("res://user-a/project");
    expect(uris).toContain("res://user-a/project/notes.md");
  });

  it("reports names the URI grammar refuses instead of dropping them silently", async () => {
    const { store, root } = await makeStoreAt();
    await writeFile(path.join(root, "user-a", "my notes.txt"), "x\n");
    await writeFile(path.join(root, "user-a", ".hidden"), "x\n");

    const { resources, skipped } = await store.listDetailed("user-a");

    expect(resources.map((ref) => ref.name)).not.toContain("my notes.txt");
    expect(skipped).toContain("user-a/my notes.txt");
    expect(skipped).toContain("user-a/.hidden");
  });

  it("stops descending before an unbounded tree can hang a listing", async () => {
    const { store, root } = await makeStoreAt();
    const deep = path.join(root, "user-a", ...Array(12).fill("nested"));
    await mkdir(deep, { recursive: true });
    await writeFile(path.join(deep, "buried.md"), "x\n");

    const uris = (await store.list("user-a")).map((ref) => ref.uri);

    expect(uris.some((uri) => uri.endsWith("buried.md"))).toBe(false);
  });
});
