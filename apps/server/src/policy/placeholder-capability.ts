// TEMPORARY — Person 3 owns real capability issuance + revocation in capability/.
// This file exists only so Day-1's demo can show the full spine (human -> agent
// principal -> capability -> PDP decide()) before capability/ exists.
//
// DELETE THIS FILE once capability/ ships an equivalent
// `issueCapabilityForRun(agent): { principal, capability }`, and swap the one
// import site in agent-service.ts. Nothing in policy/pep.ts, policy/pdp.ts, or
// PolicyRequest/AuthContext needs to change — this placeholder produces exactly
// the same { principal: AgentPrincipal; capability: Capability } shape.

import { randomUUID } from "node:crypto";
import type { Agent, AgentPrincipal, Capability } from "../types.js";
import { expectedScopeForOwner } from "./resource.js";

const PLACEHOLDER_CAPABILITY_TTL_MS = 5 * 60 * 1000;

export function buildPlaceholderAgentAuth(
  agent: Pick<Agent, "id" | "ownerId">,
): { principal: AgentPrincipal; capability: Capability } {
  const principal: AgentPrincipal = {
    kind: "agent",
    id: `agent-principal:${agent.id}`,
    agentId: agent.id,
    ownerId: agent.ownerId,
  };
  const capability: Capability = {
    id: randomUUID(),
    scope: expectedScopeForOwner(agent.ownerId),
    expiresAt: new Date(Date.now() + PLACEHOLDER_CAPABILITY_TTL_MS).toISOString(),
    revokedAt: null,
  };
  return { principal, capability };
}
