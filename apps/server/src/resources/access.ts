/**
 * The resource access gate -- the Policy Enforcement Point for resource reads
 * and writes.
 *
 * Every protected access funnels through `access()`: it asks the PDP, and only
 * on `permit` does it touch the resource store. The PDP is injected rather than
 * imported so that Person 2 owns the decision logic and this module owns the
 * enforcement, with a fake PDP standing in for tests.
 *
 * DEFAULT-DENY: if the PDP throws, times out, or returns something that is not
 * a decision, the answer is `deny` with reason `policy-error`. A broken guard
 * must not become an open door. This is tested explicitly.
 */

import type {
  PolicyDecision,
  PolicyDecisionPoint,
  Principal,
} from "../types.js";
import type { CapabilityStore } from "../capability/store.js";
import { DENY_REASONS } from "../capability/reasons.js";
import { clearStaging, stageResource } from "./staging.js";
import type { ResourceRef, ResourceStore } from "./store.js";

export interface ResourceAccessRequest {
  principal: Principal;
  action: "read" | "write";
  resourceUri: string;
  requestId: string;
  capabilityId?: string | undefined;
  /** When present, a permitted read is staged into this workspace. */
  workspacePath?: string | undefined;
  /** Required for a write. */
  content?: string | undefined;
}

export type ResourceAccessResult =
  | {
      effect: "permit";
      decision: PolicyDecision;
      resource: ResourceRef;
      content: string | null;
      stagedPath: string | null;
    }
  | { effect: "deny"; decision: PolicyDecision };

export interface ResourceAccessGateOptions {
  pdp: PolicyDecisionPoint;
  resources: ResourceStore;
  capabilities: CapabilityStore;
  /**
   * Where decisions are recorded. Optional so the existing gate tests can keep
   * constructing a gate without one, but the running server always supplies it:
   * a denial nobody can point at afterwards is not evidence of anything.
   */
  audit?: AuditSink | undefined;
}

/** The slice of AuditLog this gate needs. Narrow on purpose: the gate writes
 *  entries and never reads them. */
export interface AuditSink {
  append(entry: {
    requestId: string;
    decidedAt: string;
    humanId: string;
    agentId: string;
    principalKind: "human" | "agent";
    action: string;
    resource: string;
    effect: "permit" | "deny";
    reason: string;
  }): Promise<unknown>;
}

function denial(requestId: string, reason: string): PolicyDecision {
  return {
    effect: "deny",
    reason,
    requestId,
    decidedAt: new Date().toISOString(),
  };
}

function isDecision(value: unknown): value is PolicyDecision {
  if (typeof value !== "object" || value === null) return false;
  const effect = (value as { effect?: unknown }).effect;
  return effect === "permit" || effect === "deny";
}

export class ResourceAccessGate {
  constructor(private readonly options: ResourceAccessGateOptions) {}

  async access(request: ResourceAccessRequest): Promise<ResourceAccessResult> {
    const { pdp, resources } = this.options;

    // Reject an unparseable or unknown resource before consulting the PDP:
    // there is no meaningful decision to make about a resource that cannot
    // exist, and it keeps malformed input out of the audit log.
    const resource = resources.parse(request.resourceUri);
    if (!resource) {
      return {
        effect: "deny",
        decision: denial(request.requestId, DENY_REASONS.resourceUnknown),
      };
    }

    // Resolve the keycard here and hand the PDP the object its PolicyRequest
    // already has a slot for. An unknown id resolves to undefined, which the
    // PDP reports as `capability-unknown` -- the gate does not pre-judge it.
    const capability =
      request.capabilityId === undefined
        ? undefined
        : (this.options.capabilities.get(request.capabilityId) ?? undefined);

    let decision: PolicyDecision;
    try {
      const result = await pdp.decide({
        principal: request.principal,
        action: request.action,
        resource: resource.uri,
        capability,
        requestId: request.requestId,
      });
      decision = isDecision(result)
        ? result
        : denial(request.requestId, DENY_REASONS.policyError);
    } catch {
      // The guard fell over. That is a deny, not a permit.
      decision = denial(request.requestId, DENY_REASONS.policyError);
    }

    // Record BEFORE acting, and record denials too. An audit trail that only
    // holds successes cannot answer the one question it exists for: what was
    // refused, to whom, and why.
    await this.record(request, resource.uri, decision);

    if (decision.effect !== "permit") {
      return { effect: "deny", decision };
    }

    if (request.action === "write") {
      await resources.write(resource.uri, request.content ?? "");
      return {
        effect: "permit",
        decision,
        resource,
        content: request.content ?? "",
        stagedPath: null,
      };
    }

    const content = await resources.read(resource.uri);
    const stagedPath = request.workspacePath
      ? await stageResource(request.workspacePath, resource, content)
      : null;

    return { effect: "permit", decision, resource, content, stagedPath };
  }

  /**
   * Writes one decision to the audit trail, attributed to the human behind it.
   *
   * An Agent principal is attributed to its OWNER, matching how the Agent PEP
   * records things: the audit log answers "what happened in this person's
   * name", and an agent acts in its owner's name even though it holds its own
   * identity. A logging failure must never turn a deny into a permit, so this
   * swallows its own errors.
   */
  private async record(
    request: ResourceAccessRequest,
    resourceUri: string,
    decision: PolicyDecision,
  ): Promise<void> {
    const { audit } = this.options;
    if (!audit) return;
    const { principal } = request;
    try {
      await audit.append({
        requestId: decision.requestId,
        decidedAt: decision.decidedAt,
        humanId: principal.kind === "human" ? principal.id : principal.ownerId,
        // Empty when a human reads directly: no Agent was involved to name.
        agentId: principal.kind === "agent" ? principal.agentId : "",
        principalKind: principal.kind,
        action: "resource:" + request.action,
        resource: resourceUri,
        effect: decision.effect,
        reason: decision.reason,
      });
    } catch {
      // Nothing to do but carry on: the decision itself already stands.
    }
  }

  /** Wipes everything this gate staged for a workspace. Call in a `finally`. */
  async clear(workspacePath: string): Promise<void> {
    await clearStaging(workspacePath);
  }
}

export function createResourceAccessGate(
  options: ResourceAccessGateOptions,
): ResourceAccessGate {
  return new ResourceAccessGate(options);
}
