const KO = new Intl.NumberFormat('ko-KR');

/** 재료 수량은 22,038 처럼 천단위 구분이 있어야 읽힌다 */
export function nf(n: number): string {
  return KO.format(Math.round(n));
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
