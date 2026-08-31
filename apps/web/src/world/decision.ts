/**
 * The seam between the drawn world and the real Policy Decision Point.
 *
 * Nothing in this module decides anything. Entering a room is a genuine read of
 * the resource that room stands for, sent to POST /api/resources/read, and what
 * comes back is the backend's PolicyDecision -- reason, requestId and all. The
 * animation downstream is a rendering of that answer, never a substitute for it.
 *
 * Keycards are equally real: granting mints one through POST /api/capabilities,
 * shredding revokes it through POST /api/capabilities/:id/revoke. The map below
 * is a cache of what the backend already said, refreshed from it, never the
 * authority on its own.
 */

import { api, PolicyDeniedError } from "../api";
import type {
  Capability,
  CapabilityRecord,
  PolicyDecision,
  PolicyRequestLike,
} from "../types";
import { roomById, roomByScope, scopeForRoom } from "./resources";

/**
 * Presented when an Agent holds no keycard at all.
 *
 * Sending a well-formed id that cannot exist keeps the decision where it
 * belongs: the backend answers `capability-unknown` and that denial is a real
 * policy decision with a real audit entry. Short-circuiting here instead would
 * put the browser back in charge of saying no.
 */
const NO_KEYCARD = "00000000-0000-0000-0000-000000000000";

/** Cache of live keycards, keyed by agent and room. Rebuilt from the backend. */
const held = new Map<string, CapabilityRecord>();

// crypto.randomUUID is secure-context-only (undefined on plain HTTP for
// anything but localhost) -- `npm run dev` binds 0.0.0.0 for LAN demo access,
// so fall back to a non-cryptographic id there.
export const newId = () =>
  crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function capabilityKey(agentId: string, roomId: string): string {
  return `${agentId}:${roomId}`;
}

function isLive(capability: CapabilityRecord): boolean {
  if (capability.revokedAt) return false;
  return new Date(capability.expiresAt).getTime() >= Date.now();
}

/** Reloads every keycard this human owns and re-derives which rooms they open. */
export async function refreshCapabilities(): Promise<void> {
  const { capabilities } = await api.capabilities();
  held.clear();
  for (const capability of capabilities) {
    if (!isLive(capability)) continue;
    const room = roomByScope(capability.scope);
    if (!room) continue;
    held.set(capabilityKey(capability.agentId, room.id), capability);
  }
}

export function getCapability(agentId: string, roomId: string): Capability | undefined {
  return held.get(capabilityKey(agentId, roomId));
}

/**
 * Mints a keycard scoped to exactly one room's resource.
 *
 * The backend takes the owner from the session and refuses any scope outside
 * it, so this cannot be used to open somebody else's house -- an attempt to
 * grant into another owner's namespace fails there, not here.
 */
export async function issueCapability(
  agentId: string,
  roomId: string,
): Promise<CapabilityRecord | null> {
  const scope = scopeForRoom(roomById(roomId));
  if (!scope) return null;
  const { capability } = await api.issueCapability({ agentId, scope });
  held.set(capabilityKey(agentId, roomId), capability);
  return capability;
}

/** Shreds the keycard for one room. The backend checks ownership before it does. */
export async function revokeCapability(agentId: string, roomId: string): Promise<void> {
  const key = capabilityKey(agentId, roomId);
  const capability = held.get(key);
  if (!capability) return;
  await api.revokeCapability(capability.id);
  held.delete(key);
}

/**
 * Any live keycard this Agent holds, whatever room it opens.
 *
 * An Agent walking to a door presents the keycard it is carrying, not nothing
 * at all -- so a keycard for Billing presented at Database is judged by the
 * backend as `out-of-scope` rather than vanishing into "no credential". That
 * distinction matters: out-of-scope is the ownership-isolation refusal the
 * whole demo turns on, and it is only reachable if the card is actually shown.
 */
function anyCapabilityFor(agentId: string): CapabilityRecord | undefined {
  const prefix = `${agentId}:`;
  for (const [key, capability] of held) {
    if (key.startsWith(prefix) && isLive(capability)) return capability;
  }
  return undefined;
}

export function grantedRoomsFor(agentId: string): string[] {
  const prefix = `${agentId}:`;
  const rooms: string[] = [];
  for (const [key, capability] of held) {
    if (!key.startsWith(prefix)) continue;
    if (!isLive(capability)) continue;
    rooms.push(key.slice(prefix.length));
  }
  return rooms;
}

export function resetCapabilities(): void {
  held.clear();
}

/**
 * Asks the backend whether this Agent may enter this room.
 *
 * `request.resource` is a room id; the room's `resourceUri` is what actually
 * gets read. A room with no uri is an open area rather than a protected
 * resource -- there is no policy question to ask about it, and saying so is not
 * the same as adjudicating one.
 */
export async function decideRoomEntry(
  request: PolicyRequestLike,
): Promise<PolicyDecision> {
  const room = roomById(request.resource);

  if (!room.requiresPermission || !room.resourceUri) {
    return {
      effect: "permit",
      reason: "open area, not a protected resource",
      requestId: request.requestId,
      decidedAt: new Date().toISOString(),
    };
  }

  // The keycard for this room if the Agent has one; otherwise whatever card it
  // is carrying, so the backend can refuse it on scope; otherwise an id that
  // cannot exist, so the backend refuses it as unknown. Every branch ends in a
  // question for the PDP -- none of them ends in an answer from here.
  const carried =
    request.principal.kind === "agent"
      ? anyCapabilityFor(request.principal.agentId)
      : undefined;
  const capabilityId = request.capability?.id ?? carried?.id ?? NO_KEYCARD;

  try {
    const result = await api.readResource(room.resourceUri, capabilityId);
    return result.decision;
  } catch (error) {
    if (error instanceof PolicyDeniedError) return error.decision;
    // The guard could not be reached. Fail closed: an unreachable PDP is a
    // deny, exactly as the server-side gate treats a PDP that throws.
    return {
      effect: "deny",
      reason: "policy-unreachable",
      requestId: request.requestId,
      decidedAt: new Date().toISOString(),
    };
  }
}
