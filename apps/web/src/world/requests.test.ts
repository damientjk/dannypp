import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDeniedForAgent,
  hasPendingRequest,
  markDenied,
  pendingRequestsFor,
  queueRequest,
  resetRequests,
  resolveRequest,
} from "./requests";

describe("requests", () => {
  beforeEach(() => {
    resetRequests();
  });

  it("queues a new request and reports it pending", () => {
    const request = queueRequest({
      agentId: "agent-1",
      agentName: "Robot A",
      roomId: "auth-module",
      roomOwnerId: "user-a",
    });
    expect(request).not.toBeNull();
    expect(hasPendingRequest("agent-1", "auth-module")).toBe(true);
  });

  it("does not queue a duplicate for the same agent+room pair", () => {
    queueRequest({ agentId: "agent-1", agentName: "Robot A", roomId: "auth-module", roomOwnerId: "user-a" });
    const second = queueRequest({
      agentId: "agent-1",
      agentName: "Robot A",
      roomId: "auth-module",
      roomOwnerId: "user-a",
    });
    expect(second).toBeNull();
  });

  it("queues a separate request for the same agent and a different room", () => {
    queueRequest({ agentId: "agent-1", agentName: "Robot A", roomId: "auth-module", roomOwnerId: "user-a" });
    const second = queueRequest({
      agentId: "agent-1",
      agentName: "Robot A",
      roomId: "billing",
      roomOwnerId: "user-a",
    });
    expect(second).not.toBeNull();
  });

  it("filters pending requests by room owner", () => {
    queueRequest({ agentId: "agent-1", agentName: "Robot A", roomId: "auth-module", roomOwnerId: "user-a" });
    queueRequest({ agentId: "agent-2", agentName: "Robot B", roomId: "database", roomOwnerId: "user-b" });
    expect(pendingRequestsFor("user-a").map((r) => r.roomId)).toEqual(["auth-module"]);
    expect(pendingRequestsFor("user-b").map((r) => r.roomId)).toEqual(["database"]);
  });

  it("removes a request on resolve", () => {
    const request = queueRequest({
      agentId: "agent-1",
      agentName: "Robot A",
      roomId: "auth-module",
      roomOwnerId: "user-a",
    });
    resolveRequest(request!.id);
    expect(hasPendingRequest("agent-1", "auth-module")).toBe(false);
    expect(pendingRequestsFor("user-a")).toEqual([]);
  });

  it("does not re-queue a pair that was denied, until the denied mark is cleared", () => {
    const request = queueRequest({
      agentId: "agent-1",
      agentName: "Robot A",
      roomId: "auth-module",
      roomOwnerId: "user-a",
    });
    resolveRequest(request!.id);
    markDenied("agent-1", "auth-module");

    const reQueued = queueRequest({
      agentId: "agent-1",
      agentName: "Robot A",
      roomId: "auth-module",
      roomOwnerId: "user-a",
    });
    expect(reQueued).toBeNull();

    // simulate the agent's task cycle ending
    clearDeniedForAgent("agent-1");

    const afterClear = queueRequest({
      agentId: "agent-1",
      agentName: "Robot A",
      roomId: "auth-module",
      roomOwnerId: "user-a",
    });
    expect(afterClear).not.toBeNull();
  });
});
