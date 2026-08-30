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
