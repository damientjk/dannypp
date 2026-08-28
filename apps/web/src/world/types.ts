import type { PolicyEffect } from "../types";

export type Facing = "up" | "down" | "left" | "right";
export type BehaviorMode = "roaming" | "heading-to-desk" | "working";

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
  progress: number;
  path: Array<{ x: number; y: number }>;
  pathIndex: number;
  behaviorMode: BehaviorMode;
  assignedRoomId: string | null;
  occupiedDeskId: string | null;
}

export interface DecisionEvent {
  requestId: string;
  agentId: string;
  agentName: string;
  room: string;
  effect: PolicyEffect;
  reason: string;
  decidedAt: string;
}
