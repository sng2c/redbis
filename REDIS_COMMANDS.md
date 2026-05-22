# Redis Command Checklist for Redbis

Redbis는 Redis 프로토콜(RESP) 인터페이스를 제공하는 SQLite 백엔드 프록시입니다.

범례: ✅ 구현완료 | 🔲 미구현 | ❌ 구현불가

---

## 1. Connection (연결)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 1 | AUTH | 🔲 | 인증 |
| 2 | CLIENT CACHING | 🔲 | 클라이언트 캐싱 제어 |
| 3 | CLIENT GETNAME | 🔲 | 연결 이름 조회 |
| 4 | CLIENT GETREDIR | 🔲 | 추적 리디렉션 클라이언트 ID |
| 5 | CLIENT ID | 🔲 | 연결 고유 ID |
| 6 | CLIENT INFO | 🔲 | 연결 정보 |
| 7 | CLIENT KILL | 🔲 | 연결 종료 |
| 8 | CLIENT LIST | 🔲 | 연결 목록 |
| 9 | CLIENT NO-EVICT | 🔲 | 클라이언트 제거 모드 |
| 10 | CLIENT NO-TOUCH | 🔲 | LRU/LFU 영향 제어 |
| 11 | CLIENT PAUSE | 🔲 | 명령 처리 일시정지 |
| 12 | CLIENT REPLY | 🔲 | 서버 응답 모드 |
| 13 | CLIENT SETINFO | 🔲 | 클라이언트 정보 설정 |
| 14 | CLIENT SETNAME | 🔲 | 연결 이름 설정 |
| 15 | CLIENT TRACKING | 🔲 | 서버 보조 클라이언트 캐시 |
| 16 | CLIENT TRACKINGINFO | 🔲 | 캐시 추적 정보 |
| 17 | CLIENT UNBLOCK | 🔲 | 차단 클라이언트 해제 |
| 18 | CLIENT UNPAUSE | 🔲 | 명령 처리 재개 |
| 19 | ECHO | 🔲 | 메시지 에코 |
| 20 | HELLO | 🔲 | RESP3 핸드셰이크 |
| 21 | PING | ✅ | echo 모드 지원 |
| 22 | QUIT | 🔲 | 연결 종료 |
| 23 | RESET | 🔲 | 연결 리셋 |
| 24 | SELECT | 🔲 | DB 선택 (DB 번호 개념 없음) |

## 2. String (문자열)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 25 | APPEND | 🔲 | 문자열 덧붙이기 |
| 26 | DECR | 🔲 | 정수 -1 |
| 27 | DECRBY | 🔲 | 정수 -N |
| 28 | DEL | ✅ | |
| 29 | GET | ✅ | |
| 30 | GETDEL | 🔲 | 값 반환 후 삭제 |
| 31 | GETEX | 🔲 | 값 반환 후 만료 설정 |
| 32 | GETRANGE | 🔲 | 부분 문자열 조회 |
| 33 | GETSET | 🔲 | 이전 값 반환 후 새 값 설정 |
| 34 | INCR | 🔲 | 정수 +1 |
| 35 | INCRBY | 🔲 | 정수 +N |
| 36 | INCRBYFLOAT | 🔲 | 부동소수점 증감 |
| 37 | LCS | 🔲 | 최장 공통 부분문자열 |
| 38 | MGET | 🔲 | 여러 키 동시 조회 |
| 39 | MSET | 🔲 | 여러 키 동시 저장 |
| 40 | MSETNX | 🔲 | 모든 키가 없을때만 저장 |
| 41 | PSETEX | 🔲 | 밀리초 만료 + 설정 |
| 42 | SET | ✅ | |
| 43 | SETEX | 🔲 | 초 만료 + 설정 |
| 44 | SETNX | 🔲 | 키가 없을때만 설정 |
| 45 | SETRANGE | 🔲 | 오프셋 문자열 덮어쓰기 |
| 46 | STRLEN | 🔲 | 문자열 길이 |
| 47 | SUBSTR | 🔲 | GETRANGE 별칭 |

## 3. Generic (키 관리)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 48 | COPY | 🔲 | 키 복사 |
| 49 | DEL | ✅ | |
| 50 | DUMP | ❌ | Redis 내부 직렬화 |
| 51 | EXISTS | ✅ | |
| 52 | EXPIRE | 🔲 | 초 단위 만료 설정 |
| 53 | EXPIREAT | 🔲 | 유닉스 타임스탬프 만료 |
| 54 | EXPIRETIME | 🔲 | 만료 유닉스 타임스탬프(초) |
| 55 | KEYS | ✅ | glob → LIKE 변환 |
| 56 | MIGRATE | ❌ | 인스턴스 간 키 이동 |
| 57 | MOVE | ❌ | DB 번호 개념 없음 |
| 58 | OBJECT ENCODING | ❌ | Redis 내부 인코딩 |
| 59 | OBJECT FREQ | ❌ | Redis 내부 액세스 빈도 |
| 60 | OBJECT IDLETIME | ❌ | Redis 내부 유휴 시간 |
| 61 | OBJECT REFCOUNT | ❌ | Redis 내부 참조 수 |
| 62 | PERSIST | 🔲 | 만료 제거 |
| 63 | PEXPIRE | 🔲 | 밀리초 단위 만료 설정 |
| 64 | PEXPIREAT | 🔲 | 밀리초 유닉스 타임스탬프 만료 |
| 65 | PEXPIRETIME | 🔲 | 만료 유닉스 타임스탬프(ms) |
| 66 | PTTL | 🔲 | 남은 만료 시간(ms) |
| 67 | RANDOMKEY | 🔲 | 임의 키 |
| 68 | RENAME | 🔲 | 키 이름 변경 |
| 69 | RENAMENX | 🔲 | 대상 키 없을때만 변경 |
| 70 | RESTORE | ❌ | Redis 내부 복원 |
| 71 | SCAN | 🔲 | 커서 기반 키 순회 |
| 72 | SORT | 🔲 | 정렬 |
| 73 | SORT_RO | 🔲 | 읽기 전용 정렬 |
| 74 | TOUCH | 🔲 | 접근 시간 업데이트 |
| 75 | TTL | 🔲 | 남은 만료 시간(초) |
| 76 | TYPE | 🔲 | 값 타입 조회 |
| 77 | UNLINK | 🔲 | 비동기 DEL (동일 동작) |
| 78 | WAIT | ❌ | 복제 대기 |
| 79 | WAITAOF | ❌ | AOF 동기화 대기 |

## 4. Hash (해시)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 80 | HDEL | 🔲 | 필드 삭제 |
| 81 | HEXISTS | 🔲 | 필드 존재 여부 |
| 82 | HGET | 🔲 | 필드 값 조회 |
| 83 | HGETALL | 🔲 | 전체 필드-값 조회 |
| 84 | HINCRBY | 🔲 | 정수 필드 증감 |
| 85 | HINCRBYFLOAT | 🔲 | 부동소수점 필드 증감 |
| 86 | HKEYS | 🔲 | 필드 목록 |
| 87 | HLEN | 🔲 | 필드 수 |
| 88 | HMGET | 🔲 | 다중 필드 값 조회 |
| 89 | HMSET | 🔲 | 다중 필드 설정 |
| 90 | HRANDFIELD | 🔲 | 임의 필드 |
| 91 | HSCAN | 🔲 | 커서 기반 순회 |
| 92 | HSET | 🔲 | 필드-값 설정 |
| 93 | HSETNX | 🔲 | 필드가 없을때만 설정 |
| 94 | HSTRLEN | 🔲 | 필드 값 길이 |
| 95 | HVALS | 🔲 | 값 목록 |
| 96 | HGETDEL | 🔲 | 필드 값 반환 후 삭제 (8.0+) |
| 97 | HGETEX | 🔲 | 필드 값 조회 + 만료 설정 (8.0+) |
| 98 | HSETEX | 🔲 | 필드 설정 + 만료 (8.0+) |
| 99 | HEXPIRE | 🔲 | 해시 필드 만료(초) (7.4+) |
| 100 | HEXPIREAT | 🔲 | 해시 필드 만료 타임스탬프 (7.4+) |
| 101 | HEXPIRETIME | 🔲 | 해시 필드 만료 시간 조회 (7.4+) |
| 102 | HPEXPIRE | 🔲 | 해시 필드 만료(ms) (7.4+) |
| 103 | HPEXPIREAT | 🔲 | 해시 필드 만료 ms 타임스탬프 (7.4+) |
| 104 | HPEXPIRETIME | 🔲 | 해시 필드 만료 ms 시간 조회 (7.4+) |
| 105 | HPERSIST | 🔲 | 해시 필드 만료 제거 (7.4+) |
| 106 | HPTTL | 🔲 | 해시 필드 남은 만료 ms (7.4+) |
| 107 | HTTL | 🔲 | 해시 필드 남은 만료 초 (7.4+) |

## 5. List (리스트)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 108 | BLMOVE | 🔲 | 리스트 간 이동 (블로킹) |
| 109 | BLMPOP | 🔲 | 다중 리스트 팝 (블로킹) (7.0+) |
| 110 | BLPOP | 🔲 | 좌측 팝 (블로킹) |
| 111 | BRPOP | 🔲 | 우측 팝 (블로킹) |
| 112 | BRPOPLPUSH | 🔲 | 우측 팝 → 좌측 푸시 (블로킹) |
| 113 | LINDEX | 🔲 | 인덱스 조회 |
| 114 | LINSERT | 🔲 | 특정 값 앞/뒤 삽입 |
| 115 | LLEN | 🔲 | 리스트 길이 |
| 116 | LMOVE | 🔲 | 리스트 간 이동 (6.2+) |
| 117 | LMPOP | 🔲 | 다중 리스트 팝 (7.0+) |
| 118 | LPOP | 🔲 | 좌측 팝 |
| 119 | LPOS | 🔲 | 값의 인덱스 검색 (6.0+) |
| 120 | LPUSH | 🔲 | 좌측 삽입 |
| 121 | LPUSHX | 🔲 | 존재하는 리스트에만 좌측 삽입 |
| 122 | LRANGE | 🔲 | 범위 조회 |
| 123 | LREM | 🔲 | 값 제거 |
| 124 | LSET | 🔲 | 인덱스 값 설정 |
| 125 | LTRIM | 🔲 | 범위 외 제거 |
| 126 | RPOP | 🔲 | 우측 팝 |
| 127 | RPOPLPUSH | 🔲 | 우측 팝 → 좌측 푸시 |
| 128 | RPUSH | 🔲 | 우측 삽입 |
| 129 | RPUSHX | 🔲 | 존재하는 리스트에만 우측 삽입 |

## 6. Set (집합)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 130 | SADD | 🔲 | 멤버 추가 |
| 131 | SCARD | 🔲 | 멤버 수 |
| 132 | SDIFF | 🔲 | 차집합 |
| 133 | SDIFFSTORE | 🔲 | 차집합 저장 |
| 134 | SINTER | 🔲 | 교집합 |
| 135 | SINTERCARD | 🔲 | 교집합 원소 수 (7.0+) |
| 136 | SINTERSTORE | 🔲 | 교집합 저장 |
| 137 | SISMEMBER | 🔲 | 멤버 존재 여부 |
| 138 | SMEMBERS | 🔲 | 전체 멤버 조회 |
| 139 | SMISMEMBER | 🔲 | 다중 멤버 존재 여부 (6.2+) |
| 140 | SMOVE | 🔲 | 집합 간 이동 |
| 141 | SPOP | 🔲 | 임의 멤버 제거 |
| 142 | SRANDMEMBER | 🔲 | 임의 멤버 조회 |
| 143 | SREM | 🔲 | 멤버 제거 |
| 144 | SSCAN | 🔲 | 커서 기반 순회 |
| 145 | SUNION | 🔲 | 합집합 |
| 146 | SUNIONSTORE | 🔲 | 합집합 저장 |

## 7. Sorted Set (정렬 집합)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 147 | BZMPOP | 🔲 | 다중 정렬집합 팝 (블로킹) (7.0+) |
| 148 | BZPOPMAX | 🔲 | 최대 스코어 팝 (블로킹) |
| 149 | BZPOPMIN | 🔲 | 최소 스코어 팝 (블로킹) |
| 150 | ZADD | 🔲 | 멤버+스코어 추가 |
| 151 | ZCARD | 🔲 | 멤버 수 |
| 152 | ZCOUNT | 🔲 | 스코어 범위 내 수 |
| 153 | ZDIFF | 🔲 | 차집합 (6.2+) |
| 154 | ZDIFFSTORE | 🔲 | 차집합 저장 (6.2+) |
| 155 | ZINCRBY | 🔲 | 스코어 증감 |
| 156 | ZINTER | 🔲 | 교집합 (6.2+) |
| 157 | ZINTERCARD | 🔲 | 교집합 원소 수 (7.0+) |
| 158 | ZINTERSTORE | 🔲 | 교집합 저장 |
| 159 | ZLEXCOUNT | 🔲 | 사전식 범위 내 수 |
| 160 | ZMPOP | 🔲 | 다중 정렬집합 팝 (7.0+) |
| 161 | ZMSCORE | 🔲 | 다중 멤버 스코어 (6.2+) |
| 162 | ZPOPMAX | 🔲 | 최대 스코어 팝 |
| 163 | ZPOPMIN | 🔲 | 최소 스코어 팝 |
| 164 | ZRANDMEMBER | 🔲 | 임의 멤버 (6.2+) |
| 165 | ZRANGE | 🔲 | 인덱스 범위 조회 |
| 166 | ZRANGEBYLEX | 🔲 | 사전식 범위 조회 |
| 167 | ZRANGEBYSCORE | 🔲 | 스코어 범위 조회 |
| 168 | ZRANGESTORE | 🔲 | 범위 저장 (6.2+) |
| 169 | ZRANK | 🔲 | 멤버 순위 |
| 170 | ZREM | 🔲 | 멤버 제거 |
| 171 | ZREMRANGEBYLEX | 🔲 | 사전식 범위 제거 |
| 172 | ZREMRANGEBYRANK | 🔲 | 순위 범위 제거 |
| 173 | ZREMRANGEBYSCORE | 🔲 | 스코어 범위 제거 |
| 174 | ZREVRANGE | 🔲 | 역순 인덱스 범위 |
| 175 | ZREVRANGEBYLEX | 🔲 | 역순 사전식 범위 |
| 176 | ZREVRANGEBYSCORE | 🔲 | 역순 스코어 범위 |
| 177 | ZREVRANK | 🔲 | 역순 순위 |
| 178 | ZSCAN | 🔲 | 커서 기반 순회 |
| 179 | ZSCORE | 🔲 | 멤버 스코어 조회 |
| 180 | ZUNION | 🔲 | 합집합 (6.2+) |
| 181 | ZUNIONSTORE | 🔲 | 합집합 저장 |

## 8. Bitmap (비트맵)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 182 | BITCOUNT | 🔲 | 비트 수 카운트 |
| 183 | BITFIELD | 🔲 | 비트필드 정수 연산 |
| 184 | BITFIELD_RO | 🔲 | 읽기 전용 비트필드 (6.0+) |
| 185 | BITOP | 🔲 | 비트 연산 |
| 186 | BITPOS | 🔲 | 비트 위치 검색 |
| 187 | GETBIT | 🔲 | 비트 값 조회 |
| 188 | SETBIT | 🔲 | 비트 값 설정 |

## 9. HyperLogLog

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 189 | PFADD | 🔲 | 원소 추가 |
| 190 | PFCOUNT | 🔲 | 근사 카디널리티 |
| 191 | PFDEBUG | ❌ | 내부 디버그 |
| 192 | PFMERGE | 🔲 | 병합 |
| 193 | PFSELFTEST | ❌ | 내부 테스트 |

## 10. Geospatial (지리공간)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 194 | GEOADD | 🔲 | 경위도+멤버 추가 |
| 195 | GEODIST | 🔲 | 두 멤버 간 거리 |
| 196 | GEOHASH | 🔲 | 지오해시 반환 |
| 197 | GEOPOS | 🔲 | 멤버 경위도 조회 |
| 198 | GEORADIUS | 🔲 | 반경 검색 (deprecated) |
| 199 | GEORADIUS_RO | 🔲 | 반경 검증 읽기 (deprecated) |
| 200 | GEORADIUSBYMEMBER | 🔲 | 멤버 반경 검색 (deprecated) |
| 201 | GEORADIUSBYMEMBER_RO | 🔲 | 멤버 반경 검증 읽기 (deprecated) |
| 202 | GEOSEARCH | 🔲 | 박스/원 검색 (6.2+) |
| 203 | GEOSEARCHSTORE | 🔲 | 검색 결과 저장 (6.2+) |

## 11. Stream (스트림)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 204 | XACK | 🔲 | 메시지 확인 |
| 205 | XADD | 🔲 | 메시지 추가 |
| 206 | XAUTOCLAIM | 🔲 | 소유권 자동 획득 (6.2+) |
| 207 | XCLAIM | 🔲 | 소유권 획득 |
| 208 | XDEL | 🔲 | 메시지 삭제 |
| 209 | XGROUP CREATE | 🔲 | 컨슈머 그룹 생성 |
| 210 | XGROUP CREATECONSUMER | 🔲 | 컨슈머 생성 (6.2+) |
| 211 | XGROUP DELCONSUMER | 🔲 | 컨슈머 삭제 |
| 212 | XGROUP DESTROY | 🔲 | 그룹 삭제 |
| 213 | XGROUP SETID | 🔲 | 그룹 ID 설정 |
| 214 | XINFO CONSUMERS | 🔲 | 컨슈머 정보 |
| 215 | XINFO GROUPS | 🔲 | 그룹 정보 |
| 216 | XINFO STREAM | 🔲 | 스트림 정보 |
| 217 | XLEN | 🔲 | 메시지 수 |
| 218 | XPENDING | 🔲 | 대기 메시지 정보 |
| 219 | XRANGE | 🔲 | ID 범위 조회 |
| 220 | XREAD | 🔲 | 새 메시지 읽기 |
| 221 | XREADGROUP | 🔲 | 그룹 메시지 읽기 |
| 222 | XREVRANGE | 🔲 | 역순 ID 범위 |
| 223 | XSETID | ❌ | 내부 복제용 |
| 224 | XTRIM | 🔲 | 메시지 트림 |

## 12. Pub/Sub (발행/구독)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 225 | PSUBSCRIBE | 🔲 | 패턴 구독 |
| 226 | PUBLISH | 🔲 | 메시지 발행 |
| 227 | PUBSUB CHANNELS | 🔲 | 활성 채널 목록 |
| 228 | PUBSUB NUMPAT | 🔲 | 패턴 구독 수 |
| 229 | PUBSUB NUMSUB | 🔲 | 채널 구독자 수 |
| 230 | PUBSUB SHARDCHANNELS | 🔲 | 샤드 채널 목록 (7.0+) |
| 231 | PUBSUB SHARDNUMSUB | 🔲 | 샤드 채널 구독자 수 (7.0+) |
| 232 | PUNSUBSCRIBE | 🔲 | 패턴 구독 해제 |
| 233 | SPUBLISH | 🔲 | 샤드 채널 발행 (7.0+) |
| 234 | SSUBSCRIBE | 🔲 | 샤드 채널 구독 (7.0+) |
| 235 | SUBSCRIBE | 🔲 | 채널 구독 |
| 236 | SUNSUBSCRIBE | 🔲 | 샤드 구독 해제 (7.0+) |
| 237 | UNSUBSCRIBE | 🔲 | 구독 해제 |

## 13. Transaction (트랜잭션)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 238 | DISCARD | 🔲 | 트랜잭션 폐기 |
| 239 | EXEC | 🔲 | 트랜잭션 실행 |
| 240 | MULTI | 🔲 | 트랜잭션 시작 |
| 241 | UNWATCH | ❌ | WATCH 해제 (WATCH 미지원) |
| 242 | WATCH | ❌ | 키 감시 (실시간 감시 불가) |

## 14. Scripting (스크립팅)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 243 | EVAL | ❌ | Lua 스크립트 실행 |
| 244 | EVALSHA | ❌ | SHA1 해시로 스크립트 실행 |
| 245 | EVALSHA_RO | ❌ | 읽기 전용 SHA1 스크립트 (7.0+) |
| 246 | EVAL_RO | ❌ | 읽기 전용 스크립트 (7.0+) |
| 247 | FCALL | ❌ | 함수 호출 (7.0+) |
| 248 | FCALL_RO | ❌ | 읽기 전용 함수 호출 (7.0+) |
| 249 | FUNCTION DELETE | ❌ | 라이브러리 삭제 (7.0+) |
| 250 | FUNCTION DUMP | ❌ | 라이브러리 직렬화 (7.0+) |
| 251 | FUNCTION FLUSH | ❌ | 모든 라이브러리 삭제 (7.0+) |
| 252 | FUNCTION KILL | ❌ | 함수 실행 중단 (7.0+) |
| 253 | FUNCTION LIST | ❌ | 라이브러리 목록 (7.0+) |
| 254 | FUNCTION LOAD | ❌ | 라이브러리 로드 (7.0+) |
| 255 | FUNCTION RESTORE | ❌ | 라이브러리 복원 (7.0+) |
| 256 | FUNCTION STATS | ❌ | 함수 실행 통계 (7.0+) |
| 257 | SCRIPT DEBUG | ❌ | 디버그 모드 설정 |
| 258 | SCRIPT EXISTS | ❌ | 스크립트 존재 확인 |
| 259 | SCRIPT FLUSH | ❌ | 스크립트 캐시 삭제 |
| 260 | SCRIPT KILL | ❌ | 스크립트 실행 중단 |
| 261 | SCRIPT LOAD | ❌ | 스크립트 캐시 로드 |

## 15. Server (서버 관리)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 262 | ACL CAT | ❌ | ACL 카테고리 목록 |
| 263 | ACL DELUSER | ❌ | ACL 사용자 삭제 |
| 264 | ACL DRYRUN | ❌ | ACL 권한 시뮬레이션 |
| 265 | ACL GENPASS | ❌ | ACL 비밀번호 생성 |
| 266 | ACL GETUSER | ❌ | ACL 사용자 정보 |
| 267 | ACL LIST | ❌ | ACL 규칙 목록 |
| 268 | ACL LOAD | ❌ | ACL 파일 재로드 |
| 269 | ACL LOG | ❌ | ACL 보안 이벤트 로그 |
| 270 | ACL SAVE | ❌ | ACL 규칙 파일 저장 |
| 271 | ACL SETUSER | ❌ | ACL 사용자 생성/수정 |
| 272 | ACL USERS | ❌ | ACL 사용자 목록 |
| 273 | ACL WHOAMI | ❌ | 인증 사용자 확인 |
| 274 | BGREWRITEAOF | ❌ | AOF 재작성 |
| 275 | BGSAVE | 🔲 | 비동기 저장 |
| 276 | COMMAND | ✅ | 지원 명령 목록 |
| 277 | COMMAND COUNT | 🔲 | 명령 수 |
| 278 | COMMAND DOCS | 🔲 | 명령 문서 (7.0+) |
| 279 | COMMAND GETKEYS | 🔲 | 명령 키 추출 |
| 280 | COMMAND GETKEYSANDFLAGS | 🔲 | 키+플래그 추출 (7.0+) |
| 281 | COMMAND INFO | 🔲 | 명령 상세 정보 |
| 282 | COMMAND LIST | 🔲 | 명령 목록 (7.0+) |
| 283 | CONFIG GET | 🔲 | 설정 조회 |
| 284 | CONFIG RESETSTAT | 🔲 | 통계 초기화 |
| 285 | CONFIG REWRITE | 🔲 | 설정 파일 저장 |
| 286 | CONFIG SET | 🔲 | 런타임 설정 |
| 287 | DBSIZE | 🔲 | 전체 키 수 |
| 288 | FAILOVER | ❌ | 장애조치 |
| 289 | FLUSHALL | 🔲 | 모든 DB 삭제 (FLUSHDB와 동일) |
| 290 | FLUSHDB | ✅ | 현재 DB 삭제 |
| 291 | INFO | 🔲 | 서버 정보 |
| 292 | LASTSAVE | 🔲 | 마지막 저장 시간 |
| 293 | LATENCY DOCTOR | ❌ | 지연 분석 보고 |
| 294 | LATENCY GRAPH | ❌ | 지연 이벤트 그래프 |
| 295 | LATENCY HISTOGRAM | ❌ | 지연 히스토그램 (7.0+) |
| 296 | LATENCY HISTORY | ❌ | 지연 이벤트 기록 |
| 297 | LATENCY LATEST | ❌ | 최근 지연 이벤트 |
| 298 | LATENCY RESET | ❌ | 지연 데이터 초기화 |
| 299 | LOLWUT | ❌ | ASCII 아트 + 버전 |
| 300 | MEMORY DOCTOR | ❌ | 메모리 문제 보고 |
| 301 | MEMORY MALLOC-STATS | ❌ | 할당기 통계 |
| 302 | MEMORY PURGE | ❌ | 메모리 해제 |
| 303 | MEMORY STATS | ❌ | 메모리 상세 통계 |
| 304 | MEMORY USAGE | 🔲 | 키 메모리 사용량 추정 |
| 305 | MODULE LIST | ❌ | 로드된 모듈 목록 |
| 306 | MODULE LOAD | ❌ | 모듈 로드 |
| 307 | MODULE LOADEX | ❌ | 확장 모듈 로드 (7.0+) |
| 308 | MODULE UNLOAD | ❌ | 모듈 언로드 |
| 309 | MONITOR | ❌ | 실시간 명령 모니터링 |
| 310 | PSYNC | ❌ | 내부 복제 동기화 |
| 311 | REPLCONF | ❌ | 내부 복제 설정 |
| 312 | REPLICAOF | ❌ | 복제본 설정 |
| 313 | RESTORE-ASKING | ❌ | 내부 키 복원 |
| 314 | ROLE | ❌ | 복제 역할 조회 |
| 315 | SAVE | 🔲 | 동기 저장 |
| 316 | SHUTDOWN | 🔲 | 서버 종료 |
| 317 | SLAVEOF | ❌ | 복제본 설정 (deprecated) |
| 318 | SLOWLOG GET | 🔲 | 슬로우 로그 조회 |
| 319 | SLOWLOG LEN | 🔲 | 슬로우 로그 길이 |
| 320 | SLOWLOG RESET | 🔲 | 슬로우 로그 초기화 |
| 321 | SWAPDB | ❌ | DB 교체 |
| 322 | SYNC | ❌ | 내부 복제 동기화 |
| 323 | TIME | 🔲 | 서버 시간 |

## 16. Cluster (클러스터)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 324 | ASKING | ❌ | 클러스터 리다이렉트 |
| 325 | CLUSTER ADDSLOTS | ❌ | |
| 326 | CLUSTER ADDSLOTSRANGE | ❌ | (7.0+) |
| 327 | CLUSTER BUMPEPOCH | ❌ | |
| 328 | CLUSTER COUNT-FAILURE-REPORTS | ❌ | |
| 329 | CLUSTER COUNTKEYSINSLOT | ❌ | |
| 330 | CLUSTER DELSLOTS | ❌ | |
| 331 | CLUSTER DELSLOTSRANGE | ❌ | (7.0+) |
| 332 | CLUSTER FAILOVER | ❌ | |
| 333 | CLUSTER FLUSHSLOTS | ❌ | |
| 334 | CLUSTER FORGET | ❌ | |
| 335 | CLUSTER GETKEYSINSLOT | ❌ | |
| 336 | CLUSTER INFO | ❌ | |
| 337 | CLUSTER KEYSLOT | ❌ | |
| 338 | CLUSTER LINKS | ❌ | (7.0+) |
| 339 | CLUSTER MEET | ❌ | |
| 340 | CLUSTER MIGRATION | ❌ | (8.4+) |
| 341 | CLUSTER MYID | ❌ | |
| 342 | CLUSTER MYSHARDID | ❌ | (7.2+) |
| 343 | CLUSTER NODES | ❌ | |
| 344 | CLUSTER REPLICAS | ❌ | |
| 345 | CLUSTER REPLICATE | ❌ | |
| 346 | CLUSTER RESET | ❌ | |
| 347 | CLUSTER SAVECONFIG | ❌ | |
| 348 | CLUSTER SET-CONFIG-EPOCH | ❌ | |
| 349 | CLUSTER SETSLOT | ❌ | |
| 350 | CLUSTER SHARDS | ❌ | (7.0+) |
| 351 | CLUSTER SLAVES | ❌ | |
| 352 | CLUSTER SLOT-STATS | ❌ | (8.2+) |
| 353 | CLUSTER SLOTS | ❌ | |
| 354 | READONLY | ❌ | |
| 355 | READWRITE | ❌ | |

## 17. JSON (RedisJSON 모듈)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 356 | JSON.ARRAPPEND | 🔲 | 배열에 값 추가 |
| 357 | JSON.ARRINDEX | 🔲 | 배열에서 값 검색 |
| 358 | JSON.ARRINSERT | 🔲 | 배열에 값 삽입 |
| 359 | JSON.ARRLEN | 🔲 | 배열 길이 |
| 360 | JSON.ARRPOP | 🔲 | 배열에서 팝 |
| 361 | JSON.ARRTRIM | 🔲 | 배열 트림 |
| 362 | JSON.CLEAR | 🔲 | JSON 값 초기화 (2.0+) |
| 363 | JSON.DEBUG | 🔲 | 디버그 |
| 364 | JSON.DEBUG MEMORY | 🔲 | 메모리 사용량 |
| 365 | JSON.DEL | 🔲 | JSON 값 삭제 |
| 366 | JSON.FORGET | 🔲 | JSON 값 삭제 (별칭) |
| 367 | JSON.GET | 🔲 | JSON 값 조회 |
| 368 | JSON.MERGE | 🔲 | JSON 병합 (2.6+) |
| 369 | JSON.MGET | 🔲 | 다중 키 JSON 조회 |
| 370 | JSON.MSET | 🔲 | 다중 키 JSON 설정 (2.6+) |
| 371 | JSON.NUMINCRBY | 🔲 | 숫자 증감 |
| 372 | JSON.NUMMULTBY | 🔲 | 숫자 곱셈 |
| 373 | JSON.OBJKEYS | 🔲 | 객체 키 목록 |
| 374 | JSON.OBJLEN | 🔲 | 객체 키 수 |
| 375 | JSON.RESP | 🔲 | RESP 형식 반환 |
| 376 | JSON.SET | 🔲 | JSON 값 설정 |
| 377 | JSON.STRAPPEND | 🔲 | 문자열 덧붙이기 |
| 378 | JSON.STRLEN | 🔲 | 문자열 길이 |
| 379 | JSON.TOGGLE | 🔲 | 불리언 토글 (2.0+) |
| 380 | JSON.TYPE | 🔲 | JSON 타입 조회 |

## 18. Search (RediSearch 모듈)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 381 | FT.AGGREGATE | ❌ | 검색 집계 |
| 382 | FT.ALIASADD | ❌ | 인덱스 별칭 추가 |
| 383 | FT.ALIASDEL | ❌ | 인덱스 별칭 삭제 |
| 384 | FT.ALIASUPDATE | ❌ | 인덱스 별칭 업데이트 |
| 385 | FT.ALTER | ❌ | 인덱스 스키마 변경 |
| 386 | FT.CONFIG GET | ❌ | 검색 설정 조회 |
| 387 | FT.CONFIG SET | ❌ | 검색 설정 |
| 388 | FT.CREATE | ❌ | 검색 인덱스 생성 |
| 389 | FT.CURSOR DEL | ❌ | 커서 삭제 |
| 390 | FT.CURSOR READ | ❌ | 커서 읽기 |
| 391 | FT.DICTADD | ❌ | 사전 추가 |
| 392 | FT.DICTDEL | ❌ | 사전 삭제 |
| 393 | FT.DICTDUMP | ❌ | 사전 덤프 |
| 394 | FT.DROPINDEX | ❌ | 인덱스 삭제 |
| 395 | FT.EXPLAIN | ❌ | 쿼리 설명 |
| 396 | FT.EXPLAINCLI | ❌ | 쿼리 설명 (CLI) |
| 397 | FT.INFO | ❌ | 인덱스 정보 |
| 398 | FT.PROFILE | ❌ | 프로파일링 (2.2+) |
| 399 | FT.SEARCH | ❌ | 전문 검색 |
| 400 | FT.SPELLCHECK | ❌ | 맞춤법 검사 |
| 401 | FT.SYNDUMP | ❌ | 동의어 덤프 |
| 402 | FT.SYNUPDATE | ❌ | 동의어 업데이트 |
| 403 | FT.TAGVALS | ❌ | 태그 값 목록 |
| 404 | FT._LIST | ❌ | 인덱스 목록 |

## 19. Time Series (RedisTimeSeries 모듈)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 405 | TS.ADD | ❌ | 샘플 추가 |
| 406 | TS.ALTER | ❌ | 시계열 설정 변경 |
| 407 | TS.CREATE | ❌ | 시계열 생성 |
| 408 | TS.CREATERULE | ❌ | 컴팩션 규칙 생성 |
| 409 | TS.DECRBY | ❌ | 값 감소 |
| 410 | TS.DEL | ❌ | 샘플 삭제 |
| 411 | TS.DELETERULE | ❌ | 컴팩션 규칙 삭제 |
| 412 | TS.GET | ❌ | 최신 샘플 조회 |
| 413 | TS.INCRBY | ❌ | 값 증가 |
| 414 | TS.INFO | ❌ | 시계열 정보 |
| 415 | TS.MADD | ❌ | 다중 샘플 추가 |
| 416 | TS.MGET | ❌ | 다중 시계열 최신 샘플 |
| 417 | TS.MRANGE | ❌ | 다중 시계열 범위 조회 |
| 418 | TS.MREVRANGE | ❌ | 다중 시계열 역순 범위 |
| 419 | TS.QUERYINDEX | ❌ | 필터 인덱스 조회 |
| 420 | TS.RANGE | ❌ | 범위 조회 |
| 421 | TS.REVRANGE | ❌ | 역순 범위 조회 |
| 422 | XACKDEL | ❌ | 확인 후 삭제 (8.2+) |
| 423 | XDELEX | ❌ | 항목 삭제 (8.2+) |

## 20. Vector Set (8.0+)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 424 | VADD | ❌ | 벡터 추가 |
| 425 | VCARD | ❌ | 벡터 수 |
| 426 | VDIM | ❌ | 벡터 차원 |
| 427 | VEMB | ❌ | 벡터 임베딩 조회 |
| 428 | VGETATTR | ❌ | 벡터 속성 조회 |
| 429 | VINFO | ❌ | 벡터셋 정보 |
| 430 | VISMEMBER | ❌ | 멤버 존재 여부 |
| 431 | VLINKS | ❌ | 인접 벡터 조회 |
| 432 | VRANDMEMBER | ❌ | 임의 멤버 |
| 433 | VRANGE | ❌ | 사전식 범위 (8.4+) |
| 434 | VREM | ❌ | 멤버 제거 |
| 435 | VSETATTR | ❌ | 속성 설정 |
| 436 | VSIM | ❌ | 유사도 검색 |

## 21. 기타 (Redis 8.x 신규)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 437 | DELEX | ❌ | 조건부 삭제 (8.4+) |
| 438 | DIGEST | ❌ | 해시 다이제스트 (8.4+) |
| 439 | MSETEX | ❌ | 다중 만료 설정 (8.4+) |

---

## 요약

| 카테고리 | 전체 | ✅ 구현 | 🔲 미구현 | ❌ 불가 |
|----------|------|---------|-----------|---------|
| Connection | 24 | 1 | 23 | 0 |
| String | 23 | 3 | 20 | 0 |
| Generic | 32 | 3 | 17 | 12 |
| Hash | 28 | 0 | 28 | 0 |
| List | 22 | 0 | 22 | 0 |
| Set | 17 | 0 | 17 | 0 |
| Sorted Set | 35 | 0 | 35 | 0 |
| Bitmap | 7 | 0 | 7 | 0 |
| HyperLogLog | 5 | 0 | 3 | 2 |
| Geospatial | 10 | 0 | 10 | 0 |
| Stream | 21 | 0 | 20 | 1 |
| Pub/Sub | 13 | 0 | 13 | 0 |
| Transaction | 5 | 0 | 3 | 2 |
| Scripting | 19 | 0 | 0 | 19 |
| Server | 62 | 2 | 19 | 41 |
| Cluster | 32 | 0 | 0 | 32 |
| JSON | 25 | 0 | 25 | 0 |
| Search | 24 | 0 | 0 | 24 |
| Time Series | 19 | 0 | 0 | 19 |
| Vector Set | 13 | 0 | 0 | 13 |
| 기타 | 3 | 0 | 0 | 3 |
| **합계** | **439** | **9** | **196** | **168** |

> ❌ 구현불가 = Redis 내부 구조, 복제, 클러스터, Lua 스크립트, 모듈 전용 기능 등
> 🔲 미구현 = Redbis 아키텍처로 구현 가능하나 아직 미구현