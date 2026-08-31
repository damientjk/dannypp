import type { Agent, Capability, HumanPrincipal, Principal, PolicyDecision } from "../types.js";
import { pdp } from "./pdp.js";
import { buildAgentResource } from "./resource.js";

export interface CallerContext {
  principal: HumanPrincipal;
  requestId: string;
}

export const AgentAction = {
  List: "agent:list",
  Read: "agent:read",
  Write: "agent:write",
  Delete: "agent:delete",
  Execute: "agent:execute",
} as const;

export class PolicyDeniedError extends Error {
  constructor(public readonly reason: string) {
    super(`Denied by policy: ${reason}`);
    this.name = "PolicyDeniedError";
  }
}

export async function checkAgentAccess(
  principal: Principal,
  action: string,
  agent: Pick<Agent, "id" | "ownerId">,
  requestId: string,
  capability?: Capability,
): Promise<PolicyDecision> {
  return pdp.decide({
    principal,
    action,
    resource: buildAgentResource(agent),
    capability,
    requestId,
  });
}
