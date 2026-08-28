import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Text } from "pixi.js";
import type { Texture } from "pixi.js";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import { Camera } from "./engine/Camera";
import { CharacterSprite } from "./engine/CharacterSprite";
import { buildCharacterFrames } from "./engineCharacter";
import { stepWorld } from "./agentSim";
import { colorForAgent } from "./agentAppearance";
import type { FolderRoom } from "./folders";
import type { WorldAgent } from "./types";

export interface WorldCanvasProps {
  /** Loaded once by the parent and shared, so the sim and the view agree. */
  renderer: TiledMapRenderer;
  rooms: readonly FolderRoom[];
  agents: WorldAgent[];
  onFrame: (agents: WorldAgent[]) => void;
}

const DENY_TINT = 0xc55353;
const LABEL_COLOR = 0xf4f1e4;
const LABEL_PLATE = 0x1d2333;

export function WorldCanvas({ renderer, rooms, agents, onFrame }: WorldCanvasProps) {
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
    let characterTexture: Texture | null = null;
    let lastTime: number | null = null;

    const tick = (time: number) => {
      if (disposed) return;
      const last = lastTime ?? time;
      const deltaMs = time - last;
      lastTime = time;

      // Resolved against shared occupancy, so agents block each other instead
      // of walking through one another.
      const next = stepWorld(agentsRef.current, deltaMs, renderer);
      onFrameRef.current(next);

      const seen = new Set<string>();
      for (const agent of next) {
        seen.add(agent.agentId);
        let sprite = spritesRef.current.get(agent.agentId);
        if (!sprite) {
          sprite = new CharacterSprite(buildCharacterFrames(characterTexture!));
          const characters = renderer.getCharacterContainer();
          // Depth-sort by screen row so an agent standing lower overlaps one
          // standing higher, instead of the draw order being insertion order.
          characters.sortableChildren = true;
          characters.addChild(sprite.container);
          spritesRef.current.set(agent.agentId, sprite);
        }
        sprite.container.zIndex = agent.y;
        sprite.setPosition(agent.x + 16, agent.y + 32);
        sprite.setAnimation(agent.status === "walking" ? "walk" : "idle", agent.facing);
        // Each agent keeps its own colour so several in one room stay tellable
        // apart; a denial temporarily overrides it with the red flash.
        sprite.setTint(
          agent.status === "denied-bounce" ? DENY_TINT : colorForAgent(agent.agentId),
        );
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
      try {
        characterTexture = await Assets.load("/world-assets/characters/default.png");
        if (disposed) return;

        app = new Application();
        await app.init({
          canvas,
          width: canvas.width,
          height: canvas.height,
          backgroundAlpha: 0,
          antialias: false,
        });
        if (disposed) {
          app.destroy();
          return;
        }
        app.stage.addChild(renderer.getContainer());
        try {
          renderer.getContainer().addChild(buildRoomLabels(renderer, rooms));
        } catch (labelError) {
          // Text measurement depends on a 2D canvas context. Losing the name
          // plates is a cosmetic loss; losing the whole world is not.
          console.warn("Room labels unavailable:", labelError);
        }

        // Overview framing, not a follow-cam: every agent has to stay on
        // screen at once, so the whole map is scaled to fit. As folders are
        // added and the map grows, this scales down rather than cropping.
        camera(renderer, canvas).fitToScreen();

        requestAnimationFrame(tick);
      } catch (err) {
        console.error("WorldCanvas failed to initialize:", err);
      }
    })();

    return () => {
      disposed = true;
      for (const sprite of spritesRef.current.values()) sprite.destroy();
      spritesRef.current.clear();
      app?.destroy();
    };
  }, [renderer, rooms]);

  return (
    <canvas
      ref={canvasRef}
      className="world-canvas"
      data-testid="world-canvas"
      width={renderer.width * renderer.tileSize}
      height={renderer.height * renderer.tileSize}
    />
  );
}

function camera(renderer: TiledMapRenderer, canvas: HTMLCanvasElement): Camera {
  return new Camera(
    renderer.getContainer(),
    { width: canvas.width, height: canvas.height },
    {
      width: renderer.width * renderer.tileSize,
      height: renderer.height * renderer.tileSize,
    },
  );
}

/**
 * A name plate over each room. Labels live inside the world container so they
 * scale and sit with the map rather than floating over it in screen space.
 */
function buildRoomLabels(
  renderer: TiledMapRenderer,
  rooms: readonly FolderRoom[],
): Container {
  const layer = new Container();
  layer.zIndex = 10_000;

  for (const room of rooms) {
    const zone = renderer.getZone(room.id);
    if (!zone) continue;

    const label = new Text({
      text: room.label,
      style: {
        fontFamily: "monospace",
        fontSize: 13,
        fill: LABEL_COLOR,
        align: "center",
      },
    });
    label.anchor.set(0.5, 0.5);

    const centreX = (zone.x + zone.width / 2) * renderer.tileSize;
    const topY = (zone.y - 0.5) * renderer.tileSize;

    const plate = new Graphics()
      .roundRect(
        centreX - label.width / 2 - 6,
        topY - label.height / 2 - 3,
        label.width + 12,
        label.height + 6,
        4,
      )
      .fill({ color: LABEL_PLATE, alpha: 0.85 });

    label.position.set(centreX, topY);
    layer.addChild(plate, label);
  }

  return layer;
}
