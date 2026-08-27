import type { PolicyDecision, PolicyDecisionPoint, PolicyRequest } from "../types.js";

// for gene/dafeng to finish
export const pdp: PolicyDecisionPoint = {
    async decide(request: PolicyRequest): Promise<PolicyDecision> {
        return {
            effect: "permit",
            reason: "placeholder pdp",
            requestId: request.requestId,
            decidedAt: new Date().toISOString(),
        };
    },
};