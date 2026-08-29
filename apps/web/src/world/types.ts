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

// Security log entry. Covers both raw PDP decisions (permit/deny, from
// decideRoomEntry) and owner/agent-facing moments the PDP never sees
// (requested / granted / denied-by-owner) — see spec §5's closing bullet.
// A plain formatted message (rather than trying to force every moment into
// PolicyEffect's permit|deny shape) keeps this additive and simple.
export type LogCategory = "permit" | "deny" | "requested" | "granted" | "denied";

export interface LogEntry {
  id: string;
  message: string;
  category: LogCategory;
  timestamp: string;
}
