// apps/web/src/world/roomDecor.ts
// Types + loader for room-decor.json (see apps/web/scripts/generate-room-decor.py),
// the freeform pixel-positioned furniture/equipment manifest. Mirrors
// engineMap.ts's loadWorldMap fetch pattern.

export interface DecorEntry {
  /** Path relative to /world-assets/, e.g. "decor/auth-module/bookshelf.png". */
  image: string;
  x: number;
  y: number;
}

export interface EquipmentEntry {
  /** Path relative to /world-assets/, under equipment/. */
  image: string;
  /** Frame count in row 0 of the spritesheet (see EquipmentSprite). */
  frames: number;
  x: number;
  y: number;
  /** desk-<room>-N spawn point this prop's animation is gated on, matching
   *  WorldAgent.occupiedDeskId -- or null for a prop that just animates
   *  continuously regardless of occupancy (e.g. an ambient candle). */
  spawnPoint: string | null;
}

export interface RoomDecor {
  decor: DecorEntry[];
  equipment: EquipmentEntry[];
}

export async function loadRoomDecor(): Promise<RoomDecor> {
  const res = await fetch("/world-assets/room-decor.json");
  return res.json() as Promise<RoomDecor>;
}
