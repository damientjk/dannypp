/**
 * A reference PDP built from `authorizeCapability`.
 *
 * HANDOVER NOTE (Person 3 -> Person 2): this exists so the capability and
 * resource work is demonstrable end-to-end before `policy/pdp.ts` lands, and so
 * the evidence script produces real denials today. It is not a claim on your
 * file. Either drop these five lines into `policy/pdp.ts` and delete this
 * module, or keep it and add audit-log writes around it -- whichever is less
 * work for you. The important part is that there stays exactly ONE
 * implementation of the scope check, and it is `capability/scope.ts`.
 */

import type {
  PolicyDecision,
  PolicyDecisionPoint,
  PolicyRequest,
} from "../types.js";
import { authorizeCapability } from "./authorize.js";

export const referencePdp: PolicyDecisionPoint = {
  async decide(request: PolicyRequest): Promise<PolicyDecision> {
    const verdict = authorizeCapability({
      principal: request.principal,
      action: request.action,
      resource: request.resource,
      capability: request.capability,
    });
    return {
      effect: verdict.effect,
      reason: verdict.reason,
      requestId: request.requestId,
      decidedAt: new Date().toISOString(),
    };
  },
};
