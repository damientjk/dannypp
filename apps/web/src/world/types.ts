import type { PolicyEffect } from "../types";

/** A room is a folder, addressed by its canonical URI: "res://user-a/notes". */
export type RoomId = string;

export type Facing = "up" | "down" | "left" | "right";

/** `waiting` = the next tile is held by another agent; the step is deferred. */
export type AgentMoveStatus = "idle" | "walking" | "waiting" | "denied-bounce";

export interface WorldAgent {
  agentId: string;
  ownerId: string;
  name: string;
  x: number;
  y: number;
  originX: number;
  originY: number;
  targetX: number;
  targetY: number;
  facing: Facing;
  status: AgentMoveStatus;
  currentRoom: RoomId | "common";
  progress: number;
  pendingEffect: PolicyEffect | null;
  pendingRoom: RoomId | null;
  path: Array<{ x: number; y: number }>;
  pathIndex: number;
  /** Consecutive frames spent blocked by another agent. Breaks deadlocks. */
  waitTicks: number;
}

export interface DecisionEvent {
  requestId: string;
  agentId: string;
  agentName: string;
  room: RoomId;
  /** Folder label the room stands for, e.g. "notes/". */
  roomLabel: string;
  /** File the agent was after, e.g. "today.md". */
  file: string;
  effect: PolicyEffect;
  reason: string;
  decidedAt: string;
}
