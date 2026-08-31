export type AgentStatus = "ready" | "busy" | "stopped" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Agent {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  instructions: string;
  status: AgentStatus;
  workspacePath: string;
  codexThreadId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  agentId: string;
  runId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: RunStatus;
  prompt: string;
  output: string | null;
  error: string | null;
  usage: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
  } | null;
  /** Held at the authorization gate, waiting for the owner to grant a keycard. */
  awaitingCapability: boolean;
  /** How many resources the gate evaluated and withheld. A count, not a list:
   *  the withheld set is "everything you did not grant". */
  withheldCount: number;
  /** Resources the gate placed in the workspace, by name. */
  stagedResources: string[];
  createdAt: string;
}

export interface SystemInfo {
  arkConfigured: boolean;
  arkBaseUrl: string;
  arkModel: string | null;
  codexAvailable: boolean;
  codexSandboxMode: string;
  runtimeProvider: "local-process" | "container";
  containerEngine: string | null;
  runtime: string;
}

export interface HumanPrincipal {
  kind: "human";
  id: string;
  displayName: string;
}

export interface AgentPrincipal {
  kind: "agent";
  id: string;
  agentId: string;
  ownerId: string;
}

export type Principal = HumanPrincipal | AgentPrincipal;

export interface Capability {
  id: string;
  scope: string;
  expiresAt: string;
  revokedAt: string | null;
}

/** A capability as the backend stores it, with the provenance the UI needs to
 *  attribute it to an Agent. */
export interface CapabilityRecord extends Capability {
  agentId: string;
  ownerId: string;
  runId: string | null;
  issuedAt: string;
  revokedBy: string | null;
}

export type PolicyEffect = "permit" | "deny";

export interface PolicyRequestLike {
  principal: Principal;
  action: string;
  resource: string;
  capability: Capability | undefined;
  requestId: string;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  reason: string;
  requestId: string;
  decidedAt: string;
}

/** A capability as the backend stores it -- richer than the PDP's view. */
export interface CapabilityRecord extends Capability {
  agentId: string;
  ownerId: string;
  runId: string | null;
  issuedAt: string;
  revokedBy: string | null;
}

/** One protected resource's metadata. Listing is not reading. */
export interface ResourceRef {
  uri: string;
  ownerId: string;
  name: string;
}

/** One decision as recorded by the backend audit log. */
export interface AuditEntry {
  id: string;
  requestId: string;
  decidedAt: string;
  humanId: string;
  agentId: string;
  principalKind: "human" | "agent";
  action: string;
  resource: string;
  effect: PolicyEffect;
  reason: string;
}
