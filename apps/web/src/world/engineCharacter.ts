import { Rectangle, Texture } from "pixi.js";
import type { CharacterSet } from "./characterSets";
import { CHARACTER_SETS } from "./characterSets";

/** The grid `CharacterSprite` indexes into: 3 facings x 3 animation frames. */
const GRID_ROWS = 3;
const GRID_COLS = 3;

/** Slice a character sheet into the [row][col] grid `CharacterSprite` expects:
 *  rows are down/up/right — "left" is the right row mirrored via
 *  `scale.x = -1`, so no sheet carries a left row — and columns are the
 *  neutral stance (used alone for idle) plus two walk steps.
 *
 *  A sheet may be smaller than that grid: the vendored office sprite is a
 *  single 32x32 idle-down crop. Short rows and columns clamp to their last
 *  available frame, so a 1x1 sheet fills all nine cells with its one frame and
 *  animates exactly as it did before — no branch, and no stretched art. */
export function buildCharacterFrames(
  texture: Texture,
  set: CharacterSet = CHARACTER_SETS.crewmate,
): Texture[][] {
  const frameW = texture.width / set.cols;
  const frameH = texture.height / set.rows;

  return Array.from({ length: GRID_ROWS }, (_row, row) =>
    Array.from({ length: GRID_COLS }, (_col, col) => {
      const sourceRow = Math.min(row, set.rows - 1);
      const sourceCol = Math.min(col, set.cols - 1);
      return new Texture({
        source: texture.source,
        frame: new Rectangle(sourceCol * frameW, sourceRow * frameH, frameW, frameH),
      });
    }),
  );
}
