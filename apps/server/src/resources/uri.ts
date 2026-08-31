/**
 * Resource URI syntax, in one place.
 *
 *   res://<ownerId>/<name>
 *
 * This module is pure (no filesystem, no policy). It answers exactly one question:
 * "is this string a syntactically valid resource URI, and if so, whose is it?"
 *
 * SECURITY: this is the chokepoint that stops cross-user traversal. A naive
 * split on "/" reads `res://user-a/../user-b/tax-return.txt` as belonging to
 * user-a, which would pass a scope check and then read user-b's file --
 * silently defeating the isolation guarantee the whole demo rests on.
 * Every rejection rule below exists for that reason. Change it with tests.
 */

export interface ResourceUri {
  /** Owning principal id, e.g. "user-a". */
  ownerId: string;
  /** Path below the owner's namespace, e.g. "notes.md" or "notes/today.md". */
  name: string;
  /** The normalised canonical form, always `res://<ownerId>/<name>`. */
  uri: string;
}

export const RESOURCE_SCHEME = "res://";
export const OWNER_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_URI_LENGTH = 512;

/**
 * Returns the parsed URI, or null if it is malformed or attempts traversal.
 * Never throws: callers treat null as `resource-unknown`.
 */
export function parseResourceUri(input: unknown): ResourceUri | null {
  if (typeof input !== "string") return null;
  if (input.length === 0 || input.length > MAX_URI_LENGTH) return null;

  // Reject percent-encoding outright rather than decoding it. Resource names
  // have no legitimate need for it, and decoding-then-validating is the classic
  // spot where "%2e%2e" slips through a second parse.
  if (input.includes("%")) return null;
  if (input.includes("\0") || input.includes("\\")) return null;
  if (!input.startsWith(RESOURCE_SCHEME)) return null;

  const rest = input.slice(RESOURCE_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;

  const ownerId = rest.slice(0, slash);
  const name = rest.slice(slash + 1);
  if (!OWNER_PATTERN.test(ownerId)) return null;
  if (name.length === 0) return null;
  if (name.startsWith("/") || name.endsWith("/")) return null;

  const segments = name.split("/");
  for (const segment of segments) {
    // Catches "", ".", ".." and anything with a character we do not allow.
    if (!SEGMENT_PATTERN.test(segment)) return null;
    if (segment === "." || segment === "..") return null;
  }

  return { ownerId, name, uri: RESOURCE_SCHEME + ownerId + "/" + name };
}

/** Convenience for callers that only need the owner. */
export function resourceOwner(input: unknown): string | null {
  return parseResourceUri(input)?.ownerId ?? null;
}
