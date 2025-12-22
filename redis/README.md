# Redis 설정 및 사용 가이드

## 폴더 구조
- `redis/redis.conf`: Redis 서버 설정 파일
- `redis.yml`: Docker Compose 설정 (프로젝트 루트에 위치)
- `redis/data/`: Redis 데이터 영속성 볼륨 (자동 생성)

## 실행 방법

### 1. Redis 시작
```bash
docker compose -f redis.yml up -d
```

### 2. Redis 상태 확인
```bash
docker compose -f redis.yml ps
docker compose -f redis.yml logs redis
```

### 3. Redis 중지
```bash
docker compose -f redis.yml down
```

### 4. Redis 재시작
```bash
docker compose -f redis.yml restart
```

## Redis CLI 접속

### Docker를 통한 접속
```bash
docker exec -it project-redis redis-cli
```

### 기본 명령어 테스트
```redis
# 연결 테스트
ping
# PONG

# 데이터 저장
set mykey "Hello Redis"
# OK

# 데이터 조회
get mykey
# "Hello Redis"

# 모든 키 조회
keys *

# 종료
exit
```

## Node.js에서 사용하기

### 설치
```bash
npm install redis
```

### 기본 사용법
```javascript
const redis = require('redis');

async function connectRedis() {
  const client = redis.createClient({
    socket: {
      host: 'localhost',
      port: 6379
    }
  });

  client.on('error', (err) => console.error('Redis Error:', err));
  client.on('connect', () => console.log('✅ Redis 연결됨'));
  
  await client.connect();
  return client;
}

// 사용 예시
async function example() {
  const client = await connectRedis();
  
  // 데이터 저장
  await client.set('user:1', JSON.stringify({ name: 'John', age: 30 }));
  
  // 데이터 조회
  const data = await client.get('user:1');
  console.log(JSON.parse(data));
  
  await client.disconnect();
}
```

### Socket.IO Adapter와 함께 사용
```javascript
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const redis = require('redis');

const io = new Server(3000);

const pubClient = redis.createClient({ 
  socket: { host: 'localhost', port: 6379 }
});
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
  console.log('✅ Redis Adapter 연결됨');
});
```

## 설정 변경

### redis.conf 주요 설정

#### 메모리 제한 변경
```conf
maxmemory 512mb  # 기본값: 256mb
```

#### 비밀번호 설정 (운영 환경)
```conf
requirepass your_strong_password
```

비밀번호 설정 시 Node.js 연결:
```javascript
const client = redis.createClient({
  socket: { host: 'localhost', port: 6379 },
  password: 'your_strong_password'
});
```

#### 데이터 저장 정책
```conf
# RDB 스냅샷 (기본)
save 900 1
save 300 10
save 60 10000

# AOF (Append Only File) - 더 안전
appendonly yes
appendfsync everysec
```

### 설정 변경 후 재시작
```bash
docker compose -f redis.yml restart
```

## 데이터 관리

### 데이터 백업
```bash
# redis/data 폴더를 복사하여 백업
cp -r redis/data redis/data_backup_$(date +%Y%m%d)
```

### 데이터 초기화
```bash
# 주의: 모든 데이터가 삭제됩니다!
docker compose -f redis.yml down
rm -rf redis/data/*
docker compose -f redis.yml up -d
```

### 데이터 확인
```bash
# Redis CLI로 접속
docker exec -it project-redis redis-cli

# 데이터베이스 크기 확인
DBSIZE

# 메모리 사용량 확인
INFO memory

# 모든 키 확인
KEYS *
```

## 모니터링

### 실시간 명령어 모니터링
```bash
docker exec -it project-redis redis-cli MONITOR
```

### 로그 확인
```bash
docker compose -f redis.yml logs -f redis
```

### 성능 정보
```bash
docker exec -it project-redis redis-cli INFO
```

## 문제 해결

### 포트 충돌
다른 프로그램이 6379 포트를 사용 중이면:
```yaml
# redis.yml에서 포트 변경
ports:
  - "6380:6379"  # 호스트 포트를 6380으로 변경
```

### 권한 문제 (Linux/WSL)
```bash
sudo chown -R 999:999 redis/data/
```

### 연결 실패
1. Redis 컨테이너 실행 확인: `docker compose -f redis.yml ps`
2. 로그 확인: `docker compose -f redis.yml logs redis`
3. 방화벽 확인
4. Redis CLI 직접 테스트: `docker exec -it project-redis redis-cli ping`

## 참고 자료

- [Redis 공식 문서](https://redis.io/docs/)
- [Redis 명령어 레퍼런스](https://redis.io/commands/)
- [Socket.IO Redis Adapter](https://socket.io/docs/v4/redis-adapter/)
- [node-redis 라이브러리](https://github.com/redis/node-redis)

## 팁

- 개발 환경에서는 비밀번호 없이 사용 가능
- 운영 환경에서는 반드시 `requirepass` 설정
- `redis/data/` 폴더는 .gitignore에 추가 권장
- 주기적으로 데이터 백업 권장

## .gitignore에 추가

프로젝트 루트의 `.gitignore`에 추가:
```gitignore
# Redis 데이터
redis/data/*
!redis/data/.gitkeep

# Redis 로그
redis/*.log
```

## redis/data/.gitkeep

data 폴더 구조를 git에 유지하기 위한 빈 파일:
```bash
# 이 파일은 data 폴더를 git에 포함시키기 위한 파일입니다.
# Redis 데이터는 이 폴더에 저장되며, .gitignore로 제외됩니다.
```

---

## 전체 설정 완료 후 실행 순서
```bash
# 1. Redis 시작
docker compose -f redis.yml up -d

# 2. 상태 확인
docker compose -f redis.yml ps
docker compose -f redis.yml logs redis

# 3. 테스트
docker exec -it project-redis redis-cli ping
``` 