/**
 * Protected resource HTTP surface.
 *
 * Three routes, and the interesting one is `POST /api/resources/read`.
 *
 * That route is the Agent-facing enforcement point: it authenticates with the
 * CAPABILITY, not with a human session, because the capability *is* the Agent's
 * credential. That is the whole point of the design -- an Agent acts under its
 * own scoped, expiring, revocable keycard rather than borrowing the human's
 * session. An unknown, expired or revoked capability is refused here, at the
 * backend, before any file is touched.
 *
 * Every route returns the `PolicyDecision` alongside the result, so the
 * security-log panel and the audit trail see exactly what the backend decided
 * and never have to infer it from an HTTP status.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { agentPrincipalFor, type CapabilityStore } from "../capability/store.js";
import type { ResourceAccessGate } from "./access.js";
import type { ResourceStore } from "./store.js";

const readBody = z.object({
  uri: z.string().min(1).max(512),
  capabilityId: z.string().uuid(),
});
const contentQuery = z.object({ uri: z.string().min(1).max(512) });

export interface ResourceRoutesOptions {
  resources: ResourceStore;
  capabilities: CapabilityStore;
  gate: ResourceAccessGate;
}

export function resourceRoutes(
  options: ResourceRoutesOptions,
): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    /**
     * Metadata for every namespace, both users'. Listing that User B's house
     * exists is not the same as opening its door -- the frontend needs to draw
     * both houses, and contents stay behind the guard.
     */
    app.get("/api/resources", async (request) => {
      if (!request.principal) {
        throw new HttpError(401, "Sign in to browse resources");
      }
      return { resources: await options.resources.list() };
    });

    /** A human reading their own namespace. Still goes through the PDP. */
    app.get("/api/resources/content", async (request, reply) => {
      if (!request.principal) {
        throw new HttpError(401, "Sign in to read a resource");
      }
      const query = contentQuery.parse(request.query ?? {});
      const result = await options.gate.access({
        principal: request.principal,
        action: "read",
        resourceUri: query.uri,
        requestId: request.id,
      });
      if (result.effect === "deny") {
        return reply.code(403).send({
          error: "Denied: " + result.decision.reason,
          decision: result.decision,
        });
      }
      return {
        decision: result.decision,
        resource: result.resource,
        content: result.content,
      };
    });

    /**
     * The Agent-facing read. The capability is the credential: no session
     * header is involved, and a revoked keycard fails here even though the
     * human who owns it is still perfectly well signed in elsewhere.
     */
    app.post("/api/resources/read", async (request, reply) => {
      const body = readBody.parse(request.body);

      // Resolve the holder WITHOUT judging validity -- an expired or revoked
      // capability must still reach the PDP so the denial is a real policy
      // decision with a real reason, not a 404 from a lookup miss.
      const held = options.capabilities.get(body.capabilityId);
      if (!held) {
        return reply.code(403).send({
          error: "Denied: capability-unknown",
          decision: {
            effect: "deny",
            reason: "capability-unknown",
            requestId: request.id,
            decidedAt: new Date().toISOString(),
          },
        });
      }

      const result = await options.gate.access({
        principal: agentPrincipalFor(held),
        action: "read",
        resourceUri: body.uri,
        requestId: request.id,
        capabilityId: body.capabilityId,
      });

      if (result.effect === "deny") {
        return reply.code(403).send({
          error: "Denied: " + result.decision.reason,
          decision: result.decision,
        });
      }
      return {
        decision: result.decision,
        resource: result.resource,
        content: result.content,
      };
    });
  };
}
