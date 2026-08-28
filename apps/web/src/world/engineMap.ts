import { Assets } from "pixi.js";
import { TiledMapRenderer } from "./engine/TiledMapRenderer";
import { buildWorldMap } from "./mapBuilder";
import { listFolderRooms, type FolderRoom } from "./folders";

export const TILE_SIZE = 32;

/**
 * Builds the world for a folder tree. The map is generated rather than fetched
 * because the rooms are the folders — a static map would drift the moment the
 * resource tree changed.
 */
export async function loadWorldMap(
  rooms: readonly FolderRoom[] = listFolderRooms(),
): Promise<TiledMapRenderer> {
  const tilesetTexture = await Assets.load("/world-assets/tileset.png");
  return new TiledMapRenderer(buildWorldMap(rooms), [tilesetTexture]);
}
