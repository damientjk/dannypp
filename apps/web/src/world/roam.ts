/**
 * What each agent goes looking for.
 *
 * Roaming is not random wandering: an agent walks to a folder because the next
 * file on its work plan lives there. That keeps the movement legible — every
 * trip has a reason — and it means the denials the security log records are
 * the ones a real task would have produced.
 *
 * The plan deliberately includes files belonging to OTHER owners. An agent
 * that only ever asked for things it was allowed to have would never exercise
 * the guard, and the whole point is to show what happens when it overreaches.
 */

/** Stable per-agent offset, so agents do not all start on the same file. */
function offsetFor(agentId: string, length: number): number {
  if (length === 0) return 0;
  let hash = 0;
  for (let index = 0; index < agentId.length; index += 1) {
    hash = (hash * 31 + agentId.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % length;
}

/**
 * The order in which one agent works through the files. Every agent sees every
 * file, just starting from a different point, so the world stays busy without
 * any randomness to make a demo unrepeatable.
 */
export function planForAgent(agentId: string, fileUris: readonly string[]): string[] {
  if (fileUris.length === 0) return [];
  const offset = offsetFor(agentId, fileUris.length);
  return [...fileUris.slice(offset), ...fileUris.slice(0, offset)];
}

/** The file an agent should try next, cycling forever. */
export function targetAt(plan: readonly string[], cursor: number): string | null {
  if (plan.length === 0) return null;
  return plan[((cursor % plan.length) + plan.length) % plan.length];
}
