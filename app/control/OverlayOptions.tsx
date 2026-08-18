'use client';

import { DEFAULT_OPTIONS, type OverlayOptions } from '@/lib/overlayOptions';

type Props = {
  value: OverlayOptions;
  onChange: (next: OverlayOptions) => void;
  onReset: () => void;
  /** 현재 옵션이 반영된 오버레이 경로 (표시용) */
  urlPath: string;
  copied: boolean;
  onCopy: () => void;
};

const SCALES = [
  { v: 0.85, label: '작게' },
  { v: 1, label: '기본' },
  { v: 1.25, label: '크게' },
  { v: 1.5, label: '더 크게' },
  { v: 2, label: '아주 크게' },
];

const SIZES = [
  { w: 420, h: 720, label: '420 × 720' },
  { w: 380, h: 480, label: '380 × 480' },
  { w: 520, h: 900, label: '520 × 900' },
];

type ToggleKey = 'sortDone' | 'hideDone' | 'hideProgress' | 'hideEmpty' | 'debug';

const TOGGLES: { key: ToggleKey; label: string; hint: string; inverted?: boolean }[] = [
  {
    key: 'sortDone',
    label: '완료 항목 아래로 내리기',
    hint: '목록이 잘려도 남은 할 일이 위에 남습니다',
  },
  {
    key: 'hideDone',
    label: '완료 항목 숨기기',
    hint: '체크하면 목록에서 사라집니다 (진행률에는 반영)',
  },
  { key: 'hideProgress', label: '진행률 바 숨기기', hint: '제목과 개수만 표시합니다' },
  {
    key: 'hideEmpty',
    label: '항목 없으면 패널 숨기기',
    hint: '빈 체크리스트일 때 화면을 완전히 비웁니다',
  },
  {
    key: 'debug',
    label: '동기화 상태 표시',
    hint: '⚠ 방송 화면에 점과 글자가 보입니다. 확인용으로만 쓰세요',
  },
];

export default function OverlayOptionsPanel({
  value,
  onChange,
  onReset,
  urlPath,
  copied,
  onCopy,
}: Props) {
  const set = <K extends keyof OverlayOptions>(key: K, v: OverlayOptions[K]) =>
    onChange({ ...value, [key]: v });

  const changed = (Object.keys(DEFAULT_OPTIONS) as (keyof OverlayOptions)[]).some(
    (k) => value[k] !== DEFAULT_OPTIONS[k]
  );

  return (
    <section className="opts">
      <div className="opts__head">
        <h2 className="opts__title">오버레이 옵션</h2>
        <button className="opts__reset" onClick={onReset} disabled={!changed}>
          기본값으로
        </button>
      </div>

      {/* 글자 크기 */}
      <div className="opts__group">
        <div className="opts__label">글자 크기</div>
        <div className="opts__row">
          {SCALES.map((s) => (
            <button
              key={s.v}
              className="chip"
              data-active={value.scale === s.v ? 'true' : 'false'}
              onClick={() => set('scale', s.v)}
            >
              {s.label}
              <span className="chip__sub">×{s.v}</span>
            </button>
          ))}
        </div>
      </div>

      {/* OBS 소스 크기 */}
      <div className="opts__group">
        <div className="opts__label">
          OBS 소스 크기
          <span className="opts__note">URL 이 아니라 OBS 소스 속성에 넣는 값입니다</span>
        </div>
        <div className="opts__row">
          {SIZES.map((s) => (
            <button
              key={s.label}
              className="chip"
              data-active={value.width === s.w && value.height === s.h ? 'true' : 'false'}
              onClick={() => onChange({ ...value, width: s.w, height: s.h })}
            >
              {s.label}
            </button>
          ))}
          <span className="opts__size">
            <input
              type="number"
              className="opts__num"
              value={value.width}
              min={200}
              max={3840}
              onChange={(e) => set('width', Number(e.target.value) || DEFAULT_OPTIONS.width)}
              aria-label="너비"
            />
            <span className="opts__x">×</span>
            <input
              type="number"
              className="opts__num"
              value={value.height}
              min={100}
              max={2160}
              onChange={(e) => set('height', Number(e.target.value) || DEFAULT_OPTIONS.height)}
              aria-label="높이"
            />
          </span>
        </div>
      </div>

      {/* 표시 옵션 */}
      <div className="opts__group">
        <div className="opts__label">표시</div>
        <ul className="opts__list">
          {TOGGLES.map((t) => (
            <li key={t.key}>
              <label className="opt">
                <input
                  type="checkbox"
                  className="opt__input"
                  checked={value[t.key]}
                  onChange={(e) => set(t.key, e.target.checked)}
                />
                <span className="opt__box" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M4.5 12.5l5 5 10-11" />
                  </svg>
                </span>
                <span className="opt__text">
                  <span className="opt__name">{t.label}</span>
                  <span className="opt__hint">{t.hint}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {/* 설정한 옵션이 그대로 들어간 주소 — 여기서 바로 복사 */}
      <div className="opts__out">
        <code className="opts__url" title={urlPath}>
          {urlPath}
        </code>
        <button className="btn btn--brand opts__copy" onClick={onCopy}>
          {copied ? '복사됨 ✓' : 'OBS URL 복사'}
        </button>
      </div>
    </section>
  );
}
