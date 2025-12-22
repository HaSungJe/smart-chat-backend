import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient } from 'redis';

// 채팅방 정보(메타데이터)
// - Redis에는 roomId 목록(Set) + room 메타(String JSON) 형태로 저장
export type ChatRoom = {
  id: string;
  name: string;
  createdAt: number;
  createdByUserId: string;
  createdByNickname: string;
};

// 채팅 메시지(번역본 포함)
// - roomId 별 List에 JSON 문자열로 저장
export type ChatMessage = {
  roomId: string;
  from: {
    userId: string;
    nickname: string;
  };
  at: number;
  translations: Record<string, string>;
};

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  // 연결 재사용을 위해 단일 클라이언트를 유지
  private client: ReturnType<typeof createClient> | null = null;

  async onModuleInit() {
    await this.getClient();
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  private async getClient(): Promise<ReturnType<typeof createClient>> {
    if (this.client) return this.client;

    // 환경변수로 Redis 접속 정보를 주입할 수 있음
    // - 예: redis://127.0.0.1:6379
    const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

    const client = createClient({ url });

    client.on('error', (err) => {
      console.error('[redis] error', err);
    });

    await client.connect();
    this.client = client;
    console.log('[redis] connected', url);
    return client;
  }

  private roomsKey() {
    // 채팅방 id 목록(Set)
    return 'chat:rooms';
  }

  private roomKey(roomId: string) {
    // 채팅방 메타(String JSON)
    return `chat:room:${roomId}`;
  }

  private roomMessagesKey(roomId: string) {
    // 채팅 내역(List JSON) - 최신이 앞(0번)으로 들어감(LPUSH)
    return `chat:room:${roomId}:messages`;
  }

  async listRooms(): Promise<ChatRoom[]> {
    const client = await this.getClient();
    const roomIds = await client.sMembers(this.roomsKey());

    const rooms: ChatRoom[] = [];
    for (const id of roomIds) {
      const raw = await client.get(this.roomKey(id));
      if (!raw) continue;
      try {
        rooms.push(JSON.parse(raw) as ChatRoom);
      } catch {
        continue;
      }
    }

    rooms.sort((a, b) => a.createdAt - b.createdAt);
    return rooms;
  }

  async createRoom(input: {
    id: string;
    name: string;
    createdAt: number;
    createdByUserId: string;
    createdByNickname: string;
  }): Promise<ChatRoom> {
    const client = await this.getClient();

    const room: ChatRoom = {
      id: input.id,
      name: input.name,
      createdAt: input.createdAt,
      createdByUserId: input.createdByUserId,
      createdByNickname: input.createdByNickname,
    };

    await client.sAdd(this.roomsKey(), room.id);
    await client.set(this.roomKey(room.id), JSON.stringify(room));
    return room;
  }

  async addMessage(roomId: string, message: ChatMessage): Promise<void> {
    const client = await this.getClient();
    const key = this.roomMessagesKey(roomId);
    // 채팅 히스토리 보관 개수(기본 200)
    const limit = Number(process.env.CHAT_HISTORY_LIMIT) || 200;

    await client.lPush(key, JSON.stringify(message));
    // 0..limit-1 구간만 유지
    await client.lTrim(key, 0, Math.max(0, limit - 1));
  }

  async getMessages(roomId: string, limit = 50): Promise<ChatMessage[]> {
    const client = await this.getClient();
    const key = this.roomMessagesKey(roomId);

    // 최신이 앞(0번)이므로, 반환 시에는 오래된 -> 최신 순으로 정렬해서 내려줌
    const rawList = await client.lRange(key, 0, Math.max(0, limit - 1));
    const parsed: ChatMessage[] = [];

    for (const raw of rawList) {
      try {
        parsed.push(JSON.parse(raw) as ChatMessage);
      } catch {
        continue;
      }
    }

    parsed.reverse();
    return parsed;
  }
}
