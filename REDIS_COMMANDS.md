# Redis Command Checklist for Redbis

Redbis는 Redis 프로토콜(RESP) 인터페이스를 제공하는 SQLite 백엔드 프록시입니다.

범례: ✅ 구현완료 | 🔲 미구현 | ❌ 구현불가

---

## 1. Connection (연결)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 1 | AUTH | 🔲 | 인증 |
| 2 | CLIENT CACHING | ❌ | 클라이언트 캐싱 제어 |
| 3 | CLIENT GETNAME | 🔲 | 연결 이름 조회 |
| 4 | CLIENT GETREDIR | ❌ | 추적 리디렉션 |
| 5 | CLIENT ID | 🔲 | 연결 고유 ID |
| 6 | CLIENT INFO | 🔲 | 연결 정보 |
| 7 | CLIENT KILL | 🔲 | 연결 종료 |
| 8 | CLIENT LIST | 🔲 | 연결 목록 |
| 9 | CLIENT NO-EVICT | ❌ | 클라이언트 제거 모드 |
| 10 | CLIENT NO-TOUCH | ❌ | LRU/LFU 영향 제어 |
| 11 | CLIENT PAUSE | 🔲 | 명령 처리 일시정지 |
| 12 | CLIENT REPLY | 🔲 | 서버 응답 모드 |
| 13 | CLIENT SETINFO | 🔲 | 클라이언트 정보 설정 |
| 14 | CLIENT SETNAME | 🔲 | 연결 이름 설정 |
| 15 | CLIENT TRACKING | ❌ | 서버 보조 클라이언트 캐시 |
| 16 | CLIENT TRACKINGINFO | ❌ | 캐시 추적 정보 |
| 17 | CLIENT UNBLOCK | 🔲 | 차단 클라이언트 해제 |
| 18 | CLIENT UNPAUSE | 🔲 | 명령 처리 재개 |
| 19 | ECHO | ✅ | 메시지 에코 |
| 20 | HELLO | 🔲 | RESP3 핸드셰이크 |
| 21 | PING | ✅ | echo 모드 지원 |
| 22 | QUIT | ✅ | 연결 종료 |
| 23 | RESET | 🔲 | 연결 리셋 |
| 24 | SELECT | 🔲 | DB 선택 (DB 번호 개념 없음) |

## 2. String (문자열)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 25 | APPEND | ✅ | |
| 26 | DECR | ✅ | |
| 27 | DECRBY | ✅ | |
| 28 | DEL | ✅ | |
| 29 | GET | ✅ | |
| 30 | GETDEL | ✅ | |
| 31 | GETEX | ✅ | |
| 32 | GETRANGE | ✅ | |
| 33 | GETSET | ✅ | |
| 34 | INCR | ✅ | |
| 35 | INCRBY | ✅ | |
| 36 | INCRBYFLOAT | ✅ | |
| 37 | LCS | ✅ | |
| 38 | MGET | ✅ | |
| 39 | MSET | ✅ | |
| 40 | MSETNX | ✅ | |
| 41 | PSETEX | ✅ | |
| 42 | SET | ✅ | EX/PX/EXAT/PXAT/NX/XX/GET/KEEPTTL 지원 |
| 43 | SETEX | ✅ | |
| 44 | SETNX | ✅ | |
| 45 | SETRANGE | ✅ | |
| 46 | STRLEN | ✅ | |
| 47 | SUBSTR | ✅ | GETRANGE 별칭 |

## 3. Generic (키 관리)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 48 | COPY | ✅ | |
| 49 | DEL | ✅ | |
| 50 | DUMP | ❌ | Redis 내부 직렬화 |
| 51 | EXISTS | ✅ | |
| 52 | EXPIRE | ✅ | |
| 53 | EXPIREAT | ✅ | |
| 54 | EXPIRETIME | ✅ | |
| 55 | KEYS | ✅ | glob → LIKE/regex 변환 |
| 56 | MIGRATE | ❌ | 인스턴스 간 키 이동 |
| 57 | MOVE | ❌ | DB 번호 개념 없음 |
| 58 | OBJECT ENCODING | ❌ | Redis 내부 인코딩 |
| 59 | OBJECT FREQ | ❌ | Redis 내부 액세스 빈도 |
| 60 | OBJECT IDLETIME | ❌ | Redis 내부 유휴 시간 |
| 61 | OBJECT REFCOUNT | ❌ | Redis 내부 참조 수 |
| 62 | PERSIST | ✅ | |
| 63 | PEXPIRE | ✅ | |
| 64 | PEXPIREAT | ✅ | |
| 65 | PEXPIRETIME | ✅ | |
| 66 | PTTL | ✅ | |
| 67 | RANDOMKEY | ✅ | |
| 68 | RENAME | ✅ | |
| 69 | RENAMENX | ✅ | |
| 70 | RESTORE | ❌ | Redis 내부 복원 |
| 71 | SCAN | ✅ | |
| 72 | SORT | 🔲 | 정렬 |
| 73 | SORT_RO | 🔲 | 읽기 전용 정렬 |
| 74 | TOUCH | ✅ | |
| 75 | TTL | ✅ | |
| 76 | TYPE | ✅ | string/hash/list/set/zset/hyperloglog/json/none |
| 77 | UNLINK | ✅ | |
| 78 | WAIT | ❌ | 복제 대기 |
| 79 | WAITAOF | ❌ | AOF 동기화 대기 |

## 4. Hash (해시)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 80 | HDEL | ✅ | |
| 81 | HEXISTS | ✅ | |
| 82 | HGET | ✅ | |
| 83 | HGETALL | ✅ | |
| 84 | HINCRBY | ✅ | |
| 85 | HINCRBYFLOAT | ✅ | |
| 86 | HKEYS | ✅ | |
| 87 | HLEN | ✅ | |
| 88 | HMGET | ✅ | |
| 89 | HMSET | ✅ | |
| 90 | HRANDFIELD | ✅ | |
| 91 | HSCAN | ✅ | |
| 92 | HSET | ✅ | |
| 93 | HSETNX | ✅ | |
| 94 | HSTRLEN | ✅ | |
| 95 | HVALS | ✅ | |
| 96 | HGETDEL | ✅ | Redis 8.0+ |
| 97 | HGETEX | ✅ | Redis 8.0+ |
| 98 | HSETEX | ✅ | Redis 8.0+ |
| 99 | HEXPIRE | ✅ | Redis 7.4+ |
| 100 | HEXPIREAT | ✅ | Redis 7.4+ |
| 101 | HEXPIRETIME | ✅ | Redis 7.4+ |
| 102 | HPEXPIRE | ✅ | Redis 7.4+ |
| 103 | HPEXPIREAT | ✅ | Redis 7.4+ |
| 104 | HPEXPIRETIME | ✅ | Redis 7.4+ |
| 105 | HPERSIST | ✅ | Redis 7.4+ |
| 106 | HPTTL | ✅ | Redis 7.4+ |
| 107 | HTTL | ✅ | Redis 7.4+ |

## 5. List (리스트)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 108 | BLMOVE | ✅ | 블로킹 (비차단 모드) |
| 109 | BLMPOP | ✅ | 블로킹 (비차단 모드) |
| 110 | BLPOP | ✅ | 블로킹 (비차단 모드) |
| 111 | BRPOP | ✅ | 블로킹 (비차단 모드) |
| 112 | BRPOPLPUSH | ✅ | 블로킹 (비차단 모드) |
| 113 | LINDEX | ✅ | |
| 114 | LINSERT | ✅ | |
| 115 | LLEN | ✅ | |
| 116 | LMOVE | ✅ | |
| 117 | LMPOP | ✅ | Redis 7.0+ |
| 118 | LPOP | ✅ | count 인자 지원 |
| 119 | LPOS | ✅ | |
| 120 | LPUSH | ✅ | |
| 121 | LPUSHX | ✅ | |
| 122 | LRANGE | ✅ | |
| 123 | LREM | ✅ | |
| 124 | LSET | ✅ | |
| 125 | LTRIM | ✅ | |
| 126 | RPOP | ✅ | count 인자 지원 |
| 127 | RPOPLPUSH | ✅ | |
| 128 | RPUSH | ✅ | |
| 129 | RPUSHX | ✅ | |

## 6. Set (집합)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 130 | SADD | ✅ | |
| 131 | SCARD | ✅ | |
| 132 | SDIFF | ✅ | |
| 133 | SDIFFSTORE | ✅ | |
| 134 | SINTER | ✅ | |
| 135 | SINTERCARD | ✅ | Redis 7.0+ |
| 136 | SINTERSTORE | ✅ | |
| 137 | SISMEMBER | ✅ | |
| 138 | SMEMBERS | ✅ | |
| 139 | SMISMEMBER | ✅ | Redis 6.2+ |
| 140 | SMOVE | ✅ | |
| 141 | SPOP | ✅ | count 인자 지원 |
| 142 | SRANDMEMBER | ✅ | |
| 143 | SREM | ✅ | |
| 144 | SSCAN | ✅ | |
| 145 | SUNION | ✅ | |
| 146 | SUNIONSTORE | ✅ | |

## 7. Sorted Set (정렬 집합)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 147 | BZMPOP | ✅ | 블로킹 (비차단 모드) |
| 148 | BZPOPMAX | ✅ | 블로킹 (비차단 모드) |
| 149 | BZPOPMIN | ✅ | 블로킹 (비차단 모드) |
| 150 | ZADD | ✅ | NX/XX/GT/LT/CH/INCR 지원 |
| 151 | ZCARD | ✅ | |
| 152 | ZCOUNT | ✅ | |
| 153 | ZDIFF | ✅ | Redis 6.2+ |
| 154 | ZDIFFSTORE | ✅ | Redis 6.2+ |
| 155 | ZINCRBY | ✅ | |
| 156 | ZINTER | ✅ | Redis 6.2+ |
| 157 | ZINTERCARD | ✅ | Redis 7.0+ |
| 158 | ZINTERSTORE | ✅ | |
| 159 | ZLEXCOUNT | ✅ | |
| 160 | ZMPOP | ✅ | Redis 7.0+ |
| 161 | ZMSCORE | ✅ | Redis 6.2+ |
| 162 | ZPOPMAX | ✅ | |
| 163 | ZPOPMIN | ✅ | |
| 164 | ZRANDMEMBER | ✅ | Redis 6.2+ |
| 165 | ZRANGE | ✅ | BYSCORE/BYLEX/REV/LIMIT/WITHSCORES |
| 166 | ZRANGEBYLEX | ✅ | |
| 167 | ZRANGEBYSCORE | ✅ | |
| 168 | ZRANGESTORE | ✅ | Redis 6.2+ |
| 169 | ZRANK | ✅ | |
| 170 | ZREM | ✅ | |
| 171 | ZREMRANGEBYLEX | ✅ | |
| 172 | ZREMRANGEBYRANK | ✅ | |
| 173 | ZREMRANGEBYSCORE | ✅ | |
| 174 | ZREVRANGE | ✅ | |
| 175 | ZREVRANGEBYLEX | ✅ | |
| 176 | ZREVRANGEBYSCORE | ✅ | |
| 177 | ZREVRANK | ✅ | |
| 178 | ZSCAN | ✅ | |
| 179 | ZSCORE | ✅ | |
| 180 | ZUNION | ✅ | Redis 6.2+ |
| 181 | ZUNIONSTORE | ✅ | |

## 8. Bitmap (비트맵)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 182 | BITCOUNT | ✅ | |
| 183 | BITFIELD | ✅ | GET/SET/INCRBY + OVERFLOW WRAP/SAT/FAIL |
| 184 | BITFIELD_RO | ✅ | |
| 185 | BITOP | ✅ | AND/OR/XOR/NOT |
| 186 | BITPOS | ✅ | |
| 187 | GETBIT | ✅ | |
| 188 | SETBIT | ✅ | |

## 9. HyperLogLog

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 189 | PFADD | ✅ | MurmurHash3-like 64-bit |
| 190 | PFCOUNT | ✅ | 조화 평균 추정 |
| 191 | PFDEBUG | ❌ | 내부 디버그 |
| 192 | PFMERGE | ✅ | |
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
| 225 | PSUBSCRIBE | ✅ | 패턴 구독 |
| 226 | PUBLISH | ✅ | 메시지 발행 |
| 227 | PUBSUB CHANNELS | ✅ | 활성 채널 목록 |
| 228 | PUBSUB NUMPAT | ✅ | 패턴 구독 수 |
| 229 | PUBSUB NUMSUB | ✅ | 채널 구독자 수 |
| 230 | PUBSUB SHARDCHANNELS | ✅ | |
| 231 | PUBSUB SHARDNUMSUB | ✅ | |
| 232 | PUNSUBSCRIBE | ✅ | 패턴 구독 해제 |
| 233 | SPUBLISH | ✅ | |
| 234 | SSUBSCRIBE | ✅ | |
| 235 | SUBSCRIBE | ✅ | 채널 구독 |
| 236 | SUNSUBSCRIBE | ✅ | |
| 237 | UNSUBSCRIBE | ✅ | 채널 구독 해제 |

## 13. Transaction (트랜잭션)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 238 | DISCARD | ✅ | |
| 239 | EXEC | ✅ | |
| 240 | MULTI | ✅ | |
| 241 | UNWATCH | ❌ | WATCH 미지원 |
| 242 | WATCH | ❌ | 실시간 감시 불가 |

## 14. Scripting (스크립팅)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 243–261 | (전체) | ❌ | Lua 스크립트 미지원 |

## 15. Server (서버 관리)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 262–281 | ACL 전체 | ❌ | ACL 미지원 |
| 282 | BGREWRITEAOF | ❌ | AOF 재작성 |
| 283 | BGSAVE | 🔲 | 비동기 저장 |
| 284 | COMMAND | ✅ | |
| 285 | COMMAND COUNT | ✅ | |
| 286 | COMMAND DOCS | ✅ | |
| 287 | COMMAND GETKEYS | ✅ | |
| 288 | COMMAND GETKEYSANDFLAGS | ✅ | |
| 289 | COMMAND INFO | ✅ | |
| 290 | COMMAND LIST | ✅ | |
| 291 | CONFIG GET | ✅ | |
| 292 | CONFIG RESETSTAT | 🔲 | 통계 초기화 |
| 293 | CONFIG REWRITE | 🔲 | 설정 파일 저장 |
| 294 | CONFIG SET | ✅ | |
| 295 | DBSIZE | ✅ | |
| 296 | FAILOVER | ❌ | 장애조치 |
| 297 | FLUSHALL | ✅ | FLUSHDB와 동일 |
| 298 | FLUSHDB | ✅ | |
| 299 | INFO | ✅ | |
| 300 | LASTSAVE | ✅ | |
| 301–308 | LATENCY 전체 | ❌ | 지연 분석 |
| 309 | LOLWUT | ❌ | ASCII 아트 |
| 310–313 | MEMORY (USAGE 제외) | ❌ | |
| 314 | MEMORY USAGE | ✅ | |
| 315–318 | MODULE 전체 | ❌ | 모듈 시스템 |
| 319 | MONITOR | ❌ | 실시간 모니터링 |
| 320–323 | 복제/클러스터 내부 | ❌ | |
| 324 | SAVE | ✅ | PRAGMA wal_checkpoint |
| 325 | SHUTDOWN | ✅ | |
| 326 | SLAVEOF | ❌ | deprecated |
| 327 | SLOWLOG GET | ✅ | |
| 328 | SLOWLOG LEN | ✅ | |
| 329 | SLOWLOG RESET | ✅ | |
| 330 | SWAPDB | ❌ | DB 교체 |
| 331 | SYNC | ❌ | 복제 동기화 |
| 332 | TIME | ✅ | |

## 16. Cluster (클러스터)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 324–355 | (전체) | ❌ | 단일 인스턴스 전용 |

## 17. JSON (RedisJSON 모듈)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 356 | JSON.ARRAPPEND | ✅ | |
| 357 | JSON.ARRINDEX | ✅ | |
| 358 | JSON.ARRINSERT | ✅ | |
| 359 | JSON.ARRLEN | ✅ | |
| 360 | JSON.ARRPOP | ✅ | |
| 361 | JSON.ARRTRIM | ✅ | |
| 362 | JSON.CLEAR | ✅ | |
| 363 | JSON.DEBUG | ✅ | |
| 364 | JSON.DEBUG MEMORY | ✅ | |
| 365 | JSON.DEL | ✅ | |
| 366 | JSON.FORGET | ✅ | JSON.DEL 별칭 |
| 367 | JSON.GET | ✅ | |
| 368 | JSON.MERGE | ✅ | RFC 7396 |
| 369 | JSON.MGET | ✅ | |
| 370 | JSON.MSET | ✅ | Redis 2.6+ |
| 371 | JSON.NUMINCRBY | ✅ | |
| 372 | JSON.NUMMULTBY | ✅ | |
| 373 | JSON.OBJKEYS | ✅ | |
| 374 | JSON.OBJLEN | ✅ | |
| 375 | JSON.RESP | ✅ | |
| 376 | JSON.SET | ✅ | NX/XX 지원 |
| 377 | JSON.STRAPPEND | ✅ | |
| 378 | JSON.STRLEN | ✅ | |
| 379 | JSON.TOGGLE | ✅ | |
| 380 | JSON.TYPE | ✅ | |

## 18. Search (RediSearch 모듈)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 381–404 | (전체) | ❌ | 전문 검색 모듈 |

## 19. Time Series (RedisTimeSeries 모듈)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 405–423 | (전체) | ❌ | 시계열 모듈 |

## 20. Vector Set (8.0+)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 424–436 | (전체) | ❌ | 벡터 검색 모듈 |

## 21. 기타 (Redis 8.x 신규)

| # | 명령 | 상태 | 비고 |
|---|------|------|------|
| 437 | DELEX | 🔲 | 조건부 삭제 (8.4+) |
| 438 | DIGEST | ❌ | 해시 다이제스트 |
| 439 | MSETEX | 🔲 | 다중 만료 설정 (8.4+) |

---

## 요약

| 카테고리 | 전체 | ✅ 구현 | 🔲 미구현 | ❌ 불가 |
|----------|------|---------|-----------|---------|
| Connection | 24 | 3 | 18 | 3 |
| String | 23 | 23 | 0 | 0 |
| Generic | 32 | 18 | 2 | 12 |
| Hash | 28 | 28 | 0 | 0 |
| List | 22 | 22 | 0 | 0 |
| Set | 17 | 17 | 0 | 0 |
| Sorted Set | 35 | 35 | 0 | 0 |
| Bitmap | 7 | 7 | 0 | 0 |
| HyperLogLog | 5 | 3 | 0 | 2 |
| Geospatial | 10 | 0 | 10 | 0 |
| Stream | 21 | 0 | 19 | 2 |
| Pub/Sub | 13 | 13 | 0 | 0 |
| Transaction | 5 | 3 | 0 | 2 |
| Scripting | 19 | 0 | 0 | 19 |
| Server | 62 | 20 | 3 | 39 |
| Cluster | 32 | 0 | 0 | 32 |
| JSON | 25 | 25 | 0 | 0 |
| Search | 24 | 0 | 0 | 24 |
| Time Series | 19 | 0 | 0 | 19 |
| Vector | 13 | 0 | 0 | 13 |
| 기타 | 3 | 0 | 2 | 1 |
| **합계** | **439** | **217** | **54** | **168** |

---

## 구현 우선순위 (남은 구현 가능 항목)

### 🔲 남은 구현 가능 명령 (54개)

**Connection (18):**
- AUTH, CLIENT GETNAME/SETNAME/ID/INFO/LIST/KILL/PAUSE/UNPAUSE/UNBLOCK/REPLY/SETINFO, ECHO(✅), HELLO, RESET, SELECT

**Generic (2):**
- SORT, SORT_RO

**Geospatial (10):**
- GEOADD, GEODIST, GEOHASH, GEOPOS, GEORADIUS, GEORADIUS_RO, GEORADIUSBYMEMBER, GEORADIUSBYMEMBER_RO, GEOSEARCH, GEOSEARCHSTORE

**Stream (19):**
- XADD, XACK, XAUTOCLAIM, XCLAIM, XDEL, XGROUP (5), XINFO (3), XLEN, XPENDING, XRANGE, XREAD, XREADGROUP, XREVRANGE, XTRIM

**Server (3):**
- BGSAVE, CONFIG RESETSTAT, CONFIG REWRITE

**기타 (2):**
- DELEX, MSETEX