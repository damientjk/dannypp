export type AssetKey =
  | "character.default"
  | "room.house-a.floor"
  | "room.house-b.floor"
  | "room.common.floor";

// ponytail: real hand-picked sprite/tile files land here later — drop
// them at these paths under apps/web/public/ and nothing else changes.
// Until a file exists at a path, drawing code falls back to a
// placeholder shape (see WorldCanvas.tsx).
const ASSET_MANIFEST: Record<AssetKey, string> = {
  "character.default": "/world-assets/characters/default.png",
  "room.house-a.floor": "/world-assets/rooms/house-a-floor.png",
  "room.house-b.floor": "/world-assets/rooms/house-b-floor.png",
  "room.common.floor": "/world-assets/rooms/common-floor.png",
};

type AssetState = "loading" | "ready" | "error";

interface CacheEntry {
  image: HTMLImageElement;
  state: AssetState;
}

const cache = new Map<AssetKey, CacheEntry>();

export function loadAsset(key: AssetKey): HTMLImageElement | null {
  let entry = cache.get(key);
  if (!entry) {
    const image = new Image();
    entry = { image, state: "loading" };
    cache.set(key, entry);
    image.onload = () => {
      entry!.state = "ready";
    };
    image.onerror = () => {
      entry!.state = "error";
    };
    image.src = ASSET_MANIFEST[key];
  }
  return entry.state === "ready" ? entry.image : null;
}

export function resetAssetCache(): void {
  cache.clear();
}
