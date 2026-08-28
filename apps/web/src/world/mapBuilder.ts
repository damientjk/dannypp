/**
 * Builds the Tiled map at runtime from the folder tree.
 *
 * The map is generated rather than authored because the rooms ARE the folders:
 * a hand-drawn map would silently stop matching the resource tree the moment a
 * folder is added. Rooms sit in a row along the top with a shared corridor
 * below, each with one door onto it, so every room is reachable from every
 * other and no route depends on passing through a room you may not enter.
 */

import type { TiledMap } from "./engine/TiledMapRenderer";
import type { FolderRoom } from "./folders";

export const TILE = 32;
/** Walkable interior of one room. */
export const ROOM_INNER_W = 5;
export const ROOM_INNER_H = 4;
/** Interior plus its wall ring. */
export const ROOM_OUTER_W = ROOM_INNER_W + 2;
export const ROOM_OUTER_H = ROOM_INNER_H + 2;
/** Corridor rows beneath the rooms. */
export const CORRIDOR_H = 4;

const GID_BLANK = 0;
const GID_CORRIDOR = 1;
const GID_OWNER_A_FLOOR = 2;
const GID_OWNER_B_FLOOR = 3;
const GID_WALL = 4;

export interface RoomPlacement {
  room: FolderRoom;
  /** Interior rect, in tiles. */
  interior: { x: number; y: number; width: number; height: number };
  /** Door tile, in the room's bottom wall. */
  door: { x: number; y: number };
}

/** Left-to-right placement, one room per folder. */
export function placeRooms(rooms: readonly FolderRoom[]): RoomPlacement[] {
  return rooms.map((room, index) => {
    const x0 = index * ROOM_OUTER_W;
    return {
      room,
      interior: { x: x0 + 1, y: 1, width: ROOM_INNER_W, height: ROOM_INNER_H },
      door: { x: x0 + Math.floor(ROOM_OUTER_W / 2), y: ROOM_OUTER_H - 1 },
    };
  });
}

export function mapSize(roomCount: number): { width: number; height: number } {
  return {
    width: Math.max(1, roomCount) * ROOM_OUTER_W,
    height: ROOM_OUTER_H + CORRIDOR_H,
  };
}

function floorGidFor(ownerId: string, owners: readonly string[]): number {
  return owners.indexOf(ownerId) === 0 ? GID_OWNER_A_FLOOR : GID_OWNER_B_FLOOR;
}

export function buildWorldMap(rooms: readonly FolderRoom[]): TiledMap {
  const { width, height } = mapSize(rooms.length);
  const placements = placeRooms(rooms);
  const owners = [...new Set(rooms.map((room) => room.ownerId))].sort();

  const floor = new Array<number>(width * height).fill(GID_BLANK);
  const walls = new Array<number>(width * height).fill(GID_BLANK);
  const collision = new Array<number>(width * height).fill(GID_BLANK);
  const at = (x: number, y: number) => y * width + x;

  // Everything above the corridor starts as solid, so the gaps between rooms
  // are wall rather than walkable void.
  for (let y = 0; y < ROOM_OUTER_H; y += 1) {
    for (let x = 0; x < width; x += 1) {
      walls[at(x, y)] = GID_WALL;
      collision[at(x, y)] = GID_WALL;
    }
  }

  for (const placement of placements) {
    const floorGid = floorGidFor(placement.room.ownerId, owners);
    const { x, y, width: w, height: h } = placement.interior;
    for (let ty = y; ty < y + h; ty += 1) {
      for (let tx = x; tx < x + w; tx += 1) {
        floor[at(tx, ty)] = floorGid;
        walls[at(tx, ty)] = GID_BLANK;
        collision[at(tx, ty)] = GID_BLANK;
      }
    }
    // Punch the doorway through the bottom wall.
    const door = placement.door;
    floor[at(door.x, door.y)] = floorGid;
    walls[at(door.x, door.y)] = GID_BLANK;
    collision[at(door.x, door.y)] = GID_BLANK;
  }

  for (let y = ROOM_OUTER_H; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      floor[at(x, y)] = GID_CORRIDOR;
    }
  }

  return {
    width,
    height,
    tilewidth: TILE,
    tileheight: TILE,
    tilesets: [
      { firstgid: 1, columns: 5, tilewidth: TILE, tileheight: TILE, tilecount: 5 },
    ],
    layers: [
      { name: "floor", type: "tilelayer", data: floor },
      { name: "walls", type: "tilelayer", data: walls },
      { name: "collision", type: "tilelayer", data: collision },
      {
        name: "spawn-points",
        type: "objectgroup",
        objects: [
          {
            name: "common",
            x: Math.floor(width / 2) * TILE,
            y: (ROOM_OUTER_H + 1) * TILE,
          },
          ...placements.map((placement) => ({
            name: placement.room.id + "-door",
            x: placement.door.x * TILE,
            y: placement.door.y * TILE,
          })),
        ],
      },
      {
        name: "zones",
        type: "objectgroup",
        objects: placements.map((placement) => ({
          name: placement.room.id,
          x: placement.interior.x * TILE,
          y: placement.interior.y * TILE,
          width: placement.interior.width * TILE,
          height: placement.interior.height * TILE,
        })),
      },
    ],
  };
}
