import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { HttpError } from "./errors.js";
import type { AgentService } from "./agent-service.js";
import { authenticate, findUser } from "./auth/users.js";
import { issueSession, resolveSession } from "./auth/session.js";
import type { CallerContext } from "./policy/pep.js";
import type { HumanPrincipal } from "./types.js";
import { capabilityRoutes } from "./capability/routes.js";
import { resourceRoutes } from "./resources/routes.js";
import type { CapabilityStore } from "./capability/store.js";
import type { ResourceStore } from "./resources/store.js";
import type { AuditSink, ResourceAccessGate } from "./resources/access.js";

declare module "fastify" {
  interface FastifyRequest { principal?: HumanPrincipal | undefined; }
}

function requireCaller(request: { principal?: HumanPrincipal | undefined; id: string }): CallerContext {
  if (!request.principal) {
    throw new HttpError(401, "Sign in required");
  }
  return { principal: request.principal, requestId: request.id };
}

const agentIdParams = z.object({ id: z.string().uuid() });
const runIdParams = z.object({ id: z.string().uuid() });
const createAgentBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  instructions: z.string().max(10_000).optional(),
});
const updateAgentBody = createAgentBody.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required",
);
const messageBody = z.object({
  content: z.string().trim().min(1).max(50_000),
});
const loginBody = z.object({
  userId: z.string().trim().min(1),
  password: z.string().min(1),
});

/**
 * Identity & Authorization middleware dependencies (Person 3).
 *
 * Optional so that Person 1's existing HTTP tests keep constructing an app with
 * two arguments and are not disturbed. `index.ts` always supplies it, so the
 * running server always has the middleware routes.
 */
export interface MiddlewareDependencies {
  capabilities: CapabilityStore;
  resources: ResourceStore;
  gate: ResourceAccessGate;
  /** Optional so tests can build an app without one; the server always passes it. */
  audit?: AuditSink | undefined;
}

export async function createApp(
  config: AppConfig,
  service: AgentService,
  middleware?: MiddlewareDependencies,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin:
      config.nodeEnv === "development"
        ? ["http://localhost:5173", "http://127.0.0.1:5173"]
        : false,
  });

  app.addHook("onRequest", async (request, reply) => {
    if (
      !config.authToken ||
      !request.url.startsWith("/api/") ||
      request.url === "/api/health" ||
      // Prefix, not equality: /api/auth/login must stay reachable, or the token
      // gate locks out the endpoint that exists to issue a session in the first
      // place. /api/auth and /api/auth/me are covered by the same prefix.
      request.url.startsWith("/api/auth")
    ) {
      return;
    }
    const header = request.headers.authorization ?? "";
    const candidate = header.startsWith("Bearer ") ? header.slice(7) : "";
    const expectedBuffer = Buffer.from(config.authToken);
    const candidateBuffer = Buffer.from(candidate);
    const valid =
      candidateBuffer.length === expectedBuffer.length &&
      timingSafeEqual(candidateBuffer, expectedBuffer);
    if (!valid) {
      return reply.code(401).send({ error: "Authentication required" });
    }
  });

  app.addHook("onRequest", async (request) => {
    const header = request.headers["x-session-token"];
    const token = typeof header === "string" ? header : undefined;
    const userId = resolveSession(token);
    request.principal = (userId && findUser(userId)) || undefined;
  });

  app.get("/api/health", async () => ({
    ok: true,
    service: "volc-agent-launchpad",
  }));

  app.get("/api/auth", async () => ({ required: config.authToken.length > 0 }));

  app.post("/api/auth/login", async (request) => {
    const body = loginBody.parse(request.body);
    const principal = authenticate(body.userId, body.password);
    if (!principal) {
      throw new HttpError(401, "Invalid credentials");
    }
    return { sessionToken: issueSession(principal.id), principal };
  });

  app.get("/api/auth/me", async (request) => {
    if (!request.principal) {
      throw new HttpError(401, "Not signed in");
    }
    return { principal: request.principal };
  });

  app.get("/api/system", async () => service.systemInfo());

  app.get("/api/audit", async (request) => {
    const caller = requireCaller(request);
    return { entries: await service.listAudit(caller) };
  });

  app.get("/api/agents", async (request) => {
    const caller = requireCaller(request);
    return { agents: service.listAgents(caller) };
  });

  app.post("/api/agents", async (request, reply) => {
    const caller = requireCaller(request);
    const body = createAgentBody.parse(request.body);
    const agent = await service.createAgent({ ...body, ownerId: caller.principal.id });
    return reply.code(201).send({ agent });
  });

  app.get("/api/agents/:id", async (request) => {
    const caller = requireCaller(request);
    const { id } = agentIdParams.parse(request.params);
    return { agent: await service.getAgent(caller, id) };
  });

  app.patch("/api/agents/:id", async (request) => {
    const caller = requireCaller(request);
    const { id } = agentIdParams.parse(request.params);
    const body = updateAgentBody.parse(request.body);
    return { agent: await service.updateAgent(caller, id, body) };
  });

  app.delete("/api/agents/:id", async (request) => {
    const caller = requireCaller(request);
    const { id } = agentIdParams.parse(request.params);
    return service.deleteAgent(caller, id);
  });

  app.post("/api/agents/:id/start", async (request) => {
    const caller = requireCaller(request);
    const { id } = agentIdParams.parse(request.params);
    return { agent: await service.startAgent(caller, id) };
  });

  app.post("/api/agents/:id/stop", async (request) => {
    const caller = requireCaller(request);
    const { id } = agentIdParams.parse(request.params);
    return { agent: await service.stopAgent(caller, id) };
  });

  app.get("/api/agents/:id/messages", async (request) => {
    const caller = requireCaller(request);
    const { id } = agentIdParams.parse(request.params);
    return { messages: await service.getMessages(caller, id) };
  });

  app.get("/api/agents/:id/runs", async (request) => {
    const caller = requireCaller(request);
    const { id } = agentIdParams.parse(request.params);
    return { runs: await service.getRuns(caller, id) };
  });

  app.post("/api/agents/:id/messages", async (request, reply) => {
    const caller = requireCaller(request);
    const { id } = agentIdParams.parse(request.params);
    const body = messageBody.parse(request.body);
    const result = await service.sendMessage(caller, id, body.content);
    return reply.code(202).send(result);
  });

  app.get("/api/runs/:id", async (request) => {
    const caller = requireCaller(request);
    const { id } = runIdParams.parse(request.params);
    return { run: await service.getRun(caller, id) };
  });

  // Registered BEFORE the production static block below. Awaiting a `register`
  // boots the plugin tree, and every route context built up to that point keeps
  // whichever error handler existed when it was built. With this call after the
  // static registration, the routes above fell back to Fastify's default error
  // body in production only -- generic messages instead of the real reason, and
  // 500 instead of 400 for validation failures -- while dev looked correct.
  app.setErrorHandler((error, request, reply) => {
    const appError = error instanceof Error ? error : new Error(String(error));
    const validationError = error instanceof z.ZodError;
    const frameworkStatus =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : null;
    const statusCode =
      error instanceof HttpError
        ? error.statusCode
        : validationError
          ? 400
          : frameworkStatus && frameworkStatus >= 400 && frameworkStatus <= 599
            ? frameworkStatus
            : 500;
    if (statusCode >= 500) {
      request.log.error(appError);
    }
    return reply.code(statusCode).send({
      error: appError.message,
      ...(validationError ? { details: error.issues } : {}),
    });
  });

  if (config.nodeEnv === "production") {
    const webRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/",
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "API route not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  // Registered AFTER setErrorHandler: these routes live in an encapsulated
  // plugin context, and a child context only inherits the error handler that
  // exists at registration time. Registering earlier makes them fall back to
  // Fastify's default error body, so their failures would have a different
  // shape from every other endpoint.
  if (middleware) {
    await app.register(capabilityRoutes({ capabilities: middleware.capabilities }));
    await app.register(resourceRoutes(middleware));
  }

  return app;
}
