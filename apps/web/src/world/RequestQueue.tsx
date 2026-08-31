/**
 * The access-request queue, rendered beside the Playground composer.
 *
 * Same queue the world canvas draws toasts for — it reads the shared request
 * store, so a request raised by an agent walking into Billing appears here the
 * moment it is raised, and granting it here clears the toast over there.
 *
 * A decision still takes two clicks (arm, then confirm), exactly as it does in
 * the world panel: granting a keycard is a permission change, not a dismissal.
 */

import { useState } from "react";
import { cssColorForAgent } from "./agentAppearance";
import { denyRequest, grantRequest } from "./decisions";
import { useEventLog, useRequests } from "./useWorldStores";
import { roomById } from "./resources";

export interface RequestQueueProps {
  /** Owner whose rooms are being guarded; null until the world is signed in. */
  ownerId: string | null;
  ownerName: string;
}

export function RequestQueue({ ownerId, ownerName }: RequestQueueProps) {
  const requests = useRequests();
  const events = useEventLog();
  const [armed, setArmed] = useState<{ id: string; action: "grant" | "deny" } | null>(null);

  const mine = ownerId
    ? requests.filter((request) => request.roomOwnerId === ownerId)
    : [];
  const recent = events.slice(0, 4);

  return (
    <section className="request-queue" aria-label="Incoming access requests">
      <div className="request-queue-head">
        <span className="eyebrow">Incoming requests</span>
        <span className={"request-queue-count" + (mine.length > 0 ? " request-queue-count-live" : "")}>
          {mine.length}
        </span>
      </div>

      {!ownerId ? (
        <p className="request-queue-empty">
          Sign in to the world on the right to receive requests.
        </p>
      ) : mine.length === 0 ? (
        <p className="request-queue-empty">
          No agent is waiting on you. Send a task and watch one walk into a room it
          does not hold a keycard for.
        </p>
      ) : (
        <ul className="request-queue-list">
          {mine.map((request) => {
            const roomName = roomById(request.roomId).displayName;
            const state = armed?.id === request.id ? armed.action : null;
            return (
              <li key={request.id} className="request-queue-item">
                <p className="request-queue-line">
                  <span
                    className="log-dot"
                    style={{ background: cssColorForAgent(request.agentId) }}
                    aria-hidden="true"
                  />
                  <strong>{request.agentName}</strong> wants access to <strong>{roomName}</strong>
                </p>
                {state ? (
                  <div className="request-queue-confirm">
                    <p>
                      {state === "grant"
                        ? `Give ${request.agentName} a keycard for ${roomName}?`
                        : `Refuse ${request.agentName} access to ${roomName}?`}
                    </p>
                    <div className="request-queue-actions">
                      <button
                        type="button"
                        className={state === "grant" ? "confirm-grant" : "confirm-deny"}
                        onClick={() => {
                          setArmed(null);
                          if (state === "grant") grantRequest(request, ownerName);
                          else denyRequest(request, ownerName);
                        }}
                      >
                        {state === "grant" ? "Confirm grant" : "Confirm deny"}
                      </button>
                      <button type="button" onClick={() => setArmed(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="request-queue-actions">
                    <button
                      type="button"
                      className="confirm-grant"
                      onClick={() => setArmed({ id: request.id, action: "grant" })}
                    >
                      Grant
                    </button>
                    <button
                      type="button"
                      className="confirm-deny"
                      onClick={() => setArmed({ id: request.id, action: "deny" })}
                    >
                      Deny
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {recent.length > 0 && (
        <ul className="request-queue-log">
          {recent.map((event) => (
            <li key={event.id} className={"request-queue-log-row log-" + event.category}>
              <span className="request-queue-log-badge">{event.category}</span>
              {event.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
