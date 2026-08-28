import type { Capability, PolicyDecision, PolicyRequestLike } from "../types";
import type { RoomId } from "./types";

const capabilities = new Map<string, Capability>();

// crypto.randomUUID is secure-context-only (undefined on plain HTTP for
// anything but localhost) — `npm run dev` binds 0.0.0.0 for LAN demo access,
// so fall back to a non-cryptographic id there.
export const newId = () =>
  crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ponytail: in-memory mock standing in for the real backend PDP
// (apps/server/src/policy/pdp.ts). Day 2 swap replaces only this
// function's body with a fetch call — callers only ever depend on
// the PolicyDecision shape, so nothing else changes.
const ROOM_OWNER: Record<RoomId, string> = {
  "house-a": "user-a",
  "house-b": "user-b",
};

export function issueCapability(agentId: string, ownerId: string): Capability {
  const capability: Capability = {
    id: newId(),
    scope: ownerId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    revokedAt: null,
  };
  capabilities.set(agentId, capability);
  return capability;
}

export function getCapability(agentId: string): Capability | undefined {
  return capabilities.get(agentId);
}

export function revokeCapability(agentId: string): void {
  const capability = capabilities.get(agentId);
  if (capability) capability.revokedAt = new Date().toISOString();
}

export function resetCapabilities(): void {
  capabilities.clear();
}

export async function decideRoomEntry(request: PolicyRequestLike): Promise<PolicyDecision> {
  const decidedAt = new Date().toISOString();
  const { capability, resource, requestId } = request;
  const roomOwner = ROOM_OWNER[resource as RoomId];

  if (!capability) {
    return { effect: "deny", reason: "no capability issued", requestId, decidedAt };
  }
  if (capability.revokedAt) {
    return { effect: "deny", reason: "capability revoked", requestId, decidedAt };
  }
  if (new Date(capability.expiresAt).getTime() < Date.now()) {
    return { effect: "deny", reason: "capability expired", requestId, decidedAt };
  }
  if (capability.scope !== roomOwner) {
    return {
      effect: "deny",
      reason: `capability scoped to ${capability.scope}, room owned by ${roomOwner}`,
      requestId,
      decidedAt,
    };
  }
  return { effect: "permit", reason: "capability scope matches room owner", requestId, decidedAt };
}
