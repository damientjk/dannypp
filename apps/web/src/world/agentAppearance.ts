/**
 * Per-agent appearance.
 *
 * Agents are told apart on the map by which of the five named characters
 * (repo-root Agents/) they wear; the colour palette below no longer tints
 * the sprite — it survives as the roster swatch and security-log accent.
 *
 * Both assignments are pure functions of the agent id, so a given agent
 * keeps its character and colour across reloads, re-logins and
 * re-orderings of the roster — the log and the sprite can never disagree
 * about who is who.
 */

export const CHARACTER_NAMES = ["adam", "alex", "amelia", "ash", "bob"] as const;
export type CharacterName = (typeof CHARACTER_NAMES)[number];

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

/** Which of the five characters this agent wears: round-robin down the
 *  roster (agent 1 = adam, 2 = alex, ...), cycling back to the first when
 *  there are more than five -- per the user's spec. Position-based rather
 *  than id-hashed so a roster of N <= 5 always shows N distinct models. */
export function characterForIndex(index: number): CharacterName {
  return CHARACTER_NAMES[Math.abs(index) % CHARACTER_NAMES.length];
}

/** Accent colour (roster swatch, log rows). */
export function colorForAgent(agentId: string): number {
  return PALETTE[hashToIndex(agentId, PALETTE.length)];
}

/** Same colour as a CSS string, for the roster swatch and the log. */
export function cssColorForAgent(agentId: string): string {
  return "#" + colorForAgent(agentId).toString(16).padStart(6, "0");
}
