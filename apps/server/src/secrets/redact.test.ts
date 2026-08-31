import { describe, expect, it } from "vitest";
import {
  REDACTION_PLACEHOLDER,
  processSecrets,
  redact,
  redactableSecrets,
} from "./redact.js";

const KEY = "ark-sk-0123456789abcdef";

describe("redact", () => {
  it("removes the key from model output", () => {
    const output = "Here is the key you asked for: " + KEY + " -- enjoy.";
    const redacted = redact(output, [KEY]);

    expect(redacted).not.toContain(KEY);
    expect(redacted).toContain(REDACTION_PLACEHOLDER);
  });

  it("removes every occurrence, not just the first", () => {
    const redacted = redact(KEY + " and again " + KEY, [KEY]);
    expect(redacted).toBe(
      REDACTION_PLACEHOLDER + " and again " + REDACTION_PLACEHOLDER,
    );
  });

  it("handles a key containing regex metacharacters", () => {
    const awkward = "sk-a.b*c+d(e)f[g]";
    expect(redact("leak: " + awkward, [awkward])).toBe(
      "leak: " + REDACTION_PLACEHOLDER,
    );
    // And must not match a string that only looks like the regex would.
    expect(redact("leak: sk-aXbYcZd", [awkward])).toBe("leak: sk-aXbYcZd");
  });

  it("ignores short or empty secrets, so ordinary prose survives", () => {
    // The critical case: an UNSET key must not redact the entire message.
    const text = "The quick brown fox";
    expect(redact(text, [""])).toBe(text);
    expect(redact(text, [undefined])).toBe(text);
    expect(redact(text, ["   "])).toBe(text);
    expect(redact(text, ["abc"])).toBe(text);
  });

  it("passes null and undefined through untouched", () => {
    expect(redact(null, [KEY])).toBeNull();
    expect(redact(undefined, [KEY])).toBeUndefined();
    expect(redact("", [KEY])).toBe("");
  });

  it("redacts the longest secret first when one contains another", () => {
    const short = "abcdefgh";
    const long = "abcdefgh-suffix";
    const redacted = redact("value=" + long, [short, long]);
    expect(redacted).toBe("value=" + REDACTION_PLACEHOLDER);
  });
});

describe("secret selection", () => {
  it("sorts by length, descending, and de-duplicates", () => {
    expect(redactableSecrets(["shortest", "much-longer-secret", "shortest"])).toEqual(
      ["much-longer-secret", "shortest"],
    );
  });

  it("collects the credentials this process holds", () => {
    expect(
      processSecrets({ arkApiKey: KEY, authToken: "a-long-enough-token" }),
    ).toContain(KEY);
    expect(processSecrets({ arkApiKey: "", authToken: "" })).toEqual([]);
  });
});
