/**
 * Capability HTTP surface: the keycard drawer and the shredder.
 *
 * Registered as a Fastify plugin so the change to Person 1's `app.ts` is two
 * lines rather than sixty. `app.ts` is the single worst merge-conflict surface
 * in this repo and four of us are editing around it.
 *
 * Note that revoke is itself an authorization decision -- only the human who
 * owns the capability may shred it -- and it is tested as one.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { defaultRunScope } from "./scope.js";
import type { CapabilityStore } from "./store.js";

const listQuery = z.object({ agentId: z.string().uuid().optional() });
const revokeParams = z.object({ id: z.string().uuid() });
const issueBody = z.object({
  agentId: z.string().uuid(),
  runId: z.string().max(64).optional(),
  /** Omit for the default read-only scope over the caller's own namespace. */
  scope: z.string().max(512).optional(),
  /** Demo/testing hook: a non-positive value mints an already-expired keycard. */
  ttlMs: z.number().int().min(-1).max(60 * 60 * 1000).optional(),
});

export interface CapabilityRoutesOptions {
  capabilities: CapabilityStore;
}

export function capabilityRoutes(
  options: CapabilityRoutesOptions,
): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    /** The keycards the signed-in human owns. Never anybody else's. */
    app.get("/api/capabilities", async (request) => {
      if (!request.principal) {
        throw new HttpError(401, "Sign in to view capabilities");
      }
      const query = listQuery.parse(request.query ?? {});
      return {
        capabilities: options.capabilities.list({
          ownerId: request.principal.id,
          ...(query.agentId === undefined ? {} : { agentId: query.agentId }),
        }),
      };
    });

    /**
     * Mint a keycard for one of the caller's Agents.
     *
     * Normally the PEP issues capabilities at run start (Person 2). This route
     * exists so the flow is drivable before that lands -- Person 4's UI and the
     * evidence script both need a real capability to hold.
     *
     * SAFETY: the agent principal is built with `ownerId` taken from the SESSION,
     * never from the request body, and `CapabilityStore.issue` refuses any scope
     * whose owner differs from that. So the worst a caller can do is mint a
     * keycard that opens their own house, which they could already open. There
     * is no privilege to gain here.
     */
    app.post("/api/capabilities", async (request, reply) => {
      if (!request.principal) {
        throw new HttpError(401, "Sign in to issue a capability");
      }
      const body = issueBody.parse(request.body);
      const owner = request.principal.id;

      try {
        const capability = options.capabilities.issue({
          agentPrincipal: {
            kind: "agent",
            id: "agent:" + body.agentId,
            agentId: body.agentId,
            ownerId: owner,
          },
          scope: body.scope ?? defaultRunScope(owner),
          runId: body.runId ?? null,
          ...(body.ttlMs === undefined ? {} : { ttlMs: body.ttlMs }),
        });
        return reply.code(201).send({ capability });
      } catch (error) {
        // A malformed or cross-owner scope is a client error, not a crash.
        throw new HttpError(
          400,
          error instanceof Error ? error.message : "Could not issue capability",
        );
      }
    });

    /**
     * Shred the keycard. Returns the updated record so the UI can re-render
     * without a follow-up fetch -- one less race to lose on stage.
     */
    app.post("/api/capabilities/:id/revoke", async (request) => {
      if (!request.principal) {
        throw new HttpError(401, "Sign in to revoke a capability");
      }
      const { id } = revokeParams.parse(request.params);

      const existing = options.capabilities.get(id);
      if (!existing) {
        throw new HttpError(404, "Capability not found");
      }
      // Authorization, not bookkeeping: User B must not be able to shred User
      // A's keycard just because they know its id.
      if (existing.ownerId !== request.principal.id) {
        throw new HttpError(403, "You do not own this capability");
      }

      const revoked = options.capabilities.revoke(id, request.principal.id);
      if (!revoked) {
        throw new HttpError(404, "Capability not found");
      }
      return { capability: revoked };
    });
  };
}
