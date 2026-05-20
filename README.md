# Redbis

> RDBMS 백엔드 미들웨어 프록시 — Redis 프로토콜(RESP) 인터페이스를 제공합니다

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Introduction

Redbis는 Redis 프로토콜(RESP)을 사용하여 클라이언트와 통신하고, 백엔드 RDBMS(SQLite 등)와 연동하는 미들웨어 프록시입니다. Redis 클라이언트가 기존 Redis 서버에 연결하듯이 Redbis에 연결할 수 있으며, 실제 데이터는 관계형 데이터베이스에 저장됩니다.

## Features

- **TCP 서버**: 설정 가능한 포트(기본 6379)에서 다중 클라이언트 연결을 수용합니다
- **구조화 로거**: JSON 형태의 타임스탬프, 로그 레벨, 모듈명, 메시지를 포함한 로그 출력
- **다중 클라이언트 처리**: 여러 클라이언트가 동시에 연결할 수 있습니다
- **우아한 종료**: SIGINT/SIGTERM 시그널 수신 시 기존 연결을 정상적으로 종료합니다
- **스토리지 추상화**: 향후 다양한 백엔드 교체가 가능한 인터페이스 구조

## Installation

```bash
# npm을 사용하는 경우
npm install redbis

# 또는 npx로 바로 실행
npx redbis

# Bun을 사용하는 경우
bunx redbis
```

## Quick Start

별도 설치 없이 `npx` 또는 `bunx`로 즉시 실행할 수 있습니다:

```bash
# 기본 설정으로 서버 시작 (포트 6379)
npx redbis

# 환경변수로 포트 변경
REDBIS_PORT=6380 npx redbis
```

또는 프로젝트에 설치 후 사용:

```bash
npm install redbis
npx redbis
```

## Configuration

모든 설정은 환경변수를 통해 관리합니다:

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `REDBIS_PORT` | `6379` | 서버 수신 포트 |
| `REDBIS_HOST` | `127.0.0.1` | 서버 바인딩 호스트 |
| `REDBIS_LOG_LEVEL` | `info` | 로그 레벨 (debug, info, warn, error) |

## Project Structure

```
redbis/
├── bin/
│   └── redbis.js            # CLI 진입점
├── src/
│   ├── index.ts              # 진입점 - 서버 시작 및 시그널 처리
│   ├── config/
│   │   └── index.ts          # 환경변수 기반 설정 로더
│   ├── logger/
│   │   └── index.ts          # 구조화 JSON 로거
│   ├── server/
│   │   ├── index.ts          # TCP 서버 생성 및 우아한 종료
│   │   └── connection.ts     # 클라이언트 연결 핸들러
│   ├── protocol/
│   │   └── parser.ts         # RESP 파서 스텁 (Phase 2 구현 예정)
│   └── storage/
│       ├── interface.ts       # IStorage 인터페이스 정의
│       └── sqlite.ts          # SQLite 어댑터 스텁 (Phase 3 구현 예정)
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

## Development

기여자를 위한 개발 환경 설정:

```bash
# 저장소 클론
git clone https://github.com/your-org/redbis.git
cd redbis

# 의존성 설치 (prepare 스크립트가 자동으로 빌드를 실행합니다)
npm install

# 개발 모드로 실행
npm run dev

# 테스트 실행
npm test

# 빌드
npm run build
```

> **참고**: `npm install` 실행 시 `prepare` 스크립트가 자동으로 `npm run build`를 실행하여 `dist/` 디렉토리를 생성합니다.

## Notes

- **redis-cli 연결**: Phase 1에서는 RESP 응답을 보내지 않으므로 redis-cli가 타임아웃되거나 에러를 표시할 수 있습니다. 이는 정상적인 동작입니다.
- **데이터 로깅**: 연결된 클라이언트가 보내는 모든 데이터는 원시 형태로 로그에 기록됩니다.

## Roadmap

- **Phase 2**: RESP 프로토콜 파싱 및 Redis 명령어 처리
- **Phase 3**: SQLite 스토리지 연동 및 데이터 영속화
- **Phase 4**: 추가 Redis 명령어 지원 및 성능 최적화

## Contributing

이슈와 풀 리퀘스트를 환영합니다. 큰 변경 사항은 먼저 이슈를 열어 논의해 주세요.

1. 저장소를 포크합니다
2. 기능 브랜치를 생성합니다 (`git checkout -b feature/amazing-feature`)
3. 변경 사항을 커밋합니다 (`git commit -m 'Add amazing feature'`)
4. 브랜치에 푸시합니다 (`git push origin feature/amazing-feature`)
5. 풀 리퀘스트를 생성합니다

## License

MIT