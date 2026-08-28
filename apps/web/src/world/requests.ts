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

export function queueRequest(params: {
  agentId: string;
  agentName: string;
  roomId: string;
  roomOwnerId: string;
}): AccessRequest | null {
  if (hasPendingRequest(params.agentId, params.roomId)) return null;
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

export function resolveRequest(requestId: string): void {
  pending = pending.filter((request) => request.id !== requestId);
}

export function resetRequests(): void {
  pending = [];
}
