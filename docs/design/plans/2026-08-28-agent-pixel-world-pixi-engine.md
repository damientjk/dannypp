# Agent Pixel World — PixiJS Engine Integration Implementation Plan

**Goal:** Replace the World view's hand-rolled Canvas 2D renderer with a PixiJS-based renderer built from four generic modules surgically reused from `munder-difflin` (MIT), giving the world a real tiled map with walls and BFS pathfinding instead of flat-color room rects and straight-line agent tweens.

**Architecture:** Vendor `TiledMapRenderer`/`Camera`/`pathfinding`/`CharacterSprite` into `apps/web/src/world/engine/`. Author a small tileset PNG + Tiled JSON map from `moderninteriors-win` tiles via a one-off Python generator script. Extend `agentSim.ts`'s existing tween state machine to step through BFS waypoints instead of a single origin→target segment. Replace `WorldCanvas.tsx`'s internals with a Pixi `Application` that mounts the parsed map and per-agent `CharacterSprite`s, keeping its exact `{agents, onFrame}` prop contract so `WorldView.tsx` needs zero changes.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, `pixi.js@^8.5.1` (new dependency), Python 3 + Pillow (asset authoring, one-off).

**Spec:** `docs/design/specs/2026-08-28-agent-pixel-world-design.md` (see §9, "Amendment 2026-08-28: PixiJS rendering engine").

## Global Constraints

- `pixi.js` version: `^8.5.1` — the vendored engine files use v8-only APIs (`new Texture({source, frame})` object constructor, async `Application.init()`). Do not install a v7 or earlier version.
- The four vendored engine files (`TiledMapRenderer.ts`, `Camera.ts`, `pathfinding.ts`, `CharacterSprite.ts`) keep their original logic byte-for-byte except the one additive `CharacterSprite.setTint()` method — do not "clean up" or refactor their internals.
- `Camera.ts` is vendored but **not wired into the renderer** — the map is 22×13 tiles (704×416px), small enough to show in full with no panning. Do not add camera-follow logic.
- `decision.ts` does not change in this plan. `WorldView.tsx`'s login/roster/room-entry *orchestration logic* does not change — Task 7 only adds renderer-loading plumbing (a `mapRenderer` state value threaded into two existing call sites) on top of it. `WorldCanvas`'s public props stay `{ agents: WorldAgent[]; onFrame: (agents: WorldAgent[]) => void }`.
- Tile size stays `32` (`TILE_SIZE`), matching the Tiled map's `tilewidth`/`tileheight` and the existing character/floor crop assets.
- `apps/web/src/world/map.ts`, `map.test.ts`, `assets.ts`, `assets.test.ts` are deleted in this plan — their responsibilities move into the new Tiled map + `engineMap.ts`. **Both deletions happen in Task 6**, not before: `map.ts` stays in place through Tasks 3-5 because `WorldCanvas.tsx` (rewritten in Task 6) is its last consumer — deleting it earlier would break `WorldCanvas.tsx`'s then-still-current imports.
- **`agentSim.ts`'s Task 4 signature changes (`spawnWorldAgents`/`beginMoveToRoom` gain a required `renderer` parameter) are consumed by `WorldCanvas.tsx`/`WorldCanvas.test.tsx` (Task 6) and `WorldView.tsx` (Task 7).** A project-wide `tsc -b` run after Task 4 will show errors in those not-yet-updated files — that is expected, not a Task 4 failure. Each task's own typecheck note below says exactly which errors are expected to remain and which task clears them. The project must be fully clean only from Task 7 onward.
- Every new/modified TypeScript file must pass `npm run --workspace apps/web typecheck` and `npm run --workspace apps/web test` before a task is considered done, **except** for the specific, named cross-task typecheck errors called out above and in Tasks 4 and 6's own steps.

---

### Task 1: Vendor the PixiJS engine modules + add the dependency

**Files:**
- Modify: `apps/web/package.json` (add `pixi.js`)
- Create: `apps/web/src/world/engine/TiledMapRenderer.ts`
- Create: `apps/web/src/world/engine/Camera.ts`
- Create: `apps/web/src/world/engine/pathfinding.ts`
- Create: `apps/web/src/world/engine/CharacterSprite.ts`
- Create: `apps/web/src/world/engine/CharacterSprite.test.ts`
- Create: `apps/web/src/world/engine/pathfinding.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 3-6): `TiledMapRenderer` class (constructor `(mapData: TiledMap, tilesetTextures: Texture[])`, methods `getContainer()`, `isWalkable(tx,ty)`, `tileToPixel(tx,ty)`, `pixelToTile(px,py)`, `getSpawnPoint(name)`, `getZone(name)`, `width`, `height`, `tileSize`), the `TiledMap`/`TiledLayer`/`TiledTilesetRef`/`Point`/`ZoneRect` types, `findPath(map: Walkable, start, goal): Point[] | null`, `Walkable` interface, `CharacterSprite` class (constructor `(frames: Texture[][])`, methods `setAnimation(anim, direction)`, `setPosition(x,y)`, `setAlpha(alpha)`, `setTint(color: number)`, `destroy()`, field `container: Container`).

- [ ] **Step 1: Add the dependency**

Edit `apps/web/package.json`, in `"dependencies"`, add (alphabetical, after `"@vitejs/plugin-react"`):

```json
    "pixi.js": "^8.5.1",
```

Run: `npm install --workspace apps/web`
Expected: lockfile updates, no errors.

- [ ] **Step 2: Create the engine directory and vendor `pathfinding.ts` verbatim**

Create `apps/web/src/world/engine/pathfinding.ts`:

```ts
// Vendored verbatim from github.com/chaitanyagiri/munder-difflin (MIT),
// itself ported from shahar061/the-office (office/engine/pathfinding.ts).
// BFS pathfinding on a tile walkability grid.

export interface Walkable {
  width: number;
  height: number;
  isWalkable(x: number, y: number): boolean;
}

interface Point {
  x: number;
  y: number;
}

const DIRECTIONS: Point[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

export function findPath(map: Walkable, start: Point, goal: Point): Point[] | null {
  if (start.x === goal.x && start.y === goal.y) return [];
  if (!map.isWalkable(goal.x, goal.y)) return null;

  const key = (p: Point) => `${p.x},${p.y}`;
  const visited = new Set<string>();
  const parent = new Map<string, Point>();
  const queue: Point[] = [start];
  visited.add(key(start));

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const dir of DIRECTIONS) {
      const next: Point = { x: current.x + dir.x, y: current.y + dir.y };
      const nextKey = key(next);

      if (visited.has(nextKey) || !map.isWalkable(next.x, next.y)) continue;

      visited.add(nextKey);
      parent.set(nextKey, current);

      if (next.x === goal.x && next.y === goal.y) {
        return reconstructPath(parent, start, goal);
      }

      queue.push(next);
    }
  }

  return null;
}

function reconstructPath(parent: Map<string, Point>, start: Point, goal: Point): Point[] {
  const path: Point[] = [];
  let current = goal;
  const key = (p: Point) => `${p.x},${p.y}`;

  while (!(current.x === start.x && current.y === start.y)) {
    path.unshift(current);
    current = parent.get(key(current))!;
  }

  return path;
}
```

- [ ] **Step 3: Write a real (non-mocked) test for `findPath`**

Create `apps/web/src/world/engine/pathfinding.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findPath } from "./pathfinding";
import type { Walkable } from "./pathfinding";

function gridFrom(rows: string[]): Walkable {
  const width = rows[0].length;
  const height = rows.length;
  return {
    width,
    height,
    isWalkable(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      return rows[y][x] === ".";
    },
  };
}

describe("findPath", () => {
  it("returns an empty array when start equals goal", () => {
    const grid = gridFrom(["..."]);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual([]);
  });

  it("returns null when the goal is not walkable", () => {
    const grid = gridFrom([".#."]);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });

  it("routes around a wall", () => {
    const grid = gridFrom(["..#..", "..#..", "....."]);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    for (const point of path!) {
      expect(grid.isWalkable(point.x, point.y)).toBe(true);
    }
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 0 });
  });
});
```

Run: `npm test --workspace apps/web -- pathfinding`
Expected: 3 passed.

- [ ] **Step 4: Vendor `TiledMapRenderer.ts` verbatim**

Create `apps/web/src/world/engine/TiledMapRenderer.ts`:

```ts
// Vendored from github.com/chaitanyagiri/munder-difflin (MIT), a trimmed
// port of shahar061/the-office (office/engine/TiledMapRenderer.ts): renders
// floor/walls/furniture tile layers and parses collision, spawn-points and
// zones. Interactive-object / war-room / monitor-glow extraction is dropped
// upstream (every tile renders statically), so no tiles ever go missing.

import { Container, Sprite, Texture, Rectangle } from "pixi.js";

const FLIPPED_H_FLAG = 0x80000000;
const FLIPPED_V_FLAG = 0x40000000;
const FLIPPED_D_FLAG = 0x20000000;
const TILE_ID_MASK = 0x1fffffff;

export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: TiledTilesetRef[];
}

export interface TiledLayer {
  name: string;
  type: "tilelayer" | "objectgroup";
  data?: number[];
  objects?: TiledObject[];
}

export interface TiledObject {
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface TiledTilesetRef {
  firstgid: number;
  source?: string;
  image?: string;
  columns?: number;
  tilewidth?: number;
  tileheight?: number;
  tilecount?: number;
}

export interface ZoneRect { x: number; y: number; width: number; height: number; }
export interface Point { x: number; y: number; }

const TILE_LAYERS = ["floor", "walls", "furniture-below", "furniture-above"] as const;
const COLLISION_LAYER = "collision";
const SPAWN_POINTS_LAYER = "spawn-points";
const ZONES_LAYER = "zones";

export class TiledMapRenderer {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;

  private walkabilityGrid: boolean[][] = [];
  private spawnPoints: Map<string, Point> = new Map();
  private zones: Map<string, ZoneRect> = new Map();
  private characterContainer: Container;
  private rootContainer: Container;

  private static readonly WALKABLE_SPAWN_PREFIXES = ["desk-", "pc-", "warroom-", "entrance"];

  constructor(private mapData: TiledMap, private tilesetTextures: Texture[]) {
    this.width = mapData.width;
    this.height = mapData.height;
    this.tileSize = mapData.tilewidth;
    this.rootContainer = new Container();
    this.characterContainer = new Container();
    this.characterContainer.sortableChildren = true;

    this.parseCollisionLayer();
    this.parseSpawnPoints();
    this.markWalkableSpawnPoints();
    this.parseZones();
    this.buildTileLayers();
  }

  getContainer(): Container { return this.rootContainer; }
  getCharacterContainer(): Container { return this.characterContainer; }

  isWalkable(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return false;
    return this.walkabilityGrid[ty][tx];
  }

  tileToPixel(tx: number, ty: number): Point {
    return { x: tx * this.tileSize, y: ty * this.tileSize };
  }

  pixelToTile(px: number, py: number): Point {
    return { x: Math.floor(px / this.tileSize), y: Math.floor(py / this.tileSize) };
  }

  getSpawnPoint(name: string): Point | undefined { return this.spawnPoints.get(name); }
  getAllSpawnPoints(): Map<string, Point> { return this.spawnPoints; }
  getZone(name: string): ZoneRect | undefined { return this.zones.get(name); }
  getAllZones(): Map<string, ZoneRect> { return this.zones; }

  gidAt(layerName: string, tx: number, ty: number): number {
    const layer = this.findLayer(layerName, "tilelayer");
    if (!layer?.data || tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return 0;
    return (layer.data[ty * this.width + tx] ?? 0) & TILE_ID_MASK;
  }

  textureForGid(gid: number): Texture | undefined {
    const tileId = gid & TILE_ID_MASK;
    if (tileId === 0) return undefined;
    const resolved = this.resolveTileset(tileId);
    if (!resolved) return undefined;
    const { tileset, texture } = resolved;
    const cols = tileset.columns ?? 16;
    const tw = tileset.tilewidth ?? this.tileSize;
    const th = tileset.tileheight ?? this.tileSize;
    const localId = tileId - tileset.firstgid;
    const frame = new Rectangle((localId % cols) * tw, Math.floor(localId / cols) * th, tw, th);
    return new Texture({ source: texture.source, frame });
  }

  private parseCollisionLayer(): void {
    const layer = this.findLayer(COLLISION_LAYER, "tilelayer");
    this.walkabilityGrid = Array.from({ length: this.height }, () => Array(this.width).fill(true));
    if (!layer?.data) return;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const rawId = layer.data[y * this.width + x];
        if ((rawId & TILE_ID_MASK) !== 0) this.walkabilityGrid[y][x] = false;
      }
    }
  }

  private parseSpawnPoints(): void {
    const layer = this.findLayer(SPAWN_POINTS_LAYER, "objectgroup");
    if (!layer?.objects) return;
    for (const obj of layer.objects) {
      this.spawnPoints.set(obj.name, {
        x: Math.floor(obj.x / this.tileSize),
        y: Math.floor(obj.y / this.tileSize),
      });
    }
  }

  private markWalkableSpawnPoints(): void {
    for (const [name, point] of this.spawnPoints) {
      if (!TiledMapRenderer.WALKABLE_SPAWN_PREFIXES.some((p) => name.startsWith(p))) continue;
      if (point.y >= 0 && point.y < this.height && point.x >= 0 && point.x < this.width) {
        this.walkabilityGrid[point.y][point.x] = true;
      }
    }
  }

  private parseZones(): void {
    const layer = this.findLayer(ZONES_LAYER, "objectgroup");
    if (!layer?.objects) return;
    for (const obj of layer.objects) {
      this.zones.set(obj.name, {
        x: Math.floor(obj.x / this.tileSize),
        y: Math.floor(obj.y / this.tileSize),
        width: Math.floor((obj.width ?? 0) / this.tileSize),
        height: Math.floor((obj.height ?? 0) / this.tileSize),
      });
    }
  }

  private resolveTileset(tileId: number): { tileset: TiledTilesetRef; texture: Texture } | undefined {
    for (let i = this.mapData.tilesets.length - 1; i >= 0; i--) {
      if (tileId >= this.mapData.tilesets[i].firstgid) {
        return { tileset: this.mapData.tilesets[i], texture: this.tilesetTextures[i] };
      }
    }
    return undefined;
  }

  private buildTileLayers(): void {
    if (this.mapData.tilesets.length === 0) return;

    for (const layerName of TILE_LAYERS) {
      const layer = this.findLayer(layerName, "tilelayer");
      const container = new Container();
      container.label = layerName;

      if (layer?.data) {
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            const raw = layer.data[y * this.width + x];
            if (raw === 0) continue;

            const flippedH = (raw & FLIPPED_H_FLAG) !== 0;
            const flippedV = (raw & FLIPPED_V_FLAG) !== 0;
            const flippedD = (raw & FLIPPED_D_FLAG) !== 0;
            const tileId = raw & TILE_ID_MASK;

            const resolved = this.resolveTileset(tileId);
            if (!resolved) continue;

            const { tileset, texture } = resolved;
            const cols = tileset.columns ?? 16;
            const tw = tileset.tilewidth ?? this.tileSize;
            const th = tileset.tileheight ?? this.tileSize;
            const localId = tileId - tileset.firstgid;
            const srcX = (localId % cols) * tw;
            const srcY = Math.floor(localId / cols) * th;

            const frame = new Rectangle(srcX, srcY, tw, th);
            const sprite = new Sprite(new Texture({ source: texture.source, frame }));

            if (flippedH || flippedV || flippedD) {
              sprite.anchor.set(0.5, 0.5);
              sprite.x = x * this.tileSize + this.tileSize / 2;
              sprite.y = y * this.tileSize + this.tileSize / 2;
              if (flippedD) {
                if (flippedH && !flippedV) {
                  sprite.rotation = Math.PI / 2;
                } else if (!flippedH && flippedV) {
                  sprite.rotation = -Math.PI / 2;
                } else if (flippedH && flippedV) {
                  sprite.rotation = Math.PI / 2;
                  sprite.scale.y = -1;
                } else {
                  sprite.rotation = Math.PI / 2;
                  sprite.scale.x = -1;
                }
              } else {
                if (flippedH) sprite.scale.x = -1;
                if (flippedV) sprite.scale.y = -1;
              }
            } else {
              sprite.x = x * this.tileSize;
              sprite.y = y * this.tileSize;
            }

            container.addChild(sprite);
          }
        }
      }

      this.rootContainer.addChild(container);
    }

    this.rootContainer.addChild(this.characterContainer);
  }

  private findLayer(name: string, type: "tilelayer" | "objectgroup"): TiledLayer | undefined {
    return this.mapData.layers.find((l) => l.name === name && l.type === type);
  }
}
```

- [ ] **Step 5: Vendor `Camera.ts` verbatim (unused this plan, kept for parity — see Global Constraints)**

Create `apps/web/src/world/engine/Camera.ts`:

```ts
// Vendored from github.com/chaitanyagiri/munder-difflin (MIT). NOT wired
// into this project's renderer — our map is small enough to render at 1:1
// with no panning. Kept for future use if the map grows past one screen.

import { Container } from "pixi.js";

export interface CameraBounds {
  width: number;
  height: number;
}

export class Camera {
  private target: Container;
  private viewport: CameraBounds;
  private worldBounds: CameraBounds;
  private followX = 0;
  private followY = 0;
  private lerpSpeed = 6;

  constructor(target: Container, viewport: CameraBounds, worldBounds: CameraBounds) {
    this.target = target;
    this.viewport = viewport;
    this.worldBounds = worldBounds;
  }

  fitToScreen(): void {
    const scaleX = this.viewport.width / this.worldBounds.width;
    const scaleY = this.viewport.height / this.worldBounds.height;
    const scale = Math.min(scaleX, scaleY, 1);
    this.target.scale.set(scale);
    this.target.x = (this.viewport.width - this.worldBounds.width * scale) / 2;
    this.target.y = (this.viewport.height - this.worldBounds.height * scale) / 2;
  }

  focusOn(x: number, y: number): void {
    this.followX = x;
    this.followY = y;
    this.target.x = this.viewport.width / 2 - x * this.target.scale.x;
    this.target.y = this.viewport.height / 2 - y * this.target.scale.y;
  }

  nudgeToward(x: number, y: number, dt: number): void {
    this.followX += (x - this.followX) * Math.min(1, this.lerpSpeed * dt);
    this.followY += (y - this.followY) * Math.min(1, this.lerpSpeed * dt);
    this.target.x = this.viewport.width / 2 - this.followX * this.target.scale.x;
    this.target.y = this.viewport.height / 2 - this.followY * this.target.scale.y;
  }

  update(dt: number): void {
    this.nudgeToward(this.followX, this.followY, dt);
  }
}
```

- [ ] **Step 6: Vendor `CharacterSprite.ts`, plus the additive `setTint` method**

Create `apps/web/src/world/engine/CharacterSprite.ts`:

```ts
// Vendored from github.com/chaitanyagiri/munder-difflin (MIT), itself
// ported from shahar061/the-office (office/characters/CharacterSprite.ts).
// The `setTint` method is NOT part of the original — it's our addition so
// the deny-bounce red-flash affordance survives the switch to real sprites.

import { AnimatedSprite, Container, Graphics, Texture } from "pixi.js";

export type Direction = "down" | "up" | "right" | "left";
export type AnimState = "walk" | "type" | "read" | "idle";

const DIRECTION_ROW: Record<Direction, number> = {
  down: 0,
  up: 1,
  right: 2,
  left: 2,
};

const ANIM_FRAMES: Record<AnimState, number[]> = {
  walk: [0, 1, 2, 1],
  type: [0, 1, 2, 1],
  read: [0, 1, 2, 1],
  idle: [0],
};

const CHAR_SCALE = 1.08;

export class CharacterSprite {
  readonly container: Container;
  private sprite: AnimatedSprite;
  private frames: Texture[][];
  private currentDirection: Direction = "down";
  private currentAnim: AnimState = "idle";
  private frameSpeed = 0.15;
  private frameW: number;
  private frameH: number;
  private cropMask: Graphics | null = null;

  constructor(frames: Texture[][]) {
    this.frames = frames;
    this.container = new Container();

    const initialFrames = this.getFrames("down", "idle");
    this.sprite = new AnimatedSprite(initialFrames);
    this.sprite.anchor.set(0.5, 1);
    this.sprite.animationSpeed = this.frameSpeed;
    this.sprite.play();
    this.frameW = this.sprite.texture.frame.width || this.sprite.width || 16;
    this.frameH = this.sprite.texture.frame.height || this.sprite.height || 32;

    this.container.addChild(this.sprite);
    this.container.scale.set(CHAR_SCALE);
  }

  setSeatedCrop(cropPx: number): void {
    if (cropPx <= 0) {
      if (this.cropMask) {
        this.sprite.mask = null;
        this.cropMask.visible = false;
      }
      return;
    }
    if (!this.cropMask) {
      this.cropMask = new Graphics();
      this.container.addChild(this.cropMask);
    }
    const w = this.frameW;
    const h = this.frameH;
    this.cropMask.clear();
    this.cropMask
      .rect(-w / 2 - 2, -h - 2, w + 4, h - cropPx + 2)
      .fill(0xffffff);
    this.cropMask.visible = true;
    this.sprite.mask = this.cropMask;
  }

  private getFrames(direction: Direction, anim: AnimState): Texture[] {
    const row = DIRECTION_ROW[direction];
    return ANIM_FRAMES[anim].map((col) => this.frames[row][col]);
  }

  setAnimation(anim: AnimState, direction: Direction): void {
    if (anim === this.currentAnim && direction === this.currentDirection) return;

    this.currentAnim = anim;
    this.currentDirection = direction;

    this.sprite.textures = this.getFrames(direction, anim);
    this.sprite.scale.x = direction === "left" ? -1 : 1;
    this.sprite.animationSpeed = anim === "walk" ? 0.15 : anim === "idle" ? 0.08 : 0.06;
    this.sprite.play();
  }

  /** Multiply-tint the sprite (e.g. red on a denied room-entry bounce).
   *  Pass 0xffffff to clear the tint back to the texture's real colors. */
  setTint(color: number): void {
    this.sprite.tint = color;
  }

  setPosition(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  setAlpha(alpha: number): void {
    this.container.alpha = alpha;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
```

- [ ] **Step 7: Write a real (non-mocked) test for `CharacterSprite`**

Create `apps/web/src/world/engine/CharacterSprite.test.ts`:

```ts
import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { CharacterSprite } from "./CharacterSprite";

function frameGrid(): Texture[][] {
  return [
    [Texture.WHITE, Texture.WHITE, Texture.WHITE],
    [Texture.WHITE, Texture.WHITE, Texture.WHITE],
    [Texture.WHITE, Texture.WHITE, Texture.WHITE],
  ];
}

describe("CharacterSprite", () => {
  it("constructs without a renderer and exposes a container", () => {
    const sprite = new CharacterSprite(frameGrid());
    expect(sprite.container.children.length).toBeGreaterThan(0);
    sprite.destroy();
  });

  it("does not throw for any direction/anim combination", () => {
    const sprite = new CharacterSprite(frameGrid());
    for (const anim of ["walk", "type", "read", "idle"] as const) {
      for (const direction of ["up", "down", "left", "right"] as const) {
        expect(() => sprite.setAnimation(anim, direction)).not.toThrow();
      }
    }
    sprite.destroy();
  });

  it("setTint applies a tint to the underlying sprite", () => {
    const sprite = new CharacterSprite(frameGrid());
    sprite.setTint(0xc55353);
    const inner = sprite.container.children[0] as { tint: number };
    expect(inner.tint).toBe(0xc55353);
    sprite.setTint(0xffffff);
    expect(inner.tint).toBe(0xffffff);
    sprite.destroy();
  });
});
```

Run: `npm test --workspace apps/web -- CharacterSprite`
Expected: 3 passed.

- [ ] **Step 8: Typecheck and commit**

Run: `npm run --workspace apps/web typecheck`
Expected: no errors.

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/src/world/engine/
git commit -m "feat(world): vendor pixi.js engine modules from munder-difflin"
```

---

### Task 2: Author the tileset PNG + Tiled JSON map from moderninteriors-win tiles

**Files:**
- Create: `apps/web/scripts/generate-world-tileset.py`
- Create: `apps/web/scripts/generate-world-map.py`
- Create: `apps/web/public/world-assets/tileset.png` (generated output)
- Create: `apps/web/public/world-assets/map.json` (generated output)
- Delete: `apps/web/public/world-assets/rooms/house-a-floor.png`
- Delete: `apps/web/public/world-assets/rooms/house-b-floor.png`
- Delete: `apps/web/public/world-assets/rooms/common-floor.png`

**Interfaces:**
- Produces (consumed by Task 3): `apps/web/public/world-assets/tileset.png` — a 160×32px PNG, 5 tiles of 32×32 laid out left to right: index 0 = blank/transparent, index 1 = common floor, index 2 = house-a floor, index 3 = house-b floor, index 4 = wall. `apps/web/public/world-assets/map.json` — a Tiled-format JSON map, `width: 22, height: 13, tilewidth: 32, tileheight: 32`, one tileset (`firstgid: 1, columns: 5, tilecount: 5, tilewidth: 32, tileheight: 32`), layers named exactly `"floor"`, `"walls"`, `"collision"` (all `type: "tilelayer"`, `data` arrays of length 286 = 22×13, row-major), `"spawn-points"` and `"zones"` (both `type: "objectgroup"`). Spawn point names: `"common"` (tile 10,9), `"house-a-door"` (tile 4,6), `"house-b-door"` (tile 17,6). Zone names: `"house-a"`, `"house-b"`, `"common"`.

- [ ] **Step 1: Write the tileset-composition script**

Create `apps/web/scripts/generate-world-tileset.py`:

```python
#!/usr/bin/env python3
"""Composite the world's 5-tile Tiled tileset from moderninteriors-win art
plus the already-cropped floor textures. One-off asset build — re-run only
if the source art or tile choices change.

Usage: python3 generate-world-tileset.py
"""
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[3]
MODERNINTERIORS = REPO_ROOT / "moderninteriors-win"
WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"

TILE = 32

ROOM_BUILDER = MODERNINTERIORS / "1_Interiors" / "32x32" / "Room_Builder_32x32.png"
WALL_TILE_COL, WALL_TILE_ROW = 7, 2  # solid tan wall block, verified visually

FLOOR_SOURCES = [
    WORLD_ASSETS / "rooms" / "common-floor.png",
    WORLD_ASSETS / "rooms" / "house-a-floor.png",
    WORLD_ASSETS / "rooms" / "house-b-floor.png",
]


def main() -> None:
    room_builder = Image.open(ROOM_BUILDER).convert("RGBA")
    wall_tile = room_builder.crop((
        WALL_TILE_COL * TILE,
        WALL_TILE_ROW * TILE,
        WALL_TILE_COL * TILE + TILE,
        WALL_TILE_ROW * TILE + TILE,
    ))

    tiles = [Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))]  # gid 0 unused/blank
    for path in FLOOR_SOURCES:
        tiles.append(Image.open(path).convert("RGBA"))
    tiles.append(wall_tile)

    sheet = Image.new("RGBA", (TILE * len(tiles), TILE), (0, 0, 0, 0))
    for i, tile in enumerate(tiles):
        sheet.paste(tile, (i * TILE, 0))

    out_path = WORLD_ASSETS / "tileset.png"
    sheet.save(out_path)
    print(f"wrote {out_path} ({sheet.size[0]}x{sheet.size[1]}, {len(tiles)} tiles)")


if __name__ == "__main__":
    main()
```

Run: `python3 apps/web/scripts/generate-world-tileset.py`
Expected: prints `wrote .../tileset.png (160x32, 5 tiles)`.

- [ ] **Step 2: Verify the tileset visually**

Use the Read tool on `apps/web/public/world-assets/tileset.png`. Expected: 5 distinct 32×32 tiles left to right — transparent, then three visually different floor textures, then a solid tan wall block. If any tile looks wrong (e.g. the wall crop landed on the wrong cell), open `moderninteriors-win/1_Interiors/32x32/Room_Builder_32x32.png` at 32px grid coordinates `(7,2)` to confirm it's a plain wall block before adjusting `WALL_TILE_COL`/`WALL_TILE_ROW` and re-running.

- [ ] **Step 3: Write the map-authoring script**

Create `apps/web/scripts/generate-world-map.py`:

```python
#!/usr/bin/env python3
"""Author the world's Tiled JSON map: two walled houses (with one door-gap
each) connected by an open common corridor along the bottom. One-off asset
build — re-run only if the room layout changes.

Grid (22 wide x 13 tall, TILE=32px):
  House A exterior rect: x 0-8,  y 0-6 (interior floor x 1-7,  y 1-5; door gap x 4, y 6)
  House B exterior rect: x 13-21, y 0-6 (interior floor x 14-20, y 1-5; door gap x 17, y 6)
  Gap between houses (x 9-12, y 0-6): unfloored, marked non-walkable
  Common corridor: x 0-21, y 7-12, fully open floor

Usage: python3 generate-world-map.py
"""
import json
from pathlib import Path

WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"

WIDTH, HEIGHT, TILE = 22, 13, 32

GID_BLANK = 0
GID_COMMON_FLOOR = 1
GID_HOUSE_A_FLOOR = 2
GID_HOUSE_B_FLOOR = 3
GID_WALL = 4


def rect_cells(x0, y0, x1, y1):
    """Inclusive tile coordinates in the [x0,x1] x [y0,y1] rect."""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            yield x, y


def is_ring(x, y, x0, y0, x1, y1):
    return x in (x0, x1) or y in (y0, y1)


def build_layer(fill):
    """fill: dict[(x,y)] -> gid, sparse; everything else is GID_BLANK."""
    data = [GID_BLANK] * (WIDTH * HEIGHT)
    for (x, y), gid in fill.items():
        data[y * WIDTH + x] = gid
    return data


def main() -> None:
    house_a = (0, 0, 8, 6)  # x0,y0,x1,y1 exterior rect
    house_b = (13, 0, 21, 6)
    house_a_door = (4, 6)
    house_b_door = (17, 6)

    floor_fill = {}
    walls_fill = {}
    collision_fill = {}

    # House interiors + wall rings (ring minus the door-gap tile).
    for (x0, y0, x1, y1), door, floor_gid in (
        (house_a, house_a_door, GID_HOUSE_A_FLOOR),
        (house_b, house_b_door, GID_HOUSE_B_FLOOR),
    ):
        for x, y in rect_cells(x0, y0, x1, y1):
            if (x, y) == door:
                floor_fill[(x, y)] = floor_gid
                continue
            if is_ring(x, y, x0, y0, x1, y1):
                walls_fill[(x, y)] = GID_WALL
                collision_fill[(x, y)] = GID_WALL
            else:
                floor_fill[(x, y)] = floor_gid

    # Gap between the two houses (x 9-12, y 0-6): no floor, blocked.
    for x in range(9, 13):
        for y in range(0, 7):
            collision_fill[(x, y)] = GID_WALL

    # Common corridor: fully open floor, no walls.
    for x, y in rect_cells(0, 7, WIDTH - 1, HEIGHT - 1):
        floor_fill[(x, y)] = GID_COMMON_FLOOR

    def tile_obj(name, x, y):
        return {"name": name, "x": x * TILE, "y": y * TILE}

    def zone_obj(name, x0, y0, x1, y1):
        return {
            "name": name,
            "x": x0 * TILE,
            "y": y0 * TILE,
            "width": (x1 - x0 + 1) * TILE,
            "height": (y1 - y0 + 1) * TILE,
        }

    tiled_map = {
        "width": WIDTH,
        "height": HEIGHT,
        "tilewidth": TILE,
        "tileheight": TILE,
        "tilesets": [
            {
                "firstgid": 1,
                "image": "tileset.png",
                "columns": 5,
                "tilewidth": TILE,
                "tileheight": TILE,
                "tilecount": 5,
            }
        ],
        "layers": [
            {"name": "floor", "type": "tilelayer", "data": build_layer(floor_fill)},
            {"name": "walls", "type": "tilelayer", "data": build_layer(walls_fill)},
            {"name": "collision", "type": "tilelayer", "data": build_layer(collision_fill)},
            {
                "name": "spawn-points",
                "type": "objectgroup",
                "objects": [
                    tile_obj("common", 10, 9),
                    tile_obj("house-a-door", *house_a_door),
                    tile_obj("house-b-door", *house_b_door),
                ],
            },
            {
                "name": "zones",
                "type": "objectgroup",
                "objects": [
                    zone_obj("house-a", 1, 1, 7, 5),
                    zone_obj("house-b", 14, 1, 20, 5),
                    zone_obj("common", 0, 7, WIDTH - 1, HEIGHT - 1),
                ],
            },
        ],
    }

    out_path = WORLD_ASSETS / "map.json"
    out_path.write_text(json.dumps(tiled_map, indent=2))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
```

Run: `python3 apps/web/scripts/generate-world-map.py`
Expected: prints `wrote .../map.json`.

- [ ] **Step 4: Sanity-check the generated map**

Run: `python3 -c "import json; m = json.load(open('apps/web/public/world-assets/map.json')); print(m['width'], m['height'], [l['name'] for l in m['layers']])"`
Expected: `22 13 ['floor', 'walls', 'collision', 'spawn-points', 'zones']`

- [ ] **Step 5: Remove the now-superseded standalone floor crops**

```bash
git rm apps/web/public/world-assets/rooms/house-a-floor.png apps/web/public/world-assets/rooms/house-b-floor.png apps/web/public/world-assets/rooms/common-floor.png
```

(They're baked into `tileset.png` by Step 1; nothing references the standalone files after Task 6 removes `assets.ts`.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/scripts/generate-world-tileset.py apps/web/scripts/generate-world-map.py apps/web/public/world-assets/tileset.png apps/web/public/world-assets/map.json
git commit -m "feat(world): author Tiled tileset + map from moderninteriors-win tiles"
```

---

### Task 3: `engineMap.ts` — load the tileset + map at runtime

**Files:**
- Create: `apps/web/src/world/engineMap.ts`
- Create: `apps/web/src/world/engineMap.test.ts`

Note: `apps/web/src/world/map.ts`/`map.test.ts` are NOT deleted in this task, even though this task fully supersedes them. They stay in place through Tasks 3-5 because `WorldCanvas.tsx` (rewritten in Task 6) is their last remaining consumer — deleting them now would break `WorldCanvas.tsx`'s current imports before Task 6 has replaced them. Task 6 deletes both files.

**Interfaces:**
- Consumes: `TiledMapRenderer`, `TiledMap` from `./engine/TiledMapRenderer` (Task 1); `apps/web/public/world-assets/tileset.png` and `map.json` (Task 2, fetched at runtime via URL paths `/world-assets/tileset.png` and `/world-assets/map.json`).
- Produces (consumed by Tasks 4 and 6): `export const TILE_SIZE = 32;` and `export async function loadWorldMap(): Promise<TiledMapRenderer>` — fetches `map.json`, loads `tileset.png` as a pixi `Texture` via `Assets.load`, and constructs a `TiledMapRenderer`.

- [ ] **Step 1: Write `engineMap.ts`**

Create `apps/web/src/world/engineMap.ts`:

```ts
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
```

- [ ] **Step 2: Write a failing test using a fixture map + `Texture.WHITE`**

Create `apps/web/src/world/engineMap.test.ts`:

```ts
import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { TiledMapRenderer } from "./engine/TiledMapRenderer";
import type { TiledMap } from "./engine/TiledMapRenderer";
import { TILE_SIZE } from "./engineMap";

function fixtureMap(): TiledMap {
  const width = 4;
  const height = 3;
  const floor = new Array(width * height).fill(1);
  const collision = new Array(width * height).fill(0);
  collision[0] = 4; // (0,0) is a wall
  return {
    width,
    height,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    tilesets: [{ firstgid: 1, columns: 5, tilewidth: TILE_SIZE, tileheight: TILE_SIZE, tilecount: 5 }],
    layers: [
      { name: "floor", type: "tilelayer", data: floor },
      { name: "collision", type: "tilelayer", data: collision },
      {
        name: "spawn-points",
        type: "objectgroup",
        objects: [{ name: "common", x: TILE_SIZE, y: TILE_SIZE }],
      },
      {
        name: "zones",
        type: "objectgroup",
        objects: [{ name: "house-a", x: 0, y: 0, width: TILE_SIZE * 2, height: TILE_SIZE * 2 }],
      },
    ],
  };
}

describe("TiledMapRenderer against the fixture map (via engineMap's TILE_SIZE)", () => {
  it("derives walkability from the collision layer", () => {
    const renderer = new TiledMapRenderer(fixtureMap(), [Texture.WHITE]);
    expect(renderer.isWalkable(0, 0)).toBe(false);
    expect(renderer.isWalkable(1, 0)).toBe(true);
    expect(renderer.isWalkable(-1, 0)).toBe(false);
  });

  it("resolves named spawn points and zones in tile units", () => {
    const renderer = new TiledMapRenderer(fixtureMap(), [Texture.WHITE]);
    expect(renderer.getSpawnPoint("common")).toEqual({ x: 1, y: 1 });
    expect(renderer.getZone("house-a")).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });
});
```

Run: `npm test --workspace apps/web -- engineMap`
Expected: 2 passed (this exercises the real, vendored `TiledMapRenderer` — `loadWorldMap` itself, which does a real `fetch`/`Assets.load`, is covered by Task 6's component-level test instead).

- [ ] **Step 3: Typecheck and commit**

Run: `npm run --workspace apps/web typecheck`
Expected: no NEW errors introduced by this task's own files (`engineMap.ts`/`engineMap.test.ts` typecheck clean in isolation). `map.ts` still exists and is still imported by the untouched `agentSim.ts` and `WorldCanvas.tsx` at this point — that's expected, not a regression from this task.

```bash
git add apps/web/src/world/engineMap.ts apps/web/src/world/engineMap.test.ts
git commit -m "feat(world): load the Tiled map + tileset at runtime"
```

---

### Task 4: Path-following agent movement

**Files:**
- Modify: `apps/web/src/world/types.ts`
- Modify: `apps/web/src/world/agentSim.ts`
- Modify: `apps/web/src/world/agentSim.test.ts`

**Interfaces:**
- Consumes: `findPath`, `Walkable` from `./engine/pathfinding` (Task 1); `TiledMapRenderer` from `./engine/TiledMapRenderer` and `loadWorldMap`/`TILE_SIZE` from `./engineMap` (Task 3) — specifically `renderer.isWalkable`, `renderer.pixelToTile`, `renderer.tileToPixel`, `renderer.getSpawnPoint`, `renderer.width`, `renderer.height`.
- Produces (consumed by Task 6): `WorldAgent` gains `path: Array<{ x: number; y: number }>` and `pathIndex: number`. `spawnWorldAgents(agents, renderer)`, `beginMoveToRoom(agent, room, effect, renderer)` — both now take the `TiledMapRenderer` as an added final parameter. `tickAgent(agent, deltaMs)` and `settleAgent(agent)` keep their existing signatures.

- [ ] **Step 1: Extend `WorldAgent` with path-following fields**

In `apps/web/src/world/types.ts`, add two fields to the `WorldAgent` interface (after `pendingRoom`):

```ts
export interface WorldAgent {
  agentId: string;
  ownerId: string;
  name: string;
  x: number;
  y: number;
  originX: number;
  originY: number;
  targetX: number;
  targetY: number;
  facing: Facing;
  status: AgentMoveStatus;
  currentRoom: RoomId | "common";
  progress: number;
  pendingEffect: PolicyEffect | null;
  pendingRoom: RoomId | null;
  path: Array<{ x: number; y: number }>;
  pathIndex: number;
}
```

- [ ] **Step 2: Write the failing tests for waypoint-stepping**

Replace the full contents of `apps/web/src/world/agentSim.test.ts` with:

```ts
import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { Agent } from "../types";
import { TiledMapRenderer } from "./engine/TiledMapRenderer";
import type { TiledMap } from "./engine/TiledMapRenderer";
import { TILE_SIZE } from "./engineMap";
import { beginMoveToRoom, facingFromDelta, settleAgent, spawnWorldAgents, tickAgent } from "./agentSim";

const AGENT: Agent = {
  id: "agent-1",
  ownerId: "user-a",
  name: "Robot A",
  description: "",
  instructions: "",
  status: "ready",
  workspacePath: "",
  codexThreadId: null,
  lastError: null,
  createdAt: "",
  updatedAt: "",
};

// A 6x3 map: common corridor along the bottom row (y=2), a walled house-a
// room (interior at x=1..3, y=0) with a door gap at (2,1), reached only by
// walking around through the corridor — enough to force a multi-waypoint path.
function testRenderer(): TiledMapRenderer {
  const width = 6;
  const height = 3;
  const floor = new Array(width * height).fill(1);
  const collision = new Array(width * height).fill(0);
  // Wall everything on row 1 except the door gap at x=2.
  for (let x = 0; x < width; x++) {
    if (x !== 2) collision[1 * width + x] = 4;
  }
  const mapData: TiledMap = {
    width,
    height,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    tilesets: [{ firstgid: 1, columns: 5, tilewidth: TILE_SIZE, tileheight: TILE_SIZE, tilecount: 5 }],
    layers: [
      { name: "floor", type: "tilelayer", data: floor },
      { name: "collision", type: "tilelayer", data: collision },
      {
        name: "spawn-points",
        type: "objectgroup",
        objects: [
          { name: "common", x: 1 * TILE_SIZE, y: 2 * TILE_SIZE },
          { name: "house-a-door", x: 2 * TILE_SIZE, y: 1 * TILE_SIZE },
        ],
      },
      { name: "zones", type: "objectgroup", objects: [] },
    ],
  };
  return new TiledMapRenderer(mapData, [Texture.WHITE]);
}

describe("spawnWorldAgents", () => {
  it("spawns at the map's common spawn point with an empty path", () => {
    const renderer = testRenderer();
    const [agent] = spawnWorldAgents([AGENT], renderer);
    expect(agent.x).toBe(1 * TILE_SIZE);
    expect(agent.y).toBe(2 * TILE_SIZE);
    expect(agent.path).toEqual([]);
    expect(agent.pathIndex).toBe(0);
  });
});

describe("facingFromDelta", () => {
  it("picks the dominant axis", () => {
    expect(facingFromDelta(10, 1)).toBe("right");
    expect(facingFromDelta(-10, 1)).toBe("left");
    expect(facingFromDelta(1, 10)).toBe("down");
    expect(facingFromDelta(1, -10)).toBe("up");
  });
});

describe("beginMoveToRoom + tickAgent + settleAgent", () => {
  it("walks a multi-waypoint path around the wall to the door, then settles idle on permit", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    agent = beginMoveToRoom(agent, "house-a", "permit", renderer);

    expect(agent.path.length).toBeGreaterThan(2); // more than a single direct hop
    expect(agent.status).toBe("walking");

    let guard = 0;
    while (agent.status === "walking" && guard < 1000) {
      agent = settleAgent(tickAgent(agent, 50));
      guard += 1;
    }

    expect(guard).toBeLessThan(1000);
    expect(agent.status).toBe("idle");
    expect(agent.currentRoom).toBe("house-a");
    expect(agent.x).toBe(2 * TILE_SIZE);
    expect(agent.y).toBe(1 * TILE_SIZE);
  });

  it("bounces back on deny after reaching the end of the path", () => {
    const renderer = testRenderer();
    let [agent] = spawnWorldAgents([AGENT], renderer);
    agent = beginMoveToRoom(agent, "house-a", "deny", renderer);

    let guard = 0;
    while (agent.status === "walking" && guard < 1000) {
      agent = settleAgent(tickAgent(agent, 50));
      guard += 1;
    }
    expect(agent.status).toBe("denied-bounce");

    guard = 0;
    while (agent.status === "denied-bounce" && guard < 1000) {
      agent = settleAgent(tickAgent(agent, 50));
      guard += 1;
    }
    expect(agent.status).toBe("idle");
    expect(agent.currentRoom).toBe("common"); // never entered the room
  });
});
```

Run: `npm test --workspace apps/web -- agentSim`
Expected: FAIL (`spawnWorldAgents`/`beginMoveToRoom` don't accept a `renderer` argument yet, `path`/`pathIndex` don't exist).

- [ ] **Step 3: Rewrite `agentSim.ts`**

Replace the full contents of `apps/web/src/world/agentSim.ts` with:

Design note for context: `beginMoveToRoom` resolves the full BFS path once, up front, into a list of *pixel* waypoints (not tile coordinates) stored on the agent. That's what lets `tickAgent`/`settleAgent` stay renderer-free — they just walk the stored pixel list one segment at a time, exactly like the original single-segment tween, so `WorldCanvas` (Task 6) can call them every frame without holding a `TiledMapRenderer` reference.

```ts
import type { Agent, PolicyEffect } from "../types";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import { findPath } from "./engine/pathfinding";
import type { Facing, RoomId, WorldAgent } from "./types";

const MOVE_SPEED_PX_PER_MS = 0.12;

const DOOR_SPAWN_NAME: Record<RoomId, string> = {
  "house-a": "house-a-door",
  "house-b": "house-b-door",
};

export function spawnWorldAgents(agents: Agent[], renderer: TiledMapRenderer): WorldAgent[] {
  const spawnTile = renderer.getSpawnPoint("common") ?? { x: 0, y: 0 };
  return agents.map((agent) => {
    const { x, y } = renderer.tileToPixel(spawnTile.x, spawnTile.y);
    return {
      agentId: agent.id,
      ownerId: agent.ownerId,
      name: agent.name,
      x,
      y,
      originX: x,
      originY: y,
      targetX: x,
      targetY: y,
      facing: "down",
      status: "idle",
      currentRoom: "common",
      progress: 1,
      pendingEffect: null,
      pendingRoom: null,
      path: [],
      pathIndex: 0,
    };
  });
}

export function facingFromDelta(dx: number, dy: number): Facing {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

function walkableAdapter(renderer: TiledMapRenderer) {
  return {
    width: renderer.width,
    height: renderer.height,
    isWalkable: (x: number, y: number) => renderer.isWalkable(x, y),
  };
}

export function beginMoveToRoom(
  agent: WorldAgent,
  room: RoomId,
  effect: PolicyEffect,
  renderer: TiledMapRenderer,
): WorldAgent {
  const doorTile = renderer.getSpawnPoint(DOOR_SPAWN_NAME[room]) ?? { x: 0, y: 0 };
  const startTile = renderer.pixelToTile(agent.x, agent.y);
  const tileHops = findPath(walkableAdapter(renderer), startTile, doorTile) ?? [];
  const pixelWaypoints = [
    { x: agent.x, y: agent.y },
    ...tileHops.map((tile) => renderer.tileToPixel(tile.x, tile.y)),
  ];
  const first = pixelWaypoints[0];
  const next = pixelWaypoints[1] ?? first;

  return {
    ...agent,
    originX: first.x,
    originY: first.y,
    targetX: next.x,
    targetY: next.y,
    facing: facingFromDelta(next.x - first.x, next.y - first.y),
    status: "walking",
    progress: 0,
    pendingEffect: effect,
    pendingRoom: room,
    path: pixelWaypoints,
    pathIndex: 0,
  };
}

function beginDeniedBounce(agent: WorldAgent): WorldAgent {
  const dx = agent.targetX - agent.originX;
  const dy = agent.targetY - agent.originY;
  const length = Math.hypot(dx, dy) || 1;
  const bounceDistance = Math.min(length, 24);
  return {
    ...agent,
    originX: agent.x,
    originY: agent.y,
    targetX: agent.x - (dx / length) * bounceDistance,
    targetY: agent.y - (dy / length) * bounceDistance,
    facing: facingFromDelta(-dx, -dy),
    status: "denied-bounce",
    progress: 0,
    pendingEffect: null,
    pendingRoom: null,
    path: [],
    pathIndex: 0,
  };
}

export function tickAgent(agent: WorldAgent, deltaMs: number): WorldAgent {
  if (agent.progress >= 1) return agent;
  const distance = Math.hypot(agent.targetX - agent.originX, agent.targetY - agent.originY) || 1;
  const step = (MOVE_SPEED_PX_PER_MS * deltaMs) / distance;
  const progress = Math.min(1, agent.progress + step);
  return {
    ...agent,
    progress,
    x: agent.originX + (agent.targetX - agent.originX) * progress,
    y: agent.originY + (agent.targetY - agent.originY) * progress,
  };
}

export function settleAgent(agent: WorldAgent): WorldAgent {
  if (agent.progress < 1) return agent;

  if (agent.status === "walking") {
    const nextIndex = agent.pathIndex + 1;
    if (nextIndex < agent.path.length - 1) {
      const from = agent.path[nextIndex];
      const to = agent.path[nextIndex + 1];
      return {
        ...agent,
        pathIndex: nextIndex,
        originX: from.x,
        originY: from.y,
        targetX: to.x,
        targetY: to.y,
        facing: facingFromDelta(to.x - from.x, to.y - from.y),
        progress: 0,
      };
    }
    if (agent.pendingEffect === "deny") return beginDeniedBounce(agent);
    return {
      ...agent,
      status: "idle",
      currentRoom: agent.pendingRoom ?? agent.currentRoom,
      pendingEffect: null,
      pendingRoom: null,
      path: [],
      pathIndex: 0,
    };
  }
  if (agent.status === "denied-bounce") {
    return { ...agent, status: "idle" };
  }
  return agent;
}
```

Note that `tickAgent`/`settleAgent` take no `renderer` argument, matching the test file from Step 2 exactly.

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace apps/web -- agentSim`
Expected: 4 passed.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run --workspace apps/web typecheck`
Expected: errors ONLY in `WorldCanvas.tsx`, `WorldCanvas.test.tsx`, and `WorldView.tsx` — each calls `spawnWorldAgents`/`beginMoveToRoom` with the old, pre-Task-4 argument count, and none of those three files are touched by this task. That's expected (see Global Constraints): `WorldCanvas.tsx`/`WorldCanvas.test.tsx` are fixed in Task 6, `WorldView.tsx` in Task 7. If typecheck reports errors anywhere else (e.g. inside `agentSim.ts`/`types.ts`/`agentSim.test.ts` themselves), that's a real bug in this task's own code — fix it before committing.

```bash
git add apps/web/src/world/types.ts apps/web/src/world/agentSim.ts apps/web/src/world/agentSim.test.ts
git commit -m "feat(world): step agent movement through BFS waypoints"
```

---

### Task 5: Character sprite frame-grid adapter

**Files:**
- Create: `apps/web/src/world/engineCharacter.ts`
- Create: `apps/web/src/world/engineCharacter.test.ts`

**Interfaces:**
- Consumes: `Texture` from `pixi.js`.
- Produces (consumed by Task 6): `export function buildCharacterFrames(texture: Texture): Texture[][]` — a 3×3 grid (down/up/right rows, per `CharacterSprite`'s `DIRECTION_ROW`) where every cell is the same `texture`, satisfying `CharacterSprite`'s `frames[row][col]` indexing with only one real character frame available.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/world/engineCharacter.test.ts`:

```ts
import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { buildCharacterFrames } from "./engineCharacter";

describe("buildCharacterFrames", () => {
  it("returns a 3x3 grid where every cell is the given texture", () => {
    const grid = buildCharacterFrames(Texture.WHITE);
    expect(grid.length).toBe(3);
    for (const row of grid) {
      expect(row.length).toBe(3);
      for (const cell of row) {
        expect(cell).toBe(Texture.WHITE);
      }
    }
  });
});
```

Run: `npm test --workspace apps/web -- engineCharacter`
Expected: FAIL (`buildCharacterFrames` is not defined).

- [ ] **Step 2: Implement**

Create `apps/web/src/world/engineCharacter.ts`:

```ts
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
```

- [ ] **Step 3: Run the test**

Run: `npm test --workspace apps/web -- engineCharacter`
Expected: 1 passed.

- [ ] **Step 4: Typecheck and commit**

Run: `npm run --workspace apps/web typecheck`
Expected: no errors.

```bash
git add apps/web/src/world/engineCharacter.ts apps/web/src/world/engineCharacter.test.ts
git commit -m "feat(world): adapt the single character crop into CharacterSprite's frame grid"
```

---

### Task 6: Replace `WorldCanvas.tsx` with the PixiJS renderer

**Files:**
- Modify: `apps/web/src/world/WorldCanvas.tsx`
- Modify: `apps/web/src/world/WorldCanvas.test.tsx`
- Delete: `apps/web/src/world/assets.ts`
- Delete: `apps/web/src/world/assets.test.ts`
- Delete: `apps/web/src/world/map.ts`
- Delete: `apps/web/src/world/map.test.ts`

**Interfaces:**
- Consumes: `loadWorldMap` from `./engineMap` (Task 3); `tickAgent`, `settleAgent` from `./agentSim` (Task 4); `CharacterSprite` from `./engine/CharacterSprite` (Task 1); `buildCharacterFrames` from `./engineCharacter` (Task 5); `Application`, `Assets` from `pixi.js`. `WorldCanvas` receives `agents`/`onFrame` as props exactly as before — it never calls `spawnWorldAgents`/`beginMoveToRoom` itself (those are `WorldView.tsx`'s job, updated in Task 7).
- Produces: `WorldCanvasProps` unchanged (`{ agents: WorldAgent[]; onFrame: (agents: WorldAgent[]) => void }`) — `WorldView.tsx` needs no changes to this component's props for this task's sake (it still needs the Task 7 renderer-loading changes for its own call sites).

- [ ] **Step 1: Update the test to mock only the GPU-boundary pixi exports**

Replace the full contents of `apps/web/src/world/WorldCanvas.test.tsx` with:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "../types";
import type { WorldAgent } from "./types";
import { WorldCanvas } from "./WorldCanvas";

vi.mock("pixi.js", async () => {
  const actual = await vi.importActual<typeof import("pixi.js")>("pixi.js");
  return {
    ...actual,
    Application: class {
      canvas = document.createElement("canvas");
      stage = new actual.Container();
      ticker = { add: vi.fn(), remove: vi.fn() };
      async init() {}
      destroy() {}
    },
    Assets: { load: vi.fn().mockResolvedValue(actual.Texture.WHITE) },
  };
});

vi.mock("./engineMap", () => ({
  TILE_SIZE: 32,
  loadWorldMap: vi.fn().mockResolvedValue({
    width: 22,
    height: 13,
    tileSize: 32,
    getContainer: () => ({ addChild: vi.fn() }),
    getCharacterContainer: () => ({ addChild: vi.fn(), removeChild: vi.fn() }),
    getSpawnPoint: () => ({ x: 0, y: 0 }),
    tileToPixel: (x: number, y: number) => ({ x: x * 32, y: y * 32 }),
  }),
}));

const AGENT: Agent = {
  id: "agent-1",
  ownerId: "user-a",
  name: "Robot A",
  description: "",
  instructions: "",
  status: "ready",
  workspacePath: "",
  codexThreadId: null,
  lastError: null,
  createdAt: "",
  updatedAt: "",
};

function agent(overrides: Partial<WorldAgent> = {}): WorldAgent {
  return {
    agentId: AGENT.id,
    ownerId: AGENT.ownerId,
    name: AGENT.name,
    x: 0,
    y: 0,
    originX: 0,
    originY: 0,
    targetX: 0,
    targetY: 0,
    facing: "down",
    status: "idle",
    currentRoom: "common",
    progress: 1,
    pendingEffect: null,
    pendingRoom: null,
    path: [],
    pathIndex: 0,
    ...overrides,
  };
}

describe("WorldCanvas", () => {
  it("renders a canvas and reports ticked frames", async () => {
    const onFrame = vi.fn();
    const { container, unmount } = render(<WorldCanvas agents={[agent()]} onFrame={onFrame} />);

    expect(container.querySelector('[data-testid="world-canvas"]')).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onFrame).toHaveBeenCalled();
    const [firstCallArg] = onFrame.mock.calls[onFrame.mock.calls.length - 1];
    expect(firstCallArg).toHaveLength(1);

    unmount();
  });
});
```

Run: `npm test --workspace apps/web -- WorldCanvas`
Expected: FAIL (current `WorldCanvas.tsx` doesn't import `pixi.js`/`./engineMap` yet, so the mocks target nothing meaningful and the old Canvas2D component's own assertions may still pass or fail incidentally — either way, proceed to Step 2 rather than debugging the old implementation).

- [ ] **Step 2: Rewrite `WorldCanvas.tsx`**

Replace the full contents of `apps/web/src/world/WorldCanvas.tsx` with:

```tsx
import { useEffect, useRef } from "react";
import { Application, Assets } from "pixi.js";
import type { Texture } from "pixi.js";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import { CharacterSprite } from "./engine/CharacterSprite";
import { buildCharacterFrames } from "./engineCharacter";
import { loadWorldMap } from "./engineMap";
import { settleAgent, tickAgent } from "./agentSim";
import type { WorldAgent } from "./types";

export interface WorldCanvasProps {
  agents: WorldAgent[];
  onFrame: (agents: WorldAgent[]) => void;
}

const DENY_TINT = 0xc55353;
const NORMAL_TINT = 0xffffff;

export function WorldCanvas({ agents, onFrame }: WorldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const agentsRef = useRef(agents);
  const onFrameRef = useRef(onFrame);
  const spritesRef = useRef(new Map<string, CharacterSprite>());

  agentsRef.current = agents;
  onFrameRef.current = onFrame;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let app: Application | null = null;
    let renderer: TiledMapRenderer | null = null;
    let characterTexture: Texture | null = null;
    let lastTime: number | null = null;

    const tick = (time: number) => {
      if (disposed || !renderer) return;
      const last = lastTime ?? time;
      const deltaMs = time - last;
      lastTime = time;

      const next = agentsRef.current.map((agent) => settleAgent(tickAgent(agent, deltaMs)));
      onFrameRef.current(next);

      const seen = new Set<string>();
      for (const agent of next) {
        seen.add(agent.agentId);
        let sprite = spritesRef.current.get(agent.agentId);
        if (!sprite) {
          sprite = new CharacterSprite(buildCharacterFrames(characterTexture!));
          renderer.getCharacterContainer().addChild(sprite.container);
          spritesRef.current.set(agent.agentId, sprite);
        }
        sprite.setPosition(agent.x + 16, agent.y + 32);
        sprite.setAnimation(agent.status === "idle" ? "idle" : "walk", agent.facing);
        sprite.setTint(agent.status === "denied-bounce" ? DENY_TINT : NORMAL_TINT);
      }
      for (const [id, sprite] of spritesRef.current) {
        if (!seen.has(id)) {
          sprite.destroy();
          spritesRef.current.delete(id);
        }
      }

      requestAnimationFrame(tick);
    };

    (async () => {
      const [loadedRenderer, loadedCharacterTexture] = await Promise.all([
        loadWorldMap(),
        Assets.load("/world-assets/characters/default.png"),
      ]);
      if (disposed) return;

      renderer = loadedRenderer;
      characterTexture = loadedCharacterTexture;

      app = new Application();
      await app.init({
        canvas,
        width: renderer.width * renderer.tileSize,
        height: renderer.height * renderer.tileSize,
        backgroundAlpha: 0,
        antialias: false,
      });
      if (disposed) {
        app.destroy();
        return;
      }
      app.stage.addChild(renderer.getContainer());

      requestAnimationFrame(tick);
    })();

    return () => {
      disposed = true;
      for (const sprite of spritesRef.current.values()) sprite.destroy();
      spritesRef.current.clear();
      app?.destroy();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="world-canvas"
      data-testid="world-canvas"
      width={704}
      height={416}
    />
  );
}
```

- [ ] **Step 3: Run the test**

Run: `npm test --workspace apps/web -- WorldCanvas`
Expected: 1 passed.

- [ ] **Step 4: Delete the superseded `assets.ts`/`assets.test.ts` and `map.ts`/`map.test.ts`**

Run: `grep -rn "from \"./assets\"\|from \"./map\"" apps/web/src` — expect no output once `WorldCanvas.tsx` (this task) is the last file rewritten to stop importing either.

```bash
git rm apps/web/src/world/assets.ts apps/web/src/world/assets.test.ts apps/web/src/world/map.ts apps/web/src/world/map.test.ts
```

- [ ] **Step 5: Typecheck and commit**

Run: `npm run --workspace apps/web typecheck`
Expected: errors ONLY in `WorldView.tsx` (still calls `spawnWorldAgents`/`beginMoveToRoom` with the old, pre-Task-4 argument count — fixed in Task 7). If typecheck reports errors anywhere else, that's a real bug in this task's own code — fix it before committing.

```bash
git add apps/web/src/world/WorldCanvas.tsx apps/web/src/world/WorldCanvas.test.tsx
git commit -m "feat(world): render the world with PixiJS + the Tiled map"
```

---

### Task 7: Wire `WorldView.tsx` to the loaded map renderer

**Files:**
- Modify: `apps/web/src/world/WorldView.tsx`

**Interfaces:**
- Consumes: `loadWorldMap` from `./engineMap` (Task 3); `spawnWorldAgents(agents, renderer)`, `beginMoveToRoom(agent, room, effect, renderer)` — new `renderer` parameter (Task 4).

`spawnWorldAgents` and `beginMoveToRoom` gained a required `renderer: TiledMapRenderer` parameter in Task 4. `WorldView.tsx` is the only caller (confirmed: `grep -n "spawnWorldAgents\|beginMoveToRoom" apps/web/src/world/WorldView.tsx` — two call sites, at login and at room-entry). It must load the renderer once (on mount) and pass it through both call sites.

- [ ] **Step 1: Read the current call sites**

Run: `grep -n "spawnWorldAgents\|beginMoveToRoom" apps/web/src/world/WorldView.tsx`
Expected: two lines, one inside the `login` callback (`setWorldAgents(spawnWorldAgents(ownedAgents))`), one inside the room-entry callback (`beginMoveToRoom(worldAgent, room, decision.effect)`).

- [ ] **Step 2: Add renderer state, loaded once on mount**

Near the top of the `WorldView` component (alongside the existing `useState<WorldAgent[]>([])` line), add:

```ts
const [mapRenderer, setMapRenderer] = useState<TiledMapRenderer | null>(null);

useEffect(() => {
  let cancelled = false;
  loadWorldMap().then((renderer) => {
    if (!cancelled) setMapRenderer(renderer);
  });
  return () => {
    cancelled = true;
  };
}, []);
```

Add the two new imports at the top of the file:

```ts
import { loadWorldMap } from "./engineMap";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
```

(`useEffect` is very likely already imported alongside `useState` — check the existing `import { ... } from "react"` line and add `useEffect` only if it's missing.)

- [ ] **Step 3: Pass the renderer into both call sites**

Change `setWorldAgents(spawnWorldAgents(ownedAgents))` to `setWorldAgents(spawnWorldAgents(ownedAgents, mapRenderer!))`, guarding the whole login flow on `mapRenderer` being loaded — wrap the body of the `login` callback's success path so agents aren't spawned before the map exists. Locate the callback (it's an async function bound to the login form's submit) and, immediately after the successful `api.login`/`api.listAgents` calls and before calling `spawnWorldAgents`, add:

```ts
if (!mapRenderer) {
  setLoginError("World map is still loading — try again in a moment.");
  return;
}
```

(Match the existing error-state setter's name — it's whatever variable the component already uses to show a login error message; use that same setter, not a new one.)

Change `beginMoveToRoom(worldAgent, room, decision.effect)` to `beginMoveToRoom(worldAgent, room, decision.effect, mapRenderer!)`. This call site is already inside a callback that only runs after a successful login (so `mapRenderer` is guaranteed non-null there by the Step 3 guard above — login can't have succeeded without it).

- [ ] **Step 4: Disable the login button while the map is loading**

Find the login form's submit button and add `disabled={!mapRenderer}` to its existing `disabled` expression (combine with `&&`/`||` as appropriate for whatever loading condition it already checks, e.g. an in-flight login request flag).

- [ ] **Step 5: Add pixi/map mocks to `WorldView.test.tsx`**

Confirmed: `WorldView.test.tsx` renders the real `<WorldView />` (which renders the real `<WorldCanvas />` after login) and drives login through the DOM, with no mock of `pixi.js` or `./engineMap` today. Without a mock, `loadWorldMap()`'s real `fetch`/`Assets.load` calls and `WorldCanvas`'s real `Application.init()` will hang or throw in the jsdom test environment (no network server, no WebGL). Add these two `vi.mock` calls to the top of `apps/web/src/world/WorldView.test.tsx`, immediately after the existing `vi.mock("../api", ...)` block (keep that block unchanged):

```ts
vi.mock("pixi.js", async () => {
  const actual = await vi.importActual<typeof import("pixi.js")>("pixi.js");
  return {
    ...actual,
    Application: class {
      canvas = document.createElement("canvas");
      stage = new actual.Container();
      async init() {}
      destroy() {}
    },
    Assets: { load: vi.fn().mockResolvedValue(actual.Texture.WHITE) },
  };
});

vi.mock("./engineMap", async () => {
  const { TiledMapRenderer } = await import("./engine/TiledMapRenderer");
  const { Texture } = await import("pixi.js");
  const width = 6;
  const height = 3;
  const mapData = {
    width,
    height,
    tilewidth: 32,
    tileheight: 32,
    tilesets: [{ firstgid: 1, columns: 5, tilewidth: 32, tileheight: 32, tilecount: 5 }],
    layers: [
      { name: "floor", type: "tilelayer" as const, data: new Array(width * height).fill(1) },
      { name: "collision", type: "tilelayer" as const, data: new Array(width * height).fill(0) },
      {
        name: "spawn-points",
        type: "objectgroup" as const,
        objects: [
          { name: "common", x: 32, y: 32 },
          { name: "house-a-door", x: 0, y: 0 },
          { name: "house-b-door", x: 5 * 32, y: 0 },
        ],
      },
      { name: "zones", type: "objectgroup" as const, objects: [] },
    ],
  };
  const renderer = new TiledMapRenderer(mapData, [Texture.WHITE]);
  return {
    TILE_SIZE: 32,
    loadWorldMap: vi.fn().mockResolvedValue(renderer),
  };
});
```

This uses the real, vendored `TiledMapRenderer` against a small fully-walkable fixture map (this test exercises `decision.ts`'s permit/deny flow, not pathfinding around walls, so no collision data is needed) — only the two genuine GPU/network boundaries (`pixi.js`'s `Application`/`Assets`, and `engineMap.ts`'s `fetch` call) are faked.

- [ ] **Step 6: Run the full test suite**

Run: `npm test --workspace apps/web`
Expected: all tests pass, including all three `WorldView.test.tsx` cases.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run --workspace apps/web typecheck`
Expected: no errors — this is the last task with a pending cross-task call-site fix, so the project must be fully clean from here on.

```bash
git add apps/web/src/world/WorldView.tsx apps/web/src/world/WorldView.test.tsx
git commit -m "feat(world): load the Tiled map renderer once and thread it through WorldView"
```

---

### Task 8: Manual verification pass

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (from the repo root, or `npm run dev --workspace apps/web` if the root script doesn't cover it — check `package.json`'s root scripts first)
Expected: Vite dev server starts, prints a local URL.

- [ ] **Step 2: Full test suite + typecheck, one more time, clean tree**

Run: `npm run --workspace apps/web typecheck && npm test --workspace apps/web`
Expected: all green.

- [ ] **Step 3: Browser verification via Playwright MCP tools**

Navigate to the World view, log in as User A, direct an agent at its own house (expect: walks around the wall gap through the door — not a straight diagonal line through a wall — and settles inside), then at the other owner's house (expect: walks toward that door and bounces back tinted red partway there). Take screenshots at each step. Check `browser_console_messages` for errors after each action.

- [ ] **Step 4: Report findings, fix any real bugs found, re-verify**

If the manual pass surfaces a bug, fix it directly (this task has no dedicated code changes of its own — any fix belongs to whichever Task's files it touches) and re-run Steps 2-3 until clean.

---

## Self-review notes (already applied above; kept here as the record this skill's Self-Review step requires)

- **Spec coverage:** §9's four vendored modules → Task 1. Tileset/map authoring → Task 2. Runtime loading → Task 3. Path-following replacing straight-line tween → Task 4. Frame-grid adapter for the single real character texture → Task 5. Renderer swap keeping `WorldCanvas` props stable → Task 6. `WorldView.tsx` wiring → Task 7. Manual verification (the spec's existing "not testing animation pixels" testing philosophy, extended to this engine) → Task 8. No spec requirement is left uncovered.
- **Placeholder scan:** no TBD/TODO; every step carries real code or a real, runnable command.
- **Type consistency:** `spawnWorldAgents(agents, renderer)` and `beginMoveToRoom(agent, room, effect, renderer)` (Task 4) match their call sites in Task 7 exactly. `WorldAgent.path`/`pathIndex` (Task 4) are only ever read/written inside `agentSim.ts`; `WorldCanvas.tsx` (Task 6) never touches them directly — it reads `agent.x/y/facing/status` same as before. `TiledMapRenderer`/`findPath`/`CharacterSprite` signatures in Task 1 match every later task's usage of them.
