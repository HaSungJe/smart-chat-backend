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
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return;

    this.server.emit('chat:message', {
      from: client.id,
      text,
      at: Date.now(),
    });
  }
}
