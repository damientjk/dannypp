import { useEffect, useRef } from "react";
import { Application, Assets } from "pixi.js";
import type { Texture } from "pixi.js";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import { CharacterSprite } from "./engine/CharacterSprite";
import { buildCharacterFrames } from "./engineCharacter";
import { loadWorldMap } from "./engineMap";
import { advanceBehavior, settleAgent, tickAgent } from "./agentSim";
import type { WorldAgent } from "./types";

export interface WorldCanvasProps {
  agents: WorldAgent[];
  onFrame: (agents: WorldAgent[]) => void;
}

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

      const next = agentsRef.current.map((agent) =>
        advanceBehavior(settleAgent(tickAgent(agent, deltaMs)), renderer!),
      );
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
        const isMoving = agent.progress < 1;
        const anim = agent.behaviorMode === "working" ? "type" : isMoving ? "walk" : "idle";
        sprite.setAnimation(anim, agent.facing);
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
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="world-canvas"
      data-testid="world-canvas"
      width={1120}
      height={640}
    />
  );
}
