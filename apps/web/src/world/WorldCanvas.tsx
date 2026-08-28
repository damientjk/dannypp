import { useEffect, useRef } from "react";
import { ROOMS, TILE_SIZE, WORLD_HEIGHT_TILES, WORLD_WIDTH_TILES } from "./map";
import type { RoomBounds } from "./map";
import { settleAgent, tickAgent } from "./agentSim";
import { loadAsset } from "./assets";
import type { AssetKey } from "./assets";
import type { WorldAgent } from "./types";

export interface WorldCanvasProps {
  agents: WorldAgent[];
  onFrame: (agents: WorldAgent[]) => void;
}

const ROOM_COLORS: Record<string, string> = {
  common: "#d8d3c4",
  "house-a": "#c9e4de",
  "house-b": "#f6dfeb",
};

const ROOM_ASSET_KEYS: Record<RoomBounds["id"], AssetKey> = {
  common: "room.common.floor",
  "house-a": "room.house-a.floor",
  "house-b": "room.house-b.floor",
};

const AGENT_COLORS: Record<WorldAgent["status"], string> = {
  idle: "#6954d9",
  walking: "#6954d9",
  "denied-bounce": "#c55353",
};

export function WorldCanvas({ agents, onFrame }: WorldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const agentsRef = useRef(agents);
  const onFrameRef = useRef(onFrame);
  const lastTimeRef = useRef<number | null>(null);
  const frameIdRef = useRef(0);
  const patternCacheRef = useRef(new Map<HTMLImageElement, CanvasPattern>());

  agentsRef.current = agents;
  onFrameRef.current = onFrame;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // keep scaled pixel art crisp instead of browser-smoothed
    ctx.imageSmoothingEnabled = false;

    const step = (time: number) => {
      const last = lastTimeRef.current ?? time;
      const deltaMs = time - last;
      lastTimeRef.current = time;

      const next = agentsRef.current.map((agent) => settleAgent(tickAgent(agent, deltaMs)));
      onFrameRef.current(next);

      const drawFloor = (px: number, py: number, pw: number, ph: number, assetKey: AssetKey, fallbackColor: string) => {
        const floorImage = loadAsset(assetKey);
        if (floorImage) {
          let pattern = patternCacheRef.current.get(floorImage);
          if (!pattern) {
            const created = ctx.createPattern(floorImage, "repeat");
            if (created) {
              patternCacheRef.current.set(floorImage, created);
              pattern = created;
            }
          }
          if (pattern) {
            ctx.save();
            ctx.translate(px, py);
            ctx.fillStyle = pattern;
            ctx.fillRect(0, 0, pw, ph);
            ctx.restore();
          } else {
            ctx.drawImage(floorImage, px, py, pw, ph);
          }
        } else {
          ctx.fillStyle = fallbackColor;
          ctx.fillRect(px, py, pw, ph);
        }
      };

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // full-bleed ground first, so there's no gap between rooms showing
      // the page background through
      drawFloor(0, 0, canvas.width, canvas.height, ROOM_ASSET_KEYS.common, ROOM_COLORS.common);
      for (const room of ROOMS) {
        const px = room.x * TILE_SIZE;
        const py = room.y * TILE_SIZE;
        const pw = room.width * TILE_SIZE;
        const ph = room.height * TILE_SIZE;
        drawFloor(px, py, pw, ph, ROOM_ASSET_KEYS[room.id], ROOM_COLORS[room.id] ?? "#cccccc");
      }
      const characterImage = loadAsset("character.default");
      for (const agent of next) {
        if (characterImage) {
          ctx.drawImage(characterImage, agent.x, agent.y, TILE_SIZE, TILE_SIZE);
        } else {
          ctx.fillStyle = AGENT_COLORS[agent.status];
          ctx.beginPath();
          ctx.arc(agent.x + TILE_SIZE / 2, agent.y + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      frameIdRef.current = requestAnimationFrame(step);
    };

    frameIdRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameIdRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={WORLD_WIDTH_TILES * TILE_SIZE}
      height={WORLD_HEIGHT_TILES * TILE_SIZE}
      className="world-canvas"
      data-testid="world-canvas"
    />
  );
}
