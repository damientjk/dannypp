/**
 * The capability-side verdict.
 *
 * This is the function Person 2's PDP wraps. It answers "does this principal,
 * holding this capability, get to perform this action on this resource?" and
 * nothing else -- it does not know about requestIds, timestamps or the audit
 * log, which are the PDP's job. Splitting it this way means capability
 * semantics live in one place (here) while decision plumbing lives in one place
 * (policy/pdp.ts), and neither of us edits the other's file.
 *
 * It takes the `Capability` straight off the `PolicyRequest`, so the PDP needs
 * no reference to the capability store at all:
 *
 *   async decide(request) {
 *     const verdict = authorizeCapability(request);
 *     return { ...verdict, requestId: request.requestId, decidedAt: new Date().toISOString() };
 *   }
 *
 * It never throws. Every path returns a verdict, and unrecognised input
 * produces a deny -- fail closed.
 */

import type { Capability, Principal } from "../types.js";
import { parseResourceUri } from "../resources/uri.js";
import { DENY_REASONS, PERMIT_REASON, type DenyReason } from "./reasons.js";
import { scopeAllows, scopeAllowsAction } from "./scope.js";
import { validateCapability } from "./store.js";

export interface AuthorizeInput {
  principal: Principal;
  action: string;
  resource: string;
  /** Required for agent principals; ignored for human principals. */
  capability?: Capability | undefined;
  /** Optional existence check. Omit to let URI syntax alone decide. */
  resourceExists?: ((uri: string) => boolean) | undefined;
  at?: Date | undefined;
}

export type Verdict =
  | { effect: "permit"; reason: string }
  | { effect: "deny"; reason: DenyReason };

const deny = (reason: DenyReason): Verdict => ({ effect: "deny", reason });

/** True when the capability carries the provenance fields the store adds. */
function boundAgentId(capability: Capability): string | null {
  const agentId = (capability as { agentId?: unknown }).agentId;
  return typeof agentId === "string" ? agentId : null;
}

export function authorizeCapability(input: AuthorizeInput): Verdict {
  const target = parseResourceUri(input.resource);
  if (!target) return deny(DENY_REASONS.resourceUnknown);
  if (input.resourceExists && !input.resourceExists(target.uri)) {
    return deny(DENY_REASONS.resourceUnknown);
  }

  // A human acts on their own namespace directly -- they are the owner, not a
  // delegate, so no capability is involved. Cross-user access is still denied.
  if (input.principal.kind === "human") {
    return input.principal.id === target.ownerId
      ? { effect: "permit", reason: "owner-principal" }
      : deny(DENY_REASONS.outOfScope);
  }

  // An agent acts only under a capability. No capability means no keycard.
  const validation = validateCapability(input.capability ?? null, input.at);
  if (!validation.valid) return deny(validation.reason);

  const capability = validation.capability;

  // A capability is bound to the agent it was minted for. Presenting somebody
  // else's keycard is a denial in its own right, not an out-of-scope error.
  const agentId = boundAgentId(capability);
  if (agentId !== null && agentId !== input.principal.agentId) {
    return deny(DENY_REASONS.principalMismatch);
  }

  // Distinguish "wrong verb" from "wrong house" so the audit log and the
  // on-screen security panel can say which one actually happened.
  if (!scopeAllowsAction(capability.scope, input.action)) {
    return deny(DENY_REASONS.actionNotInScope);
  }
  if (!scopeAllows(capability.scope, input.action, target.uri)) {
    return deny(DENY_REASONS.outOfScope);
  }

  return { effect: "permit", reason: PERMIT_REASON };
}
