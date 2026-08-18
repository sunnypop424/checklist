/**
 * 오버레이 표시 옵션.
 *
 * scale~debug 는 오버레이 URL 의 쿼리스트링으로 전달된다.
 * width/height 는 OBS 브라우저 소스 속성이라 URL 에 들어가지 않고,
 * 컨트롤 페이지 미리보기 크기와 안내 문구에만 쓰인다.
 */
export type OverlayOptions = {
  /** 전체 크기 배율 (루트 font-size) */
  scale: number;
  /** 완료한 항목을 목록에서 아예 뺀다 */
  hideDone: boolean;
  /** 진행률 바를 감춘다 */
  hideProgress: boolean;
  /** 완료한 항목을 아래로 내린다 (기본 켜짐) */
  sortDone: boolean;
  /** 항목이 하나도 없으면 패널을 그리지 않는다 */
  hideEmpty: boolean;
  /** 동기화 상태 점 표시 (방송용 아님) */
  debug: boolean;
  /** OBS 소스 너비 */
  width: number;
  /** OBS 소스 높이 */
  height: number;
};

export const DEFAULT_OPTIONS: OverlayOptions = {
  scale: 1,
  hideDone: false,
  hideProgress: false,
  sortDone: true,
  hideEmpty: false,
  debug: false,
  width: 420,
  height: 720,
};

/** 기본값과 다른 것만 쿼리스트링으로 만든다 — URL 이 짧고 읽기 쉽다 */
export function buildOverlayQuery(o: OverlayOptions): string {
  const p = new URLSearchParams();
  if (o.scale !== DEFAULT_OPTIONS.scale) p.set('scale', String(o.scale));
  if (o.hideDone) p.set('hideDone', '1');
  if (o.hideProgress) p.set('hideProgress', '1');
  if (!o.sortDone) p.set('sortDone', '0');
  if (o.hideEmpty) p.set('hideEmpty', '1');
  if (o.debug) p.set('debug', '1');
  const q = p.toString();
  return q ? `?${q}` : '';
}

export function buildOverlayPath(listId: string, o: OverlayOptions): string {
  return `/o/${listId}${buildOverlayQuery(o)}`;
}

/** 저장된 값이 손상돼 있어도 안전하게 기본값으로 메운다 */
export function normalizeOptions(raw: unknown): OverlayOptions {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_OPTIONS };
  const o = raw as Partial<OverlayOptions>;
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    scale: num(o.scale, DEFAULT_OPTIONS.scale, 0.5, 4),
    hideDone: o.hideDone === true,
    hideProgress: o.hideProgress === true,
    sortDone: o.sortDone !== false,
    hideEmpty: o.hideEmpty === true,
    debug: o.debug === true,
    width: Math.round(num(o.width, DEFAULT_OPTIONS.width, 200, 3840)),
    height: Math.round(num(o.height, DEFAULT_OPTIONS.height, 100, 2160)),
  };
}

const KEY_PREFIX = 'overlay_options:';

export function loadOptions(listId: string): OverlayOptions {
  if (typeof window === 'undefined') return { ...DEFAULT_OPTIONS };
  try {
    const raw = localStorage.getItem(KEY_PREFIX + listId);
    return normalizeOptions(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export function saveOptions(listId: string, o: OverlayOptions): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY_PREFIX + listId, JSON.stringify(o));
  } catch {
    /* 저장 실패는 무시 — 옵션은 편의 기능일 뿐이다 */
  }
}
