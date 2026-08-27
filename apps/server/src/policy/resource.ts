import type { Agent } from "../types.js";

export function buildAgentResource(agent: Pick<Agent, "id" | "ownerId">): string {
  return `agent:${agent.ownerId}:${agent.id}`;
}

export function parseAgentResource(resource: unknown): { ownerId: string; agentId: string } | null {
  if (typeof resource !== "string") return null;
  const match = /^agent:([^:]+):([^:]+)$/.exec(resource);
  if (!match || !match[1] || !match[2]) return null;
  return { ownerId: match[1], agentId: match[2] };
}

export function expectedScopeForOwner(ownerId: string): string {
  return `owner:${ownerId}`;
}
