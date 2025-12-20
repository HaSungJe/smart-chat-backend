import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import translate from 'translate';

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
  // Hangul syllables/jamo
  if (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(text)) return 'ko';
  // Hiragana/Katakana (common Japanese)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja';
  // Fallback
  return 'en';
}

// 원문 1개를 ko/ja/en 3개로 번역해서 반환
// - 원문 언어(from)는 detectLanguage()로 추정
// - from 언어는 원문 그대로 유지
// - 나머지 언어만 번역 시도(실패 시 원문 fallback)
async function translateToMultipleLanguages(text: string): Promise<
  Record<SupportedLanguage, string>
> {
  const targetLanguages: SupportedLanguage[] = ['ko', 'ja', 'en'];
  const translations = {} as Record<SupportedLanguage, string>;

  const from = detectLanguage(text);
  // 원문 언어는 절대 변형하지 않고 그대로 보관
  translations[from] = text;

  for (const lang of targetLanguages) {
    // 같은 언어로의 번역은 스킵(원문 변형/오번역 방지)
    if (lang === from) continue;
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

  return translations;
}

// Socket.IO 기반 WebSocket 게이트웨이
// - namespace: 클라이언트는 http://<host>:<port>/chat 로 접속해야 함
// - cors: 개발 편의상 모든 origin 허용(운영에서는 특정 도메인으로 제한 권장)
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: false,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  // Socket.IO 서버 인스턴스
  // - 전체 브로드캐스트/룸 전송 등 서버 주도 이벤트를 보낼 때 사용
  @WebSocketServer()
  server: Server;

  // 클라이언트가 네임스페이스(/chat)에 연결되면 자동 호출
  handleConnection(client: Socket) {
    // 핸드셰이크 정보(추적/디버깅용)
    const userAgent = client.handshake.headers['user-agent'];
    const ip = client.handshake.address;

    console.log(
      `[ws] connected id=${client.id} ip=${ip} ua=${typeof userAgent === 'string' ? userAgent : ''}`,
    );

    // 연결 완료를 클라이언트에게 알려줌(초기 핸드셰이크 확인용)
    client.emit('connected', { id: client.id });
  }

  // 클라이언트 연결이 끊기면 자동 호출(탭 닫기/네트워크 끊김 등)
  handleDisconnect(client: Socket) {
    console.log(`[ws] disconnected id=${client.id}`);
  }

  // 클라이언트가 'ping' 이벤트를 보내면 호출됨(연결 테스트/왕복 확인용)
  @SubscribeMessage('ping')
  onPing(@MessageBody() body: unknown, @ConnectedSocket() client: Socket) {
    // 클라이언트에게 'pong'으로 응답(보낸 payload를 echo)
    client.emit('pong', { at: Date.now(), echo: body ?? null });
  }

  // 클라이언트가 채팅 메시지를 보낼 때 호출됨
  // - client.emit('chat:send', { text: 'hi' })
  // - 서버는 전체에게 'chat:message'로 브로드캐스트
  @SubscribeMessage('chat:send')
  onChatSend(
    @MessageBody() body: { text?: unknown },
    @ConnectedSocket() client: Socket,
  ) {
    // 안전한 payload 파싱(문자열이 아니면 무시)
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return;

    void (async () => {
      // 서버에서 ko/ja/en 번역을 모두 생성
      const translations = await translateToMultipleLanguages(text);

      // 모든 클라이언트에게 번역본 포함 payload 브로드캐스트
      // - chat-test.html은 selectbox에서 고른 언어만 화면에 표시
      this.server.emit('chat:message', {
        from: client.id,
        at: Date.now(),
        translations,
      });
    })();
  }
}
