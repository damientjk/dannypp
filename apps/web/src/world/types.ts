import type { PolicyEffect } from "../types";

export type RoomId = "house-a" | "house-b";

export type Facing = "up" | "down" | "left" | "right";

export type AgentMoveStatus = "idle" | "walking" | "denied-bounce";

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
}

export interface DecisionEvent {
  requestId: string;
  agentId: string;
  agentName: string;
  room: RoomId;
  effect: PolicyEffect;
  reason: string;
  decidedAt: string;
}
