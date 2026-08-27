import type {
  Capability,
  PolicyDecision,
  PolicyDecisionPoint,
  PolicyRequest,
  Principal,
} from "../types.js";
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

function capabilityProblem(capability: Capability, expectedScope: string): string | null {
  if (capability.revokedAt !== null) return "capability-revoked";
  const expiresAtMs = Date.parse(capability.expiresAt);
  if (Number.isNaN(expiresAtMs)) return "malformed-capability";
  if (expiresAtMs <= Date.now()) return "capability-expired";
  if (capability.scope !== expectedScope) return "capability-scope-mismatch";
  return null;
}

function decideInternal(request: PolicyRequest): PolicyDecision {
  const requestId =
    typeof request?.requestId === "string" && request.requestId ? request.requestId : "unknown";
  if (!request || typeof request.action !== "string" || !request.action) {
    return deny(requestId, "malformed-request");
  }
  const parsed = parseAgentResource(request.resource);
  if (!parsed) return deny(requestId, "malformed-resource");

  const owner = callerOwnerId(request.principal);
  if (owner === null) return deny(requestId, "unknown-principal-kind");
  if (owner !== parsed.ownerId) return deny(requestId, "not-owner");

  if (request.principal.kind === "agent") {
    if (!request.capability) return deny(requestId, "missing-capability");
    const problem = capabilityProblem(request.capability, expectedScopeForOwner(parsed.ownerId));
    if (problem) return deny(requestId, problem);
    return permit(requestId, "capability-valid");
  }
  return permit(requestId, "owner-match");
}

export const pdp: PolicyDecisionPoint = {
  async decide(request: PolicyRequest): Promise<PolicyDecision> {
    try {
      return decideInternal(request);
    } catch {
      return deny(typeof request?.requestId === "string" ? request.requestId : "unknown", "pdp-error");
    }
  },
};
