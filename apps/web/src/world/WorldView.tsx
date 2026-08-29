import { useCallback, useEffect, useRef, useState } from "react";
import { api, setSessionToken } from "../api";
import type { Agent, AgentRun, HumanPrincipal, Message, PolicyRequestLike } from "../types";
import { beginHeadingToDesk, endWorking, spawnWorldAgents } from "./agentSim";
import {
  decideRoomEntry,
  getCapability,
  grantedRoomsFor,
  issueCapability,
  newId,
  revokeCapability,
} from "./decision";
import { WorldCanvas } from "./WorldCanvas";
import { loadWorldMap } from "./engineMap";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import type { AccessRequest } from "./requests";
import {
  clearDeniedForAgent,
  hasPendingRequest,
  markDenied,
  pendingRequestsFor,
  queueRequest,
  resolveRequest,
} from "./requests";
import { roomById } from "./resources";
import type { LogEntry, WorldAgent } from "./types";

const TEST_USERS = [
  { userId: "user-a", password: "demo-a", label: "Log in as User A" },
  { userId: "user-b", password: "demo-b", label: "Log in as User B" },
];

const AGENT_POLL_MS = 3000;

export function WorldView() {
  const [principal, setPrincipal] = useState<HumanPrincipal | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [worldAgents, setWorldAgents] = useState<WorldAgent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapRenderer, setMapRenderer] = useState<TiledMapRenderer | null>(null);
  const [, setRequestVersion] = useState(0);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const worldAgentsRef = useRef<WorldAgent[]>([]);
  worldAgentsRef.current = worldAgents;

  useEffect(() => {
    let cancelled = false;
    loadWorldMap()
      .then((renderer) => {
        if (!cancelled) setMapRenderer(renderer);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            "Failed to load the world map" + (err instanceof Error ? `: ${err.message}` : ""),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (userId: string, password: string) => {
    if (!mapRenderer) {
      setError("World map is still loading — try again in a moment.");
      return;
    }
    try {
      const result = await api.login(userId, password);
      setSessionToken(result.sessionToken);
      setPrincipal(result.principal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }, [mapRenderer]);

  // Poll every agent's real status — this is what drives task-visits: an
  // agent only walks to its desk (or triggers a request) when its real
  // backend status flips to "busy".
  useEffect(() => {
    if (!principal) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { agents: nextAgents } = await api.listAgents();
        if (!cancelled) setAgents(nextAgents);
      } catch {
        // transient poll failure; try again next interval
      }
    };
    poll();
    const interval = setInterval(poll, AGENT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [principal]);

  // Keep worldAgents in sync with the polled roster: spawn newcomers,
  // drop agents that disappeared, leave everyone else's position/behavior
  // untouched (a naive full respawn every poll would visibly reset
  // everyone's position every 3s).
  useEffect(() => {
    if (!mapRenderer) return;
    setWorldAgents((current) => {
      const currentIds = new Set(current.map((wa) => wa.agentId));
      const nextIds = new Set(agents.map((a) => a.id));
      const kept = current.filter((wa) => nextIds.has(wa.agentId));
      const newAgents = agents.filter((a) => !currentIds.has(a.id));
      if (newAgents.length === 0) return kept.length === current.length ? current : kept;
      return [...kept, ...spawnWorldAgents(newAgents, mapRenderer)];
    });
  }, [agents, mapRenderer]);

  // The task-visit orchestration: for every agent that's really busy and
  // still just roaming, ask the seam whether it may enter its assigned
  // room. Permit -> walk to a desk. Deny -> queue an access request; the
  // agent's movement is left completely alone either way (spec §4 — "same
  // animation is kept"). For agents that stopped being busy while working,
  // release the desk back to roaming.
  useEffect(() => {
    if (!mapRenderer) return;
    let cancelled = false;

    // Desks claimed so far *in this pass*. Seeded from the last-committed
    // occupancy and updated after every successful claim below — since
    // decideRoomEntry never really suspends (no I/O), this loop drains as a
    // chain of microtasks with no render committing in between, so without
    // this accumulator every agent in one poll would see the same stale
    // snapshot and could pile onto the same desk (finding 1).
    const claimed = new Set(
      worldAgentsRef.current.filter((wa) => wa.occupiedDeskId).map((wa) => wa.occupiedDeskId!),
    );

    (async () => {
      for (const agent of agents) {
        if (cancelled) return;
        const worldAgent = worldAgentsRef.current.find((wa) => wa.agentId === agent.id);
        if (!worldAgent || !worldAgent.assignedRoomId) continue;

        const isBusy = agent.status === "busy";
        if (isBusy && worldAgent.behaviorMode === "roaming") {
          if (hasPendingRequest(agent.id, worldAgent.assignedRoomId)) continue;
          const room = roomById(worldAgent.assignedRoomId);
          const requestId = newId();
          const request: PolicyRequestLike = {
            principal: {
              kind: "agent",
              id: "agent-principal-" + agent.id,
              agentId: agent.id,
              ownerId: agent.ownerId,
            },
            action: "enter",
            resource: room.id,
            capability: getCapability(agent.id, room.id),
            requestId,
          };
          const decision = await decideRoomEntry(request);
          if (cancelled) return;

          // Log the raw PDP decision only once it represents an actual state
          // change, not on every re-decided-but-nothing-changed poll — see
          // finding 6 (permit while every desk is full) and its analogue on
          // the deny side, now covered by the same guard.
          if (decision.effect === "permit") {
            const updated = beginHeadingToDesk(worldAgent, room, claimed, mapRenderer);
            if (updated) {
              claimed.add(updated.occupiedDeskId!);
              setWorldAgents((current) =>
                current.map((wa) => (wa.agentId === agent.id ? updated : wa)),
              );
              setEvents((current) => [
                {
                  id: requestId,
                  category: "permit",
                  message: `${agent.name} → ${room.displayName}: permit (${decision.reason})`,
                  timestamp: decision.decidedAt,
                },
                ...current,
              ]);
            }
            // else: every desk is occupied, agent keeps roaming and waits
            // (spec §4) — nothing changed, so nothing new to log.
          } else {
            const queued = queueRequest({
              agentId: agent.id,
              agentName: agent.name,
              roomId: room.id,
              roomOwnerId: room.ownerId!,
            });
            if (queued) {
              setEvents((current) => [
                {
                  id: requestId,
                  category: "deny",
                  message: `${agent.name} → ${room.displayName}: deny (${decision.reason})`,
                  timestamp: decision.decidedAt,
                },
                {
                  id: newId(),
                  category: "requested",
                  message: `${agent.name} requested access to ${room.displayName}`,
                  timestamp: decision.decidedAt,
                },
                ...current,
              ]);
              setRequestVersion((v) => v + 1);
            }
            // else: already pending or already denied this cycle — no new
            // toast, no duplicate log line (finding 2).
          }
        } else if (!isBusy) {
          // Task cycle ended — clear any denied marks so a later cycle can
          // ask again (spec §5), regardless of whether the agent ever made
          // it to a desk (a denied agent stays "roaming", never "working").
          clearDeniedForAgent(agent.id);
          if (worldAgent.behaviorMode === "working") {
            setWorldAgents((current) =>
              current.map((wa) => (wa.agentId === agent.id ? endWorking(wa) : wa)),
            );
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // worldAgents.length (not the array itself, which changes every render
    // tick from WorldCanvas's onFrame) is needed here too: within the same
    // effect-flush where a poll first populates `agents`, the reconciliation
    // effect above schedules setWorldAgents for the *next* render — this
    // effect's worldAgentsRef.current snapshot is still the pre-spawn one.
    // Without depending on the roster size, this effect would never get a
    // second chance to see a freshly-spawned agent's assignedRoomId.
    // ponytail: length as a cheap "roster changed" signal, not a deep dep
  }, [agents, mapRenderer, worldAgents.length]);

  // Re-fetch whenever the selected agent's polled status changes (not just
  // on selection) — otherwise a run that starts *after* the agent is already
  // selected never appears, and the detail panel's "current task" is stuck
  // showing "Idle" for an agent that's visibly busy and walking to its desk.
  const selectedAgentStatus = agents.find((agent) => agent.id === selectedId)?.status;

  useEffect(() => {
    if (!selectedId) {
      setRuns([]);
      setMessages([]);
      return;
    }
    api
      .runs(selectedId)
      .then((result) => {
        if (selectedIdRef.current === selectedId) setRuns(result.runs);
      })
      .catch(() => {});
    api
      .messages(selectedId)
      .then((result) => {
        if (selectedIdRef.current === selectedId) setMessages(result.messages);
      })
      .catch(() => {});
  }, [selectedId, selectedAgentStatus]);

  const grantRequest = useCallback((request: AccessRequest) => {
    issueCapability(request.agentId, request.roomId);
    resolveRequest(request.id);
    setRequestVersion((v) => v + 1);
    setEvents((current) => [
      {
        id: newId(),
        category: "granted",
        message: `${principal?.displayName ?? "Owner"} granted ${request.agentName} access to ${roomById(request.roomId).displayName}`,
        timestamp: new Date().toISOString(),
      },
      ...current,
    ]);
  }, [principal]);

  const denyRequest = useCallback((request: AccessRequest) => {
    resolveRequest(request.id);
    markDenied(request.agentId, request.roomId);
    setRequestVersion((v) => v + 1);
    setEvents((current) => [
      {
        id: newId(),
        category: "denied",
        message: `${principal?.displayName ?? "Owner"} denied ${request.agentName} access to ${roomById(request.roomId).displayName}`,
        timestamp: new Date().toISOString(),
      },
      ...current,
    ]);
  }, [principal]);

  const revokeRoom = useCallback((agentId: string, roomId: string) => {
    revokeCapability(agentId, roomId);
    setRequestVersion((v) => v + 1);
  }, []);

  if (!principal) {
    return (
      <div className="world-login">
        <div className="world-title-box">
          <p className="world-eyebrow">SIGN IN</p>
          <h2 className="world-title">Agent Pixel World</h2>
          <p className="world-subtitle">log in to grant or receive access requests for your rooms</p>
        </div>
        <div className="world-select-grid">
          {TEST_USERS.map((user, index) => (
            <button
              key={user.userId}
              className={"world-select-card " + (index === 0 ? "world-select-card-a" : "world-select-card-b")}
              onClick={() => login(user.userId, user.password)}
              disabled={!mapRenderer}
            >
              <span className="world-select-portrait" aria-hidden="true">
                <span className="world-select-eye" />
                <span className="world-select-eye" />
                <span className="world-select-mouth" />
              </span>
              <span className="world-select-label">{user.label}</span>
              <span className="world-select-cursor" aria-hidden="true">
                ►
              </span>
            </button>
          ))}
        </div>
        {error && <p className="world-title-error">▋ {error}</p>}
      </div>
    );
  }

  const selectedAgent = agents.find((agent) => agent.id === selectedId) ?? null;
  const selectedWorldAgent = worldAgents.find((wa) => wa.agentId === selectedId) ?? null;
  const selectedRoom = selectedWorldAgent?.assignedRoomId ? roomById(selectedWorldAgent.assignedRoomId) : null;
  const selectedGrantedRooms = selectedAgent ? grantedRoomsFor(selectedAgent.id) : [];
  const activeRun = runs.find((run) => run.status === "running" || run.status === "queued") ?? null;
  const myRequests = pendingRequestsFor(principal.id);

  return (
    <div className="world-layout">
      <div className="world-canvas-wrap">
        <WorldCanvas agents={worldAgents} onFrame={setWorldAgents} />
      </div>
      <aside className="world-panel">
        <h3>{principal.displayName}</h3>
        {selectedAgent ? (
          <div className="world-detail-panel">
            <h4>{selectedAgent.name}</h4>
            <p className="world-detail-role">
              {selectedRoom ? `Works on: ${selectedRoom.displayName}` : "No assigned room"}
            </p>
            <p className="world-detail-task">
              {selectedAgent.status === "busy" && activeRun ? activeRun.prompt : "Idle"}
            </p>
            <h5>Granted rooms</h5>
            {selectedGrantedRooms.length === 0 ? (
              <p className="world-detail-empty">None yet</p>
            ) : (
              <ul className="world-granted-rooms">
                {selectedGrantedRooms.map((roomId) => (
                  <li key={roomId}>
                    {roomById(roomId).displayName}
                    <button onClick={() => revokeRoom(selectedAgent.id, roomId)}>Revoke</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="world-detail-empty">Select an agent below</p>
        )}
        <section>
          <h4>Security log</h4>
          <ul>
            {events.map((event) => (
              <li key={event.id} className={"effect-" + event.category}>
                {event.message}
              </li>
            ))}
          </ul>
        </section>
      </aside>
      <div className="world-request-toasts">
        {myRequests.map((request) => (
          <div key={request.id} className="world-request-toast">
            <p>
              {request.agentName} wants access to {roomById(request.roomId).displayName}
            </p>
            <div className="world-request-actions">
              <button onClick={() => grantRequest(request)}>Grant</button>
              <button onClick={() => denyRequest(request)}>Deny</button>
            </div>
          </div>
        ))}
      </div>
      <div className="world-agent-strip">
        {agents.map((agent) => {
          const worldAgent = worldAgents.find((wa) => wa.agentId === agent.id);
          const modeLabel =
            worldAgent?.behaviorMode === "working"
              ? "working"
              : worldAgent?.behaviorMode === "heading-to-desk"
                ? "heading to desk"
                : worldAgent?.assignedRoomId && hasPendingRequest(agent.id, worldAgent.assignedRoomId)
                  ? "awaiting access"
                  : "roaming";
          return (
            <button
              key={agent.id}
              className={"world-agent-card " + (agent.id === selectedId ? "selected" : "")}
              onClick={() => setSelectedId(agent.id)}
            >
              <span className="world-agent-avatar" aria-hidden="true">
                {agent.name.charAt(0)}
              </span>
              <span className="world-agent-name">{agent.name}</span>
              <span className="world-agent-status-pill">{modeLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
