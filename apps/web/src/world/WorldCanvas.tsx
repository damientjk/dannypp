import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Text } from "pixi.js";
import type { Texture } from "pixi.js";
import type { TiledMapRenderer } from "./engine/TiledMapRenderer";
import { CharacterSprite } from "./engine/CharacterSprite";
import { buildCharacterFrames } from "./engineCharacter";
import { CHARACTER_SETS, DEFAULT_CHARACTER_SET_ID } from "./characterSets";
import type { CharacterSetId } from "./characterSets";
import { loadWorldMap } from "./engineMap";
import { advanceBehavior, settleAgent, tickAgent } from "./agentSim";
import { colorForAgent } from "./agentAppearance";
import { FILE_ROOMS } from "./resources";
import type { WorldAgent } from "./types";

const LABEL_INK = 0xf4f1e4;
const LABEL_PLATE = 0x1d2333;
/** Protected and yours. */
const OWNER_SELF = 0x6fb1e8;
/** Protected and somebody else's — same red the deny states use. */
const OWNER_OTHER = 0xe2687a;

export interface WorldCanvasProps {
  agents: WorldAgent[];
  onFrame: (agents: WorldAgent[]) => void;
  /** Freezes movement in place (sprites stay put) without tearing the loop down. */
  paused?: boolean;
  /** Signed-in human, so rooms can be drawn as "yours" or "somebody else's". */
  viewerOwnerId?: string | null;
  /** Which character sheet to render Agents with. Changing it rebuilds the
   *  Pixi application, which is why it belongs in the init effect's deps. */
  characterSetId?: CharacterSetId;
}

export function WorldCanvas({
  agents,
  onFrame,
  paused = false,
  viewerOwnerId = null,
  characterSetId = DEFAULT_CHARACTER_SET_ID,
}: WorldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const agentsRef = useRef(agents);
  const onFrameRef = useRef(onFrame);
  const pausedRef = useRef(paused);
  const spritesRef = useRef(new Map<string, CharacterSprite>());

  agentsRef.current = agents;
  onFrameRef.current = onFrame;
  pausedRef.current = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const characterSet = CHARACTER_SETS[characterSetId];

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

      const next = pausedRef.current
        ? agentsRef.current
        : agentsRef.current.map((agent) => advanceBehavior(settleAgent(tickAgent(agent, deltaMs)), renderer!));
      if (!pausedRef.current) onFrameRef.current(next);

      const seen = new Set<string>();
      for (const agent of next) {
        seen.add(agent.agentId);
        let sprite = spritesRef.current.get(agent.agentId);
        if (!sprite) {
          sprite = new CharacterSprite(buildCharacterFrames(characterTexture!, characterSet));
          renderer.getCharacterContainer().addChild(sprite.container);
          spritesRef.current.set(agent.agentId, sprite);
        }
        sprite.setPosition(agent.x + 16, agent.y + 32);
        const isMoving = agent.progress < 1;
        const anim = agent.behaviorMode === "working" ? "type" : isMoving ? "walk" : "idle";
        sprite.setAnimation(anim, agent.facing);
        // Stable per-agent colour, so several agents in one room stay
        // tellable apart and match their swatch in the side panel.
        sprite.setTint(colorForAgent(agent.agentId));
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
          Assets.load(characterSet.url),
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
          // Without these, Pixi sizes the canvas's backing store for a
          // HiDPI display but leaves its CSS box at that same pixel count,
          // so on a retina screen the map renders at 2x its intended size.
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
        });
        if (disposed) {
          app.destroy();
          return;
        }
        app.stage.addChild(renderer.getContainer());
        try {
          renderer.getContainer().addChild(buildRoomOverlay(renderer, viewerOwnerId));
        } catch (labelError) {
          // Text measurement needs a 2D canvas context. Losing the name
          // plates is cosmetic; losing the whole world is not.
          console.warn("Room overlay unavailable:", labelError);
        }

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
  }, [characterSetId]);

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

/**
 * Per-room overlay: an owner-tinted outline plus a name plate.
 *
 * The outline is what makes ownership legible on the map itself — without it
 * every protected room looks alike, and "this agent may not touch another
 * owner's room" is invisible outside the keycard panel. Blue is yours, red is
 * somebody else's, and unprotected rooms get no outline at all.
 *
 * Presentation only: nothing here gates movement or decides access.
 */
function buildRoomOverlay(
  renderer: TiledMapRenderer,
  viewerOwnerId: string | null,
): Container {
  const layer = new Container();
  layer.zIndex = 10_000;
  const tile = renderer.tileSize;

  for (const room of FILE_ROOMS) {
    const zone = renderer.getZone(room.id);
    if (!zone) continue;

    const isForeign = room.requiresPermission && room.ownerId !== viewerOwnerId;
    const accent = !room.requiresPermission
      ? null
      : isForeign
        ? OWNER_OTHER
        : OWNER_SELF;

    if (accent !== null) {
      layer.addChild(
        new Graphics()
          .rect(zone.x * tile, zone.y * tile, zone.width * tile, zone.height * tile)
          .stroke({ color: accent, width: 2, alignment: 1 }),
      );
    }

    const label = new Text({
      // Trailing slash marks the room as a folder. Whether it is protected,
      // and whose it is, is carried by the outline colour rather than a
      // second glyph on the label.
      text: `${room.displayName}/`,
      style: {
        fontFamily: "monospace",
        fontSize: 13,
        fill: accent ?? LABEL_INK,
        align: "center",
      },
    });
    label.anchor.set(0.5, 0.5);

    const centreX = (zone.x + zone.width / 2) * renderer.tileSize;
    const topY = (zone.y - 0.5) * renderer.tileSize;
    label.position.set(centreX, topY);

    const plate = new Graphics()
      .roundRect(
        centreX - label.width / 2 - 6,
        topY - label.height / 2 - 3,
        label.width + 12,
        label.height + 6,
        4,
      )
      .fill({ color: LABEL_PLATE, alpha: 0.85 });

    layer.addChild(plate, label);
  }

  return layer;
}
