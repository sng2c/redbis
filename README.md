# Redbis

> RDBMS 백엔드 미들웨어 프록시 — Redis 프로토콜(RESP) 인터페이스를 제공합니다

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Introduction

Redbis는 Redis 프로토콜(RESP)을 사용하여 클라이언트와 통신하고, 백엔드 SQLite에 데이터를 영속화하는 미들웨어 프록시입니다. Redis 클라이언트가 기존 Redis 서버에 연결하듯이 Redbis에 연결할 수 있으며, 실제 데이터는 SQLite 데이터베이스에 저장됩니다.

## Features

- **TCP 서버**: 설정 가능한 포트(기본 6379)에서 다중 클라이언트 연결을 수용합니다
- **RESP 프로토콜**: Redis 프로토콜을 완전히 지원합니다 (파서 + 인코더)
- **SQLite 백엔드**: 데이터를 SQLite 파일 데이터베이스에 영속화합니다
- **인메모리 모드**: 영속화 없이 인메모리 스토리지로 실행할 수 있습니다
- **커넥션 스트링**: `DATABASE_URL` 커넥션 스트링으로 스토리지를 선택합니다
- **DI 구조**: 의존성 주입 패턴으로 스토리지 교체가 용이합니다
- **구조화 로거**: JSON 형태의 타임스탬프, 로그 레벨, 모듈명, 메시지를 포함한 로그 출력
- **우아한 종료**: SIGINT/SIGTERM 시그널 수신 시 기존 연결을 정상적으로 종료합니다

## Supported Commands

| 명령 | 설명 |
|------|------|
| `PING` | 연결 확인 (`+PONG` 또는 에코) |
| `SET key value` | 키-값 저장 |
| `GET key` | 키의 값 조회 |
| `DEL key [key ...]` | 키 삭제 (삭제된 키 수 반환) |
| `KEYS pattern` | 패턴 매칭 키 조회 (`*`, `?` 지원) |
| `EXISTS key [key ...]` | 키 존재 여부 (존재하는 키 수 반환) |
| `FLUSHDB` | 모든 키 삭제 |
| `COMMAND` | 지원 명령 목록 반환 |

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
```

개발 모드:

```bash
# 인메모리
npm run dev:memory

# SQLite 파일 DB
npm run dev:sqlite
```

## Configuration

모든 설정은 환경변수를 통해 관리합니다:

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
│   │   └── resp.ts               # RESP 인코더
│   ├── command/
│   │   └── handler.ts            # Redis 명령 핸들러
│   ├── storage/
│   │   ├── interface.ts          # IStorage 인터페이스
│   │   ├── memory.ts             # InMemoryStorage 구현체
│   │   ├── sqlite.ts             # SqliteStorage 구현체 (better-sqlite3)
│   │   └── factory.ts            # createStorage() + parseConnectionString()
│   └── server/
│       ├── index.ts              # TCP 서버 생성 및 우아한 종료
│       └── connection.ts         # DI 기반 클라이언트 연결 핸들러
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Development

```bash
# 의존성 설치
npm install

# 테스트 실행 (232개 테스트)
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
```

테스트 커버리지:

- **Config**: 환경변수, 커넥션 스트링 파싱, 유효성 검증
- **Protocol**: RESP 파서 (inline, array, streaming, incomplete), 인코더
- **Command**: PING, SET, GET, DEL, KEYS, EXISTS, FLUSHDB, COMMAND, 에러 처리
- **Storage**: InMemoryStorage, SqliteStorage (단위 테스트 + SQL 특수문자)
- **Integration**: RESP → CommandHandler → SqliteStorage 전체 흐름, createStorage 팩토리
- **Connection**: TCP E2E, 소켓 타임아웃/에러, 멀티 커맨드 파이프라인
- **Server**: 시작/종료, 연결된 클라이언트와 함께 종료

## License

MIT