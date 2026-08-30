/**
 * Per-agent colour.
 *
 * The world ships one character sprite sheet, so agents are told apart by a
 * multiply-tint rather than by different art. The palette is deliberately
 * light and saturated: a multiply tint darkens, so dark swatches turn every
 * agent into the same muddy silhouette.
 *
 * Assignment is a pure function of the agent id, so a given agent keeps its
 * colour across reloads, re-logins and re-orderings of the roster — the
 * security log and the sprite can never disagree about who is who.
 */

const PALETTE = [
  0x6fb1e8, // blue
  0xf2b950, // amber
  0x7ed48f, // green
  0xd98fd0, // violet
  0xe8836f, // coral
  0x6fd8d0, // teal
] as const;

/** Stable, order-independent index. Not a security primitive. */
function hashToIndex(value: string, buckets: number): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % buckets;
}

/** Tint for the PixiJS sprite. */
export function colorForAgent(agentId: string): number {
  return PALETTE[hashToIndex(agentId, PALETTE.length)];
}

/** Same colour as a CSS string, for the roster swatch and the log. */
export function cssColorForAgent(agentId: string): string {
  return "#" + colorForAgent(agentId).toString(16).padStart(6, "0");
}
