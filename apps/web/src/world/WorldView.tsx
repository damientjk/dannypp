import { useCallback, useEffect, useRef, useState } from "react";
import { api, setSessionToken } from "../api";
import type { Agent, AgentRun, HumanPrincipal, Message, PolicyRequestLike } from "../types";
import { decideRoomEntry, getCapability, issueCapability, newId, revokeCapability } from "./decision";
import { beginMoveToRoom, spawnWorldAgents } from "./agentSim";
import { WorldCanvas } from "./WorldCanvas";
import { loadWorldMap } from "./engineMap";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import type { DecisionEvent, RoomId, WorldAgent } from "./types";

const TEST_USERS = [
  { userId: "user-a", password: "demo-a", label: "Log in as User A" },
  { userId: "user-b", password: "demo-b", label: "Log in as User B" },
];

export function WorldView() {
  const [principal, setPrincipal] = useState<HumanPrincipal | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [worldAgents, setWorldAgents] = useState<WorldAgent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<DecisionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapRenderer, setMapRenderer] = useState<TiledMapRenderer | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    let cancelled = false;
    loadWorldMap().then((renderer) => {
      if (!cancelled) setMapRenderer(renderer);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (userId: string, password: string) => {
    try {
      const result = await api.login(userId, password);
      setSessionToken(result.sessionToken);
      setPrincipal(result.principal);
      const { agents: nextAgents } = await api.listAgents();
      const ownedAgents = nextAgents.filter((agent) => agent.ownerId === result.principal.id);
      setAgents(ownedAgents);
      if (!mapRenderer) {
        setError("World map is still loading — try again in a moment.");
        return;
      }
      setWorldAgents(spawnWorldAgents(ownedAgents, mapRenderer!));
      for (const agent of ownedAgents) {
        issueCapability(agent.id, agent.ownerId);
      }
      setSelectedId(ownedAgents[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }, [mapRenderer]);

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
  }, [selectedId]);

  const sendToRoom = useCallback(
    async (room: RoomId) => {
      if (!selectedId) return;
      const agent = agents.find((candidate) => candidate.id === selectedId);
      if (!agent) return;

      const requestId = newId();
      const request: PolicyRequestLike = {
        principal: {
          kind: "agent",
          id: "agent-principal-" + agent.id,
          agentId: agent.id,
          ownerId: agent.ownerId,
        },
        action: "enter",
        resource: room,
        capability: getCapability(agent.id),
        requestId,
      };
      const decision = await decideRoomEntry(request);

      setWorldAgents((current) =>
        current.map((worldAgent) =>
          worldAgent.agentId === agent.id
            ? beginMoveToRoom(worldAgent, room, decision.effect, mapRenderer!)
            : worldAgent,
        ),
      );
      setEvents((current) => [
        {
          requestId,
          agentId: agent.id,
          agentName: agent.name,
          room,
          effect: decision.effect,
          reason: decision.reason,
          decidedAt: decision.decidedAt,
        },
        ...current,
      ]);
    },
    [agents, selectedId, mapRenderer],
  );

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

  return (
    <div className="world-layout">
      <WorldCanvas agents={worldAgents} onFrame={setWorldAgents} />
      <aside className="world-panel">
        <h3>{principal.displayName}</h3>
        <ul className="world-roster">
          {agents.map((agent) => (
            <li key={agent.id}>
              <button
                className={agent.id === selectedId ? "selected" : ""}
                onClick={() => setSelectedId(agent.id)}
              >
                {agent.name}
              </button>
            </li>
          ))}
        </ul>
        {selectedId && (
          <div className="world-controls">
            <button onClick={() => sendToRoom("house-a")}>Send to House A</button>
            <button onClick={() => sendToRoom("house-b")}>Send to House B</button>
            <button onClick={revoke}>Revoke keycard</button>
          </div>
        )}
        <section>
          <h4>Activity</h4>
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                {run.status}: {run.prompt}
              </li>
            ))}
          </ul>
          <ul>
            {messages.map((message) => (
              <li key={message.id}>
                {message.role}: {message.content}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>Security log</h4>
          <ul>
            {events.map((event) => (
              <li key={event.requestId} className={"effect-" + event.effect}>
                {event.agentName} → {event.room}: {event.effect} ({event.reason})
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
