import { useCallback, useEffect, useRef, useState } from "react";
import { api, setSessionToken } from "../api";
import type { Agent, AgentRun, HumanPrincipal, Message, PolicyRequestLike } from "../types";
import { beginHeadingToDesk, endWorking, jailAgent, releaseAgent, spawnWorldAgents } from "./agentSim";
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
import { FILE_ROOMS, roomById, roomForTask } from "./resources";
import { cssColorForAgent } from "./agentAppearance";
import type { LogEntry, WorldAgent } from "./types";

/**
 * Every Agent in this world belongs to one human: the person who created them.
 * Other owners still exist as *resource* owners (see FILE_ROOMS) — that is what
 * keeps "an Agent may not touch another owner's room" demonstrable — but there
 * is no second signed-in identity to choose between.
 */
const OWNER = { userId: "user-a", password: "demo-a", label: "Enter the world" };

const AGENT_POLL_MS = 3000;

/** Wall-clock time of the decision, so the log reads as an audit trail. */
function formatDecisionTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "--:--:--";
  return parsed.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const LOG_BADGE_LABELS: Record<LogEntry["category"], string> = {
  permit: "ALLOWED",
  deny: "BLOCKED",
  requested: "REQUESTED",
  granted: "GRANTED",
  denied: "DENIED",
  jailed: "JAILED",
};

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
  const [roaming, setRoaming] = useState(true);
  // A grant/deny is a permission change, so it takes two deliberate clicks:
  // the first only arms the decision, the second commits it.
  const [pendingDecision, setPendingDecision] = useState<
    { requestId: string; action: "grant" | "deny" } | null
  >(null);
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
  // room. Permit -> walk to a desk. Deny on another owner's room -> caught
  // red-handed, teleported to the Jail (jailAgent). Deny on its own owner's
  // room -> queue an access request, movement left alone (spec §4 — "same
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
          // Where the Agent goes is decided by the task it was handed, not by
          // a hash — which is also how it can end up at a folder its owner
          // does not own. Resolution is deliberately ownership-blind; the
          // guard below is the thing that refuses.
          const room = roomForTask(await activePromptFor(agent.id), agent);
          if (!room) continue;
          if (hasPendingRequest(agent.id, room.id)) continue;
          if (room.id !== worldAgent.assignedRoomId) {
            setWorldAgents((current) =>
              current.map((wa) =>
                wa.agentId === agent.id ? { ...wa, assignedRoomId: room.id } : wa,
              ),
            );
          }
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
                  agentId: agent.id,
                  category: "permit",
                  message: `${agent.name} → ${room.displayName}: permit (${decision.reason})`,
                  timestamp: decision.decidedAt,
                },
                ...current,
              ]);
            }
            // else: every desk is occupied, agent keeps roaming and waits
            // (spec §4) — nothing changed, so nothing new to log.
          } else if (room.ownerId !== null && room.ownerId !== agent.ownerId) {
            // Caught reaching for another owner's room: no request toast, no
            // negotiation — straight to jail. Flipping behaviorMode off
            // "roaming" is also what keeps this branch from re-firing (and
            // re-logging) on every later poll of the same busy run.
            setWorldAgents((current) =>
              current.map((wa) => (wa.agentId === agent.id ? jailAgent(wa, mapRenderer) : wa)),
            );
            setEvents((current) => [
              {
                id: newId(),
                agentId: agent.id,
                category: "jailed",
                message: `${agent.name} was caught touching ${room.displayName} → thrown in the Jail`,
                timestamp: decision.decidedAt,
              },
              {
                id: requestId,
                agentId: agent.id,
                category: "deny",
                message: `${agent.name} → ${room.displayName}: deny (${decision.reason})`,
                timestamp: decision.decidedAt,
              },
              ...current,
            ]);
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
                  agentId: agent.id,
                  category: "deny",
                  message: `${agent.name} → ${room.displayName}: deny (${decision.reason})`,
                  timestamp: decision.decidedAt,
                },
                {
                  id: newId(),
                  agentId: agent.id,
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
          } else if (worldAgent.behaviorMode === "jailed") {
            // Sentence served — the run that got it caught is over. Walk free.
            setWorldAgents((current) =>
              current.map((wa) => (wa.agentId === agent.id ? releaseAgent(wa, mapRenderer) : wa)),
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

  /** Prompt of the run this agent is currently on, or null if it has none. */
  const activePromptFor = useCallback(async (agentId: string): Promise<string | null> => {
    try {
      const { runs: agentRuns } = await api.runs(agentId);
      const active = agentRuns.find(
        (run) => run.status === "running" || run.status === "queued",
      );
      return active?.prompt ?? null;
    } catch {
      // A failed lookup just means we fall back to the agent's home room.
      return null;
    }
  }, []);

  const grantRequest = useCallback((request: AccessRequest) => {
    setPendingDecision(null);
    issueCapability(request.agentId, request.roomId);
    resolveRequest(request.id);
    setRequestVersion((v) => v + 1);
    setEvents((current) => [
      {
        id: newId(),
        agentId: request.agentId,
        category: "granted",
        message: `${principal?.displayName ?? "Owner"} granted ${request.agentName} access to ${roomById(request.roomId).displayName}`,
        timestamp: new Date().toISOString(),
      },
      ...current,
    ]);
  }, [principal]);

  const denyRequest = useCallback((request: AccessRequest) => {
    setPendingDecision(null);
    resolveRequest(request.id);
    markDenied(request.agentId, request.roomId);
    setRequestVersion((v) => v + 1);
    setEvents((current) => [
      {
        id: newId(),
        agentId: request.agentId,
        category: "denied",
        message: `${principal?.displayName ?? "Owner"} denied ${request.agentName} access to ${roomById(request.roomId).displayName}`,
        timestamp: new Date().toISOString(),
      },
      ...current,
    ]);
  }, [principal]);

  if (!principal) {
    return (
      <div className="world-login">
        <div className="world-title-box">
          <p className="world-eyebrow">SIGN IN</p>
          <h2 className="world-title">Agent Pixel World</h2>
          <p className="world-subtitle">sign in to grant or refuse access requests from your agents</p>
        </div>
        <div className="world-select-grid">
          <button
            className="world-select-card world-select-card-a"
            onClick={() => login(OWNER.userId, OWNER.password)}
            disabled={!mapRenderer}
          >
            <span className="world-select-portrait" aria-hidden="true">
              <span className="world-select-eye" />
              <span className="world-select-eye" />
              <span className="world-select-mouth" />
            </span>
            <span className="world-select-label">{OWNER.label}</span>
            <span className="world-select-cursor" aria-hidden="true">
              ►
            </span>
          </button>
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
  // Attempts the policy engine refused, counted over the whole session. NOT a
  // live "how many agents are blocked right now": granting access does not
  // decrement it, and an owner's own refusal is category "denied", not "deny".
  const blockedCount = events.filter((event) => event.category === "deny").length;

  // Revokes every room this agent currently holds, in one action — the
  // detail panel just lists what it has, it never offers a per-room undo.
  const shredKeycard = () => {
    if (!selectedAgent || selectedGrantedRooms.length === 0) return;
    for (const roomId of selectedGrantedRooms) revokeCapability(selectedAgent.id, roomId);
    setRequestVersion((v) => v + 1);
    setEvents((current) => [
      {
        id: newId(),
        agentId: selectedAgent.id,
        category: "denied",
        message: `${principal.displayName} shredded ${selectedAgent.name}'s keycard (${selectedGrantedRooms.length} room${selectedGrantedRooms.length === 1 ? "" : "s"} revoked)`,
        timestamp: new Date().toISOString(),
      },
      ...current,
    ]);
  };

  return (
    <div className="world-layout">
      <div className="world-canvas-wrap">
        <WorldCanvas
          agents={worldAgents}
          onFrame={setWorldAgents}
          paused={!roaming}
          viewerOwnerId={principal.id}
        />
      </div>
      <aside className="world-panel">
        <header className="panel-block panel-identity">
          <span className="panel-eyebrow">Signed in as</span>
          <h3>{principal.displayName}</h3>
        </header>

        <section className="panel-block">
          <div className="panel-head">
            <h4>Agents</h4>
            <button
              className={"roam-toggle " + (roaming ? "roam-on" : "")}
              onClick={() => setRoaming((value) => !value)}
            >
              {roaming ? "Pause roaming" : "Resume roaming"}
            </button>
          </div>
          <ul className="world-roster">
            {agents.map((agent) => {
              const worldAgent = worldAgents.find((wa) => wa.agentId === agent.id);
              const modeLabel =
                worldAgent?.behaviorMode === "jailed"
                  ? "in jail"
                  : worldAgent?.behaviorMode === "working"
                    ? "working"
                    : worldAgent?.behaviorMode === "heading-to-desk"
                      ? "heading to desk"
                      : worldAgent?.assignedRoomId && hasPendingRequest(agent.id, worldAgent.assignedRoomId)
                      ? "awaiting access"
                      : "roaming";
              return (
                <li key={agent.id}>
                  <button
                    className={agent.id === selectedId ? "selected" : ""}
                    onClick={() => setSelectedId((current) => (current === agent.id ? null : agent.id))}
                  >
                    <span
                      className="world-agent-avatar"
                      style={{ background: cssColorForAgent(agent.id) }}
                      aria-hidden="true"
                    >
                      {agent.name.charAt(0)}
                    </span>
                    <span className="roster-name">{agent.name}</span>
                    <span className="roster-state">{modeLabel}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {selectedAgent ? (
          <section className="panel-block world-detail-panel">
            <h4>{selectedAgent.name}</h4>
            <p className="world-detail-role">{selectedAgent.description || "No description on file."}</p>
            <p className="world-detail-role">
              {selectedRoom ? `Works on: ${selectedRoom.displayName}` : "No assigned room"}
            </p>
            <p className="world-detail-task">
              {selectedAgent.status === "busy" && activeRun ? activeRun.prompt : "Idle"}
            </p>
            <h5>Keycards</h5>
            {/* Every protected room, not just the granted ones — the point is
                to show at a glance which rooms this agent may NOT enter. */}
            <ul className="keycard-wall">
              {FILE_ROOMS.filter((room) => room.requiresPermission).map((room) => {
                const held = selectedGrantedRooms.includes(room.id);
                const foreign = room.ownerId !== principal.id;
                const state = foreign ? "foreign" : held ? "held" : "missing";
                const stateLabel = foreign
                  ? "another owner"
                  : held
                    ? "keycard held"
                    : "no keycard";
                return (
                  <li key={room.id} className={"keycard keycard-" + state}>
                    <span
                      className="keycard-stripe"
                      style={held ? { background: cssColorForAgent(selectedAgent.id) } : undefined}
                      aria-hidden="true"
                    />
                    <span className="keycard-body">
                      <span className="keycard-room">{room.displayName}</span>
                      <span className="keycard-state">{stateLabel}</span>
                    </span>
                    <span className="keycard-mark" aria-hidden="true">
                      {foreign ? "✕" : held ? "✓" : "–"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <button className="revoke-button" onClick={shredKeycard} disabled={selectedGrantedRooms.length === 0}>
              Shred this agent&apos;s keycard
            </button>
          </section>
        ) : (
          <section className="panel-block">
            <div className="panel-stats">
              <span>
                <strong>{agents.length}</strong> agents
              </span>
              <span className={blockedCount > 0 ? "stat-deny" : ""}>
                <strong>{blockedCount}</strong> blocked attempts
              </span>
            </div>
            <p className="world-detail-empty">Select an agent to view its permissions and traits.</p>
          </section>
        )}

        <section className="panel-block security-log">
          <div className="panel-head">
            <h4>Security log</h4>
            <span className="panel-count">{events.length}</span>
          </div>
          {events.length === 0 ? (
            <p className="security-log-empty">No access attempts yet.</p>
          ) : (
            <ul>
              {events.map((event) => (
                <li key={event.id} className={"log-row effect-" + event.category}>
                  <span className="log-head">
                    {event.agentId && (
                      <span
                        className="log-dot"
                        style={{ background: cssColorForAgent(event.agentId) }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="log-time">{formatDecisionTime(event.timestamp)}</span>
                    <span className={"log-badge log-badge-" + event.category}>
                      {LOG_BADGE_LABELS[event.category]}
                    </span>
                  </span>
                  <span className="log-message">{event.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
      <div className="world-request-toasts">
        {myRequests.map((request) => {
          const armed = pendingDecision?.requestId === request.id ? pendingDecision.action : null;
          const roomName = roomById(request.roomId).displayName;
          return (
            <div key={request.id} className="world-request-toast">
              <p>
                <span
                  className="log-dot"
                  style={{ background: cssColorForAgent(request.agentId) }}
                  aria-hidden="true"
                />
                {request.agentName} wants access to {roomName}
              </p>
              {armed ? (
                <div className="world-request-confirm">
                  <p className="world-request-question">
                    {armed === "grant"
                      ? `Give ${request.agentName} a keycard for ${roomName}?`
                      : `Refuse ${request.agentName} access to ${roomName}?`}
                  </p>
                  <div className="world-request-actions">
                    <button
                      className={armed === "grant" ? "confirm-grant" : "confirm-deny"}
                      onClick={() =>
                        armed === "grant" ? grantRequest(request) : denyRequest(request)
                      }
                    >
                      {armed === "grant" ? "Confirm grant" : "Confirm deny"}
                    </button>
                    <button onClick={() => setPendingDecision(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="world-request-actions">
                  <button
                    onClick={() => setPendingDecision({ requestId: request.id, action: "grant" })}
                  >
                    Grant
                  </button>
                  <button
                    onClick={() => setPendingDecision({ requestId: request.id, action: "deny" })}
                  >
                    Deny
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
