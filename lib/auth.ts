import { timingSafeEqual } from 'node:crypto';

/** 길이 노출 없이 상수 시간 비교 */
export function keyMatches(candidate: string | null | undefined): boolean {
  const expected = process.env.CONTROL_KEY;
  if (!expected) {
    throw new Error('환경변수 CONTROL_KEY 가 설정되지 않았습니다.');
  }
  if (!candidate) return false;

  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // 길이가 다르면 timingSafeEqual 이 던지므로, 같은 길이 버퍼로 맞춰 비교한 뒤 길이도 함께 검사
  const len = Math.max(a.length, b.length);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  a.copy(pa);
  b.copy(pb);
  return timingSafeEqual(pa, pb) && a.length === b.length;
}

/** 요청 헤더(x-control-key) 또는 쿼리스트링(?key=) 에서 키를 꺼내 검증 */
export function requireKey(req: Request): boolean {
  const header = req.headers.get('x-control-key');
  if (header) return keyMatches(header);

  const url = new URL(req.url);
  return keyMatches(url.searchParams.get('key'));
}
