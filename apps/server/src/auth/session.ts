import { randomUUID } from "node:crypto";

interface Session{ userId: string; expiresAt: number; }
const sessions = new Map<string, Session>();
const TTL_MS = 60 * 60 * 1000;

export function issueSession(userId: string): string {
    const token = randomUUID();
    sessions.set(token, {userId, expiresAt: Date.now() + TTL_MS });
    return token;
}

export function resolveSession(token: string | undefined): string | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) { sessions.delete(token); return null; }
  return session.userId;
}