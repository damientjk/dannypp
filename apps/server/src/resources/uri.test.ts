import { describe, expect, it } from "vitest";
import { parseResourceUri, resourceOwner } from "./uri.js";

describe("resource URI parsing", () => {
  it("parses a well-formed URI", () => {
    expect(parseResourceUri("res://user-a/notes.md")).toEqual({
      ownerId: "user-a",
      name: "notes.md",
      uri: "res://user-a/notes.md",
    });
  });

  it("supports nested names", () => {
    expect(parseResourceUri("res://user-b/reports/2026/q1.md")?.name).toBe(
      "reports/2026/q1.md",
    );
  });

  it("reports the owner", () => {
    expect(resourceOwner("res://user-b/tax-return.txt")).toBe("user-b");
    expect(resourceOwner("nonsense")).toBeNull();
  });
});

describe("resource URI traversal defence", () => {
  // Each of these, if accepted, would let user A's capability reach user B's
  // files -- the exact failure the isolation demo claims is impossible.
  const attacks = [
    "res://user-a/../user-b/tax-return.txt",
    "res://user-a/../../etc/passwd",
    "res://user-a/notes/../../user-b/notes.md",
    "res://user-a/%2e%2e/user-b/notes.md",
    "res://user-a/%2E%2E%2Fuser-b%2Fnotes.md",
    "res://user-a/..",
    "res://user-a/.",
    "res://user-a/./notes.md",
    "res://user-a//user-b/notes.md",
    "res://user-a/\\..\\user-b",
    "res://user-a/notes.md\0.png",
    "res://../user-b/notes.md",
    "res:///notes.md",
    "res://user-a/",
    "res://user-a",
    "res://USER-A/notes.md",
    "file:///etc/passwd",
    "res://user-a/notes.md/",
    "/etc/passwd",
    "",
  ];

  for (const attack of attacks) {
    it("rejects " + JSON.stringify(attack), () => {
      expect(parseResourceUri(attack)).toBeNull();
    });
  }

  it("rejects non-string input without throwing", () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(parseResourceUri(value)).toBeNull();
    }
  });

  it("rejects an over-long URI", () => {
    expect(parseResourceUri("res://user-a/" + "x".repeat(600))).toBeNull();
  });
});
