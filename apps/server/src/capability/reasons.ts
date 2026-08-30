/**
 * Frozen denial reasons (Person 3 contract, day 1).
 *
 * These strings are not internal detail: they are written verbatim into the
 * audit log (Person 2), rendered in the security-log panel (Person 4), and
 * asserted on by the negative tests (Person 5). Renaming one breaks three
 * people at once, so treat this list as part of the API.
 */
export const DENY_REASONS = {
  capabilityUnknown: "capability-unknown",
  capabilityRevoked: "capability-revoked",
  capabilityExpired: "capability-expired",
  principalMismatch: "capability-principal-mismatch",
  outOfScope: "out-of-scope",
  actionNotInScope: "action-not-in-scope",
  resourceUnknown: "resource-unknown",
  policyError: "policy-error",
} as const;

export type DenyReason = (typeof DENY_REASONS)[keyof typeof DENY_REASONS];

/** Reason recorded on the permit path, so every audit entry carries one. */
export const PERMIT_REASON = "capability-in-scope";
