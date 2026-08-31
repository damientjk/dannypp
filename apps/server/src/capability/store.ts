/**
 * Capability issuance, validation and revocation -- the "keycard" half of the
 * Identity & Authorization middleware.
 *
 * A capability is the thing an Agent acts under during a Run. It is NOT the
 * human's session: it carries its own scope, its own expiry, and it can be
 * shredded by its owner at any moment. The PDP consults it on every protected
 * access, which is what makes revocation take effect on the very next access
 * rather than "eventually".
 *
 * STORAGE: in-memory, deliberately. `Database` is frozen at version 1 with
 * agents/messages/runs, so persisting capabilities would mean a shared-type
 * change, a version bump and a migration. Sessions (auth/session.ts) are
 * already in-memory, so a capability that outlived a restart would belong to a
 * human who is no longer signed in. Documented as a limitation in the README
 * rather than half-solved.
 */

import { randomUUID } from "node:crypto";
import type { Agent, AgentPrincipal, Capability } from "../types.js";
import { DENY_REASONS, type DenyReason } from "./reasons.js";
import { capabilityOwner, defaultRunScope } from "./scope.js";
import { expectedScopeForOwner } from "../policy/resource.js";

/** The stored record. Extends Person 1's frozen `Capability` with provenance. */
export interface CapabilityRecord extends Capability {
  agentId: string;
  ownerId: string;
  runId: string | null;
  issuedAt: string;
  revokedBy: string | null;
}

export type CapabilityValidation<T extends Capability = CapabilityRecord> =
  | { valid: true; capability: T }
  | {
      valid: false;
      reason: Extract<
        DenyReason,
        "capability-unknown" | "capability-revoked" | "capability-expired"
      >;
    };

/**
 * Pure validity check over a capability object.
 *
 * Exported separately from the store so the PDP can validate the `Capability`
 * it already received in its `PolicyRequest` without reaching into any store --
 * that keeps Person 2's decision logic free of Person 3's storage.
 *
 * Order matters for the audit trail: a capability that is both expired and
 * revoked reports `capability-revoked`, because the human action is the more
 * informative thing to show on stage.
 */
export function validateCapability<T extends Capability>(
  capability: T | null | undefined,
  at: Date = now(),
): CapabilityValidation<T> {
  if (!capability) {
    return { valid: false, reason: DENY_REASONS.capabilityUnknown };
  }
  if (capability.revokedAt !== null) {
    return { valid: false, reason: DENY_REASONS.capabilityRevoked };
  }
  const expiresAt = Date.parse(capability.expiresAt);
  if (Number.isNaN(expiresAt) || expiresAt <= at.getTime()) {
    return { valid: false, reason: DENY_REASONS.capabilityExpired };
  }
  return { valid: true, capability };
}

export interface IssueInput {
  agentPrincipal: AgentPrincipal;
  scope: string;
  runId?: string | null;
  /** Lifetime in ms. Negative or zero yields an already-expired capability,
   *  which is how the expiry test avoids clock mocking. */
  ttlMs?: number;
}

export const DEFAULT_CAPABILITY_TTL_MS = 5 * 60 * 1000;

const now = () => new Date();

export class CapabilityStore {
  private readonly records = new Map<string, CapabilityRecord>();

  /**
   * Agents whose keycard the owner has shredded and not replaced.
   *
   * Revocation has to be a STANDING decision, not a one-off. A Run mints a
   * fresh capability each time, so if revoking only killed that one object the
   * next Run would quietly mint another and carry on -- "revoke, then the robot
   * is still blocked" would be false on stage while every test still passed.
   * Suspension is lifted only when the owner deliberately issues a new
   * capability through `issue()`.
   */
  private readonly suspended = new Set<string>();

  constructor(
    private readonly defaultTtlMs: number = DEFAULT_CAPABILITY_TTL_MS,
  ) {}

  /**
   * Mints a capability. Throws on a malformed scope or on a scope that does not
   * belong to the agent's owner -- an agent must never hold a keycard cut for
   * somebody else's house, and that is an invariant, not a policy decision.
   */
  issue(input: IssueInput): CapabilityRecord {
    // An explicit issuance is the owner handing over a new keycard, which is
    // exactly what lifts a suspension.
    const record = this.mint(input);
    this.suspended.delete(input.agentPrincipal.agentId);
    return record;
  }

  /** Whether the owner has shredded this agent's keycard without replacing it. */
  isSuspended(agentId: string): boolean {
    return this.suspended.has(agentId);
  }

  private mint(input: IssueInput): CapabilityRecord {
    // Both scope grammars are legitimate here -- `read:res://user-a/notes.md`
    // for a data keycard, `owner:user-a` for the execution keycard a Run holds.
    // capabilityOwner is the one function that understands both, so the
    // ownership invariant below is checked once rather than per grammar.
    const ownerId = capabilityOwner(input.scope);
    if (ownerId === null) {
      throw new Error("Malformed capability scope: " + String(input.scope));
    }
    if (ownerId !== input.agentPrincipal.ownerId) {
      throw new Error(
        "Refusing to issue a capability scoped to " +
          ownerId +
          " for an agent owned by " +
          input.agentPrincipal.ownerId,
      );
    }

    const issuedAt = now();
    const ttlMs = input.ttlMs ?? this.defaultTtlMs;
    const record: CapabilityRecord = {
      id: randomUUID(),
      scope: input.scope,
      expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
      revokedAt: null,
      agentId: input.agentPrincipal.agentId,
      ownerId: input.agentPrincipal.ownerId,
      runId: input.runId ?? null,
      issuedAt: issuedAt.toISOString(),
      revokedBy: null,
    };
    this.records.set(record.id, record);
    return structuredClone(record);
  }

  /**
   * The capability a Run holds: permission to EXECUTE, and nothing else.
   *
   * It deliberately carries no data scope. A run keycard scoped
   * `read:res://<owner>/*` would open every file its owner has the moment the
   * Agent starts, which makes an owner's explicit grant meaningless and leaves
   * a live id that opens the whole namespace for anyone who can name it.
   * Reading data requires a keycard the owner actually issued for that
   * resource; this one only answers "may this Agent run at all", which is the
   * question revocation suspends.
   */
  issueForRun(
    agentPrincipal: AgentPrincipal,
    runId: string,
    ttlMs?: number,
  ): CapabilityRecord {
    return this.issue({
      agentPrincipal,
      scope: expectedScopeForOwner(agentPrincipal.ownerId),
      runId,
      ...(ttlMs === undefined ? {} : { ttlMs }),
    });
  }

  /**
   * A read keycard over the owner's whole namespace -- what POST
   * /api/capabilities mints when the caller names no narrower scope.
   *
   * Deliberately separate from issueForRun: this is an owner deciding to hand
   * over broad access, not something a Run gets for free by starting.
   */
  issueNamespaceRead(
    agentPrincipal: AgentPrincipal,
    runId?: string,
    ttlMs?: number,
  ): CapabilityRecord {
    return this.issue({
      agentPrincipal,
      scope: defaultRunScope(agentPrincipal.ownerId),
      ...(runId === undefined ? {} : { runId }),
      ...(ttlMs === undefined ? {} : { ttlMs }),
    });
  }

  /** Live, non-revoked, unexpired keycards this Agent currently holds. */
  liveFor(agentId: string, at: Date = now()): CapabilityRecord[] {
    return this.list({ agentId }).filter(
      (record) =>
        record.revokedAt === null && Date.parse(record.expiresAt) > at.getTime(),
    );
  }

  get(id: unknown): CapabilityRecord | null {
    if (typeof id !== "string") return null;
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  list(filter: { ownerId?: string; agentId?: string } = {}): CapabilityRecord[] {
    return [...this.records.values()]
      .filter((record) => {
        if (filter.ownerId !== undefined && record.ownerId !== filter.ownerId) {
          return false;
        }
        if (filter.agentId !== undefined && record.agentId !== filter.agentId) {
          return false;
        }
        return true;
      })
      .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt))
      .map((record) => structuredClone(record));
  }

  /**
   * Shreds the keycard. Idempotent: re-revoking keeps the original timestamp so
   * the audit trail records when it actually happened.
   */
  revoke(id: unknown, revokedBy: string): CapabilityRecord | null {
    if (typeof id !== "string") return null;
    const record = this.records.get(id);
    if (!record) return null;
    if (record.revokedAt === null) {
      record.revokedAt = now().toISOString();
      record.revokedBy = revokedBy;
    }
    // Standing decision: no new keycard is minted for this agent until the
    // owner issues one explicitly.
    this.suspended.add(record.agentId);
    return structuredClone(record);
  }

  /** Revokes every live capability held by one agent. Used when an Agent is stopped or deleted. */
  revokeAllForAgent(agentId: string, revokedBy: string): CapabilityRecord[] {
    const revoked: CapabilityRecord[] = [];
    for (const record of this.records.values()) {
      if (record.agentId === agentId && record.revokedAt === null) {
        const result = this.revoke(record.id, revokedBy);
        if (result) revoked.push(result);
      }
    }
    return revoked;
  }

  /** Is the keycard with this id still good? */
  validate(id: unknown, at: Date = now()): CapabilityValidation {
    const record = typeof id === "string" ? this.records.get(id) : undefined;
    return validateCapability(record ? structuredClone(record) : null, at);
  }

  /**
   * Mints a capability that is dead on arrival, for an agent under a standing
   * revocation. Registered so the denied attempt is auditable; does NOT lift
   * the suspension.
   */
  issueSuspended(input: IssueInput): CapabilityRecord {
    const record = this.mint(input);
    const stored = this.records.get(record.id);
    if (stored) {
      stored.revokedAt = stored.issuedAt;
      stored.revokedBy = "standing-revocation";
    }
    return structuredClone(this.records.get(record.id) ?? record);
  }

  /** Test/demo helper. Never called by request handlers. */
  clear(): void {
    this.records.clear();
    this.suspended.clear();
  }
}

/**
 * The agent principal a capability was minted for. Derived from the record so
 * there is no second place where an agent's identity is assembled.
 */
export function agentPrincipalFor(record: CapabilityRecord): AgentPrincipal {
  return {
    kind: "agent",
    id: "agent:" + record.agentId,
    agentId: record.agentId,
    ownerId: record.ownerId,
  };
}

/** Process-wide store, matching how auth/session.ts exposes sessions. */
export const capabilityStore = new CapabilityStore();

/**
 * Issue the capability an Agent Run acts under.
 *
 * This replaces `policy/placeholder-capability.ts` (Person 2's day-1 stand-in),
 * keeping the exact `{ principal, capability }` shape their PEP already
 * consumes, so the swap was a one-line import change at the single call site.
 *
 * The scope is `read:res://<ownerId>/*`, which satisfies both halves of the
 * PDP: `capabilityOwner()` reads it as belonging to the owner (so Agent-object
 * access passes), and `scopeAllows()` reads it as read-only over that owner's
 * data namespace. One keycard, both doors.
 *
 * Unlike the placeholder, this capability is REGISTERED in the store, which is
 * what makes it revocable -- the placeholder minted a fresh object per run that
 * nothing could ever revoke.
 */
export function issueCapabilityForRun(
  agent: Pick<Agent, "id" | "ownerId">,
  runId?: string,
): { principal: AgentPrincipal; capability: CapabilityRecord } {
  const principal: AgentPrincipal = {
    kind: "agent",
    id: "agent:" + agent.id,
    agentId: agent.id,
    ownerId: agent.ownerId,
  };
  const input = {
    agentPrincipal: principal,
    // Execution only -- see CapabilityStore.issueForRun.
    scope: expectedScopeForOwner(agent.ownerId),
    runId: runId ?? null,
  };

  if (capabilityStore.isSuspended(agent.id)) {
    // The owner shredded this agent's keycard. Mint the record anyway so the
    // attempt is visible in the capability list and the audit log, but mint it
    // already-revoked so the PDP denies with `capability-revoked` -- the same
    // reason the shredding itself produced.
    const revoked = capabilityStore.issueSuspended(input);
    return { principal, capability: revoked };
  }

  return { principal, capability: capabilityStore.issue(input) };
}
