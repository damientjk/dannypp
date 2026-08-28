import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, setSessionToken } from "../api";
import type { Agent, HumanPrincipal, PolicyRequestLike } from "../types";
import {
  decideRoomEntry,
  getCapability,
  issueCapability,
  newId,
  revokeCapability,
} from "./decision";
import { beginMoveToRoom, spawnWorldAgents } from "./agentSim";
import { cssColorForAgent } from "./agentAppearance";
import { WorldCanvas } from "./WorldCanvas";
import { loadWorldMap } from "./engineMap";
import { listFileUris, listFolderRooms, roomForFile, type FolderRoom } from "./folders";
import { planForAgent, targetAt } from "./roam";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import type { DecisionEvent, WorldAgent } from "./types";

/** How often an idle agent picks up the next file on its plan. */
export const ROAM_INTERVAL_MS = 1400;
/** Keeps the log bounded during a long unattended run. */
const MAX_LOG_ENTRIES = 60;

const TEST_USERS = [
  { userId: "user-a", password: "demo-a", label: "Log in as User A" },
  { userId: "user-b", password: "demo-b", label: "Log in as User B" },
];

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

const fileName = (uri: string): string => uri.slice(uri.lastIndexOf("/") + 1);

export interface WorldViewProps {
  /** Overridable so tests do not have to wait out the real cadence. */
  roamIntervalMs?: number;
}

export function WorldView({ roamIntervalMs = ROAM_INTERVAL_MS }: WorldViewProps = {}) {
  const [principal, setPrincipal] = useState<HumanPrincipal | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [worldAgents, setWorldAgents] = useState<WorldAgent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<DecisionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapRenderer, setMapRenderer] = useState<TiledMapRenderer | null>(null);
  const [roaming, setRoaming] = useState(true);

  const rooms: FolderRoom[] = useMemo(() => listFolderRooms(), []);
  const fileUris = useMemo(() => listFileUris(rooms), [rooms]);

  // Refs so the roam interval reads live values without being torn down and
  // rebuilt on every frame of movement.
  const worldAgentsRef = useRef<WorldAgent[]>([]);
  const agentsRef = useRef<Agent[]>([]);
  const cursors = useRef(new Map<string, number>());
  worldAgentsRef.current = worldAgents;
  agentsRef.current = agents;

  useEffect(() => {
    let cancelled = false;
    loadWorldMap(rooms)
      .then((renderer) => {
        if (!cancelled) setMapRenderer(renderer);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            "Failed to build the world" + (err instanceof Error ? ": " + err.message : ""),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rooms]);

  const login = useCallback(
    async (userId: string, password: string) => {
      if (!mapRenderer) {
        setError("World is still loading - try again in a moment.");
        return;
      }
      try {
        const result = await api.login(userId, password);
        setSessionToken(result.sessionToken);
        setPrincipal(result.principal);
        const { agents: nextAgents } = await api.listAgents();
        const owned = nextAgents.filter((agent) => agent.ownerId === result.principal.id);
        setAgents(owned);
        setWorldAgents(spawnWorldAgents(owned, mapRenderer));
        for (const agent of owned) {
          issueCapability(agent.id, agent.ownerId);
        }
        setSelectedId(owned[0]?.id ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login failed");
      }
    },
    [mapRenderer],
  );

  /**
   * One access attempt: ask for a decision, then move the agent according to
   * what came back. The decision is never inferred from the movement.
   */
  const attemptFile = useCallback(
    async (agent: Agent, uri: string) => {
      const room = roomForFile(rooms, uri);
      if (!room || !mapRenderer) return;

      const requestId = newId();
      const request: PolicyRequestLike = {
        principal: {
          kind: "agent",
          id: "agent-principal-" + agent.id,
          agentId: agent.id,
          ownerId: agent.ownerId,
        },
        action: "read",
        resource: room.id,
        capability: getCapability(agent.id),
        requestId,
      };
      const decision = await decideRoomEntry(request);

      setWorldAgents((current) =>
        current.map((worldAgent) =>
          worldAgent.agentId === agent.id
            ? beginMoveToRoom(worldAgent, room.id, decision.effect, mapRenderer, current)
            : worldAgent,
        ),
      );
      setEvents((current) =>
        [
          {
            requestId,
            agentId: agent.id,
            agentName: agent.name,
            room: room.id,
            roomLabel: room.label,
            file: fileName(uri),
            effect: decision.effect,
            reason: decision.reason,
            decidedAt: decision.decidedAt,
          },
          ...current,
        ].slice(0, MAX_LOG_ENTRIES),
      );
    },
    [rooms, mapRenderer],
  );

  // Auto-roam: every idle agent picks up the next file on its own work plan.
  useEffect(() => {
    if (!roaming || !mapRenderer || agents.length === 0) return;
    const timer = window.setInterval(() => {
      for (const worldAgent of worldAgentsRef.current) {
        if (worldAgent.status !== "idle") continue;
        const agent = agentsRef.current.find((one) => one.id === worldAgent.agentId);
        if (!agent) continue;

        const cursor = cursors.current.get(agent.id) ?? 0;
        cursors.current.set(agent.id, cursor + 1);
        const target = targetAt(planForAgent(agent.id, fileUris), cursor);
        if (target) void attemptFile(agent, target);
      }
    }, roamIntervalMs);
    return () => window.clearInterval(timer);
  }, [roaming, mapRenderer, agents.length, fileUris, attemptFile, roamIntervalMs]);

  const revoke = useCallback(() => {
    if (selectedId) revokeCapability(selectedId);
  }, [selectedId]);

  if (!principal) {
    return (
      <div className="world-login">
        <div className="world-title-box">
          <p className="world-eyebrow">SAVE FILE SELECT</p>
          <h2 className="world-title">Agent Pixel World</h2>
          <p className="world-subtitle">choose a trainer to enter the world</p>
        </div>
        <div className="world-select-grid">
          {TEST_USERS.map((user, index) => (
            <button
              key={user.userId}
              className={
                "world-select-card " +
                (index === 0 ? "world-select-card-a" : "world-select-card-b")
              }
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
                &#9658;
              </span>
            </button>
          ))}
        </div>
        {error && <p className="world-title-error">{error}</p>}
      </div>
    );
  }

  const denials = events.filter((event) => event.effect === "deny").length;

  return (
    <div className="world-layout">
      <div className="world-stage">
        {mapRenderer && (
          <WorldCanvas
            renderer={mapRenderer}
            rooms={rooms}
            agents={worldAgents}
            onFrame={setWorldAgents}
          />
        )}
        <p className="world-caption">
          Rooms are folders. An agent walks to a folder because the next file on
          its plan lives there.
        </p>
      </div>

      <aside className="world-panel">
        <header className="panel-block panel-identity">
          <span className="panel-eyebrow">Signed in as</span>
          <h3>{principal.displayName}</h3>
          <div className="panel-stats">
            <span>
              <strong>{agents.length}</strong> agents
            </span>
            <span className={denials > 0 ? "stat-deny" : ""}>
              <strong>{denials}</strong> blocked
            </span>
          </div>
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
              const state = worldAgents.find((one) => one.agentId === agent.id);
              return (
                <li key={agent.id}>
                  <button
                    className={agent.id === selectedId ? "selected" : ""}
                    onClick={() => setSelectedId(agent.id)}
                  >
                    <span
                      className="roster-swatch"
                      style={{ background: cssColorForAgent(agent.id) }}
                      aria-hidden="true"
                    />
                    <span className="roster-name">{agent.name}</span>
                    <span className="roster-state">{state?.status ?? "idle"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selectedId && (
            <button className="revoke-button" onClick={revoke}>
              Shred this agent&apos;s keycard
            </button>
          )}
        </section>

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
                <li key={event.requestId} className={"log-row effect-" + event.effect}>
                  <span className="log-head">
                    <span className="log-time">{formatDecisionTime(event.decidedAt)}</span>
                    <span
                      className="log-who"
                      style={{ color: cssColorForAgent(event.agentId) }}
                    >
                      {event.agentName}
                    </span>
                    <span className={"log-badge log-badge-" + event.effect}>
                      {event.effect === "permit" ? "ALLOWED" : "BLOCKED"}
                    </span>
                  </span>
                  <span className="log-path">
                    {event.roomLabel}
                    <strong>{event.file}</strong>
                  </span>
                  <span className="log-reason">{event.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
