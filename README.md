# Redbis

> Redis 호환 서버 — 인메모리 + SQLite 백엔드, 288개 Redis 명령 지원

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Commands: 288](https://img.shields.io/badge/Commands-288-brightgreen)](REDIS_COMMANDS.md)

## Introduction

Redbis는 Redis 프로토콜(RESP)을 사용하여 클라이언트와 통신하고, 백엔드 SQLite에 데이터를 영속화하는 Redis 호환 서버입니다. Redis 클라이언트가 기존 Redis 서버에 연결하듯이 Redbis에 연결할 수 있으며, 실제 데이터는 SQLite 데이터베이스에 저장됩니다.

## Features

- **TCP 서버**: 설정 가능한 포트(기본 6379)에서 다중 클라이언트 연결을 수용합니다
- **RESP 프로토콜**: Redis 프로토콜을 완전히 지원합니다 (파서 + 인코더)
- **SQLite 백엔드**: 데이터를 SQLite 파일 데이터베이스에 영속화합니다
- **인메모리 모드**: 영속화 없이 인메모리 스토리지로 실행할 수 있습니다
- **커넥션 스트링**: `DATABASE_URL` 커넥션 스트링으로 스토리지를 선택합니다
- **DI 구조**: 의존성 주입 패턴으로 스토리지 교체가 용이합니다
- **구조화 로거**: JSON 형태의 타임스탬프, 로그 레벨, 모듈명, 메시지를 포함한 로그 출력
- **우아한 종료**: SIGINT/SIGTERM 시그널 수신 시 기존 연결을 정상적으로 종료합니다
- **1177개 테스트**: 전체 기능에 대한 포괄적인 테스트 커버리지

## Supported Commands (288/439)

| 카테고리 | ✅ 구현 | 전체 | 비고 |
|----------|---------|------|------|
| String | 23 | 23 | 전체 지원 |
| Hash | 28 | 28 | 전체 지원 + 필드 만료 |
| List | 22 | 22 | 전체 지원 + 블로킹 |
| Set | 17 | 17 | 전체 지원 |
| Sorted Set | 35 | 35 | 전체 지원 |
| Bitmap | 7 | 7 | 전체 지원 |
| HyperLogLog | 3 | 5 | PFADD, PFCOUNT, PFMERGE |
| Geospatial | 10 | 10 | 전체 지원 (GEOADD~GEOSEARCHSTORE) |
| Stream | 20 | 21 | XADD~XAUTOCLAIM, XREADGROUP 등 |
| Pub/Sub | 13 | 13 | 전체 지원 |
| Transaction | 3 | 5 | MULTI, EXEC, DISCARD |
| JSON | 25 | 25 | 전체 지원 |
| Connection | 18 | 24 | AUTH, CLIENT*, HELLO, RESET, SELECT |
| Server | 24 | 36 | INFO, SAVE, CONFIG, SLOWLOG 등 |
| Generic | 22 | 32 | SORT, SORT_RO 포함 |
| 기타 | 2 | 3 | DELEX, MSETEX |

구현 불가 명령(151개): Scripting(19), Cluster(32), Search(24), Time Series(19), Vector(13), Server 내부(12) 등

상세 명령 목록은 [REDIS_COMMANDS.md](REDIS_COMMANDS.md)를 참조하세요.

## Installation

```bash
npm install
npm run build
```

## Quick Start

```bash
# 인메모리 모드 (기본)
DATABASE_URL=memory:// npm run start:memory

# SQLite 파일 DB 모드
DATABASE_URL=sqlite://./data/redbis.db npm run start:sqlite

# npx로 실행
npx redbis
```

개발 모드:

```bash
# 인메모리
npm run dev:memory

# SQLite 파일 DB
npm run dev:sqlite
```

## Configuration

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DATABASE_URL` | `memory://` | 스토리지 커넥션 스트링 |
| `REDBIS_PORT` | `6379` | 서버 수신 포트 |
| `REDBIS_HOST` | `127.0.0.1` | 서버 바인딩 호스트 |
| `REDBIS_LOG_LEVEL` | `info` | 로그 레벨 (debug, info, warn, error) |

### Connection String Format

| 커넥션 스트링 | 스토리지 |
|---|---|
| `memory://` | InMemoryStorage (영속화 없음) |
| `sqlite://./data/redbis.db` | SQLite 상대경로 파일 DB |
| `sqlite:///var/data/redbis.db` | SQLite 절대경로 파일 DB |

## Project Structure

```
redbis/
├── bin/
│   └── redbis.js                # CLI 진입점
├── src/
│   ├── index.ts                  # 진입점 - 서버 시작 및 시그널 처리
│   ├── config/
│   │   └── index.ts              # 환경변수 기반 설정 (DATABASE_URL 포함)
│   ├── logger/
│   │   └── index.ts              # 구조화 JSON 로거
│   ├── protocol/
│   │   ├── parser.ts             # RESP 프로토콜 파서
│   │   └── resp.ts                # RESP 인코더
│   ├── command/
│   │   └── handler.ts            # Redis 명령 핸들러 (288개 명령)
│   ├── storage/
│   │   ├── interface.ts          # IStorage 인터페이스
│   │   ├── memory.ts             # InMemoryStorage 구현체
│   │   ├── sqlite.ts             # SqliteStorage 구현체 (better-sqlite3)
│   │   └── factory.ts            # createStorage() + parseConnectionString()
│   ├── utils/
│   │   └── geo.ts                # Geohash 유틸리티 (GEO 명령 지원)
│   ├── pubsub/
│   │   └── manager.ts            # Pub/Sub 매니저
│   └── server/
│       ├── index.ts              # TCP 서버 생성 및 우아한 종료
│       └── connection.ts         # DI 기반 클라이언트 연결 핸들러
├── src/__tests__/                # 1177개 테스트
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── REDIS_COMMANDS.md              # 전체 Redis 명령 체크리스트
└── README.md
```

## Development

```bash
# 의존성 설치
npm install

# 테스트 실행 (1177개 테스트)
npm test

# 개발 모드 - 인메모리
npm run dev:memory

# 개발 모드 - SQLite
npm run dev:sqlite

# 빌드
npm run build
```

## Testing

```bash
# 전체 테스트
npm test

# 감시 모드
npm run test:watch

# 특정 테스트만 실행
npx vitest run src/__tests__/geo.test.ts
npx vitest run src/__tests__/stream.test.ts
```

테스트 커버리지 (1177 테스트, 26 파일):

| 테스트 파일 | 테스트 수 | 내용 |
|-------------|----------|------|
| command.test.ts | ~100 | 명령 파싱, 에러 처리 |
| memory-storage.test.ts | 21 | InMemoryStorage 기본 |
| sqlite.test.ts | 45 | SqliteStorage (GEO 포함) |
| zset.test.ts | ~50 | 정렬 집합 명령 |
| hash.test.ts | ~50 | 해시 명령 + 필드 만료 |
| list.test.ts | ~50 | 리스트 명령 + 블로킹 |
| set.test.ts | ~40 | 집합 명령 |
| bitmap.test.ts | ~30 | 비트맵 명령 |
| hll.test.ts | ~10 | HyperLogLog |
| json.test.ts | ~50 | JSON 명령 |
| geo.test.ts | 31 | GEO 명령 (Handler) |
| geo-util.test.ts | 21 | Geohash 유틸리티 |
| stream.test.ts | 32 | Stream 명령 |
| sort.test.ts | 37 | SORT / SORT_RO |
| delex-msetex-connection.test.ts | 30 | DELEX, MSETEX, Auth, Client 등 |
| pubsub.test.ts | ~20 | Pub/Sub |
| transaction.test.ts | 14 | MULTI/EXEC/DISCARD |
| 기타 | ~400 | Config, Logger, Parser, RESP, Server |

## License

MIT