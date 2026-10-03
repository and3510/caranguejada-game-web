import type { ErrorCode, MapKind } from '@caranguejada/shared';
import { Room } from './game/Room';
import type { Logger } from './logger';

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly maxRooms: number,
    private readonly log: Logger,
  ) {}

  create(code: string, rounds?: number, maps?: MapKind[]): Room | { error: ErrorCode } {
    if (this.rooms.has(code)) return { error: 'room_exists' };
    if (this.rooms.size >= this.maxRooms) return { error: 'server_full' };
    const room = new Room(code, this.log);
    if (rounds !== undefined) room.setRounds(rounds);
    if (maps !== undefined) room.setMaps(maps);
    this.rooms.set(code, room);
    this.log.info('room_created', { room: code });
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** Avança todas as salas e remove as que ficaram sem humanos. */
  tick(dt: number): void {
    for (const [code, room] of this.rooms) {
      if (room.isEmpty()) {
        this.rooms.delete(code);
        this.log.info('room_closed', { room: code });
        continue;
      }
      room.tick(dt);
    }
  }

  stats(): { rooms: number; players: number; humans: number; playing: number } {
    let players = 0;
    let humans = 0;
    let playing = 0;
    for (const room of this.rooms.values()) {
      players += room.size;
      humans += room.humanCount;
      if (room.currentPhase !== 'lobby' && room.currentPhase !== 'matchEnd') playing++;
    }
    return { rooms: this.rooms.size, players, humans, playing };
  }

  closeAll(reason: string): void {
    for (const room of this.rooms.values()) room.closeAll(1001, reason);
    this.rooms.clear();
  }
}
