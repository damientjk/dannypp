import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setSessionToken } from "./api";

describe("api session auth", () => {
  afterEach(() => {
    setSessionToken("");
    vi.unstubAllGlobals();
  });

  it("logs in and stores the session token for later requests", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "/api/auth/login") {
        return new Response(
          JSON.stringify({
            sessionToken: "tok-123",
            principal: { kind: "human", id: "user-a", displayName: "User A" },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ agents: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.login("user-a", "demo-a");
    setSessionToken(result.sessionToken);
    expect(result.principal.displayName).toBe("User A");

    await api.listAgents();
    const secondCall = fetchMock.mock.calls[1];
    const headers = (secondCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-session-token"]).toBe("tok-123");
  });
});
