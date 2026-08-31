export type Facing = "up" | "down" | "left" | "right";
export type BehaviorMode = "roaming" | "heading-to-desk" | "working" | "jailed";

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
  /** While wandering, agents occasionally pause to read or check their
   *  phone (restUntil is a Date.now() deadline; null anim = not resting). */
  restAnim: "read" | "phone" | null;
  restUntil: number;
}

// Security log entry. Covers both raw PDP decisions (permit/deny, from
// decideRoomEntry) and owner/agent-facing moments the PDP never sees
// (requested / granted / denied-by-owner / jailed) — see spec §5's
// closing bullet.
// A plain formatted message (rather than trying to force every moment into
// PolicyEffect's permit|deny shape) keeps this additive and simple.
export type LogCategory = "permit" | "deny" | "requested" | "granted" | "denied" | "jailed";

export interface LogEntry {
  id: string;
  message: string;
  category: LogCategory;
  timestamp: string;
  /** Agent the entry is about, so the row can carry that agent's colour. */
  agentId?: string;
}
