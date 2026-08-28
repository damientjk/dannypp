import { Assets } from "pixi.js";
import { TiledMapRenderer } from "./engine/TiledMapRenderer";
import type { TiledMap } from "./engine/TiledMapRenderer";

export const TILE_SIZE = 32;

export async function loadWorldMap(): Promise<TiledMapRenderer> {
  const [mapData, tilesetTexture] = await Promise.all([
    fetch("/world-assets/map.json").then((res) => res.json() as Promise<TiledMap>),
    Assets.load("/world-assets/tileset.png"),
  ]);
  return new TiledMapRenderer(mapData, [tilesetTexture]);
}
