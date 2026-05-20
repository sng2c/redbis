// RESP 프로토콜 파서 스텁
// Phase 2에서 Redis 직렬화 프로토콜(RESP) 파싱을 구현할 예정입니다.
// 현재는 데이터를 받아들이기만 하고 파싱 결과를 반환하지 않습니다.

export class RespParser {
  // 수신된 데이터를 버퍼에 저장합니다.
  // TODO: Phase 2에서 RESP 프로토콜 파싱 구현
  feed(_data: Buffer): void {
    // 아직 구현되지 않음 - 데이터 무시
  }

  // 파싱된 명령을 반환합니다.
  // TODO: Phase 2에서 완전한 RESP 파싱 후 명령 반환 구현
  parse(): null {
    return null;
  }
}