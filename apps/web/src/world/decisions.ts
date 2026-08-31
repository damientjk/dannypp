/**
 * Grant and deny, in one place.
 *
 * Both the world panel's toasts and the Playground's request list call these,
 * so the two paths cannot drift: every grant issues a capability, clears the
 * request and writes one log line, wherever the click came from.
 */

import { issueCapability } from "./decision";
import { newId } from "./decision";
import { appendEvent } from "./eventLog";
import { markDenied, resolveRequest, type AccessRequest } from "./requests";
import { roomById } from "./resources";

export function grantRequest(request: AccessRequest, ownerName: string): void {
  issueCapability(request.agentId, request.roomId);
  resolveRequest(request.id);
  appendEvent({
    id: newId(),
    agentId: request.agentId,
    category: "granted",
    message: `${ownerName} granted ${request.agentName} access to ${roomById(request.roomId).displayName}`,
    timestamp: new Date().toISOString(),
  });
}

export function denyRequest(request: AccessRequest, ownerName: string): void {
  resolveRequest(request.id);
  markDenied(request.agentId, request.roomId);
  appendEvent({
    id: newId(),
    agentId: request.agentId,
    category: "denied",
    message: `${ownerName} denied ${request.agentName} access to ${roomById(request.roomId).displayName}`,
    timestamp: new Date().toISOString(),
  });
}
