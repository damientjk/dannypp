import { describe, expect, it } from "vitest";
import {
  defaultRunScope,
  parseScope,
  scopeAllows,
  scopeAllowsAction,
} from "./scope.js";

describe("scope parsing", () => {
  it("parses actions and pattern", () => {
    expect(parseScope("read,write:res://user-a/notes.md")).toEqual({
      actions: ["read", "write"],
      ownerId: "user-a",
      glob: "notes.md",
    });
  });

  it("de-duplicates repeated actions", () => {
    expect(parseScope("read,read:res://user-a/*")?.actions).toEqual(["read"]);
  });

  it("builds the default run scope", () => {
    expect(defaultRunScope("user-a")).toBe("read:res://user-a/*");
    expect(parseScope(defaultRunScope("user-a"))).not.toBeNull();
  });

  const malformed = [
    "",
    "read",
    ":res://user-a/*",
    "read:",
    "delete:res://user-a/*",
    "read,delete:res://user-a/*",
    "read:user-a/*",
    "read:res://user-a",
    "read:res://user-a/",
    "read:res://user-a/../user-b/*",
    "read:res://user-a/*/../user-b",
    "read:res://USER-A/*",
    "read:res://user-a/%2e%2e",
    "read:res://user-a/a b",
  ];
  for (const scope of malformed) {
    it("rejects malformed scope " + JSON.stringify(scope), () => {
      expect(parseScope(scope)).toBeNull();
      // A scope that cannot be parsed must never authorize anything.
      expect(scopeAllows(scope, "read", "res://user-a/notes.md")).toBe(false);
    });
  }
});

describe("scopeAllows", () => {
  const ownerScope = "read:res://user-a/*";

  it("permits an owner reading their own namespace", () => {
    expect(scopeAllows(ownerScope, "read", "res://user-a/notes.md")).toBe(true);
    expect(scopeAllows(ownerScope, "read", "res://user-a/secret-recipe.txt")).toBe(
      true,
    );
  });

  it("DENIES user A's scope reaching user B -- the isolation proof", () => {
    expect(scopeAllows(ownerScope, "read", "res://user-b/tax-return.txt")).toBe(
      false,
    );
    expect(scopeAllows(ownerScope, "read", "res://user-b/notes.md")).toBe(false);
  });

  it("denies a write under a read-only scope -- the over-scope case", () => {
    expect(scopeAllows(ownerScope, "write", "res://user-a/notes.md")).toBe(false);
    expect(scopeAllowsAction(ownerScope, "write")).toBe(false);
    expect(scopeAllowsAction(ownerScope, "read")).toBe(true);
  });

  it("permits a write under a read,write scope", () => {
    const scope = "read,write:res://user-a/notes.md";
    expect(scopeAllows(scope, "write", "res://user-a/notes.md")).toBe(true);
    expect(scopeAllows(scope, "read", "res://user-a/notes.md")).toBe(true);
  });

  it("narrows to a single file when the glob has no wildcard", () => {
    const scope = "read:res://user-a/notes.md";
    expect(scopeAllows(scope, "read", "res://user-a/notes.md")).toBe(true);
    expect(scopeAllows(scope, "read", "res://user-a/secret-recipe.txt")).toBe(
      false,
    );
  });

  it("matches a prefix wildcard", () => {
    const scope = "read:res://user-a/report*";
    expect(scopeAllows(scope, "read", "res://user-a/report-q1.md")).toBe(true);
    expect(scopeAllows(scope, "read", "res://user-a/notes.md")).toBe(false);
  });

  it("treats the glob literally apart from '*'", () => {
    // "notes.md" must not match "notesXmd" -- the dot is escaped, not a regex
    // wildcard. Getting this wrong widens every scope in the system.
    const scope = "read:res://user-a/notes.md";
    expect(scopeAllows(scope, "read", "res://user-a/notesXmd")).toBe(false);
  });

  it("denies a traversing resource even under a wildcard scope", () => {
    expect(
      scopeAllows(ownerScope, "read", "res://user-a/../user-b/tax-return.txt"),
    ).toBe(false);
  });

  it("denies unknown actions and malformed resources", () => {
    expect(scopeAllows(ownerScope, "delete", "res://user-a/notes.md")).toBe(false);
    expect(scopeAllows(ownerScope, "read", "not-a-uri")).toBe(false);
    expect(scopeAllows(ownerScope, "read", null)).toBe(false);
    expect(scopeAllows(null, "read", "res://user-a/notes.md")).toBe(false);
  });
});
