/**
 * The character skins the world can render its Agents with.
 *
 * `cols` x `rows` describes the sheet's own frame grid, which is *not* always
 * the 3x3 grid `CharacterSprite` indexes into — the vendored office sprite is
 * a single idle-down crop, so it declares 1x1 and `buildCharacterFrames`
 * stretches it across the grid (the same no-op walk cycle it always had).
 * The crewmate sheet is authored at the full 3x3, so it actually animates.
 */
export type CharacterSetId = "crewmate" | "default";

export interface CharacterSet {
  id: CharacterSetId;
  /** Shown on the picker in the control room. */
  label: string;
  url: string;
  /** Animation frames per facing in the source sheet. */
  cols: number;
  /** Facings (down/up/right) in the source sheet. */
  rows: number;
}

export const CHARACTER_SETS: Record<CharacterSetId, CharacterSet> = {
  crewmate: {
    id: "crewmate",
    label: "Crewmates",
    url: "/world-assets/characters/crewmate.png",
    cols: 3,
    rows: 3,
  },
  default: {
    id: "default",
    label: "Default",
    url: "/world-assets/characters/default.png",
    cols: 1,
    rows: 1,
  },
};

export const CHARACTER_SET_LIST: CharacterSet[] = [
  CHARACTER_SETS.crewmate,
  CHARACTER_SETS.default,
];

export const DEFAULT_CHARACTER_SET_ID: CharacterSetId = "crewmate";

const STORAGE_KEY = "launchpad.characterSet";

export function isCharacterSetId(value: unknown): value is CharacterSetId {
  return value === "crewmate" || value === "default";
}

/** Reading localStorage throws in a few real browser configurations (Safari
 *  private mode, cookies-blocked), and the world must still render — so a
 *  failed read is just "no preference yet". */
export function loadCharacterSetId(): CharacterSetId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isCharacterSetId(stored) ? stored : DEFAULT_CHARACTER_SET_ID;
  } catch {
    return DEFAULT_CHARACTER_SET_ID;
  }
}

export function saveCharacterSetId(id: CharacterSetId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Preference is a convenience; losing it must never break the world.
  }
}
