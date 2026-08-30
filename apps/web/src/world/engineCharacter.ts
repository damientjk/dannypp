import { Rectangle, Texture } from "pixi.js";

/** Columns (animation frames) and rows (facings) in the character sheet. */
const COLS = 3;
const ROWS = 3;

/** Slice the character sheet into the [row][col] grid `CharacterSprite`
 *  indexes into: rows are down/up/right — "left" is the right row mirrored via
 *  `scale.x = -1`, so the sheet carries no left row — and columns are the
 *  neutral stance (used alone for idle) plus two walk steps.
 *
 *  The sheet is built by `scripts/generate-crewmate-sprite.py`; its grid must
 *  stay 3x3 to match `DIRECTION_ROW` and `ANIM_FRAMES` in CharacterSprite. */
export function buildCharacterFrames(texture: Texture): Texture[][] {
  const frameW = texture.width / COLS;
  const frameH = texture.height / ROWS;

  return Array.from({ length: ROWS }, (_row, row) =>
    Array.from(
      { length: COLS },
      (_col, col) =>
        new Texture({
          source: texture.source,
          frame: new Rectangle(col * frameW, row * frameH, frameW, frameH),
        }),
    ),
  );
}
