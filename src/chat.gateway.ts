import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import translate from 'translate';
import { RedisService } from './redis.service';

// Socket 연결정보
const socketGatewaySetting: Record<string, any> ={
  cors: {
    origin: '*',
    credentials: false,
  },
  namespace: '/chat',
}

// 번역 엔진 선택(현재 google)
// - translate 패키지는 엔진별로 동작/제약이 다를 수 있음
// - 여기서는 google 엔진을 사용
translate.engine = 'google';

// 번역 대상 언어(현재는 3개만 사용)
// - 클라이언트(chat-test.html)의 select 옵션과 맞춰야 함
type SupportedLanguage = 'ko' | 'ja' | 'en';

// 원문 언어를 간단히 추정하는 함수
// - 정확한 언어 감지기가 아니라 "문자 범위" 기반 휴리스틱
// - 원문 언어를 추정해서, 같은 언어로 재번역(ko->ko 등)으로 인한 원문 변형을 방지
function detectLanguage(text: string): SupportedLanguage {
  if (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(text)) { // Hangul syllables/jamo
    return 'ko';
  } else if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) { // Hiragana/Katakana (common Japanese)
    return 'ja';
  } else { // Fallback
    return 'en';
  }
}

// 원문 1개를 ko/ja/en 3개로 번역해서 반환
// - 원문 언어(from)는 detectLanguage()로 추정
// - from 언어는 원문 그대로 유지
// - 나머지 언어만 번역 시도(실패 시 원문 fallback)
async function translateToMultipleLanguages(text: string): Promise<Record<SupportedLanguage, string>> {
  const targetLanguages: SupportedLanguage[] = ['ko', 'ja', 'en'];
  const translations = {} as Record<SupportedLanguage, string>;
  const from = detectLanguage(text);

  // 원문 언어는 절대 변형하지 않고 그대로 보관
  translations[from] = text;

  for (const lang of targetLanguages) {
    if (lang !== from) {
      try {
        const translated = await translate(text, {
          // from을 명시해 번역 엔진이 더 안정적으로 동작하도록 유도
          from,
          to: lang,
        });
        translations[lang] = typeof translated === 'string' ? translated : String(translated);
      } catch (error) {
        // 번역 실패 시 원문 fallback
        console.error(`Translation to ${lang} failed:`, error);
        translations[lang] = text;
      }
    }
  }

  return translations;
}

// Socket.IO 기반 WebSocket 게이트웨이
// - namespace: 클라이언트는 http://<host>:<port>/chat 로 접속해야 함
// - cors: 개발 편의상 모든 origin 허용(운영에서는 특정 도메인으로 제한 권장)
@WebSocketGateway(socketGatewaySetting)
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  // Socket.IO 서버 인스턴스
  // - 전체 브로드캐스트/룸 전송 등 서버 주도 이벤트를 보낼 때 사용
  @WebSocketServer()
  server: Server;

  // socket.id -> { userId, nickname, roomId }
  // - userId/nickname은 클라이언트 socket 연결 시 auth로 전달됨(chat-test.html)
  // - roomId는 가장 최근 join한 방 1개만 추적(간단한 UX 가정)
  private readonly sessions = new Map<string, { userId: string; nickname: string; roomId: string | null }>();

  // Redis에 방 목록/메타/메시지를 저장/조회하기 위한 서비스
  constructor(private readonly redisService: RedisService) {}

  // 클라이언트가 네임스페이스(/chat)에 연결되면 자동 호출
  async handleConnection(client: Socket) {
    // 핸드셰이크 정보(추적/디버깅용)
    const userAgent = client.handshake.headers['user-agent'];
    const ip = client.handshake.address;

    // Socket.IO auth payload
    // - chat-test.html에서 io(url, { auth: { userId, nickname } }) 형태로 전달
    const auth = (client.handshake as any)?.auth as { userId?: unknown; nickname?: unknown } | undefined;
    const userId = typeof auth?.userId === 'string' && auth.userId.trim() ? auth.userId.trim() : client.id;
    const nickname = typeof auth?.nickname === 'string' && auth.nickname.trim() ? auth.nickname.trim() : 'anonymous';

    this.sessions.set(client.id, { userId, nickname, roomId: null });

    console.log(`[ws] connected id=${client.id} ip=${ip} ua=${typeof userAgent === 'string' ? userAgent : ''}`);

    // 연결 완료를 클라이언트에게 알려줌(초기 핸드셰이크 확인용)
    client.emit('connected', { id: client.id, userId, nickname });

    // 연결 직후 방 목록을 push 해줘서, 클라이언트가 바로 방을 선택/입장할 수 있도록 함
    try {
      const rooms = await this.redisService.listRooms();
      client.emit('room:list:update', { rooms });
    } catch (e) {
      console.error(e);
    }
  }

  // 클라이언트 연결이 끊기면 자동 호출(탭 닫기/네트워크 끊김 등)
  handleDisconnect(client: Socket) {
    console.log(`[ws] disconnected id=${client.id}`);
    this.sessions.delete(client.id);
  }

  // 클라이언트가 'ping' 이벤트를 보내면 호출됨(연결 테스트/왕복 확인용)
  @SubscribeMessage('ping')
  onPing(@MessageBody() body: unknown, @ConnectedSocket() client: Socket) {
    // 클라이언트에게 'pong'으로 응답(보낸 payload를 echo)
    client.emit('pong', { at: Date.now(), echo: body ?? null });
  }

  @SubscribeMessage('room:list')
  async onRoomList(@ConnectedSocket() client: Socket): Promise<void> {
    // 클라이언트가 현재 방 목록을 요청
    const rooms = await this.redisService.listRooms();
    client.emit('room:list:result', { rooms });
  }

  @SubscribeMessage('room:create')
  async onRoomCreate(
    @MessageBody() body: { name?: unknown },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    // 새 채팅방 생성 -> Redis 저장 -> 전체에게 방 목록 업데이트
    const session = this.sessions.get(client.id);
    if (!session) return;

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return;

    const id = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const room = await this.redisService.createRoom({
      id,
      name,
      createdAt: Date.now(),
      createdByUserId: session.userId,
      createdByNickname: session.nickname,
    });

    client.emit('room:create:result', { room });
    const rooms = await this.redisService.listRooms();
    this.server.emit('room:list:update', { rooms });
  }

  @SubscribeMessage('room:join')
  async onRoomJoin(
    @MessageBody() body: { roomId?: unknown },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    // 채팅방 입장
    // - socket.io room join
    // - Redis에서 해당 room의 채팅 히스토리를 로드해서 클라이언트에게 전달
    const session = this.sessions.get(client.id);
    if (!session) return;

    const roomId = typeof body?.roomId === 'string' ? body.roomId.trim() : '';
    if (!roomId) return;

    if (session.roomId && session.roomId !== roomId) {
      client.leave(session.roomId);
    }

    client.join(roomId);
    session.roomId = roomId;

    const rooms = await this.redisService.listRooms();
    const room = rooms.find((r) => r.id === roomId) ?? null;
    const messages = await this.redisService.getMessages(roomId);

    client.emit('room:join:result', { room, roomId, messages });
  }

  // 클라이언트가 채팅 메시지를 보낼 때 호출됨
  // - client.emit('chat:send', { text: 'hi' })
  // - 반드시 room join 후에만 처리됨
  // - 서버는 해당 room에만 'chat:message'로 브로드캐스트
  // - 메시지는 Redis에 저장됨
  @SubscribeMessage('chat:send')
  async onChatSend(@MessageBody() body: { text?: unknown }, @ConnectedSocket() client: Socket): Promise<void> {
    // 안전한 payload 파싱(문자열이 아니면 무시)
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return;

    const session = this.sessions.get(client.id);
    if (!session || !session.roomId) return;

    const translations = await translateToMultipleLanguages(text);

    const message = {
      roomId: session.roomId,
      from: { userId: session.userId, nickname: session.nickname },
      at: Date.now(),
      translations,
    };

    await this.redisService.addMessage(session.roomId, message);

    this.server.to(session.roomId).emit('chat:message', message);
  }
}
