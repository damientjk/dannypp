export const TILE_SIZE = 32;

export interface RoomBounds {
  id: "common" | "house-a" | "house-b";
  x: number;
  y: number;
  width: number;
  height: number;
  doorX: number;
  doorY: number;
}

export const ROOMS: RoomBounds[] = [
  { id: "house-a", x: 0, y: 0, width: 8, height: 6, doorX: 4, doorY: 5 },
  { id: "house-b", x: 12, y: 0, width: 8, height: 6, doorX: 15, doorY: 5 },
  { id: "common", x: 0, y: 6, width: 20, height: 6, doorX: 9, doorY: 6 },
];

export const WORLD_WIDTH_TILES = 20;
export const WORLD_HEIGHT_TILES = 12;

export function roomById(id: RoomBounds["id"]): RoomBounds {
  const room = ROOMS.find((candidate) => candidate.id === id);
  if (!room) throw new Error(`unknown room "${id}"`);
  return room;
}

export function tileToPixel(tile: number): number {
  return tile * TILE_SIZE;
}

export function doorPixelPosition(id: RoomBounds["id"]): { x: number; y: number } {
  const room = roomById(id);
  return { x: tileToPixel(room.doorX), y: tileToPixel(room.doorY) };
}

export function spawnPixelPosition(index = 0): { x: number; y: number } {
  const common = roomById("common");
  const spread = Math.max(1, common.width - 4);
  return {
    x: tileToPixel(common.x + 2 + (index % spread)),
    y: tileToPixel(common.y + Math.floor(common.height / 2)),
  };
}
