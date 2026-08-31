import { Rectangle, Texture } from "pixi.js";
import type { Direction } from "./engine/CharacterSprite";

/**
 * Frame slicing for the five named characters in repo-root Agents/ (Adam,
 * Alex, Amelia, Ash, Bob), four action sheets each at 32x64 per frame:
 *
 * - idle:    4 frames  = 1 per direction
 * - run:     24 frames = 6 per direction
 * - reading: 18 frames, down-facing only
 * - phone:   9 frames,  down-facing only
 *
 * Sheet direction order is the pack's standard right, up, left, down
 * (verified frame-by-frame against Adam's sheets).
 */
export interface CharacterFrames {
  idle: Record<Direction, Texture[]>;
  run: Record<Direction, Texture[]>;
  read: Texture[];
  phone: Texture[];
}

const FRAME_W = 32;
const FRAME_H = 64;
const SHEET_DIRECTIONS: Direction[] = ["right", "up", "left", "down"];

function sliceRow(sheet: Texture, start: number, count: number): Texture[] {
  return Array.from(
    { length: count },
    (_, i) =>
      new Texture({
        source: sheet.source,
        frame: new Rectangle((start + i) * FRAME_W, 0, FRAME_W, FRAME_H),
      }),
  );
}

function byDirection(sheet: Texture, perDirection: number): Record<Direction, Texture[]> {
  const out = {} as Record<Direction, Texture[]>;
  SHEET_DIRECTIONS.forEach((direction, index) => {
    out[direction] = sliceRow(sheet, index * perDirection, perDirection);
  });
  return out;
}

export function buildCharacterFrames(sheets: {
  idle: Texture;
  run: Texture;
  reading: Texture;
  phone: Texture;
}): CharacterFrames {
  return {
    idle: byDirection(sheets.idle, 1),
    run: byDirection(sheets.run, 6),
    read: sliceRow(sheets.reading, 0, Math.floor(sheets.reading.width / FRAME_W)),
    phone: sliceRow(sheets.phone, 0, Math.floor(sheets.phone.width / FRAME_W)),
  };
}
