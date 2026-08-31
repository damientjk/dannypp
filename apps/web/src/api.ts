import type {
  Agent,
  AgentRun,
  AuditEntry,
  CapabilityRecord,
  HumanPrincipal,
  Message,
  PolicyDecision,
  ResourceRef,
  SystemInfo,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

let authToken = "";
let sessionToken = "";

export function setAuthToken(token: string): void {
  authToken = token.trim();
}

export function setSessionToken(token: string): void {
  sessionToken = token.trim();
}

/**
 * A refusal that still carries the decision that caused it.
 *
 * The resource routes answer a denial with HTTP 403 *and* the PolicyDecision.
 * That decision is the payload the UI actually wants -- losing it to a generic
 * error would put the UI back in the business of guessing why access failed.
 */
export class PolicyDeniedError extends ApiError {
  constructor(
    message: string,
    public readonly decision: PolicyDecision,
  ) {
    super(message, 403);
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = {
    ...(options?.body ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: "Bearer " + authToken } : {}),
    ...(sessionToken ? { "x-session-token": sessionToken } : {}),
    ...options?.headers,
  };
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    decision?: PolicyDecision;
  };
  if (!response.ok) {
    if (response.status === 403 && data.decision) {
      throw new PolicyDeniedError(data.error ?? "Denied", data.decision);
    }
    throw new ApiError(data.error ?? "Request failed", response.status);
  }
  return data;
}

export const api = {
  auth: () => request<{ required: boolean }>("/api/auth"),
  login: (userId: string, password: string) =>
    request<{ sessionToken: string; principal: HumanPrincipal }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId, password }),
    }),
  me: () => request<{ principal: HumanPrincipal }>("/api/auth/me"),
  system: () => request<SystemInfo>("/api/system"),
  listAgents: () => request<{ agents: Agent[] }>("/api/agents"),
  createAgent: (body: {
    name: string;
    description: string;
    instructions: string;
  }) =>
    request<{ agent: Agent }>("/api/agents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAgent: (
    id: string,
    body: { name: string; description: string; instructions: string },
  ) =>
    request<{ agent: Agent }>("/api/agents/" + id, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAgent: (id: string) =>
    request<{ archivedWorkspace: string }>("/api/agents/" + id, {
      method: "DELETE",
    }),
  startAgent: (id: string) =>
    request<{ agent: Agent }>("/api/agents/" + id + "/start", {
      method: "POST",
    }),
  stopAgent: (id: string) =>
    request<{ agent: Agent }>("/api/agents/" + id + "/stop", {
      method: "POST",
    }),
  /** The owner refusing the keycard this Agent's Run is waiting for. */
  denyCapability: (id: string, reason?: string) =>
    request<{ denied: boolean }>("/api/agents/" + id + "/deny-capability", {
      method: "POST",
      body: JSON.stringify(reason === undefined ? {} : { reason }),
    }),
  messages: (id: string) =>
    request<{ messages: Message[] }>("/api/agents/" + id + "/messages"),
  runs: (id: string) =>
    request<{ runs: AgentRun[] }>("/api/agents/" + id + "/runs"),
  sendMessage: (id: string, content: string) =>
    request<{ run: AgentRun; message: Message }>(
      "/api/agents/" + id + "/messages",
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
    ),
  run: (id: string) => request<{ run: AgentRun }>("/api/runs/" + id),

  // --- Identity & Authorization middleware ------------------------------
  // Everything below reaches the PDP. None of these decisions are made in the
  // browser: the UI asks, renders what the backend answered, and nothing else.

  /** The attributed decision log for the signed-in human. */
  audit: () => request<{ entries: AuditEntry[] }>("/api/audit"),

  /** Keycards this human owns, optionally narrowed to one Agent. */
  capabilities: (agentId?: string) =>
    request<{ capabilities: CapabilityRecord[] }>(
      "/api/capabilities" + (agentId ? "?agentId=" + encodeURIComponent(agentId) : ""),
    ),

  /** Mint a scoped keycard for one of this human's Agents. */
  issueCapability: (body: { agentId: string; scope?: string; ttlMs?: number }) =>
    request<{ capability: CapabilityRecord }>("/api/capabilities", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Shred a keycard. Only its owner may do this; the backend enforces that. */
  revokeCapability: (id: string) =>
    request<{ capability: CapabilityRecord }>(
      "/api/capabilities/" + id + "/revoke",
      { method: "POST" },
    ),

  /** Metadata for every namespace. `skipped` names files the URI grammar refused. */
  resources: () =>
    request<{ resources: ResourceRef[]; skipped: string[] }>("/api/resources"),

  /** A human reading their own namespace. Throws PolicyDeniedError on refusal. */
  resourceContent: (uri: string) =>
    request<{ decision: PolicyDecision; resource: ResourceRef; content: string }>(
      "/api/resources/content?uri=" + encodeURIComponent(uri),
    ),

  /**
   * The Agent-facing read: the capability IS the credential, so no session is
   * involved. Throws PolicyDeniedError carrying the backend's decision.
   */
  readResource: (uri: string, capabilityId: string) =>
    request<{ decision: PolicyDecision; resource: ResourceRef; content: string }>(
      "/api/resources/read",
      { method: "POST", body: JSON.stringify({ uri, capabilityId }) },
    ),
};
