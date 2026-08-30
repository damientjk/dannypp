import path from "node:path";
import { AgentService } from "./agent-service.js";
import { createApp } from "./app.js";
import { AuditLog } from "./audit/log.js";
import { loadConfig, writeCodexConfig } from "./config.js";
import { createRunner } from "./runner-factory.js";
import { JsonStore } from "./store.js";
import { WorkspaceManager } from "./workspace.js";
import { capabilityStore } from "./capability/store.js";
import { pdp } from "./policy/pdp.js";
import { ResourceStore } from "./resources/store.js";
import { createResourceAccessGate } from "./resources/access.js";

const config = loadConfig();
await writeCodexConfig(config);

const store = new JsonStore(path.join(config.dataDirectory, "launchpad.json"));
const workspaces = new WorkspaceManager(config.workspaceRoot);
const runner = createRunner(config);
const audit = new AuditLog(path.join(config.dataDirectory, "audit.jsonl"));
await audit.initialize();

// --- Identity & Authorization middleware --------------------------------
// One PDP for the whole platform (policy/pdp.ts): it dispatches Agent-object
// resources to the ownership rules and res:// data resources to the capability
// rules, so there is a single decision point rather than two that could drift.
const resources = new ResourceStore(path.join(config.dataDirectory, "resources"));
await resources.initialize();
const gate = createResourceAccessGate({
  pdp,
  resources,
  capabilities: capabilityStore,
});

const service = new AgentService(config, store, workspaces, runner, audit, {
  gate,
  resources,
});
await service.initialize();

const app = await createApp(config, service, {
  capabilities: capabilityStore,
  resources,
  gate,
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.host, port: config.port });
