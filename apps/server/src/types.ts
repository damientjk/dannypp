export type AgentStatus = "ready" | "busy" | "stopped" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type MessageRole = "user" | "assistant";

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
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface RunUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: RunStatus;
  prompt: string;
  output: string | null;
  error: string | null;
  usage: RunUsage | null;
  /**
   * The Run is started but held at the authorization gate, waiting for its
   * owner to grant a keycard. Surfaced so the Playground can say so instead of
   * claiming Codex is busy working -- nothing is running yet.
   */
  awaitingCapability: boolean;
  /**
   * How many resources the gate evaluated and withheld.
   *
   * A count, not a list: the gate sweeps the owner's whole namespace at run
   * start, so the withheld set is "everything you did not grant" -- naming a
   * thousand files nobody asked for would bury the one that matters. What the
   * Agent could NOT see is a quantity; what it COULD see is the interesting part.
   */
  withheldCount: number;
  /** Resources the gate placed in the workspace, by name. */
  stagedResources: string[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Database {
  version: 1;
  agents: Agent[];
  messages: Message[];
  runs: AgentRun[];
}

export interface CreateAgentInput {
  ownerId: string;
  name: string;
  description?: string | undefined;
  instructions?: string | undefined;
}

export interface UpdateAgentInput {
  name?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
}

export interface RunnerResult {
  output: string;
  threadId: string | null;
  usage: RunUsage | null;
}

export interface RunnerRequest {
  agentId: string;
  workspacePath: string;
  prompt: string;
  threadId: string | null;
}

export interface AgentRunner {
  run(request: RunnerRequest): Promise<RunnerResult>;
  cancel(agentId: string): Promise<boolean>;
  isAvailable(): Promise<boolean>;
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

export interface AuthContext {
  humanPrincipal: HumanPrincipal;
  agentPrincipal: AgentPrincipal;
  capability: Capability
  requestId: string;
}

export type PolicyEffect = "permit" | "deny";

export interface PolicyRequest {
  principal: Principal;
  action: string; // "read" | "write"
  resource: string;
  capability?: Capability | undefined;
  requestId: string;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  reason: string;
  requestId: string;
  decidedAt: string;
}

export interface PolicyDecisionPoint {
  decide(request: PolicyRequest): Promise<PolicyDecision>;
}
