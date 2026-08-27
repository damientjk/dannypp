import type { HumanPrincipal } from "../types.js";

const USERS: Record<string, { password: string; principal: HumanPrincipal }> = {
  "user-a": { password: "demo-a", principal: { kind: "human", id: "user-a", displayName: "User A" } },
  "user-b": { password: "demo-b", principal: { kind: "human", id: "user-b", displayName: "User B" } },
};

export function authenticate(userId: string, password: string): HumanPrincipal | null {
  const record = USERS[userId];
  if (!record || record.password !== password) return null;
  return record.principal;
}

export function findUser(userId: string): HumanPrincipal | null {
  return USERS[userId]?.principal ?? null;
}