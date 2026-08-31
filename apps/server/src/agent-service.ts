import { randomUUID } from "node:crypto";
import type { AuditEntry } from "./audit/log.js";
import { AuditLog } from "./audit/log.js";
import type { AppConfig } from "./config.js";
import { isArkConfigured } from "./config.js";
import { HttpError, RunCancelledError } from "./errors.js";
import type { CapabilityRecord } from "./capability/store.js";
import { capabilityStore, issueCapabilityForRun } from "./capability/store.js";
import { scopeAllows, scopeAllowsAction } from "./capability/scope.js";
import type { ResourceAccessGate } from "./resources/access.js";
import type { ResourceStore } from "./resources/store.js";
import type { CallerContext } from "./policy/pep.js";
import { AgentAction, PolicyDeniedError, checkAgentAccess } from "./policy/pep.js";
import { buildAgentResource } from "./policy/resource.js";
import { JsonStore } from "./store.js";
import type {
  Agent,
  AgentPrincipal,
  AgentRun,
  AgentRunner,
  Capability,
  CreateAgentInput,
  Message,
  Principal,
  UpdateAgentInput,
} from "./types.js";
import { WorkspaceManager } from "./workspace.js";
import { processSecrets, redact } from "./secrets/redact.js";

/** How often the staging wait re-checks for a freshly granted keycard. */
const GRANT_POLL_MS = 500;

/**
 * How long a Run waits before it asks the human for a keycard.
 *
 * Long enough for a decision that is already coming to arrive first: a
 * cross-owner reach is caught and refused within a second or two, and asking
 * for a keycard in the meantime offers a choice that was never available.
 */
const AWAIT_NOTICE_MS = 4000;

const now = () => new Date().toISOString();

export class AgentService {
  private readonly activeExecutions = new Map<string, Promise<void>>();
  private readonly cancellationRequests = new Set<string>();
  /** Agents whose owner has refused the keycard their Run is waiting for,
   *  with the reason to report -- refusals differ, and "another owner's
   *  resource" is a different fact from "I said no". */
  private readonly capabilityDenials = new Map<string, string>();

  /**
   * Credentials that must never reach persisted output (Person 3).
   * AGENTS.md asks the model not to print them; this makes sure it cannot.
   * Computed per call because `config` is a constructor parameter property.
   */
  private secrets(): string[] {
    return processSecrets(this.config);
  }

  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
    private readonly workspaces: WorkspaceManager,
    private readonly runner: AgentRunner,
    private readonly audit: AuditLog,
    /**
     * Capability-gated resource materialisation (Person 3). Optional so the
     * baseline and Person 2's existing tests can construct a service without
     * it; index.ts always supplies it.
     */
    private readonly resourceAccess?: {
      gate: ResourceAccessGate;
      resources: ResourceStore;
    },
  ) {}

  private findAgentRecord(id: string): Agent {
    const agent = this.store.snapshot().agents.find((item) => item.id === id);
    if (!agent) {
      throw new HttpError(404, "Agent not found");
    }
    return agent;
  }

  private async decideAndAudit(
    principal: Principal,
    action: string,
    agent: Pick<Agent, "id" | "ownerId">,
    requestId: string,
    capability?: Capability,
  ) {
    const decision = await checkAgentAccess(principal, action, agent, requestId, capability);
    await this.audit.append({
      requestId,
      decidedAt: decision.decidedAt,
      humanId: principal.kind === "human" ? principal.id : principal.ownerId,
      agentId: agent.id,
      principalKind: principal.kind,
      action,
      resource: buildAgentResource(agent),
      effect: decision.effect,
      reason: decision.reason,
    });
    return decision;
  }

  private async enforce(
    caller: CallerContext,
    action: string,
    agent: Pick<Agent, "id" | "ownerId">,
  ): Promise<void> {
    const decision = await this.decideAndAudit(caller.principal, action, agent, caller.requestId);
    if (decision.effect === "deny") {
      throw new HttpError(403, decision.reason);
    }
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.workspaces.initialize();
    await this.store.mutate((database) => {
      for (const run of database.runs) {
        if (run.status === "queued" || run.status === "running") {
          run.status = "cancelled";
          run.error = "Server restarted while this run was active";
          run.completedAt = now();
        }
      }
      for (const agent of database.agents) {
        if (agent.status === "busy") {
          agent.status = "ready";
          agent.updatedAt = now();
        }
      }
    });
  }

  listAgents(caller: CallerContext): Agent[] {
    return this.store
      .snapshot()
      .agents.filter((agent) => agent.ownerId === caller.principal.id)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getAgent(caller: CallerContext, id: string): Promise<Agent> {
    const agent = this.findAgentRecord(id);
    await this.enforce(caller, AgentAction.Read, agent);
    return agent;
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const timestamp = now();
    const id = randomUUID();
    const agent: Agent = {
      id,
      ownerId: input.ownerId,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      instructions: input.instructions?.trim() ?? "",
      status: "ready",
      workspacePath: this.workspaces.workspacePath(id),
      codexThreadId: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.workspaces.create(agent);
    await this.store.mutate((database) => database.agents.push(agent));
    return agent;
  }

  async updateAgent(caller: CallerContext, id: string, input: UpdateAgentInput): Promise<Agent> {
    const current = this.findAgentRecord(id);
    await this.enforce(caller, AgentAction.Write, current);
    if (current.status === "busy") {
      throw new HttpError(409, "Stop the active run before editing this Agent");
    }
    const updated = await this.store.mutate((database) => {
      const agent = database.agents.find((item) => item.id === id);
      if (!agent) {
        throw new HttpError(404, "Agent not found");
      }
      if (agent.status === "busy") {
        throw new HttpError(409, "Stop the active run before editing this Agent");
      }
      if (input.name !== undefined) agent.name = input.name.trim();
      if (input.description !== undefined) agent.description = input.description.trim();
      if (input.instructions !== undefined) agent.instructions = input.instructions.trim();
      agent.lastError = null;
      agent.updatedAt = now();
      return structuredClone(agent);
    });
    await this.workspaces.writeInstructions(updated);
    return updated;
  }

  async deleteAgent(caller: CallerContext, id: string): Promise<{ archivedWorkspace: string }> {
    const agent = this.findAgentRecord(id);
    await this.enforce(caller, AgentAction.Delete, agent);
    await this.cancelExecution(id);
    const archivedWorkspace = await this.workspaces.archive(agent);
    await this.store.mutate((database) => {
      database.agents = database.agents.filter((item) => item.id !== id);
      database.messages = database.messages.filter((item) => item.agentId !== id);
      database.runs = database.runs.filter((item) => item.agentId !== id);
    });
    return { archivedWorkspace };
  }

  async startAgent(caller: CallerContext, id: string): Promise<Agent> {
    await this.enforce(caller, AgentAction.Write, this.findAgentRecord(id));
    return this.setStatus(id, "ready");
  }

  async stopAgent(caller: CallerContext, id: string): Promise<Agent> {
    await this.enforce(caller, AgentAction.Write, this.findAgentRecord(id));
    await this.cancelExecution(id);
    return this.setStatus(id, "stopped");
  }

  /**
   * The owner refusing the keycard a Run is waiting for.
   *
   * "No" is an answer, and it should take effect the moment it is given -- a
   * refused Agent that sat out the rest of the wait would make the owner's
   * decision look ignored. The Run continues immediately with an empty inbox,
   * which is the same outcome the timeout produces, just honestly and at once.
   *
   * Refusing is itself an authorization decision, so it is gated on ownership
   * exactly as starting or stopping the Agent is.
   */
  async denyCapabilityRequest(
    caller: CallerContext,
    agentId: string,
    reason = "owner refused access",
  ): Promise<void> {
    await this.enforce(caller, AgentAction.Write, this.findAgentRecord(agentId));
    this.capabilityDenials.set(agentId, reason);
  }

  async getMessages(caller: CallerContext, agentId: string): Promise<Message[]> {
    await this.enforce(caller, AgentAction.Read, this.findAgentRecord(agentId));
    return this.store
      .snapshot()
      .messages.filter((message) => message.agentId === agentId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getRun(caller: CallerContext, runId: string): Promise<AgentRun> {
    const run = this.store.snapshot().runs.find((item) => item.id === runId);
    if (!run) {
      throw new HttpError(404, "Run not found");
    }
    await this.enforce(caller, AgentAction.Read, this.findAgentRecord(run.agentId));
    return run;
  }

  async getRuns(caller: CallerContext, agentId: string): Promise<AgentRun[]> {
    await this.enforce(caller, AgentAction.Read, this.findAgentRecord(agentId));
    return this.store
      .snapshot()
      .runs.filter((run) => run.agentId === agentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listAudit(caller: CallerContext): Promise<AuditEntry[]> {
    return this.audit.listForHuman(caller.principal.id);
  }

  async sendMessage(
    caller: CallerContext,
    agentId: string,
    prompt: string,
  ): Promise<{ run: AgentRun; message: Message }> {
    await this.enforce(caller, AgentAction.Execute, this.findAgentRecord(agentId));
    if (!isArkConfigured(this.config)) {
      throw new HttpError(
        503,
        "Ark is not configured. Set ARK_API_KEY and ARK_MODEL, then restart.",
      );
    }
    const timestamp = now();
    const runId = randomUUID();
    const run: AgentRun = {
      id: runId,
      agentId,
      status: "queued",
      prompt,
      output: null,
      error: null,
      usage: null,
      awaitingCapability: false,
      withheldCount: 0,
      stagedResources: [],
      startedAt: null,
      completedAt: null,
      createdAt: timestamp,
    };
    const message: Message = {
      id: randomUUID(),
      agentId,
      runId,
      role: "user",
      content: prompt,
      createdAt: timestamp,
    };
    const agentAtStart = await this.store.mutate((database) => {
      const storedAgent = database.agents.find((item) => item.id === agentId);
      if (!storedAgent) {
        throw new HttpError(404, "Agent not found");
      }
      if (storedAgent.status === "stopped") {
        throw new HttpError(409, "Start the Agent before sending a message");
      }
      if (storedAgent.status === "busy") {
        throw new HttpError(409, "This Agent is already running");
      }
      database.runs.push(run);
      database.messages.push(message);
      const snapshot = structuredClone(storedAgent);
      storedAgent.status = "busy";
      storedAgent.lastError = null;
      storedAgent.updatedAt = timestamp;
      return snapshot;
    });
    const execution = this.executeRun(agentAtStart, run);
    this.activeExecutions.set(agentId, execution);
    void execution
      .finally(() => {
        if (this.activeExecutions.get(agentId) === execution) {
          this.activeExecutions.delete(agentId);
        }
      })
      .catch(() => undefined);
    return { run, message };
  }

  async systemInfo(): Promise<Record<string, unknown>> {
    return {
      arkConfigured: isArkConfigured(this.config),
      arkBaseUrl: this.config.arkBaseUrl,
      arkModel: this.config.arkModel || null,
      codexAvailable: await this.runner.isAvailable(),
      codexSandboxMode: this.config.codexSandboxMode,
      runtimeProvider: this.config.runtimeProvider,
      containerEngine:
        this.config.runtimeProvider === "container"
          ? this.config.containerEngine
          : null,
      runtime:
        this.config.runtimeProvider === "container"
          ? "Codex CLI in " + this.config.containerEngine + " Runtime"
          : "Codex CLI in application container",
    };
  }

  private async executeRun(agentAtStart: Agent, run: AgentRun): Promise<void> {
    await this.store.mutate((database) => {
      const storedRun = database.runs.find((item) => item.id === run.id);
      if (storedRun) {
        storedRun.status = "running";
        storedRun.startedAt = now();
      }
    });
    try {
      const { principal, capability } = issueCapabilityForRun(agentAtStart, run.id);
      const decision = await this.decideAndAudit(
        principal,
        AgentAction.Execute,
        agentAtStart,
        run.id,
        capability,
      );
      if (decision.effect === "deny") {
        throw new PolicyDeniedError(decision.reason);
      }
      if (this.cancellationRequests.has(agentAtStart.id)) {
        throw new RunCancelledError();
      }

      // Materialise exactly the resources this keycard opens. Each one is a
      // separate PDP decision, so the Agent's workspace ends up containing
      // what it is allowed to see and nothing else -- and after a revocation
      // it never gets this far, so it sees nothing at all.
      const staging = await this.stagePermittedResources(agentAtStart, principal, run.id);
      if (staging.refusedByOwner) {
        // The owner said no and nothing reached the workspace. Launching the
        // model anyway would spend a real API call to reach a foregone
        // conclusion, and report it as a missing file rather than a refusal.
        // A timeout is deliberately NOT treated this way: nobody said no, so
        // the Agent still gets to attempt whatever needs no resource at all.
        throw new PolicyDeniedError(staging.reason ?? "owner refused access");
      }

      const result = await this.runner.run({
        agentId: agentAtStart.id,
        workspacePath: agentAtStart.workspacePath,
        prompt: run.prompt,
        threadId: agentAtStart.codexThreadId,
      });
      const completedAt = now();
      const safeOutput = redact(result.output, this.secrets());
      await this.store.mutate((database) => {
        const storedRun = database.runs.find((item) => item.id === run.id);
        const agent = database.agents.find((item) => item.id === agentAtStart.id);
        if (!storedRun || !agent) return;
        storedRun.status = "completed";
        storedRun.output = safeOutput;
        storedRun.usage = result.usage;
        storedRun.completedAt = completedAt;
        database.messages.push({
          id: randomUUID(),
          agentId: agent.id,
          runId: run.id,
          role: "assistant",
          content: safeOutput,
          createdAt: completedAt,
        });
        agent.status = "ready";
        agent.codexThreadId = result.threadId;
        agent.lastError = null;
        agent.updatedAt = completedAt;
      });
    } catch (error) {
      const completedAt = now();
      const cancelled = error instanceof RunCancelledError;
      const rawMessage = error instanceof Error ? error.message : String(error);
      // A failing runner often echoes its environment back in the error.
      const message = redact(rawMessage, this.secrets());
      await this.store.mutate((database) => {
        const storedRun = database.runs.find((item) => item.id === run.id);
        const agent = database.agents.find((item) => item.id === agentAtStart.id);
        if (storedRun) {
          storedRun.status = cancelled ? "cancelled" : "failed";
          storedRun.error = message;
          storedRun.completedAt = completedAt;
        }
        if (agent) {
          if (agent.status !== "stopped") {
            agent.status = cancelled ? "ready" : "error";
          }
          agent.lastError = cancelled ? null : message;
          agent.updatedAt = completedAt;
        }
      });
    } finally {
      // Always wipe the inbox, including on the denied and cancelled paths.
      // Clearing only at run start is not enough: a run denied before staging
      // never reaches that point, so the PREVIOUS run's files would still be
      // sitting in the workspace for the next one to read.
      await this.resourceAccess?.gate.clear(agentAtStart.workspacePath);
    }
  }

  /**
   * Materialises into the Agent's inbox exactly those resources its owner has
   * granted it a keycard for.
   *
   * Staging is the ONLY moment a resource can physically reach the workspace:
   * the Agent reads files off its own disk, with no route back to the PDP, so
   * there is nothing to intercept once the model is running. That makes this
   * the authorization gate, and it is why the run waits here -- see
   * `awaitDataKeycard`. Without the wait, the World's request -> grant exchange
   * could never affect the run that provoked it, and saying yes to an Agent
   * standing at a door would change nothing.
   */
  private async stagePermittedResources(
    agent: Agent,
    principal: AgentPrincipal,
    requestId: string,
  ): Promise<{ refusedByOwner: boolean; reason?: string }> {
    if (!this.resourceAccess) return { refusedByOwner: false };

    // Always start from a clean inbox. Without this, a file staged by an
    // earlier permitted run would still be sitting there, and the run after a
    // revocation would read it and appear to succeed.
    await this.resourceAccess.gate.clear(agent.workspacePath);

    // First pass now, so the refusals reach the audit trail immediately rather
    // than after the wait -- the owner should see WHY the Agent is asking.
    if ((await this.stagingPass(agent, principal, requestId)) > 0) {
      return { refusedByOwner: false };
    }

    // Flag the Run as needing a human only if the wait actually lasts. A reach
    // into another owner's namespace is refused within a couple of seconds --
    // the World catches it and says so -- and flagging immediately made the
    // Playground flash "give it a keycard / refuse" for a decision that was
    // already made and that no keycard could have answered anyway.
    //
    // `requestId` is the run's id (see executeRun), so it addresses the run.
    const notice = setTimeout(() => {
      void this.setAwaitingCapability(requestId, true);
    }, AWAIT_NOTICE_MS);
    try {
      const { granted, refusedByOwner, reason } = await this.awaitDataKeycard(agent);
      if (granted.length === 0) return { refusedByOwner, ...(reason ? { reason } : {}) };
      await this.stagingPass(agent, principal, requestId);
      return { refusedByOwner: false };
    } finally {
      // Cleared however the wait ends -- granted, refused, timed out or
      // cancelled. A run left flagged would keep asking the owner for something
      // it no longer needs, and a refusal left set would silently pre-refuse
      // the NEXT run before its owner had seen the request.
      clearTimeout(notice);
      this.capabilityDenials.delete(agent.id);
      await this.setAwaitingCapability(requestId, false);
    }
  }

  /** Marks a Run as held at the gate, so the Playground can say why. */
  private async setAwaitingCapability(runId: string, waiting: boolean): Promise<void> {
    await this.store.mutate((database) => {
      const run = database.runs.find((item) => item.id === runId);
      if (run) run.awaitingCapability = waiting;
    });
  }

  /**
   * One trip through the owner's namespace. Returns how many files were
   * actually staged.
   *
   * The keycard presented per resource is the one the owner issued for it --
   * NOT the run's execution keycard, which carries no data scope at all. A
   * resource with no matching grant is still asked about, so the refusal is a
   * real decision in the audit trail rather than a file quietly missing from
   * the inbox. Denials are otherwise silent: the run proceeds with the subset
   * it is entitled to.
   */
  private async stagingPass(
    agent: Agent,
    principal: AgentPrincipal,
    requestId: string,
  ): Promise<number> {
    if (!this.resourceAccess) return 0;
    const { gate, resources } = this.resourceAccess;
    const granted = capabilityStore.liveFor(agent.id);
    let withheld = 0;
    const permitted: string[] = [];

    for (const ref of await resources.list(agent.ownerId)) {
      const keycard = granted.find((record) =>
        scopeAllows(record.scope, "read", ref.uri),
      );
      const result = await gate.access({
        principal,
        action: "read",
        resourceUri: ref.uri,
        requestId,
        // No grant covers this file: present nothing, and let the PDP say
        // `capability-unknown`. Substituting a card that cannot open it would
        // report the wrong reason for the right refusal.
        ...(keycard ? { capabilityId: keycard.id } : {}),
        workspacePath: agent.workspacePath,
      });
      if (result.effect === "permit") {
        permitted.push(ref.name);
      } else {
        withheld += 1;
      }
    }
    // Replaced, not appended: a second pass after a grant re-decides every
    // resource, and the earlier pass's refusals are no longer the outcome.
    await this.store.mutate((database) => {
      const run = database.runs.find((item) => item.id === requestId);
      if (!run) return;
      run.withheldCount = withheld;
      run.stagedResources = permitted;
    });
    return permitted.length;
  }

  /**
   * Waits, briefly, for the owner to hand this Agent a data keycard.
   *
   * Only waits when the Agent holds NO data keycard at all. A keycard that
   * simply does not cover a particular file is a DECIDED refusal, not an
   * undecided one, and must not be slowed down -- least privilege should feel
   * instant, and only "you have been given nothing yet" is worth pausing for.
   *
   * Waiting never widens access: the second staging pass asks the PDP exactly
   * as the first did. All this buys is the chance for the answer to change
   * because a human changed it.
   */
  private async awaitDataKeycard(
    agent: Agent,
  ): Promise<{ granted: CapabilityRecord[]; refusedByOwner: boolean; reason?: string }> {
    const dataKeycards = () =>
      capabilityStore
        .liveFor(agent.id)
        .filter((record) => scopeAllowsAction(record.scope, "read"));

    const held = dataKeycards();
    if (held.length > 0 || this.config.capabilityWaitMs <= 0) {
      return { granted: held, refusedByOwner: false };
    }

    // A refusal that arrived before the wait even began still counts.
    this.capabilityDenials.delete(agent.id);

    const deadline = Date.now() + this.config.capabilityWaitMs;
    while (Date.now() < deadline) {
      // A cancelled run must not sit here holding the Agent busy.
      if (this.cancellationRequests.has(agent.id)) {
        return { granted: [], refusedByOwner: false };
      }
      await new Promise((resolve) => setTimeout(resolve, GRANT_POLL_MS));
      const granted = dataKeycards();
      if (granted.length > 0) return { granted, refusedByOwner: false };
      // The owner said no. Stop waiting for an answer already given.
      const refusal = this.capabilityDenials.get(agent.id);
      if (refusal !== undefined) {
        return { granted: [], refusedByOwner: true, reason: refusal };
      }
    }
    // Timed out. Not the same as a refusal: nobody actually said no.
    return { granted: [], refusedByOwner: false };
  }

  private async setStatus(id: string, status: Agent["status"]): Promise<Agent> {
    return this.store.mutate((database) => {
      const agent = database.agents.find((item) => item.id === id);
      if (!agent) {
        throw new HttpError(404, "Agent not found");
      }
      if (status === "ready" && agent.status === "busy") {
        throw new HttpError(409, "Stop the active run before starting this Agent");
      }
      agent.status = status;
      if (status === "ready") agent.lastError = null;
      agent.updatedAt = now();
      return structuredClone(agent);
    });
  }

  private async cancelExecution(agentId: string): Promise<void> {
    this.cancellationRequests.add(agentId);
    try {
      await this.runner.cancel(agentId);
      const execution = this.activeExecutions.get(agentId);
      if (execution) {
        await execution;
      }
    } finally {
      this.cancellationRequests.delete(agentId);
    }
  }
}
