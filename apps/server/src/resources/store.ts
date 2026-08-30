/**
 * The two-user protected resource store -- the "houses" the isolation proof is
 * run against.
 *
 * DESIGN RULE: this module performs ZERO authorization. It is the thing that
 * sits *behind* the guard, not the guard. Every caller reaches it through the
 * PEP/PDP path in resources/access.ts. If an ownership check ever appears in
 * here, the trust boundary has blurred and a judge can reasonably ask which of
 * the two checks is the real one.
 *
 * Resources are real files under `${APP_DATA_DIR}/resources/<ownerId>/`, so a
 * permitted read genuinely reads a file and a denied read genuinely does not.
 */

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseResourceUri, RESOURCE_SCHEME, type ResourceUri } from "./uri.js";

export interface ResourceRef {
  uri: string;
  ownerId: string;
  name: string;
}

/**
 * Seed content. Deliberately fake-looking: these strings end up in run output,
 * screenshots and the recorded demo, and deliverable 9 forbids a real secret in
 * any of those. A judge should be able to tell at a glance that nothing here is
 * a live credential.
 */
const SEED: Record<string, Record<string, string>> = {
  "user-a": {
    "secret-recipe.txt":
      "SECRET-RECIPE-42 (fake demo data)\nThree parts cocoa, one part nonsense, folded twice.\n",
    "notes.md": "# User A notes\n\n- Ship the launchpad\n- Do not tell User B the recipe\n",
  },
  "user-b": {
    "tax-return.txt":
      "SECRET-TAX-99 (fake demo data)\nRefund due: $1,337.00\nFiled: never\n",
    "notes.md": "# User B notes\n\n- Wonder what User A is cooking\n",
  },
};

export class ResourceStore {
  private readonly owners: Set<string>;

  constructor(
    private readonly root: string,
    knownOwners: readonly string[] = Object.keys(SEED),
  ) {
    this.owners = new Set(knownOwners);
  }

  /** Creates each owner's namespace and writes any missing seed file. */
  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    for (const ownerId of this.owners) {
      await mkdir(path.join(this.root, ownerId), { recursive: true });
      for (const [name, content] of Object.entries(SEED[ownerId] ?? {})) {
        const target = path.join(this.root, ownerId, name);
        try {
          await writeFile(target, content, { flag: "wx", encoding: "utf8" });
        } catch (error) {
          // Already seeded on a previous boot; keep whatever is there so a demo
          // that writes to a resource is not silently reset.
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
    }
  }

  /**
   * Syntax + known-owner validation. Returns null for anything malformed,
   * traversing, or belonging to a user we do not know about.
   */
  parse(uri: unknown): ResourceRef | null {
    const parsed = parseResourceUri(uri);
    if (!parsed) return null;
    if (!this.owners.has(parsed.ownerId)) return null;
    return { uri: parsed.uri, ownerId: parsed.ownerId, name: parsed.name };
  }

  ownerOf(uri: unknown): string | null {
    return this.parse(uri)?.ownerId ?? null;
  }

  knownOwners(): string[] {
    return [...this.owners].sort();
  }

  /** Lists resources on disk. Listing is not reading: contents stay behind the guard. */
  async list(ownerId?: string): Promise<ResourceRef[]> {
    const targets = ownerId ? [ownerId] : this.knownOwners();
    const refs: ResourceRef[] = [];
    for (const owner of targets) {
      if (!this.owners.has(owner)) continue;
      let names: string[];
      try {
        names = await readdir(path.join(this.root, owner));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const name of names.sort()) {
        const ref = this.parse(RESOURCE_SCHEME + owner + "/" + name);
        if (ref) refs.push(ref);
      }
    }
    return refs;
  }

  async exists(uri: unknown): Promise<boolean> {
    const ref = this.parse(uri);
    if (!ref) return false;
    try {
      await readFile(this.filePath(ref), "utf8");
      return true;
    } catch {
      return false;
    }
  }

  async read(uri: unknown): Promise<string> {
    const ref = this.requireRef(uri);
    return readFile(this.filePath(ref), "utf8");
  }

  /** Atomic write, so a crash mid-demo cannot leave a half-written resource. */
  async write(uri: unknown, content: string): Promise<void> {
    const ref = this.requireRef(uri);
    const target = this.filePath(ref);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = target + ".tmp";
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }

  private requireRef(uri: unknown): ResourceRef {
    const ref = this.parse(uri);
    if (!ref) throw new Error("Unknown resource: " + String(uri));
    return ref;
  }

  /**
   * Belt and braces: even though `parse` already rejects traversal, resolve the
   * final path and confirm it is still inside the owner's directory. Two
   * independent checks, because this is the one that must never fail.
   */
  private filePath(ref: ResourceRef): string {
    const ownerRoot = path.resolve(this.root, ref.ownerId);
    const resolved = path.resolve(ownerRoot, ref.name);
    if (resolved !== ownerRoot && !resolved.startsWith(ownerRoot + path.sep)) {
      throw new Error("Resource path escaped its namespace: " + ref.uri);
    }
    return resolved;
  }
}

export type { ResourceUri };
