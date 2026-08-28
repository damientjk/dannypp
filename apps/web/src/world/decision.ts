import type { Capability, PolicyDecision, PolicyRequestLike } from "../types";
import { roomById } from "./resources";

const capabilities = new Map<string, Capability>();

// crypto.randomUUID is secure-context-only (undefined on plain HTTP for
// anything but localhost) — `npm run dev` binds 0.0.0.0 for LAN demo access,
// so fall back to a non-cryptographic id there.
export const newId = () =>
  crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function capabilityKey(agentId: string, roomId: string): string {
  return `${agentId}:${roomId}`;
}

// ponytail: in-memory mock standing in for the real backend PDP
// (apps/server/src/policy/pdp.ts). Day 2 swap replaces only decideRoomEntry's
// body with a fetch call — callers only ever depend on the PolicyDecision
// shape, so nothing else changes.
export function issueCapability(agentId: string, roomId: string): Capability {
  const capability: Capability = {
    id: newId(),
    scope: roomId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    revokedAt: null,
  };
  capabilities.set(capabilityKey(agentId, roomId), capability);
  return capability;
}

export function getCapability(agentId: string, roomId: string): Capability | undefined {
  return capabilities.get(capabilityKey(agentId, roomId));
}

export function revokeCapability(agentId: string, roomId: string): void {
  const capability = capabilities.get(capabilityKey(agentId, roomId));
  if (capability) capability.revokedAt = new Date().toISOString();
}

export function grantedRoomsFor(agentId: string): string[] {
  const prefix = `${agentId}:`;
  const now = Date.now();
  const rooms: string[] = [];
  for (const [mapKey, capability] of capabilities) {
    if (!mapKey.startsWith(prefix)) continue;
    if (capability.revokedAt) continue;
    if (new Date(capability.expiresAt).getTime() < now) continue;
    rooms.push(mapKey.slice(prefix.length));
  }
  return rooms;
}

export function resetCapabilities(): void {
  capabilities.clear();
}

export async function decideRoomEntry(request: PolicyRequestLike): Promise<PolicyDecision> {
  const decidedAt = new Date().toISOString();
  const { capability, resource, requestId } = request;
  const room = roomById(resource);

  if (!room.requiresPermission) {
    return { effect: "permit", reason: "no permission required for this room", requestId, decidedAt };
  }
  if (!capability) {
    return { effect: "deny", reason: "no capability issued", requestId, decidedAt };
  }
  if (capability.revokedAt) {
    return { effect: "deny", reason: "capability revoked", requestId, decidedAt };
  }
  if (new Date(capability.expiresAt).getTime() < Date.now()) {
    return { effect: "deny", reason: "capability expired", requestId, decidedAt };
  }
  if (capability.scope !== resource) {
    return {
      effect: "deny",
      reason: `capability scoped to ${capability.scope}, not ${resource}`,
      requestId,
      decidedAt,
    };
  }
  return { effect: "permit", reason: "capability scope matches requested room", requestId, decidedAt };
}
