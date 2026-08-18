'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Item } from '@/lib/types';

type Props = {
  title: string;
  items: Item[];
  /** 완료 항목 숨기기 */
  hideDone?: boolean;
  /** 진행률 바 숨기기 */
  hideProgress?: boolean;
  /** false 면 원래 순서 그대로. 기본값은 안 한 항목을 위로 올린다. */
  sortDone?: boolean;
  /** 항목이 하나도 없으면 패널 자체를 그리지 않는다 (방송 화면을 비운다) */
  hideEmpty?: boolean;
};

/**
 * 오버레이와 컨트롤 미리보기가 공유하는 프레젠테이션 컴포넌트.
 * 편집 중 보는 화면이 OBS 화면과 완전히 동일해진다.
 *
 * 높이는 부모(.overlay-root)가 정한다. 항목이 넘치면 목록만 잘리고
 * 아래쪽이 페이드되며 "+N개" 가 표시된다.
 */
export default function ChecklistPanel({
  title,
  items,
  hideDone,
  hideProgress,
  sortDone,
  hideEmpty,
}: Props) {
  const total = items.length;
  const doneCount = items.filter((i) => i.done).length;
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  const allDone = total > 0 && doneCount === total;

  // 안 한 항목을 위로 — 목록이 잘려도 남은 할 일이 계속 보인다.
  // 같은 그룹 안에서는 원래 순서를 유지한다(안정 정렬).
  const ordered = sortDone === false ? items : [...items].sort((a, b) => Number(a.done) - Number(b.done));
  const visible = hideDone ? ordered.filter((i) => !i.done) : ordered;

  const empty = hideEmpty === true && total === 0;

  const listRef = useRef<HTMLUListElement>(null);
  const [clipped, setClipped] = useState(0);

  /** 컨테이너 바깥으로 밀려난(=완전히 보이지 않는) 항목 수를 센다 */
  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;

    // 1px 여유 — 서브픽셀 반올림으로 마지막 항목이 잘린 것처럼 잡히는 것 방지
    const bottom = el.getBoundingClientRect().bottom + 1;
    let hidden = 0;
    for (const child of Array.from(el.children)) {
      if (child.getBoundingClientRect().bottom > bottom) hidden++;
    }
    setClipped((prev) => (prev === hidden ? prev : hidden));
  }, []);

  useEffect(() => {
    measure();

    const el = listRef.current;
    if (!el) return;

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);

    // 웹폰트가 늦게 적용되면 줄 높이가 바뀌므로 다시 잰다
    if (typeof document !== 'undefined' && 'fonts' in document) {
      void document.fonts.ready.then(measure);
    }
    window.addEventListener('resize', measure);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, visible.length, title]);

  if (empty) return null;

  return (
    <div
      className="panel"
      data-complete={allDone ? 'true' : 'false'}
      data-clipped={clipped > 0 ? 'true' : 'false'}
    >
      <div className="panel__head">
        <h1 className="panel__title">{title}</h1>
        <span className="panel__count">
          <em>{doneCount}</em>
          <span className="panel__count-sep">/</span>
          {total}
        </span>
      </div>

      {!hideProgress && (
        <div
          className="panel__progress"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="panel__bar" style={{ width: `${percent}%` }} />
        </div>
      )}

      {visible.length > 0 ? (
        <ul className="panel__list" ref={listRef}>
          {visible.map((item) => (
            <li key={item.id} className="row" data-done={item.done ? 'true' : 'false'}>
              <span className="row__box" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="row__check" focusable="false">
                  <path d="M4.5 12.5l5 5 10-11" />
                </svg>
              </span>
              <span className="row__label">{item.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel__empty">{total === 0 ? '항목이 없습니다' : '전부 완료!'}</p>
      )}

      {clipped > 0 && <div className="panel__more">+{clipped}개 더</div>}
    </div>
  );
}
