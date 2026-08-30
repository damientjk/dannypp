import type { Texture } from "pixi.js";

/** Only one real character frame exists today (an idle-down crop). Build the
 *  3-row (down/up/right — CharacterSprite treats "left" as "right", flipped)
 *  x 3-col frame grid CharacterSprite indexes into, filling every cell with
 *  that single texture. Direction-flip is real; frame-cycling is a no-op
 *  until real walk-cycle art lands (see spec §8, still deferred). */
export function buildCharacterFrames(texture: Texture): Texture[][] {
  return [
    [texture, texture, texture], // down
    [texture, texture, texture], // up
    [texture, texture, texture], // right (left = this row, flipped)
  ];
}
