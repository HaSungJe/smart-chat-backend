# Smart Chat Socket

Socket.IO 기반의 간단한 채팅 백엔드입니다.

- **Redis**에 채팅방/메시지 히스토리를 저장합니다.
- 전송된 메시지를 **ko/ja/en** 3개 언어로 번역해 함께 브로드캐스트합니다.
- 브라우저에서 바로 열어 테스트할 수 있는 `chat-test.html`이 포함되어 있습니다.

## Features

- **Room 기반 채팅**
- **채팅 히스토리 저장/조회**(Redis List)
- **자동 번역(ko/ja/en)**
- **Socket.IO namespace**: `/chat`

## Tech Stack

- NestJS(WebSocketGateway)
- Socket.IO
- Redis
- `translate` 패키지(현재 `google` 엔진 설정)

## Prerequisites

- Node.js (권장: LTS)
- Redis (로컬 설치 또는 Docker)
- Docker (선택: `redis.yml` 사용 시)

## Project setup

```bash
$ npm install
```

## Run

### 1) Redis 실행

이 프로젝트는 기본적으로 `redis://127.0.0.1:6379`에 연결합니다.

- Docker 사용 시

```bash
docker compose -f redis.yml up -d redis
```

- 로컬 Redis를 직접 띄우는 경우에는 `REDIS_URL`을 맞춰주세요.

### 2) 서버 실행(Watch)

```bash
npm run dev
```

위 명령은 내부적으로 Redis 컨테이너를 올리고(`redis.yml`) Nest를 watch 모드로 실행합니다.

### 3) 프로덕션 실행

```bash
npm run build
npm run start:prod
```

## Environment Variables

`.env`는 필수가 아니며, 아래 환경변수들을 사용합니다.

```bash
# 서버 포트 (기본 3000)
PORT=3000

# Redis 접속 URL (기본 redis://127.0.0.1:6379)
REDIS_URL=redis://127.0.0.1:6379

# room 별 메시지 히스토리 보관 개수 (기본 200)
CHAT_HISTORY_LIMIT=200
```

## Test Client (chat-test.html)

`chat-test.html`을 브라우저로 열어 Socket.IO 연결/이벤트를 바로 테스트할 수 있습니다.

- 서버 실행 후
- 브라우저에서 `chat-test.html` 파일을 열고
- **서버 URL(namespace 포함)**에 `http://127.0.0.1:3000/chat` 입력
- 닉네임 입력 후 Connect
- 채팅방 생성/입장 후 메시지 전송

## Socket API

이 서버는 Socket.IO namespace `/chat`로 동작합니다.

### Client -> Server

- `ping`
  - payload: `any`
- `room:list`
  - payload: 없음
- `room:create`
  - payload: `{ name: string }`
- `room:join`
  - payload: `{ roomId: string }`
- `chat:send`
  - payload: `{ text: string }`

### Server -> Client

- `connected`
  - payload: `{ id: string, userId: string, nickname: string }`
- `pong`
  - payload: `{ at: number, echo: any }`
- `room:list:update`
  - payload: `{ rooms: { id: string, name: string, createdAt: number, createdByUserId: string, createdByNickname: string }[] }`
- `room:list:result`
  - payload: 위와 동일
- `room:create:result`
  - payload: `{ room: { id: string, name: string, createdAt: number, createdByUserId: string, createdByNickname: string } }`
- `room:join:result`
  - payload: `{ room: object | null, roomId: string, messages: ChatMessage[] }`
- `chat:message`
  - payload: `ChatMessage`

`ChatMessage`는 다음 형태입니다.

```json
{
  "roomId": "...",
  "from": { "userId": "...", "nickname": "..." },
  "at": 1730000000000,
  "translations": { "ko": "...", "ja": "...", "en": "..." }
}
```

## Redis Data Model

- `chat:rooms`
  - 채팅방 id 목록(Set)
- `chat:room:{roomId}`
  - 채팅방 메타데이터(String JSON)
- `chat:room:{roomId}:messages`
  - 메시지 히스토리(List JSON)
  - 서버는 `LPUSH`로 최신을 앞에 넣고, 조회 시 오래된 -> 최신 순으로 뒤집어 반환합니다.

## Notes

- 번역은 `translate` 패키지의 `google` 엔진을 사용합니다. 환경/네트워크에 따라 속도/정확도/제한이 있을 수 있으며, 실패 시 원문으로 fallback 합니다.
- CORS는 개발 편의상 `origin: '*'`로 열려 있습니다. 운영에서는 제한을 권장합니다.
- 이 프로젝트는 GPT-5.2와 Claude Sonnet 4.5를 활용해 바이브코딩으로 작성/개선되었습니다.

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
