/**
 * The Policy Decision Point.
 *
 * There is ONE decide() for the whole platform, and it protects two families of
 * resource:
 *
 *   agent:<ownerId>:<agentId>   an Agent object   -- CRUD, lifecycle, execution
 *   res://<ownerId>/<name>      a user's data     -- reads and writes
 *
 * Both families answer to the same rule (you may only touch your own owner's
 * things) but they check different things: an Agent resource cares only that
 * the caller owns it and holds a live keycard, while a data resource also cares
 * about the action and the scope pattern. Dispatching here keeps that in one
 * place instead of two PDPs that would drift apart.
 *
 * Person 2 owns this file. The `res://` branch delegates to Person 3's
 * `authorizeCapability`; the scope matcher itself lives in capability/scope.ts
 * and is never re-implemented here.
 */

import type {
  Capability,
  PolicyDecision,
  PolicyDecisionPoint,
  PolicyRequest,
  Principal,
} from "../types.js";
import { authorizeCapability } from "../capability/authorize.js";
import { capabilityOwner } from "../capability/scope.js";
import { parseResourceUri } from "../resources/uri.js";
import { expectedScopeForOwner, parseAgentResource } from "./resource.js";

function deny(requestId: string, reason: string): PolicyDecision {
  return { effect: "deny", reason, requestId, decidedAt: new Date().toISOString() };
}

function permit(requestId: string, reason: string): PolicyDecision {
  return { effect: "permit", reason, requestId, decidedAt: new Date().toISOString() };
}

function callerOwnerId(principal: Principal): string | null {
  if (principal.kind === "human") return principal.id;
  if (principal.kind === "agent") return principal.ownerId;
  return null;
}

function capabilityProblem(capability: Capability, ownerId: string): string | null {
  if (capability.revokedAt !== null) return "capability-revoked";
  const expiresAtMs = Date.parse(capability.expiresAt);
  if (Number.isNaN(expiresAtMs)) return "malformed-capability";
  if (expiresAtMs <= Date.now()) return "capability-expired";
  // Bind the keycard to an owner without caring which scope grammar wrote it:
  // "owner:user-a" and "read:res://user-a/*" both name user-a. Comparing the
  // raw string instead would reject every capability from the other half of
  // the middleware.
  if (capabilityOwner(capability.scope) !== ownerId) return "capability-scope-mismatch";
  return null;
}

/** Agent objects: `agent:<ownerId>:<agentId>`. */
function decideAgentResource(
  request: PolicyRequest,
  requestId: string,
  parsed: { ownerId: string },
): PolicyDecision {
  const owner = callerOwnerId(request.principal);
  if (owner === null) return deny(requestId, "unknown-principal-kind");
  if (owner !== parsed.ownerId) return deny(requestId, "not-owner");

  if (request.principal.kind === "agent") {
    if (!request.capability) return deny(requestId, "missing-capability");
    const problem = capabilityProblem(request.capability, parsed.ownerId);
    if (problem) return deny(requestId, problem);
    return permit(requestId, "capability-valid");
  }
  return permit(requestId, "owner-match");
}

/** Data resources: `res://<ownerId>/<name>`. Delegates to the capability rules. */
function decideDataResource(request: PolicyRequest, requestId: string): PolicyDecision {
  const verdict = authorizeCapability({
    principal: request.principal,
    action: request.action,
    resource: request.resource,
    capability: request.capability,
  });
  return verdict.effect === "permit"
    ? permit(requestId, verdict.reason)
    : deny(requestId, verdict.reason);
}

function decideInternal(request: PolicyRequest): PolicyDecision {
  const requestId =
    typeof request?.requestId === "string" && request.requestId ? request.requestId : "unknown";
  if (!request || typeof request.action !== "string" || !request.action) {
    return deny(requestId, "malformed-request");
  }

  const agentResource = parseAgentResource(request.resource);
  if (agentResource) return decideAgentResource(request, requestId, agentResource);

  if (parseResourceUri(request.resource)) return decideDataResource(request, requestId);

  return deny(requestId, "malformed-resource");
}

export const pdp: PolicyDecisionPoint = {
  async decide(request: PolicyRequest): Promise<PolicyDecision> {
    try {
      return decideInternal(request);
    } catch {
      // Default-deny: a guard that falls over must not become an open door.
      return deny(typeof request?.requestId === "string" ? request.requestId : "unknown", "pdp-error");
    }
  },
};

export { expectedScopeForOwner };
