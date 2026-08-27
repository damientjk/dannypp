import path from "node:path";
import { AgentService } from "./agent-service.js";
import { createApp } from "./app.js";
import { loadConfig, writeCodexConfig } from "./config.js";
import { createRunner } from "./runner-factory.js";
import { JsonStore } from "./store.js";
import { WorkspaceManager } from "./workspace.js";
import { capabilityStore } from "./capability/store.js";
import { referencePdp } from "./capability/reference-pdp.js";
import { ResourceStore } from "./resources/store.js";
import { createResourceAccessGate } from "./resources/access.js";

const config = loadConfig();
await writeCodexConfig(config);

const store = new JsonStore(path.join(config.dataDirectory, "launchpad.json"));
const workspaces = new WorkspaceManager(config.workspaceRoot);
const runner = createRunner(config);
const service = new AgentService(config, store, workspaces, runner);
await service.initialize();

// --- Identity & Authorization middleware (Person 3) ---------------------
// The PDP is injected. It is wired to `referencePdp` until Person 2's
// `policy/pdp.ts` is finished -- do NOT wire the current stub there, it
// permits everything and would silently disable every denial in the demo.
const resources = new ResourceStore(path.join(config.dataDirectory, "resources"));
await resources.initialize();
const gate = createResourceAccessGate({
  pdp: referencePdp,
  resources,
  capabilities: capabilityStore,
});

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
