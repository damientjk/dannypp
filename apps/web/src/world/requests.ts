import { newId } from "./decision";

export interface AccessRequest {
  id: string;
  agentId: string;
  agentName: string;
  roomId: string;
  roomOwnerId: string;
  requestedAt: string;
}

let pending: AccessRequest[] = [];

// (agentId, roomId) pairs the owner has explicitly denied and hasn't been
// re-asked since. Not a permanent block (spec §5) — cleared once the
// agent's current task cycle ends, so a later run can ask again.
const denied = new Set<string>();

function pairKey(agentId: string, roomId: string): string {
  return `${agentId}:${roomId}`;
}

export function queueRequest(params: {
  agentId: string;
  agentName: string;
  roomId: string;
  roomOwnerId: string;
}): AccessRequest | null {
  if (hasPendingRequest(params.agentId, params.roomId)) return null;
  if (wasDenied(params.agentId, params.roomId)) return null;
  const request: AccessRequest = {
    id: newId(),
    agentId: params.agentId,
    agentName: params.agentName,
    roomId: params.roomId,
    roomOwnerId: params.roomOwnerId,
    requestedAt: new Date().toISOString(),
  };
  pending = [...pending, request];
  return request;
}

export function hasPendingRequest(agentId: string, roomId: string): boolean {
  return pending.some((request) => request.agentId === agentId && request.roomId === roomId);
}

export function pendingRequestsFor(ownerId: string): AccessRequest[] {
  return pending.filter((request) => request.roomOwnerId === ownerId);
}

/** Every pending request, regardless of which nominal owner the room
 *  carries — there is one signed-in manager, and they manage all of it. */
export function allPendingRequests(): AccessRequest[] {
  return pending;
}

export function resolveRequest(requestId: string): void {
  pending = pending.filter((request) => request.id !== requestId);
}

export function markDenied(agentId: string, roomId: string): void {
  denied.add(pairKey(agentId, roomId));
}

export function wasDenied(agentId: string, roomId: string): boolean {
  return denied.has(pairKey(agentId, roomId));
}

/** Clears every denied mark for an agent (any room) — called once its
 *  current task cycle ends, so a future cycle can ask again. */
export function clearDeniedForAgent(agentId: string): void {
  const prefix = pairKey(agentId, "");
  for (const key of denied) {
    if (key.startsWith(prefix)) denied.delete(key);
  }
}

export function resetRequests(): void {
  pending = [];
  denied.clear();
}
